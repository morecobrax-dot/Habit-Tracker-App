/**
 * Streak computation. Pure: takes logs and freeze records, returns numbers.
 *
 * Streaks are never stored. The logs are the single source of truth and the
 * streak is derived from them on every read, because two sources of truth means
 * drift, and a streak that silently disagrees with the history behind it
 * destroys confidence in every other number in the app.
 *
 * ## Four rules that follow from the app's premise
 *
 * 1. **A partial keeps the streak.** If the two-minute version broke your
 *    streak, it would be a trap rather than an escape hatch.
 * 2. **The current period is never a break.** An unlogged today does not end a
 *    streak — the day is still open. Same for the current week on an x-per-week
 *    habit. Only a period that has fully closed can break anything. Without
 *    this the app would spend all day telling you your streak is at zero.
 * 3. **A freeze preserves, it does not increment.** A frozen day keeps the
 *    streak intact but adds nothing to it. You did not do the thing; you just
 *    do not lose what you built.
 * 4. **A skip preserves too, and costs nothing.** Tapping "skip" must never be
 *    worse than ignoring the app, or honesty becomes the expensive option. Like
 *    a freeze it holds the number without raising it — but it spends no token,
 *    because the user already told the truth. See `domain/logs.ts`.
 */

import type { DayKey, Habit, HabitLog, Weekday } from '@/domain/types'
import { addDays, compareDayKeys, maxDayKey } from '@/domain/time/dayKey'
import { daysOfWeek, startOfWeek } from '@/domain/time/week'
import { indexLogsByDay, isCreditedLog, isStreakPreservingLog } from '@/domain/logs'
import { scheduledDaysBetween } from '@/domain/schedule'

export interface StreakInput {
  habit: Habit
  /** All logs for this habit. Order does not matter. */
  logs: readonly HabitLog[]
  /**
   * Days already covered by a spent freeze token. For an x-per-week habit these
   * are week-start days, since a freeze there covers a whole week.
   */
  frozenDays: ReadonlySet<DayKey>
  today: DayKey
  weekStartsOn: Weekday
}

export interface StreakResult {
  current: number
  longest: number
  /** `day` for daily and set-day habits, `week` for x-per-week. */
  unit: 'day' | 'week'
  /** True when the current period is still open and unmet. */
  pending: boolean
  /** Progress through the current period. Always `/1` for day-unit habits. */
  progress: { done: number; target: number }
  /** Periods this streak currently rests on that were covered by a freeze. */
  frozenInStreak: DayKey[]
}

export function computeStreak(input: StreakInput): StreakResult {
  return input.habit.schedule.kind === 'timesPerWeek'
    ? weeklyStreak(input, input.habit.schedule.target)
    : dailyStreak(input)
}

/**
 * Daily and specific-day habits: consecutive *scheduled* days.
 *
 * Days the habit is not scheduled on are stepped over entirely — a Mon/Wed/Fri
 * habit does not break on Tuesday.
 */
function dailyStreak(input: StreakInput): StreakResult {
  const { habit, logs, frozenDays, today } = input
  const byDay = indexLogsByDay(logs)

  const days = scheduledDaysBetween(habit, habit.startDayKey, today)

  let current = 0
  let longest = 0
  let pending = false
  let frozenInStreak: DayKey[] = []

  for (const day of days) {
    const log = byDay.get(day)

    if (isCreditedLog(log)) {
      current += 1
      if (current > longest) longest = current
      continue
    }

    // Rule 4: an honest "not today" holds the number and spends no token.
    // Checked before the `today` branch so a skip logged today still reads as
    // resolved rather than pending — the user has answered the question.
    if (isStreakPreservingLog(log)) continue

    // Rule 2: today is still open, so it can neither extend nor break.
    if (day === today) {
      pending = true
      continue
    }

    // Rule 3: preserved, but adds nothing.
    if (frozenDays.has(day)) {
      frozenInStreak.push(day)
      continue
    }

    current = 0
    frozenInStreak = []
  }

  const todayLogged = isCreditedLog(byDay.get(today))
  const todayScheduled = days.length > 0 && days[days.length - 1] === today

  return {
    current,
    longest,
    unit: 'day',
    pending,
    progress: { done: todayLogged ? 1 : 0, target: todayScheduled ? 1 : 0 },
    frozenInStreak,
  }
}

/**
 * X-per-week habits: consecutive weeks that met the target.
 *
 * There is deliberately no per-day obligation. Within a week you are either on
 * pace or not yet done, never late — which is the point of offering this
 * cadence at all.
 *
 * Rule 4 (skip preserves) therefore does not apply here, and this is the one
 * place a skip is inert. A skip declines *the obligation for the period it
 * lands in*; a day-scoped skip has no day-scoped obligation to decline when the
 * quota is weekly. Letting one tap on Monday absolve a whole week would be
 * wildly out of proportion to what it absolves on a daily habit — and the
 * cadence already carries its own slack, since a 3×/week habit can miss four
 * days and still be perfect. A whole week off is what freeze tokens are for.
 */
function weeklyStreak(input: StreakInput, target: number): StreakResult {
  const { habit, logs, frozenDays, today, weekStartsOn } = input
  const byDay = indexLogsByDay(logs)

  const firstWeek = startOfWeek(habit.startDayKey, weekStartsOn)
  const currentWeek = startOfWeek(today, weekStartsOn)

  let current = 0
  let longest = 0
  let pending = false
  let frozenInStreak: DayKey[] = []
  let progress = { done: 0, target }

  for (
    let week = firstWeek;
    compareDayKeys(week, currentWeek) <= 0;
    week = addDays(week, 7)
  ) {
    const isCurrentWeek = week === currentWeek

    // Only count days the habit actually existed for, and never the future.
    let done = 0
    for (const day of daysOfWeek(week, weekStartsOn)) {
      if (compareDayKeys(day, habit.startDayKey) < 0) continue
      if (compareDayKeys(day, today) > 0) break
      if (isCreditedLog(byDay.get(day))) done += 1
    }

    if (isCurrentWeek) progress = { done, target }

    if (done >= target) {
      current += 1
      if (current > longest) longest = current
      continue
    }

    // Rule 2: the week is still running.
    if (isCurrentWeek) {
      pending = true
      continue
    }

    // The habit's first week is usually a partial week — created on a Friday,
    // you cannot fit three sessions in. A week you never had the chance to hit
    // must not break a streak.
    if (week === firstWeek && habit.startDayKey !== firstWeek) continue

    if (frozenDays.has(week)) {
      frozenInStreak.push(week)
      continue
    }

    current = 0
    frozenInStreak = []
  }

  return { current, longest, unit: 'week', pending, progress, frozenInStreak }
}

/** Completions credited in the week containing `day`, bounded by the habit's start. */
export function weeklyCompletions(
  habit: Habit,
  byDay: ReadonlyMap<DayKey, HabitLog>,
  day: DayKey,
  weekStartsOn: Weekday,
  upTo: DayKey,
): number {
  const week = startOfWeek(day, weekStartsOn)
  const floor = maxDayKey(week, habit.startDayKey)
  let done = 0
  for (const candidate of daysOfWeek(week, weekStartsOn)) {
    if (compareDayKeys(candidate, floor) < 0) continue
    if (compareDayKeys(candidate, upTo) > 0) break
    if (isCreditedLog(byDay.get(candidate))) done += 1
  }
  return done
}
