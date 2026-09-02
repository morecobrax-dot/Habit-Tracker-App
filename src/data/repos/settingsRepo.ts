import type { Instant, Settings, Weekday } from '@/domain/types'
import { DEFAULT_SETTINGS } from '@/domain/types'
import { db, type HabitTrackerDb } from '@/data/db'

export async function getSettings(database: HabitTrackerDb = db): Promise<Settings> {
  const stored = await database.settings.get('singleton')
  if (stored) return stored
  // Read-before-init, or a database restored without a settings row.
  return { ...DEFAULT_SETTINGS, createdAt: 0, updatedAt: 0 }
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'dayStartHour'
    | 'weekStartsOn'
    | 'timeZone'
    | 'freezeTokensPerWeek'
    | 'maxFreezeTokens'
    | 'backdateWindowDays'
  >
>

export function validateSettingsPatch(patch: SettingsPatch): Record<string, string> {
  const errors: Record<string, string> = {}

  if (patch.dayStartHour !== undefined) {
    if (!Number.isInteger(patch.dayStartHour) || patch.dayStartHour < 0 || patch.dayStartHour > 12) {
      // Capped at 12 rather than 23: a day boundary in the afternoon would make
      // "today" mean something nobody can reason about.
      errors.dayStartHour = 'Pick an hour between 0 and 12.'
    }
  }

  if (patch.weekStartsOn !== undefined) {
    if (!Number.isInteger(patch.weekStartsOn) || patch.weekStartsOn < 0 || patch.weekStartsOn > 6) {
      errors.weekStartsOn = 'Invalid weekday.'
    }
  }

  if (patch.timeZone !== undefined && patch.timeZone !== 'auto') {
    if (!isValidTimeZone(patch.timeZone)) errors.timeZone = 'Unknown timezone.'
  }

  if (patch.freezeTokensPerWeek !== undefined) {
    if (
      !Number.isInteger(patch.freezeTokensPerWeek) ||
      patch.freezeTokensPerWeek < 0 ||
      patch.freezeTokensPerWeek > 7
    ) {
      errors.freezeTokensPerWeek = 'Pick between 0 and 7.'
    }
  }

  if (patch.maxFreezeTokens !== undefined) {
    if (
      !Number.isInteger(patch.maxFreezeTokens) ||
      patch.maxFreezeTokens < 0 ||
      patch.maxFreezeTokens > 30
    ) {
      errors.maxFreezeTokens = 'Pick between 0 and 30.'
    }
  }

  if (patch.backdateWindowDays !== undefined) {
    if (
      !Number.isInteger(patch.backdateWindowDays) ||
      patch.backdateWindowDays < 0 ||
      patch.backdateWindowDays > 7
    ) {
      errors.backdateWindowDays = 'Pick between 0 and 7 days.'
    }
  }

  return errors
}

export async function updateSettings(
  patch: SettingsPatch,
  instant: Instant,
  database: HabitTrackerDb = db,
): Promise<Settings> {
  const errors = validateSettingsPatch(patch)
  if (Object.keys(errors).length > 0) {
    throw new Error(`Invalid settings: ${Object.values(errors).join('; ')}`)
  }

  return database.transaction('rw', database.settings, async () => {
    const current = await database.settings.get('singleton')
    const base: Settings = current ?? {
      ...DEFAULT_SETTINGS,
      createdAt: instant,
      updatedAt: instant,
    }
    const next: Settings = { ...base, ...patch, updatedAt: instant }
    await database.settings.put(next)
    return next
  })
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** The device's own zone, used when `timeZone` is `'auto'`. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function resolveTimeZone(settings: Pick<Settings, 'timeZone'>): string {
  return settings.timeZone === 'auto' ? deviceTimeZone() : settings.timeZone
}

/** Narrows the stored week-start value for the pure time functions. */
export function weekStartOf(settings: Pick<Settings, 'weekStartsOn'>): Weekday {
  return settings.weekStartsOn
}
