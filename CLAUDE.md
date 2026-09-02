# Project: gamified habit tracker

## What this app is for

The purpose is to reduce procrastination. It is not a points toy.

Judge every feature against one question: **does this make it easier to
start a task I'm avoiding?** If something is fun but doesn't serve that,
say so and recommend cutting it.

## Stack

React + Vite + TypeScript, Tailwind, IndexedDB via Dexie, installable
PWA. No backend, no auth — everything on-device.

## How to work

- Read `PLAN.md` before starting. Do the next unchecked step only.
- **Stop after each step.** Do not build ahead into later steps.
- Write your audit to `reports/step-N.md`, tick the box in `PLAN.md`,
  then stop and summarize.
- Ask clarifying questions before writing code, not after.
- Tell me when I'm asking for something that will hurt the app.
- If a change requires touching logic during a design step (or vice
  versa), stop and ask first.

## Product rules — never violate

- **Reward starting, not perfection.** Partial completion earns partial
  credit. Every habit has a minimum version (a 2-minute fallback) that
  still counts.
- **No punishment mechanics.** Never subtract XP. Never reset a level.
  Missing a day means no gain, not a loss. Dread of losing progress
  causes avoidance — the exact thing this app fights.
- **Streaks get a grace buffer.** Freeze tokens, not hard resets.
- **Never break a streak silently.** It's a visible, explainable event.
- The daily focus habit (longest-avoided) is the core lever. It must
  never look like just another row.

## Code rules

- Game logic lives in pure, testable functions, separate from UI.
- **Never read the system clock inside streak or XP functions.** Pass
  the current date in, so tests can control time.
- Streak and XP math get tests before any UI is built on them. A wrong
  streak destroys trust in the whole app.
- Day rollover and timezone are handled explicitly, never implicitly.
  One configurable day-boundary value, not scattered date math.
- XP and scheduling logic stay swappable — plan data separate from the
  rules that generate it — so an AI-generated plan can drop in later
  without a rewrite.

## Design rules

### Tokens
The tokens file is the single source of truth. **No hardcoded hex in
components, ever.** Audit against it at the end of every design step and
flag anything that drifted.

### Palette

| Token | Hex | Use |
|---|---|---|
| `bg-base` | `#0A0509` | near-black, warm-shifted — never pure black |
| `surface` | `#14090E` | cards |
| `surface-raise` | `#1E0C13` | hovered / elevated cards |
| `border` | `#2E1219` | decorative hairlines only |
| `border-interactive` | `#8A5058` | control outlines, focus rings (WCAG 1.4.11) |
| `primary` | `#C50337` | buttons, active states |
| `primary-hot` | `#E83D5D` | highlights, glow source |
| `maroon` | `#59171B` | chart bases, muted fills |
| `gold` | `#FFC94A` | habit icons |
| `gold-light` | `#FFE9A8` | icon highlights only |
| `text-primary` | `#F5EDEF` | warm off-white, never pure white |
| `text-secondary` | `#A89296` | |
| `text-muted` | `#94787E` | clears 4.5:1 on all three surfaces |
| `text-disabled` | `#6E585D` | **non-text only** — rules, gridlines, disabled glyphs |

### Colour rules — hard constraints

- **No red text, ever.** Not `primary`, not `primary-hot`. `primary-hot`
  technically passes at 4.89:1, but that's 0.39 above the floor — any
  future nudge to the hex for a warmer glow silently drops it under. Red
  is for fills, borders, and glows only.
- **Maroon fills carry no text, ever.** Maroon is chart bases and muted
  surfaces only. This removes the need to remember a per-case exception.
- **Gold is reserved** for habit icons and level/achievement moments.
  Never gold body text, never gold buttons.
- Every text/background pair must clear 4.5:1. Check and report any that
  don't, with the computed ratio.

### Glow
Three tokens only: subtle, medium, strong — layered box-shadows using
`primary-hot` at low alpha.

Glow signals *earned or alive*. Apply only to: completed habit cards,
the active streak flame, the XP bar fill, the level-up moment, primary
button hover.

Never glow: static text, inactive cards, borders, containers, navigation.
If more than a quarter of the screen glows, pull back.

### Flame hues — the one sanctioned exception
The streak flame leaves the red/gold palette by design (orange → red →
magenta → violet → teal). The widening hue range *is* the reward signal.

Containment rule: gold only on icons, flame hues only inside the flame
and its glow, red everywhere else. If it ever feels incoherent on a real
screen, pull back the flame — not the gold.

### Typography
Outfit, self-hosted via `@fontsource-variable`, woff2 precached for
offline. Two weights maximum for body. Sentence case throughout; no
all-caps except tiny labels.

**All stat displays use `font-variant-numeric: tabular-nums`.** Streak
counts and XP animate, and proportional digits jitter as they tick.

Numbers (streaks, XP, levels) get heavier weight and tighter tracking so
they read as game stats.

### Accessibility
- Pickers and option grids are semantic radio groups, not grids of divs.
  Arrow-key navigable, accessible names, selected state visible without
  relying on colour alone.
- Every interactive element gets distinct hover, active, and
  focus-visible states.
- Animations stay under 2s, use transform and opacity only, and sit
  behind a `prefers-reduced-motion` guard.

### Consistency
No screen should look like it came from a different app. Same card
radius, border treatment, glow language, and spacing rhythm everywhere.
