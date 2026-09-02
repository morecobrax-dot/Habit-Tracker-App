/**
 * Daily Focus: the core anti-procrastination lever.
 *
 * Picks the one habit most worth starting today — biased hard toward the thing
 * being avoided — and attaches a bonus large enough that its *two-minute
 * version* beats completing anything else outright.
 *
 * ## The failure mode this is designed against
 *
 * A naive "surface the most-neglected habit" rule shows the same dreaded habit
 * every single day, and the counter next to it climbs. That is a shame engine:
 * it turns the app into a daily accusation, and a daily accusation is an
 * avoidance engine. Three defences:
 *
 *  1. **Anti-nag cooldown.** A habit cannot be focus more than
 *     `maxConsecutiveDays` days running; after that it is benched for
 *     `benchDays`. Something else gets a turn.
 *  2. **The ask shrinks as the reward grows.** Neglect raises the bonus's
 *     relative worth, never the size of the request. The UI leads with the
 *     minimum version, so the longer something is avoided, the smaller the
 *     thing being asked for.
 *  3. **No shaming counters.** The score below uses days-since-completion, but
 *     it is an input to selection, not a number to display back as a debt.
 *
 * Selection is deterministic and persisted per day: a focus that reshuffled on
 * refresh would be untrustworthy within a day.
 */

import type { DailyFocus, DayKey, Habit, HabitLog, Weekday } from '@/domain/types'
import { addDays, compareDayKeys, diffDays, maxDayKey } from '@/domain/time/dayKey'
import { indexLogsByDay, isCredited } from '@/domain/logs'
import { isHabitDueOn, scheduledDaysBetween } from '@/domain/schedule'

export interface FocusRules {
  /** Cap on days-since-completion, so an ancient habit cannot dominate forever. */
  maxNeglectDays: number
  /** Weight per consecutive missed scheduled occurrence. */
  missWeight: number
  /** Consecutive days a single habit may hold focus. */
  maxConsecutiveDays: number
  /** Days a habit is benched after hitting that cap. */
  benchDays: number
}

export const DEFAULT_FOCUS_RULES: FocusRules = {
  maxNeglectDays: 30,
  missWeight: 3,
  maxConsecutiveDays: 2,
  benchDays: 2,
}

export interface FocusCandidate {
  habit: Habit
  score: number
  daysSinceLastCompletion: number | null
  consecutiveMisses: number
  benched: boolean
}

export interface PickFocusInput {
  habits: readonly Habit[]
  logsByHabit: ReadonlyMap<string, HabitLog[]>
  /** Recent focus history, most recent first. Used for the anti-nag cooldown. */
  recentFocus: readonly DailyFocus[]
  today: DayKey
  weekStartsOn: Weekday
}

/**
 * Neglect score for one habit. Higher means more worth surfacing.
 *
 * Difficulty breaks ties toward the harder thing, on the reasoning that when
 * two habits are equally neglected, the heavier one is the more likely to be
 * the one actually being dreaded.
 */
export function neglectScore(
  habit: Habit,
  logs: readonly HabitLog[],
  today: DayKey,
  rules: FocusRules,
): { score: number; daysSinceLastCompletion: number | null; consecutiveMisses: number } {
  const byDay = indexLogsByDay(logs)

  let lastCompletion: DayKey | null = null
  for (const log of logs) {
    if (!isCredited(log.outcome)) continue
    if (compareDayKeys(log.dayKey, today) > 0) continue
    if (lastCompletion === null || compareDayKeys(log.dayKey, lastCompletion) > 0) {
      lastCompletion = log.dayKey
    }
  }

  const daysSinceLastCompletion =
    lastCompletion === null ? null : diffDays(lastCompletion, today)

  // A habit never completed is treated as neglected since it was created,
  // capped the same way — new habits should surface, but not overwhelm.
  const neglectDays = Math.min(
    rules.maxNeglectDays,
    daysSinceLastCompletion ?? diffDays(habit.startDayKey, today),
  )

  /*
   * Consecutive missed scheduled occurrences, walking backwards from yesterday.
   * Today is excluded: it is still open, and counting it would treat every
   * morning as a miss.
   *
   * The walk starts at most `maxNeglectDays` back, which matters twice. It
   * bounds the score — an unbounded miss count would let a habit ignored for a
   * year outscore everything else permanently, recreating the daily-accusation
   * failure the cooldown exists to prevent. And it bounds the work, instead of
   * materialising every scheduled day since the habit was created.
   */
  const windowStart = maxDayKey(habit.startDayKey, addDays(today, -rules.maxNeglectDays))
  const scheduled = scheduledDaysBetween(habit, windowStart, today).filter(
    (day) => day !== today,
  )
  let consecutiveMisses = 0
  for (let i = scheduled.length - 1; i >= 0; i--) {
    const day = scheduled[i]!
    if (isCredited(byDay.get(day)?.outcome ?? 'skip')) break
    consecutiveMisses += 1
  }

  const score = neglectDays + rules.missWeight * consecutiveMisses + habit.difficulty

  return { score, daysSinceLastCompletion, consecutiveMisses }
}

/**
 * Chooses today's focus, or `null` when nothing is eligible.
 *
 * Only habits actually due today are considered — offering a bonus on something
 * not scheduled would be incoherent.
 */
export function pickDailyFocus(
  input: PickFocusInput,
  rules: FocusRules = DEFAULT_FOCUS_RULES,
): FocusCandidate | null {
  const { habits, logsByHabit, recentFocus, today } = input

  const benched = benchedHabitIds(recentFocus, today, rules)

  const candidates: FocusCandidate[] = habits
    .filter((habit) => isHabitDueOn(habit, today))
    .map((habit) => {
      const logs = logsByHabit.get(habit.id) ?? []
      const { score, daysSinceLastCompletion, consecutiveMisses } = neglectScore(
        habit,
        logs,
        today,
        rules,
      )
      return {
        habit,
        score,
        daysSinceLastCompletion,
        consecutiveMisses,
        benched: benched.has(habit.id),
      }
    })

  if (candidates.length === 0) return null

  // Benched habits are excluded outright rather than penalised, so the cooldown
  // is a guarantee rather than a tendency. If everything is benched — one habit,
  // held focus for days — fall back to the full set: no focus at all would be a
  // worse outcome than a repeat.
  const eligible = candidates.filter((candidate) => !candidate.benched)
  const pool = eligible.length > 0 ? eligible : candidates

  return [...pool].sort(
    (a, b) => b.score - a.score || a.habit.id.localeCompare(b.habit.id),
  )[0]!
}

/**
 * Habits currently serving a cooldown.
 *
 * A habit that has been focus for `maxConsecutiveDays` immediately preceding
 * days is benched for the next `benchDays`.
 */
export function benchedHabitIds(
  recentFocus: readonly DailyFocus[],
  today: DayKey,
  rules: FocusRules = DEFAULT_FOCUS_RULES,
): Set<string> {
  const benched = new Set<string>()
  if (rules.maxConsecutiveDays <= 0) return benched

  const byDay = new Map<DayKey, DailyFocus>()
  for (const focus of recentFocus) byDay.set(focus.dayKey, focus)

  // Count how many days back from yesterday a single habit held focus without
  // interruption.
  const lookback = rules.maxConsecutiveDays + rules.benchDays
  for (let offset = 1; offset <= lookback; offset++) {
    const day = addDays(today, -offset)
    const focus = byDay.get(day)
    if (!focus) continue

    let run = 0
    for (let back = offset; back <= lookback; back++) {
      const candidate = byDay.get(addDays(today, -back))
      if (candidate?.habitId !== focus.habitId) break
      run += 1
    }

    // The run ended `offset - 1` days ago. It blocks while that gap is still
    // shorter than the bench period.
    if (run >= rules.maxConsecutiveDays && offset - 1 < rules.benchDays) {
      benched.add(focus.habitId)
    }
  }

  return benched
}
