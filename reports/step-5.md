# Design step 5 — standard habit-tracker features

**Status: complete.** All seven items built, plus the type-scale carry-forward.
Contrast failures across the five real screens: **zero**. 377 tests passing, up
from 361.

---

## One thing I changed on purpose, and why

The brief asks for a **"most missed habit"** in the weekly review. I built the
feature and changed the framing, because the name describes something
`CLAUDE.md` has already ruled out.

The focus card deliberately hides how long a habit has been avoided —
*"neglect drives selection, but showing it back would turn the card into a daily
accusation, which is an avoidance engine."* A card headed "most missed" is that
same accusation with a leaderboard attached, and it would sit on the home screen
permanently.

So the information is all there, and the framing is different:

- The card is headed **"Finding it hard"**, not "most missed".
- Its body is that habit's **two-minute version**, not a failure count — the
  way back in rather than the size of the hole.
- The real ratio is still shown (`2 of 3`), small and to the right. Hiding data
  from someone about their own week is patronising; framing is the part that
  decides whether they open the app tomorrow.
- Tapping it goes to that habit's page.

**When every habit is at 100%, nothing is named.** There is no "least good"
habit on a perfect week, and picking one would manufacture a failure. That case
gets its own line, and it is tested.

If you want the blunt version, `hardestWeek` in `domain/review.ts` already
returns everything needed — only the copy in `components/WeekReview.tsx` would
change.

---

## The completion animation

The brief calls this "the single most important animation in the app", and it is
the only place in this step I spent real time on motion.

Three things fire together and all finish inside 400ms: a red wash sweeps across
the row (360ms), the gem pops (320ms), and the XP earned floats up (400ms).
Transform and opacity only, so a five-habit day never touches layout.

**Two things this needed that were not obvious.**

*The animation would only ever play once.* React reuses a DOM node when only its
class changes, and a CSS animation on a reused node does not restart — so
complete, undo, complete again would animate the first time and never again. The
celebration hook returns an incrementing `id` that the animated elements are
keyed on, forcing a fresh node each time.

*The XP number had nowhere to go.* Floating it above the row put it behind the
list's `overflow-hidden`; floating it beside the flame put it on top of the
flame. It now **shares the flame's slot** — during the celebration the right-hand
slot shows `+55` instead of the flame, then swaps back. That is also the honest
thing to show, since the streak that flame represents is exactly what changed.

### Reduced motion is a real path, not a switch-off

`index.css` has a global guard collapsing every animation to 0.01ms. That means
an element with no `animation-fill-mode` snaps back to its **base** style — so
the base style has to be the correct still frame, not the starting one. The wash
is therefore transparent at rest (it should simply not happen) and the XP number
is **opaque** at rest, because it is information, not decoration: someone who
asked for less movement still needs to see what they earned. React unmounts it
at 750ms either way.

Verified in a `reducedMotion: 'reduce'` browser context rather than assumed:

```
flicker 1e-05s   fill 1e-05s   gem 1e-05s   xp 1e-05s
xp base opacity: 1     wash base opacity: 0
```

---

## Drag to reorder

Pointer events, not HTML5 drag-and-drop — which does not fire on touch at all,
so a drag feature built on it would not work on the device this app is for.

**The handle is a button and the arrow keys move the row.** Reordering is not
decoration here: this order is the order habits appear on the home screen, so a
handle that only responds to pointers would lock keyboard and switch users out
of a real feature. Every move is announced through a live region.

Rows are hit-tested by their actual bounding boxes rather than by an assumed row
height, because these cards are different heights and a fixed-height assumption
drifts further the longer the drag goes on. The new order is written once, on
release, rather than on every crossing.

Verified end to end in a real browser:

```
before drag:   Alpha, Beta, Gamma
after drag:    Beta, Gamma, Alpha
after reload:  Beta, Gamma, Alpha      ← persisted
after ArrowDown: Gamma, Beta, Alpha
announced: "Beta moved to position 2 of 3"
```

---

## The rest

**Per-habit detail screen** (`/habits/:id`) — its own twelve-week heatmap, the
streak with an explanation, and four stats. Split from the editor deliberately:
tapping a habit to *look* at it and tapping it to *change* it are different
intentions, and routing both to a form made the common one harder. Tapping a
card now opens the detail; Edit is a button on it.

**Bottom navigation** — 56px tall, icon plus label, active state carried four
ways (indicator bar, icon opacity, text colour, weight) and never by red text.
The icons are plain strokes rather than gems or flames on purpose: gold belongs
to habit icons and flame hues to the streak ladder, and a flame for "Today"
would dilute the one meaning the flame already has.

**Skeletons** replace every "Loading…" line — the app shell's first paint, the
home body, the habits list, the detail screen. They mirror the real components'
heights, which is the entire point: a skeleton of the wrong size just moves the
jump later.

**Empty states** — nine now, each with copy that says what to do next rather
than what is absent. The four new ones: no active habits but some archived
("Everything you have is archived, which is a perfectly fine place to be"), a
habit with no history, a habit that no longer exists, and an idle week
("Nothing has been scheduled yet this week. Not a miss — there is simply nothing
to report").

---

## Carried forward from step 4

**Type scale locked.** `--text-*: initial` clears Tailwind's built-in sizes, the
same fix that cured the radius problem. 22 usages of `text-xs`/`text-sm`/
`text-2xl` mapped onto the seven tokens; **zero** default sizes remain, and a
second type scale is now a build-time impossibility rather than a habit.

That immediately exposed a rule I had been breaking: three Settings headings
were **all-caps at 15px**, and the typography rule allows caps only at
`--text-micro`. They now use `label-caps` like every other section heading.

---

## Two defects found by looking at the rendered page

**The detail screen argued with itself.** It showed "47 of 80" next to "53%",
which do not reconcile — the rate was outcome-weighted (a partial counting 0.6)
while the fraction was not. A reader who divides concludes something is broken.

Fixed by splitting the two measures explicitly. `rate` stays weighted and drives
chart intensity and the "finding it hard" ranking, where a partial genuinely
beats a skip. A new `showedUpRate` is what a person is shown, and it counts a
partial in full — which is not only consistent with the fraction beside it but
is the philosophically correct headline: *"did you turn up"* is the question
this product cares about, and weighting it would quietly restore perfection as
the standard.

**Two sections both called "This week".** The bar chart is now "Day by day",
which is also a better description of it.

---

## Results

```
Test Files  19 passed (19)
     Tests  377 passed (377)
```

377 tests, up from 361: 16 added covering `domain/review.ts`, including both
rates, the idle-week case, and the "nobody is singled out on a perfect week"
rule.

Typecheck clean. Lint clean. Build clean.

```
── Today ──         contrast: all text passes
── Habits ──        contrast: all text passes
── Habit detail ──  contrast: all text passes
── Habit editor ──  contrast: all text passes
── Settings ──      contrast: all text passes
── Styleguide ──    3 failures (the deliberate demonstration rows)

radius census: 6, 10, 14, 20, 24 px — every one a token
```

`audit.mjs` now covers the detail screen too.

Verified in the built CSS rather than assumed: `complete-fill`, `xp-float`,
`gem-pop`, `skeleton` and `xp-sheen` are all present.

---

## What step 6 inherits

Step 6 is now a **pure deletion**. Legacy token references have been zero since
step 4; the `@theme` block in `index.css` has nothing pointing at it.

One thing worth a look while you are in there: the completed focus card is still
loose — a lot of padding under a short button row. It was easier to leave until
the completion animation existed, and now it does.
