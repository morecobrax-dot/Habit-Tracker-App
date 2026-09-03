# Design step 6 — cleanup and audit

**Status: complete.** The legacy palette is deleted. `tokens.css` is now the
only source of colour, radius, type and motion in the app, and the built CSS
ships **exactly** the 35 tokens it declares — no more, no less.

This step ran in two parts. The three audit items were done earlier, before
steps 4 and 5, because they were the only work available at the time and step 4
needed their findings. The deletion waited on those steps and is done here.
Both halves are recorded below.

---

## Part two — the deletion

### It was a pure deletion, and I checked before pulling

Three separate sweeps over `src/`, because a missed reference would have left a
screen rendering with undefined colours rather than failing loudly:

| Check | Result |
|---|---|
| Tailwind utilities (`bg-`/`text-`/`border-`/…) on legacy names | none |
| `var(--color-*)` references to legacy names | none |
| Any mention of the 17 token names at all | none |

The `@theme` block is gone. What remains in `index.css` is *behaviour* rather
than vocabulary — base element styles, safe-area helpers, and the keyframes —
all of which consume tokens and declare none.

### The interesting part: prose was shipping a dead token

Deleting seventeen tokens shrank the built CSS by **20 bytes**, which is not
what deleting seventeen tokens should look like. Worth understanding rather
than shrugging at, so I diffed the built output either side of the change.

Sixteen of the seventeen were already being tree-shaken — Tailwind v4's
`@theme` only emits variables it believes are used, and nothing used them. But
one was still shipping:

```
--color-ink:#0b1020
```

Nothing in `src/` referenced it. The reference was in **`reports/step-4.md`
line 118**, where I wrote that the page ground had moved *"from navy
(`--color-ink`) to `bg-base`"*. Tailwind v4 auto-scans the repository for class
candidates and does not know the difference between code and prose, so my own
audit document was keeping a dead colour in the production bundle.

**That is the actual finding of this step**, and it generalises: any comment or
markdown file naming a utility class keeps its variable alive in the shipped
CSS. It is self-healing here only because the token no longer exists to emit.

I hit it a second time within the same step. While fixing a violation below I
wrote a comment saying *"use the text token, not `text-white`"* — and the
build promptly kept `--color-white` in the CSS. The comment is now reworded to
describe the rule without writing the class name.

`reports/step-4.md` is left as written. It is a historical record, and editing
an audit after the fact to tidy a side effect is worse than the side effect.

---

## Two violations the audit caught

**Pure white, twice.** `HabitEditor.tsx` used `text-white` on the selected
x-per-week and set-days buttons. `CLAUDE.md` specifies `text-primary` as
*"warm off-white, never pure white"*, and `text-white` sits outside the token
system entirely. Now `text-text-primary`, which also measures 5.30:1 on a
`primary` fill.

**A token used for the wrong kind of element.** The same buttons used
`rounded-lg` — a real token, but the 24px step, which the tokens file reserves
for *"sheets, hero surfaces"*. On a 44px control it reads as a pill. Moved to
the 10px small-control step, matching every other button of that size.

This is the category the radius census could not catch in step 4: not a
non-token value, but a token applied where a different one belongs. Worth
noting that a census of *values* proves less than it appears to.

---

## Final audit

Run against a live dev server with `audit.mjs`, walking the DOM of all five
screens plus the styleguide.

```
── Today ──         contrast: all text passes
── Habits ──        contrast: all text passes
── Habit detail ──  contrast: all text passes
── Habit editor ──  contrast: all text passes
── Settings ──      contrast: all text passes
── Styleguide ──    3 failures — the deliberate demonstration rows

total contrast failures: 3
```

### Radius census

```
10px  74   rounded-sm    inputs, small controls
20px  28   rounded-card  every card
 6px  23   rounded-xs    chips, swatches
14px  13   rounded-md    buttons
24px   1   rounded-lg    sheets, hero surfaces
```

Every value is a token. The single 24px element is in the styleguide, on the
swatch that exists to *demonstrate* that step — I checked rather than assumed,
by probing the live DOM for it. No app screen uses it.

### Tokens shipped

```
declared in tokens.css : 35
emitted in built CSS   : 35
```

Exactly equal, in both directions. Nothing declared goes unused, and nothing
undeclared leaks in.

### Hardcoded values

No hex in any component. No arbitrary bracket values outside the styleguide's
heatmap probe. No default Tailwind colour, radius, or type utility reachable —
`--radius-*` and `--text-*` were both cleared to `initial` in steps 4 and 5, so
a non-token value is a build-time impossibility rather than something to catch
in review.

---

## Results

```
Test Files  19 passed (19)
     Tests  377 passed (377)
```

Typecheck clean. Lint clean. Build clean. Screens re-rendered at phone width
after the deletion to confirm nothing lost its colour.

---

## Part one — the earlier audit (unchanged, for the record)

Run before steps 4 and 5, when 75 legacy references were still live. Its
findings drove step 4's work and are reproduced here as history.

**Components still on legacy tokens:** 75 references across six files, led by
`components/ui/index.tsx` (34) and `routes/Today.tsx` (52). The recommendation
— migrate the shared primitives first, since every screen renders through them
— is what step 4 did, and it moved most of the app in one file.

**Card radius was inconsistent:** three values (12px, 16px, 20px) because
`rounded-xl` and `rounded-2xl` are Tailwind defaults rather than tokens. Fixed
in step 4 by clearing the radius namespace.

**37 contrast failures**, every one traceable to a legacy token or a deliberate
demo row. Worst was white on the legacy `brand` at **3.51:1**, affecting every
primary button in the app; the new palette's equivalent measures 5.30:1.

**One violation found and fixed at the time:** the styleguide used
`text-disabled` for real label text in four places — a token marked non-text
only, measuring 2.88–3.10:1. My own code breaking my own rule. (It happened
again in step 4, on the heatmap's weekday initials. Twice is a pattern: the
token's name does not carry its restriction, and `-disabled` reads like a text
state.)

---

## The design track is closed

Steps 1–6 are done. The system is one tokens file, one radius scale, one type
scale, one glow vocabulary, and zero ways to reach a non-token value by
accident.

Nothing here is blocking. Two things noted along the way that are not this
step's to fix:

1. **The focus-bonus erosion** from `reports/phase-3.md` — the bonus is flat
   while every other term is multiplied, so it wins by 1 XP at multiplier 1.00
   and loses from 1.10 onward. One line, still needs your approval since it
   changes an approved formula.
2. **The completed focus card is loose** — a lot of padding under a short
   button row. Cosmetic, and now easy to judge since the completion animation
   exists.
