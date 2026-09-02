import { describe, expect, it } from 'vitest'
import { computeFreezeGrant, planRollover } from '@/domain/freeze'
import { NO_RULES_VERSION } from '@/domain/logs'
import type { DayKey, Habit, HabitLog, LogOutcome, Schedule } from '@/domain/types'

const SETTINGS = { freezeTokensPerWeek: 2, maxFreezeTokens: 4, weekStartsOn: 1 as const }

describe('computeFreezeGrant', () => {
  it('grants on the first ever run', () => {
    const grant = computeFreezeGrant(
      { freezeTokens: 0, lastFreezeGrantWeekKey: null },
      '2026-09-02',
      SETTINGS,
    )
    expect(grant).toEqual({ tokensToAdd: 2, weekKey: 'W2026-08-31' })
  })

  it('is idempotent within a week', () => {
    // Opening the app twenty times on a Wednesday must not mint forty tokens.
    const grant = computeFreezeGrant(
      { freezeTokens: 2, lastFreezeGrantWeekKey: 'W2026-08-31' },
      '2026-09-02',
      SETTINGS,
    )
    expect(grant).toBeNull()
  })

  it('grants again in a new week', () => {
    const grant = computeFreezeGrant(
      { freezeTokens: 1, lastFreezeGrantWeekKey: 'W2026-08-31' },
      '2026-09-07',
      SETTINGS,
    )
    expect(grant).toEqual({ tokensToAdd: 2, weekKey: 'W2026-09-07' })
  })

  it('grants for each missed week after an absence', () => {
    // Away three weeks: 3 x 2 = 6, clamped by the cap.
    const grant = computeFreezeGrant(
      { freezeTokens: 0, lastFreezeGrantWeekKey: 'W2026-08-31' },
      '2026-09-21',
      SETTINGS,
    )
    expect(grant?.tokensToAdd).toBe(4)
  })

  it('respects the cap', () => {
    const grant = computeFreezeGrant(
      { freezeTokens: 3, lastFreezeGrantWeekKey: 'W2026-08-31' },
      '2026-09-07',
      SETTINGS,
    )
    expect(grant?.tokensToAdd).toBe(1)
  })

  it('records the week even when the pool is already full', () => {
    // Otherwise a capped user recomputes this on every single app open.
    const grant = computeFreezeGrant(
      { freezeTokens: 4, lastFreezeGrantWeekKey: 'W2026-08-31' },
      '2026-09-07',
      SETTINGS,
    )
    expect(grant).toEqual({ tokensToAdd: 0, weekKey: 'W2026-09-07' })
  })

  it('never grants a negative amount', () => {
    const grant = computeFreezeGrant(
      { freezeTokens: 9, lastFreezeGrantWeekKey: 'W2026-08-31' },
      '2026-09-07',
      SETTINGS,
    )
    expect(grant?.tokensToAdd).toBe(0)
  })
})

// ---------------------------------------------------------------------------

const MON = '2026-08-31'

const habit = (id: string, overrides: Partial<Habit> = {}): Habit => ({
  id,
  name: id,
  category: '',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: 'small',
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

const plan = (opts: {
  habits: Habit[]
  logs: HabitLog[]
  from: DayKey
  to: DayKey
  tokens: number
  frozen?: Record<string, DayKey[]>
}) => {
  const logsByHabit = new Map<string, HabitLog[]>()
  for (const l of opts.logs) {
    const list = logsByHabit.get(l.habitId) ?? []
    list.push(l)
    logsByHabit.set(l.habitId, list)
  }
  const frozenByHabit = new Map<string, Set<DayKey>>()
  for (const [id, days] of Object.entries(opts.frozen ?? {})) {
    frozenByHabit.set(id, new Set(days))
  }
  return planRollover({
    habits: opts.habits,
    logsByHabit,
    frozenByHabit,
    fromDay: opts.from,
    toDay: opts.to,
    tokensAvailable: opts.tokens,
    weekStartsOn: 1,
  })
}

describe('planRollover — spending', () => {
  it('spends a token to cover a missed day', () => {
    // Mon and Tue done, Wed missed. Settling Wednesday should cost one token.
    const result = plan({
      habits: [habit('a')],
      logs: [log('a', '2026-08-31'), log('a', '2026-09-01')],
      from: '2026-09-02',
      to: '2026-09-02',
      tokens: 2,
    })
    expect(result.spends).toEqual([{ habitId: 'a', dayKey: '2026-09-02', streakSaved: 2 }])
    expect(result.tokensRemaining).toBe(1)
    expect(result.broken).toEqual([])
  })

  it('does not spend when the day was completed', () => {
    const result = plan({
      habits: [habit('a')],
      logs: [log('a', '2026-08-31'), log('a', '2026-09-01'), log('a', '2026-09-02')],
      from: '2026-09-02',
      to: '2026-09-02',
      tokens: 2,
    })
    expect(result.spends).toEqual([])
    expect(result.tokensRemaining).toBe(2)
  })

  it('does not spend when a partial was logged', () => {
    const result = plan({
      habits: [habit('a')],
      logs: [log('a', '2026-08-31'), log('a', '2026-09-01', 'partial')],
      from: '2026-09-01',
      to: '2026-09-01',
      tokens: 2,
    })
    expect(result.spends).toEqual([])
  })

  it('does spend when the day was only skipped', () => {
    // Skip is bookkeeping, not protection.
    const result = plan({
      habits: [habit('a')],
      logs: [log('a', '2026-08-31'), log('a', '2026-09-01', 'skip')],
      from: '2026-09-01',
      to: '2026-09-01',
      tokens: 2,
    })
    expect(result.spends).toHaveLength(1)
  })

  it('never spends on a habit with no streak to protect', () => {
    // A zero streak cannot be saved, so the token is worth more kept.
    const result = plan({
      habits: [habit('a')],
      logs: [],
      from: '2026-09-01',
      to: '2026-09-02',
      tokens: 2,
    })
    expect(result.spends).toEqual([])
    expect(result.tokensRemaining).toBe(2)
    expect(result.broken).toEqual([])
  })

  it('reports a broken streak when tokens run out', () => {
    const result = plan({
      habits: [habit('a')],
      logs: [log('a', '2026-08-31'), log('a', '2026-09-01')],
      from: '2026-09-02',
      to: '2026-09-02',
      tokens: 0,
    })
    expect(result.spends).toEqual([])
    expect(result.broken).toEqual([{ habitId: 'a', dayKey: '2026-09-02', streakLost: 2 }])
  })

  it('skips days already covered by an existing freeze', () => {
    // Replaying a settled day must not charge twice.
    const result = plan({
      habits: [habit('a')],
      logs: [log('a', '2026-08-31')],
      from: '2026-09-01',
      to: '2026-09-01',
      tokens: 2,
      frozen: { a: ['2026-09-01'] },
    })
    expect(result.spends).toEqual([])
    expect(result.tokensRemaining).toBe(2)
  })
})

describe('planRollover — scarce tokens', () => {
  it('protects the longest streak first', () => {
    // Both miss Wednesday; only one token. The four-day streak is worth more
    // than the one-day streak, so it wins.
    const result = plan({
      habits: [habit('short'), habit('long')],
      logs: [
        log('short', '2026-09-01'),
        log('long', '2026-08-29'),
        log('long', '2026-08-30'),
        log('long', '2026-08-31'),
        log('long', '2026-09-01'),
      ],
      from: '2026-09-02',
      to: '2026-09-02',
      tokens: 1,
      frozen: {},
    })
    expect(result.spends.map((s) => s.habitId)).toEqual(['long'])
    expect(result.broken.map((b) => b.habitId)).toEqual(['short'])
  })

  it('is deterministic when streaks tie', () => {
    const run = () =>
      plan({
        habits: [habit('bbb'), habit('aaa')],
        logs: [log('aaa', '2026-09-01'), log('bbb', '2026-09-01')],
        from: '2026-09-02',
        to: '2026-09-02',
        tokens: 1,
      })
    expect(run().spends.map((s) => s.habitId)).toEqual(['aaa'])
    expect(run().spends).toEqual(run().spends)
  })
})

describe('planRollover — multi-day catch-up', () => {
  it('replays several closed days in order', () => {
    // Streak of 2 (the habit must start on the 30th for both logs to count),
    // then away Tue-Thu with two tokens: Tue and Wed get covered, Thursday
    // breaks it. A freeze preserves the streak, so the value lost is still 2.
    const result = plan({
      habits: [habit('a', { startDayKey: '2026-08-30' })],
      logs: [log('a', '2026-08-30'), log('a', '2026-08-31')],
      from: '2026-09-01',
      to: '2026-09-03',
      tokens: 2,
    })
    expect(result.spends.map((s) => s.dayKey)).toEqual(['2026-09-01', '2026-09-02'])
    expect(result.broken).toEqual([{ habitId: 'a', dayKey: '2026-09-03', streakLost: 2 }])
    expect(result.tokensRemaining).toBe(0)
  })

  it('stops spending once a streak is already broken', () => {
    // One token, five missed days. The token covers the first miss; the second
    // is what actually ends the streak. Days three onward have a zero streak,
    // so they neither cost a token nor get reported — there is nothing left to
    // lose, and repeating "streak broken" for each day would be noise.
    const result = plan({
      habits: [habit('a')],
      logs: [log('a', '2026-08-31')],
      from: '2026-09-01',
      to: '2026-09-05',
      tokens: 1,
    })
    expect(result.spends).toEqual([{ habitId: 'a', dayKey: '2026-09-01', streakSaved: 1 }])
    expect(result.tokensRemaining).toBe(0)
    expect(result.broken).toEqual([{ habitId: 'a', dayKey: '2026-09-02', streakLost: 1 }])
  })

  it('rebuilds the streak after a completion mid-window', () => {
    const result = plan({
      habits: [habit('a')],
      logs: [log('a', '2026-09-02'), log('a', '2026-09-03')],
      from: '2026-09-01',
      to: '2026-09-04',
      tokens: 3,
    })
    // 1 Sept: no streak yet, nothing spent. 4 Sept: streak of 2, so covered.
    expect(result.spends).toEqual([{ habitId: 'a', dayKey: '2026-09-04', streakSaved: 2 }])
  })

  it('does nothing when the range is inverted', () => {
    const result = plan({
      habits: [habit('a')],
      logs: [],
      from: '2026-09-05',
      to: '2026-09-01',
      tokens: 2,
    })
    expect(result.spends).toEqual([])
    expect(result.tokensRemaining).toBe(2)
  })
})

describe('planRollover — cadence awareness', () => {
  const monWedFri: Schedule = { kind: 'specificDays', days: [1, 3, 5] }

  it('ignores days a habit is not scheduled on', () => {
    // Tuesday closing must not cost a Mon/Wed/Fri habit anything.
    const result = plan({
      habits: [habit('a', { schedule: monWedFri })],
      logs: [log('a', '2026-08-31')],
      from: '2026-09-01',
      to: '2026-09-01',
      tokens: 2,
    })
    expect(result.spends).toEqual([])
    expect(result.tokensRemaining).toBe(2)
  })

  it('covers a missed scheduled day', () => {
    const result = plan({
      habits: [habit('a', { schedule: monWedFri })],
      logs: [log('a', '2026-08-31')],
      from: '2026-09-01',
      to: '2026-09-02',
      tokens: 2,
    })
    expect(result.spends).toEqual([{ habitId: 'a', dayKey: '2026-09-02', streakSaved: 1 }])
  })

  it('never settles a habit before it existed', () => {
    const result = plan({
      habits: [habit('a', { startDayKey: '2026-09-03' })],
      logs: [],
      from: '2026-09-01',
      to: '2026-09-02',
      tokens: 2,
    })
    expect(result.spends).toEqual([])
  })
})

describe('planRollover — x-per-week habits', () => {
  const threePerWeek: Schedule = { kind: 'timesPerWeek', target: 3 }

  it('judges a week only once it has closed', () => {
    // Settling Wednesday must not evaluate the week — there is still time.
    const result = plan({
      habits: [habit('a', { schedule: threePerWeek })],
      logs: [log('a', '2026-08-24'), log('a', '2026-08-25'), log('a', '2026-08-26')],
      from: '2026-09-01',
      to: '2026-09-02',
      tokens: 2,
    })
    expect(result.spends).toEqual([])
  })

  it('spends one token to cover a whole short week', () => {
    // Week of 24 Aug hit the target; week of 31 Aug fell short and closes on
    // Sunday 6 September.
    const result = plan({
      habits: [habit('a', { schedule: threePerWeek, startDayKey: '2026-08-24' })],
      logs: [
        log('a', '2026-08-24'),
        log('a', '2026-08-25'),
        log('a', '2026-08-26'),
        log('a', '2026-08-31'),
      ],
      from: '2026-09-01',
      to: '2026-09-06',
      tokens: 2,
    })
    // The freeze is keyed on the week's start day.
    expect(result.spends).toEqual([{ habitId: 'a', dayKey: '2026-08-31', streakSaved: 1 }])
    expect(result.tokensRemaining).toBe(1)
  })

  it('spends nothing when the week hit its target', () => {
    const result = plan({
      habits: [habit('a', { schedule: threePerWeek, startDayKey: '2026-08-24' })],
      logs: [
        log('a', '2026-08-24'),
        log('a', '2026-08-31'),
        log('a', '2026-09-02'),
        log('a', '2026-09-04'),
      ],
      from: '2026-09-01',
      to: '2026-09-06',
      tokens: 2,
    })
    expect(result.spends).toEqual([])
  })

  it('does not charge for a partial first week', () => {
    // Created on Friday: three sessions were never possible that week.
    const result = plan({
      habits: [habit('a', { schedule: threePerWeek, startDayKey: '2026-09-04' })],
      logs: [log('a', '2026-09-04')],
      from: '2026-09-05',
      to: '2026-09-06',
      tokens: 2,
    })
    expect(result.spends).toEqual([])
    expect(result.tokensRemaining).toBe(2)
  })
})
