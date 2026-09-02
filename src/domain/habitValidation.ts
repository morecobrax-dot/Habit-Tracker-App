/**
 * Habit validation. Pure: takes a draft, returns field errors.
 *
 * Lives in the domain layer so the same rules apply to form input, to imported
 * backup files, and to anything an AI layer generates later. Validation that
 * only exists in a form component is validation that a JSON import walks past.
 */

import type { DifficultyTier, Schedule, Weekday } from '@/domain/types'

export interface HabitDraft {
  name: string
  category: string
  difficulty: DifficultyTier
  schedule: Schedule
  minimumVersion: string
  estimatedMinutes?: number | undefined
  notes?: string | undefined
}

export type HabitFieldErrors = Partial<Record<keyof HabitDraft, string>>

export const NAME_MAX = 80
export const CATEGORY_MAX = 40
export const MINIMUM_VERSION_MAX = 140
export const NOTES_MAX = 500

export function validateHabitDraft(draft: HabitDraft): HabitFieldErrors {
  const errors: HabitFieldErrors = {}

  const name = draft.name.trim()
  if (name.length === 0) errors.name = 'Give it a name.'
  else if (name.length > NAME_MAX) errors.name = `Keep it under ${NAME_MAX} characters.`

  if (draft.category.trim().length > CATEGORY_MAX) {
    errors.category = `Keep it under ${CATEGORY_MAX} characters.`
  }

  // The minimum version is required by design, not by accident. A habit with no
  // defined bad-day fallback has no way to earn credit on a bad day, which is
  // the failure mode this app exists to prevent.
  const minimum = draft.minimumVersion.trim()
  if (minimum.length === 0) {
    errors.minimumVersion = 'Required — what is the 2-minute version of this?'
  } else if (minimum.length > MINIMUM_VERSION_MAX) {
    errors.minimumVersion = `Keep it under ${MINIMUM_VERSION_MAX} characters.`
  }

  if (![1, 2, 3, 4].includes(draft.difficulty)) {
    errors.difficulty = 'Pick a difficulty tier.'
  }

  const scheduleError = validateSchedule(draft.schedule)
  if (scheduleError) errors.schedule = scheduleError

  if (draft.estimatedMinutes !== undefined) {
    if (!Number.isFinite(draft.estimatedMinutes) || draft.estimatedMinutes <= 0) {
      errors.estimatedMinutes = 'Must be a positive number of minutes.'
    } else if (draft.estimatedMinutes > 24 * 60) {
      errors.estimatedMinutes = 'That is more than a day.'
    }
  }

  if ((draft.notes ?? '').length > NOTES_MAX) {
    errors.notes = `Keep it under ${NOTES_MAX} characters.`
  }

  return errors
}

export function validateSchedule(schedule: Schedule): string | null {
  switch (schedule.kind) {
    case 'daily':
      return null
    case 'timesPerWeek':
      if (!Number.isInteger(schedule.target) || schedule.target < 1 || schedule.target > 7) {
        return 'Pick between 1 and 7 times per week.'
      }
      return null
    case 'specificDays': {
      if (schedule.days.length === 0) return 'Pick at least one day.'
      const valid = schedule.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      if (!valid) return 'Invalid weekday.'
      if (new Set(schedule.days).size !== schedule.days.length) return 'Duplicate weekday.'
      return null
    }
  }
}

export function isValidHabitDraft(draft: HabitDraft): boolean {
  return Object.keys(validateHabitDraft(draft)).length === 0
}

/** Trims and canonicalises a draft so equal habits store identically. */
export function normalizeHabitDraft(draft: HabitDraft): HabitDraft {
  const normalized: HabitDraft = {
    name: draft.name.trim(),
    category: draft.category.trim(),
    difficulty: draft.difficulty,
    schedule: normalizeSchedule(draft.schedule),
    minimumVersion: draft.minimumVersion.trim(),
  }
  if (draft.estimatedMinutes !== undefined) {
    normalized.estimatedMinutes = draft.estimatedMinutes
  }
  const notes = draft.notes?.trim()
  if (notes) normalized.notes = notes
  return normalized
}

export function normalizeSchedule(schedule: Schedule): Schedule {
  if (schedule.kind !== 'specificDays') return schedule
  const days = [...new Set(schedule.days)].sort((a, b) => a - b) as Weekday[]
  return { kind: 'specificDays', days }
}
