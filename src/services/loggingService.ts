import type { DayKey, HabitLog, LogOutcome, PartialKind } from '@/domain/types'
import { isCredited, NO_RULES_VERSION } from '@/domain/logs'
import { compareDayKeys, isWithinBackdateWindow, toDayKey } from '@/domain/time/dayKey'
import { isScheduledOn } from '@/domain/schedule'
import { db } from '@/data/db'
import { getHabit } from '@/data/repos/habitRepo'
import { deleteLog, getLog, upsertLog } from '@/data/repos/logRepo'
import { getFreezeEvent, refundFreeze } from '@/data/repos/gameStateRepo'
import { getSettings } from '@/data/repos/settingsRepo'
import { dayContextFrom, systemClock, type Clock } from '@/services/clock'

/**
 * Logging orchestration: validate, write the log, reconcile freeze tokens.
 *
 * All the rules live in the domain layer; this reads the pieces, calls them,
 * and persists the result.
 */

export class LoggingError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unknown_habit'
      | 'archived_habit'
      | 'outside_backdate_window'
      | 'before_habit_start'
      | 'not_scheduled',
  ) {
    super(message)
    this.name = 'LoggingError'
  }
}

export interface LogHabitInput {
  habitId: string
  dayKey: DayKey
  outcome: LogOutcome
  partialKind?: PartialKind | undefined
  note?: string | undefined
}

export interface LogHabitResult {
  log: HabitLog
  /** True when a previously spent freeze was returned because of this log. */
  freezeRefunded: boolean
}

export async function logHabit(
  input: LogHabitInput,
  clock: Clock = systemClock,
  database = db,
): Promise<LogHabitResult> {
  const settings = await getSettings(database)
  const ctx = dayContextFrom(settings)
  const now = clock.now()
  const today = toDayKey(now, ctx)

  const habit = await getHabit(input.habitId, database)
  if (!habit) throw new LoggingError('That habit no longer exists.', 'unknown_habit')
  if (habit.status !== 'active') {
    throw new LoggingError('That habit is archived.', 'archived_habit')
  }

  if (!isWithinBackdateWindow(input.dayKey, today, settings.backdateWindowDays)) {
    throw new LoggingError(
      `You can only log today and the ${settings.backdateWindowDays} days before it.`,
      'outside_backdate_window',
    )
  }

  if (compareDayKeys(input.dayKey, habit.startDayKey) < 0) {
    throw new LoggingError(
      'That day is before the habit existed.',
      'before_habit_start',
    )
  }

  if (!isScheduledOn(habit.schedule, input.dayKey)) {
    throw new LoggingError('That habit is not scheduled on that day.', 'not_scheduled')
  }

  const log = await upsertLog(
    {
      habitId: input.habitId,
      dayKey: input.dayKey,
      outcome: input.outcome,
      partialKind: input.partialKind,
      note: input.note,
      loggedAt: now,
      tz: ctx.timeZone,
      // Backdated means the day being logged is not the day we are in.
      isBackdated: input.dayKey !== today,
      // Phase 3 fills these in. Awards are snapshotted, never recomputed, so
      // these rows will honestly stay at zero.
      wasFocus: false,
      xpAwarded: 0,
      rulesVersion: NO_RULES_VERSION,
    },
    database,
  )

  // If a freeze was spent covering this day and you have now shown you did the
  // thing, give the token back. Without this, backdating silently costs you a
  // token you never needed to spend.
  let freezeRefunded = false
  if (isCredited(input.outcome)) {
    const existing = await getFreezeEvent(input.habitId, input.dayKey, database)
    if (existing) {
      freezeRefunded = await refundFreeze(input.habitId, input.dayKey, database)
    }
  }

  return { log, freezeRefunded }
}

/**
 * Removes a log entirely — for a mis-tap.
 *
 * Deliberately does not re-spend a freeze token to cover the day it vacates.
 * Freezes are settled at rollover, on days that have closed; re-deriving one
 * here would let a user farm tokens by logging and unlogging.
 */
export async function unlogHabit(
  habitId: string,
  dayKey: DayKey,
  clock: Clock = systemClock,
  database = db,
): Promise<void> {
  const settings = await getSettings(database)
  const today = toDayKey(clock.now(), dayContextFrom(settings))

  if (!isWithinBackdateWindow(dayKey, today, settings.backdateWindowDays)) {
    throw new LoggingError(
      'That day can no longer be edited.',
      'outside_backdate_window',
    )
  }

  await deleteLog(habitId, dayKey, database)
}

export async function getLogFor(
  habitId: string,
  dayKey: DayKey,
  database = db,
): Promise<HabitLog | undefined> {
  return getLog(habitId, dayKey, database)
}
