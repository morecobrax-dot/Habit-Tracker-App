import { describe, expect, it } from 'vitest'
import { habitStats, reviewWeek } from '@/domain/review'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import { NO_RULES_VERSION } from '@/domain/logs'
import type { DayKey, Habit, HabitLog, LogOutcome, Schedule } from '@/domain/types'

const FACTORS = DEFAULT_XP_RULES.completionFactors

// 2026-08-31 is a Monday; the week runs to Sunday 2026-09-06.
const MON = '2026-08-31'
const TUE = '2026-09-01'
const WED = '2026-09-02'
const SUN = '2026-09-06'

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

const stats = (h: Habit, logs: HabitLog[], today: DayKey = WED) =>
  habitStats(h, logs, MON, SUN, today, FACTORS)

describe('habitStats', () => {
  it('counts only days already lived', () => {
    // Today is Wednesday, so Thursday through Sunday are not yet owed. Counting
    // them would drop the rate for a reason the user cannot act on — a number
    // that falls while you sleep.
    const result = stats(habit('a'), [log('a', MON), log('a', TUE), log('a', WED)])
    expect(result.due).toBe(3)
    expect(result.completed).toBe(3)
    expect(result.rate).toBe(1)
  })

  it('weights a partial by the ruleset for the internal rate', () => {
    const result = stats(habit('a'), [log('a', MON, 'partial')], MON)
    expect(result.credit).toBeCloseTo(FACTORS.partial)
    expect(result.rate).toBeCloseTo(FACTORS.partial)
  })

  it('counts a partial in full for the displayed rate', () => {
    // `showedUpRate` is what a person sees, and it has to reconcile with the
    // "N of M" beside it. It also has to say that turning up counted.
    const result = stats(habit('a'), [log('a', MON, 'partial')], MON)
    expect(result.showedUp).toBe(1)
    expect(result.showedUpRate).toBe(1)
  })

  it('keeps the two rates apart when they disagree', () => {
    // Four completions and one partial out of five days: 100% shown up,
    // 92% weighted. Both are correct answers to different questions.
    const logs = [MON, TUE, WED, '2026-09-03'].map((d) => log('a', d))
    logs.push(log('a', '2026-09-04', 'partial'))
    const result = stats(habit('a'), logs, '2026-09-04')
    expect(result.showedUpRate).toBe(1)
    expect(result.rate).toBeCloseTo((4 + FACTORS.partial) / 5)
  })

  it('counts a skip as a day that happened but earned nothing', () => {
    const result = stats(habit('a'), [log('a', MON, 'skip')], MON)
    expect(result).toMatchObject({ due: 1, skipped: 1, credit: 0, rate: 0 })
  })

  it('ignores days the habit was not scheduled', () => {
    const monWedFri: Schedule = { kind: 'specificDays', days: [1, 3, 5] }
    const result = stats(habit('a', { schedule: monWedFri }), [log('a', MON)], WED)
    // Monday and Wednesday were due; Tuesday was not.
    expect(result.due).toBe(2)
    expect(result.rate).toBeCloseTo(0.5)
  })

  it('reports a zero rate rather than dividing by zero when nothing was due', () => {
    const result = stats(habit('a', { startDayKey: '2027-01-01' }), [])
    expect(result).toMatchObject({ due: 0, rate: 0 })
  })
})

describe('reviewWeek', () => {
  const review = (
    habits: Habit[],
    logs: HabitLog[],
    streaks: Record<string, number> = {},
    today: DayKey = WED,
  ) =>
    reviewWeek({
      habits,
      logs,
      from: MON,
      to: SUN,
      today,
      factors: FACTORS,
      streaks: new Map(Object.entries(streaks)),
    })

  it('is the weighted completion rate across every habit', () => {
    // Two habits, three lived days each = 6 due. Four completions.
    const result = review(
      [habit('a'), habit('b')],
      [log('a', MON), log('a', TUE), log('a', WED), log('b', MON)],
    )
    expect(result.due).toBe(6)
    expect(result.showedUp).toBe(4)
    expect(result.completionRate).toBeCloseTo(4 / 6)
  })

  it('counts a partial as a day shown up for in the headline rate', () => {
    // The displayed number answers "did you turn up", not "how much did you
    // do". Weighting it would make the two-minute version look like a
    // three-fifths day on the one screen a person reads for reassurance.
    const result = review([habit('a')], [log('a', MON, 'partial')], {}, MON)
    expect(result.completionRate).toBe(1)
  })

  it('names the longest running streak, breaking ties by name', () => {
    const result = review([habit('zebra'), habit('apple')], [], { zebra: 5, apple: 5 })
    expect(result.best?.habit.name).toBe('apple')
    expect(result.best?.streak).toBe(5)
  })

  it('has no best streak when nothing is lit', () => {
    expect(review([habit('a')], [], { a: 0 }).best).toBeNull()
  })

  it('surfaces the habit having the hardest week', () => {
    const result = review(
      [habit('a'), habit('b')],
      [log('a', MON), log('a', TUE), log('a', WED), log('b', MON)],
    )
    expect(result.needsAttention?.habit.name).toBe('b')
    expect(result.needsAttention?.rate).toBeCloseTo(1 / 3)
  })

  it('singles out nobody when every habit is perfect', () => {
    // The important half of the rule: with nothing struggling, there is no
    // "least good" habit to name. Naming one would invent a failure.
    const result = review(
      [habit('a'), habit('b')],
      [MON, TUE, WED].flatMap((day) => [log('a', day), log('b', day)]),
    )
    expect(result.needsAttention).toBeNull()
    expect(result.completionRate).toBe(1)
  })

  it('singles out nobody before anything has been scheduled', () => {
    const result = review([habit('a', { startDayKey: '2027-01-01' })], [])
    expect(result.needsAttention).toBeNull()
    expect(result.idle).toBe(true)
  })

  it('reports an idle week rather than a 0% one', () => {
    // A week that asked nothing is not a week you failed. The UI needs to tell
    // those apart, so `idle` is explicit rather than inferred from a 0 rate.
    const idle = review([habit('a', { startDayKey: '2027-01-01' })], [])
    const failed = review([habit('a')], [])
    expect(idle.idle).toBe(true)
    expect(failed.idle).toBe(false)
    expect(failed.completionRate).toBe(0)
  })

  it('counts a skipped habit as struggling, not as absent', () => {
    // A skip protects the streak but nothing was done, so the weekly view
    // should still surface it as the one needing a look.
    const result = review(
      [habit('a'), habit('b')],
      [log('a', MON), log('a', TUE), log('a', WED), log('b', MON, 'skip')],
    )
    expect(result.needsAttention?.habit.name).toBe('b')
    expect(result.needsAttention?.skipped).toBe(1)
  })
})
