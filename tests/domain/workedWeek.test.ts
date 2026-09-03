import { describe, expect, it } from 'vitest'
import { awardXp } from '@/domain/xp'
import { levelForXp } from '@/domain/level'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import { NO_RULES_VERSION } from '@/domain/logs'
import type { DayKey, Habit, HabitLog, LogOutcome, Schedule } from '@/domain/types'

/**
 * The worked example, pinned.
 *
 * `PLAN.md` required a formula proposal with "a worked example showing what a
 * realistic week produces", approved before implementing. That example was
 * agreed in conversation using an *approximated* consistency ramp, so this
 * recomputes it against the shipped rules and fixes the real figures in a test.
 *
 * Its job is not to assert a magic number. It is to make the shape of a week
 * visible, so that retuning any constant surfaces here as a diff in a readable
 * scenario rather than as a silent change to how the app feels.
 */

const R = DEFAULT_XP_RULES
const MON: DayKey = '2026-08-31' // a Monday

const habit = (
  id: string,
  difficulty: 1 | 2 | 3 | 4,
  schedule: Schedule,
): Habit => ({
  id,
  name: id,
  category: '',
  difficulty,
  schedule,
  minimumVersion: 'the small version',
  status: 'active',
  startDayKey: MON,
  sortOrder: 1,
  createdAt: 0,
  updatedAt: 0,
})

/** Five habits of a realistic shape, including one that gets avoided. */
const HABITS = {
  walk: habit('walk', 2, { kind: 'daily' }),
  deep: habit('deep', 4, { kind: 'specificDays', days: [1, 2, 3, 4, 5] }),
  read: habit('read', 1, { kind: 'daily' }),
  gym: habit('gym', 3, { kind: 'timesPerWeek', target: 3 }),
  admin: habit('admin', 2, { kind: 'timesPerWeek', target: 3 }),
} as const

type HabitKey = keyof typeof HABITS

interface Entry {
  habit: HabitKey
  outcome: LogOutcome
  focus?: boolean
}

/**
 * A messy but ordinary week: two partials, one completely blank day, and the
 * avoided admin habit reached twice — once at its minimum version.
 */
const WEEK: { day: DayKey; entries: Entry[] }[] = [
  {
    day: '2026-08-31',
    entries: [
      { habit: 'walk', outcome: 'complete' },
      { habit: 'deep', outcome: 'complete' },
      { habit: 'read', outcome: 'complete' },
      { habit: 'gym', outcome: 'complete' },
    ],
  },
  {
    day: '2026-09-01',
    entries: [
      { habit: 'walk', outcome: 'complete' },
      { habit: 'deep', outcome: 'partial' },
      { habit: 'read', outcome: 'complete' },
      { habit: 'admin', outcome: 'partial', focus: true },
    ],
  },
  {
    day: '2026-09-02',
    entries: [
      { habit: 'walk', outcome: 'complete' },
      { habit: 'deep', outcome: 'complete' },
      { habit: 'gym', outcome: 'complete' },
    ],
  },
  // Thursday: nothing at all.
  { day: '2026-09-03', entries: [] },
  {
    day: '2026-09-04',
    entries: [
      { habit: 'walk', outcome: 'complete' },
      { habit: 'deep', outcome: 'partial' },
      { habit: 'read', outcome: 'complete' },
      { habit: 'admin', outcome: 'complete', focus: true },
    ],
  },
  {
    day: '2026-09-05',
    entries: [
      { habit: 'walk', outcome: 'complete' },
      { habit: 'read', outcome: 'complete' },
      { habit: 'gym', outcome: 'complete' },
    ],
  },
  {
    day: '2026-09-06',
    entries: [
      { habit: 'walk', outcome: 'partial' },
      { habit: 'read', outcome: 'complete' },
    ],
  },
]

interface DayResult {
  day: DayKey
  xp: number
  runningTotal: number
  level: number
}

/** Replays the week through the real scoring rules. */
function playWeek(): { days: DayResult[]; total: number; focusAwards: number[] } {
  const logsByHabit = new Map<HabitKey, HabitLog[]>()
  const days: DayResult[] = []
  const focusAwards: number[] = []
  let total = 0

  for (const { day, entries } of WEEK) {
    let dayXp = 0

    for (const entry of entries) {
      const h = HABITS[entry.habit]
      const priorLogs = logsByHabit.get(entry.habit) ?? []

      const award = awardXp(
        {
          habit: h,
          outcome: entry.outcome,
          dayKey: day,
          logs: priorLogs,
          isFocus: entry.focus === true,
          weekStartsOn: 1,
        },
        R,
      )

      dayXp += award.total
      if (entry.focus) focusAwards.push(award.total)

      logsByHabit.set(entry.habit, [
        ...priorLogs,
        {
          id: `${entry.habit}-${day}`,
          habitId: h.id,
          dayKey: day,
          outcome: entry.outcome,
          loggedAt: 0,
          tz: 'UTC',
          isBackdated: false,
          wasFocus: entry.focus === true,
          xpAwarded: award.total,
          rulesVersion: NO_RULES_VERSION,
        },
      ])
    }

    total += dayXp
    days.push({ day, xp: dayXp, runningTotal: total, level: levelForXp(total, R).level })
  }

  return { days, total, focusAwards }
}

describe('a realistic first week', () => {
  const { days, total, focusAwards } = playWeek()

  it('produces a plausible weekly total', () => {
    // Pinned against the shipped rules. If a constant is retuned, this fails
    // and the new figure has to be looked at and accepted deliberately.
    expect(total).toBe(499)
  })

  it('lands mid-curve rather than stalling or running away', () => {
    const end = levelForXp(total, R)
    expect(end.level).toBe(4)
    // Not scraping into the level, not about to leave it.
    expect(end.progress).toBeGreaterThan(0.5)
    expect(end.progress).toBeLessThan(0.95)
  })

  it('levels up on day one', () => {
    // The motivational claim of the curve: one ordinary day of use must move
    // the number, because day one is when motivation is lowest.
    expect(days[0]!.level).toBeGreaterThan(1)
  })

  it('reaches level 3 by the end of day two', () => {
    expect(days[1]!.level).toBe(3)
  })

  it('takes nothing away on a blank day', () => {
    // Thursday. Missing a day is a lack of gain, never a loss — the single
    // most important property of the whole scoring system.
    const wed = days[2]!
    const thu = days[3]!
    expect(thu.xp).toBe(0)
    expect(thu.runningTotal).toBe(wed.runningTotal)
    expect(thu.level).toBe(wed.level)
  })

  it('rewards coming back the day after a blank day', () => {
    const fri = days[4]!
    expect(fri.xp).toBeGreaterThan(0)
    expect(fri.level).toBeGreaterThan(days[3]!.level)
  })

  it('never lets the running total or level fall', () => {
    for (let i = 1; i < days.length; i++) {
      expect(days[i]!.runningTotal).toBeGreaterThanOrEqual(days[i - 1]!.runningTotal)
      expect(days[i]!.level).toBeGreaterThanOrEqual(days[i - 1]!.level)
    }
  })

  it('makes the avoided habit out-earn every comparable action', () => {
    // Tuesday's admin log was only the *minimum version* of a habit that had
    // been avoided. It out-earns a full completion of any habit up to tier 3.
    //
    // It does NOT out-earn a full tier-4 completion (36 vs 45+). That is a
    // deliberate limit rather than an accident: paying more for two minutes of
    // admin than for a completed hour of deep work would distort the board.
    const tuesdayFocusAward = focusAwards[0]!
    expect(tuesdayFocusAward).toBe(36)
    expect(tuesdayFocusAward).toBeGreaterThan(30) // beats a full tier-3 completion
  })

  /**
   * KNOWN LIMITATION, pinned so it cannot quietly change.
   *
   * The focus bonus is flat while every other term is multiplied by
   * consistency, so the focus advantage *shrinks as an account matures*. On a
   * brand-new habit the minimum version of a tier-1 focus beats a full tier-3
   * completion by 1 XP; by the time consistency reaches 1.10 it already loses.
   *
   * That undermines the product's central claim — that the app pays most for
   * starting the avoided thing. Recorded in reports/phase-3.md with a proposed
   * fix; changing the formula needs approval, so the behaviour stands for now
   * and this test documents it honestly rather than asserting the claim we
   * wish were true.
   */
  it('shows the focus advantage eroding as consistency rises', () => {
    const focusMinimum = (mult: number) =>
      Math.round(R.baseXpByDifficulty[1] * R.completionFactors.partial * mult) +
      R.focusBonus
    const tier3Complete = (mult: number) => Math.round(R.baseXpByDifficulty[3] * mult)

    // New account: the avoided thing wins, but only just.
    expect(focusMinimum(1.0)).toBe(31)
    expect(tier3Complete(1.0)).toBe(30)

    // Established account: it no longer wins at all.
    expect(focusMinimum(1.3)).toBe(33)
    expect(tier3Complete(1.3)).toBe(39)
    expect(focusMinimum(1.3)).toBeLessThan(tier3Complete(1.3))
  })

  it('pays the focus bonus on the minimum version and on a completion alike', () => {
    const [minimumVersionDay, completedDay] = focusAwards
    expect(minimumVersionDay).toBeGreaterThan(R.focusBonus)
    expect(completedDay).toBeGreaterThan(minimumVersionDay!)
  })
})
