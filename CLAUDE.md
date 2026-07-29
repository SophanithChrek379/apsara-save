# Apsara Save

A multi-strategy savings tracker. One page, three strategies, no backend: a daily
$1.25 habit, a 52-week escalating ladder, and monthly sinking-fund buckets.

## Stack

- **Framework** — Next.js 16.2 (App Router, Turbopack)
- **Runtime** — React 19.2
- **Language** — TypeScript 5.9, `strict: true`
- **Styling** — Tailwind CSS v4, CSS-first: **no `tailwind.config`**
- **Components** — shadcn/ui, style `radix-nova`, baseColor `neutral`
- **Icons** — lucide-react
- **Alias** — `@/*` resolves to the repo root

## Layout

```text
app/layout.tsx        Root layout, metadata, viewport, pre-paint theme script
app/page.tsx          Redirects to /savings
app/savings/page.tsx  The whole tracker (~1950 lines, single client component)
app/globals.css       Tailwind entry + shadcn design tokens (light + .dark)
components/ui/        shadcn primitives (button, select, tabs)
components/           App components (theme-sync)
hooks/                Shared hooks (use-system-theme)
lib/utils.ts          `cn()` — clsx + tailwind-merge
```

Every route is statically prerendered. There is no server code, no API route, and
no database.

## Commands

- `npm run dev` — dev server
- `npm run build` — production build, ~9s; also runs a full type check
- `npm run typecheck` — `tsc --noEmit`, ~2s
- `npm run start` — serve the built output
- `npm run lint` — **broken**, `next lint` was removed in Next 16 (see below)

There is no test framework installed. Verification happens through the `/qa`
gate: typecheck, build, a project-invariant audit, and a live-page smoke check.

## Invariants

These are the things a build cannot catch. Breaking one is a bug even when it
compiles.

**Dark mode is class-driven, never a media query.** `globals.css` declares
`@custom-variant dark (&:is(.dark *))`, so the dark palette only resolves under
`html.dark`. A bare `@media (prefers-color-scheme: dark)` cannot reach those
tokens. The class is applied by an inline script in `app/layout.tsx` before first
paint (avoiding a flash of the wrong palette) and maintained afterwards by
`ThemeSync`. To read the appearance in JS, use `useSystemTheme()` — do not call
`matchMedia` directly.

**Surfaces and text come from semantic tokens; the accent is emerald.** Use
`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`,
`border-border` for structure. `emerald-*` is the one sanctioned accent family
(~66 uses) — a new palette family is a smell, and `zinc` appears only in the
heading gradient in `app/savings/page.tsx:1835`. An accent used as *content*
text, border, or a decorative ring needs a `dark:` counterpart
(`text-emerald-600 dark:text-emerald-400`); solid fills that carry their own
paired foreground (`bg-emerald-500 text-emerald-950`) and `focus-visible` rings
read correctly in both palettes and do not. A raw `#hex` or inline `oklch()` in a
component is wrong in one palette — the only exceptions are the two `themeColor`
values in `app/layout.tsx`, which sit in a metadata object where CSS variables
cannot reach.

**Nothing time- or storage-dependent may run during render or module init.** The
page is prerendered at build time, so `new Date()`, `Date.now()`, and
`localStorage` reached from a render body produce markup that is stale or
mismatched on hydration. The existing code handles this deliberately: constants
like `BOOTSTRAP_YEAR` render first, a `mounted` flag gates the real values, and
everything real is read inside `useEffect`. Follow that shape.

**Persistence is validated on the way in.** `localStorage` is user-editable and
survives across app versions, so every read goes through `readStored()` with a
parser that returns `null` on anything unexpected, and every write goes through
`writeStored()`. Never `JSON.parse` storage directly, and never trust its shape.
Legacy keys (`apsara_daily_2026` and siblings) are read to seed the vault and
then left in place — deleting a user's only copy of their history is not an
acceptable trade.

**Money is formatted through `formatMoney()`** — the shared `Intl.NumberFormat`,
never `toFixed` or a template string. `toFixed` is reserved for percentages,
which is its only current use. Amounts accumulate through `reduce`, so changes to
the arithmetic should keep float behaviour in mind.

**Interactive elements carry their state in ARIA.** Day and week toggles use
`aria-pressed`, progress bars carry the full `aria-valuemin/max/now` set plus
`aria-label`, decorative icons are `aria-hidden`. New controls match this.

**Server components by default.** `'use client'` only where an effect, state, or
a browser API is genuinely needed. `app/page.tsx` and `app/layout.tsx` stay
server components.

## Comment style

Comments here explain *why* a decision was made, not what the line does — the
tradeoff considered, the failure mode avoided, the thing that would break if it
were done the obvious way. Match that. A comment that restates the code is worse
than no comment; a comment that captures the reasoning is the point.

## Known issues

- **`npm run lint` fails.** `next lint` was removed in Next.js 16, and no ESLint
  config or dependency exists in the project. The script currently resolves
  `lint` as a directory argument and errors. Fixing it properly means adding
  `eslint` + `eslint-config-next` with a flat config — an unmade dependency
  decision, so the `/qa` gate detects ESLint's absence and skips that step rather
  than reporting a false failure.
