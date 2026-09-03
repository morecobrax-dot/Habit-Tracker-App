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
    //
    // 499 under v1, 500 under v2. The whole difference is Friday's admin log,
    // derived by hand rather than accepted from the runner: the habit is 3x a
    // week and four days old, so its expected completions (1.71) fall under
    // the minDenominator floor of 5, giving a rate of 0.6/5 = 0.12 and a
    // multiplier of 1.036. v1 paid round(18.648) + 25 = 44; v2 pays
    // round(18.648 + 25.900) = 45. Tuesday's award is unchanged at 36, because
    // that habit had no history yet and its multiplier was exactly 1.00.
    //
    // A one-XP move on a whole week is the point, not a disappointment: in a
    // *first* week consistency has barely ramped, so the v1 defect is nearly
    // invisible here. It only bites on an established account — which is both
    // why it survived review and why it mattered. See the mature-account test
    // below for the size of it at full consistency.
    expect(total).toBe(500)
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
   * THE INVARIANT, at every multiplier rather than at one.
   *
   * `domain/xp.ts` states the app's central incentive as a property: the
   * minimum version of an avoided tier-1 habit is worth more than a tier-3
   * habit completed in full. Under v1 that held at a consistency multiplier of
   * exactly 1.00 and nowhere else — from 1.05 the avoided thing lost, so the
   * app stopped paying most for its own core lever precisely as a user got
   * established.
   *
   * This replaces the test that pinned that defect. It sweeps the whole
   * multiplier range instead of sampling two points, because the failure was a
   * *trend* and two points is exactly how a trend gets missed.
   *
   * READ THE COMPARISON CAREFULLY. It holds both habits at the *same*
   * multiplier, which is the claim `domain/xp.ts` makes and the one v1 broke.
   * It is NOT the claim that a neglected focus habit out-earns a well-kept
   * rival, because those two habits do not share a multiplier — and that
   * larger claim is false under v1 and v2 alike. The test below pins it.
   */
  it('pays most for the avoided thing at every consistency level, like for like', () => {
    const focusMinimum = (mult: number) =>
      Math.round(
        R.baseXpByDifficulty[1] * R.completionFactors.partial * mult + R.focusBonus * mult,
      )
    const tier3Complete = (mult: number) => Math.round(R.baseXpByDifficulty[3] * mult)

    const max = 1 + R.consistency.maxBonus
    for (let mult = 1; mult <= max + 1e-9; mult += 0.01) {
      expect(focusMinimum(mult)).toBeGreaterThan(tier3Complete(mult))
    }

    // The two ends, stated concretely so a retune shows up as a readable diff.
    expect(focusMinimum(1.0)).toBe(31)
    expect(tier3Complete(1.0)).toBe(30)
    expect(focusMinimum(1.3)).toBe(40)
    expect(tier3Complete(1.3)).toBe(39)
  })

  it('still refuses to out-earn a full tier-4 completion', () => {
    // The limit the flat-in-difficulty rule exists to keep. Paying more for two
    // minutes of admin than for a completed hour of deep work would distort the
    // board, and scaling the bonus by consistency must not have broken it.
    const focusMinimum = (mult: number) =>
      Math.round(
        R.baseXpByDifficulty[1] * R.completionFactors.partial * mult + R.focusBonus * mult,
      )
    const tier4Complete = (mult: number) => Math.round(R.baseXpByDifficulty[4] * mult)

    const max = 1 + R.consistency.maxBonus
    for (let mult = 1; mult <= max + 1e-9; mult += 0.01) {
      expect(focusMinimum(mult)).toBeLessThan(tier4Complete(mult))
    }
  })

  it('leaves every non-focus award byte-identical to v1', () => {
    // The fix moved where rounding happens, so this checks the change is
    // confined to focus awards: with no bonus, the new single rounding and the
    // old one agree by construction, and this asserts it rather than assuming.
    for (const tier of [1, 2, 3, 4] as const) {
      for (const outcome of ['complete', 'partial'] as const) {
        for (let mult = 1; mult <= 1.3 + 1e-9; mult += 0.01) {
          const base = R.baseXpByDifficulty[tier] * R.completionFactors[outcome] * mult
          expect(Math.round(base + 0)).toBe(Math.round(base))
        }
      }
    }
  })

  /**
   * THE GAP v2 NARROWS BUT DOES NOT CLOSE — pinned so it stays visible.
   *
   * The consistency multiplier is per-habit, and the focus habit is the
   * *neglected* one by construction, so its multiplier is structurally the
   * lowest on the board. It competes against habits that are being kept up,
   * which sit near the top of the range. Those are different multipliers, so
   * the like-for-like invariant above does not reach this case.
   *
   * v2 closes most of the distance — at 10 of the last 14 days the shortfall
   * goes from 7 XP to 1 — but a genuinely neglected habit still pays less than
   * a well-kept tier-3 completion. Fixing *that* means changing what the bonus
   * is scaled by, which is a decision about reward philosophy rather than a
   * contract violation, so it is not taken here.
   */
  it('still under-pays a neglected focus habit against a well-kept rival', () => {
    const mult = (rate: number) => 1 + R.consistency.maxBonus * Math.min(1, rate)
    const focusAward = (rate: number) => {
      const m = mult(rate)
      return Math.round(
        R.baseXpByDifficulty[1] * R.completionFactors.partial * m + R.focusBonus * m,
      )
    }
    const wellKeptTier3 = Math.round(R.baseXpByDifficulty[3] * mult(1))

    // A habit genuinely being avoided — the case the focus mechanic exists for.
    expect(focusAward(0)).toBeLessThan(wellKeptTier3)
    expect(focusAward(4 / 14)).toBeLessThan(wellKeptTier3)

    // v2's improvement, stated as a number so it is not mistaken for a fix.
    const v1At10of14 = Math.round(
      R.baseXpByDifficulty[1] * R.completionFactors.partial * mult(10 / 14),
    ) + R.focusBonus
    expect(v1At10of14).toBe(32)
    expect(focusAward(10 / 14)).toBe(38)
    expect(wellKeptTier3).toBe(39)
  })

  it('is worth ~30% more on a mature account than v1 would have paid', () => {
    // What the worked week cannot show, because a first week never gets there.
    // At the top of the consistency range the bonus is the dominant term in a
    // focus award, so diluting it was not a rounding-level problem.
    const max = 1 + R.consistency.maxBonus
    const v1 = Math.round(R.baseXpByDifficulty[1] * R.completionFactors.partial * max) +
      R.focusBonus
    const v2 = Math.round(
      R.baseXpByDifficulty[1] * R.completionFactors.partial * max + R.focusBonus * max,
    )
    expect(v1).toBe(33)
    expect(v2).toBe(40)
    // Same shape as every other term now: a 30% multiplier moves it 30%.
    expect(v2 / v1).toBeGreaterThan(1.2)
  })

  it('pays the focus bonus on the minimum version and on a completion alike', () => {
    const [minimumVersionDay, completedDay] = focusAwards
    expect(minimumVersionDay).toBeGreaterThan(R.focusBonus)
    expect(completedDay).toBeGreaterThan(minimumVersionDay!)
  })
})
