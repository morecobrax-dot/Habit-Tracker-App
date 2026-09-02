/**
 * Log helpers shared by the streak and rollover logic.
 */

import type { DayKey, HabitLog, LogOutcome } from '@/domain/types'

/**
 * Placeholder ruleset id for logs written before the XP layer exists.
 *
 * Every log records which ruleset produced its award. Phase 2 awards nothing,
 * so these rows are stamped `none` — and because awards are snapshotted rather
 * than recomputed, they will stay at zero once real rules arrive. That is the
 * honest outcome: XP was not earned under rules that did not exist.
 */
export const NO_RULES_VERSION = 'none'

/**
 * Does this outcome keep a streak alive?
 *
 * `partial` counts. This follows directly from the app's premise: if doing the
 * two-minute version still broke your streak, the two-minute version would be
 * worthless, and the bad-day path would be a trap rather than an escape.
 *
 * `skip` does not count — per the chosen semantics it is bookkeeping only,
 * recording that you consciously declined rather than never engaged.
 */
export function isCredited(outcome: LogOutcome): boolean {
  return outcome === 'complete' || outcome === 'partial'
}

export function isCreditedLog(log: HabitLog | undefined): boolean {
  return log !== undefined && isCredited(log.outcome)
}

export type LogsByDay = ReadonlyMap<DayKey, HabitLog>

export function indexLogsByDay(logs: readonly HabitLog[]): LogsByDay {
  const map = new Map<DayKey, HabitLog>()
  for (const log of logs) {
    // The storage layer enforces one log per habit per day via a unique index,
    // so a collision here would mean corrupted data. Last write wins rather
    // than throwing, since a rendering path should not explode on bad rows.
    map.set(log.dayKey, log)
  }
  return map
}

/** Groups logs by habit id, preserving input order within each habit. */
export function groupLogsByHabit(logs: readonly HabitLog[]): Map<string, HabitLog[]> {
  const map = new Map<string, HabitLog[]>()
  for (const log of logs) {
    const existing = map.get(log.habitId)
    if (existing) existing.push(log)
    else map.set(log.habitId, [log])
  }
  return map
}

/** Key used for freeze-event lookups. */
export function freezeKey(habitId: string, dayKey: DayKey): string {
  return `${habitId}:${dayKey}`
}
