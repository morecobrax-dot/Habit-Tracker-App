/**
 * Freeze tokens: the grace buffer that replaces hard streak resets.
 *
 * Pure decisions only. Nothing here reads or writes storage — these functions
 * return *intents* that the rollover service persists in one transaction.
 *
 * Tokens are a global pool, granted weekly and spent automatically at day
 * rollover. Automatic on purpose: a manual "spend a token to save your streak"
 * prompt would create an obligation to open the app before midnight, which is
 * exactly the loss-pressure the app exists to avoid.
 */

import type { DayKey, GameState, Habit, HabitLog, Settings, Weekday } from '@/domain/types'
import { addDays, compareDayKeys, diffDays } from '@/domain/time/dayKey'
import { isEndOfWeek, startOfWeek, weekKey, weekKeyToStartDay, weeksBetween } from '@/domain/time/week'
import { indexLogsByDay, isCreditedLog, isStreakPreservingLog } from '@/domain/logs'
import { computeStreak, weeklyCompletions } from '@/domain/streak'
import { isHabitDueOn } from '@/domain/schedule'

// ---------------------------------------------------------------------------
// Granting
// ---------------------------------------------------------------------------

export interface FreezeGrant {
  tokensToAdd: number
  /** The week key to record as granted, so the grant stays idempotent. */
  weekKey: string
}

export type FreezeSettings = Pick<
  Settings,
  'freezeTokensPerWeek' | 'maxFreezeTokens' | 'weekStartsOn'
>

/**
 * How many tokens to grant on opening the app today.
 *
 * Returns `null` when this week has already been granted, so repeated app opens
 * are free. An absence of several weeks grants for each missed week, still
 * clamped to `maxFreezeTokens` — you cannot bank a month away and come back
 * invulnerable, but you are not punished for the gap either.
 */
export function computeFreezeGrant(
  state: Pick<GameState, 'freezeTokens' | 'lastFreezeGrantWeekKey'>,
  today: DayKey,
  settings: FreezeSettings,
): FreezeGrant | null {
  const thisWeek = weekKey(today, settings.weekStartsOn)
  if (state.lastFreezeGrantWeekKey === thisWeek) return null

  const weeksElapsed =
    state.lastFreezeGrantWeekKey === null
      ? 1
      : Math.max(
          1,
          weeksBetween(weekKeyToStartDay(state.lastFreezeGrantWeekKey), today, settings.weekStartsOn),
        )

  const room = Math.max(0, settings.maxFreezeTokens - state.freezeTokens)
  const tokensToAdd = Math.min(weeksElapsed * settings.freezeTokensPerWeek, room)

  // Still records the week even when the pool is full, so a capped user does
  // not recompute this on every open.
  return { tokensToAdd, weekKey: thisWeek }
}

// ---------------------------------------------------------------------------
// Spending
// ---------------------------------------------------------------------------

export interface FreezeSpend {
  habitId: string
  /**
   * The period covered. A day for daily/set-day habits; the week's start day
   * for x-per-week habits, since a freeze there covers the whole week.
   */
  dayKey: DayKey
  /** Streak that would otherwise have been lost. Recorded for the UI. */
  streakSaved: number
}

export interface RolloverPlanInput {
  habits: readonly Habit[]
  logsByHabit: ReadonlyMap<string, HabitLog[]>
  /** Already-spent freezes, per habit id. */
  frozenByHabit: ReadonlyMap<string, ReadonlySet<DayKey>>
  /** First closed day to settle. */
  fromDay: DayKey
  /** Last closed day to settle — normally yesterday. */
  toDay: DayKey
  tokensAvailable: number
  weekStartsOn: Weekday
}

export interface RolloverPlan {
  spends: FreezeSpend[]
  tokensRemaining: number
  /** Streaks that ended because no token was available. For honest reporting. */
  broken: { habitId: string; dayKey: DayKey; streakLost: number }[]
}

/**
 * Decides which missed periods to cover, walking closed days in order.
 *
 * Token allocation is deliberate rather than first-come: when several habits
 * miss the same day and tokens are scarce, the longest streak is protected
 * first, because that is the one whose loss would hurt most. Ties break on
 * habit id so the outcome is deterministic and testable.
 */
export function planRollover(input: RolloverPlanInput): RolloverPlan {
  const { habits, logsByHabit, frozenByHabit, fromDay, toDay, weekStartsOn } = input

  const spends: FreezeSpend[] = []
  const broken: RolloverPlan['broken'] = []
  let tokens = input.tokensAvailable

  if (compareDayKeys(fromDay, toDay) > 0) {
    return { spends, tokensRemaining: tokens, broken }
  }

  const byHabit = new Map<string, ReadonlyMap<DayKey, HabitLog>>()
  const streaks = new Map<string, number>()
  const dayBeforeStart = addDays(fromDay, -1)

  for (const habit of habits) {
    const logs = logsByHabit.get(habit.id) ?? []
    byHabit.set(habit.id, indexLogsByDay(logs))
    // Seed each habit's running streak with its state the day before we start.
    streaks.set(
      habit.id,
      computeStreak({
        habit,
        logs,
        frozenDays: frozenByHabit.get(habit.id) ?? new Set(),
        today: dayBeforeStart,
        weekStartsOn,
      }).current,
    )
  }

  const totalDays = diffDays(fromDay, toDay)

  for (let offset = 0; offset <= totalDays; offset++) {
    const day = addDays(fromDay, offset)

    interface Candidate {
      habit: Habit
      periodKey: DayKey
      streakBefore: number
    }
    const misses: Candidate[] = []

    for (const habit of habits) {
      const logs = byHabit.get(habit.id)!
      const frozen = frozenByHabit.get(habit.id) ?? new Set<DayKey>()
      const streakBefore = streaks.get(habit.id) ?? 0

      if (habit.schedule.kind === 'timesPerWeek') {
        // A week is only judged once it has fully closed.
        if (!isEndOfWeek(day, weekStartsOn)) continue
        const week = startOfWeek(day, weekStartsOn)
        if (compareDayKeys(day, habit.startDayKey) < 0) continue

        const done = weeklyCompletions(habit, logs, day, weekStartsOn, day)
        if (done >= habit.schedule.target) {
          streaks.set(habit.id, streakBefore + 1)
          continue
        }
        if (frozen.has(week)) continue
        // A partial first week was never winnable, so it cannot break anything.
        if (week === startOfWeek(habit.startDayKey, weekStartsOn) && habit.startDayKey !== week) {
          continue
        }
        misses.push({ habit, periodKey: week, streakBefore })
        continue
      }

      if (!isHabitDueOn(habit, day)) continue

      const log = logs.get(day)
      if (isCreditedLog(log)) {
        streaks.set(habit.id, streakBefore + 1)
        continue
      }
      // A deliberate skip is not a miss. It holds the streak where it is and
      // spends nothing, so the token stays in the pool for a day the user
      // genuinely lost rather than one they consciously stepped over. Charging
      // a token here would make honesty cost more than silence.
      if (isStreakPreservingLog(log)) continue
      if (frozen.has(day)) continue

      misses.push({ habit, periodKey: day, streakBefore })
    }

    misses.sort(
      (a, b) => b.streakBefore - a.streakBefore || a.habit.id.localeCompare(b.habit.id),
    )

    for (const miss of misses) {
      // Never spend a token on a habit with nothing to protect: a zero streak
      // cannot be saved, and the token is worth more kept.
      if (miss.streakBefore > 0 && tokens > 0) {
        tokens -= 1
        spends.push({
          habitId: miss.habit.id,
          dayKey: miss.periodKey,
          streakSaved: miss.streakBefore,
        })
        continue
      }
      if (miss.streakBefore > 0) {
        broken.push({
          habitId: miss.habit.id,
          dayKey: miss.periodKey,
          streakLost: miss.streakBefore,
        })
      }
      streaks.set(miss.habit.id, 0)
    }
  }

  return { spends, tokensRemaining: tokens, broken }
}
