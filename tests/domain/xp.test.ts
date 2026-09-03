import { describe, expect, it } from 'vitest'
import { awardXp, bestConsistencyMultiplierFor, consistencyRate, consistencyMultiplierFor, totalXpFromLogs } from '@/domain/xp'
import { DEFAULT_XP_RULES, type XpRules } from '@/domain/rules/xpRules'
import type { DayKey, Habit, HabitLog, LogOutcome, Schedule } from '@/domain/types'

const R = DEFAULT_XP_RULES

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Test',
  category: '',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: 'small',
  status: 'active',
  startDayKey: '2026-01-01',
  sortOrder: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const log = (dayKey: DayKey, outcome: LogOutcome = 'complete', xpAwarded = 0): HabitLog => ({
  id: `l-${dayKey}`,
  habitId: 'h1',
  dayKey,
  outcome,
  loggedAt: 0,
  tz: 'UTC',
  isBackdated: false,
  wasFocus: false,
  xpAwarded,
  rulesVersion: R.version,
})

/**
 * Independent reimplementation of the formula from the written spec, used to
 * cross-check `awardXp`. Deliberately not sharing code with the implementation:
 * asserting an implementation against itself proves only that it is consistent,
 * not that it is correct.
 */
/**
 * The formula from `domain/xp.ts`, written out a second time on purpose.
 *
 * Its value is that it is *independent*: if the engine and this disagree, one
 * of them is wrong and the test says so. That only works if it is kept in step
 * with the documented formula deliberately, which is what happened when the
 * bonus moved inside the multiplier (v2) and again when it started borrowing
 * the account's best multiplier (v3).
 *
 * `bonusMultiplier` defaults to the habit's own, which is the engine's
 * behaviour when no best multiplier is supplied.
 */
const expectedXp = (
  base: number,
  factor: number,
  rate: number,
  focusBonus: number,
  rules: XpRules = R,
  bonusMultiplier?: number,
) => {
  const own = 1 + rules.consistency.maxBonus * rate
  return Math.round(base * factor * own + focusBonus * (bonusMultiplier ?? own))
}

describe('base awards', () => {
  it('scores a completion at full base XP when consistency is zero', () => {
    // A brand-new habit has no history, so the multiplier is exactly 1.0.
    const award = awardXp(
      {
        habit: habit({ difficulty: 3, startDayKey: '2026-01-10' }),
        outcome: 'complete',
        dayKey: '2026-01-10',
        logs: [],
        isFocus: false,
        weekStartsOn: 1,
      },
      R,
    )
    expect(award.total).toBe(30)
    expect(award.breakdown.consistencyMultiplier).toBe(1)
    expect(award.rulesVersion).toBe(R.version)
  })

  it('scales with difficulty', () => {
    const scoreFor = (difficulty: 1 | 2 | 3 | 4) =>
      awardXp(
        {
          habit: habit({ difficulty, startDayKey: '2026-01-10' }),
          outcome: 'complete',
          dayKey: '2026-01-10',
          logs: [],
          isFocus: false,
          weekStartsOn: 1,
        },
        R,
      ).total
    expect([scoreFor(1), scoreFor(2), scoreFor(3), scoreFor(4)]).toEqual([10, 18, 30, 45])
  })

  it('pays 60% for a partial', () => {
    // The single most important dial: a partial is a real success, not a
    // rounding error. 0.6 rather than 0.5 keeps it above the "half a person"
    // line while leaving a reason to finish.
    const award = awardXp(
      {
        habit: habit({ difficulty: 3, startDayKey: '2026-01-10' }),
        outcome: 'partial',
        dayKey: '2026-01-10',
        logs: [],
        isFocus: false,
        weekStartsOn: 1,
      },
      R,
    )
    expect(award.total).toBe(18)
  })

  it('pays nothing for a skip, focus bonus included', () => {
    const award = awardXp(
      {
        habit: habit({ startDayKey: '2026-01-10' }),
        outcome: 'skip',
        dayKey: '2026-01-10',
        logs: [],
        isFocus: true,
        weekStartsOn: 1,
      },
      R,
    )
    expect(award.total).toBe(0)
    expect(award.breakdown.focusBonus).toBe(0)
  })

  it('never returns a negative award', () => {
    for (const outcome of ['complete', 'partial', 'skip'] as LogOutcome[]) {
      const award = awardXp(
        {
          habit: habit(),
          outcome,
          dayKey: '2026-01-10',
          logs: [],
          isFocus: false,
          weekStartsOn: 1,
        },
        R,
      )
      expect(award.total).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('consistency multiplier', () => {
  it('is 1.0 for a habit with no history', () => {
    expect(
      consistencyMultiplierFor(habit({ startDayKey: '2026-01-10' }), [], '2026-01-10', 1, R),
    ).toBe(1)
  })

  it('excludes the day being logged, so an action cannot inflate its own multiplier', () => {
    const withToday = consistencyRate(
      habit({ startDayKey: '2026-01-01' }),
      [log('2026-01-15')],
      '2026-01-15',
      1,
      R,
    )
    expect(withToday).toBe(0)
  })

  it('ramps in over about two weeks rather than maxing from one completion', () => {
    // The minDenominator floor of 5 stops a perfect first day reaching 1.30.
    const rate = consistencyRate(
      habit({ startDayKey: '2026-01-14' }),
      [log('2026-01-14')],
      '2026-01-15',
      1,
      R,
    )
    // One completion, denominator floored at 5.
    expect(rate).toBeCloseTo(1 / 5, 10)
    expect(consistencyMultiplierFor(habit({ startDayKey: '2026-01-14' }), [log('2026-01-14')], '2026-01-15', 1, R)).toBeCloseTo(1.06, 10)
  })

  it('reaches the cap with a full window of completions', () => {
    const logs: HabitLog[] = []
    for (let d = 1; d <= 14; d++) {
      logs.push(log(`2026-01-${String(d).padStart(2, '0')}`))
    }
    const rate = consistencyRate(habit(), logs, '2026-01-15', 1, R)
    expect(rate).toBe(1)
    expect(consistencyMultiplierFor(habit(), logs, '2026-01-15', 1, R)).toBeCloseTo(1.3, 10)
  })

  it('degrades gently, not off a cliff — the whole point of this design', () => {
    // Thirteen of the last fourteen days done. A raw streak multiplier would
    // crash from 1.30 to 1.00 here; this must barely move.
    const logs: HabitLog[] = []
    for (let d = 1; d <= 14; d++) {
      if (d === 7) continue // one missed day
      logs.push(log(`2026-01-${String(d).padStart(2, '0')}`))
    }
    const mult = consistencyMultiplierFor(habit(), logs, '2026-01-15', 1, R)
    expect(mult).toBeCloseTo(1 + 0.3 * (13 / 14), 10)
    expect(mult).toBeGreaterThan(1.27)
  })

  it('counts a partial at its completion factor, not as a miss', () => {
    // This habit is old enough that the full 14-day window applies, so the
    // denominator is 14 scheduled days rather than the minDenominator floor.
    const logs = [log('2026-01-13'), log('2026-01-14', 'partial')]
    const rate = consistencyRate(habit(), logs, '2026-01-15', 1, R)
    expect(rate).toBeCloseTo(1.6 / 14, 10)
  })

  it('ignores skips', () => {
    const logs = [log('2026-01-13'), log('2026-01-14', 'skip')]
    // Only the completion counts: 1.0 over the same 14-day denominator.
    expect(consistencyRate(habit(), logs, '2026-01-15', 1, R)).toBeCloseTo(1 / 14, 10)
  })

  it('applies the minDenominator floor only while a habit is new', () => {
    // Two days old: 2 expected occurrences, floored to 5, so a perfect record
    // yields 0.4 rather than 1.0 — the bonus ramps in instead of maxing out.
    const young = habit({ startDayKey: '2026-01-13' })
    expect(consistencyRate(young, [log('2026-01-13'), log('2026-01-14')], '2026-01-15', 1, R)).toBeCloseTo(
      2 / 5,
      10,
    )
  })

  it('never looks before the habit existed', () => {
    // A habit created three days ago must not be judged against fourteen days
    // of "misses" it could not have acted on.
    const h = habit({ startDayKey: '2026-01-13' })
    const rate = consistencyRate(h, [log('2026-01-13'), log('2026-01-14')], '2026-01-15', 1, R)
    expect(rate).toBeCloseTo(2 / 5, 10)
  })

  it('is clamped to 1', () => {
    expect(consistencyRate(habit(), [], '2026-01-15', 1, R)).toBeGreaterThanOrEqual(0)
    const many: HabitLog[] = []
    for (let d = 1; d <= 14; d++) many.push(log(`2026-01-${String(d).padStart(2, '0')}`))
    expect(consistencyRate(habit(), many, '2026-01-15', 1, R)).toBeLessThanOrEqual(1)
  })
})

describe('consistency is fair across cadences', () => {
  // Without cadence-aware expectations, a Mon/Wed/Fri habit could never exceed
  // a third of the multiplier a daily habit reaches — punishing the user for
  // choosing a realistic cadence.
  const monWedFri: Schedule = { kind: 'specificDays', days: [1, 3, 5] }
  const threePerWeek: Schedule = { kind: 'timesPerWeek', target: 3 }

  it('lets a set-day habit reach the cap by doing its scheduled days', () => {
    // 2026-01-01 is a Thursday. Scheduled days in the trailing fortnight from
    // 2026-01-15 are the Mon/Wed/Fri occurrences.
    const h = habit({ schedule: monWedFri, startDayKey: '2026-01-01' })
    const logs = ['2026-01-02', '2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14'].map(
      (d) => log(d),
    )
    expect(consistencyRate(h, logs, '2026-01-15', 1, R)).toBe(1)
  })

  it('lets an x-per-week habit reach the cap at its target rate', () => {
    const h = habit({ schedule: threePerWeek, startDayKey: '2026-01-01' })
    // Six completions across the fortnight = the 3/week target.
    const logs = ['2026-01-02', '2026-01-04', '2026-01-06', '2026-01-08', '2026-01-10', '2026-01-12'].map(
      (d) => log(d),
    )
    expect(consistencyRate(h, logs, '2026-01-15', 1, R)).toBe(1)
  })
})

describe('focus bonus', () => {
  it('adds a flat amount on top', () => {
    const award = awardXp(
      {
        habit: habit({ difficulty: 1, startDayKey: '2026-01-10' }),
        outcome: 'complete',
        dayKey: '2026-01-10',
        logs: [],
        isFocus: true,
        weekStartsOn: 1,
      },
      R,
    )
    expect(award.total).toBe(10 + 25)
    expect(award.breakdown.focusBonus).toBe(25)
  })

  it('applies in full to a minimum-version partial', () => {
    // Starting the avoided thing is the win. The bonus must not be prorated,
    // or the two-minute version stops being worth reaching for.
    const award = awardXp(
      {
        habit: habit({ difficulty: 1, startDayKey: '2026-01-10' }),
        outcome: 'partial',
        dayKey: '2026-01-10',
        logs: [],
        isFocus: true,
        weekStartsOn: 1,
      },
      R,
    )
    expect(award.breakdown.focusBonus).toBe(25)
    expect(award.total).toBe(Math.round(10 * 0.6) + 25)
  })

  it('makes the avoided trivial habit outscore a completed hard one', () => {
    // The core incentive claim of the whole product. A tier-1 habit done at its
    // two-minute minimum, as today's focus, must beat a tier-3 habit completed
    // outright — otherwise the app is not paying for what it says it values.
    const focusMinimum = awardXp(
      {
        habit: habit({ difficulty: 1, startDayKey: '2026-01-10' }),
        outcome: 'partial',
        dayKey: '2026-01-10',
        logs: [],
        isFocus: true,
        weekStartsOn: 1,
      },
      R,
    ).total

    const hardComplete = awardXp(
      {
        habit: habit({ id: 'h2', difficulty: 3, startDayKey: '2026-01-10' }),
        outcome: 'complete',
        dayKey: '2026-01-10',
        logs: [],
        isFocus: false,
        weekStartsOn: 1,
      },
      R,
    ).total

    expect(focusMinimum).toBeGreaterThan(hardComplete)
  })
})

describe('formula cross-check', () => {
  it('matches an independent implementation of the written formula', () => {
    const h = habit({ difficulty: 4, startDayKey: '2026-01-01' })
    const logs = [
      log('2026-01-10'),
      log('2026-01-11', 'partial'),
      log('2026-01-12'),
      log('2026-01-13'),
      log('2026-01-14'),
    ]
    const award = awardXp(
      { habit: h, outcome: 'complete', dayKey: '2026-01-15', logs, isFocus: true, weekStartsOn: 1 },
      R,
    )

    // Independently: 4.6 weighted completions over 14 scheduled days.
    const rate = 4.6 / 14
    expect(award.total).toBe(expectedXp(45, 1.0, rate, 25))
  })

  it('matches the independent formula when the bonus borrows a better multiplier', () => {
    // The primary path from v3 on: the bonus is scaled by a multiplier that
    // did not come from this habit. Cross-checked the same way, because that
    // is the arithmetic the app now actually runs.
    const h = habit({ difficulty: 4, startDayKey: '2026-01-01' })
    const logs = [
      log('2026-01-10'),
      log('2026-01-11', 'partial'),
      log('2026-01-12'),
      log('2026-01-13'),
      log('2026-01-14'),
    ]
    const best = 1 + R.consistency.maxBonus
    const award = awardXp(
      {
        habit: h,
        outcome: 'complete',
        dayKey: '2026-01-15',
        logs,
        isFocus: true,
        weekStartsOn: 1,
        bestConsistencyMultiplier: best,
      },
      R,
    )

    const rate = 4.6 / 14
    expect(award.total).toBe(expectedXp(45, 1.0, rate, 25, R, best))
    // And it really did borrow: the bonus term exceeds the flat figure.
    expect(award.breakdown.focusBonus).toBeCloseTo(R.focusBonus * best)
  })

  it('never lets a borrowed multiplier reduce the bonus below the habit’s own', () => {
    // The `max` guard. A caller passing a stale or too-low value must not be
    // able to make an award smaller than it would have been without one.
    const h = habit({ difficulty: 4, startDayKey: '2026-01-01' })
    const logs = [log('2026-01-10'), log('2026-01-11'), log('2026-01-12')]
    const shared = { habit: h, outcome: 'complete' as const, dayKey: '2026-01-15', logs, isFocus: true, weekStartsOn: 1 as const }

    const withoutBest = awardXp(shared, R)
    const withTooLow = awardXp({ ...shared, bestConsistencyMultiplier: 0.5 }, R)
    expect(withTooLow.total).toBe(withoutBest.total)
    expect(withTooLow.breakdown.focusBonus).toBe(withoutBest.breakdown.focusBonus)
  })
})

describe('bestConsistencyMultiplierFor', () => {
  it('is the highest multiplier on the board', () => {
    const weak = habit({ difficulty: 2, startDayKey: '2026-01-01' })
    const strong = { ...habit({ difficulty: 2, startDayKey: '2026-01-01' }), id: 'strong' }
    const strongLogs = Array.from({ length: 14 }, (_, i) =>
      log(`2026-01-${String(i + 1).padStart(2, '0')}`),
    )
    const best = bestConsistencyMultiplierFor(
      [weak, strong],
      new Map([
        [weak.id, []],
        [strong.id, strongLogs],
      ]),
      '2026-01-15',
      1,
      R,
    )
    expect(best).toBeCloseTo(1 + R.consistency.maxBonus)
  })

  it('is the neutral 1 for an account with no habits', () => {
    expect(bestConsistencyMultiplierFor([], new Map(), '2026-01-15', 1, R)).toBe(1)
  })

  it('is 1 when nothing has any history yet', () => {
    const h = habit({ startDayKey: '2026-01-14' })
    expect(bestConsistencyMultiplierFor([h], new Map([[h.id, []]]), '2026-01-15', 1, R)).toBe(1)
  })
})

describe('totalXpFromLogs', () => {
  it('sums awards', () => {
    expect(
      totalXpFromLogs([log('2026-01-01', 'complete', 30), log('2026-01-02', 'partial', 18)]),
    ).toBe(48)
  })

  it('is zero for no logs', () => {
    expect(totalXpFromLogs([])).toBe(0)
  })

  it('ignores a corrupted negative award rather than reducing the total', () => {
    expect(totalXpFromLogs([log('2026-01-01', 'complete', 30), log('2026-01-02', 'complete', -5)])).toBe(30)
  })
})

describe('rules are swappable data', () => {
  it('scores with an alternative ruleset without touching the engine', () => {
    // This is the AI seam: a generated plan supplies a different XpRules value
    // and nothing in the domain changes.
    const generous: XpRules = {
      ...R,
      version: 'ai-2026-09',
      baseXpByDifficulty: { 1: 20, 2: 36, 3: 60, 4: 90 },
      focusBonus: 50,
    }
    const award = awardXp(
      {
        habit: habit({ difficulty: 2, startDayKey: '2026-01-10' }),
        outcome: 'complete',
        dayKey: '2026-01-10',
        logs: [],
        isFocus: true,
        weekStartsOn: 1,
      },
      generous,
    )
    expect(award.total).toBe(36 + 50)
    expect(award.rulesVersion).toBe('ai-2026-09')
  })
})
