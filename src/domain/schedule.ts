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
 * The cadence that was in force on a given day.
 *
 * `habit.schedule` is always the *current* cadence. Judging history by it would
 * mean that switching a Mon/Wed/Fri habit to daily retroactively turns every
 * past Tuesday into a miss and destroys a streak the user legitimately earned —
 * a silent streak break, which the product rules forbid.
 *
 * With no history recorded, the current schedule applies to every day, which is
 * exactly the behaviour before this existed.
 */
export function scheduleFor(habit: Habit, dayKey: DayKey): Schedule {
  const history = habit.scheduleHistory
  if (!history || history.length === 0) return habit.schedule

  // Entries are appended in order; find the last one that had taken effect.
  let effective: Schedule | null = null
  for (const change of history) {
    if (compareDayKeys(change.from, dayKey) <= 0) effective = change.schedule
    else break
  }
  // A day before the first recorded change predates any change, so it is
  // governed by the oldest schedule we know about.
  return effective ?? history[0]!.schedule
}

/**
 * Was the habit archived on this day?
 *
 * Archiving is a deliberate pause. Days inside an archived stretch are treated
 * as not-scheduled, so they cannot be missed and cannot break a streak — the
 * streak simply resumes when the habit comes back.
 */
export function wasArchivedOn(habit: Habit, dayKey: DayKey): boolean {
  const periods = habit.archivedPeriods
  if (!periods || periods.length === 0) {
    // No recorded ranges: fall back to the coarse signal. A habit archived
    // before ranges existed is only known to be archived *now*.
    return habit.status === 'archived'
  }
  return periods.some(
    (period) =>
      compareDayKeys(dayKey, period.from) >= 0 &&
      (period.to === null || compareDayKeys(dayKey, period.to) < 0),
  )
}

/**
 * Whether the habit is live on `dayKey`: scheduled by the cadence in force
 * that day, on or after the day it was created, and not paused by archiving.
 */
export function isHabitDueOn(habit: Habit, dayKey: DayKey): boolean {
  if (compareDayKeys(dayKey, habit.startDayKey) < 0) return false
  if (wasArchivedOn(habit, dayKey)) return false
  return isScheduledOn(scheduleFor(habit, dayKey), dayKey)
}

/**
 * Do two cadences mean the same thing?
 *
 * Compared by meaning, not by shape: `specificDays` is order-insensitive, so
 * re-saving a habit after toggling Friday off and on again is not a cadence
 * change and must not add a history entry.
 */
export function sameSchedule(a: Schedule, b: Schedule): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'timesPerWeek' && b.kind === 'timesPerWeek') return a.target === b.target
  if (a.kind === 'specificDays' && b.kind === 'specificDays') {
    if (a.days.length !== b.days.length) return false
    const left = [...a.days].sort((x, y) => x - y)
    const right = [...b.days].sort((x, y) => x - y)
    return left.every((day, i) => day === right[i])
  }
  return true
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

/** The weekly quota in force on a given day. */
export function weeklyTargetOn(habit: Habit, dayKey: DayKey): number | null {
  return weeklyTarget(scheduleFor(habit, dayKey))
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
