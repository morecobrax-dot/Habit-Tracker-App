/**
 * Week bucketing, used by `timesPerWeek` cadences and weekly freeze grants.
 *
 * A week is identified by the DayKey it starts on, prefixed with `W`
 * (e.g. `W2026-08-31`). This is deliberately not ISO week numbering: ISO weeks
 * assume Monday starts and have a genuinely nasty year-boundary rule where
 * 1 January can belong to week 53 of the previous year. Keying by start date is
 * unambiguous for any `weekStartsOn`, sorts chronologically as a plain string,
 * and needs no special cases.
 */

import type { DayKey, Weekday, WeekKey } from '@/domain/types'
import { addDays, dayKeyRange, diffDays, weekdayOf } from '@/domain/time/dayKey'

/** The first day of the week containing `dayKey`. */
export function startOfWeek(dayKey: DayKey, weekStartsOn: Weekday): DayKey {
  const current = weekdayOf(dayKey)
  // How many days back to the most recent `weekStartsOn`, in [0, 6].
  const back = (current - weekStartsOn + 7) % 7
  return addDays(dayKey, -back)
}

/** The last day of the week containing `dayKey`. */
export function endOfWeek(dayKey: DayKey, weekStartsOn: Weekday): DayKey {
  return addDays(startOfWeek(dayKey, weekStartsOn), 6)
}

export function weekKey(dayKey: DayKey, weekStartsOn: Weekday): WeekKey {
  return `W${startOfWeek(dayKey, weekStartsOn)}`
}

/** The seven DayKeys of the week containing `dayKey`, in order. */
export function daysOfWeek(dayKey: DayKey, weekStartsOn: Weekday): DayKey[] {
  const start = startOfWeek(dayKey, weekStartsOn)
  return dayKeyRange(start, addDays(start, 6))
}

/**
 * Whole weeks between the weeks containing `from` and `to`.
 * Negative when `to` is in an earlier week. Adjacent weeks differ by 1.
 */
export function weeksBetween(from: DayKey, to: DayKey, weekStartsOn: Weekday): number {
  const a = startOfWeek(from, weekStartsOn)
  const b = startOfWeek(to, weekStartsOn)
  return diffDays(a, b) / 7
}

export function isSameWeek(a: DayKey, b: DayKey, weekStartsOn: Weekday): boolean {
  return startOfWeek(a, weekStartsOn) === startOfWeek(b, weekStartsOn)
}
