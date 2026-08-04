---
name: e2e-test
description: Browser-driven end-to-end tests for Apsara Save using Playwright — runs the suite in e2e/, or writes a new spec for a UI change and runs it. Use when asked to "e2e test", "browser test", "automate testing", "add a Playwright test", or to verify an interactive flow (tab switching, day/week toggles, bucket controls) actually works in a real browser rather than just typechecking.
---

# E2E testing

Apsara Save is a single client component with no backend — the risk isn't a
broken API, it's a broken *interaction*: a tab that doesn't switch, a toggle
that doesn't flip `aria-pressed`, a progress bar with a missing ARIA attribute.
`qa-verify`'s Layer 4 proves the page renders; this skill proves it responds to
input the way [CLAUDE.md](../../CLAUDE.md)'s invariants require.

Config lives at `playwright.config.ts`; specs live in `e2e/`. The config's
`webServer` block starts `npm run dev` on port 3001 automatically and reuses
one already running (`reuseExistingServer`) — never start a dev server by hand
before running tests, and never point a spec at a different port.

## Run the suite

```bash
npm run test:e2e
```

Headed / step-through debugging:

```bash
npm run test:e2e:ui
```

First run on a new machine needs the browser binary once:

```bash
npx playwright install chromium
```

## Writing a new spec

One spec file per page or feature area, under `e2e/`. Prefer role- and
label-based locators (`getByRole`, `getByLabel`, `getByText`) over CSS
selectors — they fail the same way a screen reader would, which doubles as a
check on the ARIA invariants themselves. `page.tsx` uses radix-nova primitives
(`Tabs`, etc.), so `role="tab"`, `role="progressbar"`, and `aria-pressed`
toggles are all reachable this way without inventing `data-testid`s.

Follow the shape of the existing specs in `e2e/savings.spec.ts`:

- Assert on **behavior**, not implementation — `aria-selected` after a tab
  click, not a CSS class.
- Attach a `console`/`pageerror` listener and assert it stays empty. A page
  can render its shell while a client-side read throws.
- Don't assert on money strings by hand — if a test needs to check a total,
  match the pattern `formatMoney()` produces (`Intl.NumberFormat`'s `$1,234.56`
  shape), not a guessed literal, since locale formatting can shift decimals.

## Project-specific gotchas

- **Hydration gate.** Day cells, week toggles, and bucket controls render only
  after the `mounted` effect fires (see CLAUDE.md's storage/clock invariant).
  A spec that asserts on those immediately after `goto()` without a `waitFor`
  can flake — prefer `expect(locator).toBeVisible()`, which retries, over a
  bare presence check.
- **Dark mode is class-driven.** To test the dark palette, set the class
  before the page scripts run rather than toggling after: `await
  page.addInitScript(() => document.documentElement.classList.add('dark'))`
  before `goto()`. Toggling `matchMedia` in the browser context does nothing —
  the app never reads it directly (`useSystemTheme()` is the only reader).
- **Storage persists between tests in the same worker context.** Each test
  gets a fresh context by default (Playwright's isolation), but if a spec
  seeds `localStorage` via `addInitScript`, reset it explicitly rather than
  relying on test order.
- **Port 3001 is fixed.** It's this project's dedicated dev port (see
  `package.json`), chosen to avoid colliding with other local Next.js
  projects. If 3001 is ever occupied by something else, fix the conflict —
  don't repoint the config to a random port, since CI and local runs need to
  agree.

## When to run this vs. qa-verify

`qa-verify`'s Layer 4 is a curl-based skeleton check — fast, no browser,
proves the HTML shipped. This skill is slower (spins up real Chromium) and
proves the JavaScript actually works. Run it when a change touches
interaction: a new toggle, a tab, a click handler, an ARIA attribute — not for
a pure styling or copy change where `qa-verify` already covers the ground.
