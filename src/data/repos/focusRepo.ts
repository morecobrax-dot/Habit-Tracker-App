import type { DailyFocus, DayKey, FocusResolution, Instant } from '@/domain/types'
import { addDays } from '@/domain/time/dayKey'
import { db, type HabitTrackerDb } from '@/data/db'

/**
 * Daily focus persistence.
 *
 * The choice is stored per day rather than recomputed on read. A focus that
 * reshuffled when the app was reopened — because a log changed the neglect
 * scores — would be untrustworthy within a day, and the whole mechanic depends
 * on the user believing it picked deliberately.
 */

export async function getFocus(
  dayKey: DayKey,
  database: HabitTrackerDb = db,
): Promise<DailyFocus | undefined> {
  return database.dailyFocus.get(dayKey)
}

/**
 * Stores today's choice unless one already exists.
 *
 * Returns whatever is stored afterwards, so concurrent callers converge on the
 * same answer instead of racing to overwrite it.
 */
export async function claimFocus(
  focus: DailyFocus,
  database: HabitTrackerDb = db,
): Promise<DailyFocus> {
  return database.transaction('rw', database.dailyFocus, async () => {
    const existing = await database.dailyFocus.get(focus.dayKey)
    if (existing) return existing
    await database.dailyFocus.add(focus)
    return focus
  })
}

export async function setFocusResolution(
  dayKey: DayKey,
  resolved: FocusResolution,
  database: HabitTrackerDb = db,
): Promise<void> {
  const existing = await database.dailyFocus.get(dayKey)
  if (!existing) return
  await database.dailyFocus.put({ ...existing, resolved })
}

/** Recent choices, most recent first. Feeds the anti-nag cooldown. */
export async function listRecentFocus(
  today: DayKey,
  lookbackDays: number,
  database: HabitTrackerDb = db,
): Promise<DailyFocus[]> {
  const from = addDays(today, -Math.max(0, lookbackDays))
  const rows = await database.dailyFocus.where('dayKey').between(from, today, true, true).toArray()
  return rows.sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0))
}

export function newFocus(
  dayKey: DayKey,
  habitId: string,
  neglectScoreAtChoice: number,
  chosenAt: Instant,
): DailyFocus {
  return { dayKey, habitId, chosenAt, neglectScoreAtChoice, resolved: 'pending' }
}
