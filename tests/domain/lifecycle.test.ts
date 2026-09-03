/**
 * The three lifecycle rulings that closed phase 2, tested at the level they are
 * decided: pure functions over habit data, with the day passed in.
 *
 * 1. A skip preserves a streak without extending it, and costs no token.
 * 2. Archiving is a pause — the streak resumes when the habit comes back.
 * 3. A cadence change applies from the day after it is made; history is judged
 *    by the cadence that was actually in force.
 *
 * Each ruling is paired with a backward-compatibility test, because the fields
 * that carry them (`archivedPeriods`, `scheduleHistory`) are optional and every
 * habit created before this change has neither.
 */

import { describe, expect, it } from 'vitest'
import { isHabitDueOn, scheduleFor, wasArchivedOn, weeklyTargetOn } from '@/domain/schedule'
import { computeStreak } from '@/domain/streak'
import { planRollover } from '@/domain/freeze'
import { NO_RULES_VERSION } from '@/domain/logs'
import type { DayKey, Habit, HabitLog, LogOutcome, Schedule } from '@/domain/types'

// 2026-08-31 is a Monday; 2026-09-02 a Wednesday; 2026-09-03 a Thursday.
const MON = '2026-08-31'
const TUE = '2026-09-01'
const WED = '2026-09-02'
const THU = '2026-09-03'
const FRI = '2026-09-04'

const MON_WED_FRI: Schedule = { kind: 'specificDays', days: [1, 3, 5] }

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Test habit',
  category: '',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: 'The small version',
  status: 'active',
  startDayKey: MON,
  sortOrder: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const log = (dayKey: DayKey, outcome: LogOutcome = 'complete'): HabitLog => ({
  id: `log-${dayKey}-${outcome}`,
  habitId: 'h1',
  dayKey,
  outcome,
  loggedAt: 0,
  tz: 'UTC',
  isBackdated: false,
  wasFocus: false,
  xpAwarded: 0,
  rulesVersion: NO_RULES_VERSION,
})

const streak = (logs: HabitLog[], today: DayKey, overrides: Partial<Habit> = {}) =>
  computeStreak({
    habit: habit(overrides),
    logs,
    frozenDays: new Set<DayKey>(),
    today,
    weekStartsOn: 1,
  })

// ---------------------------------------------------------------------------
// Ruling 2 — archiving is a pause
// ---------------------------------------------------------------------------

describe('archive then reactivate', () => {
  // Archived Tuesday-through-Wednesday, live again on Thursday.
  const paused = { archivedPeriods: [{ from: TUE, to: THU }], status: 'active' as const }

  it('treats days inside an archived stretch as not due', () => {
    expect(wasArchivedOn(habit(paused), TUE)).toBe(true)
    expect(wasArchivedOn(habit(paused), WED)).toBe(true)
    // `to` is exclusive: the day of reactivation is live again.
    expect(wasArchivedOn(habit(paused), THU)).toBe(false)

    expect(isHabitDueOn(habit(paused), TUE)).toBe(false)
    expect(isHabitDueOn(habit(paused), THU)).toBe(true)
  })

  it('resumes the streak instead of restarting it', () => {
    // Monday earned, then paused, then Thursday earned. The pause is stepped
    // over exactly like an unscheduled weekday, so the streak continues.
    const result = streak([log(MON), log(THU)], THU, paused)
    expect(result.current).toBe(2)
  })

  it('does not count the pause as misses even with a long gap', () => {
    const longPause = { archivedPeriods: [{ from: TUE, to: '2026-12-01' }] }
    const result = streak([log(MON), log('2026-12-01')], '2026-12-01', longPause)
    expect(result.current).toBe(2)
  })

  it('spends no freeze tokens on archived days', () => {
    // The important half of the ruling: pausing must be free. If a pause
    // drained the pool the user would be punished for tidying up.
    const result = planRollover({
      habits: [habit(paused)],
      logsByHabit: new Map([['h1', [log(MON)]]]),
      frozenByHabit: new Map(),
      fromDay: TUE,
      toDay: WED,
      tokensAvailable: 2,
      weekStartsOn: 1,
    })
    expect(result.spends).toEqual([])
    expect(result.broken).toEqual([])
    expect(result.tokensRemaining).toBe(2)
  })

  it('treats an open range as archived from its start onward', () => {
    const stillPaused = {
      status: 'archived' as const,
      archivedPeriods: [{ from: WED, to: null }],
    }
    expect(wasArchivedOn(habit(stillPaused), TUE)).toBe(false)
    expect(wasArchivedOn(habit(stillPaused), WED)).toBe(true)
    expect(wasArchivedOn(habit(stillPaused), '2027-01-01')).toBe(true)
  })

  it('falls back to the status flag for habits with no recorded ranges', () => {
    // Backward compatibility. A habit archived before ranges existed knows only
    // that it is archived *now*, which is exactly the old behaviour.
    expect(wasArchivedOn(habit({ status: 'archived' }), WED)).toBe(true)
    expect(wasArchivedOn(habit({ status: 'active' }), WED)).toBe(false)
    expect(isHabitDueOn(habit(), WED)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Ruling 3 — a cadence change is not retroactive
// ---------------------------------------------------------------------------

describe('cadence change with history', () => {
  // Mon/Wed/Fri until Thursday, daily from Thursday on.
  const switched = {
    schedule: { kind: 'daily' } as Schedule,
    scheduleHistory: [
      { from: MON, schedule: MON_WED_FRI },
      { from: THU, schedule: { kind: 'daily' } as Schedule },
    ],
  }

  it('judges each day by the cadence in force that day', () => {
    expect(scheduleFor(habit(switched), TUE)).toEqual(MON_WED_FRI)
    expect(scheduleFor(habit(switched), THU)).toEqual({ kind: 'daily' })
  })

  it('does not retroactively turn old unscheduled days into misses', () => {
    // Without history, switching to daily would make every past Tuesday and
    // Thursday a miss and destroy a legitimately earned streak — a silent
    // break, which the product rules forbid outright.
    expect(isHabitDueOn(habit(switched), TUE)).toBe(false)
    expect(isHabitDueOn(habit(switched), WED)).toBe(true)

    const withHistory = streak([log(MON), log(WED), log(THU)], THU, switched)
    expect(withHistory.current).toBe(3)

    // The same logs judged by today's cadence alone: Tuesday becomes a miss and
    // the streak collapses. This is the behaviour the ruling removes.
    const withoutHistory = streak([log(MON), log(WED), log(THU)], THU, {
      schedule: { kind: 'daily' },
    })
    expect(withoutHistory.current).toBe(2)
  })

  it('governs days before the first entry by the oldest cadence known', () => {
    const late = {
      schedule: { kind: 'daily' } as Schedule,
      scheduleHistory: [{ from: FRI, schedule: { kind: 'daily' } as Schedule }],
    }
    expect(scheduleFor(habit(late), MON)).toEqual({ kind: 'daily' })
  })

  it('reports the weekly quota in force on a given day', () => {
    const quota = {
      schedule: { kind: 'timesPerWeek', target: 5 } as Schedule,
      scheduleHistory: [
        { from: MON, schedule: { kind: 'timesPerWeek', target: 3 } as Schedule },
        { from: THU, schedule: { kind: 'timesPerWeek', target: 5 } as Schedule },
      ],
    }
    expect(weeklyTargetOn(habit(quota), TUE)).toBe(3)
    expect(weeklyTargetOn(habit(quota), THU)).toBe(5)
  })

  it('applies the current cadence everywhere when no history exists', () => {
    // Backward compatibility: every habit created before this change.
    const plain = habit({ schedule: MON_WED_FRI })
    expect(scheduleFor(plain, TUE)).toEqual(MON_WED_FRI)
    expect(scheduleFor(plain, '2027-06-01')).toEqual(MON_WED_FRI)
    expect(weeklyTargetOn(plain, TUE)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// The rulings composed
// ---------------------------------------------------------------------------

describe('rulings in combination', () => {
  it('survives a skip inside an archived-then-resumed history', () => {
    // Monday done, Tuesday skipped, Wednesday paused, Thursday done.
    // Nothing here should cost the user anything.
    const combined = {
      archivedPeriods: [{ from: WED, to: THU }],
    }
    const result = streak([log(MON), log(TUE, 'skip'), log(THU)], THU, combined)
    expect(result.current).toBe(2)
    expect(result.frozenInStreak).toEqual([])
  })

  it('leaves a habit with none of the new fields behaving exactly as before', () => {
    // The single most important backward-compatibility case: a habit written by
    // the previous version, read by this one.
    const legacy = habit({ schedule: MON_WED_FRI })
    expect('archivedPeriods' in legacy).toBe(false)
    expect('scheduleHistory' in legacy).toBe(false)

    const result = streak([log(MON), log(WED), log(FRI)], FRI, { schedule: MON_WED_FRI })
    expect(result.current).toBe(3)
    expect(result.longest).toBe(3)
  })
})
