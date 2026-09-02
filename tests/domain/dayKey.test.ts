import { describe, expect, it } from 'vitest'
import {
  addDays,
  backdatableDays,
  compareDayKeys,
  dayEndInstant,
  dayKeyRange,
  dayStartInstant,
  diffDays,
  formatDayKey,
  isDayKey,
  isWithinBackdateWindow,
  parseDayKey,
  toDayKey,
  wallClockAt,
  weekdayOf,
} from '@/domain/time/dayKey'
import type { DayContext } from '@/domain/types'

const ctx = (timeZone: string, dayStartHour = 4): DayContext => ({
  timeZone,
  dayStartHour,
  weekStartsOn: 1,
})

/** Readable instant construction. Always unambiguous because it is UTC. */
const utc = (
  y: number,
  m: number,
  d: number,
  h = 0,
  min = 0,
  s = 0,
) => Date.UTC(y, m - 1, d, h, min, s)

describe('the environment', () => {
  it('has full timezone data available', () => {
    // Everything below is meaningless on a small-ICU build, so fail loudly and
    // specifically rather than with a hundred confusing assertion errors.
    expect(wallClockAt(utc(2026, 6, 1, 12), 'Australia/Lord_Howe').hour).not.toBe(12)
  })
})

describe('toDayKey — the 4am boundary', () => {
  it('attributes late-night activity to the day you just lived', () => {
    // 01:30 local in London (GMT in January).
    expect(toDayKey(utc(2026, 1, 15, 1, 30), ctx('Europe/London'))).toBe('2026-01-14')
  })

  it('starts the new day exactly at dayStartHour', () => {
    expect(toDayKey(utc(2026, 1, 15, 3, 59, 59), ctx('Europe/London'))).toBe('2026-01-14')
    expect(toDayKey(utc(2026, 1, 15, 4, 0, 0), ctx('Europe/London'))).toBe('2026-01-15')
  })

  it('treats midnight as the previous day', () => {
    expect(toDayKey(utc(2026, 1, 15, 0, 0, 0), ctx('Europe/London'))).toBe('2026-01-14')
  })

  it('honours a configured cutoff of 0 (strict midnight)', () => {
    expect(toDayKey(utc(2026, 1, 15, 0, 0, 0), ctx('Europe/London', 0))).toBe('2026-01-15')
    expect(toDayKey(utc(2026, 1, 14, 23, 59, 59), ctx('Europe/London', 0))).toBe('2026-01-14')
  })

  it('rolls back across a month boundary', () => {
    expect(toDayKey(utc(2026, 3, 1, 2, 0), ctx('Europe/London'))).toBe('2026-02-28')
  })

  it('rolls back across a year boundary', () => {
    expect(toDayKey(utc(2026, 1, 1, 2, 0), ctx('Europe/London'))).toBe('2025-12-31')
  })
})

describe('toDayKey — timezones', () => {
  it('resolves the same instant to different days in different zones', () => {
    // 2026-06-15T20:00Z: still the 15th in New York, already the 16th in Tokyo.
    const instant = utc(2026, 6, 15, 20, 0)
    expect(toDayKey(instant, ctx('America/New_York'))).toBe('2026-06-15') // 16:00 EDT
    expect(toDayKey(instant, ctx('Asia/Tokyo'))).toBe('2026-06-16') // 05:00 JST
  })

  it('handles fractional UTC offsets', () => {
    // Kathmandu is UTC+05:45. 22:20Z is 04:05 the next day — just past the cutoff.
    expect(toDayKey(utc(2026, 6, 15, 22, 20), ctx('Asia/Kathmandu'))).toBe('2026-06-16')
    // Ten minutes earlier is 03:55 local, which still belongs to the previous day.
    expect(toDayKey(utc(2026, 6, 15, 22, 10), ctx('Asia/Kathmandu'))).toBe('2026-06-15')
  })

  it('handles zones far behind UTC', () => {
    // Pacific/Honolulu is UTC-10 year round.
    expect(toDayKey(utc(2026, 6, 16, 13, 0), ctx('Pacific/Honolulu'))).toBe('2026-06-15') // 03:00
    expect(toDayKey(utc(2026, 6, 16, 14, 0), ctx('Pacific/Honolulu'))).toBe('2026-06-16') // 04:00
  })
})

describe('toDayKey — daylight saving', () => {
  /**
   * This is the case that a naive implementation gets wrong.
   *
   * New York springs forward on 2026-03-08: 02:00 EST becomes 03:00 EDT. At
   * 04:30 EDT (= 08:30Z) it is unambiguously past the 04:00 cutoff, so the day
   * is the 8th. But "subtract four hours from the instant and take the local
   * date" lands on 23:30 EST on the 7th, because only three wall-clock hours
   * separate 04:30 from 00:30 that morning — giving the wrong day.
   */
  it('does not lose a day when the clocks spring forward', () => {
    expect(toDayKey(utc(2026, 3, 8, 8, 30), ctx('America/New_York'))).toBe('2026-03-08')
  })

  it('still applies the cutoff correctly on a spring-forward morning', () => {
    // 01:30 EST on the 8th, before the jump: previous day.
    expect(toDayKey(utc(2026, 3, 8, 6, 30), ctx('America/New_York'))).toBe('2026-03-07')
    // 03:30 EDT, after the jump but before the cutoff: still the previous day.
    expect(toDayKey(utc(2026, 3, 8, 7, 30), ctx('America/New_York'))).toBe('2026-03-07')
  })

  it('handles the repeated hour when clocks fall back', () => {
    // New York falls back on 2026-11-01: 02:00 EDT becomes 01:00 EST, so local
    // 01:30 happens twice. Both occurrences are before the cutoff, so both
    // belong to 31 October.
    expect(toDayKey(utc(2026, 11, 1, 5, 30), ctx('America/New_York'))).toBe('2026-10-31') // EDT
    expect(toDayKey(utc(2026, 11, 1, 6, 30), ctx('America/New_York'))).toBe('2026-10-31') // EST
  })

  it('handles a 30-minute DST shift', () => {
    // Lord Howe Island shifts by 30 minutes, not an hour: +10:30 to +11:00 on
    // the first Sunday in October.
    expect(toDayKey(utc(2026, 10, 4, 17, 30), ctx('Australia/Lord_Howe'))).toBe('2026-10-05')
  })

  it('handles the London transition', () => {
    // BST begins 2026-03-29 at 01:00 GMT. 03:30Z is 04:30 BST: past the cutoff.
    expect(toDayKey(utc(2026, 3, 29, 3, 30), ctx('Europe/London'))).toBe('2026-03-29')
    expect(toDayKey(utc(2026, 3, 29, 2, 30), ctx('Europe/London'))).toBe('2026-03-28') // 03:30 BST
  })
})

describe('civil date arithmetic', () => {
  it('adds and subtracts days', () => {
    expect(addDays('2026-01-15', 1)).toBe('2026-01-16')
    expect(addDays('2026-01-15', -1)).toBe('2026-01-14')
    expect(addDays('2026-01-15', 0)).toBe('2026-01-15')
  })

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('knows about leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('is unaffected by DST, because it never touches hours', () => {
    // The day America/New_York springs forward is only 23 hours long, but the
    // calendar does not care.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2)
    // And the 25-hour day in autumn.
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2)
  })

  it('measures signed distances', () => {
    expect(diffDays('2026-01-15', '2026-01-20')).toBe(5)
    expect(diffDays('2026-01-20', '2026-01-15')).toBe(-5)
    expect(diffDays('2026-01-15', '2026-01-15')).toBe(0)
    expect(diffDays('2025-12-31', '2026-01-01')).toBe(1)
  })

  it('orders day keys', () => {
    expect(compareDayKeys('2026-01-15', '2026-01-16')).toBe(-1)
    expect(compareDayKeys('2026-01-16', '2026-01-15')).toBe(1)
    expect(compareDayKeys('2026-01-15', '2026-01-15')).toBe(0)
    expect(compareDayKeys('2025-12-31', '2026-01-01')).toBe(-1)
  })

  it('reports weekdays', () => {
    expect(weekdayOf('2026-09-02')).toBe(3) // a Wednesday
    expect(weekdayOf('2026-09-06')).toBe(0) // a Sunday
    expect(weekdayOf('2026-09-07')).toBe(1) // a Monday
  })

  it('enumerates inclusive ranges', () => {
    expect(dayKeyRange('2026-01-15', '2026-01-18')).toEqual([
      '2026-01-15',
      '2026-01-16',
      '2026-01-17',
      '2026-01-18',
    ])
    expect(dayKeyRange('2026-01-15', '2026-01-15')).toEqual(['2026-01-15'])
    expect(dayKeyRange('2026-01-18', '2026-01-15')).toEqual([])
  })
})

describe('day key parsing', () => {
  it('round-trips', () => {
    expect(formatDayKey(parseDayKey('2026-01-05'))).toBe('2026-01-05')
    expect(parseDayKey('2026-01-05')).toEqual({ year: 2026, month: 1, day: 5 })
  })

  it('rejects malformed and impossible dates', () => {
    expect(isDayKey('2026-01-05')).toBe(true)
    expect(isDayKey('2026-1-5')).toBe(false)
    expect(isDayKey('2026-02-30')).toBe(false) // would silently become 2 March
    expect(isDayKey('2026-13-01')).toBe(false)
    expect(isDayKey('2026-00-01')).toBe(false)
    expect(isDayKey('not a date')).toBe(false)
    expect(isDayKey(20260105)).toBe(false)
    expect(isDayKey(null)).toBe(false)
    expect(isDayKey('2026-02-29')).toBe(false) // 2026 is not a leap year
    expect(isDayKey('2028-02-29')).toBe(true)
  })

  it('throws on invalid input rather than guessing', () => {
    expect(() => parseDayKey('2026-02-30')).toThrow(/Invalid DayKey/)
  })
})

describe('day boundaries as instants', () => {
  it('starts a day at the configured hour', () => {
    expect(dayStartInstant('2026-01-15', ctx('Europe/London'))).toBe(utc(2026, 1, 15, 4))
  })

  it('ends a day where the next one begins', () => {
    expect(dayEndInstant('2026-01-15', ctx('Europe/London'))).toBe(
      dayStartInstant('2026-01-16', ctx('Europe/London')),
    )
  })

  it('produces a 23-hour day when the clocks spring forward', () => {
    const c = ctx('America/New_York')
    const start = dayStartInstant('2026-03-07', c)
    const end = dayEndInstant('2026-03-07', c)
    expect((end - start) / 3_600_000).toBe(23)
  })

  it('produces a 25-hour day when the clocks fall back', () => {
    const c = ctx('America/New_York')
    const start = dayStartInstant('2026-10-31', c)
    const end = dayEndInstant('2026-10-31', c)
    expect((end - start) / 3_600_000).toBe(25)
  })

  it('agrees with toDayKey at both edges of a day', () => {
    const c = ctx('America/New_York')
    const day = '2026-03-08' // the short day
    const start = dayStartInstant(day, c)
    const end = dayEndInstant(day, c)
    expect(toDayKey(start, c)).toBe(day)
    expect(toDayKey(end - 1, c)).toBe(day)
    expect(toDayKey(end, c)).toBe('2026-03-09')
  })

  it('agrees with toDayKey across a fractional-offset zone', () => {
    const c = ctx('Asia/Kathmandu')
    const day = '2026-06-15'
    expect(toDayKey(dayStartInstant(day, c), c)).toBe(day)
    expect(toDayKey(dayEndInstant(day, c) - 1, c)).toBe(day)
  })
})

describe('backdating', () => {
  it('offers today plus the window, most recent first', () => {
    expect(backdatableDays('2026-01-15', 2)).toEqual(['2026-01-15', '2026-01-14', '2026-01-13'])
  })

  it('offers only today when the window is zero', () => {
    expect(backdatableDays('2026-01-15', 0)).toEqual(['2026-01-15'])
  })

  it('accepts today and the two days before it', () => {
    expect(isWithinBackdateWindow('2026-01-15', '2026-01-15', 2)).toBe(true)
    expect(isWithinBackdateWindow('2026-01-14', '2026-01-15', 2)).toBe(true)
    expect(isWithinBackdateWindow('2026-01-13', '2026-01-15', 2)).toBe(true)
  })

  it('rejects days outside the window', () => {
    expect(isWithinBackdateWindow('2026-01-12', '2026-01-15', 2)).toBe(false)
  })

  it('rejects the future', () => {
    expect(isWithinBackdateWindow('2026-01-16', '2026-01-15', 2)).toBe(false)
  })
})
