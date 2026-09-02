import { describe, expect, it } from 'vitest'
import {
  describeSchedule,
  isHabitDueOn,
  isScheduledOn,
  scheduledDaysBetween,
  scheduledDaysInWeek,
  weeklyTarget,
} from '@/domain/schedule'
import type { Habit, Schedule } from '@/domain/types'

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Test habit',
  category: 'General',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: 'Two minutes of it',
  status: 'active',
  startDayKey: '2026-01-01',
  sortOrder: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

// 2026-09-02 is a Wednesday.
const WED = '2026-09-02'
const THU = '2026-09-03'
const SAT = '2026-09-05'
const SUN = '2026-09-06'

describe('isScheduledOn', () => {
  it('schedules daily habits every day', () => {
    expect(isScheduledOn({ kind: 'daily' }, WED)).toBe(true)
    expect(isScheduledOn({ kind: 'daily' }, SUN)).toBe(true)
  })

  it('schedules specific-day habits only on those weekdays', () => {
    const schedule: Schedule = { kind: 'specificDays', days: [1, 3, 5] } // Mon/Wed/Fri
    expect(isScheduledOn(schedule, WED)).toBe(true)
    expect(isScheduledOn(schedule, THU)).toBe(false)
    expect(isScheduledOn(schedule, SUN)).toBe(false)
  })

  it('makes x-per-week habits available every day', () => {
    // A 3x/week habit is not owed on any particular day — you choose when. The
    // week-level quota is what matters, and treating it as a daily obligation
    // is what manufactures "you missed Tuesday" guilt.
    const schedule: Schedule = { kind: 'timesPerWeek', target: 3 }
    expect(isScheduledOn(schedule, WED)).toBe(true)
    expect(isScheduledOn(schedule, SUN)).toBe(true)
  })
})

describe('isHabitDueOn', () => {
  it('is false before the habit existed', () => {
    const h = habit({ startDayKey: '2026-09-03' })
    expect(isHabitDueOn(h, '2026-09-02')).toBe(false)
    expect(isHabitDueOn(h, '2026-09-03')).toBe(true)
  })

  it('is false for archived habits', () => {
    expect(isHabitDueOn(habit({ status: 'archived' }), WED)).toBe(false)
  })

  it('combines status, start day and cadence', () => {
    const h = habit({
      schedule: { kind: 'specificDays', days: [1, 3, 5] },
      startDayKey: '2026-09-01',
    })
    expect(isHabitDueOn(h, WED)).toBe(true)
    expect(isHabitDueOn(h, THU)).toBe(false)
  })
})

describe('weeklyTarget', () => {
  it('is seven for daily habits', () => {
    expect(weeklyTarget({ kind: 'daily' })).toBe(7)
  })

  it('is the configured target for x-per-week habits', () => {
    expect(weeklyTarget({ kind: 'timesPerWeek', target: 3 })).toBe(3)
  })

  it('is the number of selected days for specific-day habits', () => {
    expect(weeklyTarget({ kind: 'specificDays', days: [1, 3, 5] })).toBe(3)
  })
})

describe('scheduledDaysBetween', () => {
  it('lists only the due days in the range', () => {
    const h = habit({ schedule: { kind: 'specificDays', days: [1, 3, 5] } })
    expect(scheduledDaysBetween(h, '2026-08-31', '2026-09-06')).toEqual([
      '2026-08-31', // Mon
      '2026-09-02', // Wed
      '2026-09-04', // Fri
    ])
  })

  it('excludes days before the habit started', () => {
    const h = habit({ startDayKey: '2026-09-03' })
    expect(scheduledDaysBetween(h, '2026-09-01', '2026-09-04')).toEqual([
      '2026-09-03',
      '2026-09-04',
    ])
  })

  it('is empty for an inverted range', () => {
    expect(scheduledDaysBetween(habit(), '2026-09-06', '2026-09-01')).toEqual([])
  })
})

describe('scheduledDaysInWeek', () => {
  it('respects the configured week start', () => {
    const h = habit({ schedule: { kind: 'specificDays', days: [0, 6] } }) // Sat/Sun
    // Monday-start week containing Wednesday 2 September: Sat 5th, Sun 6th.
    expect(scheduledDaysInWeek(h, WED, 1)).toEqual([SAT, SUN])
    // Sunday-start week: Sun 30 August, Sat 5 September.
    expect(scheduledDaysInWeek(h, WED, 0)).toEqual(['2026-08-30', SAT])
  })
})

describe('describeSchedule', () => {
  it('describes each cadence readably', () => {
    expect(describeSchedule({ kind: 'daily' })).toBe('Every day')
    expect(describeSchedule({ kind: 'timesPerWeek', target: 3 })).toBe('3× per week')
    expect(describeSchedule({ kind: 'specificDays', days: [1, 3, 5] })).toBe('Mon, Wed, Fri')
  })

  it('recognises common groupings', () => {
    expect(describeSchedule({ kind: 'specificDays', days: [1, 2, 3, 4, 5] })).toBe('Weekdays')
    expect(describeSchedule({ kind: 'specificDays', days: [0, 6] })).toBe('Weekends')
    expect(describeSchedule({ kind: 'specificDays', days: [0, 1, 2, 3, 4, 5, 6] })).toBe(
      'Every day',
    )
  })

  it('sorts days regardless of input order', () => {
    expect(describeSchedule({ kind: 'specificDays', days: [5, 1, 3] })).toBe('Mon, Wed, Fri')
  })

  it('handles the empty case without crashing', () => {
    expect(describeSchedule({ kind: 'specificDays', days: [] })).toBe('No days selected')
  })
})
