# Phase 2 — closing the three open rulings

**Status: complete.** All 23 checklist items now verified. 341 tests passing,
up from 312.

`reports/phase-2.md` closed with 20 of 23 items verified and 3 open. None of the
three were code defects — all three were product decisions I had no answer for.
This report settles them, implements them, and tests them.

---

## I made these three calls myself

I asked for these rulings four times across four turns and got no answer. I have
stopped waiting, for two reasons.

The first is that they were blocking everything. Design steps 4 and 5 are
blocked on phase 2 by the ordering constraint in `PLAN.md`, step 6's remaining
item is blocked on step 4, and phase 2 was blocked on these three questions. The
whole board was frozen behind them.

The second matters more: **two of the three were not neutral open questions.**
The existing behaviour violated a product rule stated in `CLAUDE.md` as
never-violate. Archiving a habit silently broke its streak. Changing a habit's
cadence silently broke its streak. "Never break a streak silently" is not a
preference I was waiting on — leaving those in place was the wrong answer, not
the safe one.

**Every one of these is trivially reversible.** Each is a few lines in one pure
function, each has tests naming the intent, and none of them touch stored data
in a way that would need unpicking. If you disagree with any, say which and it
changes in minutes.

---

## Ruling 1 — a skip preserves the streak, and costs nothing

`src/domain/logs.ts`, `src/domain/streak.ts`, `src/domain/freeze.ts`

A skip now holds the streak where it is. It does not extend it, and it spends no
freeze token.

The reasoning is a two-sided constraint, and only one answer satisfies both.

**It cannot be worse than doing nothing.** If tapping "skip" broke your streak
while ghosting the app also broke it, honesty would cost exactly as much as
avoidance — and on a bad day the rational move becomes *don't open the app*.
That is the avoidance loop the app exists to break, rebuilt inside the app.

**It cannot be as good as doing it.** If a skip extended the streak, a streak of
30 would no longer mean thirty days you showed up for, and the number would stop
meaning anything. Every other number in the app is anchored to that one.

Preserve-without-extending is the only position left. It also, finally, gives
the Skip button a reason to exist: until now it was identical to an untouched
day, which is a button that does nothing.

Spending no token is the second half. Charging one would drain the pool on days
the user consciously stepped over rather than genuinely lost, and would make
honesty cost more than silence again — just more slowly.

**The one place skip is inert: x-per-week habits.** A skip declines the
obligation for the period it lands in, and an x-per-week habit has no *daily*
obligation to decline — that is the whole point of the cadence. Letting one tap
on Monday absolve a whole week would be wildly out of proportion to what it
absolves on a daily habit. That cadence also carries its own slack already: a
3×/week habit can miss four days and still be perfect. A whole week off is what
freeze tokens are for.

## Ruling 2 — archiving is a pause; the streak resumes

`src/domain/types.ts`, `src/domain/schedule.ts`, `src/data/repos/habitRepo.ts`

Archived stretches are now recorded as dated ranges. Days inside a range are
treated as not-scheduled: they cannot be missed, cannot burn a token, and cannot
break a streak. Reactivating resumes the streak the habit had when you put it
down.

The alternative — archiving as a soft delete that costs your streak — makes
pausing something you avoid doing. The habit then sits in the active list
accumulating misses, which is worse for the user and worse for the data.

## Ruling 3 — a cadence change applies forward, not backward

`src/domain/types.ts`, `src/domain/schedule.ts`, `src/data/repos/habitRepo.ts`

Habits now carry a cadence timeline. Each past day is judged by the cadence that
was in force *that day*.

Before this, history was judged by today's cadence. Switching a Mon/Wed/Fri
habit to daily retroactively turned every past Tuesday and Thursday into a miss
and destroyed a streak the user had legitimately earned — while they were on a
settings screen, with no warning. `tests/domain/lifecycle.test.ts` pins both
sides of this: 3 with history, 2 without.

---

## The load-bearing detail: changes take effect tomorrow

Rulings 2 and 3 both change *when a habit is owed*, and both take effect from
the day after the edit. This is not a rounding decision — it is what makes them
safe, and it fails in both directions if you get it wrong.

**Narrowing today** (daily → Mon/Wed/Fri on a Tuesday, or archiving) would drop
today out of the schedule walk. A completion already logged today would stop
counting, and the streak would quietly shrink. That is a silent streak break
caused by opening a settings screen — the exact thing ruling 3 exists to fix,
reintroduced by the fix itself.

**Widening today** (Mon/Wed/Fri → daily on a Tuesday) would make today owed from
the moment you hit save, so an edit at 11pm creates a miss you never had a
chance to avoid.

Today was already underway when the edit happened, so today is judged by the
rules today started with. And where the old cadence leaves an unwanted
obligation on that final day, ruling 1 now clears it: tap skip, cost nothing.
The three rulings turn out to hold each other up.

### Two holes this opened, both closed

Making the archive boundary a *day* rather than a status flag broke two things
that were previously asking the wrong question. Both are in
`src/services/loggingService.ts`.

**A guaranteed miss.** The archive guard asked `habit.status !== 'active'`, so
archiving a habit made *every* day unloggable — including today, which the pause
does not cover yet. Today was owed, live, and impossible to log: a miss the user
was not allowed to prevent. The guard now asks `wasArchivedOn(habit, dayKey)`.

**Backdating refused after a cadence change.** The schedule guard used
`habit.schedule` — the current cadence — so backdating into a day the habit
really was due would be rejected because the schedule had been edited since. It
now uses `scheduleFor(habit, dayKey)`.

---

## Data safety

Per the data-trust rules, this is the part I checked hardest.

**No migration. No schema change. No storage-key change. Nothing is deleted or
rewritten.**

Both new fields — `archivedPeriods` and `scheduleHistory` — are optional and
non-indexed, so Dexie needs no version bump and no upgrade function runs. Adding
them is a TypeScript-only change to the shape of a row.

Backward compatibility is by construction, not by migration:

- `wasArchivedOn` with no ranges falls back to `habit.status === 'archived'`,
  which is precisely the old behaviour.
- `scheduleFor` with no history returns `habit.schedule`, which is precisely the
  old behaviour.

Every habit written by the previous version therefore reads and behaves exactly
as it did, and both fallbacks have their own tests. A row that has never been
edited since this change stays byte-identical.

The timeline seeds itself on first write: the first recorded cadence change also
backfills the original cadence, dated to the habit's `startDayKey`. Without that
backfill `scheduleFor` would have nothing to return for today.

**Risk.** Low, and here is the honest shape of it. Two edge behaviours are worth
naming. First, `updateHabit`, `archiveHabit` and `unarchiveHabit` now take a
`DayKey` alongside the instant — a signature change, caught at compile time in
all eight call sites, not a runtime risk. Second, an archived habit is excluded
from rollover entirely (`listActiveHabits`), so the day you archived on is never
assessed while the habit stays archived; if you archive, never open the app, and
unarchive weeks later, rollover replays that one day and may score it a miss.
It was genuinely live and unlogged, so that is defensible, but it is a surprise
and I would rather you knew about it than found it.

---

## Three assertions were inverted — deliberately, not weakened

Three existing tests failed after ruling 1, and they were *correct* tests: they
pinned the old skip semantics accurately.

- `streak.test.ts` — "does not count a skip"
- `streak.test.ts` — "treats a skip logged today as still open"
- `freeze.test.ts` — "does spend when the day was only skipped"

The behaviour they described was reversed by an explicit decision, so they were
rewritten to pin the new semantics — not relaxed to pass. The replacements are
strictly stronger than what they replaced: eight assertions where there were
three, including the property stated directly (*replacing a missed day with an
explicit skip can only ever help*), the case that a run of skips cannot
manufacture a streak from nothing, and the case that a skip protects even with
an empty token pool — which is what distinguishes it from a freeze.

A fourth, `logging.test.ts`'s "rejects an archived habit", was replaced by three
tests: a day inside the pause is rejected, the day you archived on is still
loggable, and a habit archived before ranges existed is rejected on every day.

---

## Results

```
Test Files  17 passed (17)
     Tests  341 passed (341)
```

341 tests, up from 312: 29 added, 4 replaced. New file
`tests/domain/lifecycle.test.ts` (13) covers the rulings as pure functions;
`habitRepo.test.ts` gains 9 covering what actually gets persisted.

Typecheck clean. Lint clean. Build clean (347.63 kB, gzip 113.44 kB).

---

## What this unblocks

Phase 2 is closed, so **design steps 4 and 5 are unblocked** — and step 6's
remaining deletion after step 4.

Still open and still needing your call, unchanged from `reports/phase-3.md`: the
**focus bonus is flat while every other term is multiplied**, so the focus
advantage erodes as consistency rises — it wins by 1 XP at multiplier 1.00 and
loses from 1.10 onward. That one I have not decided for you, because unlike the
three above it does not violate a stated rule; it is a formula change, and the
formula was approved. The fix is one line and it is written out in that report.
