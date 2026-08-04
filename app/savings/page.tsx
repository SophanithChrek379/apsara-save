'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Banknote,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  CheckCheck,
  Coins,
  Flame,
  History,
  Layers,
  Lock,
  Plane,
  PiggyBank,
  RotateCcw,
  Shirt,
  ShieldCheck,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*                              Storage keys                                  */
/*  One vault object holds every year, so a new January needs no migration     */
/*  and an old year can never be overwritten by the current one.               */
/* -------------------------------------------------------------------------- */

const VAULT_KEY = 'apsara_savings_vault';

/* Pre-vault layout: three flat keys, all of them describing 2026 only. They are
   read once to seed the vault and then left in place as a fallback — deleting a
   user's only copy of their history to save a few bytes is not a good trade. */
const LEGACY_DAILY_KEY = 'apsara_daily_2026';
const LEGACY_DAILY_KEY_V0 = 'apsara_savings_2026';
const LEGACY_CHALLENGE_KEY = 'apsara_challenge_52w';
const LEGACY_BUCKETS_KEY = 'apsara_monthly_buckets';
const LEGACY_YEAR = 2026;

/* Marks that the historical backfill already ran, so unchecking days by hand
   is never undone by a re-seed on the next visit. */
const SEED_KEY = 'apsara_savings_2026_seeded';

/* Guard rails for year keys read back out of storage. Anything outside this
   window is hand-mangled or a different app's data, and is dropped. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2200;

/* -------------------------------------------------------------------------- */
/*                     Strategy A — daily $1.25 micro-habit                   */
/* -------------------------------------------------------------------------- */

const DAILY_AMOUNT = 1.25;

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

/** Quota lookup, so an action can fund one bucket without scanning the defs. */
const BUCKET_TARGET = Object.fromEntries(
  BUCKET_DEFS.map((bucket) => [bucket.id, bucket.target]),
) as Record<BucketId, number>;

/* A factory rather than a shared constant, so a reset can never hand two pieces
   of state the same mutable object. Keys are checked against BucketId. */
function emptyBuckets(): BucketBalances {
  return { emergency: 0, retirement: 0, trip: 0, clothes: 0 };
}

function bucketsTotal(balances: BucketBalances): number {
  return BUCKET_DEFS.reduce((sum, bucket) => sum + balances[bucket.id], 0);
}

/** True once every bucket has met its quota — the shape a payday drop leaves. */
function isMonthFunded(balances: BucketBalances): boolean {
  return BUCKET_DEFS.every((bucket) => balances[bucket.id] >= bucket.target);
}

/* -------------------------------------------------------------------------- */
/*                          Monthly ledger — 12 slots                         */
/*  Buckets are tracked per calendar month rather than as one running pile,    */
/*  so a payday drop belongs to the month it was made in and an earlier month  */
/*  can still be filled in after the fact.                                     */
/* -------------------------------------------------------------------------- */

const MONTHS_PER_YEAR = 12;

/** Index 0 is January. Always exactly twelve entries. */
type MonthlyLedger = BucketBalances[];

function emptyLedger(): MonthlyLedger {
  return Array.from({ length: MONTHS_PER_YEAR }, emptyBuckets);
}

function ledgerTotal(ledger: MonthlyLedger): number {
  return ledger.reduce((sum, month) => sum + bucketsTotal(month), 0);
}

/**
 * Last month that can be written for `year`: the live month while the year is
 * still running, December once it has closed. Months beyond it have not
 * happened yet, so they are neither selectable nor writable. A year in the
 * future can only arrive by hand-editing storage; it is read-only regardless,
 * so it is treated like a closed one.
 */
function lastOpenMonth(year: number, currentYear: number, currentMonth: number): number {
  return year === currentYear ? currentMonth : MONTHS_PER_YEAR - 1;
}

/** Copy-on-write for a single month; the other eleven are carried by reference. */
function writeMonth(
  ledger: MonthlyLedger,
  index: number,
  mutate: (balances: BucketBalances) => BucketBalances,
): MonthlyLedger {
  return ledger.map((month, slot) => (slot === index ? mutate(month) : month));
}

/* -------------------------------------------------------------------------- */
/*                            Formatting helpers                              */
/* -------------------------------------------------------------------------- */

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/* Spelled out for the month switcher, where three letters read as an abbreviation
   of something rather than as a name. */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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

/* -------------------------------------------------------------------------- */
/*                        Per-year calendar geometry                          */
/*  Everything length-dependent is derived by walking real Date objects from   */
/*  Jan 1 to Dec 31, so a leap year yields 366 cells with no special case.     */
/* -------------------------------------------------------------------------- */

type YearShape = {
  year: number;
  startISO: string;
  endISO: string;
  /** 365, or 366 in a leap year. */
  totalDays: number;
  /** totalDays × $1.25. */
  dailyTarget: number;
  /** Every date in the year, ascending. */
  allDates: string[];
  /** allDates bucketed into 12 month columns. */
  datesByMonth: string[][];
  validDates: Set<string>;
  /** Tallest month column, so every column can be padded to the same height. */
  maxMonthLength: number;
};

/* Building a shape walks ~366 dates. Cached per year so switching tabs, years,
   or re-rendering never repeats the work. */
const YEAR_CACHE = new Map<number, YearShape>();

function getYearShape(year: number): YearShape {
  const cached = YEAR_CACHE.get(year);
  if (cached) return cached;

  const startISO = `${year}-01-01`;
  const endISO = `${year}-12-31`;

  const allDates: string[] = [];
  const end = fromISODate(endISO);
  let cursor = fromISODate(startISO);
  while (cursor <= end) {
    allDates.push(toISODate(cursor));
    cursor = addDays(cursor, 1);
  }

  const datesByMonth: string[][] = Array.from({ length: 12 }, () => []);
  for (const iso of allDates) {
    datesByMonth[fromISODate(iso).getMonth()]?.push(iso);
  }

  const shape: YearShape = {
    year,
    startISO,
    endISO,
    totalDays: allDates.length,
    dailyTarget: allDates.length * DAILY_AMOUNT,
    allDates,
    datesByMonth,
    validDates: new Set(allDates),
    maxMonthLength: Math.max(...datesByMonth.map((month) => month.length)),
  };

  YEAR_CACHE.set(year, shape);
  return shape;
}

/** Combined goal for a single year: daily habit + full ladder + twelve paydays. */
function combinedTarget(shape: YearShape): number {
  return shape.dailyTarget + CHALLENGE_TARGET + PAYDAY_TOTAL * MONTHS_PER_YEAR;
}

/* -------------------------------------------------------------------------- */
/*                          The pre-mount stand-in                            */
/*  This route prerenders as static HTML, so any date read while rendering is  */
/*  the date the *build* ran — a value that stops being true the moment the     */
/*  calendar rolls over, and would then mismatch on every visit until the next  */
/*  deploy. So the first render commits to no clock at all: fixed geometry,     */
/*  and a dash anywhere a year or a month would be named. Both sides of         */
/*  hydration render exactly this, and `mounted` swaps in the real thing.       */
/* -------------------------------------------------------------------------- */

/* A leap year, so the matrix is built at its tallest and the real year can only
   ever drop February's 29th cell — a change inside a column that is shorter
   than January either way, so the grid never resizes. */
const SKELETON_SHAPE = getYearShape(2024);

/** Stands in for any label that cannot be known before the clock is read. */
const PLACEHOLDER = '—';

/**
 * First calendar day of a ladder week: week 1 opens on Jan 1 and each week
 * after opens seven days later. Week 52 opens on day 358, so the index is
 * always inside the year — including in a leap year, where the extra day
 * simply falls past the end of the ladder.
 */
function weekStartISO(shape: YearShape, week: number): string {
  return shape.allDates[(week - 1) * 7] ?? shape.startISO;
}

/** Consecutive logged days ending today, or ending yesterday if today is unlogged. */
function computeDayStreak(shape: YearShape, logged: Set<string>, today: string): number {
  if (!shape.validDates.has(today)) return 0;

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
function datesThrough(shape: YearShape, iso: string): string[] {
  if (shape.validDates.has(iso)) {
    return shape.allDates.slice(0, shape.allDates.indexOf(iso) + 1);
  }
  // Outside the track: past the end means the year is complete, before the
  // start means nothing has been saved yet.
  return fromISODate(iso) > fromISODate(shape.endISO) ? [...shape.allDates] : [];
}

/* -------------------------------------------------------------------------- */
/*                            Persistence layer                               */
/*  Every read is validated. Storage is user-editable and survives deploys,    */
/*  so stale or hand-mangled data must never be trusted into the totals.       */
/* -------------------------------------------------------------------------- */

/** One year's three strategies. Years never share objects or interfere. */
type YearRecord = {
  daily: string[];
  challenge: number[];
  monthly: MonthlyLedger;
  /** Months whose payday allocation has already been dropped, so it cannot
      be dropped a second time. Kept apart from the balances because a hand-
      edited balance that happens to equal the quota is not a payday. */
  injected: number[];
};

/** `{ '2026': { daily, challenge, monthly, injected }, '2027': { … } }` */
type Vault = Record<string, YearRecord>;

function emptyRecord(): YearRecord {
  return { daily: [], challenge: [], monthly: emptyLedger(), injected: [] };
}

/* Stable stand-in for a year with nothing saved yet. Frozen and shared so the
   memos hanging off `record.*` do not re-run on every render of an empty year;
   the vault itself only ever receives fresh objects from `emptyRecord()`. */
const EMPTY_RECORD: YearRecord = Object.freeze({
  daily: Object.freeze([]) as unknown as string[],
  challenge: Object.freeze([]) as unknown as number[],
  monthly: Object.freeze(emptyLedger()) as unknown as MonthlyLedger,
  injected: Object.freeze([]) as unknown as number[],
});

/* Same idea one level down: the stand-in for a month slot that a hand-mangled
   ledger left short, so the memo keyed on it does not re-run every render. */
const EMPTY_BALANCES: BucketBalances = Object.freeze(emptyBuckets());

function isEmptyRecord(record: YearRecord): boolean {
  return (
    record.daily.length === 0 &&
    record.challenge.length === 0 &&
    ledgerTotal(record.monthly) === 0
  );
}

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

/** A date list is only valid against the year it is filed under. */
function makeDateParser(shape: YearShape) {
  return (value: unknown): string[] | null => {
    if (!Array.isArray(value)) return null;
    const clean = value.filter(
      (entry): entry is string => typeof entry === 'string' && shape.validDates.has(entry),
    );
    return Array.from(new Set(clean)).sort();
  };
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

/**
 * Reads either ledger shape. The current one is an array of twelve balance
 * objects; the pre-ledger one is a single undated pile, which is filed under
 * `foldMonth` so the money survives the upgrade rather than being discarded.
 */
function parseLedger(value: unknown, foldMonth: number): MonthlyLedger | null {
  const ledger = emptyLedger();

  if (Array.isArray(value)) {
    // Extra slots from a hand-edited payload are ignored; missing ones stay zero.
    for (let month = 0; month < MONTHS_PER_YEAR; month += 1) {
      ledger[month] = parseBuckets(value[month]) ?? emptyBuckets();
    }
    return ledger;
  }

  const flat = parseBuckets(value);
  if (!flat) return null;
  ledger[foldMonth] = flat;
  return ledger;
}

function parseMonthIndexes(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const clean = value.filter(
    (entry): entry is number =>
      typeof entry === 'number' &&
      Number.isInteger(entry) &&
      entry >= 0 &&
      entry < MONTHS_PER_YEAR,
  );
  return Array.from(new Set(clean)).sort((a, b) => a - b);
}

/** `'2026'` → `2026`; anything else — floats, `'abc'`, out-of-range — → null. */
function parseYearKey(key: string): number | null {
  if (!/^\d{4}$/.test(key)) return null;
  const year = Number(key);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

/**
 * The clock is a parameter rather than a global read, so parsing stays pure and
 * a pre-ledger balance lands in the month it most likely belongs to: the live
 * month for the running year, December for a year that has already closed.
 */
function makeVaultParser(currentYear: number, currentMonth: number) {
  return (value: unknown): Vault | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

    const source = value as Record<string, unknown>;
    const vault: Vault = {};

    for (const [key, entry] of Object.entries(source)) {
      const year = parseYearKey(key);
      if (year === null) continue;
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;

      const row = entry as Record<string, unknown>;
      const foldMonth = lastOpenMonth(year, currentYear, currentMonth);
      const monthly = parseLedger(row.monthly, foldMonth) ?? emptyLedger();

      // A year whose `daily` is corrupt still keeps its weeks and buckets: each
      // branch falls back on its own rather than dropping the whole year.
      vault[key] = {
        daily: makeDateParser(getYearShape(year))(row.daily) ?? [],
        challenge: parseWeeks(row.challenge) ?? [],
        monthly,
        // Records written before injections were tracked have no list. Any month
        // already sitting at full quota is taken to have had its payday, which
        // stops the upgrade itself from handing out a second allocation.
        injected:
          parseMonthIndexes(row.injected) ??
          monthly.flatMap((month, index) => (isMonthFunded(month) ? [index] : [])),
      };
    }

    return vault;
  };
}

/**
 * Folds the three pre-vault flat keys into a 2026 record. Returns an empty
 * vault when none of them hold anything, so a first-time visitor is not given
 * a phantom 2026 entry in the archive switcher.
 */
function migrateLegacyVault(currentYear: number, currentMonth: number): Vault {
  const shape = getYearShape(LEGACY_YEAR);
  const parseDates = makeDateParser(shape);
  const foldMonth = lastOpenMonth(LEGACY_YEAR, currentYear, currentMonth);

  const monthly =
    readStored(LEGACY_BUCKETS_KEY, (value) => parseLedger(value, foldMonth)) ?? emptyLedger();

  const record: YearRecord = {
    daily:
      readStored(LEGACY_DAILY_KEY, parseDates) ??
      readStored(LEGACY_DAILY_KEY_V0, parseDates) ??
      [],
    challenge: readStored(LEGACY_CHALLENGE_KEY, parseWeeks) ?? [],
    monthly,
    injected: monthly.flatMap((month, index) => (isMonthFunded(month) ? [index] : [])),
  };

  return isEmptyRecord(record) ? {} : { [String(LEGACY_YEAR)]: record };
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

/** Label/value pair used for the year's fixed parameters and header breakdown. */
function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
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

/** Inline marker on a panel whose data belongs to a year that has closed. */
function ArchivePill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      <Lock className="h-3 w-3" />
      Read-only
    </span>
  );
}

/**
 * The full-width control at the top of the two tabs that can be acted on: the
 * daily log and the monthly payday drop. Both had the same hand-rolled class
 * block; going through the shadcn Button gives them the coarse-pointer touch
 * floor and one definition of the emerald treatment.
 *
 * `whitespace-normal` undoes the Button's `nowrap`, and `h-auto min-h-16`
 * replaces its fixed height so a wrapped label has somewhere to go — these
 * labels carry a month name and a formatted amount, and "Inject September
 * Allocation ($195.00)" is wider than a small phone at this font size.
 *
 * The disabled treatment is a full-opacity swap to a flat card rather than the
 * Button's default 50% fade, which on the daily tab has to read as "already
 * logged" rather than as "unavailable".
 */
function PrimaryAction({
  icon,
  label,
  disabled,
  onClick,
  ariaLabel,
}: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'h-auto min-h-16 w-full gap-2 rounded-xl px-5 py-4 text-sm font-semibold whitespace-normal',
        'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 active:scale-[0.99]',
        'focus-visible:border-emerald-500 focus-visible:ring-emerald-500/40',
        'disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-100',
        'disabled:border-border disabled:bg-card disabled:text-muted-foreground',
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

/**
 * Stands in for a tab's primary action while a past year is open. Matches the
 * button's height so switching years never shifts the panel below it.
 */
function ArchiveNotice({ year }: { year: number }) {
  return (
    <div className="flex min-h-[64px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-5 py-4 text-sm font-medium text-muted-foreground">
      <History className="h-4 w-4" />
      Viewing the {year} archive — check-ins are locked.
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Archive year switcher                          */
/* -------------------------------------------------------------------------- */

/* Shared by both dropdowns so the skeleton and the live trigger cannot drift. */
const SWITCHER_CLASS =
  'h-9 gap-2 rounded-lg border-border bg-muted/40 px-3 text-sm font-medium text-foreground hover:bg-muted/60 dark:bg-muted/40 dark:hover:bg-muted/60';

/**
 * Holds a switcher's box while its value is still unknown. Same height, border
 * and padding as the real trigger, and a fixed width, so the swap at mount
 * moves nothing around it.
 */
function SwitcherSkeleton({ icon, className }: { icon: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(SWITCHER_CLASS, 'flex items-center text-muted-foreground', className)}
    >
      {icon}
      {PLACEHOLDER}
      <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
    </span>
  );
}

type YearSwitcherProps = {
  years: readonly number[];
  activeYear: number;
  currentYear: number;
  onChange: (year: number) => void;
};

function YearSwitcher({ years, activeYear, currentYear, onChange }: YearSwitcherProps) {
  return (
    <Select value={String(activeYear)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger
        size="default"
        aria-label="Tracked year"
        className={cn(SWITCHER_CLASS, 'tabular-nums')}
      >
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((year) => (
          <SelectItem key={year} value={String(year)} className="tabular-nums">
            {year}
            <span className="text-xs text-muted-foreground">
              {year === currentYear ? 'Current' : 'Archive'}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Allocation month picker                         */
/* -------------------------------------------------------------------------- */

type MonthSwitcherProps = {
  month: number;
  /** Highest selectable month — later ones have not happened yet. */
  maxMonth: number;
  onChange: (month: number) => void;
};

function MonthSwitcher({ month, maxMonth, onChange }: MonthSwitcherProps) {
  return (
    <Select value={String(month)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger
        size="default"
        aria-label="Allocation month"
        className={SWITCHER_CLASS}
      >
        <CalendarRange className="h-4 w-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MONTH_NAMES.map((name, index) => (
          <SelectItem
            key={name}
            value={String(index)}
            // A month the calendar has not reached is offered but not choosable,
            // so the full year stays visible without inviting a future deposit.
            disabled={index > maxMonth}
          >
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/*                      Tab A — daily micro-habit strategy                    */
/* -------------------------------------------------------------------------- */

type DailyPanelProps = {
  mounted: boolean;
  shape: YearShape;
  readOnly: boolean;
  today: string;
  logged: Set<string>;
  onMarkToday: () => void;
  onToggleDate: (iso: string) => void;
};

function DailyPanel({
  mounted,
  shape,
  readOnly,
  today,
  logged,
  onMarkToday,
  onToggleDate,
}: DailyPanelProps) {
  const count = logged.size;
  const saved = count * DAILY_AMOUNT;
  const remainingDays = shape.totalDays - count;
  const streak = useMemo(
    () => (today ? computeDayStreak(shape, logged, today) : 0),
    [shape, logged, today],
  );

  const todayInRange = shape.validDates.has(today);
  const todayLogged = todayInRange && logged.has(today);
  const canLog = mounted && !readOnly && todayInRange && !todayLogged;

  /* Pre-mount `shape` is the stand-in, whose year is a fixed constant and must
     never be printed. Day counts and totals derived from it are deterministic
     on both sides of hydration, so those stay. */
  const yearLabel = mounted ? `${shape.year}` : PLACEHOLDER;

  const buttonLabel = (() => {
    // Before mount the stored state is unknown, so show the neutral call to
    // action rather than guessing and swapping it a frame later.
    if (!mounted) return `Mark ${formatMoney(DAILY_AMOUNT)} Saved Today`;
    if (!todayInRange) return `Outside the ${shape.year} Track`;
    if (todayLogged) return 'Logged for Today';
    return `Mark ${formatMoney(DAILY_AMOUNT)} Saved Today`;
  })();

  return (
    <div className="flex flex-col gap-5">
      {/* Primary action, or the archive marker that replaces it */}
      {readOnly ? (
        <ArchiveNotice year={shape.year} />
      ) : (
        <PrimaryAction
          onClick={onMarkToday}
          disabled={!canLog}
          icon={
            mounted && todayLogged ? <Check className="h-4 w-4" /> : <Wallet className="h-4 w-4" />
          }
          label={buttonLabel}
        />
      )}

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
              {formatMoney(shape.dailyTarget)}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <ProgressBar
            percent={(count / shape.totalDays) * 100}
            label="Daily habit progress"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">
              {((count / shape.totalDays) * 100).toFixed(1)}% complete
            </span>
            <span className="tabular-nums">
              {count} / {shape.totalDays} days
            </span>
          </div>
        </div>

        {/* Parameters for the year on screen — 366 days in a leap year */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatLine label="Start" value={mounted ? shape.startISO : PLACEHOLDER} />
          <StatLine label="End" value={mounted ? shape.endISO : PLACEHOLDER} />
          <StatLine label="Total Days" value={`${shape.totalDays}`} />
          <StatLine label="Target" value={formatMoney(shape.dailyTarget)} />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard
            icon={<Flame className="h-4 w-4" />}
            label={readOnly ? 'Final Streak' : 'Current Streak'}
            value={`${streak} ${streak === 1 ? 'day' : 'days'}`}
            hint={
              readOnly
                ? `${yearLabel} archive`
                : streak > 0
                  ? 'Keep it alive'
                  : 'Log today to start'
            }
            accent={streak > 0}
          />
          <MetricCard
            icon={<CalendarCheck2 className="h-4 w-4" />}
            label="Days Logged"
            value={`${count}`}
            hint={`of ${shape.totalDays} days`}
          />
          <MetricCard
            icon={<CalendarDays className="h-4 w-4" />}
            label={readOnly ? 'Days Missed' : 'Days Remaining'}
            value={`${remainingDays}`}
            hint={`${formatMoney(remainingDays * DAILY_AMOUNT)} ${readOnly ? 'unsaved' : 'to go'}`}
          />
        </div>
      </Panel>

      {/* Contribution matrix — 12 month columns, one cell per day of the year */}
      <Panel>
        <PanelHeading
          icon={<Target className="h-4 w-4" />}
          title={`${yearLabel} Contribution Matrix`}
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {readOnly ? <ArchivePill /> : null}
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
            {shape.datesByMonth.map((monthDates, monthIndex) => (
              <div key={MONTH_LABELS[monthIndex]} className="flex flex-col items-center">
                <span className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {MONTH_LABELS[monthIndex]}
                </span>
                <div className="flex flex-col gap-[3px]">
                  {Array.from({ length: shape.maxMonthLength }).map((_, dayIndex) => {
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
                    // editable, which keeps the SSR markup identical. A closed
                    // year is never editable, however far in the past it is.
                    const isEditable = mounted && !readOnly && today !== '' && iso <= today;

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
          {readOnly
            ? `${yearLabel} has closed — every day is shown exactly as it was logged.`
            : 'Click any past day to correct it. Future days stay locked.'}
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
  shape: YearShape;
  readOnly: boolean;
  today: string;
  completed: Set<number>;
  saved: number;
  onToggleWeek: (week: number) => void;
};

function ChallengePanel({
  mounted,
  shape,
  readOnly,
  today,
  completed,
  saved,
  onToggleWeek,
}: ChallengePanelProps) {
  const streak = useMemo(() => computeWeekStreak(completed), [completed]);
  const remaining = CHALLENGE_TARGET - saved;
  const percent = (saved / CHALLENGE_TARGET) * 100;

  /* How far the ladder has opened. Week starts are ascending, so the count of
     weeks already begun is also the highest checkable week number. A closed
     year opens nothing; before mount `today` is '' and nothing opens either. */
  const openWeeks = useMemo(() => {
    if (!mounted || readOnly || today === '') return 0;
    let opened = 0;
    for (const week of ALL_WEEKS) {
      if (weekStartISO(shape, week) <= today) opened += 1;
    }
    return opened;
  }, [mounted, readOnly, today, shape]);

  /* A rung's opening date is only nameable once the real year is in hand: an
     archive has no opening date left to wait for, and before mount the year
     itself is a stand-in. */
  const showOpensOn = mounted && !readOnly;
  const yearLabel = mounted ? `${shape.year}` : PLACEHOLDER;

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
            label={readOnly ? 'Final Streak' : 'Current Streak'}
            value={`${streak} ${streak === 1 ? 'week' : 'weeks'}`}
            hint={
              readOnly
                ? `${yearLabel} archive`
                : streak > 0
                  ? 'Ladder is climbing'
                  : 'Check a week to start'
            }
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
          <div className="flex items-center gap-2">
            {readOnly ? <ArchivePill /> : null}
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatMoney(weekAmount(1))} → {formatMoney(weekAmount(TOTAL_WEEKS))}
            </span>
          </div>
        </PanelHeading>

        <div className="mt-5 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {ALL_WEEKS.map((week) => {
            const amount = weekAmount(week);
            // Before mount nothing reads as complete, so server and client agree.
            const isDone = mounted && completed.has(week);
            const isOpen = week <= openWeeks;
            const opensOn = weekStartISO(shape, week);

            const label = `Week ${week} — ${formatMoney(amount)} — ${
              isDone ? 'completed' : 'not completed'
            }`;
            const appearance = cn(
              'flex min-h-[62px] flex-col items-center justify-center gap-0.5 rounded-lg border transition-all duration-200',
              isDone
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
                : 'border-border bg-muted/40 text-muted-foreground',
            );
            const body = (
              <>
                <span className="text-[10px] font-medium uppercase tracking-wider">
                  W{week}
                </span>
                <span className="text-sm font-semibold tabular-nums">${amount}</span>
              </>
            );

            // A week that has not begun — or any week of a closed year — is
            // rendered flat, matching how the daily matrix locks future days.
            if (!isOpen) {
              return (
                <div
                  key={week}
                  title={
                    showOpensOn
                      ? `Week ${week} · ${formatMoney(amount)} · opens ${formatLongDate(opensOn)}`
                      : `Week ${week} · ${formatMoney(amount)}`
                  }
                  aria-label={label}
                  className={cn(appearance, !isDone && 'opacity-60')}
                >
                  {body}
                </div>
              );
            }

            return (
              <button
                key={week}
                type="button"
                onClick={() => onToggleWeek(week)}
                aria-pressed={isDone}
                aria-label={label}
                title={`Week ${week} · ${formatMoney(amount)}`}
                className={cn(
                  appearance,
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 active:scale-[0.97]',
                  !isDone && 'hover:border-muted-foreground/40 hover:text-foreground',
                )}
              >
                {body}
              </button>
            );
          })}
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          {readOnly
            ? `${yearLabel} has closed — the ladder is shown exactly as it was checked off.`
            : 'Weeks unlock on the Monday-equivalent day they begin. Future rungs stay locked.'}
        </p>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                  Tab C — monthly target allocation buckets                 */
/* -------------------------------------------------------------------------- */

type BucketsPanelProps = {
  mounted: boolean;
  year: number;
  readOnly: boolean;
  /** Month on screen, 0 = January. */
  month: number;
  /** Highest month the calendar has reached for this year. */
  maxMonth: number;
  onMonthChange: (month: number) => void;
  /** Balances for `month` alone. */
  balances: BucketBalances;
  monthSaved: number;
  /** All twelve months together, for context under the month figure. */
  yearSaved: number;
  /** Whether `month` has already taken its one payday drop. */
  injected: boolean;
  onFund: (id: BucketId) => void;
  onReset: (id: BucketId) => void;
  onPayday: () => void;
};

function BucketsPanel({
  mounted,
  year,
  readOnly,
  month,
  maxMonth,
  onMonthChange,
  balances,
  monthSaved,
  yearSaved,
  injected,
  onFund,
  onReset,
  onPayday,
}: BucketsPanelProps) {
  /* Both the month and the year are clock-derived, so neither can be named
     until mount — a statically built page would otherwise ship the build's
     month and disagree with the browser from the next month onwards. */
  const monthName = mounted ? MONTH_NAMES[month] : PLACEHOLDER;
  const monthAbbr = mounted ? MONTH_LABELS[month] : PLACEHOLDER;
  const yearLabel = mounted ? `${year}` : PLACEHOLDER;

  return (
    <div className="flex flex-col gap-5">
      {/* Which month the whole tab is pointed at */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Layers className="h-4 w-4 text-muted-foreground" />
          Monthly
          <span className="text-muted-foreground">· {monthName} {yearLabel}</span>
        </h2>
        {mounted ? (
          <MonthSwitcher month={month} maxMonth={maxMonth} onChange={onMonthChange} />
        ) : (
          <SwitcherSkeleton
            icon={<CalendarRange className="h-4 w-4 text-muted-foreground" />}
            className="w-[9.5rem]"
          />
        )}
      </div>

      {/* Master allocation trigger, or the archive marker that replaces it */}
      {readOnly ? (
        <ArchiveNotice year={year} />
      ) : (
        <PrimaryAction
          onClick={onPayday}
          // Held shut until mount, like the daily button: before that the month
          // it would file the drop against has not been named yet.
          disabled={!mounted || injected}
          ariaLabel={
            injected
              ? `${monthName} payday allocation already applied`
              : `Inject the ${monthName} payday allocation of ${formatMoney(PAYDAY_TOTAL)}`
          }
          icon={injected ? <Check className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
          label={
            injected
              ? `${monthName} Allocation Applied`
              : `Inject ${monthName} Allocation (${formatMoney(PAYDAY_TOTAL)})`
          }
        />
      )}

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Monthly Balance
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-4xl">
              {formatMoney(monthSaved)}
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
            percent={(monthSaved / PAYDAY_TOTAL) * 100}
            label={`${monthName} bucket allocation progress`}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {readOnly
              ? `Closing balances carried by the ${monthName} ${yearLabel} buckets.`
              : injected
                ? `${monthName} has taken its allocation — one payday drop per month.`
                : "One tap distributes each bucket's fixed baseline quota in a single concurrent drop."}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatLine label={`${monthAbbr} Saved`} value={formatMoney(monthSaved)} />
          <StatLine label={`${yearLabel} To Date`} value={formatMoney(yearSaved)} />
          <StatLine
            label="Yearly Quota"
            value={formatMoney(PAYDAY_TOTAL * MONTHS_PER_YEAR)}
          />
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

              {/* Per-bucket controls — hidden once the year closes.
                  The pair is deliberately not a stepper: a bucket is either
                  settled for the month or it is not, so the two actions are
                  "meet the quota" and "clear the month". */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {percent.toFixed(0)}% of target
                </span>
                {readOnly ? (
                  <ArchivePill />
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onReset(id)}
                      disabled={!mounted || balance <= 0}
                      aria-label={`Clear ${label} for ${monthName}`}
                      title={`Clear ${label} back to ${formatMoney(0)}`}
                      className="h-9 gap-1.5 border-border bg-muted/50 px-3 text-xs text-foreground/80 hover:border-muted-foreground/40 hover:bg-muted/50 hover:text-foreground focus-visible:ring-emerald-400/40 disabled:opacity-40 dark:bg-muted/50 dark:hover:bg-muted/50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </Button>
                    <Button
                      type="button"
                      onClick={() => onFund(id)}
                      disabled={!mounted || funded}
                      aria-label={`Mark ${label} funded for ${monthName}`}
                      title={`Fund ${label} to its ${formatMoney(target)} quota`}
                      className="h-9 gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-3 text-xs text-emerald-600 hover:bg-emerald-500/20 focus-visible:ring-emerald-400/40 disabled:opacity-40 dark:border-emerald-500/30 dark:text-emerald-400"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Done
                    </Button>
                  </div>
                )}
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

/* Plausible opening values, not a source of truth. This module is evaluated at
   build time for the prerender, so these can be a year or more out of date —
   nothing derived from them reaches the markup before `mounted`, and the mount
   effect replaces all four from the browser's own clock. */
const BOOTSTRAP_NOW = new Date();
const BOOTSTRAP_YEAR = BOOTSTRAP_NOW.getFullYear();
const BOOTSTRAP_MONTH = BOOTSTRAP_NOW.getMonth();

export default function SavingsPage() {
  /* Gate on `mounted` so the server render and the hydrating client render are
     byte-identical: stored values are only read afterwards, which rules out the
     flash of a wrong total that reading storage during render would cause. */
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<TabId>('daily');

  const [vault, setVault] = useState<Vault>({});
  const [currentYear, setCurrentYear] = useState(BOOTSTRAP_YEAR);
  const [activeYear, setActiveYear] = useState(BOOTSTRAP_YEAR);
  const [today, setToday] = useState<string>('');
  /* The real calendar month, and the one the Monthly tab is pointed at. They
     start equal, and the picker only ever moves the second one backwards. */
  const [currentMonth, setCurrentMonth] = useState(BOOTSTRAP_MONTH);
  const [activeMonth, setActiveMonth] = useState(BOOTSTRAP_MONTH);

  useEffect(() => {
    const now = new Date();
    const todayISO = toISODate(now);
    const year = now.getFullYear();
    const month = now.getMonth();

    const stored =
      readStored(VAULT_KEY, makeVaultParser(year, month)) ?? migrateLegacyVault(year, month);

    // Saving began on 2026-01-01, before this tracker existed. On the very first
    // visit, backfill every day of that year through today so the app matches
    // the real deposit history. Runs once — see SEED_KEY.
    if (hasSeeded()) {
      setVault(stored);
    } else {
      const key = String(LEGACY_YEAR);
      const record = stored[key] ?? emptyRecord();
      const backfilled = datesThrough(getYearShape(LEGACY_YEAR), todayISO);
      setVault({
        ...stored,
        [key]: {
          ...record,
          daily: Array.from(new Set([...record.daily, ...backfilled])).sort(),
        },
      });
    }

    setCurrentYear(year);
    setActiveYear(year);
    setCurrentMonth(month);
    setActiveMonth(month);
    setToday(todayISO);
    setMounted(true);
  }, []);

  /* Persist only after hydration, otherwise the empty initial state would
     overwrite whatever is already stored. The seed flag is written from the same
     effect as the vault so a backfill and its marker land together. */
  useEffect(() => {
    if (!mounted) return;
    writeStored(VAULT_KEY, vault);
    try {
      window.localStorage.setItem(SEED_KEY, '1');
    } catch {
      // Non-fatal: the seed still applies to this session.
    }
  }, [vault, mounted]);

  /* ---------------------------- Active year view --------------------------- */

  const activeKey = String(activeYear);
  /* The real calendar of the selected year, which every action is checked
     against, and the geometry the panels draw — the stand-in until the clock
     has actually been read. */
  const activeShape = useMemo(() => getYearShape(activeYear), [activeYear]);
  const shape = mounted ? activeShape : SKELETON_SHAPE;
  /* Anything that is not the year the clock is in is history: the panels render
     it in full but refuse every check-in. */
  const readOnly = activeYear !== currentYear;

  const record = vault[activeKey] ?? EMPTY_RECORD;

  /* Highest month that can hold an allocation for the year on screen. The picker
     stops here, and every write is checked against it, so a deposit can never be
     filed against a month the calendar has not reached. */
  const maxMonth = lastOpenMonth(activeYear, currentYear, currentMonth);
  const monthLocked = readOnly || activeMonth > maxMonth;

  /** Years held in the vault plus the live one, newest first. */
  const years = useMemo(() => {
    const found = new Set<number>([currentYear]);
    for (const key of Object.keys(vault)) {
      const year = parseYearKey(key);
      if (year !== null) found.add(year);
    }
    return Array.from(found).sort((a, b) => b - a);
  }, [vault, currentYear]);

  const loggedSet = useMemo(() => new Set(record.daily), [record.daily]);
  const weekSet = useMemo(() => new Set(record.challenge), [record.challenge]);

  /* ------------------------------ Aggregates ----------------------------- */

  const dailySaved = record.daily.length * DAILY_AMOUNT;
  const challengeSaved = useMemo(
    () => record.challenge.reduce((sum, week) => sum + weekAmount(week), 0),
    [record.challenge],
  );
  /* The whole year for the header, the picked month for the tab. */
  const bucketsSaved = useMemo(() => ledgerTotal(record.monthly), [record.monthly]);
  const monthBalances = record.monthly[activeMonth] ?? EMPTY_BALANCES;
  const monthSaved = useMemo(() => bucketsTotal(monthBalances), [monthBalances]);
  const netWealth = dailySaved + challengeSaved + bucketsSaved;
  const yearTarget = combinedTarget(shape);

  /* ------------------------------- Actions ------------------------------- */

  /* Single write path into the vault. Untouched years are carried through by
     reference, so editing 2027 can never rewrite 2026. */
  const updateActiveYear = useCallback(
    (mutate: (record: YearRecord) => YearRecord) => {
      if (readOnly) return;
      setVault((prev) => {
        const current = prev[activeKey] ?? emptyRecord();
        const next = mutate(current);
        // A mutation that declines to change anything — a second payday drop on
        // a month that already had one — leaves the vault identity untouched,
        // so it triggers neither a re-render nor a write.
        return next === current ? prev : { ...prev, [activeKey]: next };
      });
    },
    [activeKey, readOnly],
  );

  const markToday = useCallback(() => {
    if (!activeShape.validDates.has(today)) return;
    updateActiveYear((record) => ({
      ...record,
      daily: record.daily.includes(today) ? record.daily : [...record.daily, today].sort(),
    }));
  }, [activeShape, today, updateActiveYear]);

  // Correcting history: a backfilled day that was actually missed can be
  // unchecked, and a forgotten one checked. Future days stay untouchable.
  const toggleDate = useCallback(
    (iso: string) => {
      if (!activeShape.validDates.has(iso) || today === '' || iso > today) return;
      updateActiveYear((record) => ({
        ...record,
        daily: record.daily.includes(iso)
          ? record.daily.filter((entry) => entry !== iso)
          : [...record.daily, iso].sort(),
      }));
    },
    [activeShape, today, updateActiveYear],
  );

  const toggleWeek = useCallback(
    (week: number) => {
      // A rung that has not opened yet cannot be checked, mirroring the matrix.
      if (today === '' || weekStartISO(activeShape, week) > today) return;
      updateActiveYear((record) => ({
        ...record,
        challenge: record.challenge.includes(week)
          ? record.challenge.filter((entry) => entry !== week)
          : [...record.challenge, week].sort((a, b) => a - b),
      }));
    },
    [activeShape, today, updateActiveYear],
  );

  /** Settle one bucket for the picked month by topping it up to its quota. */
  const fundBucket = useCallback(
    (id: BucketId) => {
      if (monthLocked) return;
      updateActiveYear((record) => {
        const balance = record.monthly[activeMonth][id];
        // A month migrated in above its quota keeps the excess rather than
        // being trimmed back down to the baseline.
        if (balance >= BUCKET_TARGET[id]) return record;
        return {
          ...record,
          monthly: writeMonth(record.monthly, activeMonth, (month) => ({
            ...month,
            [id]: BUCKET_TARGET[id],
          })),
        };
      });
    },
    [activeMonth, monthLocked, updateActiveYear],
  );

  /** Clear one bucket for the picked month, undoing a mistaken entry. */
  const resetBucket = useCallback(
    (id: BucketId) => {
      if (monthLocked) return;
      updateActiveYear((record) => {
        if (record.monthly[activeMonth][id] === 0) return record;
        const monthly = writeMonth(record.monthly, activeMonth, (month) => ({
          ...month,
          [id]: 0,
        }));
        // Emptying the last bucket reopens the month for a fresh payday drop;
        // without this, a month reset by hand could never be re-allocated.
        const reopened = bucketsTotal(monthly[activeMonth]) === 0;
        return {
          ...record,
          monthly,
          injected: reopened
            ? record.injected.filter((entry) => entry !== activeMonth)
            : record.injected,
        };
      });
    },
    [activeMonth, monthLocked, updateActiveYear],
  );

  const injectPayday = useCallback(() => {
    if (monthLocked) return;
    updateActiveYear((record) => {
      // One drop per calendar month. Returning the record untouched is what
      // makes a second tap — or a double-click — a no-op rather than a doubling.
      if (record.injected.includes(activeMonth)) return record;
      return {
        ...record,
        monthly: writeMonth(record.monthly, activeMonth, (month) => {
          const next = emptyBuckets();
          for (const bucket of BUCKET_DEFS) {
            next[bucket.id] = month[bucket.id] + bucket.target;
          }
          return next;
        }),
        injected: [...record.injected, activeMonth].sort((a, b) => a - b),
      };
    });
  }, [activeMonth, monthLocked, updateActiveYear]);

  /* Switching year re-points the month picker at that year's last open month,
     so an archive opens on December and the live year on the current month. */
  const changeYear = useCallback(
    (year: number) => {
      setActiveYear(year);
      setActiveMonth(lastOpenMonth(year, currentYear, currentMonth));
    },
    [currentYear, currentMonth],
  );

  const changeMonth = useCallback(
    (month: number) => {
      if (month < 0 || month > maxMonth) return;
      setActiveMonth(month);
    },
    [maxMonth],
  );

  return (
    <main className="min-h-screen bg-background px-4 pb-10 pt-4 text-foreground antialiased sm:px-6 sm:pb-14 sm:pt-4">
      <div className="mx-auto w-full max-w-3xl">
        {/* Global aggregate header. Sticky so the running total stays in view
            while the day/week/bucket lists scroll underneath it — the number
            that matters most is the one you'd otherwise scroll away from. */}
        <header className="sticky top-0 z-30 -mx-4 bg-background/95 px-4 pb-5 pt-6 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Multi-Strategy Savings
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            {/* Clipped-text gradient has to be stated per palette: the dark ramp
                would be invisible against a light background. */}
            <h1 className="bg-gradient-to-r from-zinc-900 via-zinc-700 to-emerald-600 bg-clip-text text-4xl font-semibold tracking-tight text-transparent dark:from-white dark:via-zinc-200 dark:to-emerald-300 sm:text-5xl">
              Apsara Save
            </h1>
            {mounted ? (
              <YearSwitcher
                years={years}
                activeYear={activeYear}
                currentYear={currentYear}
                onChange={changeYear}
              />
            ) : (
              <SwitcherSkeleton
                icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
                className="w-[7rem]"
              />
            )}
          </div>

          <div className="mt-7 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Coins className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Net Wealth Saved · {mounted ? activeYear : PLACEHOLDER}
                </p>
                <p className="mt-1.5 text-4xl font-semibold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 sm:text-5xl">
                  {formatMoney(netWealth)}
                </p>
              </div>
              <div className="text-right">
                <p className="flex items-center justify-end gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {readOnly ? <ArchivePill /> : null}
                  Combined Target
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground/80">
                  {formatMoney(yearTarget)}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <ProgressBar
                percent={(netWealth / yearTarget) * 100}
                label="Net wealth progress"
              />
            </div>

            {/* Breakdown of the three contributing strategies */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              <StatLine label="Daily $1.25" value={formatMoney(dailySaved)} />
              <StatLine label="52-Week" value={formatMoney(challengeSaved)} />
              <StatLine label="Monthly" value={formatMoney(bucketsSaved)} />
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
              shape={shape}
              readOnly={readOnly}
              today={today}
              logged={loggedSet}
              onMarkToday={markToday}
              onToggleDate={toggleDate}
            />
          </TabsContent>

          <TabsContent value="weekly">
            <ChallengePanel
              mounted={mounted}
              shape={shape}
              readOnly={readOnly}
              today={today}
              completed={weekSet}
              saved={challengeSaved}
              onToggleWeek={toggleWeek}
            />
          </TabsContent>

          <TabsContent value="monthly">
            <BucketsPanel
              mounted={mounted}
              year={activeYear}
              readOnly={readOnly}
              month={activeMonth}
              maxMonth={maxMonth}
              onMonthChange={changeMonth}
              balances={monthBalances}
              monthSaved={monthSaved}
              yearSaved={bucketsSaved}
              injected={record.injected.includes(activeMonth)}
              onFund={fundBucket}
              onReset={resetBucket}
              onPayday={injectPayday}
            />
          </TabsContent>
        </Tabs>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Every year is archived locally in this browser — nothing leaves the device.
        </p>
      </div>
    </main>
  );
}
