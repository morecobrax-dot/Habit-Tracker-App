import { describe, expect, it } from 'vitest'
import {
  isValidHabitDraft,
  normalizeHabitDraft,
  normalizeSchedule,
  validateHabitDraft,
  validateSchedule,
  type HabitDraft,
} from '@/domain/habitValidation'

const draft = (overrides: Partial<HabitDraft> = {}): HabitDraft => ({
  name: 'Morning walk',
  category: 'Health',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: 'Put shoes on and step outside',
  ...overrides,
})

describe('validateHabitDraft', () => {
  it('accepts a well-formed draft', () => {
    expect(validateHabitDraft(draft())).toEqual({})
    expect(isValidHabitDraft(draft())).toBe(true)
  })

  it('requires a name', () => {
    expect(validateHabitDraft(draft({ name: '' })).name).toBeDefined()
    expect(validateHabitDraft(draft({ name: '   ' })).name).toBeDefined()
  })

  it('requires a minimum version', () => {
    // Not optional by oversight — a habit with no bad-day fallback has no way
    // to earn credit on a bad day, which is the failure this app exists to stop.
    expect(validateHabitDraft(draft({ minimumVersion: '' })).minimumVersion).toBeDefined()
    expect(validateHabitDraft(draft({ minimumVersion: '  ' })).minimumVersion).toBeDefined()
  })

  it('caps field lengths', () => {
    expect(validateHabitDraft(draft({ name: 'x'.repeat(81) })).name).toBeDefined()
    expect(validateHabitDraft(draft({ name: 'x'.repeat(80) })).name).toBeUndefined()
    expect(
      validateHabitDraft(draft({ minimumVersion: 'x'.repeat(141) })).minimumVersion,
    ).toBeDefined()
  })

  it('rejects an unknown difficulty tier', () => {
    expect(validateHabitDraft(draft({ difficulty: 5 as 4 })).difficulty).toBeDefined()
  })

  it('validates estimated minutes when present', () => {
    expect(validateHabitDraft(draft({ estimatedMinutes: 20 })).estimatedMinutes).toBeUndefined()
    expect(validateHabitDraft(draft({ estimatedMinutes: 0 })).estimatedMinutes).toBeDefined()
    expect(validateHabitDraft(draft({ estimatedMinutes: -5 })).estimatedMinutes).toBeDefined()
    expect(validateHabitDraft(draft({ estimatedMinutes: 1441 })).estimatedMinutes).toBeDefined()
    expect(validateHabitDraft(draft({ estimatedMinutes: NaN })).estimatedMinutes).toBeDefined()
  })

  it('allows estimated minutes to be absent', () => {
    expect(validateHabitDraft(draft()).estimatedMinutes).toBeUndefined()
  })
})

describe('validateSchedule', () => {
  it('accepts daily', () => {
    expect(validateSchedule({ kind: 'daily' })).toBeNull()
  })

  it('bounds the weekly target to 1-7', () => {
    expect(validateSchedule({ kind: 'timesPerWeek', target: 3 })).toBeNull()
    expect(validateSchedule({ kind: 'timesPerWeek', target: 0 })).not.toBeNull()
    expect(validateSchedule({ kind: 'timesPerWeek', target: 8 })).not.toBeNull()
    expect(validateSchedule({ kind: 'timesPerWeek', target: 2.5 })).not.toBeNull()
  })

  it('requires at least one weekday', () => {
    expect(validateSchedule({ kind: 'specificDays', days: [] })).not.toBeNull()
    expect(validateSchedule({ kind: 'specificDays', days: [1] })).toBeNull()
  })

  it('rejects out-of-range and duplicate weekdays', () => {
    expect(validateSchedule({ kind: 'specificDays', days: [7 as 6] })).not.toBeNull()
    expect(validateSchedule({ kind: 'specificDays', days: [1, 1] })).not.toBeNull()
  })
})

describe('normalizeHabitDraft', () => {
  it('trims whitespace', () => {
    const result = normalizeHabitDraft(
      draft({ name: '  Walk  ', category: ' Health ', minimumVersion: ' Shoes on ' }),
    )
    expect(result.name).toBe('Walk')
    expect(result.category).toBe('Health')
    expect(result.minimumVersion).toBe('Shoes on')
  })

  it('drops empty optional fields rather than storing blanks', () => {
    const result = normalizeHabitDraft(draft({ notes: '   ' }))
    expect('notes' in result).toBe(false)
  })

  it('keeps meaningful notes', () => {
    expect(normalizeHabitDraft(draft({ notes: ' remember ' })).notes).toBe('remember')
  })

  it('sorts and dedupes weekdays so equal habits store identically', () => {
    expect(normalizeSchedule({ kind: 'specificDays', days: [5, 1, 3, 1] })).toEqual({
      kind: 'specificDays',
      days: [1, 3, 5],
    })
  })

  it('leaves other cadences untouched', () => {
    expect(normalizeSchedule({ kind: 'daily' })).toEqual({ kind: 'daily' })
    expect(normalizeSchedule({ kind: 'timesPerWeek', target: 3 })).toEqual({
      kind: 'timesPerWeek',
      target: 3,
    })
  })
})
