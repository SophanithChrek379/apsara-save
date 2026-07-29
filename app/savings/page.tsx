'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Banknote,
  CalendarCheck2,
  CalendarDays,
  Check,
  Coins,
  Flame,
  Layers,
  Minus,
  Moon,
  Plane,
  PiggyBank,
  Plus,
  Shirt,
  ShieldCheck,
  Sun,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSystemTheme } from '@/hooks/use-system-theme';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*                              Storage keys                                  */
/*  One key per strategy so a corrupt or cleared bucket can never take the     */
/*  other two down with it.                                                    */
/* -------------------------------------------------------------------------- */

const DAILY_KEY = 'apsara_daily_2026';
const CHALLENGE_KEY = 'apsara_challenge_52w';
const BUCKETS_KEY = 'apsara_monthly_buckets';

/* The tracker first shipped as a daily-only page writing `apsara_savings_2026`.
   Read that key as a fallback so history logged before the multi-strategy layout
   is not stranded behind the new name. */
const LEGACY_DAILY_KEY = 'apsara_savings_2026';
/* Marks that the historical backfill already ran, so unchecking days by hand
   is never undone by a re-seed on the next visit. */
const SEED_KEY = 'apsara_savings_2026_seeded';

/* -------------------------------------------------------------------------- */
/*                     Strategy A — daily $1.25 micro-habit                   */
/* -------------------------------------------------------------------------- */

const TRACK_START = '2026-01-01';
const TRACK_END = '2026-12-31';
const TOTAL_DAYS = 365;
const DAILY_AMOUNT = 1.25;
const DAILY_TARGET = TOTAL_DAYS * DAILY_AMOUNT; // 456.25

/* -------------------------------------------------------------------------- */
/*                    Strategy B — 52-week escalation ladder                  */
/* -------------------------------------------------------------------------- */

const TOTAL_WEEKS = 52;
const WEEK_ONE_AMOUNT = 2;
const WEEK_STEP = 1;

/** Week 1 is $2 and every week after adds exactly $1, so week 52 is $53. */
function weekAmount(week: number): number {
  return WEEK_ONE_AMOUNT + (week - 1) * WEEK_STEP;
}

const ALL_WEEKS: readonly number[] = Array.from(
  { length: TOTAL_WEEKS },
  (_, index) => index + 1,
);

/** Sum of the whole ladder: $2 + $3 + … + $53 = $1,430.00. */
const CHALLENGE_TARGET = ALL_WEEKS.reduce((sum, week) => sum + weekAmount(week), 0);

/* -------------------------------------------------------------------------- */
/*                  Strategy C — monthly sinking-fund buckets                 */
/* -------------------------------------------------------------------------- */

const BUCKET_DEFS = [
  { id: 'emergency', label: 'Emergency', target: 70, Icon: ShieldCheck, blurb: 'Rainy-day cushion' },
  { id: 'retirement', label: 'Retirement', target: 47, Icon: PiggyBank, blurb: 'Long-horizon compounding' },
  { id: 'trip', label: 'Trip / Vacation', target: 39, Icon: Plane, blurb: 'Next getaway fund' },
  { id: 'clothes', label: 'Clothes', target: 39, Icon: Shirt, blurb: 'Wardrobe refresh' },
] as const;

type BucketId = (typeof BUCKET_DEFS)[number]['id'];
type BucketBalances = Record<BucketId, number>;

/** One payday tops every bucket up to its baseline quota: 70 + 47 + 39 + 39. */
const PAYDAY_TOTAL = BUCKET_DEFS.reduce((sum, bucket) => sum + bucket.target, 0);
/** Step for the manual +/- controls, in dollars. */
const BUCKET_STEP = 1;

/* A factory rather than a shared constant, so a reset can never hand two pieces
   of state the same mutable object. Keys are checked against BucketId. */
function emptyBuckets(): BucketBalances {
  return { emergency: 0, retirement: 0, trip: 0, clothes: 0 };
}

/* -------------------------------------------------------------------------- */
/*                             Combined target                                */
/* -------------------------------------------------------------------------- */

const COMBINED_TARGET = DAILY_TARGET + CHALLENGE_TARGET + PAYDAY_TOTAL; // 2081.25

/* -------------------------------------------------------------------------- */
/*                            Formatting helpers                              */
/* -------------------------------------------------------------------------- */

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/* Locale is pinned rather than left to the visitor, because a floating locale
   would format differently on the server and the client and break hydration. */
const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(amount: number): string {
  return MONEY.format(amount);
}

/* -------------------------------------------------------------------------- */
/*                               Date helpers                                 */
/*  All formatting is local-time based so the YYYY-MM-DD key never shifts      */
/*  a day due to UTC conversion.                                              */
/* -------------------------------------------------------------------------- */

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromISODate(iso: string): Date {
  const [year, month, day] = iso.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatLongDate(iso: string): string {
  const date = fromISODate(iso);
  return `${MONTH_LABELS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Every date string from 2026-01-01 through 2026-12-31, in order. */
const ALL_DATES: string[] = (() => {
  const dates: string[] = [];
  let cursor = fromISODate(TRACK_START);
  const end = fromISODate(TRACK_END);
  while (cursor <= end) {
    dates.push(toISODate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
})();

/** ALL_DATES bucketed into 12 month columns. */
const DATES_BY_MONTH: string[][] = (() => {
  const months: string[][] = Array.from({ length: 12 }, () => []);
  for (const iso of ALL_DATES) {
    months[fromISODate(iso).getMonth()]?.push(iso);
  }
  return months;
})();

const VALID_DATES = new Set(ALL_DATES);
const MAX_MONTH_LENGTH = Math.max(...DATES_BY_MONTH.map((month) => month.length));

/** Consecutive logged days ending today, or ending yesterday if today is unlogged. */
function computeDayStreak(logged: Set<string>, today: string): number {
  if (!VALID_DATES.has(today)) return 0;

  let cursor = fromISODate(today);
  if (!logged.has(today)) cursor = addDays(cursor, -1);

  let streak = 0;
  while (logged.has(toISODate(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Consecutive completed weeks ending at the furthest week checked off. */
function computeWeekStreak(completed: Set<number>): number {
  let streak = 0;
  for (let week = TOTAL_WEEKS; week >= 1; week -= 1) {
    if (completed.has(week)) streak += 1;
    else if (streak > 0) break;
  }
  return streak;
}

/**
 * Every tracked date from Jan 1 up to and including `iso`.
 * Used to backfill deposits that were made before this app existed.
 */
function datesThrough(iso: string): string[] {
  if (VALID_DATES.has(iso)) {
    return ALL_DATES.slice(0, ALL_DATES.indexOf(iso) + 1);
  }
  // Outside the track: after 2026 means the year is complete, before it means
  // nothing has been saved yet.
  return fromISODate(iso) > fromISODate(TRACK_END) ? [...ALL_DATES] : [];
}

/* -------------------------------------------------------------------------- */
/*                            Persistence layer                               */
/*  Every read is validated. Storage is user-editable and survives deploys,    */
/*  so stale or hand-mangled data must never be trusted into the totals.       */
/* -------------------------------------------------------------------------- */

function readStored<T>(key: string, parse: (value: unknown) => T | null): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return parse(JSON.parse(raw) as unknown);
  } catch {
    // Unparseable JSON or storage blocked entirely — treat as absent.
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode / quota) — keep the session in memory.
  }
}

function parseDates(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const clean = value.filter(
    (entry): entry is string => typeof entry === 'string' && VALID_DATES.has(entry),
  );
  return Array.from(new Set(clean)).sort();
}

function parseWeeks(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const clean = value.filter(
    (entry): entry is number =>
      typeof entry === 'number' && Number.isInteger(entry) && entry >= 1 && entry <= TOTAL_WEEKS,
  );
  return Array.from(new Set(clean)).sort((a, b) => a - b);
}

function parseBuckets(value: unknown): BucketBalances | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const next = emptyBuckets();
  for (const bucket of BUCKET_DEFS) {
    const amount = source[bucket.id];
    // Unknown keys are dropped and bad numbers fall back to zero, so a partial
    // or renamed payload still yields a usable object.
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
      next[bucket.id] = amount;
    }
  }
  return next;
}

function hasSeeded(): boolean {
  try {
    return window.localStorage.getItem(SEED_KEY) === '1';
  } catch {
    // Treat unreadable storage as already seeded so a backfill is never applied
    // repeatedly to a session that cannot remember it happened.
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/*                            Presentational atoms                            */
/* -------------------------------------------------------------------------- */

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn('rounded-2xl border border-border bg-card p-5 sm:p-6', className)}
    >
      {children}
    </section>
  );
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

type MetricCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
};

function MetricCard({ icon, label, value, hint, accent = false }: MetricCardProps) {
  return (
    <div
      className={cn(
        'flex min-h-[104px] flex-col justify-between rounded-xl border p-4 transition-colors duration-300',
        accent
          ? 'border-emerald-500/40 dark:border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/5'
          : 'border-border bg-muted/40 hover:border-muted-foreground/40',
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className={accent ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div>
        <p
          className={cn(
            'text-2xl font-semibold tabular-nums tracking-tight',
            accent ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground',
          )}
        >
          {value}
        </p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Label/value pair used for the fixed 2026 parameters and header breakdown. */
function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/**
 * Reports which appearance the device is currently asking for. Reserves its own
 * width so the label appearing after hydration cannot nudge the header.
 */
function ThemeIndicator() {
  const theme = useSystemTheme();

  return (
    <span
      title="Theme follows your device appearance"
      className="inline-flex min-w-[5.5rem] items-center justify-end gap-1.5 text-xs text-muted-foreground"
    >
      {theme === null ? (
        // Unknown during hydration — hold the space, show nothing.
        <span className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <>
          {theme === 'dark' ? (
            <Moon className="h-3.5 w-3.5" />
          ) : (
            <Sun className="h-3.5 w-3.5" />
          )}
          <span>Auto · {theme === 'dark' ? 'Dark' : 'Light'}</span>
        </>
      )}
    </span>
  );
}

function PanelHeading({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                      Tab A — daily micro-habit strategy                    */
/* -------------------------------------------------------------------------- */

type DailyPanelProps = {
  mounted: boolean;
  today: string;
  logged: Set<string>;
  onMarkToday: () => void;
  onToggleDate: (iso: string) => void;
};

function DailyPanel({ mounted, today, logged, onMarkToday, onToggleDate }: DailyPanelProps) {
  const count = logged.size;
  const saved = count * DAILY_AMOUNT;
  const remainingDays = TOTAL_DAYS - count;
  const streak = useMemo(
    () => (today ? computeDayStreak(logged, today) : 0),
    [logged, today],
  );

  const todayInRange = VALID_DATES.has(today);
  const todayLogged = todayInRange && logged.has(today);
  const canLog = mounted && todayInRange && !todayLogged;

  const buttonLabel = (() => {
    // Before mount the stored state is unknown, so show the neutral call to
    // action rather than guessing and swapping it a frame later.
    if (!mounted) return `Mark ${formatMoney(DAILY_AMOUNT)} Saved Today`;
    if (!todayInRange) return 'Outside 2026 Track';
    if (todayLogged) return 'Logged for Today';
    return `Mark ${formatMoney(DAILY_AMOUNT)} Saved Today`;
  })();

  return (
    <div className="flex flex-col gap-5">
      {/* Primary action */}
      <button
        type="button"
        onClick={onMarkToday}
        disabled={!canLog}
        className={cn(
          'flex min-h-[64px] w-full items-center justify-center gap-2 rounded-xl px-5 py-4 text-sm font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
          canLog
            ? 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 active:scale-[0.99]'
            : 'cursor-not-allowed border border-border bg-card text-muted-foreground',
        )}
      >
        {mounted && todayLogged ? <Check className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
        {buttonLabel}
      </button>

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Daily Habit Saved
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-4xl">
              {formatMoney(saved)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Target</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground/80">
              {formatMoney(DAILY_TARGET)}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <ProgressBar
            percent={(count / TOTAL_DAYS) * 100}
            label="Daily habit progress"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">
              {((count / TOTAL_DAYS) * 100).toFixed(1)}% complete
            </span>
            <span className="tabular-nums">
              {count} / {TOTAL_DAYS} days
            </span>
          </div>
        </div>

        {/* Fixed 2026 parameters */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatLine label="Start" value={TRACK_START} />
          <StatLine label="End" value={TRACK_END} />
          <StatLine label="Total Days" value={`${TOTAL_DAYS}`} />
          <StatLine label="Target" value={formatMoney(DAILY_TARGET)} />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard
            icon={<Flame className="h-4 w-4" />}
            label="Current Streak"
            value={`${streak} ${streak === 1 ? 'day' : 'days'}`}
            hint={streak > 0 ? 'Keep it alive' : 'Log today to start'}
            accent={streak > 0}
          />
          <MetricCard
            icon={<CalendarCheck2 className="h-4 w-4" />}
            label="Days Logged"
            value={`${count}`}
            hint={`of ${TOTAL_DAYS} days`}
          />
          <MetricCard
            icon={<CalendarDays className="h-4 w-4" />}
            label="Days Remaining"
            value={`${remainingDays}`}
            hint={`${formatMoney(remainingDays * DAILY_AMOUNT)} to go`}
          />
        </div>
      </Panel>

      {/* 365-day contribution matrix — 12 month columns */}
      <Panel>
        <PanelHeading icon={<Target className="h-4 w-4" />} title="2026 Contribution Matrix">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-muted" />
            <span>Empty</span>
            <span className="ml-1 h-2.5 w-2.5 rounded-[2px] bg-emerald-500" />
            <span>Saved</span>
          </div>
        </PanelHeading>

        <div className="mt-5 overflow-x-auto pb-1">
          {/* Fixed cell sizing + fixed row count keeps the grid height stable
              across every render, so hydration causes no layout shift. */}
          <div className="mx-auto grid w-fit grid-cols-12 gap-x-3">
            {DATES_BY_MONTH.map((monthDates, monthIndex) => (
              <div key={MONTH_LABELS[monthIndex]} className="flex flex-col items-center">
                <span className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {MONTH_LABELS[monthIndex]}
                </span>
                <div className="flex flex-col gap-[3px]">
                  {Array.from({ length: MAX_MONTH_LENGTH }).map((_, dayIndex) => {
                    const iso = monthDates[dayIndex];

                    // Spacer keeps every column the same height (31 rows).
                    if (!iso) {
                      return (
                        <span
                          key={`${monthIndex}-pad-${dayIndex}`}
                          className="h-2.5 w-2.5"
                          aria-hidden="true"
                        />
                      );
                    }

                    const isLogged = logged.has(iso);
                    const isToday = iso === today;
                    // ISO strings compare lexicographically, so this is a plain
                    // date comparison. Before mount `today` is '' and nothing is
                    // editable, which keeps the SSR markup identical.
                    const isEditable = mounted && today !== '' && iso <= today;

                    const label = `${formatLongDate(iso)} — ${
                      isLogged ? `${formatMoney(DAILY_AMOUNT)} saved` : 'not logged'
                    }`;
                    const appearance = cn(
                      'h-2.5 w-2.5 rounded-[2px] transition-colors duration-300',
                      isLogged ? 'bg-emerald-500' : 'bg-muted',
                      isToday && 'ring-1 ring-emerald-500/70 dark:ring-emerald-300/70 ring-offset-1 ring-offset-background',
                    );

                    if (!isEditable) {
                      return <span key={iso} title={label} className={appearance} />;
                    }

                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => onToggleDate(iso)}
                        title={`${label} — click to toggle`}
                        aria-label={label}
                        aria-pressed={isLogged}
                        className={cn(
                          appearance,
                          'cursor-pointer hover:ring-1 hover:ring-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400',
                        )}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Click any past day to correct it. Future days stay locked.
        </p>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                    Tab B — 52-week escalation challenge                    */
/* -------------------------------------------------------------------------- */

type ChallengePanelProps = {
  mounted: boolean;
  completed: Set<number>;
  saved: number;
  onToggleWeek: (week: number) => void;
};

function ChallengePanel({ mounted, completed, saved, onToggleWeek }: ChallengePanelProps) {
  const streak = useMemo(() => computeWeekStreak(completed), [completed]);
  const remaining = CHALLENGE_TARGET - saved;
  const percent = (saved / CHALLENGE_TARGET) * 100;

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Challenge Saved
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-4xl">
              {formatMoney(saved)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Total Yield Target
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground/80">
              {formatMoney(CHALLENGE_TARGET)}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <ProgressBar percent={percent} label="52-week challenge progress" />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">{percent.toFixed(1)}% complete</span>
            <span className="tabular-nums">
              {completed.size} / {TOTAL_WEEKS} weeks
            </span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard
            icon={<Flame className="h-4 w-4" />}
            label="Current Streak"
            value={`${streak} ${streak === 1 ? 'week' : 'weeks'}`}
            hint={streak > 0 ? 'Ladder is climbing' : 'Check a week to start'}
            accent={streak > 0}
          />
          <MetricCard
            icon={<CalendarCheck2 className="h-4 w-4" />}
            label="Completed Weeks"
            value={`${completed.size}`}
            hint={`of ${TOTAL_WEEKS} weeks`}
          />
          <MetricCard
            icon={<Target className="h-4 w-4" />}
            label="Target Remaining"
            value={formatMoney(remaining)}
            hint={`${TOTAL_WEEKS - completed.size} weeks unchecked`}
          />
        </div>
      </Panel>

      {/* Check-in grid — one tile per week, tap to toggle */}
      <Panel>
        <PanelHeading icon={<TrendingUp className="h-4 w-4" />} title="Weekly Escalation Ladder">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatMoney(weekAmount(1))} → {formatMoney(weekAmount(TOTAL_WEEKS))}
          </span>
        </PanelHeading>

        <div className="mt-5 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {ALL_WEEKS.map((week) => {
            const amount = weekAmount(week);
            // Before mount nothing reads as complete, so server and client agree.
            const isDone = mounted && completed.has(week);

            return (
              <button
                key={week}
                type="button"
                onClick={() => onToggleWeek(week)}
                aria-pressed={isDone}
                aria-label={`Week ${week} — ${formatMoney(amount)} — ${
                  isDone ? 'completed' : 'not completed'
                }`}
                title={`Week ${week} · ${formatMoney(amount)}`}
                className={cn(
                  'flex min-h-[62px] flex-col items-center justify-center gap-0.5 rounded-lg border transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 active:scale-[0.97]',
                  isDone
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
                    : 'border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
                )}
              >
                <span className="text-[10px] font-medium uppercase tracking-wider">
                  W{week}
                </span>
                <span className="text-sm font-semibold tabular-nums">${amount}</span>
              </button>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                  Tab C — monthly target allocation buckets                 */
/* -------------------------------------------------------------------------- */

type BucketsPanelProps = {
  balances: BucketBalances;
  saved: number;
  onAdjust: (id: BucketId, delta: number) => void;
  onPayday: () => void;
};

function BucketsPanel({ balances, saved, onAdjust, onPayday }: BucketsPanelProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* Master allocation trigger */}
      <button
        type="button"
        onClick={onPayday}
        className="flex min-h-[64px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-4 text-sm font-semibold text-emerald-950 transition-all duration-200 hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 active:scale-[0.99]"
      >
        <Banknote className="h-4 w-4" />
        Inject Payday Allocation ({formatMoney(PAYDAY_TOTAL)})
      </button>

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Buckets Balance
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-4xl">
              {formatMoney(saved)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Monthly Quota
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground/80">
              {formatMoney(PAYDAY_TOTAL)}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <ProgressBar
            percent={(saved / PAYDAY_TOTAL) * 100}
            label="Monthly bucket allocation progress"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            One tap distributes each bucket&apos;s fixed baseline quota in a single concurrent
            drop.
          </p>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {BUCKET_DEFS.map(({ id, label, target, Icon, blurb }) => {
          const balance = balances[id];
          const percent = (balance / target) * 100;
          const funded = balance >= target;

          return (
            <div
              key={id}
              className={cn(
                'flex flex-col gap-4 rounded-2xl border p-5 transition-colors duration-300',
                funded
                  ? 'border-emerald-500/40 dark:border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/5'
                  : 'border-border bg-card',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-lg border',
                      funded
                        ? 'border-emerald-500/40 dark:border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-border bg-muted/50 text-muted-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{blurb}</p>
                  </div>
                </div>
                {funded ? (
                  <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 dark:border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    Funded
                  </span>
                ) : null}
              </div>

              <div>
                <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                  {formatMoney(balance)}
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                    / {formatMoney(target)}
                  </span>
                </p>
                <div className="mt-3">
                  <ProgressBar percent={percent} label={`${label} bucket progress`} />
                </div>
              </div>

              {/* Independent granular controls */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {percent.toFixed(0)}% of target
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onAdjust(id, -BUCKET_STEP)}
                    disabled={balance <= 0}
                    aria-label={`Remove ${formatMoney(BUCKET_STEP)} from ${label}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground/80 transition-colors hover:border-muted-foreground/40 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdjust(id, BUCKET_STEP)}
                    aria-label={`Add ${formatMoney(BUCKET_STEP)} to ${label}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/40 dark:border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-colors hover:bg-emerald-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Navigation switcher bar                           */
/* -------------------------------------------------------------------------- */

const TAB_DEFS = [
  { id: 'daily', label: 'Daily', Icon: CalendarDays },
  { id: 'weekly', label: 'Weekly', Icon: TrendingUp },
  { id: 'monthly', label: 'Monthly', Icon: Layers },
] as const;

type TabId = (typeof TAB_DEFS)[number]['id'];

/* Idle and hover states are left to the component's own tokens, which already
   follow the palette. Only the active state is overridden, to make it emerald
   rather than the default raised-surface look.

   That override has to be stated twice. shadcn paints the active trigger with
   `data-[state=active]:bg-background` *and* a `dark:`-scoped `bg-input/30`; the
   dark rule carries an extra `.dark` in its selector, so it would outrank an
   unprefixed override no matter the class order. Restating it with a matching
   modifier set lets twMerge drop the token version outright instead. */
const TRIGGER_CLASS = cn(
  'h-11 rounded-lg text-sm font-semibold',
  'data-[state=active]:bg-emerald-500 data-[state=active]:text-emerald-950',
  'dark:data-[state=active]:bg-emerald-500 dark:data-[state=active]:text-emerald-950',
  'dark:data-[state=active]:border-transparent',
  'focus-visible:border-emerald-500 focus-visible:ring-emerald-500/40 focus-visible:outline-emerald-500',
);

/* -------------------------------------------------------------------------- */
/*                                   Page                                     */
/* -------------------------------------------------------------------------- */

export default function SavingsPage() {
  /* Gate on `mounted` so the server render and the hydrating client render are
     byte-identical: stored values are only read afterwards, which rules out the
     flash of a wrong total that reading storage during render would cause. */
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<TabId>('daily');

  const [dailyDates, setDailyDates] = useState<string[]>([]);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [buckets, setBuckets] = useState<BucketBalances>(emptyBuckets);
  const [today, setToday] = useState<string>('');

  useEffect(() => {
    const todayISO = toISODate(new Date());
    const storedDaily =
      readStored(DAILY_KEY, parseDates) ?? readStored(LEGACY_DAILY_KEY, parseDates) ?? [];

    // Saving began on 2026-01-01, before this tracker existed. On the very first
    // visit, backfill every day through today so the app matches the real
    // deposit history. Runs once — see SEED_KEY.
    if (hasSeeded()) {
      setDailyDates(storedDaily);
    } else {
      setDailyDates(Array.from(new Set([...storedDaily, ...datesThrough(todayISO)])).sort());
    }

    setWeeks(readStored(CHALLENGE_KEY, parseWeeks) ?? []);
    setBuckets(readStored(BUCKETS_KEY, parseBuckets) ?? emptyBuckets());
    setToday(todayISO);
    setMounted(true);
  }, []);

  /* Persist only after hydration, otherwise the empty initial state would
     overwrite whatever is already stored. The seed flag is written from the same
     effect as the daily list so a backfill and its marker land together. */
  useEffect(() => {
    if (!mounted) return;
    writeStored(DAILY_KEY, dailyDates);
    try {
      window.localStorage.setItem(SEED_KEY, '1');
    } catch {
      // Non-fatal: the seed still applies to this session.
    }
  }, [dailyDates, mounted]);

  useEffect(() => {
    if (!mounted) return;
    writeStored(CHALLENGE_KEY, weeks);
  }, [weeks, mounted]);

  useEffect(() => {
    if (!mounted) return;
    writeStored(BUCKETS_KEY, buckets);
  }, [buckets, mounted]);

  const loggedSet = useMemo(() => new Set(dailyDates), [dailyDates]);
  const weekSet = useMemo(() => new Set(weeks), [weeks]);

  /* ------------------------------ Aggregates ----------------------------- */

  const dailySaved = dailyDates.length * DAILY_AMOUNT;
  const challengeSaved = useMemo(
    () => weeks.reduce((sum, week) => sum + weekAmount(week), 0),
    [weeks],
  );
  const bucketsSaved = useMemo(
    () => BUCKET_DEFS.reduce((sum, bucket) => sum + buckets[bucket.id], 0),
    [buckets],
  );
  const netWealth = dailySaved + challengeSaved + bucketsSaved;

  /* ------------------------------- Actions ------------------------------- */

  const markToday = useCallback(() => {
    if (!VALID_DATES.has(today)) return;
    setDailyDates((prev) => (prev.includes(today) ? prev : [...prev, today].sort()));
  }, [today]);

  // Correcting history: a backfilled day that was actually missed can be
  // unchecked, and a forgotten one checked. Future days stay untouchable.
  const toggleDate = useCallback((iso: string) => {
    setDailyDates((prev) =>
      prev.includes(iso) ? prev.filter((entry) => entry !== iso) : [...prev, iso].sort(),
    );
  }, []);

  const toggleWeek = useCallback((week: number) => {
    setWeeks((prev) =>
      prev.includes(week)
        ? prev.filter((entry) => entry !== week)
        : [...prev, week].sort((a, b) => a - b),
    );
  }, []);

  const adjustBucket = useCallback((id: BucketId, delta: number) => {
    // Clamped at zero: a bucket can be drawn down to empty but never negative.
    setBuckets((prev) => ({ ...prev, [id]: Math.max(0, prev[id] + delta) }));
  }, []);

  const injectPayday = useCallback(() => {
    setBuckets((prev) => {
      const next = emptyBuckets();
      for (const bucket of BUCKET_DEFS) {
        next[bucket.id] = prev[bucket.id] + bucket.target;
      }
      return next;
    });
  }, []);

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground antialiased sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-3xl">
        {/* Global aggregate header */}
        <header>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Multi-Strategy Savings
            </p>
            <ThemeIndicator />
          </div>
          {/* Clipped-text gradient has to be stated per palette: the dark ramp
              would be invisible against a light background. */}
          <h1 className="mt-2 bg-gradient-to-r from-zinc-900 via-zinc-700 to-emerald-600 bg-clip-text text-4xl font-semibold tracking-tight text-transparent dark:from-white dark:via-zinc-200 dark:to-emerald-300 sm:text-5xl">
            Apsara Save
          </h1>

          <div className="mt-7 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Coins className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Net Wealth Saved
                </p>
                <p className="mt-1.5 text-4xl font-semibold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-5xl">
                  {formatMoney(netWealth)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Combined Target
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground/80">
                  {formatMoney(COMBINED_TARGET)}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <ProgressBar
                percent={(netWealth / COMBINED_TARGET) * 100}
                label="Net wealth progress"
              />
            </div>

            {/* Breakdown of the three contributing strategies */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              <StatLine label="Daily $1.25" value={formatMoney(dailySaved)} />
              <StatLine label="52-Week" value={formatMoney(challengeSaved)} />
              <StatLine label="Buckets" value={formatMoney(bucketsSaved)} />
            </div>
          </div>
        </header>

        {/* Persistent 3-segment switcher + panels */}
        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next as TabId)}
          className="mt-6 gap-6"
        >
          {/* Surface and idle text come from the component's own `bg-muted` /
              `text-muted-foreground`; only layout and the border are set here. */}
          <TabsList className="grid w-full grid-cols-3 gap-1 rounded-xl border border-border p-1 group-data-horizontal/tabs:h-auto">
            {TAB_DEFS.map(({ id, label, Icon }) => (
              <TabsTrigger key={id} value={id} className={TRIGGER_CLASS}>
                <Icon className="h-4 w-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="daily">
            <DailyPanel
              mounted={mounted}
              today={today}
              logged={loggedSet}
              onMarkToday={markToday}
              onToggleDate={toggleDate}
            />
          </TabsContent>

          <TabsContent value="weekly">
            <ChallengePanel
              mounted={mounted}
              completed={weekSet}
              saved={challengeSaved}
              onToggleWeek={toggleWeek}
            />
          </TabsContent>

          <TabsContent value="monthly">
            <BucketsPanel
              balances={buckets}
              saved={bucketsSaved}
              onAdjust={adjustBucket}
              onPayday={injectPayday}
            />
          </TabsContent>
        </Tabs>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          All three strategies are stored locally in this browser — nothing leaves the device.
        </p>
      </div>
    </main>
  );
}
