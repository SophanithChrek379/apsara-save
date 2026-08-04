---
name: qa-verify
description: The QA gate for Apsara Save — run the layered checks (typecheck, build, project-invariant audit, live-page smoke test, and a conditional browser interaction pass), verify each result rather than assuming it, then report prioritized fixes. Use after any code change to app/, components/, hooks/, or lib/; before a commit; when asked to "check", "verify", "QA", "review my change", or "what should I fix next".
---

# QA gate

Five layers, cheapest first. Run Layers 1-4 in order and stop early only on a
Layer 1 failure — a type error makes everything downstream meaningless.
Otherwise run every one of them, because one blocker should not hide three
others.

Layers 1-4 cost about 15 seconds total and always run. Layer 5 is different: it
spins up a real browser and costs several seconds more, so it's conditional —
see Layer 5 for exactly when. There is no reason to skip Layers 1-4 to save
time.

## Layer 0 — Scope

Establish what changed before checking anything, so the report can point at the
diff rather than the whole codebase.

```bash
git status --short && git diff --stat HEAD
```

If the tree is clean, the scope is "the codebase as it stands" — audit the files
relevant to what was just discussed rather than all 1950 lines of the tracker.

## Layer 1 — Types

```bash
npm run typecheck
```

Silence is a pass. On failure, stop and report: every later layer is noise until
types are sound.

## Layer 2 — Build

```bash
npm run build
```

Reads as a pass only with `✓ Compiled successfully` **and** all five routes
listed as `○ (Static)`. Two failure modes to name specifically:

- A route that stops being static means something time-, storage-, or
  request-dependent leaked into the render path. That is a blocker, not a
  regression in performance.
- A build warning about hydration or `use client` is a real finding even though
  the build exits 0.

`npm run lint` is **broken** — `next lint` was removed in Next 16 and no ESLint
config exists. Do not run it, and do not report its failure as a project defect.
If `node_modules/.bin/eslint` ever appears, run `npx eslint .` here instead.

## Layer 3 — Invariant audit

The checks a compiler cannot make. Every pattern below is calibrated against the
current codebase and the expected hit count is exact, verified at the time this
skill was written. **Report only hits beyond the expected count, or expected hits
that have moved to a new site.** A count that matches is a pass — do not re-report
sanctioned code as a finding.

Run from the repo root. Quote every `--include` glob; zsh expands it otherwise
and the command silently matches nothing.

```bash
# 3a. Palette families outside the sanctioned system. Expect 1.
# emerald (~66 uses) is the accent and is excluded from this pattern; so is zinc,
# which appears only in the heading gradient. The one expected hit is
# `dark:from-white` at app/savings/page.tsx:1835 — that same gradient, which
# carries a complete dark: counterpart. Any other family is a finding.
grep -rnE '\b(bg|text|border|ring|fill|stroke|from|via|to)-(white|black|(slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3})\b' app components --include='*.tsx'

# 3b. Raw color literals in components. Expect 2.
# app/layout.tsx:23-24, the themeColor values, where a metadata object cannot
# reference a CSS variable. Anything else is a finding.
grep -rnE '#[0-9a-fA-F]{3,8}\b|oklch\(' app components --include='*.tsx'

# 3c. Appearance read outside the sanctioned path. Expect 6.
# layout.tsx:23,24 (themeColor media queries), layout.tsx:33 (the pre-paint
# THEME_SCRIPT), and use-system-theme.ts:5,23,37 (the hook itself). A matchMedia
# call anywhere else should be useSystemTheme() instead.
grep -rn 'matchMedia\|prefers-color-scheme' app components hooks --include='*.tsx' --include='*.ts'

# 3d. Unvalidated or scattered storage access. Expect 5.
# page.tsx:411,413,422 are readStored/writeStored — the single sanctioned
# JSON.parse lives at 413. page.tsx:573,1627 read and write the SEED_KEY flag.
# A JSON.parse outside readStored is a blocker: storage is user-editable and
# version-skewed, so its shape cannot be trusted.
grep -rn 'JSON.parse\|localStorage' app components hooks lib --include='*.tsx' --include='*.ts'

# 3e. Clock reached during render or module init. Expect 2.
# page.tsx:1565 is BOOTSTRAP_NOW — deliberate, documented, and gated so nothing
# derived from it reaches markup before `mounted`. page.tsx:1586 is the mount
# effect. A new module-scope or render-body clock read is a hydration blocker.
grep -rnE 'new Date\(\)|Date\.now\(\)' app components hooks --include='*.tsx' --include='*.ts'

# 3f. Money formatted by hand. Expect 3.
# page.tsx:968,1174,1488 — all percentages, which is toFixed's only sanctioned
# use. toFixed or a template string on a currency amount is a finding: use
# formatMoney(), of which there are ~32 correct calls to copy.
grep -rn 'toFixed' app components --include='*.tsx'
```

If a count comes back *below* expected, something sanctioned was removed or
refactored — worth a line in the report, not a finding on its own.

Then read the changed lines and check what grep cannot:

- **Dark-mode parity.** An accent used as content text, a border, or a
  decorative ring needs a `dark:` counterpart. Solid fills carrying their own
  paired foreground (`bg-emerald-500 text-emerald-950`) and `focus-visible`
  rings are correct in both palettes and need none.
- **Hydration shape.** Anything derived from the clock or from storage must stay
  behind the `mounted` gate, so the server render and the hydrating render are
  byte-identical.
- **ARIA state.** Toggles carry `aria-pressed`; progress bars carry the full
  `aria-valuemin`/`max`/`now` set plus `aria-label`; decorative icons are
  `aria-hidden="true"`.
- **Client boundary.** `'use client'` only where state, an effect, or a browser
  API is genuinely needed.
- **Comment quality.** This codebase explains *why*, never *what*. A comment
  restating its code is a finding worth raising.

## Layer 4 — Live page

Confirms the thing actually renders, which no static check proves. Requires the
Layer 2 build to have succeeded.

```bash
npx next start -p 3187 > /tmp/apsara-qa.log 2>&1 &
SRV=$!
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:3187/savings && break; sleep 0.5; done

curl -s -o /dev/null -w '/        -> %{http_code}\n' http://localhost:3187/
curl -s -o /dev/null -w '/savings -> %{http_code}\n' http://localhost:3187/savings
BODY=$(curl -s http://localhost:3187/savings)
printf '%s' "$BODY" | grep -ciE 'application error|__NEXT_ERROR|Internal Server Error'
for m in Apsara Daily 52-Week progressbar; do
  printf '%-12s %s\n' "$m" "$(printf '%s' "$BODY" | grep -c "$m")"
done

kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
```

A pass is `307` on `/`, `200` on `/savings`, `0` error markers, and `1` for each
content marker.

Assert only on skeleton content. The day grid, the week ladder, and the bucket
controls render **after** `mounted`, so `aria-pressed` is legitimately absent
from the prerendered HTML — its absence is not a defect. Port 3187 avoids
colliding with a dev server on 3000. Always kill the server, including when a
check fails midway.

## Layer 5 — Interaction (conditional)

Layer 4 proves the HTML shipped; it cannot prove a click handler fires or an
`aria-pressed` toggle actually flips, because it never runs JavaScript. Layer 5
does, using Playwright — see the `e2e-test` skill at
`.claude/skills/e2e-test/SKILL.md` for the full setup and how to extend it.

Run it only when the diff touches something interactive: a new or changed
event handler, a toggle/tab/click target, ARIA state that changes at runtime,
or a file under `e2e/` itself. Skip it for a pure styling, copy, or data
change — Layer 4 already covers those, and paying for a browser launch buys
nothing there.

```bash
npm run test:e2e
```

A pass is every test green (`N passed`, `0 failed`). First run on a machine
needs the browser binary once: `npx playwright install chromium`. The
suite starts its own dev server on port 3001 and reuses one already running —
never hand-start a server for this.

If Layer 5 was skipped because the diff was non-interactive, say so in the
report rather than omitting it silently — "Layer 5 skipped (no interactive
code in this diff)" is a real, checked decision, not an oversight.

## Report

Group findings by what the user should do about them, most severe first. Skip
any group that is empty rather than writing "none".

**Blockers** — type error, failed build, a route that lost `(Static)`, a
hydration mismatch, an unvalidated storage read.
**Should fix** — a dark-mode gap, missing ARIA state, hand-formatted money, an
unsanctioned palette family.
**Improvements** — naming, a comment that restates its code, a simplification.

For each: `file.tsx:line`, one sentence on what breaks and under what
conditions, then the concrete fix. Concrete beats exhaustive — three real
findings with line numbers are worth more than twelve speculative ones.

Close with the gate result as a single line, naming every layer that ran —
include Layer 5 whenever it ran or was deliberately skipped, never omit it
silently:

```text
typecheck ✓ · build ✓ (5/5 static) · audit ✓ · live ✓ · e2e ✓ (4/4) — 2 should-fix, 1 improvement
typecheck ✓ · build ✓ (5/5 static) · audit ✓ · live ✓ · e2e skipped (no interactive code in diff) — 1 improvement
```

## Honesty

State layer results as what actually happened. A layer that was skipped is
reported as skipped and why; a command that errored for an environmental reason
is reported as errored, not as a pass. Never write a `✓` for a command that did
not run. If a finding is a suspicion rather than something verified, label it as
one — a confident wrong finding costs more than an uncertain right one.
