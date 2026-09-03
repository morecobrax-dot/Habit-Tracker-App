import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { HabitTrackerDb, ensureInitialised } from '@/data/db'
import { createHabit } from '@/data/repos/habitRepo'
import { updateSettings } from '@/data/repos/settingsRepo'
import { claimFocus, getFocus, newFocus } from '@/data/repos/focusRepo'
import { logHabit } from '@/services/loggingService'
import { ensureDailyFocus, getFocusForDay } from '@/services/focusService'
import { fixedClock } from '@/services/clock'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import { NO_RULES_VERSION } from '@/domain/logs'
import type { DayKey, DifficultyTier, Habit, HabitLog } from '@/domain/types'

/**
 * The one-focus-per-day cap, and the invariant that depends on it.
 *
 * From v3 the focus bonus borrows the account's *best* consistency multiplier
 * rather than the focus habit's own. That is only safe while exactly one habit
 * per day can be the focus — otherwise every habit could claim the best
 * multiplier at once and the bonus would stop being a tie-breaker and start
 * being a blanket pay rise.
 *
 * So the cap is not an incidental property to be assumed. These tests assert
 * it at the level it is actually enforced (the `dailyFocus` primary key) and
 * then assert the invariant it makes possible, end to end through the real
 * logging service rather than through the arithmetic alone.
 */

const at = (y: number, m: number, d: number, h = 9) => Date.UTC(y, m - 1, d, h)
const TODAY: DayKey = '2026-09-20'

let db: HabitTrackerDb
let counter = 0

beforeEach(async () => {
  db = new HabitTrackerDb(`focus-cap-${counter++}`)
  await db.open()
  await ensureInitialised(at(2026, 9, 20), db)
  await updateSettings({ timeZone: 'UTC' }, at(2026, 9, 20), db)
})

const makeHabit = (name: string, difficulty: DifficultyTier, startDayKey: DayKey) =>
  createHabit(
    {
      draft: {
        name,
        category: '',
        difficulty,
        schedule: { kind: 'daily' },
        minimumVersion: 'the small version',
      },
      startDayKey,
      instant: at(2026, 9, 20),
    },
    db,
  )

/** Writes history straight to the table: the backdate window blocks the service. */
const seedCompletions = async (habit: Habit, days: DayKey[]) => {
  const rows: HabitLog[] = days.map((dayKey) => ({
    id: `${habit.id}-${dayKey}`,
    habitId: habit.id,
    dayKey,
    outcome: 'complete',
    loggedAt: at(2026, 9, 1),
    tz: 'UTC',
    isBackdated: true,
    wasFocus: false,
    xpAwarded: 0,
    rulesVersion: NO_RULES_VERSION,
  }))
  await db.logs.bulkAdd(rows)
}

const daysBefore = (dayKey: DayKey, count: number): DayKey[] => {
  const out: DayKey[] = []
  const base = new Date(`${dayKey}T00:00:00Z`)
  for (let i = 1; i <= count; i++) {
    const d = new Date(base)
    d.setUTCDate(d.getUTCDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

describe('focus is structurally one habit per day', () => {
  it('cannot store two focus rows for the same day', async () => {
    // `dayKey` is the PRIMARY KEY of the dailyFocus table, so this is enforced
    // by IndexedDB itself rather than by application code that could be
    // bypassed by a future caller.
    await db.dailyFocus.add(newFocus(TODAY, 'habit-a', 1, at(2026, 9, 20)))
    await expect(db.dailyFocus.add(newFocus(TODAY, 'habit-b', 1, at(2026, 9, 20)))).rejects.toBeDefined()
    expect(await db.dailyFocus.where('dayKey').equals(TODAY).count()).toBe(1)
  })

  it('keeps the first claim rather than overwriting it', async () => {
    const first = await claimFocus(newFocus(TODAY, 'habit-a', 5, at(2026, 9, 20)), db)
    const second = await claimFocus(newFocus(TODAY, 'habit-b', 9, at(2026, 9, 20)), db)
    expect(first.habitId).toBe('habit-a')
    expect(second.habitId).toBe('habit-a')
    expect((await getFocus(TODAY, db))?.habitId).toBe('habit-a')
  })

  it('converges when concurrent callers race to claim the day', async () => {
    const results = await Promise.all([
      claimFocus(newFocus(TODAY, 'habit-a', 1, at(2026, 9, 20)), db),
      claimFocus(newFocus(TODAY, 'habit-b', 1, at(2026, 9, 20)), db),
      claimFocus(newFocus(TODAY, 'habit-c', 1, at(2026, 9, 20)), db),
    ])
    const chosen = new Set(results.map((r) => r.habitId))
    expect(chosen.size).toBe(1)
    expect(await db.dailyFocus.where('dayKey').equals(TODAY).count()).toBe(1)
  })

  it('picks once and stays picked across repeated app opens', async () => {
    await makeHabit('alpha', 2, '2026-09-01')
    await makeHabit('beta', 2, '2026-09-01')
    const clock = fixedClock(at(2026, 9, 20))

    const first = await ensureDailyFocus(clock, db)
    const second = await ensureDailyFocus(clock, db)
    const third = await ensureDailyFocus(clock, db)

    expect(first).not.toBeNull()
    expect(second?.habitId).toBe(first?.habitId)
    expect(third?.habitId).toBe(first?.habitId)
    expect(await db.dailyFocus.count()).toBe(1)
  })

  it('marks exactly one of the day’s logs as the focus', async () => {
    // The cap where it actually matters: only one log per day can carry the
    // bonus, so only one can borrow the best multiplier.
    const avoided = await makeHabit('avoided', 1, '2026-09-01')
    const rival = await makeHabit('rival', 3, '2026-09-01')
    await claimFocus(newFocus(TODAY, avoided.id, 9, at(2026, 9, 20)), db)

    const clock = fixedClock(at(2026, 9, 20))
    await logHabit({ habitId: avoided.id, dayKey: TODAY, outcome: 'complete' }, clock, db)
    await logHabit({ habitId: rival.id, dayKey: TODAY, outcome: 'complete' }, clock, db)

    const todaysLogs = await db.logs.where('dayKey').equals(TODAY).toArray()
    expect(todaysLogs).toHaveLength(2)
    expect(todaysLogs.filter((l) => l.wasFocus)).toHaveLength(1)
    expect(todaysLogs.find((l) => l.wasFocus)?.habitId).toBe(avoided.id)
  })
})

describe('the invariant the cap makes safe', () => {
  it('pays more for the neglected focus habit than for a well-kept rival', async () => {
    /*
     * The property v3 exists to guarantee, stated as the user experiences it.
     *
     * Two habits on the same day. `rival` is tier 3 and has been completed
     * every day for a fortnight, so it sits at the top of the multiplier range.
     * `avoided` is tier 1 with no history at all — a zero streak, the lowest
     * multiplier there is, and exactly the habit the focus mechanic exists for.
     *
     * Under v1 and v2 the rival paid more, which meant the app's central claim
     * was false on any screen a real user would look at. This must fail loudly
     * if that ever comes back.
     */
    const avoided = await makeHabit('avoided', 1, '2026-08-01')
    const rival = await makeHabit('rival', 3, '2026-08-01')
    await seedCompletions(rival, daysBefore(TODAY, 14))
    await claimFocus(newFocus(TODAY, avoided.id, 9, at(2026, 9, 20)), db)

    const clock = fixedClock(at(2026, 9, 20))
    const focusAward = await logHabit(
      { habitId: avoided.id, dayKey: TODAY, outcome: 'complete' },
      clock,
      db,
    )
    const rivalAward = await logHabit(
      { habitId: rival.id, dayKey: TODAY, outcome: 'complete' },
      clock,
      db,
    )

    // The rival really is at the top of the range, and the focus habit really
    // is at the bottom — otherwise this would prove nothing.
    expect(rivalAward.award.breakdown.consistencyMultiplier).toBeCloseTo(
      1 + DEFAULT_XP_RULES.consistency.maxBonus,
    )
    expect(focusAward.award.breakdown.consistencyMultiplier).toBe(1)

    expect(focusAward.award.total).toBeGreaterThan(rivalAward.award.total)
    expect(focusAward.award.total).toBe(43)
    expect(rivalAward.award.total).toBe(39)
  })

  it('borrows the best multiplier rather than the habit’s own', async () => {
    // Same board, but proving *where* the extra came from: the bonus term is
    // the flat 25 scaled by 1.30, not by the focus habit's own 1.00.
    const avoided = await makeHabit('avoided', 1, '2026-08-01')
    const rival = await makeHabit('rival', 3, '2026-08-01')
    await seedCompletions(rival, daysBefore(TODAY, 14))
    await claimFocus(newFocus(TODAY, avoided.id, 9, at(2026, 9, 20)), db)

    const { award } = await logHabit(
      { habitId: avoided.id, dayKey: TODAY, outcome: 'complete' },
      fixedClock(at(2026, 9, 20)),
      db,
    )
    const max = 1 + DEFAULT_XP_RULES.consistency.maxBonus
    expect(award.breakdown.focusBonus).toBeCloseTo(DEFAULT_XP_RULES.focusBonus * max)
    expect(award.breakdown.consistencyMultiplier).toBe(1)
  })

  it('falls back to the habit’s own multiplier when nothing else is doing better', async () => {
    // A single-habit account has no better option to be measured against, so
    // the bonus is the flat figure and nothing is borrowed.
    const only = await makeHabit('only', 1, '2026-08-01')
    await claimFocus(newFocus(TODAY, only.id, 9, at(2026, 9, 20)), db)

    const { award } = await logHabit(
      { habitId: only.id, dayKey: TODAY, outcome: 'complete' },
      fixedClock(at(2026, 9, 20)),
      db,
    )
    expect(award.breakdown.focusBonus).toBe(DEFAULT_XP_RULES.focusBonus)
  })

  it('does not let a non-focus habit borrow anything', async () => {
    // The cap in award terms: the rival is on the same board as a maxed-out
    // habit and gets none of it, because it is not the focus.
    const avoided = await makeHabit('avoided', 1, '2026-08-01')
    const rival = await makeHabit('rival', 3, '2026-08-01')
    await seedCompletions(rival, daysBefore(TODAY, 14))
    await claimFocus(newFocus(TODAY, avoided.id, 9, at(2026, 9, 20)), db)

    const { award } = await logHabit(
      { habitId: rival.id, dayKey: TODAY, outcome: 'complete' },
      fixedClock(at(2026, 9, 20)),
      db,
    )
    expect(award.breakdown.focusBonus).toBe(0)
    expect(await getFocusForDay(TODAY, db)).toBeDefined()
  })
})
