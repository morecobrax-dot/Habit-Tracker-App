import { describe, expect, it } from 'vitest'
import { DEFAULT_FOCUS_RULES, benchedHabitIds, neglectScore, pickDailyFocus } from '@/domain/focus'
import type { DailyFocus, DayKey, Habit, HabitLog, LogOutcome, Schedule } from '@/domain/types'

const RULES = DEFAULT_FOCUS_RULES
const TODAY: DayKey = '2026-09-15' // a Tuesday

const habit = (id: string, overrides: Partial<Habit> = {}): Habit => ({
  id,
  name: id,
  category: '',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: 'small',
  status: 'active',
  startDayKey: '2026-09-01',
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
  rulesVersion: 'v1',
})

const focusRow = (dayKey: DayKey, habitId: string): DailyFocus => ({
  dayKey,
  habitId,
  chosenAt: 0,
  neglectScoreAtChoice: 0,
  resolved: 'pending',
})

const pick = (
  habits: Habit[],
  logs: HabitLog[],
  recentFocus: DailyFocus[] = [],
  today: DayKey = TODAY,
) => {
  const logsByHabit = new Map<string, HabitLog[]>()
  for (const l of logs) {
    const list = logsByHabit.get(l.habitId) ?? []
    list.push(l)
    logsByHabit.set(l.habitId, list)
  }
  return pickDailyFocus({ habits, logsByHabit, recentFocus, today, weekStartsOn: 1 }, RULES)
}

describe('neglectScore', () => {
  it('grows with days since the last completion', () => {
    const recent = neglectScore(habit('a'), [log('a', '2026-09-14')], TODAY, RULES)
    const stale = neglectScore(habit('a'), [log('a', '2026-09-05')], TODAY, RULES)
    expect(stale.score).toBeGreaterThan(recent.score)
    expect(recent.daysSinceLastCompletion).toBe(1)
    expect(stale.daysSinceLastCompletion).toBe(10)
  })

  it('caps neglect so an ancient habit cannot dominate forever', () => {
    const old = neglectScore(
      habit('a', { startDayKey: '2020-01-01' }),
      [log('a', '2020-01-01')],
      TODAY,
      RULES,
    )
    const alsoOld = neglectScore(
      habit('a', { startDayKey: '2010-01-01' }),
      [log('a', '2010-01-01')],
      TODAY,
      RULES,
    )
    expect(old.score).toBe(alsoOld.score)
  })

  it('treats a never-completed habit as neglected since creation', () => {
    const result = neglectScore(habit('a', { startDayKey: '2026-09-10' }), [], TODAY, RULES)
    expect(result.daysSinceLastCompletion).toBeNull()
    expect(result.score).toBeGreaterThan(0)
  })

  it('counts consecutive missed scheduled days', () => {
    // Completed the 10th, nothing since. The 11th-14th are misses; today is
    // excluded because it is still open.
    const result = neglectScore(habit('a'), [log('a', '2026-09-10')], TODAY, RULES)
    expect(result.consecutiveMisses).toBe(4)
  })

  it('does not count today as a miss', () => {
    // Otherwise every habit would look neglected every single morning.
    const result = neglectScore(habit('a'), [log('a', '2026-09-14')], TODAY, RULES)
    expect(result.consecutiveMisses).toBe(0)
  })

  it('counts a partial as a completion', () => {
    const result = neglectScore(habit('a'), [log('a', '2026-09-14', 'partial')], TODAY, RULES)
    expect(result.daysSinceLastCompletion).toBe(1)
    expect(result.consecutiveMisses).toBe(0)
  })

  it('does not count a skip as a completion', () => {
    // Completed the 13th, skipped the 14th: the skip is the sole miss.
    const result = neglectScore(
      habit('a'),
      [log('a', '2026-09-13'), log('a', '2026-09-14', 'skip')],
      TODAY,
      RULES,
    )
    expect(result.consecutiveMisses).toBe(1)
  })

  it('bounds the miss count so an ancient habit cannot dominate forever', () => {
    // Without this bound the score grows without limit, and a long-ignored
    // habit becomes the focus every single day — the exact daily accusation the
    // cooldown exists to prevent.
    const ancient = neglectScore(
      habit('a', { startDayKey: '2020-01-01' }),
      [],
      TODAY,
      RULES,
    )
    expect(ancient.consecutiveMisses).toBeLessThanOrEqual(RULES.maxNeglectDays)
    expect(ancient.score).toBeLessThanOrEqual(
      RULES.maxNeglectDays + RULES.missWeight * RULES.maxNeglectDays + 4,
    )
  })

  it('only counts scheduled days as misses', () => {
    // A Mon/Wed/Fri habit completed last Friday has missed only Monday.
    const monWedFri: Schedule = { kind: 'specificDays', days: [1, 3, 5] }
    const result = neglectScore(
      habit('a', { schedule: monWedFri }),
      [log('a', '2026-09-11')],
      TODAY,
      RULES,
    )
    expect(result.consecutiveMisses).toBe(1)
  })

  it('breaks ties toward the harder habit', () => {
    const easy = neglectScore(habit('a', { difficulty: 1 }), [], TODAY, RULES)
    const hard = neglectScore(habit('a', { difficulty: 4 }), [], TODAY, RULES)
    expect(hard.score).toBeGreaterThan(easy.score)
  })
})

describe('pickDailyFocus', () => {
  it('returns null when nothing is due', () => {
    // A Mon/Wed/Fri habit on a Tuesday.
    expect(
      pick([habit('a', { schedule: { kind: 'specificDays', days: [1, 3, 5] } })], []),
    ).toBeNull()
  })

  it('returns null with no habits', () => {
    expect(pick([], [])).toBeNull()
  })

  it('surfaces the most avoided habit', () => {
    const chosen = pick(
      [habit('fresh'), habit('avoided')],
      [log('fresh', '2026-09-14'), log('avoided', '2026-09-02')],
    )
    expect(chosen?.habit.id).toBe('avoided')
  })

  it('ignores archived habits', () => {
    const chosen = pick(
      [habit('archived', { status: 'archived' }), habit('active')],
      [log('active', '2026-09-14')],
    )
    expect(chosen?.habit.id).toBe('active')
  })

  it('ignores habits not scheduled today', () => {
    const chosen = pick(
      [
        habit('weekend', { schedule: { kind: 'specificDays', days: [0, 6] } }),
        habit('daily'),
      ],
      [log('daily', '2026-09-14')],
    )
    expect(chosen?.habit.id).toBe('daily')
  })

  it('is deterministic when scores tie', () => {
    const run = () => pick([habit('bbb'), habit('aaa')], [])?.habit.id
    expect(run()).toBe('aaa')
    expect(run()).toBe(run())
  })
})

describe('anti-nag cooldown', () => {
  // The failure this exists to prevent: the same dreaded habit surfacing every
  // single day with a climbing counter, which turns the app into a daily
  // accusation and therefore an avoidance engine.

  it('benches a habit after two consecutive days as focus', () => {
    const benched = benchedHabitIds(
      [focusRow('2026-09-14', 'a'), focusRow('2026-09-13', 'a')],
      TODAY,
      RULES,
    )
    expect(benched.has('a')).toBe(true)
  })

  it('does not bench after a single day', () => {
    const benched = benchedHabitIds([focusRow('2026-09-14', 'a')], TODAY, RULES)
    expect(benched.has('a')).toBe(false)
  })

  it('lets a different habit take over while one is benched', () => {
    const chosen = pick(
      [habit('avoided'), habit('other')],
      [log('other', '2026-09-14')],
      [focusRow('2026-09-14', 'avoided'), focusRow('2026-09-13', 'avoided')],
    )
    // "avoided" scores higher but has held focus two days running.
    expect(chosen?.habit.id).toBe('other')
  })

  it('releases the bench after the cooldown passes', () => {
    const benched = benchedHabitIds(
      [
        focusRow('2026-09-11', 'a'),
        focusRow('2026-09-10', 'a'),
        focusRow('2026-09-14', 'b'),
        focusRow('2026-09-13', 'b'),
      ],
      TODAY,
      RULES,
    )
    // "a" finished its run three days ago; "b" finished yesterday.
    expect(benched.has('a')).toBe(false)
    expect(benched.has('b')).toBe(true)
  })

  it('falls back to a benched habit rather than offering no focus at all', () => {
    // With only one habit, an absolute cooldown would mean no focus for days.
    // A repeat is a better outcome than the mechanic silently disappearing.
    const chosen = pick(
      [habit('only')],
      [],
      [focusRow('2026-09-14', 'only'), focusRow('2026-09-13', 'only')],
    )
    expect(chosen?.habit.id).toBe('only')
    expect(chosen?.benched).toBe(true)
  })

  it('is not confused by a non-consecutive history', () => {
    const benched = benchedHabitIds(
      [focusRow('2026-09-14', 'a'), focusRow('2026-09-13', 'b'), focusRow('2026-09-12', 'a')],
      TODAY,
      RULES,
    )
    // "a" held focus on two days, but not consecutively.
    expect(benched.has('a')).toBe(false)
  })

  it('handles an empty history', () => {
    expect(benchedHabitIds([], TODAY, RULES).size).toBe(0)
  })
})

describe('focus across month and year boundaries', () => {
  it('reads the cooldown correctly across a month boundary', () => {
    const benched = benchedHabitIds(
      [focusRow('2026-08-31', 'a'), focusRow('2026-08-30', 'a')],
      '2026-09-01',
      RULES,
    )
    expect(benched.has('a')).toBe(true)
  })

  it('reads the cooldown correctly across a year boundary', () => {
    const benched = benchedHabitIds(
      [focusRow('2025-12-31', 'a'), focusRow('2025-12-30', 'a')],
      '2026-01-01',
      RULES,
    )
    expect(benched.has('a')).toBe(true)
  })

  it('scores neglect correctly across a year boundary', () => {
    const result = neglectScore(
      habit('a', { startDayKey: '2025-12-01' }),
      [log('a', '2025-12-28')],
      '2026-01-04',
      RULES,
    )
    expect(result.daysSinceLastCompletion).toBe(7)
  })
})
