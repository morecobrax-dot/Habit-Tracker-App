/**
 * XP scoring. Pure: logs and rules in, a number out.
 *
 *   xp = round((base x completionFactor + focusBonus) x consistencyMultiplier)
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
 * It must scale with *consistency*, and this is the part v1 got wrong. Every
 * other term was multiplied while the bonus stayed flat, so the bonus was a
 * shrinking share of a growing award and the invariant above held only at a
 * multiplier of exactly 1.00. From 1.05 — which is most of the life of any
 * account that is going well — a full tier-3 completion paid more than the
 * avoided thing, so the app quietly stopped paying most for its own core
 * lever, and stopped doing so precisely as the user got established.
 *
 * Scaling the bonus by consistency alongside everything else keeps its
 * relative weight constant, which restores the invariant at every multiplier
 * in the range. It leaves the bonus flat in difficulty, so nothing about the
 * paragraph above changes.
 *
 * The rounding also moved: one `round` over the whole sum rather than one over
 * the base term plus an unrounded bonus. Two roundings compound, and at 1.05
 * that was the difference between winning and tying.
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
  // Scaled by consistency like every other term, so the bonus keeps its
  // relative weight instead of being diluted as the multiplier grows.
  // `breakdown.focusBonus` records the scaled value, which is what the award
  // actually contained — the ruleset's flat 25 is the input, not the payout.
  const focusBonus = isFocus ? rules.focusBonus * consistencyMultiplier : 0

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
