---
name: ui-component
description: Rules for building or changing UI in Apsara Save — shadcn/ui radix-nova primitives, Tailwind v4 CSS-first tokens, dark-mode parity, and the local Panel/MetricCard composition patterns. Use when adding a component, adding a shadcn primitive, restyling, or touching app/globals.css.
---

# Building UI here

## Before writing a component

Check whether the page already has one. `app/savings/page.tsx` defines a set of
local building blocks above its screens, and reaching for a new one when these
exist is the most common way this codebase drifts:

- `Panel` — the bordered surface every section sits in
- `MetricCard` — icon + label + value + hint, with an `accent` variant
- `ProgressBar` — a correctly-labelled progress bar; do not hand-roll another
- `StatLine`, `PanelHeading`, `PrimaryAction`, `ArchivePill`, `ArchiveNotice`
- `YearSwitcher`, `MonthSwitcher` — both with skeleton variants for pre-mount

## Adding a shadcn primitive

```bash
npx shadcn@latest add <name>
```

`components.json` is already configured — style `radix-nova`, baseColor
`neutral`, RSC on, lucide icons, `@/components/ui` target. Do not pass flags that
override it; the generated file should match `button.tsx`, `select.tsx`, and
`tabs.tsx` in shape.

There is **no `tailwind.config`**. Tailwind v4 is configured in CSS: tokens live
in `@theme inline` in `app/globals.css`, with `:root` and `.dark` blocks below
it. A primitive whose install instructions tell you to extend a JS config needs
that translated into `@theme inline` instead.

## Styling rules

Compose classes with `cn()` from `@/lib/utils` — it merges conflicting Tailwind
classes, which plain template strings do not.

Structure comes from semantic tokens: `bg-background`, `text-foreground`,
`bg-card`, `text-muted-foreground`, `border-border`, `bg-muted`, `ring-ring`.
These resolve in both palettes for free.

The accent is `emerald`. Use it for progress, success, and the primary action —
and give it a `dark:` counterpart whenever it is content text, a border, or a
decorative ring:

```tsx
// Content accent — needs both palettes.
'text-emerald-600 dark:text-emerald-400'

// Solid fill with a paired foreground — correct in both, no dark: needed.
'bg-emerald-500 text-emerald-950'

// focus-visible ring — correct in both.
'focus-visible:ring-emerald-500/40'
```

No other palette family. No `#hex` or `oklch()` in a component — the only
sanctioned literals are the two `themeColor` values in `app/layout.tsx`, where a
metadata object cannot reach a CSS variable.

Dark mode is driven by the `.dark` class on `<html>`, not a media query.
`@custom-variant dark (&:is(.dark *))` means a bare
`@media (prefers-color-scheme: dark)` cannot reach the dark tokens at all. To
read the appearance in JS, call `useSystemTheme()` — it returns `null` during the
hydrating render, which means "not known yet", not "light".

Numbers that update in place get `tabular-nums`, so the layout does not jitter as
digits change. Money renders through `formatMoney()`; `toFixed` is for
percentages only.

## Client and server

Default to a server component. `'use client'` earns its place only with state, an
effect, or a browser API. `app/layout.tsx` and `app/page.tsx` stay server
components.

If a component's output depends on the clock or on `localStorage`, it must render
a stable placeholder first and swap in the real value after mount — see the
`mounted` gate and the `SwitcherSkeleton` / `SKELETON_SHAPE` / `PLACEHOLDER`
pattern. The page is statically prerendered, so reading either during render
produces markup that is stale in the HTML and mismatched on hydration.

## Accessibility

- Toggles: `aria-pressed`, plus an `aria-label` when the visual content is a bare
  square or number
- Progress: `role="progressbar"` with `aria-valuemin`, `aria-valuemax`,
  `aria-valuenow`, `aria-label` — or just use `ProgressBar`
- Decorative icons: `aria-hidden="true"`
- Icon-only buttons: an `aria-label` naming the target, e.g.
  `` `Clear ${label} for ${monthName}` ``
- Interactive targets stay comfortable on coarse pointers; the existing controls
  were deliberately sized up for touch

## Comments

Explain the reasoning, never the mechanics — why this approach over the obvious
one, what breaks otherwise. A comment that restates its code should be deleted.

## Verify

Changed UI is not done until the `qa-verify` gate has run. At minimum
`npm run typecheck` and `npm run build`, then check the change in both palettes.
