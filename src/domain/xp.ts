/**
 * XP scoring. Pure: logs and rules in, a number out.
 *
 *   xp = round(base x completionFactor x ownMultiplier
 *              + focusBonus x bestMultiplier)
 *
 * ## Why consistency, not streak
 *
 * A streak multiplier drops from its maximum to 1.0 the instant a streak
 * breaks. No XP is subtracted, so it passes the letter of "never punish" — but
 * a ~23% pay cut for one bad day is read by a loss-averse brain as punishment,
 * and it manufactures precisely the "I cannot afford to miss" dread that drives
 * avoidance. It is worst exactly when it matters most: on day 20 of a streak,
 * when the user most needs permission to do the two-minute version.
 *
 * The consistency multiplier measures completions over a trailing window
 * instead. Missing one of the last fourteen days moves it from 1.30 to 1.28 and
 * it recovers within days of coming back. The streak still shows as a number
 * for the satisfaction of it; it just does not gate the reward.
 *
 * ## The focus bonus: flat in difficulty, scaled by consistency
 *
 * The bonus must not scale with *difficulty*. That would make hard habits the
 * best focus targets, and avoided tasks are usually trivial-but-dreaded — make
 * the call, open the letter. Keeping it flat in difficulty is what makes a
 * tier-1 avoided habit, done at its two-minute minimum, worth more than a
 * tier-3 habit completed in full. The app should pay most for starting the
 * thing being avoided, at its smallest possible size.
 *
 * It must scale with *consistency*, and this took two goes to get right.
 *
 * v1 left the bonus flat while every other term was multiplied, so the bonus
 * was a shrinking share of a growing award and the invariant held only at a
 * multiplier of exactly 1.00. v2 scaled it by the habit's own multiplier,
 * which fixed the like-for-like comparison but not the lived one: the
 * multiplier is per-habit and the focus habit is the *neglected* one by
 * construction, so its multiplier is structurally the lowest on the board
 * while the habits it competes against sit near the top. A neglected habit
 * still paid less than a well-kept tier-3 completion.
 *
 * v3 scales the bonus by the account's **best** multiplier instead. The bonus
 * exists to win a comparison against whatever else the user could do today, so
 * it is sized against exactly that: the best any habit of theirs is currently
 * paying. The habit's own multiplier still scales its own base XP, which stays
 * honest about the habit's own record — only the bonus borrows.
 *
 * Borrowing is safe *only* because focus status is capped at one habit per
 * day, structurally: `dayKey` is the primary key of the `dailyFocus` table, so
 * IndexedDB physically cannot hold two rows for one day. Without that cap this
 * would be a multiplier every habit could claim at once. `tests/services/
 * focusCap.test.ts` asserts it.
 *
 * The rounding is one pass over the whole sum. Two roundings compound, and at
 * 1.05 that was the difference between winning and tying.
 */

import type { DayKey, Habit, HabitLog, LogOutcome, Weekday } from '@/domain/types'
import type { XpRules } from '@/domain/rules/xpRules'
import { addDays, compareDayKeys, maxDayKey } from '@/domain/time/dayKey'
import { indexLogsByDay, isCredited } from '@/domain/logs'
import { scheduledDaysBetween } from '@/domain/schedule'

export interface XpBreakdown {
  base: number
  completionFactor: number
  consistencyMultiplier: number
  focusBonus: number
}

export interface XpAward {
  total: number
  breakdown: XpBreakdown
  rulesVersion: string
}

export interface AwardXpInput {
  habit: Habit
  outcome: LogOutcome
  /** The day being logged. Consistency is measured over the days *before* it. */
  dayKey: DayKey
  /** All logs for this habit. */
  logs: readonly HabitLog[]
  isFocus: boolean
  weekStartsOn: Weekday
  /**
   * The highest consistency multiplier across the user's active habits today,
   * from `bestConsistencyMultiplierFor`.
   *
   * Only the focus bonus uses it. Omitted, the habit's own multiplier is used,
   * which is the v2 behaviour — so a caller that forgets under-pays the bonus
   * rather than inventing one, and every existing call site stays valid.
   */
  bestConsistencyMultiplier?: number
}

export function awardXp(input: AwardXpInput, rules: XpRules): XpAward {
  const { habit, outcome, dayKey, logs, isFocus, weekStartsOn } = input

  const base = rules.baseXpByDifficulty[habit.difficulty]
  const completionFactor = rules.completionFactors[outcome]

  // A skip earns nothing, focus bonus included. Rewarding it would make the
  // bonus farmable and would cheapen every genuine focus completion.
  if (completionFactor <= 0) {
    return {
      total: 0,
      breakdown: { base, completionFactor, consistencyMultiplier: 1, focusBonus: 0 },
      rulesVersion: rules.version,
    }
  }

  const consistencyMultiplier = consistencyMultiplierFor(
    habit,
    logs,
    dayKey,
    weekStartsOn,
    rules,
  )
  /*
   * The bonus borrows the account's best multiplier; the base term keeps this
   * habit's own. `max` rather than a plain read because the best is computed
   * across all active habits and so is >= this one's by construction — taking
   * the max states that, and means a stale or partial value can only ever cost
   * the user XP, never fabricate it.
   *
   * `breakdown.focusBonus` records the scaled figure, which is what the award
   * actually contained. The ruleset's flat 25 is the input, not the payout.
   */
  const bonusMultiplier = Math.max(
    consistencyMultiplier,
    input.bestConsistencyMultiplier ?? 0,
  )
  const focusBonus = isFocus ? rules.focusBonus * bonusMultiplier : 0

  // One rounding over the whole sum. Rounding the base term and the bonus
  // separately compounds two errors; with `focusBonus` at 0 this is identical
  // to the old expression, so nothing but a focus award changes.
  const total = Math.round(base * completionFactor * consistencyMultiplier + focusBonus)

  return {
    total,
    breakdown: { base, completionFactor, consistencyMultiplier, focusBonus },
    rulesVersion: rules.version,
  }
}

/**
 * The highest consistency multiplier across a set of habits on a given day.
 *
 * This is what the focus bonus is scaled by. It answers the question the bonus
 * exists to win: "of everything I could do today, what is the best-paying
 * thing?" — and then sizes the bonus against that, so the avoided habit is not
 * quietly out-bid by whichever habit happens to be going well.
 *
 * Returns 1 for an empty set, which is the neutral multiplier rather than a
 * special case: a user with no habits has no better option to be measured
 * against.
 */
export function bestConsistencyMultiplierFor(
  habits: readonly Habit[],
  logsByHabit: ReadonlyMap<string, HabitLog[]>,
  dayKey: DayKey,
  weekStartsOn: Weekday,
  rules: XpRules,
): number {
  let best = 1
  for (const habit of habits) {
    const multiplier = consistencyMultiplierFor(
      habit,
      logsByHabit.get(habit.id) ?? [],
      dayKey,
      weekStartsOn,
      rules,
    )
    if (multiplier > best) best = multiplier
  }
  return best
}

/**
 * Recent consistency as a multiplier in `[1, 1 + maxBonus]`.
 *
 * Measured over the `windowDays` days *strictly before* `dayKey`. Excluding the
 * day being logged matters: including it would let an action inflate its own
 * multiplier, which is circular and would make the number impossible to explain
 * in the UI.
 */
export function consistencyMultiplierFor(
  habit: Habit,
  logs: readonly HabitLog[],
  dayKey: DayKey,
  weekStartsOn: Weekday,
  rules: XpRules,
): number {
  const rate = consistencyRate(habit, logs, dayKey, weekStartsOn, rules)
  return 1 + rules.consistency.maxBonus * rate
}

/**
 * Weighted completions divided by expected completions over the trailing
 * window, clamped to `[0, 1]`.
 *
 * "Expected" is cadence-aware, so the window means the same thing for every
 * habit: fourteen days is fourteen chances for a daily habit, six for a
 * Mon/Wed/Fri one, and six for a 3x-per-week one. Without this, a habit
 * scheduled twice a week could never exceed a third of the multiplier a daily
 * habit reaches, which would punish people for choosing a realistic cadence.
 */
export function consistencyRate(
  habit: Habit,
  logs: readonly HabitLog[],
  dayKey: DayKey,
  _weekStartsOn: Weekday,
  rules: XpRules,
): number {
  const { windowDays, minDenominator } = rules.consistency

  const windowEnd = addDays(dayKey, -1)
  // Never look before the habit existed: days it could not have been done on
  // are not evidence of inconsistency.
  const windowStart = maxDayKey(addDays(dayKey, -windowDays), habit.startDayKey)

  if (compareDayKeys(windowStart, windowEnd) > 0) {
    // Brand-new habit: no history to judge, so no bonus yet.
    return 0
  }

  const byDay = indexLogsByDay(logs)
  const daysInWindow = daysBetweenInclusive(windowStart, windowEnd)

  let weighted = 0
  for (const day of eachDay(windowStart, windowEnd)) {
    const log = byDay.get(day)
    if (log && isCredited(log.outcome)) {
      weighted += rules.completionFactors[log.outcome]
    }
  }

  const expected = expectedCompletions(habit, windowStart, windowEnd, daysInWindow)
  const denominator = Math.max(expected, minDenominator)
  if (denominator <= 0) return 0

  return Math.min(1, weighted / denominator)
}

/**
 * Total XP, derived by summing what each log banked.
 *
 * Not stored anywhere. A stored running total would be a second source of truth
 * that drifts the first time a write half-succeeds, and the resulting mismatch
 * between "your level" and "your history" is exactly the kind of thing that
 * makes a progress system stop feeling trustworthy.
 */
export function totalXpFromLogs(logs: readonly HabitLog[]): number {
  let total = 0
  for (const log of logs) total += Math.max(0, log.xpAwarded)
  return total
}

/** How many completions the cadence implies over a span of days. */
function expectedCompletions(
  habit: Habit,
  from: DayKey,
  to: DayKey,
  daysInWindow: number,
): number {
  if (habit.schedule.kind === 'timesPerWeek') {
    return (habit.schedule.target * daysInWindow) / 7
  }
  return scheduledDaysBetween(habit, from, to).length
}

function daysBetweenInclusive(from: DayKey, to: DayKey): number {
  let count = 0
  for (const _day of eachDay(from, to)) count++
  return count
}

function* eachDay(from: DayKey, to: DayKey): Generator<DayKey> {
  let day = from
  while (compareDayKeys(day, to) <= 0) {
    yield day
    day = addDays(day, 1)
  }
}
