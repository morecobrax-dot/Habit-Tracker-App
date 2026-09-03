# Design step 4 — home page rebuild

**Status: complete.** All six sections built. Contrast failures across the four
real screens: **zero**. Card radius: **one value everywhere**. 361 tests
passing, up from 341.

---

## The tension in the brief, and how it resolved

Two instructions pull against each other. The streak hero must be "sized as the
visual anchor of the page". The focus card "must read as the most inviting thing
on screen". Both cannot be the loudest element.

They are different jobs, and the page only works once they are separated:

- **The hero is the anchor.** Largest thing on the page, at the top, where the
  eye lands. It is entirely *passive* — a flame, a number, a name. No buttons,
  no fill, nothing to press.
- **The focus card is the invitation.** It is the only red-filled interactive
  block on the screen, and the biggest button in the app is the *smallest*
  version of the task.

So the flame wins on size and the focus card wins on pull. Getting this backwards
would produce a page whose loudest element is a score — the framing `CLAUDE.md`
exists to prevent.

The section order follows the same logic: everything above the backdate bar is
about what to do now, and the two charts sit below it. History that outranks the
next action is a scoreboard.

---

## What was built

| Section | Notes |
|---|---|
| Level header | Thin strip, not a card. Fill carries `glow-subtle` and a travelling sheen; the empty track carries neither. |
| Streak hero | 92px flame, `text-hero` count, habit name. Dormant flame at zero rather than empty space. |
| Today's focus | Only red-filled block on the page. Accent border strengthens and gains `glow-medium` once earned. |
| Habit rows | 44px tap target, gold gem, small flame + count on the right. |
| Heatmap | 12 weeks, `heat-0`→`heat-4`, on `bg-base`. |
| Week bars | Seven bars on the same ramp, `glow-subtle` on today. |

### Three states in the charts, not two

Both charts distinguish **future** from **empty**. A day that has not happened
yet gets an outline and no fill; rendering the rest of this week as `heat-0`
would show four misses the user has not yet had the chance to avoid, which is
exactly the dread the app exists to remove.

A day that asked nothing gets a rule at the base of the bar rather than an empty
column, so a rest day reads as planned rather than as a failure. `dayFullness`
returns 0 for such a day rather than 1 — treating "nothing scheduled" as
"perfect" would light the whole grid up before the habit existed.

### The heatmap ramp is a fraction, not a count

Intensity is `credit / due`, so a day with one habit and a day with five are
judged on the same terms — a single-habit user would otherwise never leave the
palest step. A partial scores its `completionFactors.partial` weight (0.6),
which lands a lone partial at level 2: the visual form of "partial completion
earns partial credit".

That weight is **taken from the active `XpRules`**, not invented locally. Two
opinions about what a partial is worth is how a chart ends up quietly
disagreeing with the XP it sits under.

---

## No logic was changed

Habit CRUD, logging, streak math and the XP layer are untouched — `git diff`
shows no change to `domain/streak.ts`, `domain/xp.ts`, `domain/freeze.ts`,
`domain/level.ts` or any repo or service.

New pure code was added, because a heatmap cannot exist without aggregating
logs: `domain/history.ts` (`rollupDays`, `dayFullness`, `heatLevel`,
`bestStreak`) with 20 tests, and `state/useHistoryView.ts` to feed it. It reads;
it never writes, and nothing existing calls into it. It went in the domain rather
than in the chart components because `flameTier` set that precedent — the tier
mapping is a tested pure function and the component owns only appearance.

`useHistoryView` is deliberately separate from `useDayView`: that hook is keyed
on the day being *edited*, and folding history into it would make the heatmap
shift under you every time you tapped "yesterday".

---

## Carried out from step 6's audit

**1. `components/ui/index.tsx` migrated first.** As predicted, it moved most of
the app at once — `Button`, `Card`, `Field`, `TextInput`, `TextArea`, `Select`,
`SegmentedControl`, `EmptyState` and `Badge` are on the new palette, and every
screen followed.

**2. One card radius everywhere.** `--radius-*: initial` clears Tailwind's
built-in scale before ours is declared, so `rounded-xl` and `rounded-2xl` no
longer exist. Verified in the built CSS: `.rounded-xl` and `.rounded-2xl` are
absent. This is now a build-time impossibility rather than something to catch in
review.

Radius census, before and after:

| Before | After |
|---|---|
| 10, **12**, 14, **16**, 20, 24, 6 px | 6, 10, 14, 20, 24 px |
| 23 elements at a non-token 12px | none |
| 7 elements at a non-token 16px | none |

**3. Heatmap on `bg-base`.** Honoured, and the reason is in the component's
header comment so it survives the next person who tries to tidy it into a card.

**4. Audit re-run.** Below.

**Beyond the four items**, the remaining screens were swept off the legacy
palette too. That was not optional once the page ground moved from navy
(`--color-ink`) to `bg-base`: leaving Habits, Settings and the editor on navy
cards over a near-black page would have broken the consistency requirement
outright. Legacy token references are now **0** (from 75).

The legacy `@theme` block itself is still in `index.css` and its box in `PLAN.md`
stays unticked — deleting it is step 6's job, and it is now a pure deletion with
nothing pointing at it.

---

## Audit results

```
── Today ──         contrast: all text passes
── Habits ──        contrast: all text passes
── Habit editor ──  contrast: all text passes
── Settings ──      contrast: all text passes
── Styleguide ──    3 failures (the deliberate demonstration rows)

total contrast failures: 3
```

**37 → 3.** Every one of the 34 that went was legacy-palette debt, exactly as
step 6 predicted. The 3 that remain are the styleguide rows that exist to *show*
what a failure looks like.

### Four defects found by looking at the rendered page

Static review missed all four. They were found by screenshotting a populated
phone-width viewport.

**The heatmap overflowed its container.** `grid-flow-col` creates implicit
columns sized to content, and `aspect-square` cells then have no width to derive
a height from. The last fortnight was clipped off the right edge. Fixed by
pinning `grid-template-columns` to `repeat(n, minmax(0, 1fr))`, which also made
the grid responsive for free.

**I used `text-disabled` for real text — again.** The heatmap's weekday initials.
That token is marked non-text only and measures 3.10:1. This is the *second*
time I have broken this specific rule in my own code; the first was caught in
step 6. Fixed to `text-muted`, and the reason is now a comment at the site.

While fixing it I found the labels were also ambiguous: picking every other row
gives "T, T, S" on a Monday-start week. They now select by weekday number, so
Mon/Wed/Fri are labelled whatever the week starts on — the only three initials
that stay distinct.

**The difficulty segments overflowed.** Moving segment labels from `text-xs` to
`text-small` pushed "Moderate" out of its segment and wrapped it under its own
accent dot. Four options with dots is the worst case at 375px; the labels are
now `text-micro` with `nowrap`. The accent ramp also started too dark to see, so
it now runs `maroon → heat-3 → primary → primary-hot`.

**The XP bar rendered a stray dot at zero.** A 2% floor on a `rounded-full` fill
is a dot, and a glowing one was claiming credit for nothing. The fill is now
omitted entirely at zero progress.

---

## A judgement call you may want to overrule

`CLAUDE.md` states **"No red text, ever… Red is for fills, borders, and glows
only"** as a hard constraint. Four places in the app used red text, all of them
conventional: the "Delete all data" button, form validation errors, the logging
error banner, and the backup failure message.

I applied the rule literally and removed all four. They now carry their warning
the way the rules allow — a full-strength `danger` border and a `danger/15` fill
— with the label itself at `text-primary`.

I think this is right on the merits as well as by the letter: the most important
words on a destructive control are now the most legible thing on it, and an
error you can *read* beats one you can only recognise by its colour. But red
delete text is a strong convention and you may want it back. It is one line —
`danger` in `BUTTON_VARIANTS` — plus three call sites.

The rule as written names `primary` and `primary-hot` and gives a rationale
specific to `primary-hot`'s thin contrast margin, so a narrower reading that
exempts the `danger` state token is defensible. I went with "ever" meaning ever.

---

## Results

```
Test Files  18 passed (18)
     Tests  361 passed (361)
```

Typecheck clean. Lint clean. Build clean (351 kB JS / 114 kB gzip, 38 kB CSS).

Verified in the built CSS rather than assumed: `bg-heat-0..4`,
`drop-shadow-flame-0..5` and `.xp-sheen` are all present — the static-class-map
discipline held. The styleguide is still absent from the production bundle.

---

## What step 5 inherits

1. **The completion animation** is the headline item and nothing here pre-empts
   it: rows currently transition colour only.
2. **The tab bar** got the minimum needed to be on-palette and off red text — an
   active indicator bar and weight. Its real treatment is step 5's.
3. **Type-scale drift**, the direct analogue of the radius problem this step
   fixed: `text-xs`, `text-sm` and `text-2xl` still reach Tailwind's built-in
   scale in `Habits`, `Settings` and `HabitEditor` rather than the seven `--text-*`
   tokens. The same one-line fix works (`--text-*: initial`) but it breaks every
   default size at once, so it wants doing alongside step 5's pass over those
   screens rather than bolted onto this one.
4. **The completed focus card is loose** — a lot of padding under a short button
   row. Cosmetic, and easier to judge once the completion animation exists.
