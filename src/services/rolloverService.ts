import type { DayKey } from '@/domain/types'
import { addDays, compareDayKeys, diffDays, toDayKey } from '@/domain/time/dayKey'
import { computeFreezeGrant, planRollover } from '@/domain/freeze'
import { groupLogsByHabit } from '@/domain/logs'
import { db } from '@/data/db'
import { listActiveHabits } from '@/data/repos/habitRepo'
import { listAllLogs } from '@/data/repos/logRepo'
import { commitRollover, listFreezeEvents, requireGameState } from '@/data/repos/gameStateRepo'
import { getSettings } from '@/data/repos/settingsRepo'
import { dayContextFrom, systemClock, type Clock } from '@/services/clock'

/**
 * Day rollover: settle every day that has closed since the app was last opened.
 *
 * Runs on app start. It must be idempotent — the app can be opened twenty times
 * a day — and it must replay correctly after an absence, because an installed
 * PWA might not be opened for a fortnight.
 *
 * Only days strictly before today are settled. Today is still open, and
 * settling it would end streaks that the user could still save by logging this
 * evening — the precise anxiety this app is built to avoid.
 */

/**
 * Upper bound on days replayed in one run.
 *
 * After a very long absence there is nothing useful to settle: tokens cap at a
 * handful, so the outcome after ~60 days is identical to the outcome after 600,
 * and walking the whole gap would just be slow.
 */
const MAX_CATCHUP_DAYS = 60

export interface RolloverOutcome {
  /** Days actually settled this run. */
  daysSettled: number
  tokensGranted: number
  freezesSpent: { habitId: string; dayKey: DayKey; streakSaved: number }[]
  streaksBroken: { habitId: string; dayKey: DayKey; streakLost: number }[]
  tokensRemaining: number
}

export async function runRollover(
  clock: Clock = systemClock,
  database = db,
): Promise<RolloverOutcome> {
  const settings = await getSettings(database)
  const ctx = dayContextFrom(settings)
  const now = clock.now()
  const today = toDayKey(now, ctx)
  const yesterday = addDays(today, -1)

  const state = await requireGameState(database)

  const grant = computeFreezeGrant(state, today, {
    freezeTokensPerWeek: settings.freezeTokensPerWeek,
    maxFreezeTokens: settings.maxFreezeTokens,
    weekStartsOn: settings.weekStartsOn,
  })
  const tokensGranted = grant?.tokensToAdd ?? 0

  // First ever run: nothing has closed under our watch, so record the high
  // water mark and settle nothing. Without this, a fresh install would
  // "discover" misses on days the user did not have the app.
  if (state.lastRolloverDayKey === null) {
    await commitRollover(
      {
        tokensGranted,
        grantedWeekKey: grant?.weekKey,
        spends: [],
        lastRolloverDayKey: yesterday,
        instant: now,
      },
      database,
    )
    return {
      daysSettled: 0,
      tokensGranted,
      freezesSpent: [],
      streaksBroken: [],
      tokensRemaining: state.freezeTokens + tokensGranted,
    }
  }

  const firstUnsettled = addDays(state.lastRolloverDayKey, 1)

  // Already up to date. Still commit any grant, and never move the high water
  // mark backwards — a clock or timezone change could otherwise rewind it.
  if (compareDayKeys(firstUnsettled, yesterday) > 0) {
    if (grant) {
      await commitRollover(
        {
          tokensGranted,
          grantedWeekKey: grant.weekKey,
          spends: [],
          lastRolloverDayKey: state.lastRolloverDayKey,
          instant: now,
        },
        database,
      )
    }
    return {
      daysSettled: 0,
      tokensGranted,
      freezesSpent: [],
      streaksBroken: [],
      tokensRemaining: state.freezeTokens + tokensGranted,
    }
  }

  const span = diffDays(firstUnsettled, yesterday)
  const fromDay =
    span > MAX_CATCHUP_DAYS ? addDays(yesterday, -MAX_CATCHUP_DAYS) : firstUnsettled

  const [habits, logs, freezeEvents] = await Promise.all([
    listActiveHabits(database),
    listAllLogs(database),
    listFreezeEvents(database),
  ])

  const frozenByHabit = new Map<string, Set<DayKey>>()
  for (const event of freezeEvents) {
    const set = frozenByHabit.get(event.habitId) ?? new Set<DayKey>()
    set.add(event.dayKey)
    frozenByHabit.set(event.habitId, set)
  }

  const plan = planRollover({
    habits,
    logsByHabit: groupLogsByHabit(logs),
    frozenByHabit,
    fromDay,
    toDay: yesterday,
    tokensAvailable: state.freezeTokens + tokensGranted,
    weekStartsOn: settings.weekStartsOn,
  })

  await commitRollover(
    {
      tokensGranted,
      grantedWeekKey: grant?.weekKey,
      spends: plan.spends.map((spend) => ({ habitId: spend.habitId, dayKey: spend.dayKey })),
      lastRolloverDayKey: yesterday,
      instant: now,
    },
    database,
  )

  return {
    daysSettled: diffDays(fromDay, yesterday) + 1,
    tokensGranted,
    freezesSpent: plan.spends,
    streaksBroken: plan.broken,
    tokensRemaining: plan.tokensRemaining,
  }
}
