/**
 * A single habit's own context: when it was last done, whether it is asked for
 * today, and when it comes round next.
 *
 * Pure and clock-free like the rest of the domain — `today` is passed in.
 *
 * ## Why this exists
 *
 * A habit's page could show a streak and a heat grid and still leave the two
 * most ordinary questions unanswered: *when did I last actually do this?* and
 * *is it on today?* Both are trivially derivable and neither was surfaced, so
 * the page read as a scoreboard rather than as the habit's own record.
 *
 * ## Framing
 *
 * `daysSinceLastDone` is a fact, not a verdict, and the copy built on it says
 * how long it has been without editorialising. `CLAUDE.md` forbids punishment
 * mechanics, and "17 days since you last managed this" is punishment written as
 * a statistic. The UI pairs the gap with the two-minute version — the way back
 * in — and never with a judgement about it.
 */

import type { DayKey, Habit, HabitLog, Weekday } from '@/domain/types'
import { addDays, compareDayKeys, diffDays } from '@/domain/time/dayKey'
import { daysOfWeek, endOfWeek, startOfWeek } from '@/domain/time/week'
import { isHabitDueOn, weeklyTargetOn } from '@/domain/schedule'
import { indexLogsByDay, isCreditedLog } from '@/domain/logs'

/** How far ahead `nextDue` will look before giving up. */
const NEXT_DUE_HORIZON_DAYS = 14

export interface WeeklyQuota {
  /** Credited days so far in the current week. */
  done: number
  /** The quota in force this week. */
  target: number
  /** Days remaining in the week, including today. Always >= 1. */
  daysLeft: number
  /** Quota already met — the week is banked, not merely in progress. */
  met: boolean
}

export interface HabitCadence {
  /** Most recent day with a credited log, at or before today. Null if never. */
  lastDone: DayKey | null
  /** Whole days between `lastDone` and today. 0 means today. Null if never. */
  daysSinceLastDone: number | null
  /** Today already has a credited log. */
  doneToday: boolean
  /** The habit is live today: in cadence, started, and not paused. */
  dueToday: boolean
  /** Currently archived, so nothing is expected and nothing can be missed. */
  paused: boolean
  /** Created with a start day still in the future. */
  notStartedYet: boolean
  /**
   * The next day after today on which it is due, within a two-week horizon.
   *
   * Null when it is due today, when it is paused, or when the cadence never
   * comes round again (a `specificDays` schedule with no days selected).
   */
  nextDue: DayKey | null
  /** Present only for cadences with a weekly quota you choose the days for. */
  weekly: WeeklyQuota | null
}

export interface HabitCadenceInput {
  habit: Habit
  logs: readonly HabitLog[]
  today: DayKey
  weekStartsOn: Weekday
}

export function habitCadence({
  habit,
  logs,
  today,
  weekStartsOn,
}: HabitCadenceInput): HabitCadence {
  const byDay = indexLogsByDay(logs)

  /*
   * Scanning the logs rather than walking days back from today: a habit
   * untouched for a year would otherwise cost 365 iterations to learn one date,
   * and the log list is the smaller collection by construction.
   *
   * Future-dated logs are ignored. They should not exist — the backdate window
   * only reaches backwards — but "last done" must mean "already happened", or
   * an imported backup from a device with a skewed clock reads as the habit
   * having been done tomorrow.
   */
  let lastDone: DayKey | null = null
  for (const log of logs) {
    if (!isCreditedLog(log)) continue
    if (compareDayKeys(log.dayKey, today) > 0) continue
    if (lastDone === null || compareDayKeys(log.dayKey, lastDone) > 0) lastDone = log.dayKey
  }

  const paused = habit.status === 'archived'
  const notStartedYet = compareDayKeys(habit.startDayKey, today) > 0
  const dueToday = isHabitDueOn(habit, today)

  let nextDue: DayKey | null = null
  if (!dueToday && !paused) {
    for (let offset = 1; offset <= NEXT_DUE_HORIZON_DAYS; offset += 1) {
      const candidate = addDays(today, offset)
      if (isHabitDueOn(habit, candidate)) {
        nextDue = candidate
        break
      }
    }
  }

  return {
    lastDone,
    daysSinceLastDone: lastDone === null ? null : diffDays(lastDone, today),
    doneToday: isCreditedLog(byDay.get(today)),
    dueToday,
    paused,
    notStartedYet,
    nextDue,
    weekly: weeklyQuota(habit, byDay, today, weekStartsOn),
  }
}

/**
 * The week's quota, for cadences where you pick the days yourself.
 *
 * Only `timesPerWeek` gets one. Daily and set-day habits have a per-day
 * obligation, and rendering "4/7 this week" for them turns Thursday morning
 * into a report of everything not yet done — the shape of guilt this app is
 * built to avoid. `isScheduledOn` draws the same line for the same reason.
 */
function weeklyQuota(
  habit: Habit,
  byDay: ReturnType<typeof indexLogsByDay>,
  today: DayKey,
  weekStartsOn: Weekday,
): WeeklyQuota | null {
  if (habit.schedule.kind !== 'timesPerWeek') return null
  const target = weeklyTargetOn(habit, today)
  if (target === null || target <= 0) return null

  const weekStart = startOfWeek(today, weekStartsOn)
  let done = 0
  for (const day of daysOfWeek(weekStart, weekStartsOn)) {
    if (compareDayKeys(day, today) > 0) break
    if (compareDayKeys(day, habit.startDayKey) < 0) continue
    if (isCreditedLog(byDay.get(day))) done += 1
  }

  return {
    done,
    target,
    daysLeft: diffDays(today, endOfWeek(today, weekStartsOn)) + 1,
    met: done >= target,
  }
}

/**
 * How long since the habit was last done, as a phrase.
 *
 * Plain and short. The number is the information; anything added to it becomes
 * commentary on the user, which is exactly what makes a tracker unpleasant to
 * open after a bad week.
 */
export function describeLastDone(daysSince: number | null): string {
  if (daysSince === null) return 'Not yet logged'
  // "Today", not "Done today": this line answers *when*, and the status line
  // beside it answers *what now*. Both saying "Done today" is one fact printed
  // twice, which makes the panel look like a rendering fault.
  if (daysSince === 0) return 'Today'
  if (daysSince === 1) return 'Yesterday'
  if (daysSince < 7) return `${daysSince} days ago`
  if (daysSince < 14) return 'Over a week ago'
  if (daysSince < 61) return `${Math.floor(daysSince / 7)} weeks ago`
  return `${Math.floor(daysSince / 30)} months ago`
}

/**
 * Where the habit stands today, as one line.
 *
 * Ordered by what the user would want to know first: an explicit pause outranks
 * everything, then whether it is already handled, then whether anything is
 * being asked of them right now.
 *
 * `nextDueLabel` is a ready-made phrase — "tomorrow", "on Monday" — because
 * naming a date is a formatting decision and formatting is the UI's job. The
 * domain has no locale and no idea how the app writes dates.
 */
export function describeCadenceStatus(cadence: HabitCadence, nextDueLabel: string): string {
  if (cadence.paused) return 'Paused — nothing is expected, and nothing can be missed'
  if (cadence.notStartedYet) return 'Starts later — nothing is due yet'

  /*
   * The quota outranks "done today" rather than the other way round: on a
   * 3×/week habit, today's completion is already counted in it, and "2 of 3
   * this week" answers both questions where "logged" answers only one.
   */
  if (cadence.weekly) {
    const { done, target, daysLeft, met } = cadence.weekly
    if (met) return `${done} of ${target} this week — the week is already met`
    const left = target - done
    return `${done} of ${target} this week · ${left} to go, ${daysLeft} ${
      daysLeft === 1 ? 'day' : 'days'
    } left`
  }

  if (cadence.doneToday) return 'Logged — nothing more needed today'
  if (cadence.dueToday) return 'On for today'
  return cadence.nextDue === null ? 'Not scheduled' : `Not today — due ${nextDueLabel}`
}
