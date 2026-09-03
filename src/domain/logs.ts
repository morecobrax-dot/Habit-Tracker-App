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
 * Does this outcome *extend* a streak?
 *
 * `partial` counts. This follows directly from the app's premise: if doing the
 * two-minute version still broke your streak, the two-minute version would be
 * worthless, and the bad-day path would be a trap rather than an escape.
 *
 * `skip` does not extend. It preserves — see `isStreakPreserving`.
 */
export function isCredited(outcome: LogOutcome): boolean {
  return outcome === 'complete' || outcome === 'partial'
}

export function isCreditedLog(log: HabitLog | undefined): boolean {
  return log !== undefined && isCredited(log.outcome)
}

/**
 * Does this outcome *hold* a streak without extending it?
 *
 * Only `skip`, and only because the alternative is worse. A skip is a
 * deliberate "not today" — the user opened the app and told the truth. If that
 * broke the streak while ghosting the app also broke it, honesty would cost
 * exactly as much as avoidance, and the rational move would be to never open
 * the app on a bad day. That is the avoidance loop this app exists to break.
 *
 * It must not *extend* the streak either: a streak of 30 has to mean thirty
 * days you actually showed up for, or the number stops meaning anything.
 *
 * So a skip holds the line and adds nothing, and — unlike a freeze — costs no
 * token, because the user already paid by being honest.
 */
export function isStreakPreserving(outcome: LogOutcome): boolean {
  return outcome === 'skip'
}

export function isStreakPreservingLog(log: HabitLog | undefined): boolean {
  return log !== undefined && isStreakPreserving(log.outcome)
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
