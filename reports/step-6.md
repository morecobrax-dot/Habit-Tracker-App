# Design step 6 — cleanup and audit

**Status: partial.** Three of four items done. The fourth — deleting the legacy
palette — cannot be done yet, and doing it now would break the app.

---

## Why this step, and why only three quarters of it

Phase 2 has three open product rulings, unanswered across three turns. Design
steps 4 and 5 are blocked on phase 2 because they read real streak data. Step 6
is the only remaining item with work that can actually be done.

Its audit bullets were overdue anyway: `CLAUDE.md` requires an audit against the
tokens file *at the end of every design step*, and steps 1–3 shipped without
one. This closes that gap and produces the inventory step 4 needs.

The deletion bullet stays unticked. The legacy palette is still load-bearing for
75 references across six files; deleting it now would leave those screens
rendering with undefined colours. It is unblocked by step 4, not by this step.

---

## 1. Hardcoded hex in components

**Clean.** One grep hit, and it is a false positive: the string `#000` inside a
prose note on the styleguide, explaining why the background is not pure black.
No component contains a colour value.

## 2. Components still pointing at legacy tokens

75 references across six files. This is migration debt, not drift — these are
screens the overhaul has not reached yet.

| File | Legacy references |
|---|---|
| `routes/Today.tsx` | 52 |
| `components/ui/index.tsx` | 34 |
| `routes/HabitEditor.tsx` | 15 |
| `routes/Settings.tsx` | 13 |
| `routes/Habits.tsx` | 9 |
| `App.tsx` | 6 |

`components/ui/index.tsx` is the highest-leverage of these: `Button`, `Card`,
`Field`, `TextInput`, `SegmentedControl`, `EmptyState` and `Badge` are used by
every screen, so migrating that one file moves most of the app at once. Worth
doing first in step 4.

## 3. Every screen audited against the tokens file

Measured by walking the live DOM of all five screens, not by reading source.

### Card radius is inconsistent — three different values

`CLAUDE.md` requires the same card radius everywhere. Rendered reality:

| Radius | Elements | Source |
|---|---|---|
| 10px | 63 | `rounded-sm` — the token, correct for controls |
| **12px** | **23** | `rounded-xl` — Tailwind default, **not a token** |
| **20px** | **11** | `rounded-card` — the token, correct for cards |
| 24px | 10 | `rounded-lg` — the token |
| **16px** | **7** | `rounded-2xl` — Tailwind default, **not a token** |
| 6px | 6 | `rounded-xs` — the token |
| 14px | 1 | `rounded-md` — the token |

So cards currently render at **12px, 16px and 20px** depending on which screen
you are on. The 12px and 16px cases come from `rounded-xl` and `rounded-2xl`,
which are Tailwind's built-in scale rather than anything in `tokens.css` — the
token file defines `xs / sm / md / card / lg`, and `xl` / `2xl` survive from the
default theme.

Two things follow for step 4: every card becomes `rounded-card`, and `xl`/`2xl`
should be removed from the theme so reaching for a non-token radius is a build
-time impossibility rather than a habit.

### Arbitrary bracket values

Four, all in the styleguide's heatmap probe (`gap-[3px]`, `rounded-[2px]`).
Acceptable in a dev-only tool, but the real heatmap in step 4 should use tokens.

## 4. Full contrast re-check across all screens

Every text node on all five screens, computed against its effective background
using WCAG 2.1 relative luminance, with the correct floor for large text.

**37 failures. Every single one traces to a legacy token or a deliberate demo.**
The new palette produces no failures anywhere.

| Colour | Token | Worst ratio | Where |
|---|---|---|---|
| `#6B769A` | legacy `text-faint` | 3.40:1 | hints, captions, bottom nav — every screen |
| `#6D7CFF` + white | legacy `brand` | 3.51:1 | every primary button, every selected segment |
| `#F2555A` | legacy `danger` | 4.42:1 | "Delete all data" |
| `#6E585D` | `text-disabled` | 2.88:1 | styleguide demo rows only — deliberate, labelled ✕ |

The worst of these is **white on `brand` at 3.51:1**, because it affects every
primary button in the app — the most-tapped surfaces there are. For comparison,
the new palette's equivalent (`text-primary` on `primary`) measures 5.30:1.

This is a useful result rather than a worrying one: it confirms the new tokens
are sound and quantifies exactly what migration buys. It also shows the old
palette was never contrast-audited, which is the reason the new one was.

### One genuine violation found and fixed

The styleguide was using `text-disabled` for real label text — swatch names,
type-scale token names, and the passing ratio captions — in four places. That
token is marked **non-text only** precisely because it measures 2.88–3.10:1.
My own code, from steps 1 and 3, breaking my own rule.

Fixed by moving those labels to `text-secondary` (6.5:1+). Styleguide failures
dropped from 37 to 3, and the 3 that remain are the deliberate demonstration
rows that exist to show what a failure looks like.

---

## Results

```
Test Files  16 passed (16)
     Tests  312 passed (312)
```

Typecheck clean. Lint clean. Build clean.

Contrast failures: 73 before the fix, 37 after. Of the remaining 37, **34 are
legacy-palette debt** that step 4 removes by construction, and **3 are the
intentional demo rows**.

---

## What step 4 must carry forward

1. Migrate `components/ui/index.tsx` first — it moves most of the app at once.
2. Every card becomes `rounded-card`; drop `xl`/`2xl` from the theme so a
   non-token radius cannot be typed by accident.
3. The heatmap sits on `bg-base`, never inside a `surface` card
   (`reports/step-3.md`).
4. Re-run this audit afterwards. It should reach zero failures outside the
   styleguide's demonstration rows.

The audit is `audit.mjs` at the repo root — it takes a running dev server and
reports contrast failures and a radius census across every screen.
