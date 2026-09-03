/**
 * History aggregation — what a range of past days actually contained.
 *
 * Pure, and deliberately in the domain rather than in the chart components. The
 * heatmap and the week bars are two views of one question ("how much of what
 * was asked did I do?"), and answering it twice in two components is how they
 * end up quietly disagreeing.
 *
 * Nothing here reads the clock: the range is passed in, like everywhere else.
 *
 * ## Weighting
 *
 * A partial does not count the same as a completion, and it does not count as
 * nothing either. Rather than invent a second opinion about what a partial is
 * worth, this takes the `completionFactors` from the active `XpRules` — one
 * source of truth for that judgement, and it stays swappable with the rules.
 */

import type { DayKey, Habit, HabitLog, LogOutcome } from '@/domain/types'
import { dayKeyRange, compareDayKeys } from '@/domain/time/dayKey'
import { groupLogsByHabit, indexLogsByDay } from '@/domain/logs'
import { isHabitDueOn } from '@/domain/schedule'

export interface DayRollup {
  dayKey: DayKey
  /** Habits scheduled that day. Zero means the day asked nothing of you. */
  due: number
  completed: number
  partial: number
  skipped: number
  /** Completions weighted by outcome — the numerator behind every intensity. */
  credit: number
  /** True for days after the anchor day: not yet lived, so not yet missed. */
  future: boolean
}

/** Heat ramp step. 0 renders as a bare cell, not a faint one. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4

/**
 * Per-day totals across a date range.
 *
 * Days on which nothing was scheduled come back with `due: 0`, which every
 * caller must treat as "nothing asked" rather than "nothing done" — a rest day
 * is not a miss, and colouring it like one would be a punishment mechanic
 * smuggled in through a chart.
 */
export function rollupDays(
  habits: readonly Habit[],
  logs: readonly HabitLog[],
  from: DayKey,
  to: DayKey,
  today: DayKey,
  factors: Record<LogOutcome, number>,
): DayRollup[] {
  const byHabit = new Map<string, ReturnType<typeof indexLogsByDay>>()
  for (const [habitId, habitLogs] of groupLogsByHabit(logs)) {
    byHabit.set(habitId, indexLogsByDay(habitLogs))
  }

  return dayKeyRange(from, to).map((dayKey) => {
    const rollup: DayRollup = {
      dayKey,
      due: 0,
      completed: 0,
      partial: 0,
      skipped: 0,
      credit: 0,
      future: compareDayKeys(dayKey, today) > 0,
    }

    for (const habit of habits) {
      if (!isHabitDueOn(habit, dayKey)) continue
      rollup.due += 1

      const log = byHabit.get(habit.id)?.get(dayKey)
      if (!log) continue

      if (log.outcome === 'complete') rollup.completed += 1
      else if (log.outcome === 'partial') rollup.partial += 1
      else rollup.skipped += 1

      rollup.credit += factors[log.outcome] ?? 0
    }

    return rollup
  })
}

/**
 * How full a day was, as a 0-1 fraction of what it asked for.
 *
 * A day that asked nothing returns 0 rather than 1. Treating an empty day as
 * perfect would light up the whole grid before the habit even existed, which
 * makes the history a decoration instead of a record.
 */
export function dayFullness(rollup: DayRollup): number {
  if (rollup.due === 0) return 0
  return Math.min(1, rollup.credit / rollup.due)
}

/**
 * Heat ramp step for one day.
 *
 * Driven by the *fraction* of the day completed, not the raw count, so a day
 * with one habit and a day with five are judged on equal terms. Someone with a
 * single habit would otherwise never leave the palest step.
 *
 * A partial lands mid-ramp on its own — one habit done partially scores 0.6 and
 * reads as level 2 — which is the visual form of "partial completion earns
 * partial credit".
 */
export function heatLevel(rollup: DayRollup): HeatLevel {
  if (rollup.due === 0 || rollup.credit <= 0) return 0
  const fullness = dayFullness(rollup)
  if (fullness >= 1) return 4
  if (fullness >= 0.67) return 3
  if (fullness >= 0.34) return 2
  return 1
}

/**
 * The longest streak currently running, for the page's hero flame.
 *
 * Ties break on habit name so the hero does not flip between two equal streaks
 * on every render. Returns `null` when nothing is lit — the caller shows a
 * dormant flame rather than an empty space, so day zero already shows what is
 * being built.
 */
export function bestStreak<T extends { habit: Habit; streak: { current: number } }>(
  entries: readonly T[],
): T | null {
  let best: T | null = null
  for (const entry of entries) {
    if (entry.streak.current <= 0) continue
    if (
      best === null ||
      entry.streak.current > best.streak.current ||
      (entry.streak.current === best.streak.current &&
        entry.habit.name.localeCompare(best.habit.name) < 0)
    ) {
      best = entry
    }
  }
  return best
}
