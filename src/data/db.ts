import Dexie, { type Table } from 'dexie'
import type {
  DailyFocus,
  FreezeEvent,
  GameState,
  Habit,
  HabitLog,
  Settings,
} from '@/domain/types'
import { DEFAULT_SETTINGS } from '@/domain/types'

/**
 * The IndexedDB schema.
 *
 * All tables are declared in version 1, including the ones phases 2-4 will
 * populate. Dexie handles added tables via a version bump perfectly well, but
 * the model is already designed — declaring it now means no migration, and no
 * risk of a half-migrated database on a device that skipped a release.
 *
 * Index notes:
 *  - `logs` has a compound *unique* index on `[habitId+dayKey]`. One log per
 *    habit per day is a real invariant, and enforcing it at the storage layer
 *    means a double-tap or a racing write fails loudly instead of quietly
 *    double-counting XP later.
 *  - `dayKey` is indexed on its own for "everything logged today" queries, which
 *    the dashboard runs on every render.
 */
export class HabitTrackerDb extends Dexie {
  habits!: Table<Habit, string>
  logs!: Table<HabitLog, string>
  dailyFocus!: Table<DailyFocus, string>
  freezeEvents!: Table<FreezeEvent, string>
  gameState!: Table<GameState, string>
  settings!: Table<Settings, string>

  constructor(name = 'habit-tracker') {
    super(name)

    this.version(1).stores({
      habits: 'id, status, category, sortOrder, [status+sortOrder]',
      logs: 'id, habitId, dayKey, &[habitId+dayKey], [dayKey+habitId], outcome',
      dailyFocus: 'dayKey, habitId, resolved',
      freezeEvents: 'id, dayKey, habitId, createdAt',
      gameState: 'id',
      settings: 'id',
    })
  }
}

export const db = new HabitTrackerDb()

/** Table names, for the generic export/import in `data/backup.ts`. */
export const TABLE_NAMES = [
  'habits',
  'logs',
  'dailyFocus',
  'freezeEvents',
  'gameState',
  'settings',
] as const

export type TableName = (typeof TABLE_NAMES)[number]

/**
 * Creates the singleton rows if they are missing.
 *
 * Idempotent, and safe to call on every app start. Uses `put`-if-absent inside
 * a transaction so two tabs opening at once cannot both insert.
 */
export async function ensureInitialised(instant: number, database: HabitTrackerDb = db) {
  await database.transaction('rw', database.settings, database.gameState, async () => {
    const existingSettings = await database.settings.get('singleton')
    if (!existingSettings) {
      await database.settings.add({
        ...DEFAULT_SETTINGS,
        createdAt: instant,
        updatedAt: instant,
      })
    }

    const existingGameState = await database.gameState.get('singleton')
    if (!existingGameState) {
      await database.gameState.add({
        id: 'singleton',
        totalXp: 0,
        freezeTokens: 0,
        lastFreezeGrantWeekKey: null,
        lastRolloverDayKey: null,
        createdAt: instant,
      })
    }
  })
}

/**
 * Asks the browser to make storage persistent.
 *
 * Without this, IndexedDB is "best effort" and can be evicted under storage
 * pressure — and on iOS, script-writable storage for non-installed sites has
 * historically been cleared after a period of disuse. Installing to the home
 * screen plus this call is the best available protection, but it is not a
 * guarantee, which is why `data/backup.ts` exists.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || !navigator.storage.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
