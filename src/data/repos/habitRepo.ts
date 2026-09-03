import type { ArchivedPeriod, DayKey, Habit, Instant, ScheduleChange } from '@/domain/types'
import {
  normalizeHabitDraft,
  validateHabitDraft,
  type HabitDraft,
} from '@/domain/habitValidation'
import { sameSchedule } from '@/domain/schedule'
import { addDays, compareDayKeys } from '@/domain/time/dayKey'
import { db, type HabitTrackerDb } from '@/data/db'
import { newId } from '@/data/id'

/**
 * Habit persistence.
 *
 * Repos are the only code that touches Dexie. They validate through the domain
 * layer before writing, so an invalid habit cannot enter the database by any
 * path — form, import, or future AI plan.
 */

export class HabitValidationError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super(`Invalid habit: ${Object.values(fieldErrors).join('; ')}`)
    this.name = 'HabitValidationError'
  }
}

function assertValid(draft: HabitDraft) {
  const errors = validateHabitDraft(draft)
  if (Object.keys(errors).length > 0) {
    throw new HabitValidationError(errors as Record<string, string>)
  }
}

export async function listHabits(database: HabitTrackerDb = db): Promise<Habit[]> {
  const all = await database.habits.toArray()
  return all.sort(compareHabits)
}

export async function listActiveHabits(database: HabitTrackerDb = db): Promise<Habit[]> {
  const active = await database.habits.where('status').equals('active').toArray()
  return active.sort(compareHabits)
}

export async function listArchivedHabits(database: HabitTrackerDb = db): Promise<Habit[]> {
  const archived = await database.habits.where('status').equals('archived').toArray()
  return archived.sort(compareHabits)
}

export async function getHabit(
  id: string,
  database: HabitTrackerDb = db,
): Promise<Habit | undefined> {
  return database.habits.get(id)
}

export interface CreateHabitInput {
  draft: HabitDraft
  /** The day the habit starts counting — normally today. */
  startDayKey: DayKey
  instant: Instant
}

export async function createHabit(
  { draft, startDayKey, instant }: CreateHabitInput,
  database: HabitTrackerDb = db,
): Promise<Habit> {
  const normalized = normalizeHabitDraft(draft)
  assertValid(normalized)

  // Append to the end of the active list.
  const maxOrder = await database.habits
    .orderBy('sortOrder')
    .last()
    .then((h) => h?.sortOrder ?? 0)

  const habit: Habit = {
    id: newId(),
    name: normalized.name,
    category: normalized.category,
    difficulty: normalized.difficulty,
    schedule: normalized.schedule,
    minimumVersion: normalized.minimumVersion,
    status: 'active',
    startDayKey,
    sortOrder: maxOrder + 1,
    createdAt: instant,
    updatedAt: instant,
  }
  // Set optional fields only when present, so absent means "no key" rather than
  // a stored `undefined`. IndexedDB preserves the difference, and a key holding
  // undefined breaks `in` checks and index lookups later.
  if (normalized.estimatedMinutes !== undefined) {
    habit.estimatedMinutes = normalized.estimatedMinutes
  }
  if (normalized.notes !== undefined) habit.notes = normalized.notes
  if (normalized.icon !== undefined) habit.icon = normalized.icon

  await database.habits.add(habit)
  return habit
}

/**
 * When a change to *when a habit is owed* takes effect.
 *
 * Always tomorrow, never today, and this is load-bearing in both directions:
 *
 * - Narrowing today (daily → Mon/Wed/Fri on a Tuesday, or archiving) would drop
 *   today out of the schedule walk. A completion already logged today would
 *   stop counting and the streak would quietly shrink — a silent streak break
 *   caused by opening a settings screen.
 * - Widening today (Mon/Wed/Fri → daily on a Tuesday) would make today owed
 *   from the moment you saved, so an edit at 11pm creates a miss you never had
 *   a chance to avoid.
 *
 * Today was already underway when the edit happened, so today is judged by the
 * rules today started with. If the old cadence leaves an unwanted obligation on
 * that last day, "skip" clears it at no cost.
 */
function effectiveFrom(todayKey: DayKey): DayKey {
  return addDays(todayKey, 1)
}

/**
 * The cadence timeline, seeded on first use.
 *
 * `scheduleHistory` has to describe the *whole* life of the habit, current
 * cadence included, or `scheduleFor` would have nothing to return for today. So
 * the first recorded change also backfills the original cadence, dated to the
 * day the habit started.
 */
function appendScheduleChange(habit: Habit, change: ScheduleChange): ScheduleChange[] {
  const history =
    habit.scheduleHistory && habit.scheduleHistory.length > 0
      ? [...habit.scheduleHistory]
      : [{ from: habit.startDayKey, schedule: habit.schedule }]

  // Two edits on the same day are one change, not two: overwrite rather than
  // append, so the timeline never holds two entries with the same `from`.
  const last = history[history.length - 1]
  if (last && last.from === change.from) history[history.length - 1] = change
  else history.push(change)

  return history
}

export interface HabitEditContext {
  /** The user's today, for dating archive periods and cadence changes. */
  todayKey: DayKey
  instant: Instant
}

export async function updateHabit(
  id: string,
  draft: HabitDraft,
  { todayKey, instant }: HabitEditContext,
  database: HabitTrackerDb = db,
): Promise<Habit> {
  const normalized = normalizeHabitDraft(draft)
  assertValid(normalized)

  return database.transaction('rw', database.habits, async () => {
    const existing = await database.habits.get(id)
    if (!existing) throw new Error(`No habit with id ${id}`)

    // `startDayKey`, `sortOrder`, `status` and `createdAt` are not editable
    // through this path: changing them retroactively rewrites history.
    const updated: Habit = {
      ...existing,
      name: normalized.name,
      category: normalized.category,
      difficulty: normalized.difficulty,
      schedule: normalized.schedule,
      minimumVersion: normalized.minimumVersion,
      updatedAt: instant,
    }

    // Record the cadence change so past days keep being judged by the cadence
    // that was actually in force then. Only on a real change: re-saving the
    // same cadence must not litter the timeline.
    if (!sameSchedule(existing.schedule, normalized.schedule)) {
      updated.scheduleHistory = appendScheduleChange(existing, {
        from: effectiveFrom(todayKey),
        schedule: normalized.schedule,
      })
    }
    // Clearing an optional field means removing the key, not storing undefined.
    if (normalized.estimatedMinutes === undefined) delete updated.estimatedMinutes
    else updated.estimatedMinutes = normalized.estimatedMinutes
    if (normalized.notes === undefined) delete updated.notes
    else updated.notes = normalized.notes
    if (normalized.icon === undefined) delete updated.icon
    else updated.icon = normalized.icon

    await database.habits.put(updated)
    return updated
  })
}

/**
 * Archiving is a pause, not a failure.
 *
 * The archived stretch is recorded as a dated range so the days inside it can
 * be treated as not-scheduled: they cannot be missed, cannot burn a freeze
 * token, and cannot break a streak. Reactivating resumes the streak the habit
 * had when it was put down, which is the behaviour that makes archiving a safe
 * thing to do — if pausing cost you your streak, nobody would ever pause, and
 * the habit would sit there accumulating misses instead.
 */
export async function archiveHabit(
  id: string,
  { todayKey, instant }: HabitEditContext,
  database: HabitTrackerDb = db,
): Promise<void> {
  await database.transaction('rw', database.habits, async () => {
    const existing = await database.habits.get(id)
    if (!existing) throw new Error(`No habit with id ${id}`)

    const periods = [...(existing.archivedPeriods ?? [])]
    const open = periods.findIndex((period) => period.to === null)

    // An already-open range means archive was somehow called twice; leave the
    // earlier start alone rather than moving it forward and losing the gap.
    if (open === -1) periods.push({ from: effectiveFrom(todayKey), to: null })

    const archived: Habit = {
      ...existing,
      status: 'archived',
      archivedPeriods: periods,
      archivedAt: instant,
      updatedAt: instant,
    }
    await database.habits.put(archived)
  })
}

export async function unarchiveHabit(
  id: string,
  { todayKey, instant }: HabitEditContext,
  database: HabitTrackerDb = db,
): Promise<void> {
  await database.transaction('rw', database.habits, async () => {
    const existing = await database.habits.get(id)
    if (!existing) throw new Error(`No habit with id ${id}`)

    // `to` is exclusive, so closing at today makes today live again — the same
    // rule as a habit created today.
    const periods = closeOpenPeriod(existing.archivedPeriods, todayKey)

    const restored: Habit = { ...existing, status: 'active', updatedAt: instant }
    if (periods.length > 0) restored.archivedPeriods = periods
    else delete restored.archivedPeriods
    delete restored.archivedAt

    await database.habits.put(restored)
  })
}

/**
 * Closes the open archived range at `todayKey`.
 *
 * A range that never contained a whole day — archived and reactivated before
 * the pause took effect — is dropped rather than stored, since an empty range
 * is noise that every reader would then have to reason about.
 */
function closeOpenPeriod(
  existing: readonly ArchivedPeriod[] | undefined,
  todayKey: DayKey,
): ArchivedPeriod[] {
  const periods = [...(existing ?? [])]
  const open = periods.findIndex((period) => period.to === null)
  if (open === -1) return periods

  const from = periods[open]!.from
  if (compareDayKeys(from, todayKey) >= 0) periods.splice(open, 1)
  else periods[open] = { from, to: todayKey }

  return periods
}

/**
 * Permanently deletes a habit *and its logs*.
 *
 * Archiving is the intended path and what the UI offers first — deleting throws
 * away history you cannot get back. Kept available because a habit created by
 * mistake shouldn't clutter the archive forever.
 */
export async function deleteHabitPermanently(
  id: string,
  database: HabitTrackerDb = db,
): Promise<void> {
  await database.transaction(
    'rw',
    database.habits,
    database.logs,
    database.dailyFocus,
    database.freezeEvents,
    async () => {
      await database.logs.where('habitId').equals(id).delete()
      await database.freezeEvents.where('habitId').equals(id).delete()
      await database.dailyFocus.where('habitId').equals(id).delete()
      await database.habits.delete(id)
    },
  )
}

/** Persists a new manual ordering. `orderedIds` is the full active list. */
export async function reorderHabits(
  orderedIds: string[],
  instant: Instant,
  database: HabitTrackerDb = db,
): Promise<void> {
  await database.transaction('rw', database.habits, async () => {
    await Promise.all(
      orderedIds.map((id, index) =>
        database.habits.update(id, { sortOrder: index + 1, updatedAt: instant }),
      ),
    )
  })
}

export async function countHabits(database: HabitTrackerDb = db): Promise<number> {
  return database.habits.count()
}

function compareHabits(a: Habit, b: Habit): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  return a.name.localeCompare(b.name)
}
