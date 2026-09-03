# App phase 3 — XP and levels

**Status: complete.** All four checklist items verified and ticked.

One significant finding that does not block the tick but does need a decision:
the daily-focus incentive weakens as an account matures, which undercuts the
product's central claim. Detailed below with a proposed fix.

> Filed as `phase-3.md`, matching `phase-2.md`. `PLAN.md` runs two tracks and
> `step-3.md` is already the streak flame.

---

## Why this step

Phase 2 has three open items awaiting product rulings, unanswered across two
turns. Design steps 4 and 5 are blocked on phase 2 because they read real
streak data. Step 6 is a cleanup pass over screens that step 4 is about to
rebuild, so running it now would mean auditing them twice.

Phase 3 shipped in `28dc52f`, before `PLAN.md` existed, so its boxes were never
ticked. It is the next unchecked item that is not blocked, so this is an audit
of the shipped code against the checklist — the same treatment phase 2 got.

---

## Verified — evidence per item

### XP per log: difficulty, completion type, multiplier, focus bonus

```
xp = round(base(difficulty) × completionFactor(outcome) × consistencyMultiplier)
     + focusBonus
```

Every term is present in `domain/xp.ts#awardXp`, and every constant lives in
`domain/rules/xpRules.ts` as plain data rather than being scattered through the
scoring code.

| Term | Implementation |
|---|---|
| Difficulty | `baseXpByDifficulty` — 10 / 18 / 30 / 45 |
| Completion type | `completionFactors` — complete 1.0, partial 0.6, skip 0 |
| Multiplier, capped | Consistency over a trailing 14 days, capped at 1.30 |
| Daily-focus bonus | Flat +25 |

**On "streak multiplier".** The checklist says streak multiplier; the code uses
a *consistency* multiplier. That is not drift — it was an explicit instruction:
"Use the proposed trailing consistency multiplier, NOT a raw streak-based XP
multiplier." A streak multiplier collapses from 1.30 to 1.00 the moment a
streak breaks, a 23% pay cut for one bad day, which a loss-averse reader
experiences as punishment and which bites hardest exactly when the user most
needs permission to do the two-minute version. The consistency multiplier moves
1.30 → 1.28 for the same miss and recovers within days. Ticked against the
approved design rather than the earlier wording.

### Level curve: fast early, progressively slower

`xpToNext(n) = round(40 × n^1.35)` in `domain/level.ts`. 16 tests, cross-checked
against an independent implementation of the written formula across levels 1-60
and every boundary to level 30. Levelling twice on day one; roughly a level per
week by month three.

### Formula and curve proposed with a worked example, approved before implementing

The proposal and its worked week were agreed in conversation before any code was
written. That artefact lived only in the conversation, so it is now pinned as a
test — `tests/domain/workedWeek.test.ts` replays a realistic week through the
*shipped* rules rather than through prose.

Recomputing it against the real implementation found the approved example was
optimistic: **499 XP, not the ~516 estimated**, about 3% high. The estimate used
an approximated multiplier ramp; the real ramp starts lower. The shape is
unchanged — level 4 at week's end, two level-ups in the first two days — so the
approval still stands on accurate figures.

The week the test replays, and what it proves:

| Day | Logged | XP | Level |
|---|---|---|---|
| Mon | 4 habits, all complete | 109 | 2 |
| Tue | 2 complete, 2 partial (one is the focus, at its minimum) | 96 | 3 |
| Wed | 3 complete | 105 | 3 |
| **Thu** | **nothing at all** | **0** | **3** |
| Fri | 3 complete, 1 partial (focus, completed) | 108 | 4 |
| Sat | 3 complete | 60 | 4 |
| Sun | 1 complete, 1 partial | 21 | 4 |

Thursday is the important row: zero earned, running total unchanged, level
unchanged. Missing a day is a lack of gain and never a loss. Friday's first log
then levels the user up — coming back is rewarded immediately.

### Daily focus: surfaces the longest-avoided habit with bonus XP

`domain/focus.ts` scores neglect and picks a habit; `services/focusService.ts`
persists one choice per day so it cannot reshuffle on refresh. 26 tests covering
neglect scoring, cadence awareness, the anti-nag cooldown, and month and year
boundaries.

---

## Finding: the focus incentive erodes as an account matures

The product's central claim is that the app pays most for *starting the thing
being avoided, at its smallest size*. That holds on a new account and then stops
holding, because **the focus bonus is flat while every other term is
multiplied**.

Tier-1 habit at its minimum version, as the day's focus, against a full tier-3
completion:

| Consistency multiplier | Focus minimum | Tier-3 complete | Focus wins? |
|---|---|---|---|
| 1.00 | 31 | 30 | yes, by 1 |
| 1.10 | 32 | 33 | **no** |
| 1.20 | 32 | 36 | **no** |
| 1.30 | 33 | 39 | **no** |

So the mechanic is strongest for a user who has just started and weakest for one
who has built consistency — exactly backwards, since an established user is the
one with entrenched avoidance patterns. It is also why the existing assertion in
`xp.test.ts` passes: it uses zero-history habits, so it only ever tests the
multiplier-1.0 case. It passes for the wrong reason.

Recorded as a pinned test rather than silently fixed, because `PLAN.md` requires
approval before changing the formula.

**Proposed fix — scale the bonus with the same multiplier:**

```
+ round(focusBonus × consistencyMultiplier)
```

That keeps the relationship invariant instead of letting it drift:

| Multiplier | Focus minimum | Tier-3 complete | Focus wins? |
|---|---|---|---|
| 1.00 | 31 | 30 | yes |
| 1.10 | 35 | 33 | yes |
| 1.20 | 37 | 36 | yes |
| 1.30 | 41 | 39 | yes |

It is a one-line change in `awardXp` and a constant already in `XpRules`. It
does not inflate early rewards, and it makes the incentive a property of the
design rather than an accident of where the multiplier happens to sit.

A deliberate non-goal: the focus minimum still should not out-earn a *full
tier-4 completion* (36 against 45). Paying more for two minutes of admin than
for a completed hour of deep work would distort the board in the other
direction.

---

## Test results

```
Test Files  16 passed (16)
     Tests  312 passed (312)
```

Typecheck clean. Lint clean. Build clean.

---

## Next

Phase 2's three rulings remain the blocker for design steps 4 and 5. The focus
bonus question above is independent of them and is a small change whenever it is
wanted.
