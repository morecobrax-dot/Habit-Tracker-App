import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { HabitTrackerDb, ensureInitialised } from '@/data/db'
import {
  HabitValidationError,
  archiveHabit,
  createHabit,
  deleteHabitPermanently,
  getHabit,
  listActiveHabits,
  listArchivedHabits,
  listHabits,
  reorderHabits,
  unarchiveHabit,
  updateHabit,
} from '@/data/repos/habitRepo'
import { getSettings, updateSettings } from '@/data/repos/settingsRepo'
import { exportBackup, importBackup, parseBackup, BackupFormatError } from '@/data/backup'
import type { HabitDraft } from '@/domain/habitValidation'

const T0 = Date.UTC(2026, 8, 2, 9, 0)

const draft = (overrides: Partial<HabitDraft> = {}): HabitDraft => ({
  name: 'Morning walk',
  category: 'Health',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: 'Shoes on, step outside',
  ...overrides,
})

let db: HabitTrackerDb
let dbCounter = 0

beforeEach(async () => {
  // A fresh database per test, so no test can see another's writes.
  db = new HabitTrackerDb(`test-db-${dbCounter++}`)
  await db.open()
})

describe('ensureInitialised', () => {
  it('creates the singleton rows', async () => {
    await ensureInitialised(T0, db)
    const settings = await db.settings.get('singleton')
    const game = await db.gameState.get('singleton')
    expect(settings?.dayStartHour).toBe(4)
    expect(game?.freezeTokens).toBe(0)
    // Total XP is deliberately not stored here — it is derived from the logs.
    expect('totalXp' in (game as object)).toBe(false)
  })

  it('is idempotent', async () => {
    await ensureInitialised(T0, db)
    await updateSettings({ dayStartHour: 6 }, T0, db)
    await ensureInitialised(T0 + 1000, db)
    // Must not clobber existing settings on a second app start.
    expect((await getSettings(db)).dayStartHour).toBe(6)
    expect(await db.settings.count()).toBe(1)
    expect(await db.gameState.count()).toBe(1)
  })
})

describe('createHabit', () => {
  it('stores a habit with generated id and metadata', async () => {
    const habit = await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)

    expect(habit.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(habit.name).toBe('Morning walk')
    expect(habit.status).toBe('active')
    expect(habit.startDayKey).toBe('2026-09-02')
    expect(habit.createdAt).toBe(T0)
    expect(await getHabit(habit.id, db)).toEqual(habit)
  })

  it('normalises input before storing', async () => {
    const habit = await createHabit(
      {
        draft: draft({ name: '  Walk  ', schedule: { kind: 'specificDays', days: [5, 1, 3] } }),
        startDayKey: '2026-09-02',
        instant: T0,
      },
      db,
    )
    expect(habit.name).toBe('Walk')
    expect(habit.schedule).toEqual({ kind: 'specificDays', days: [1, 3, 5] })
  })

  it('rejects an invalid habit at the storage boundary', async () => {
    // Validation lives in the domain layer and is enforced here, so a bad habit
    // cannot enter the database through any path — form, import, or AI plan.
    await expect(
      createHabit({ draft: draft({ minimumVersion: '' }), startDayKey: '2026-09-02', instant: T0 }, db),
    ).rejects.toBeInstanceOf(HabitValidationError)
    expect(await db.habits.count()).toBe(0)
  })

  it('appends new habits to the end of the order', async () => {
    const a = await createHabit({ draft: draft({ name: 'A' }), startDayKey: '2026-09-02', instant: T0 }, db)
    const b = await createHabit({ draft: draft({ name: 'B' }), startDayKey: '2026-09-02', instant: T0 }, db)
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder)
    expect((await listHabits(db)).map((h) => h.name)).toEqual(['A', 'B'])
  })
})

describe('updateHabit', () => {
  it('applies edits and bumps updatedAt', async () => {
    const habit = await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)
    const updated = await updateHabit(habit.id, draft({ name: 'Evening walk', difficulty: 3 }), T0 + 5000, db)

    expect(updated.name).toBe('Evening walk')
    expect(updated.difficulty).toBe(3)
    expect(updated.updatedAt).toBe(T0 + 5000)
    expect(updated.createdAt).toBe(T0)
  })

  it('does not let edits rewrite history', async () => {
    // startDayKey and createdAt are deliberately not editable: moving them
    // retroactively changes which days count as missed.
    const habit = await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)
    const updated = await updateHabit(habit.id, draft({ name: 'Changed' }), T0 + 5000, db)
    expect(updated.startDayKey).toBe('2026-09-02')
    expect(updated.sortOrder).toBe(habit.sortOrder)
  })

  it('removes cleared optional fields rather than storing undefined', async () => {
    const habit = await createHabit(
      { draft: draft({ estimatedMinutes: 20, notes: 'hi' }), startDayKey: '2026-09-02', instant: T0 },
      db,
    )
    expect(habit.estimatedMinutes).toBe(20)

    const updated = await updateHabit(habit.id, draft(), T0 + 1000, db)
    expect('estimatedMinutes' in updated).toBe(false)
    expect('notes' in updated).toBe(false)
  })

  it('rejects invalid edits without touching the stored row', async () => {
    const habit = await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)
    await expect(updateHabit(habit.id, draft({ name: '' }), T0, db)).rejects.toBeInstanceOf(
      HabitValidationError,
    )
    expect((await getHabit(habit.id, db))?.name).toBe('Morning walk')
  })

  it('throws for an unknown id', async () => {
    await expect(updateHabit('nope', draft(), T0, db)).rejects.toThrow(/No habit/)
  })
})

describe('archiving', () => {
  it('moves a habit between the active and archived lists', async () => {
    const habit = await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)

    await archiveHabit(habit.id, T0 + 1000, db)
    expect(await listActiveHabits(db)).toHaveLength(0)
    expect(await listArchivedHabits(db)).toHaveLength(1)
    expect((await getHabit(habit.id, db))?.archivedAt).toBe(T0 + 1000)

    await unarchiveHabit(habit.id, T0 + 2000, db)
    expect(await listActiveHabits(db)).toHaveLength(1)
    expect('archivedAt' in (await getHabit(habit.id, db))!).toBe(false)
  })

  it('preserves the habit and its history', async () => {
    const habit = await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)
    await archiveHabit(habit.id, T0 + 1000, db)
    expect(await getHabit(habit.id, db)).toBeDefined()
  })
})

describe('deleteHabitPermanently', () => {
  it('removes the habit and everything referencing it', async () => {
    const habit = await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)
    await db.logs.add({
      id: 'log1',
      habitId: habit.id,
      dayKey: '2026-09-02',
      outcome: 'complete',
      loggedAt: T0,
      tz: 'Europe/London',
      isBackdated: false,
      wasFocus: false,
      xpAwarded: 0,
      rulesVersion: 'none',
    })

    await deleteHabitPermanently(habit.id, db)
    expect(await getHabit(habit.id, db)).toBeUndefined()
    expect(await db.logs.count()).toBe(0)
  })
})

describe('reorderHabits', () => {
  it('persists a new manual ordering', async () => {
    const a = await createHabit({ draft: draft({ name: 'A' }), startDayKey: '2026-09-02', instant: T0 }, db)
    const b = await createHabit({ draft: draft({ name: 'B' }), startDayKey: '2026-09-02', instant: T0 }, db)
    const c = await createHabit({ draft: draft({ name: 'C' }), startDayKey: '2026-09-02', instant: T0 }, db)

    await reorderHabits([c.id, a.id, b.id], T0 + 1000, db)
    expect((await listHabits(db)).map((h) => h.name)).toEqual(['C', 'A', 'B'])
  })
})

describe('the log table invariant', () => {
  it('refuses two logs for the same habit on the same day', async () => {
    // Enforced by a unique compound index, so a double tap or a racing write
    // fails loudly instead of quietly double-counting XP later.
    const habit = await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)
    const log = {
      habitId: habit.id,
      dayKey: '2026-09-02',
      outcome: 'complete' as const,
      loggedAt: T0,
      tz: 'Europe/London',
      isBackdated: false,
      wasFocus: false,
      xpAwarded: 0,
      rulesVersion: 'none',
    }
    await db.logs.add({ ...log, id: 'log1' })
    await expect(db.logs.add({ ...log, id: 'log2' })).rejects.toThrow()
  })
})

describe('backup round trip', () => {
  it('exports and restores the whole database', async () => {
    await ensureInitialised(T0, db)
    await updateSettings({ dayStartHour: 5 }, T0, db)
    const habit = await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)

    const backup = await exportBackup(T0 + 1000, db)
    expect(backup.format).toBe('habit-tracker-backup')
    expect(backup.tables.habits).toHaveLength(1)

    // Restore into a different database, as a new phone would.
    const restored = new HabitTrackerDb(`test-db-restore-${dbCounter++}`)
    await restored.open()
    const result = await importBackup(backup, restored)

    expect(result.counts.habits).toBe(1)
    expect(await getHabit(habit.id, restored)).toEqual(habit)
    expect((await getSettings(restored)).dayStartHour).toBe(5)
  })

  it('survives a JSON string round trip', async () => {
    await ensureInitialised(T0, db)
    await createHabit({ draft: draft(), startDayKey: '2026-09-02', instant: T0 }, db)

    const serialised = JSON.stringify(await exportBackup(T0, db))
    const parsed = parseBackup(serialised)
    expect(parsed.tables.habits).toHaveLength(1)
  })

  it('replaces rather than merges', async () => {
    await ensureInitialised(T0, db)
    await createHabit({ draft: draft({ name: 'Original' }), startDayKey: '2026-09-02', instant: T0 }, db)
    const backup = await exportBackup(T0, db)

    await createHabit({ draft: draft({ name: 'Added later' }), startDayKey: '2026-09-02', instant: T0 }, db)
    expect(await db.habits.count()).toBe(2)

    await importBackup(backup, db)
    expect((await listHabits(db)).map((h) => h.name)).toEqual(['Original'])
  })

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('not json')).toThrow(BackupFormatError)
    expect(() => parseBackup('{"format":"something-else"}')).toThrow(/not a Habit Tracker backup/)
    expect(() => parseBackup('null')).toThrow(BackupFormatError)
  })

  it('refuses a backup from a newer app version', () => {
    const future = JSON.stringify({
      format: 'habit-tracker-backup',
      version: 99,
      tables: {},
    })
    expect(() => parseBackup(future)).toThrow(/newer version/)
  })

  it('rejects a malformed table', () => {
    const bad = JSON.stringify({
      format: 'habit-tracker-backup',
      version: 1,
      tables: { habits: 'not an array' },
    })
    expect(() => parseBackup(bad)).toThrow(/malformed/)
  })
})
