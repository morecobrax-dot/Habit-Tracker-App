import type {
  DayKey,
  HabitLog,
  Instant,
  LogOutcome,
  PartialKind,
  TimeZone,
  XpBreakdown,
} from '@/domain/types'
import { NO_RULES_VERSION } from '@/domain/logs'
import { db, type HabitTrackerDb } from '@/data/db'
import { newId } from '@/data/id'

/**
 * Log persistence.
 *
 * One log per habit per day, enforced by a unique compound index on
 * `[habitId+dayKey]`. Writing the same day twice updates in place rather than
 * inserting a second row.
 */

export interface UpsertLogInput {
  habitId: string
  dayKey: DayKey
  outcome: LogOutcome
  partialKind?: PartialKind | undefined
  note?: string | undefined
  loggedAt: Instant
  tz: TimeZone
  /** True when `dayKey` is not the day `loggedAt` fell in. */
  isBackdated: boolean
  wasFocus: boolean
  xpAwarded: number
  xpBreakdown?: XpBreakdown | undefined
  rulesVersion: string
}

export async function upsertLog(
  input: UpsertLogInput,
  database: HabitTrackerDb = db,
): Promise<HabitLog> {
  return database.transaction('rw', database.logs, async () => {
    const existing = await database.logs.get({ habitId: input.habitId, dayKey: input.dayKey })

    const log: HabitLog = {
      id: existing?.id ?? newId(),
      habitId: input.habitId,
      dayKey: input.dayKey,
      outcome: input.outcome,
      loggedAt: input.loggedAt,
      tz: input.tz,
      isBackdated: input.isBackdated,
      wasFocus: input.wasFocus,
      xpAwarded: input.xpAwarded,
      rulesVersion: input.rulesVersion,
    }
    if (input.partialKind !== undefined) log.partialKind = input.partialKind
    if (input.note !== undefined && input.note !== '') log.note = input.note
    if (input.xpBreakdown !== undefined) log.xpBreakdown = input.xpBreakdown

    await database.logs.put(log)
    return log
  })
}

export async function getLog(
  habitId: string,
  dayKey: DayKey,
  database: HabitTrackerDb = db,
): Promise<HabitLog | undefined> {
  return database.logs.get({ habitId, dayKey })
}

export async function deleteLog(
  habitId: string,
  dayKey: DayKey,
  database: HabitTrackerDb = db,
): Promise<void> {
  await database.logs.where({ habitId, dayKey }).delete()
}

export async function listLogsForHabit(
  habitId: string,
  database: HabitTrackerDb = db,
): Promise<HabitLog[]> {
  return database.logs.where('habitId').equals(habitId).toArray()
}

export async function listLogsForDay(
  dayKey: DayKey,
  database: HabitTrackerDb = db,
): Promise<HabitLog[]> {
  return database.logs.where('dayKey').equals(dayKey).toArray()
}

/** Inclusive range query, used by history views and consistency windows. */
export async function listLogsBetween(
  from: DayKey,
  to: DayKey,
  database: HabitTrackerDb = db,
): Promise<HabitLog[]> {
  return database.logs.where('dayKey').between(from, to, true, true).toArray()
}

export async function listAllLogs(database: HabitTrackerDb = db): Promise<HabitLog[]> {
  return database.logs.toArray()
}

export const DEFAULT_LOG_AWARD = {
  wasFocus: false,
  xpAwarded: 0,
  rulesVersion: NO_RULES_VERSION,
} as const
