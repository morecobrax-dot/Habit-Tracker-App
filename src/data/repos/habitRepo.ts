import type { DayKey, Habit, Instant } from '@/domain/types'
import {
  normalizeHabitDraft,
  validateHabitDraft,
  type HabitDraft,
} from '@/domain/habitValidation'
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

export async function updateHabit(
  id: string,
  draft: HabitDraft,
  instant: Instant,
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

export async function archiveHabit(
  id: string,
  instant: Instant,
  database: HabitTrackerDb = db,
): Promise<void> {
  await database.habits.update(id, {
    status: 'archived',
    archivedAt: instant,
    updatedAt: instant,
  })
}

export async function unarchiveHabit(
  id: string,
  instant: Instant,
  database: HabitTrackerDb = db,
): Promise<void> {
  const existing = await database.habits.get(id)
  if (!existing) throw new Error(`No habit with id ${id}`)
  const restored: Habit = { ...existing, status: 'active', updatedAt: instant }
  delete restored.archivedAt
  await database.habits.put(restored)
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
