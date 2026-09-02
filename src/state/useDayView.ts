import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { DailyFocus, DayKey, Habit, HabitLog, Weekday } from '@/domain/types'
import { compareDayKeys } from '@/domain/time/dayKey'
import { computeStreak, type StreakResult } from '@/domain/streak'
import { groupLogsByHabit } from '@/domain/logs'
import { isHabitDueOn } from '@/domain/schedule'
import { totalXpFromLogs } from '@/domain/xp'
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

    return {
      focus,
      focusRecord: data.focusRecord,
      entries,
      level: levelForXp(totalXpFromLogs(data.logs), DEFAULT_XP_RULES),
      freezeTokens: data.gameState?.freezeTokens ?? 0,
      loading: false,
      activeHabitCount: data.habits.length,
      notYetExistingCount: data.habits.filter(
        (habit) => compareDayKeys(selectedDay, habit.startDayKey) < 0,
      ).length,
    }
  }, [data, selectedDay, today, settings.weekStartsOn])
}
