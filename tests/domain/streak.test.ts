import { describe, expect, it } from 'vitest'
import { computeStreak } from '@/domain/streak'
import { NO_RULES_VERSION } from '@/domain/logs'
import type { DayKey, Habit, HabitLog, LogOutcome, Schedule } from '@/domain/types'

// 2026-08-31 is a Monday. 2026-09-06 is the Sunday that closes that week.
const MON = '2026-08-31'

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

const streak = (
  logs: HabitLog[],
  today: DayKey,
  overrides: Partial<Habit> = {},
  frozenDays: DayKey[] = [],
) =>
  computeStreak({
    habit: habit(overrides),
    logs,
    frozenDays: new Set(frozenDays),
    today,
    weekStartsOn: 1,
  })

describe('daily streaks', () => {
  it('counts consecutive completed days', () => {
    const result = streak(
      [log('2026-08-31'), log('2026-09-01'), log('2026-09-02')],
      '2026-09-02',
    )
    expect(result.current).toBe(3)
    expect(result.longest).toBe(3)
    expect(result.unit).toBe('day')
  })

  it('is zero with no logs', () => {
    const result = streak([], '2026-09-02')
    expect(result.current).toBe(0)
    expect(result.longest).toBe(0)
  })

  it('breaks on a missed day that has closed', () => {
    // 1 Sept missing, so only the 2nd counts.
    const result = streak([log('2026-08-31'), log('2026-09-02')], '2026-09-02')
    expect(result.current).toBe(1)
    expect(result.longest).toBe(1)
  })

  it('remembers the longest run after it breaks', () => {
    const result = streak(
      [
        log('2026-08-31'),
        log('2026-09-01'),
        log('2026-09-02'),
        // 3 Sept missed
        log('2026-09-04'),
      ],
      '2026-09-04',
    )
    expect(result.current).toBe(1)
    expect(result.longest).toBe(3)
  })
})

describe('a partial keeps the streak', () => {
  // If the two-minute version broke your streak it would be a trap, not an
  // escape hatch. This is the single most important rule in the file.
  it('counts a partial exactly like a completion', () => {
    const result = streak(
      [log('2026-08-31'), log('2026-09-01', 'partial'), log('2026-09-02')],
      '2026-09-02',
    )
    expect(result.current).toBe(3)
  })

  it('holds the streak across a skip without extending it', () => {
    // A skip is an honest "not today". It must not break the streak — if it
    // did, telling the truth would cost exactly as much as ghosting the app,
    // and avoidance would be the rational move. It must not extend it either:
    // a streak of 3 has to mean three days you actually showed up for.
    const result = streak(
      [log('2026-08-31'), log('2026-09-01', 'skip'), log('2026-09-02')],
      '2026-09-02',
    )
    expect(result.current).toBe(2)
  })

  it('never lets a skip cost more than doing nothing', () => {
    // The property that matters, stated directly: for any history, replacing a
    // missed day with an explicit skip can only help.
    const ghosted = streak([log('2026-08-31'), log('2026-09-02')], '2026-09-02')
    const skipped = streak(
      [log('2026-08-31'), log('2026-09-01', 'skip'), log('2026-09-02')],
      '2026-09-02',
    )
    expect(skipped.current).toBeGreaterThanOrEqual(ghosted.current)
    expect(ghosted.current).toBe(1)
  })

  it('does not let a run of skips manufacture a streak', () => {
    // Skips hold the line, they do not build it. Nothing done means nothing
    // earned, however diligently it was declared.
    const result = streak(
      [log('2026-08-31', 'skip'), log('2026-09-01', 'skip'), log('2026-09-02', 'skip')],
      '2026-09-02',
    )
    expect(result.current).toBe(0)
    expect(result.longest).toBe(0)
  })

  it('spends no freeze on a skipped day', () => {
    // A skip preserves on its own, so `frozenInStreak` stays empty: the token
    // pool is untouched and the UI has nothing to explain.
    const result = streak(
      [log('2026-08-31'), log('2026-09-01', 'skip'), log('2026-09-02')],
      '2026-09-02',
    )
    expect(result.frozenInStreak).toEqual([])
  })
})

describe('the current day is never a break', () => {
  it('keeps yesterday’s streak while today is unlogged', () => {
    // The whole point: opening the app in the morning must not show zero.
    const result = streak([log('2026-08-31'), log('2026-09-01')], '2026-09-02')
    expect(result.current).toBe(2)
    expect(result.pending).toBe(true)
  })

  it('extends once today is logged', () => {
    const result = streak(
      [log('2026-08-31'), log('2026-09-01'), log('2026-09-02')],
      '2026-09-02',
    )
    expect(result.current).toBe(3)
    expect(result.pending).toBe(false)
  })

  it('treats a skip logged today as answered, not pending', () => {
    // The user opened the app and gave an answer, so the day is resolved.
    // Leaving it pending would keep nudging someone who already engaged —
    // which is the nagging the app is supposed to remove.
    const result = streak([log('2026-08-31'), log('2026-09-01', 'skip')], '2026-09-01')
    expect(result.current).toBe(1)
    expect(result.pending).toBe(false)
  })

  it('still lets a skipped day be completed later the same day', () => {
    // Changing your mind must be rewarded, not blocked: overwriting today's
    // skip with a completion extends the streak normally.
    const result = streak([log('2026-08-31'), log('2026-09-01')], '2026-09-01')
    expect(result.current).toBe(2)
  })
})

describe('specific-day habits', () => {
  const monWedFri: Schedule = { kind: 'specificDays', days: [1, 3, 5] }

  it('steps over days it is not scheduled on', () => {
    // Mon 31 Aug, Wed 2 Sept, Fri 4 Sept. Tuesday and Thursday are irrelevant.
    const result = streak(
      [log('2026-08-31'), log('2026-09-02'), log('2026-09-04')],
      '2026-09-04',
      { schedule: monWedFri },
    )
    expect(result.current).toBe(3)
  })

  it('does not break when an unscheduled day passes unlogged', () => {
    const result = streak([log('2026-08-31')], '2026-09-01', { schedule: monWedFri })
    expect(result.current).toBe(1)
    // Tuesday is not scheduled, so nothing is pending.
    expect(result.pending).toBe(false)
  })

  it('breaks when a scheduled day is missed', () => {
    // Wednesday missed.
    const result = streak([log('2026-08-31'), log('2026-09-04')], '2026-09-04', {
      schedule: monWedFri,
    })
    expect(result.current).toBe(1)
  })

  it('ignores days before the habit existed', () => {
    const result = streak([log('2026-09-02'), log('2026-09-04')], '2026-09-04', {
      schedule: monWedFri,
      startDayKey: '2026-09-02',
    })
    expect(result.current).toBe(2)
  })
})

describe('x-per-week streaks', () => {
  const threePerWeek: Schedule = { kind: 'timesPerWeek', target: 3 }

  it('counts consecutive weeks that hit the target', () => {
    const result = streak(
      [
        // Week of 31 Aug: three sessions.
        log('2026-08-31'),
        log('2026-09-02'),
        log('2026-09-04'),
        // Week of 7 Sept: three more.
        log('2026-09-07'),
        log('2026-09-09'),
        log('2026-09-11'),
      ],
      '2026-09-13',
      { schedule: threePerWeek },
    )
    expect(result.current).toBe(2)
    expect(result.unit).toBe('week')
  })

  it('has no mid-week deadline to miss', () => {
    // Wednesday of the second week with only one session done. The first week
    // hit its target, so the streak stands and the week is merely pending.
    const result = streak(
      [log('2026-08-31'), log('2026-09-02'), log('2026-09-04'), log('2026-09-07')],
      '2026-09-09',
      { schedule: threePerWeek },
    )
    expect(result.current).toBe(1)
    expect(result.pending).toBe(true)
    expect(result.progress).toEqual({ done: 1, target: 3 })
  })

  it('counts the current week once the target is met', () => {
    const result = streak(
      [log('2026-08-31'), log('2026-09-02'), log('2026-09-04')],
      '2026-09-04',
      { schedule: threePerWeek },
    )
    expect(result.current).toBe(1)
    expect(result.pending).toBe(false)
  })

  it('breaks when a closed week fell short', () => {
    const result = streak(
      [
        log('2026-08-31'),
        log('2026-09-02'),
        log('2026-09-04'),
        // Week of 7 Sept: only two.
        log('2026-09-07'),
        log('2026-09-09'),
      ],
      '2026-09-14',
      { schedule: threePerWeek },
    )
    expect(result.current).toBe(0)
  })

  it('does not punish a partial first week', () => {
    // Created on Friday with a 3x target — three sessions were never possible,
    // so that week must not break anything.
    const result = streak(
      [log('2026-09-04'), log('2026-09-07'), log('2026-09-09'), log('2026-09-11')],
      '2026-09-13',
      { schedule: threePerWeek, startDayKey: '2026-09-04' },
    )
    expect(result.current).toBe(1)
  })

  it('counts a partial toward the weekly target', () => {
    const result = streak(
      [log('2026-08-31'), log('2026-09-02', 'partial'), log('2026-09-04')],
      '2026-09-04',
      { schedule: threePerWeek },
    )
    expect(result.progress).toEqual({ done: 3, target: 3 })
    expect(result.current).toBe(1)
  })

  it('respects a Sunday week start', () => {
    // With Sunday-start weeks, 6 September belongs to the *next* week, so the
    // week of 31 Aug only has two sessions and falls short.
    const result = computeStreak({
      habit: habit({ schedule: threePerWeek, startDayKey: '2026-08-30' }),
      logs: [log('2026-08-31'), log('2026-09-02'), log('2026-09-06')],
      frozenDays: new Set(),
      today: '2026-09-08',
      weekStartsOn: 0,
    })
    expect(result.current).toBe(0)
  })
})

describe('freeze tokens preserve a streak', () => {
  it('bridges a missed day without incrementing', () => {
    // Mon and Wed done, Tue frozen. The streak survives at 2 — you did not do
    // the thing on Tuesday, so it does not count, but you keep what you built.
    const result = streak(
      [log('2026-08-31'), log('2026-09-02')],
      '2026-09-02',
      {},
      ['2026-09-01'],
    )
    expect(result.current).toBe(2)
    expect(result.frozenInStreak).toEqual(['2026-09-01'])
  })

  it('still breaks on an unfrozen miss', () => {
    const result = streak(
      [log('2026-08-31'), log('2026-09-03')],
      '2026-09-03',
      {},
      ['2026-09-01'], // 2 Sept is missed and not frozen
    )
    expect(result.current).toBe(1)
    expect(result.frozenInStreak).toEqual([])
  })

  it('bridges a whole missed week for an x-per-week habit', () => {
    const result = streak(
      [
        log('2026-08-31'),
        log('2026-09-02'),
        log('2026-09-04'),
        // Week of 7 Sept missed entirely, but frozen.
        log('2026-09-14'),
        log('2026-09-16'),
        log('2026-09-18'),
      ],
      '2026-09-20',
      { schedule: { kind: 'timesPerWeek', target: 3 } },
      ['2026-09-07'], // the week-start day
    )
    expect(result.current).toBe(2)
  })

  it('drops the frozen record once the streak breaks anyway', () => {
    const result = streak(
      [log('2026-08-31'), log('2026-09-05')],
      '2026-09-05',
      {},
      ['2026-09-01'],
    )
    // 2-4 Sept were missed unfrozen, so the earlier freeze is no longer
    // holding anything up.
    expect(result.current).toBe(1)
    expect(result.frozenInStreak).toEqual([])
  })
})

describe('progress reporting', () => {
  it('reports today as done or not for a daily habit', () => {
    expect(streak([log('2026-09-02')], '2026-09-02').progress).toEqual({ done: 1, target: 1 })
    expect(streak([], '2026-09-02').progress).toEqual({ done: 0, target: 1 })
  })

  it('reports target zero when the habit is not due today', () => {
    // Mon/Wed/Fri habit on a Tuesday.
    const result = streak([], '2026-09-01', {
      schedule: { kind: 'specificDays', days: [1, 3, 5] },
    })
    expect(result.progress).toEqual({ done: 0, target: 0 })
  })
})
