import { describe, expect, it } from 'vitest'
import {
  daysOfWeek,
  endOfWeek,
  isSameWeek,
  startOfWeek,
  weekKey,
  weeksBetween,
} from '@/domain/time/week'

// 2026-09-02 is a Wednesday. The surrounding week is Mon 31 Aug - Sun 6 Sep.
const WEDNESDAY = '2026-09-02'

describe('startOfWeek', () => {
  it('finds the Monday of a Monday-start week', () => {
    expect(startOfWeek(WEDNESDAY, 1)).toBe('2026-08-31')
  })

  it('is idempotent on the start day itself', () => {
    expect(startOfWeek('2026-08-31', 1)).toBe('2026-08-31')
  })

  it('keeps Sunday in the preceding week when weeks start on Monday', () => {
    expect(startOfWeek('2026-09-06', 1)).toBe('2026-08-31')
    expect(startOfWeek('2026-09-07', 1)).toBe('2026-09-07')
  })

  it('handles Sunday-start weeks', () => {
    expect(startOfWeek(WEDNESDAY, 0)).toBe('2026-08-30')
    expect(startOfWeek('2026-08-30', 0)).toBe('2026-08-30')
  })

  it('handles every possible week start', () => {
    // Whatever the start day, the result must be that weekday and no more than
    // six days before the input.
    for (let start = 0; start <= 6; start++) {
      const result = startOfWeek(WEDNESDAY, start as 0 | 1 | 2 | 3 | 4 | 5 | 6)
      const daysBack = (new Date(`${WEDNESDAY}T00:00:00Z`).getTime() -
        new Date(`${result}T00:00:00Z`).getTime()) / 86_400_000
      expect(daysBack).toBeGreaterThanOrEqual(0)
      expect(daysBack).toBeLessThanOrEqual(6)
      expect(new Date(`${result}T00:00:00Z`).getUTCDay()).toBe(start)
    }
  })

  it('crosses month and year boundaries', () => {
    expect(startOfWeek('2026-01-01', 1)).toBe('2025-12-29')
  })
})

describe('endOfWeek', () => {
  it('is six days after the start', () => {
    expect(endOfWeek(WEDNESDAY, 1)).toBe('2026-09-06')
    expect(endOfWeek(WEDNESDAY, 0)).toBe('2026-09-05')
  })
})

describe('weekKey', () => {
  it('is stable for every day in the same week', () => {
    const keys = daysOfWeek(WEDNESDAY, 1).map((d) => weekKey(d, 1))
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe('W2026-08-31')
  })

  it('changes at the week boundary', () => {
    expect(weekKey('2026-09-06', 1)).toBe('W2026-08-31')
    expect(weekKey('2026-09-07', 1)).toBe('W2026-09-07')
  })

  it('sorts chronologically as a plain string', () => {
    const keys = ['2026-01-05', '2025-12-29', '2026-09-07'].map((d) => weekKey(d, 1))
    expect([...keys].sort()).toEqual(['W2025-12-29', 'W2026-01-05', 'W2026-09-07'])
  })

  it('avoids the ISO year-boundary trap', () => {
    // Under ISO numbering, 2027-01-01 falls in week 53 of 2026, so a naive
    // `YYYY-Www` key would sort it before every 2026 week. Start-date keys have
    // no such problem.
    expect(weekKey('2027-01-01', 1)).toBe('W2026-12-28')
    expect(weekKey('2026-12-28', 1) < weekKey('2027-01-04', 1)).toBe(true)
  })
})

describe('daysOfWeek', () => {
  it('returns seven consecutive days beginning at the week start', () => {
    expect(daysOfWeek(WEDNESDAY, 1)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ])
  })
})

describe('weeksBetween', () => {
  it('is zero within a week', () => {
    expect(weeksBetween('2026-08-31', '2026-09-06', 1)).toBe(0)
  })

  it('counts adjacent weeks as one apart', () => {
    expect(weeksBetween('2026-09-06', '2026-09-07', 1)).toBe(1)
  })

  it('is signed', () => {
    expect(weeksBetween('2026-09-07', '2026-08-31', 1)).toBe(-1)
  })

  it('counts across a year boundary', () => {
    expect(weeksBetween('2025-12-29', '2026-01-05', 1)).toBe(1)
  })
})

describe('isSameWeek', () => {
  it('groups by the configured week start', () => {
    // Sunday 6 September: same week as Monday 31 August only when weeks start
    // on Monday.
    expect(isSameWeek('2026-08-31', '2026-09-06', 1)).toBe(true)
    expect(isSameWeek('2026-08-31', '2026-09-06', 0)).toBe(false)
  })
})
