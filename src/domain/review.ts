/**
 * Summaries: one habit over a range, and the week as a whole.
 *
 * Pure, clock-free, and built on `rollupDays` rather than re-walking the logs,
 * so the detail screen, the weekly review and the heatmap can never disagree
 * about what a day contained.
 *
 * ## A note on "most missed"
 *
 * `needsAttention` deliberately does not carry that name. Identifying the habit
 * that is struggling is genuinely useful — it is the same signal that drives the
 * daily focus — but the framing decides whether it reads as information or as an
 * accusation, and an accusation is an avoidance engine. So this returns the
 * habit and its real numbers and leaves the wording to the UI, which pairs it
 * with that habit's two-minute version rather than with a failure count.
 */

import type { DayKey, Habit, HabitLog, LogOutcome } from '@/domain/types'
import { rollupDays, type DayRollup } from '@/domain/history'

export interface HabitStats {
  habit: Habit
  days: DayRollup[]
  /** Scheduled days in range that have already been lived. */
  due: number
  completed: number
  partial: number
  skipped: number
  /** Outcome-weighted completions. */
  credit: number
  /**
   * `credit / due` — the *weighted* rate, where a partial counts for less.
   *
   * This is for ranking and for chart intensity, not for a headline. See
   * `showedUpRate` for the number a person is shown.
   */
  rate: number
  /** Days with any credited log at all: completions plus partials. */
  showedUp: number
  /**
   * `showedUp / due` — the number to *display*.
   *
   * Two reasons it is not the weighted one. First, a headline percentage shown
   * beside the fraction it came from has to reconcile with it, or the screen
   * argues with itself: "47 of 80" next to "53%" makes a reader who divides
   * think something is broken. Second, and more importantly, "did you show up"
   * is the question this product actually cares about — a partial is a day you
   * turned up for, and counting it as most-of-a-day in the headline would
   * quietly re-introduce perfection as the standard.
   */
  showedUpRate: number
}

/**
 * One habit's record over a range.
 *
 * Future days are excluded from every total: counting days that have not
 * happened yet would drag the rate down for no reason a user could act on, and
 * a rate that falls while you sleep is a punishment mechanic.
 */
export function habitStats(
  habit: Habit,
  logs: readonly HabitLog[],
  from: DayKey,
  to: DayKey,
  today: DayKey,
  factors: Record<LogOutcome, number>,
): HabitStats {
  const days = rollupDays([habit], logs, from, to, today, factors)

  const stats: HabitStats = {
    habit,
    days,
    due: 0,
    completed: 0,
    partial: 0,
    skipped: 0,
    credit: 0,
    rate: 0,
    showedUp: 0,
    showedUpRate: 0,
  }

  for (const day of days) {
    if (day.future || day.due === 0) continue
    stats.due += day.due
    stats.completed += day.completed
    stats.partial += day.partial
    stats.skipped += day.skipped
    stats.credit += day.credit
  }

  stats.showedUp = stats.completed + stats.partial
  stats.rate = stats.due === 0 ? 0 : Math.min(1, stats.credit / stats.due)
  stats.showedUpRate = stats.due === 0 ? 0 : Math.min(1, stats.showedUp / stats.due)
  return stats
}

export interface WeekReview {
  /**
   * Days shown up for over days due, across every habit. 0 when idle.
   *
   * Unweighted, for the same reason as `HabitStats.showedUpRate`: it is the
   * number a person reads, and it sits beside the day count it came from.
   */
  completionRate: number
  /** Total scheduled days already lived this week. */
  due: number
  /** Days with any credited log, across every habit. */
  showedUp: number
  /** The longest streak running right now, with the habit holding it. */
  best: { habit: Habit; streak: number } | null
  /** The habit having the hardest week. `null` when every habit is at 100%. */
  needsAttention: HabitStats | null
  /** True when the week asked nothing of the user at all. */
  idle: boolean
}

export interface WeekReviewInput {
  habits: readonly Habit[]
  logs: readonly HabitLog[]
  from: DayKey
  to: DayKey
  today: DayKey
  factors: Record<LogOutcome, number>
  /** Current streak per habit id, computed by `computeStreak` upstream. */
  streaks: ReadonlyMap<string, number>
}

export function reviewWeek(input: WeekReviewInput): WeekReview {
  const { habits, logs, from, to, today, factors, streaks } = input

  const perHabit = habits.map((habit) =>
    habitStats(habit, logs, from, to, today, factors),
  )

  let due = 0
  let showedUp = 0
  for (const stats of perHabit) {
    due += stats.due
    showedUp += stats.showedUp
  }

  return {
    completionRate: due === 0 ? 0 : Math.min(1, showedUp / due),
    due,
    showedUp,
    best: bestRunningStreak(habits, streaks),
    needsAttention: hardestWeek(perHabit),
    idle: due === 0,
  }
}

/**
 * The longest streak currently running. Ties break on habit name so the review
 * does not swap between two equal streaks every time it re-renders.
 */
function bestRunningStreak(
  habits: readonly Habit[],
  streaks: ReadonlyMap<string, number>,
): { habit: Habit; streak: number } | null {
  let best: { habit: Habit; streak: number } | null = null
  for (const habit of habits) {
    const streak = streaks.get(habit.id) ?? 0
    if (streak <= 0) continue
    if (
      best === null ||
      streak > best.streak ||
      (streak === best.streak && habit.name.localeCompare(best.habit.name) < 0)
    ) {
      best = { habit, streak }
    }
  }
  return best
}

/**
 * The habit with the lowest completion rate this week.
 *
 * Returns `null` when nothing is struggling — every habit at 100%, or none of
 * them scheduled yet. That case gets its own copy in the UI rather than a
 * least-bad habit singled out for having done nothing wrong.
 */
function hardestWeek(perHabit: readonly HabitStats[]): HabitStats | null {
  let worst: HabitStats | null = null
  for (const stats of perHabit) {
    if (stats.due === 0) continue
    if (stats.rate >= 1) continue
    if (
      worst === null ||
      stats.rate < worst.rate ||
      (stats.rate === worst.rate && stats.habit.name.localeCompare(worst.habit.name) < 0)
    ) {
      worst = stats
    }
  }
  return worst
}
