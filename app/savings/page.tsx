'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarCheck2,
  CalendarDays,
  Check,
  Flame,
  QrCode,
  Target,
  Wallet,
  X,
} from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*                            Hardcoded boundaries                            */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'apsara_savings_2026';
const TRACK_START = '2026-01-01';
const TRACK_END = '2026-12-31';
const TOTAL_DAYS = 365;
const DAILY_AMOUNT = 1.25;
const TARGET_GOAL = TOTAL_DAYS * DAILY_AMOUNT; // 456.25

/* Destination account ("Bank B") that receives the daily transfer. */
const KHQR_IMAGE_SRC = '/khqr.png';
const DESTINATION_BANK = 'ACLEDA Bank';
const DESTINATION_NAME = 'CHREK SOPHANITH';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/* -------------------------------------------------------------------------- */
/*                              Date helpers                                  */
/*  All formatting is local-time based so the YYYY-MM-DD key never shifts     */
/*  a day due to UTC conversion.                                             */
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

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
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
function computeStreak(logged: Set<string>, today: string): number {
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

function readStoredDates(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Keep only unique, in-range date strings so stale data can never
    // inflate the totals or break the matrix.
    const clean = parsed.filter(
      (value): value is string => typeof value === 'string' && VALID_DATES.has(value),
    );
    return Array.from(new Set(clean)).sort();
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/*                              Presentational                                */
/* -------------------------------------------------------------------------- */

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
      className={[
        'flex min-h-[104px] flex-col justify-between rounded-xl border p-4 transition-colors duration-300',
        accent
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 text-zinc-400">
        <span className={accent ? 'text-emerald-400' : 'text-zinc-500'}>{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div>
        <p
          className={[
            'text-2xl font-semibold tabular-nums tracking-tight',
            accent ? 'text-emerald-400' : 'text-zinc-100',
          ].join(' ')}
        >
          {value}
        </p>
        {hint ? <p className="mt-0.5 text-xs text-zinc-500">{hint}</p> : null}
      </div>
    </div>
  );
}

type KhqrDialogProps = {
  open: boolean;
  onClose: () => void;
};

function KhqrDialog({ open, onClose }: KhqrDialogProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="khqr-dialog-title"
    >
      <div
        className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>

        <h2
          id="khqr-dialog-title"
          className="text-lg font-semibold tracking-tight text-zinc-100"
        >
          Transfer {formatMoney(DAILY_AMOUNT)}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Scan with your sending bank app, then log the day below.
        </p>

        {/*
          Deliberately a plain <img>, not next/image: the optimizer re-encodes and
          can soften the QR modules, which hurts scan reliability. This serves the
          exact original pixels. Drop the poster at public/khqr.png.
        */}
        {imageFailed ? (
          <div className="mt-5 flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-6 text-center">
            <QrCode className="h-14 w-14 text-zinc-600" />
            <p className="text-sm font-medium text-zinc-400">QR image not found</p>
            <p className="text-xs leading-relaxed text-zinc-500">
              Save your KHQR poster to
              <br />
              <code className="text-zinc-400">public/khqr.png</code>
            </p>
          </div>
        ) : (
          <a
            href={KHQR_IMAGE_SRC}
            target="_blank"
            rel="noreferrer"
            title="Open full size"
            className="mt-5 block overflow-hidden rounded-xl bg-white ring-1 ring-zinc-800 transition-opacity hover:opacity-95"
          >
            {/* Fixed aspect box reserves the space so the dialog never jumps as
                the image decodes. object-contain keeps a square crop valid too. */}
            <img
              src={KHQR_IMAGE_SRC}
              alt={`KHQR code for ${DESTINATION_NAME} at ${DESTINATION_BANK}`}
              className="aspect-[1/1.414] w-full object-contain"
              onError={() => setImageFailed(true)}
            />
          </a>
        )}

        <dl className="mt-5 divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-500">To</dt>
            <dd className="text-sm font-medium text-zinc-200">{DESTINATION_NAME}</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-500">Bank</dt>
            <dd className="text-sm text-zinc-300">{DESTINATION_BANK}</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-xs uppercase tracking-wider text-zinc-500">Amount</dt>
            <dd className="text-sm font-semibold tabular-nums text-emerald-400">
              {formatMoney(DAILY_AMOUNT)}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-center text-xs leading-relaxed text-zinc-500">
          Static KHQR carries no preset amount — enter{' '}
          <span className="font-medium text-zinc-400">{formatMoney(DAILY_AMOUNT)}</span>{' '}
          manually in your banking app.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Page                                     */
/* -------------------------------------------------------------------------- */

export default function SavingsPage() {
  const [mounted, setMounted] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [today, setToday] = useState<string>('');
  const [qrOpen, setQrOpen] = useState(false);

  // Read browser-only values after the first paint so the server HTML and the
  // initial client render stay byte-identical.
  useEffect(() => {
    setToday(toISODate(new Date()));
    setCompleted(readStoredDates());
    setMounted(true);
  }, []);

  // Persist only after hydration, otherwise the empty initial state would
  // overwrite whatever is already stored.
  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
    } catch {
      // Storage unavailable (private mode / quota) — keep the session in memory.
    }
  }, [completed, mounted]);

  const loggedSet = useMemo(() => new Set(completed), [completed]);

  const totalSaved = completed.length * DAILY_AMOUNT;
  const progress = Math.min(100, (completed.length / TOTAL_DAYS) * 100);
  const remainingDays = TOTAL_DAYS - completed.length;
  const streak = useMemo(
    () => (today ? computeStreak(loggedSet, today) : 0),
    [loggedSet, today],
  );

  const todayInRange = VALID_DATES.has(today);
  const todayLogged = todayInRange && loggedSet.has(today);
  const canLog = mounted && todayInRange && !todayLogged;

  const markToday = useCallback(() => {
    if (!todayInRange) return;
    setCompleted((prev) => (prev.includes(today) ? prev : [...prev, today].sort()));
  }, [today, todayInRange]);

  const buttonLabel = (() => {
    if (!mounted) return 'Mark $1.25 Saved';
    if (!todayInRange) return 'Outside 2026 Track';
    if (todayLogged) return 'Logged for Today';
    return `Mark ${formatMoney(DAILY_AMOUNT)} Saved`;
  })();

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100 antialiased sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
            Daily Saving Tracker
          </p>
          <h1 className="mt-2 bg-gradient-to-r from-white via-zinc-200 to-emerald-300 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
            Apsara Save
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            {formatMoney(DAILY_AMOUNT)} a day, every day of 2026 —{' '}
            <span className="text-zinc-300">{formatLongDate(TRACK_START)}</span> to{' '}
            <span className="text-zinc-300">{formatLongDate(TRACK_END)}</span>.
          </p>
        </header>

        {/* Scoreboard */}
        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Total Saved
              </p>
              <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-emerald-400 sm:text-5xl">
                {formatMoney(totalSaved)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Target Goal
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-zinc-300">
                {formatMoney(TARGET_GOAL)}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-5">
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label="Savings progress"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
              <span className="tabular-nums">{progress.toFixed(1)}% complete</span>
              <span className="tabular-nums">
                {completed.length} / {TOTAL_DAYS} days
              </span>
            </div>
          </div>

          {/* Metrics */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              value={`${completed.length}`}
              hint={`of ${TOTAL_DAYS} days`}
            />
            <MetricCard
              icon={<CalendarDays className="h-4 w-4" />}
              label="Days Remaining"
              value={`${remainingDays}`}
              hint={`${formatMoney(remainingDays * DAILY_AMOUNT)} to go`}
            />
          </div>
        </section>

        {/* Action grid */}
        <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="flex min-h-[64px] items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4 text-sm font-medium text-zinc-200 transition-colors duration-200 hover:border-zinc-700 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <QrCode className="h-4 w-4 text-zinc-400" />
            Transfer via KHQR
          </button>

          <button
            type="button"
            onClick={markToday}
            disabled={!canLog}
            className={[
              'flex min-h-[64px] items-center justify-center gap-2 rounded-xl px-5 py-4 text-sm font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 sm:col-span-2',
              canLog
                ? 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 active:scale-[0.99]'
                : 'cursor-not-allowed border border-zinc-800 bg-zinc-900 text-zinc-500',
            ].join(' ')}
          >
            {mounted && todayLogged ? (
              <Check className="h-4 w-4" />
            ) : (
              <Wallet className="h-4 w-4" />
            )}
            {buttonLabel}
          </button>
        </section>

        {/* 365-day contribution matrix — 12 month columns */}
        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <Target className="h-4 w-4 text-zinc-500" />
              2026 Contribution Matrix
            </h2>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-zinc-800" />
              <span>Empty</span>
              <span className="ml-1 h-2.5 w-2.5 rounded-[2px] bg-emerald-500" />
              <span>Saved</span>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto pb-1">
            {/* Fixed cell sizing + fixed row count keeps the grid height stable
                across every render, so hydration causes no layout shift. */}
            <div className="mx-auto grid w-fit grid-cols-12 gap-x-3">
              {DATES_BY_MONTH.map((monthDates, monthIndex) => (
                <div key={MONTH_LABELS[monthIndex]} className="flex flex-col items-center">
                  <span className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
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

                      const isLogged = loggedSet.has(iso);
                      const isToday = iso === today;

                      return (
                        <span
                          key={iso}
                          title={`${formatLongDate(iso)} — ${
                            isLogged ? formatMoney(DAILY_AMOUNT) + ' saved' : 'not logged'
                          }`}
                          className={[
                            'h-2.5 w-2.5 rounded-[2px] transition-colors duration-300',
                            isLogged ? 'bg-emerald-500' : 'bg-zinc-800',
                            isToday ? 'ring-1 ring-emerald-300/70 ring-offset-1 ring-offset-zinc-900' : '',
                          ].join(' ')}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-zinc-600">
          Progress is stored locally in this browser.
        </p>
      </div>

      <KhqrDialog open={qrOpen} onClose={() => setQrOpen(false)} />
    </main>
  );
}
