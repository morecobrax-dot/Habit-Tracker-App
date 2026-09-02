import { db, TABLE_NAMES, type HabitTrackerDb, type TableName } from '@/data/db'

/**
 * JSON export and import.
 *
 * Everything lives on one device with no backend, so a lost phone or a cleared
 * site-data setting is total data loss. This is the only recovery path, which
 * is why it exists in phase 1 rather than being deferred to "polish".
 *
 * The export is intentionally a dumb dump of every table: it stays correct as
 * later phases start populating logs, focus and game state, with no changes
 * here.
 */

export const BACKUP_FORMAT = 'habit-tracker-backup'
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  /** Schema version of the database the backup came from. */
  dbVersion: number
  exportedAt: number
  tables: Record<TableName, unknown[]>
}

export async function exportBackup(
  instant: number,
  database: HabitTrackerDb = db,
): Promise<BackupFile> {
  const tables = {} as Record<TableName, unknown[]>

  await database.transaction('r', database.tables, async () => {
    for (const name of TABLE_NAMES) {
      tables[name] = await database.table(name).toArray()
    }
  })

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    dbVersion: database.verno,
    exportedAt: instant,
    tables,
  }
}

export function backupFilename(instant: number, timeZone: string): string {
  // Local date in the user's zone, so the filename matches the day they think
  // they made the backup on.
  const stamp = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant))
  return `habit-tracker-${stamp}.json`
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupFormatError'
  }
}

export function parseBackup(raw: string): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new BackupFormatError('That file is not valid JSON.')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupFormatError('That file is not a backup.')
  }
  const candidate = parsed as Partial<BackupFile>

  if (candidate.format !== BACKUP_FORMAT) {
    throw new BackupFormatError('That file is not a Habit Tracker backup.')
  }
  if (typeof candidate.version !== 'number' || candidate.version > BACKUP_VERSION) {
    throw new BackupFormatError(
      'That backup was made by a newer version of the app. Update first, then import.',
    )
  }
  if (typeof candidate.tables !== 'object' || candidate.tables === null) {
    throw new BackupFormatError('That backup has no data in it.')
  }

  for (const name of TABLE_NAMES) {
    const rows = (candidate.tables as Record<string, unknown>)[name]
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new BackupFormatError(`Table "${name}" is malformed.`)
    }
  }

  return candidate as BackupFile
}

export interface ImportResult {
  counts: Record<TableName, number>
}

/**
 * Replaces the entire database with the backup's contents.
 *
 * Replace rather than merge, deliberately. Merging two divergent histories
 * raises questions with no good answer — which log wins when both devices
 * logged the same habit on the same day? — and a wrong merge silently corrupts
 * the streak and XP record. Replace is predictable, and the caller is expected
 * to confirm destructively before calling.
 *
 * The whole import runs in one transaction: a malformed row aborts everything
 * and leaves the existing data untouched.
 */
export async function importBackup(
  backup: BackupFile,
  database: HabitTrackerDb = db,
): Promise<ImportResult> {
  const counts = {} as Record<TableName, number>

  await database.transaction('rw', database.tables, async () => {
    for (const name of TABLE_NAMES) {
      const rows = backup.tables[name] ?? []
      await database.table(name).clear()
      if (rows.length > 0) await database.table(name).bulkAdd(rows)
      counts[name] = rows.length
    }
  })

  return { counts }
}

/** Wipes everything. Used by the "start over" action in settings. */
export async function clearAllData(database: HabitTrackerDb = db): Promise<void> {
  await database.transaction('rw', database.tables, async () => {
    for (const name of TABLE_NAMES) {
      await database.table(name).clear()
    }
  })
}
