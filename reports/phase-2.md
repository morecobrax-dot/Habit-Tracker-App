# App phase 2 — logging and streaks

**Status: not complete.** 20 of 23 checklist items verified and ticked.
Three remain, all blocked on product decisions rather than on code.

> Filed as `phase-2.md` rather than `step-2.md`: `PLAN.md` runs two tracks,
> and design step 2 also exists. `step-2.md` would be ambiguous.

---

## What this audit actually is

Phase 2 was implemented in `cda25fd` and phase 3 in `28dc52f`, but `PLAN.md`
was written as though neither had happened — the file was uploaded with those
boxes unticked. So this is not a build report. It is a line-by-line audit of
the shipped code against the phase 2 checklist, ticking only what could be
proven and identifying what was genuinely missing.

That produced three real findings, described below. Two of the three had
correct behaviour that was simply untested, which for an edge case is the same
as unhandled: an untested edge case is a guess.

---

## Verified — evidence per item

### Logging

| Item | Evidence |
|---|---|
| Records habit id, applied date, completion type, created-at | `HabitLog` stores `habitId`, `dayKey` (applied), `outcome`, `loggedAt` (created). The two dates are separate fields, so backdating makes them differ without either being lost. |
| One log per habit per day; updates, never duplicates | Unique compound index `&[habitId+dayKey]` in `data/db.ts`; `upsertLog` finds-then-writes inside a transaction. Proven by the new concurrency test below. |
| Backdating limited to the previous 2 days, enforced in logic | `isWithinBackdateWindow` in `domain/time/dayKey.ts`, called by `loggingService` before any write. Rejects both older days and the future. Configurable via `backdateWindowDays`. |

### Streaks

| Item | Evidence |
|---|---|
| Daily — consecutive qualifying days | `dailyStreak` in `domain/streak.ts`. |
| Specific weekdays — only scheduled days can break | `scheduledDaysBetween` filters the walk, so a Mon/Wed/Fri habit steps over Tuesday entirely. |
| X-per-week — evaluated by week; current week never broken while in progress | `weeklyStreak`; the in-progress week sets `pending` instead of breaking. |
| Complete and partial both keep a streak alive | `isCredited` accepts both. |
| Current and longest tracked per habit | `StreakResult.current` / `.longest`. |

### Freeze tokens

| Item | Evidence |
|---|---|
| Earned weekly to a small cap, rate proposed with reasoning | 2 per week, cap 4. Reasoning: two covers a normal bad patch without making misses free; the cap stops a long absence banking invulnerability. `computeFreezeGrant`. |
| Consumed automatically, visibly | `planRollover` spends; every spend writes a `FreezeEvent`; the rollover notice and the habit row both surface it. Satisfies "never break a streak silently". |
| Cannot go negative, cannot be spent retroactively beyond the window | Spending is guarded on `tokens > 0`. `lastRolloverDayKey` means each day is settled exactly once and never re-settled, so no user action can reach back and spend a token on already-settled history. Catch-up after an absence is bounded at 60 days. |

### Edge cases

| Item | Evidence |
|---|---|
| Day rollover — one configurable boundary | `dayStartHour`, default 04:00. All day attribution goes through `toDayKey`. |
| Habit created mid-week — first x-per-week window | A partial first week cannot break a streak: three sessions were never available in it. Tested. |

### Tests / UI

Pure functions with the date passed in — enforced by an ESLint rule on
`src/domain/**` that bans `Date.now()` and `new Date()` outright, verified to
fire. Streak and XP tests predate the UI built on them. Logging UI is minimal.

---

## Findings

### 1. Three edge cases were implemented but untested

Correct behaviour, no proof. Now covered by
`tests/services/phase2EdgeCases.test.ts` (7 tests, all passing on first run —
no behaviour changed):

- **Timezone change while travelling.** A `DayKey` is resolved once at write
  time and stored, never recomputed, so flying UTC → UTC+14 cannot move
  yesterday's completion onto another day. Tested for: past logs unchanged, no
  duplicate row when the same day is logged again after the change, and the
  boundary itself correctly following the new zone for *new* logs.
- **Rapid repeated submission.** Eight concurrent `logHabit` calls for the same
  habit and day produce exactly one row and bank 18 XP once. A racing mix of
  skip/partial/complete also settles on one row, and the XP ratchet guarantees
  the banked award is never the lower of the racers.
- **A backdated log repairing a broken streak.** Because streaks are derived
  from the logs on every read rather than stored, filling a gap rejoins the runs
  either side with no repair step that could go wrong: 1 → 3 on backdating the
  hole. Also tested that a gap older than the window cannot be repaired.

### 2. "Skipped" is currently identical to untouched — contradicts the plan

`PLAN.md` requires: *"'Skipped' is a deliberate user action and is not the same
as an untouched day. Treat them differently in streak rules."*

The code does not. `isCredited` returns false for both, and rollover will spend
a freeze token to cover either. They are indistinguishable to every streak rule.

This is not an oversight — it was an explicit earlier decision ("skip is
bookkeeping only, treated exactly as a miss"). `PLAN.md` now says the opposite.
The two cannot both hold, so this needs a decision rather than a guess.

Worth noting the trap in the obvious fix. Making skip *forfeit* freeze
protection would treat the two differently, but it would mean tapping Skip
leaves you worse off than silently ignoring the app — punishing honesty, which
the no-punishment rule forbids. Any workable answer has to make skipping at
least as good as ghosting.

### 3. Two edge cases are not handled at all

Both need a product answer; `PLAN.md` asks for a proposal on each.

**Habit archived then reactivated.** Archived habits are excluded from streak
computation. On reactivation the streak recomputes across the whole history
*including the archived stretch*, so every archived day counts as a miss and the
streak is broken. Archiving is a deliberate pause, not a failure, so this
silently destroys a streak — which the product rules forbid.

**Cadence changed on a habit with history.** Streaks recompute against the
*current* cadence retroactively. Switching a Mon/Wed/Fri habit to daily makes
every past Tuesday and Thursday a miss, retroactively destroying a streak the
user had legitimately earned. Same violation, worse blast radius.

Both share a root cause: the habit stores only its *present* shape, so history
is always judged by today's rules. Fixing either properly means recording when
a habit's shape changed — an additive, effective-dated record — which is a data
change and therefore needs approval before I write it.

---

## Test results

```
Test Files  14 passed (14)
     Tests  291 passed (291)
```

Typecheck clean. Lint clean. Build clean.

---

## Recommendation

Do not tick phase 2. The three open items are behavioural rules, not polish,
and two of them can silently destroy a streak — the specific failure the
product rules single out. They should be settled before the home page is built
on top of this data in design step 4.

Design step 3 (the streak flame) is unblocked and independent, so it can
proceed in parallel while these are decided.
