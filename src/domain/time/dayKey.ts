/**
 * DayKey: the app's unit of "a day".
 *
 * ## Why this exists
 *
 * Two things make naive date handling wrong here:
 *
 *  1. A day should not end at midnight. Logging a habit at 01:30 is finishing
 *     the day you just lived, not starting a new one. So a day runs from
 *     `dayStartHour` (default 04:00) to the same hour the next morning.
 *  2. Daylight-saving transitions make instant arithmetic lie. Subtracting
 *     "4 hours" from an instant is not the same as asking "is it before 04:00
 *     where you are", and on a transition day the two answers differ.
 *
 * ## The rule
 *
 * Conversion between instants and DayKeys happens in exactly one place — here.
 * `toDayKey` reads the *wall clock* in the user's zone and compares the hour;
 * it never does arithmetic on instants. Once a value is a DayKey, all further
 * arithmetic is civil-date math (`addDays`, `diffDays`), which is DST-immune by
 * construction because it never involves hours at all.
 *
 * Internally, civil math uses `Date.UTC` purely as a calendar calculator. UTC
 * has no DST and every UTC day is exactly 86,400,000 ms, so it is safe for this
 * and only this.
 */

import type { DayContext, DayKey, Instant, TimeZone, Weekday } from '@/domain/types'

const MS_PER_DAY = 86_400_000

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** `Intl.DateTimeFormat` construction is expensive; these are hot paths. */
const formatterCache = new Map<TimeZone, Intl.DateTimeFormat>()

function getFormatter(timeZone: TimeZone): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      // h23 rather than `hour12: false`, which renders midnight as "24" under
      // some ICU builds.
      hourCycle: 'h23',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

export interface CivilDate {
  year: number
  month: number // 1-12
  day: number // 1-31
}

export interface WallClock extends CivilDate {
  hour: number // 0-23
  minute: number
  second: number
}

/** Reads the wall-clock time in `timeZone` at `instant`. */
export function wallClockAt(instant: Instant, timeZone: TimeZone): WallClock {
  const parts = getFormatter(timeZone).formatToParts(new Date(instant))
  const lookup: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const part of parts) lookup[part.type] = part.value

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function formatDayKey(date: CivilDate): DayKey {
  return `${String(date.year).padStart(4, '0')}-${pad2(date.month)}-${pad2(date.day)}`
}

export function parseDayKey(dayKey: DayKey): CivilDate {
  if (!isDayKey(dayKey)) {
    throw new Error(`Invalid DayKey: ${JSON.stringify(dayKey)} (expected YYYY-MM-DD)`)
  }
  return {
    year: Number(dayKey.slice(0, 4)),
    month: Number(dayKey.slice(5, 7)),
    day: Number(dayKey.slice(8, 10)),
  }
}

export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== 'string' || !DAY_KEY_PATTERN.test(value)) return false
  // Reject impossible dates like 2026-02-30, which would otherwise round-trip
  // silently into March via Date.UTC normalisation.
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const utc = Date.UTC(year, month - 1, day)
  const round = new Date(utc)
  return (
    round.getUTCFullYear() === year &&
    round.getUTCMonth() === month - 1 &&
    round.getUTCDate() === day
  )
}

/** Civil date -> the UTC instant of that date's midnight. A calendar helper only. */
function toUtcDays(dayKey: DayKey): number {
  const { year, month, day } = parseDayKey(dayKey)
  return Date.UTC(year, month - 1, day)
}

function fromUtcDays(utc: number): DayKey {
  const d = new Date(utc)
  return formatDayKey({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  })
}

// ---------------------------------------------------------------------------
// The one conversion that matters
// ---------------------------------------------------------------------------

/**
 * Which day does `instant` belong to?
 *
 * Reads the wall clock in the user's zone and, if it is before `dayStartHour`,
 * attributes the instant to the previous civil day.
 *
 * Deliberately does *not* shift the instant by `dayStartHour` before formatting:
 * on a DST transition day a fixed-hour shift crosses a different number of
 * wall-clock hours and lands on the wrong date.
 */
export function toDayKey(instant: Instant, ctx: DayContext): DayKey {
  const wall = wallClockAt(instant, ctx.timeZone)
  const civil = formatDayKey(wall)
  return wall.hour < ctx.dayStartHour ? addDays(civil, -1) : civil
}

// ---------------------------------------------------------------------------
// Civil-date arithmetic (DST-immune: no hours involved)
// ---------------------------------------------------------------------------

export function addDays(dayKey: DayKey, days: number): DayKey {
  return fromUtcDays(toUtcDays(dayKey) + days * MS_PER_DAY)
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function diffDays(from: DayKey, to: DayKey): number {
  return (toUtcDays(to) - toUtcDays(from)) / MS_PER_DAY
}

export function compareDayKeys(a: DayKey, b: DayKey): number {
  // Zero-padded ISO dates sort correctly as plain strings.
  return a < b ? -1 : a > b ? 1 : 0
}

export function minDayKey(a: DayKey, b: DayKey): DayKey {
  return compareDayKeys(a, b) <= 0 ? a : b
}

export function maxDayKey(a: DayKey, b: DayKey): DayKey {
  return compareDayKeys(a, b) >= 0 ? a : b
}

export function weekdayOf(dayKey: DayKey): Weekday {
  return new Date(toUtcDays(dayKey)).getUTCDay() as Weekday
}

/** Inclusive list of days from `from` to `to`. Empty when `to` precedes `from`. */
export function dayKeyRange(from: DayKey, to: DayKey): DayKey[] {
  const span = diffDays(from, to)
  if (span < 0) return []
  const out: DayKey[] = []
  for (let i = 0; i <= span; i++) out.push(addDays(from, i))
  return out
}

// ---------------------------------------------------------------------------
// DayKey -> instant (the harder direction; needed for "time left today")
// ---------------------------------------------------------------------------

/** Offset of `timeZone` from UTC at `instant`, in ms (positive east of UTC). */
function offsetMsAt(instant: Instant, timeZone: TimeZone): number {
  const wall = wallClockAt(instant, timeZone)
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  )
  // Round to the second: `instant` may carry milliseconds the formatter dropped.
  return asUtc - Math.floor(instant / 1000) * 1000
}

/**
 * The instant at which a given wall-clock time occurs in `timeZone`.
 *
 * Guess-and-correct: assume UTC, measure the offset there, re-measure at the
 * corrected instant in case the first guess landed on the far side of a DST
 * transition. For a skipped local hour this yields the instant the clock jumps
 * to, which is the behaviour we want for a day boundary.
 */
function wallClockToInstant(wall: WallClock, timeZone: TimeZone): Instant {
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  )
  const firstGuess = asUtc - offsetMsAt(asUtc, timeZone)
  const secondOffset = offsetMsAt(firstGuess, timeZone)
  return asUtc - secondOffset
}

/** The instant at which `dayKey` begins (i.e. `dayStartHour` local). */
export function dayStartInstant(dayKey: DayKey, ctx: DayContext): Instant {
  const { year, month, day } = parseDayKey(dayKey)
  return wallClockToInstant(
    { year, month, day, hour: ctx.dayStartHour, minute: 0, second: 0 },
    ctx.timeZone,
  )
}

/** The instant at which `dayKey` ends — that is, when the next day begins. */
export function dayEndInstant(dayKey: DayKey, ctx: DayContext): Instant {
  return dayStartInstant(addDays(dayKey, 1), ctx)
}

// ---------------------------------------------------------------------------
// Backdating
// ---------------------------------------------------------------------------

/**
 * Days that may currently be logged: today, plus `windowDays` before it.
 * Ordered most recent first, which is the order the UI offers them in.
 */
export function backdatableDays(today: DayKey, windowDays: number): DayKey[] {
  const out: DayKey[] = []
  for (let i = 0; i <= Math.max(0, windowDays); i++) out.push(addDays(today, -i))
  return out
}

export function isWithinBackdateWindow(
  target: DayKey,
  today: DayKey,
  windowDays: number,
): boolean {
  const delta = diffDays(target, today)
  return delta >= 0 && delta <= windowDays
}
