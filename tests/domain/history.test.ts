import { describe, expect, it } from 'vitest'
import { bestStreak, dayFullness, heatLevel, rollupDays } from '@/domain/history'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import { NO_RULES_VERSION } from '@/domain/logs'
import type { DayKey, Habit, HabitLog, LogOutcome, Schedule } from '@/domain/types'

const FACTORS = DEFAULT_XP_RULES.completionFactors

// 2026-08-31 is a Monday.
const MON = '2026-08-31'
const TUE = '2026-09-01'
const WED = '2026-09-02'
const THU = '2026-09-03'

const habit = (id: string, overrides: Partial<Habit> = {}): Habit => ({
  id,
  name: id,
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

const log = (habitId: string, dayKey: DayKey, outcome: LogOutcome = 'complete'): HabitLog => ({
  id: `${habitId}-${dayKey}`,
  habitId,
  dayKey,
  outcome,
  loggedAt: 0,
  tz: 'UTC',
  isBackdated: false,
  wasFocus: false,
  xpAwarded: 0,
  rulesVersion: NO_RULES_VERSION,
})

const rollup = (
  habits: Habit[],
  logs: HabitLog[],
  from: DayKey,
  to: DayKey,
  today: DayKey = to,
) => rollupDays(habits, logs, from, to, today, FACTORS)

describe('rollupDays', () => {
  it('counts what was due and what was done, per day', () => {
    const days = rollup(
      [habit('a'), habit('b')],
      [log('a', MON), log('b', MON), log('a', TUE, 'partial')],
      MON,
      TUE,
    )

    expect(days[0]).toMatchObject({ dayKey: MON, due: 2, completed: 2, credit: 2 })
    expect(days[1]).toMatchObject({ dayKey: TUE, due: 2, completed: 0, partial: 1 })
    expect(days[1]?.credit).toBeCloseTo(0.6)
  })

  it('weights a partial by the ruleset rather than a second opinion', () => {
    // The heatmap must not invent its own view of what a partial is worth.
    const days = rollup([habit('a')], [log('a', MON, 'partial')], MON, MON)
    expect(days[0]?.credit).toBeCloseTo(FACTORS.partial)
  })

  it('gives a skip no credit but records it', () => {
    const days = rollup([habit('a')], [log('a', MON, 'skip')], MON, MON)
    expect(days[0]).toMatchObject({ due: 1, skipped: 1, credit: 0 })
  })

  it('reports zero due on days a habit was not scheduled', () => {
    // Mon/Wed/Fri habit: Tuesday asked nothing at all.
    const monWedFri: Schedule = { kind: 'specificDays', days: [1, 3, 5] }
    const days = rollup([habit('a', { schedule: monWedFri })], [], MON, WED)
    expect(days.map((d) => d.due)).toEqual([1, 0, 1])
  })

  it('reports zero due before the habit existed', () => {
    const days = rollup([habit('a', { startDayKey: WED })], [], MON, WED)
    expect(days.map((d) => d.due)).toEqual([0, 0, 1])
  })

  it('excludes days inside an archived stretch', () => {
    const paused = habit('a', { archivedPeriods: [{ from: TUE, to: THU }] })
    const days = rollup([paused], [], MON, THU)
    expect(days.map((d) => d.due)).toEqual([1, 0, 0, 1])
  })

  it('marks days after the anchor as future', () => {
    // A day that has not happened yet is not a miss, and the chart must be able
    // to tell the difference.
    const days = rollup([habit('a')], [], MON, THU, TUE)
    expect(days.map((d) => d.future)).toEqual([false, false, true, true])
  })
})

describe('dayFullness', () => {
  it('is the fraction of the day that was completed', () => {
    const [monday] = rollup([habit('a'), habit('b')], [log('a', MON)], MON, MON)
    expect(dayFullness(monday!)).toBeCloseTo(0.5)
  })

  it('treats a day that asked nothing as empty, not perfect', () => {
    // Returning 1 here would light the whole grid up before the habit existed.
    const [monday] = rollup([habit('a', { startDayKey: THU })], [], MON, MON)
    expect(dayFullness(monday!)).toBe(0)
  })

  it('never exceeds 1', () => {
    const [monday] = rollup([habit('a')], [log('a', MON)], MON, MON)
    expect(dayFullness(monday!)).toBe(1)
  })
})

describe('heatLevel', () => {
  const levelFor = (habits: Habit[], logs: HabitLog[]) =>
    heatLevel(rollup(habits, logs, MON, MON)[0]!)

  it('is 0 for a day with nothing due', () => {
    expect(levelFor([habit('a', { startDayKey: THU })], [])).toBe(0)
  })

  it('is 0 for a day with nothing done', () => {
    expect(levelFor([habit('a')], [])).toBe(0)
  })

  it('is 0 when the only log was a skip', () => {
    // Honest: a skip protects the streak but nothing was done, and the history
    // should not claim otherwise.
    expect(levelFor([habit('a')], [log('a', MON, 'skip')])).toBe(0)
  })

  it('is the top step for a fully completed day', () => {
    expect(levelFor([habit('a'), habit('b')], [log('a', MON), log('b', MON)])).toBe(4)
  })

  it('puts a lone partial mid-ramp', () => {
    // The visual form of "partial completion earns partial credit": visible
    // progress, not a full day, and definitely not nothing.
    expect(levelFor([habit('a')], [log('a', MON, 'partial')])).toBe(2)
  })

  it('judges by fraction, so one habit and five habits are comparable', () => {
    const one = levelFor([habit('a')], [log('a', MON)])
    const five = levelFor(
      ['a', 'b', 'c', 'd', 'e'].map((id) => habit(id)),
      ['a', 'b', 'c', 'd', 'e'].map((id) => log(id, MON)),
    )
    expect(one).toBe(five)
    expect(one).toBe(4)
  })

  it('climbs with the fraction completed', () => {
    const habits = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => habit(id))
    const done = (n: number) => habits.slice(0, n).map((h) => log(h.id, MON))
    expect(levelFor(habits, done(1))).toBe(1)
    expect(levelFor(habits, done(3))).toBe(2)
    expect(levelFor(habits, done(5))).toBe(3)
    expect(levelFor(habits, done(6))).toBe(4)
  })
})

describe('bestStreak', () => {
  const entry = (name: string, current: number) => ({
    habit: habit(name, { name }),
    streak: { current },
  })

  it('picks the longest running streak', () => {
    const best = bestStreak([entry('a', 3), entry('b', 11), entry('c', 7)])
    expect(best?.habit.name).toBe('b')
  })

  it('breaks ties by name so the hero does not flicker between equals', () => {
    const best = bestStreak([entry('zebra', 5), entry('apple', 5)])
    expect(best?.habit.name).toBe('apple')
  })

  it('returns null when nothing is lit', () => {
    expect(bestStreak([entry('a', 0), entry('b', 0)])).toBeNull()
    expect(bestStreak([])).toBeNull()
  })
})
