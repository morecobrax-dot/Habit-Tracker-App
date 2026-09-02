import type { DailyFocus, DayKey } from '@/domain/types'
import { DEFAULT_FOCUS_RULES, pickDailyFocus } from '@/domain/focus'
import { groupLogsByHabit } from '@/domain/logs'
import { db } from '@/data/db'
import { listActiveHabits } from '@/data/repos/habitRepo'
import { listAllLogs } from '@/data/repos/logRepo'
import { claimFocus, getFocus, listRecentFocus, newFocus } from '@/data/repos/focusRepo'
import { getSettings } from '@/data/repos/settingsRepo'
import { dayContextFrom, systemClock, type Clock } from '@/services/clock'
import { toDayKey } from '@/domain/time/dayKey'

/** How far back the anti-nag cooldown needs to see. */
const FOCUS_LOOKBACK_DAYS = 10

/**
 * Ensures today has a focus habit, choosing one if it does not.
 *
 * Idempotent: once chosen, the stored choice wins for the rest of the day even
 * if logging changes the scores that produced it.
 */
export async function ensureDailyFocus(
  clock: Clock = systemClock,
  database = db,
): Promise<DailyFocus | null> {
  const settings = await getSettings(database)
  const now = clock.now()
  const today = toDayKey(now, dayContextFrom(settings))

  const existing = await getFocus(today, database)
  if (existing) return existing

  const [habits, logs, recentFocus] = await Promise.all([
    listActiveHabits(database),
    listAllLogs(database),
    listRecentFocus(today, FOCUS_LOOKBACK_DAYS, database),
  ])

  const choice = pickDailyFocus(
    {
      habits,
      logsByHabit: groupLogsByHabit(logs),
      recentFocus,
      today,
      weekStartsOn: settings.weekStartsOn,
    },
    DEFAULT_FOCUS_RULES,
  )

  if (!choice) return null

  return claimFocus(newFocus(today, choice.habit.id, choice.score, now), database)
}

export async function getFocusForDay(
  dayKey: DayKey,
  database = db,
): Promise<DailyFocus | undefined> {
  return getFocus(dayKey, database)
}
