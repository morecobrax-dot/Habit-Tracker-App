/**
 * What today actually asks of you, and what is about to lapse.
 *
 * Pure and clock-free like the rest of the domain: the day is passed in.
 *
 * ## Why "at risk" is not a nag
 *
 * `CLAUDE.md` forbids punishment mechanics, and a list of things you have not
 * done is the easiest way to smuggle one in. The distinction this module draws
 * is between *pressure* and *support*:
 *
 * - A habit with no streak that is unlogged today is simply unlogged. It is
 *   not at risk, because there is nothing to lose. Listing it would be nagging.
 * - A habit with a live streak that is unlogged today has something concrete
 *   and finite about to lapse. Saying so is information the user would want,
 *   and the UI pairs it with that habit's two-minute version — the way back in,
 *   not the size of the hole.
 *
 * So `atRisk` is deliberately narrow. On a day where nothing has been built
 * yet, it is empty, and the screen says nothing about failure.
 */

import type { Habit } from '@/domain/types'

export interface AtRiskHabit {
  habit: Habit
  /** The streak that lapses if the day closes unlogged. Always > 0. */
  streak: number
  /** `day` for daily and set-day habits, `week` for x-per-week. */
  unit: 'day' | 'week'
  /** True when a freeze token would cover it — so the warning can be softer. */
  coveredByFreeze: boolean
}

/** One habit's state today, as the dashboard needs it. */
export interface TodayEntry {
  habit: Habit
  /** Whether today already has a credited log. */
  done: boolean
  /** Whether today has any log at all, including a skip. */
  resolved: boolean
  streak: number
  unit: 'day' | 'week'
}

export interface TodaySummary {
  /** Habits scheduled today. */
  due: number
  /** Of those, how many are credited. */
  done: number
  /** Due but not yet credited — the number that actually drives the copy. */
  remaining: number
  /** Due, unlogged, and holding a live streak. Sorted by most at stake. */
  atRisk: AtRiskHabit[]
  /** Every due habit has a credited log. False when nothing is due. */
  allDone: boolean
  /** Nothing was scheduled today at all — a rest day, not a failure. */
  restDay: boolean
  /**
   * The longest streak still running across today's habits.
   *
   * Zero means nothing is currently lit, which is a normal state after a
   * missed day and must not be rendered as the page's headline.
   */
  bestStreak: number
  bestStreakUnit: 'day' | 'week'
  /** The habit holding `bestStreak`, for naming it. */
  bestStreakHabit: Habit | null
}

export interface SummariseTodayInput {
  entries: readonly TodayEntry[]
  /** Freeze tokens available right now. Softens the at-risk wording. */
  freezeTokens: number
}

export function summariseToday({ entries, freezeTokens }: SummariseTodayInput): TodaySummary {
  const due = entries.length
  const done = entries.filter((entry) => entry.done).length

  /*
   * Only habits with something to lose. A habit at zero is not "at risk" — it
   * is just a habit — and putting it on a warning list would turn the
   * dashboard into a list of ways the user is failing.
   *
   * Freeze tokens are counted off in order of how much each habit stands to
   * lose, matching `planRollover`'s allocation, so the wording matches what
   * would actually happen at rollover rather than promising cover that the
   * pool cannot pay for.
   */
  const exposed = entries
    .filter((entry) => !entry.done && entry.streak > 0)
    .sort((a, b) => b.streak - a.streak || a.habit.name.localeCompare(b.habit.name))

  let tokensLeft = Math.max(0, freezeTokens)
  const atRisk: AtRiskHabit[] = exposed.map((entry) => {
    const covered = tokensLeft > 0
    if (covered) tokensLeft -= 1
    return {
      habit: entry.habit,
      streak: entry.streak,
      unit: entry.unit,
      coveredByFreeze: covered,
    }
  })

  let bestStreak = 0
  let bestStreakUnit: 'day' | 'week' = 'day'
  let bestStreakHabit: Habit | null = null
  for (const entry of entries) {
    if (entry.streak <= 0) continue
    const better =
      entry.streak > bestStreak ||
      (entry.streak === bestStreak &&
        bestStreakHabit !== null &&
        entry.habit.name.localeCompare(bestStreakHabit.name) < 0)
    if (better) {
      bestStreak = entry.streak
      bestStreakUnit = entry.unit
      bestStreakHabit = entry.habit
    }
  }

  return {
    due,
    done,
    remaining: due - done,
    atRisk,
    allDone: due > 0 && done === due,
    restDay: due === 0,
    bestStreak,
    bestStreakUnit,
    bestStreakHabit,
  }
}

/**
 * How a streak should be described when it is not running.
 *
 * The old copy said "Not started yet" for any streak of zero, which is a lie
 * for a habit with months of history behind it — and a discouraging one, since
 * it erases the work. A habit that has been done before is *paused*, and the
 * distinction is the difference between "you have never managed this" and "you
 * missed yesterday".
 */
export function describeDormantStreak(hasHistory: boolean): string {
  return hasHistory ? 'Streak paused' : 'Not started yet'
}
