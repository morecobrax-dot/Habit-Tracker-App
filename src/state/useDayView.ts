import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { DailyFocus, DayKey, Habit, HabitLog, Weekday } from '@/domain/types'
import { compareDayKeys } from '@/domain/time/dayKey'
import { computeStreak, type StreakResult } from '@/domain/streak'
import { groupLogsByHabit } from '@/domain/logs'
import { isHabitDueOn } from '@/domain/schedule'
import { awardXp, bestConsistencyMultiplierFor, totalXpFromLogs } from '@/domain/xp'
import { levelForXp, type LevelState } from '@/domain/level'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import { db } from '@/data/db'
import { useApp } from '@/state/AppContext'

export interface DayEntry {
  habit: Habit
  /** The log for the selected day, if any. */
  log: HabitLog | undefined
  streak: StreakResult
  /** True when a freeze token is holding this day up. */
  frozenToday: boolean
}

export interface DayView {
  /** The habit surfaced as today's focus, if any. Excluded from `entries`. */
  focus: DayEntry | null
  focusRecord: DailyFocus | undefined
  /** Everything else due on the selected day. */
  entries: DayEntry[]
  level: LevelState
  /**
   * What the focus bonus is actually worth today, rounded for display.
   *
   * Computed rather than read off the ruleset: the bonus is scaled by the
   * account's best consistency multiplier, so the flat 25 in `XpRules` is the
   * input, not the payout. Showing the input would understate the reward by up
   * to 30% — and understating the core lever is the same class of mistake as
   * diluting it.
   */
  focusBonus: number
  /**
   * True when the bonus is larger than the ruleset's flat figure because it
   * borrowed the account's best multiplier.
   *
   * The card needs this to explain itself. A number that is simply bigger than
   * the one shown yesterday, with no reason given, reads as a bug — and a
   * reward system that looks buggy stops being motivating.
   */
  focusBonusBoosted: boolean
  freezeTokens: number
  loading: boolean
  activeHabitCount: number
  notYetExistingCount: number
}

/**
 * Everything the logging screen needs for one day.
 *
 * Streaks and level are recomputed from the logs on every change rather than
 * cached. At this scale — a handful of habits, a few hundred logs — that costs
 * microseconds, and it removes the entire class of bug where a stored figure
 * drifts away from the history behind it.
 */
export function useDayView(selectedDay: DayKey): DayView {
  const { today, settings } = useApp()

  const data = useLiveQuery(async () => {
    const [habits, logs, freezeEvents, gameState, focusRecord] = await Promise.all([
      db.habits.where('status').equals('active').toArray(),
      db.logs.toArray(),
      db.freezeEvents.toArray(),
      db.gameState.get('singleton'),
      db.dailyFocus.get(selectedDay),
    ])
    return { habits, logs, freezeEvents, gameState, focusRecord }
  }, [selectedDay])

  return useMemo<DayView>(() => {
    if (!data) {
      return {
        focus: null,
        focusRecord: undefined,
        entries: [],
        level: levelForXp(0, DEFAULT_XP_RULES),
        focusBonus: DEFAULT_XP_RULES.focusBonus,
        focusBonusBoosted: false,
        freezeTokens: 0,
        loading: true,
        activeHabitCount: 0,
        notYetExistingCount: 0,
      }
    }

    const logsByHabit = groupLogsByHabit(data.logs)

    const frozenByHabit = new Map<string, Set<DayKey>>()
    for (const event of data.freezeEvents) {
      const set = frozenByHabit.get(event.habitId) ?? new Set<DayKey>()
      set.add(event.dayKey)
      frozenByHabit.set(event.habitId, set)
    }

    const weekStartsOn: Weekday = settings.weekStartsOn

    const toEntry = (habit: Habit): DayEntry => {
      const logs = logsByHabit.get(habit.id) ?? []
      const frozenDays = frozenByHabit.get(habit.id) ?? new Set<DayKey>()
      return {
        habit,
        log: logs.find((entry) => entry.dayKey === selectedDay),
        // Streaks are always evaluated as of *today*, never as of the day being
        // edited: backdating Monday should show the streak you have now.
        streak: computeStreak({ habit, logs, frozenDays, today, weekStartsOn }),
        frozenToday: frozenDays.has(selectedDay),
      }
    }

    const due = data.habits
      .filter((habit) => isHabitDueOn(habit, selectedDay))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map(toEntry)

    const focusId = data.focusRecord?.habitId
    const focus = focusId ? (due.find((entry) => entry.habit.id === focusId) ?? null) : null
    const entries = focus ? due.filter((entry) => entry.habit.id !== focus.habit.id) : due

    // A preview award for the focus habit, taken apart for its bonus term. The
    // outcome does not matter here — the bonus is the same for a completion and
    // for the two-minute version, which is the point of it.
    //
    // The best multiplier is computed over the same active habits the rest of
    // this hook uses, so the preview and the award the service will actually
    // write agree. If they disagreed the card would be advertising a number
    // the app then refused to pay, which is worse than showing nothing.
    const focusBonus = focus
      ? Math.round(
          awardXp(
            {
              habit: focus.habit,
              outcome: 'complete',
              dayKey: selectedDay,
              logs: logsByHabit.get(focus.habit.id) ?? [],
              isFocus: true,
              weekStartsOn,
              bestConsistencyMultiplier: bestConsistencyMultiplierFor(
                data.habits,
                logsByHabit,
                selectedDay,
                weekStartsOn,
                DEFAULT_XP_RULES,
              ),
            },
            DEFAULT_XP_RULES,
          ).breakdown.focusBonus,
        )
      : DEFAULT_XP_RULES.focusBonus

    return {
      focus,
      focusRecord: data.focusRecord,
      entries,
      level: levelForXp(totalXpFromLogs(data.logs), DEFAULT_XP_RULES),
      focusBonus,
      focusBonusBoosted: focusBonus > DEFAULT_XP_RULES.focusBonus,
      freezeTokens: data.gameState?.freezeTokens ?? 0,
      loading: false,
      activeHabitCount: data.habits.length,
      notYetExistingCount: data.habits.filter(
        (habit) => compareDayKeys(selectedDay, habit.startDayKey) < 0,
      ).length,
    }
  }, [data, selectedDay, today, settings.weekStartsOn])
}
