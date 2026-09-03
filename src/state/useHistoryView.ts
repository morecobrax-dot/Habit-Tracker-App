import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { DayKey, Weekday } from '@/domain/types'
import { addDays, weekdayOf } from '@/domain/time/dayKey'
import { daysOfWeek, startOfWeek } from '@/domain/time/week'
import { rollupDays, type DayRollup } from '@/domain/history'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import { db } from '@/data/db'
import { useApp } from '@/state/AppContext'

/** Twelve weeks of columns, as the design brief specifies. */
export const HEATMAP_WEEKS = 12

export interface HistoryView {
  /** Whole weeks, oldest first, each `weekStartsOn`-aligned and 7 days long. */
  weeks: DayRollup[][]
  /** The current week, for the bar chart. Same rollups as the last heatmap column. */
  thisWeek: DayRollup[]
  loading: boolean
}

/**
 * The last twelve weeks, aggregated for the heatmap and the week bars.
 *
 * Separate from `useDayView` on purpose. That hook is keyed on the day being
 * *edited*, which changes when you backdate; history is always anchored to
 * today, and folding the two together would make the heatmap shift under you
 * every time you tapped "yesterday".
 *
 * The range is snapped to whole weeks so the grid is rectangular — a ragged
 * first column reads as a rendering bug rather than as a start date.
 */
export function useHistoryView(): HistoryView {
  const { today, settings } = useApp()

  const data = useLiveQuery(async () => {
    const [habits, logs] = await Promise.all([
      // Archived habits are excluded here as they are everywhere else. Their
      // paused days are already not-due, so including them would only add
      // columns of nothing.
      db.habits.where('status').equals('active').toArray(),
      db.logs.toArray(),
    ])
    return { habits, logs }
  }, [])

  return useMemo<HistoryView>(() => {
    const currentWeekStart = startOfWeek(today, settings.weekStartsOn)
    const from = addDays(currentWeekStart, -7 * (HEATMAP_WEEKS - 1))
    const to = addDays(currentWeekStart, 6)

    if (!data) {
      return { weeks: [], thisWeek: [], loading: true }
    }

    const days = rollupDays(
      data.habits,
      data.logs,
      from,
      to,
      today,
      DEFAULT_XP_RULES.completionFactors,
    )

    const weeks: DayRollup[][] = []
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

    return {
      weeks,
      thisWeek: weeks[weeks.length - 1] ?? [],
      loading: false,
    }
  }, [data, today, settings.weekStartsOn])
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

export interface WeekdayLabel {
  initial: string
  weekday: Weekday
}

/**
 * Weekday labels for a week, in the user's week order.
 *
 * Carries the weekday number alongside the initial because the initials are
 * ambiguous on their own — two Ts and two Ss — so anything picking a subset of
 * rows to label has to choose by day, not by position. Position alone gives
 * "T, T, S" on a Monday-start week and "S, T, T" on a Sunday-start one.
 *
 * Goes through `weekdayOf` rather than constructing a `Date`: date arithmetic
 * belongs in the time module, and a second implementation here is exactly how a
 * label ends up one day out from the cell it sits above.
 */
export function weekdayLabels(anchor: DayKey, weekStartsOn: Weekday): WeekdayLabel[] {
  return daysOfWeek(anchor, weekStartsOn).map((day) => {
    const weekday = weekdayOf(day)
    return { initial: WEEKDAY_INITIALS[weekday], weekday }
  })
}
