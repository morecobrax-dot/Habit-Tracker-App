import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { DayKey, Habit, HabitLog, Weekday } from '@/domain/types'
import { compareDayKeys } from '@/domain/time/dayKey'
import { computeStreak, type StreakResult } from '@/domain/streak'
import { groupLogsByHabit } from '@/domain/logs'
import { isHabitDueOn } from '@/domain/schedule'
import { db } from '@/data/db'
import { useApp } from '@/state/AppContext'

export interface DayEntry {
  habit: Habit
  /** The log for the selected day, if any. */
  log: HabitLog | undefined
  streak: StreakResult
  /** Days in the current streak that a freeze token is holding up. */
  frozenToday: boolean
}

export interface DayView {
  entries: DayEntry[]
  freezeTokens: number
  loading: boolean
  /** Active habits in total, regardless of whether they are due on this day. */
  activeHabitCount: number
  /**
   * Habits excluded only because this day precedes their start. Lets the empty
   * state explain *why* a past day is blank instead of implying you have no
   * habits.
   */
  notYetExistingCount: number
}

/**
 * Everything the logging screen needs for one day.
 *
 * Streaks are recomputed from the logs on every change rather than cached.
 * At this scale — a handful of habits, a few hundred logs — that costs
 * microseconds, and it removes the entire class of bug where a stored streak
 * drifts away from the history behind it.
 */
export function useDayView(selectedDay: DayKey): DayView {
  const { today, settings } = useApp()

  const data = useLiveQuery(async () => {
    const [habits, logs, freezeEvents, gameState] = await Promise.all([
      db.habits.where('status').equals('active').toArray(),
      db.logs.toArray(),
      db.freezeEvents.toArray(),
      db.gameState.get('singleton'),
    ])
    return { habits, logs, freezeEvents, gameState }
  }, [])

  return useMemo<DayView>(() => {
    if (!data) {
      return {
        entries: [],
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

    const entries = data.habits
      .filter((habit) => isHabitDueOn(habit, selectedDay))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map<DayEntry>((habit) => {
        const logs = logsByHabit.get(habit.id) ?? []
        const frozenDays = frozenByHabit.get(habit.id) ?? new Set<DayKey>()
        return {
          habit,
          log: logs.find((entry) => entry.dayKey === selectedDay),
          // Streaks are always evaluated as of *today*, never as of the day
          // being edited: backdating Monday should show the streak you have
          // now, not the one you had on Monday.
          streak: computeStreak({ habit, logs, frozenDays, today, weekStartsOn }),
          frozenToday: frozenDays.has(selectedDay),
        }
      })

    const notYetExistingCount = data.habits.filter(
      (habit) => compareDayKeys(selectedDay, habit.startDayKey) < 0,
    ).length

    return {
      entries,
      freezeTokens: data.gameState?.freezeTokens ?? 0,
      loading: false,
      activeHabitCount: data.habits.length,
      notYetExistingCount,
    }
  }, [data, selectedDay, today, settings.weekStartsOn])
}
