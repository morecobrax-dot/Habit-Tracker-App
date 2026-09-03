import { describe, expect, it } from 'vitest'
import { describeDormantStreak, summariseToday, type TodayEntry } from '@/domain/momentum'
import type { Habit } from '@/domain/types'

const habit = (name: string): Habit => ({
  id: name,
  name,
  category: '',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: 'The small version',
  status: 'active',
  startDayKey: '2026-08-01',
  sortOrder: 1,
  createdAt: 0,
  updatedAt: 0,
})

const entry = (
  name: string,
  overrides: Partial<Omit<TodayEntry, 'habit'>> = {},
): TodayEntry => ({
  habit: habit(name),
  done: false,
  resolved: false,
  streak: 0,
  unit: 'day',
  ...overrides,
})

const summarise = (entries: TodayEntry[], freezeTokens = 0) =>
  summariseToday({ entries, freezeTokens })

describe('today counts', () => {
  it('counts what is due and what is done', () => {
    const s = summarise([
      entry('a', { done: true }),
      entry('b', { done: true }),
      entry('c'),
    ])
    expect(s).toMatchObject({ due: 3, done: 2, remaining: 1, allDone: false, restDay: false })
  })

  it('reports a day with nothing scheduled as a rest day, not a failure', () => {
    const s = summarise([])
    expect(s.restDay).toBe(true)
    // Deliberately false: "all done" on a day that asked nothing would be a
    // hollow congratulation, and the UI needs to tell the two apart.
    expect(s.allDone).toBe(false)
    expect(s.atRisk).toEqual([])
  })

  it('reports a fully logged day as done', () => {
    const s = summarise([entry('a', { done: true }), entry('b', { done: true })])
    expect(s.allDone).toBe(true)
    expect(s.remaining).toBe(0)
  })
})

describe('at risk is narrow on purpose', () => {
  it('lists only habits with a live streak to lose', () => {
    const s = summarise([
      entry('has-streak', { streak: 9 }),
      entry('no-streak', { streak: 0 }),
      entry('already-done', { streak: 20, done: true }),
    ])
    expect(s.atRisk.map((r) => r.habit.name)).toEqual(['has-streak'])
  })

  it('says nothing at all on a day where nothing has been built', () => {
    // The anti-nag rule. A brand-new user with three unlogged habits must not
    // be shown a list of things they are failing at.
    const s = summarise([entry('a'), entry('b'), entry('c')])
    expect(s.atRisk).toEqual([])
  })

  it('puts the most at stake first', () => {
    const s = summarise([
      entry('small', { streak: 2 }),
      entry('huge', { streak: 40 }),
      entry('medium', { streak: 11 }),
    ])
    expect(s.atRisk.map((r) => r.habit.name)).toEqual(['huge', 'medium', 'small'])
  })

  it('breaks ties by name so the list does not reshuffle on re-render', () => {
    const s = summarise([entry('zebra', { streak: 5 }), entry('apple', { streak: 5 })])
    expect(s.atRisk.map((r) => r.habit.name)).toEqual(['apple', 'zebra'])
  })

  it('drops a habit from the list the moment it is logged', () => {
    const before = summarise([entry('a', { streak: 7 })])
    const after = summarise([entry('a', { streak: 7, done: true })])
    expect(before.atRisk).toHaveLength(1)
    expect(after.atRisk).toHaveLength(0)
  })

  it('counts a skip as unresolved risk unless it was credited', () => {
    // A skip protects the streak at rollover, but it is not a completion, and
    // the summary should not claim the day is done.
    const s = summarise([entry('a', { streak: 4, resolved: true, done: false })])
    expect(s.done).toBe(0)
    expect(s.atRisk).toHaveLength(1)
  })
})

describe('freeze cover is promised only where it can be paid', () => {
  it('marks habits as covered while tokens last, biggest streak first', () => {
    const s = summarise(
      [entry('a', { streak: 30 }), entry('b', { streak: 20 }), entry('c', { streak: 10 })],
      2,
    )
    expect(s.atRisk.map((r) => [r.habit.name, r.coveredByFreeze])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ])
  })

  it('promises nothing with an empty pool', () => {
    const s = summarise([entry('a', { streak: 30 })], 0)
    expect(s.atRisk[0]?.coveredByFreeze).toBe(false)
  })

  it('ignores a negative token count rather than trusting it', () => {
    const s = summarise([entry('a', { streak: 3 })], -5)
    expect(s.atRisk[0]?.coveredByFreeze).toBe(false)
  })
})

describe('best running streak', () => {
  it('is the longest still alive, with the habit named', () => {
    const s = summarise([
      entry('a', { streak: 3 }),
      entry('b', { streak: 12 }),
      entry('c', { streak: 8 }),
    ])
    expect(s.bestStreak).toBe(12)
    expect(s.bestStreakHabit?.name).toBe('b')
  })

  it('is zero with nothing lit, and names nobody', () => {
    // The state after a missed day. It must be representable without the UI
    // having to invent a headline out of it.
    const s = summarise([entry('a'), entry('b')])
    expect(s.bestStreak).toBe(0)
    expect(s.bestStreakHabit).toBeNull()
  })

  it('carries the unit so a weekly habit is not called a day', () => {
    const s = summarise([entry('weekly', { streak: 4, unit: 'week' })])
    expect(s.bestStreakUnit).toBe('week')
  })

  it('breaks ties by name', () => {
    const s = summarise([entry('zebra', { streak: 6 }), entry('apple', { streak: 6 })])
    expect(s.bestStreakHabit?.name).toBe('apple')
  })
})

describe('describeDormantStreak', () => {
  it('does not tell a habit with history that it never started', () => {
    // The bug this replaces: a habit with forty completions rendered "Not
    // started yet" the moment its streak lapsed, which erases the work and is
    // simply false.
    expect(describeDormantStreak(true)).toBe('Streak paused')
  })

  it('still says not started for a habit that genuinely never has been', () => {
    expect(describeDormantStreak(false)).toBe('Not started yet')
  })
})
