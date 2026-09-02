/**
 * Reading a `Schedule`. Pure interpretation of schedule *data* — no storage, no
 * streaks, no scoring. Streak and XP logic build on these in later phases.
 */

import type { DayKey, Habit, Schedule, Weekday } from '@/domain/types'
import { compareDayKeys, dayKeyRange, weekdayOf } from '@/domain/time/dayKey'
import { daysOfWeek } from '@/domain/time/week'

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Is this habit expected on this specific day?
 *
 * Note that `timesPerWeek` returns `true` for every day: a 3×/week habit is
 * *available* every day and you choose when. Which days you actually owe is a
 * week-level question, answered by `weeklyTarget`. Treating it as a per-day
 * obligation is what produces the "you missed Tuesday" guilt we're avoiding.
 */
export function isScheduledOn(schedule: Schedule, dayKey: DayKey): boolean {
  switch (schedule.kind) {
    case 'daily':
      return true
    case 'timesPerWeek':
      return true
    case 'specificDays':
      return schedule.days.includes(weekdayOf(dayKey))
  }
}

/**
 * Whether the habit is live on `dayKey`: scheduled, active, and on or after the
 * day it was created. Archived habits are never due.
 */
export function isHabitDueOn(habit: Habit, dayKey: DayKey): boolean {
  if (habit.status !== 'active') return false
  if (compareDayKeys(dayKey, habit.startDayKey) < 0) return false
  return isScheduledOn(habit.schedule, dayKey)
}

/** How many completions a week demands. `null` for cadences with no weekly quota. */
export function weeklyTarget(schedule: Schedule): number | null {
  switch (schedule.kind) {
    case 'daily':
      return 7
    case 'timesPerWeek':
      return schedule.target
    case 'specificDays':
      return schedule.days.length
  }
}

/**
 * The days in `[from, to]` on which this habit is due. Used for consistency
 * windows and history rendering.
 */
export function scheduledDaysBetween(habit: Habit, from: DayKey, to: DayKey): DayKey[] {
  return dayKeyRange(from, to).filter((day) => isHabitDueOn(habit, day))
}

/** The days of `dayKey`'s week on which this habit is due. */
export function scheduledDaysInWeek(
  habit: Habit,
  dayKey: DayKey,
  weekStartsOn: Weekday,
): DayKey[] {
  return daysOfWeek(dayKey, weekStartsOn).filter((day) => isHabitDueOn(habit, day))
}

/** Human-readable cadence, e.g. "Mon, Wed, Fri" or "3× per week". */
export function describeSchedule(schedule: Schedule): string {
  switch (schedule.kind) {
    case 'daily':
      return 'Every day'
    case 'timesPerWeek':
      return `${schedule.target}× per week`
    case 'specificDays': {
      if (schedule.days.length === 0) return 'No days selected'
      if (schedule.days.length === 7) return 'Every day'
      const sorted = [...schedule.days].sort((a, b) => a - b)
      const isWeekdays =
        sorted.length === 5 && sorted.every((d, i) => d === ([1, 2, 3, 4, 5] as Weekday[])[i])
      if (isWeekdays) return 'Weekdays'
      const isWeekends = sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6
      if (isWeekends) return 'Weekends'
      return sorted.map((d) => WEEKDAY_NAMES[d]).join(', ')
    }
  }
}
