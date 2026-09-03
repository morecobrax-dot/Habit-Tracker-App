# Premium product pass — audit, implementation, QA

Not a `PLAN.md` step. This was a full-product pass run outside the plan
sequence, so nothing here ticks a box. The plan is complete as of design
step 6; this is the first pass over the finished thing as a product rather
than as a checklist.

The method mattered more than usual: the audit was done in **rendered
pixels**, not in source. Four of the defects below are invisible in the
code and obvious on a phone screen, which is a useful thing to know about
this codebase — it reviews well and did not, until now, look as good as it
reads.

---

## 1. Audit

Screenshots at iPhone 13 width, against a seeded account with real
history: three habits, nine days of logs, two live streaks, one neglected
focus habit, two freeze tokens.

### B1 — "Not started yet" on a habit with months of history

`StreakLabel` printed *Not started yet* whenever the current streak was
zero. For a habit done ninety times and missed yesterday, that is both
false and discouraging: it erases the work rather than describing the
state.

Fixed in `domain/momentum.ts` — `describeDormantStreak(hasHistory)`
returns *Streak paused* when there is history behind it. `useDayView` now
carries `hasHistory` per entry so the UI can tell the two cases apart.

### B2 — the home page opened with a monument to a broken streak

The worst finding, and only visible rendered. The page led with
`StreakHero`: a bare flame and the best streak, at `--text-hero` (56px).
On any missed day that became **a large grey zero as the single biggest
element on the screen**.

No XP was taken, so it passed the letter of *no punishment mechanics*
while breaking its spirit as loudly as the layout allowed. A user opening
the app after a bad day was met by a monument to the bad day.

Replaced with `TodayCard`. The headline is now today's progress, which is
always actionable and never a verdict on the past. The flame survives as
supporting detail on the right, and only renders when something is
actually lit — a streak of zero draws nothing at all.

### B3 — the weekly completion rate counted the day you were standing in

`reviewWeek` ran to `today`. At 8am on Thursday, Thursday's habits are
"due and unmet", so the headline percentage was at its lowest exactly
when someone opened the app to decide what to do — a number that drops
every morning for a reason the user cannot act on yet.

Now runs to `addDays(today, -1)`. `habitStats` already excluded the
future for the same reason; today is the same case, since a day you have
not lived yet is not evidence about you. The live state of today is the
day card's job, so nothing is lost.

### B4 — the empty account still rendered a history section

An account with no habits got the backdate bar and twelve weeks of blank
heatmap under the empty state. Guarded on `activeHabitCount > 0`.

### Missing, not broken

- The two-minute version — the app's signature move — was **two taps deep
  on every habit except the focus**. The escape hatch was hardest to
  reach on exactly the days it exists for.
- A habit's own page answered "what is my score" and not "when did I last
  do this" or "is this on today".
- `requestPersistentStorage()` has been called since phase 1 and its
  answer was never shown anywhere. On an app whose entire storage model
  is one device with no backend, *is my history safe here?* had no answer
  in the product.
- Every card in the app was the same flat rectangle on the same
  near-black ground. No hierarchy, so no screen told you where to look.

---

## 2. What was built

### Depth: three tiers, and one hero per screen

`tokens.css` gains `--shadow-raised / -lifted / -hero`, plus lit variants
for the two that can be *earned*. `index.css` pairs each with a top-down
gradient a few percent lighter at the top.

The inset highlight is what does the work. On a near-black ground a drop
shadow is invisible; a hairline lit edge along the top reads as a card
catching light from above, which is the difference between a card and a
div with a border.

| Tier | Where | Signal |
|---|---|---|
| `raised` | every `Card`, habit rows, stats, settings groups | ordinary |
| `lifted` | the day card | land here second |
| `hero` | the focus card, alone | the one thing that matters |

The hero's inset picks up `primary-hot` rather than white, so the card
reads as lit *by* the accent — the "radiance around the red" the design
direction asks for, contained to one element so the app never looks like
a gaming UI.

**One box-shadow gotcha, worth writing down:** `box-shadow` does not
merge across declarations, and a Tailwind `shadow-*` utility lands in a
later layer than a hand-written component class. Stacking
`shadow-glow-medium` on `.surface-hero` therefore *erases* the depth
instead of adding to it. Hence `--shadow-hero-lit` and
`--shadow-lifted-lit` as single combined tokens rather than two classes.

`.surface-lifted-lit` exists specifically so the completed day card can
look earned without becoming a second hero. Two glowing surfaces stacked
at the top of the page is how a restrained UI turns into a gaming one.

### `domain/momentum.ts` — what today asks, and what is about to lapse

`summariseToday` returns the day's counts plus `atRisk`, and `atRisk` is
**deliberately narrow**: only habits with a live streak that today would
end. The distinction it draws is between pressure and support.

- A habit with no streak that is unlogged is simply unlogged. Nothing is
  at risk, because nothing is at stake. Listing it would be nagging.
- A habit with a live streak that is unlogged has something concrete and
  finite about to lapse. Saying so is information the user wants, and the
  UI pairs it with that habit's two-minute version — the way back in, not
  the size of the hole.

On a day where nothing has been built yet the list is empty and the
screen says nothing about failure. A new user is never shown a list of
ways they are failing.

Freeze cover is allocated biggest-streak-first, matching `planRollover`,
so "a freeze can cover it" is only promised where a token can actually
pay for it. Saying "covered" and then breaking the streak at rollover
would be worse than saying nothing.

18 tests.

### `domain/cadence.ts` — a habit as a real object

`habitCadence` answers the two ordinary questions a habit's page was
missing: *when did I last do this* and *what does today ask of it*.

Notes on the edges, all tested:

- A **skip** is not a completion. It holds the streak, but "last done"
  must mean the habit was done, or it is a lie the user can disprove.
- **Future-dated logs are ignored.** They should not exist — the backdate
  window only looks backwards — but an imported backup from a device with
  a skewed clock can carry one, and *last done: tomorrow* is worse than
  ignoring it.
- The **weekly quota is only computed for `timesPerWeek`**. Daily and
  set-day habits have a per-day obligation, and "4 of 7 this week" for
  them turns Thursday morning into a report of everything not yet done.
  `isScheduledOn` draws the same line for the same reason.
- **Cadence history is respected.** Switching a habit to weekends does
  not make today "on" because the old cadence said so.
- The quota **outranks "done today"** in the status line: today's
  completion is already inside it, and "2 of 3 this week" answers both
  questions where "logged" answers one.

Copy is a fact, never a verdict. One test asserts that directly —
`describeLastDone` must not contain *fail*, *lost*, *broke*, *behind*,
*should* or *only* at any gap length. "17 days since you last managed
this" is punishment written as a statistic.

27 tests.

### The two-minute version, one tap from anywhere

Every uncompleted habit row now carries an inline `2-min` button, and so
does every entry in the at-risk list. One tap, no expanding, no dialog.
On the day someone is least likely to act, this is the shortest path the
app can offer.

The expanded row keeps the two-minute text spelled out, because the
compact button says "2-min" without saying *what* the two minutes are.

### Storage status in Settings

Three states, not two. `unsupported` is genuinely different from
`best-effort`: a browser with no Storage API gives the user nothing to
do, whereas one that has merely declined usually grants persistence once
the app is installed to the home screen. Collapsing them would mean
either giving useless advice or withholding useful advice.

Read-only — the request itself still happens once at startup. Asking
again on every visit to Settings would be a permission prompt nobody
asked for. Nothing renders until the answer is known: a default of "at
risk" that corrects itself a frame later is a false alarm about the
user's data.

State is carried by shape as well as colour — a filled dot versus a
hollow ring — so it does not depend on hue.

### Copy fixed where it disagreed with the screen

- *"67% of 9 closed days"* — `due` counts habit-days, so three habits
  over three closed days is nine chances, not nine days. The figure
  disagreed with the calendar directly below it. Now *"of 9 due, through
  yesterday"*, which also states the B3 boundary out loud.
- *"0 / 3 done"* — the same fact as "3 things to do", but a large zero
  was the biggest thing on screen at the start of **every single day**: a
  scoreboard reading nil where the moment needs an instruction. Below the
  first completion the card now leads with what there is to do; above it,
  with the fraction. The headline numeral is never zero.
- *"Last done: Done today"* beside *"Today: Done today"* — one fact
  printed twice reads as a rendering fault. `describeLastDone(0)` now
  answers *when* ("Today") and the status line answers *what now*. A test
  asserts the two strings differ.

### Two rule violations in the styleguide — mine

`ContrastRow` rendered the failing `text-disabled` token **as text, in
itself**, to demonstrate the failure. That is the rule being broken on
the page that documents the rule. It also put three permanent entries in
every `audit.mjs` run, and permanent noise is how a real regression gets
scrolled past.

Worse, the failing ratio was printed in `--color-danger` — **red text**,
which `CLAUDE.md` forbids outright. It passed the numeric contrast check,
which is exactly why the rule is categorical rather than measured.

Now: the failing token is shown as a swatch bar with its label in
`text-secondary`, and the verdict is carried by a mark and by weight. The
failure is stated more loudly than before, since it is now legible.

### A banned class that was still shipping — found by grepping the build

Step 6 removed pure white from the app and wrote up why. Checking the
built CSS this pass, `.text-white{color:var(--color-white)}` was **still
in it** — resurrected by step 6's own report quoting the class name in
prose, and by a line in `PLAN.md` describing the bug.

Tailwind v4 scans the whole repository for class candidates and cannot
tell a component from a paragraph about one. This repo documents design
decisions in markdown, so it names classes constantly; the previous fix
was "remember not to quote a class name", which lasted exactly one
report.

`src/styles/index.css` now carries `@source not "../../**/*.md"`. CSS
drops 44.96 → 43.82 kB, and every non-token colour utility is gone from
the build — `.text-white` included.

Worth knowing: `@source` paths resolve relative to **the CSS file**, not
the project root. A root-relative glob silently matches nothing and the
build still succeeds, so the first `@source not "**/*.md"` looked like it
worked and changed nothing. The comment in the file says so.

---

## 3. QA

| Check | Result |
|---|---|
| `tsc -b` | clean |
| `eslint .` | clean, including the domain-boundary rules |
| `vitest run` | **443 passed**, 22 files (was 396) |
| `npm run build` | clean · 43.82 kB CSS (8.40 kB gz), 383 kB JS (123 kB gz) |
| Non-token colour utilities in the build | **0** (was 1: `.text-white`) |
| PWA precache | 16 entries, 506 KiB · `sw.js` generated |
| `audit.mjs` contrast | **0 failures across all six screens** (was 3) |
| `audit.mjs` radius | 20 / 14 / 10 / 6 / 24px only — every value a token, no drift |

Rendered verification at phone width: in-progress home, all-done home,
habit detail, settings. The hierarchy reads as intended — the focus card
is unambiguously the hero, the day card sits second, the habit list is
quiet.

### Data safety

**No schema change. No migration. No write-path change.** Nothing in this
pass touches how logs, XP, levels or streaks are stored or awarded.

- `domain/momentum.ts` and `domain/cadence.ts` are pure read-side
  derivations. Both take `today` as a parameter; neither reads the clock.
- The only new storage API is `storagePersistence()`, which reads
  `navigator.storage.persisted()` and writes nothing.
- The B3 fix changes a *displayed* percentage. No stored value moves.
- Snapshotted `xpAwarded` and `rulesVersion` on existing logs are
  untouched, so history cannot be retroactively rescored.
- Export/import format unchanged; old backups restore unchanged.

### Deployment

The app is a static PWA. `registerType: 'autoUpdate'` plus the active
checks in `services/swUpdates.ts` mean an installed phone picks this up
on its next foreground or within 30 minutes, and reloads at a safe
moment. The build stamp in Settings identifies which build a device is
actually running.

### Still needs real-device QA

- The depth tiers on a real OLED panel. The inset highlights are a few
  percent of `text-primary`; they were tuned in a headless Chromium
  screenshot, and OLED black plus auto-brightness is a different surface.
- The `2-min` button's tap target with a thumb. It is 36px tall in a row
  that is comfortable to mis-tap.
- Whether "3 things to do" still reads right at nine habits, where the
  number stops being a small commitment.

## Recommendation

Stop here and use it. The next thing worth building is not another
surface but **evidence**: a week of real logging will say more about the
focus mechanic and the at-risk framing than another design pass will.
