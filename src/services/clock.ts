import type { DayContext, DayKey, Instant, Settings } from '@/domain/types'
import { toDayKey } from '@/domain/time/dayKey'
import { resolveTimeZone } from '@/data/repos/settingsRepo'

/**
 * The clock boundary.
 *
 * The domain layer is forbidden from reading the ambient clock (enforced by an
 * ESLint rule on `src/domain/**`). This module is where "now" actually comes
 * from, and it is injectable so tests can drive time deterministically without
 * mocking globals.
 */
export interface Clock {
  now(): Instant
}

export const systemClock: Clock = {
  now: () => Date.now(),
}

/** A frozen clock for tests and for keeping one render internally consistent. */
export function fixedClock(instant: Instant): Clock {
  return { now: () => instant }
}

/**
 * Builds the `DayContext` the pure time functions need from stored settings,
 * resolving `'auto'` to the device's current zone.
 */
export function dayContextFrom(settings: Settings): DayContext {
  return {
    timeZone: resolveTimeZone(settings),
    dayStartHour: settings.dayStartHour,
    weekStartsOn: settings.weekStartsOn,
  }
}

export function todayKey(clock: Clock, ctx: DayContext): DayKey {
  return toDayKey(clock.now(), ctx)
}
