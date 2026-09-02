import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { HabitTrackerDb, ensureInitialised } from '@/data/db'
import { createHabit } from '@/data/repos/habitRepo'
import { updateSettings } from '@/data/repos/settingsRepo'
import { listFreezeEvents, requireGameState } from '@/data/repos/gameStateRepo'
import { logHabit } from '@/services/loggingService'
import { runRollover } from '@/services/rolloverService'
import { fixedClock } from '@/services/clock'
import { computeStreak } from '@/domain/streak'
import { listLogsForHabit } from '@/data/repos/logRepo'
import type { Habit, Schedule } from '@/domain/types'

const at = (y: number, m: number, d: number, h = 9) => Date.UTC(y, m - 1, d, h)

let db: HabitTrackerDb
let counter = 0

const setup = async (
  startDay = '2026-09-01',
  schedule: Schedule = { kind: 'daily' },
  timeZone = 'UTC',
): Promise<Habit> => {
  await ensureInitialised(at(2026, 9, 1), db)
  await updateSettings({ timeZone }, at(2026, 9, 1), db)
  return createHabit(
    {
      draft: {
        name: 'Walk',
        category: '',
        difficulty: 2,
        schedule,
        minimumVersion: 'Shoes on',
      },
      startDayKey: startDay,
      instant: at(2026, 9, 1),
    },
    db,
  )
}

const streakOf = async (habit: Habit, today: string) => {
  const events = await listFreezeEvents(db)
  return computeStreak({
    habit,
    logs: await listLogsForHabit(habit.id, db),
    frozenDays: new Set(events.filter((e) => e.habitId === habit.id).map((e) => e.dayKey)),
    today,
    weekStartsOn: 1,
  })
}

beforeEach(async () => {
  db = new HabitTrackerDb(`roll-db-${counter++}`)
  await db.open()
})

describe('first run', () => {
  it('settles nothing and records the high-water mark', async () => {
    // A fresh install must not "discover" misses on days before it existed.
    await setup()
    const outcome = await runRollover(fixedClock(at(2026, 9, 5)), db)

    expect(outcome.daysSettled).toBe(0)
    expect(outcome.freezesSpent).toEqual([])
    expect((await requireGameState(db)).lastRolloverDayKey).toBe('2026-09-04')
  })

  it('grants the first week of tokens', async () => {
    await setup()
    const outcome = await runRollover(fixedClock(at(2026, 9, 2)), db)
    expect(outcome.tokensGranted).toBe(2)
    expect((await requireGameState(db)).freezeTokens).toBe(2)
  })
})

describe('idempotency', () => {
  it('is safe to run many times in one day', async () => {
    // An installed PWA gets opened constantly; none of it may double-charge.
    const habit = await setup()
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
      fixedClock(at(2026, 9, 1)),
      db,
    )
    await runRollover(fixedClock(at(2026, 9, 2)), db)

    const clock = fixedClock(at(2026, 9, 3))
    const first = await runRollover(clock, db)
    const afterFirst = await requireGameState(db)

    for (let i = 0; i < 5; i++) await runRollover(clock, db)
    const afterMany = await requireGameState(db)

    expect(first.freezesSpent).toHaveLength(1)
    expect(afterMany.freezeTokens).toBe(afterFirst.freezeTokens)
    expect(await listFreezeEvents(db)).toHaveLength(1)
  })

  it('does not grant twice in the same week', async () => {
    await setup()
    await runRollover(fixedClock(at(2026, 9, 2)), db)
    const second = await runRollover(fixedClock(at(2026, 9, 3)), db)
    expect(second.tokensGranted).toBe(0)
    expect((await requireGameState(db)).freezeTokens).toBe(2)
  })

  it('never moves the high-water mark backwards', async () => {
    // A clock or timezone change must not rewind settled history.
    await setup()
    await runRollover(fixedClock(at(2026, 9, 10)), db)
    expect((await requireGameState(db)).lastRolloverDayKey).toBe('2026-09-09')

    await runRollover(fixedClock(at(2026, 9, 5)), db)
    expect((await requireGameState(db)).lastRolloverDayKey).toBe('2026-09-09')
  })
})

describe('today is never settled', () => {
  it('leaves today alone so it can still be logged', async () => {
    // The core anti-dread rule: your streak must survive until the day closes.
    const habit = await setup()
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
      fixedClock(at(2026, 9, 1)),
      db,
    )
    await runRollover(fixedClock(at(2026, 9, 1)), db)

    // Same day, nothing logged yet beyond the 1st.
    const outcome = await runRollover(fixedClock(at(2026, 9, 1, 23)), db)
    expect(outcome.freezesSpent).toEqual([])
    expect((await streakOf(habit, '2026-09-01')).current).toBe(1)
  })
})

describe('absence', () => {
  it('replays several closed days and spends tokens in order', async () => {
    const habit = await setup('2026-09-01')
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
      fixedClock(at(2026, 9, 1)),
      db,
    )
    await runRollover(fixedClock(at(2026, 9, 2)), db) // establishes the mark

    // Disappear until the 6th. The 2nd-5th all closed unlogged.
    const outcome = await runRollover(fixedClock(at(2026, 9, 6)), db)

    expect(outcome.daysSettled).toBe(4)
    // Two tokens available, so two days covered and then the streak breaks.
    expect(outcome.freezesSpent.map((f) => f.dayKey)).toEqual(['2026-09-02', '2026-09-03'])
    expect(outcome.streaksBroken.map((b) => b.dayKey)).toEqual(['2026-09-04'])
    expect(outcome.tokensRemaining).toBe(0)
  })

  it('grants for every missed week during a long absence', async () => {
    await setup()
    await runRollover(fixedClock(at(2026, 9, 2)), db)
    // Three weeks later.
    const outcome = await runRollover(fixedClock(at(2026, 9, 23)), db)
    // 3 weeks x 2 = 6, capped at 4; two were already held, so two more.
    expect((await requireGameState(db)).freezeTokens).toBeLessThanOrEqual(4)
    expect(outcome.tokensGranted).toBeGreaterThan(0)
  })

  it('bounds how far back it replays', async () => {
    await setup()
    await runRollover(fixedClock(at(2026, 9, 2)), db)
    // A year later. The result is identical to sixty days later, so there is
    // nothing to gain from walking the whole gap.
    const outcome = await runRollover(fixedClock(at(2027, 9, 2)), db)
    expect(outcome.daysSettled).toBeLessThanOrEqual(61)
    expect((await requireGameState(db)).lastRolloverDayKey).toBe('2027-09-01')
  })
})

describe('freeze spending preserves the streak', () => {
  it('keeps the streak intact across a covered day', async () => {
    const habit = await setup('2026-09-01')
    for (const day of ['2026-09-01', '2026-09-02']) {
      await logHabit(
        { habitId: habit.id, dayKey: day, outcome: 'complete' },
        fixedClock(at(2026, 9, Number(day.slice(8)))),
        db,
      )
    }
    await runRollover(fixedClock(at(2026, 9, 3)), db)

    // The 3rd closes unlogged and gets covered.
    await runRollover(fixedClock(at(2026, 9, 4)), db)
    expect(await listFreezeEvents(db)).toHaveLength(1)

    // Streak survives at 2 — preserved, not incremented.
    const streak = await streakOf(habit, '2026-09-04')
    expect(streak.current).toBe(2)
    expect(streak.frozenInStreak).toEqual(['2026-09-03'])
  })

  it('lets the streak break once tokens run out', async () => {
    const habit = await setup('2026-09-01')
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
      fixedClock(at(2026, 9, 1)),
      db,
    )
    await runRollover(fixedClock(at(2026, 9, 2)), db)
    await runRollover(fixedClock(at(2026, 9, 6)), db)

    expect((await streakOf(habit, '2026-09-06')).current).toBe(0)
    // Longest is still remembered — nothing is ever taken away.
    expect((await streakOf(habit, '2026-09-06')).longest).toBe(1)
  })
})

describe('day rollover across a DST transition', () => {
  it('settles exactly one day when the clocks spring forward', async () => {
    // New York springs forward on 2026-03-08. The day is 23 hours long, but it
    // is still exactly one day, and rollover must not skip or double it.
    db = new HabitTrackerDb(`roll-dst-${counter++}`)
    await db.open()
    await ensureInitialised(at(2026, 3, 6), db)
    await updateSettings({ timeZone: 'America/New_York' }, at(2026, 3, 6), db)
    const habit = await createHabit(
      {
        draft: {
          name: 'Walk',
          category: '',
          difficulty: 2,
          schedule: { kind: 'daily' },
          minimumVersion: 'Shoes on',
        },
        startDayKey: '2026-03-06',
        instant: at(2026, 3, 6),
      },
      db,
    )

    await logHabit(
      { habitId: habit.id, dayKey: '2026-03-06', outcome: 'complete' },
      fixedClock(Date.UTC(2026, 2, 6, 17)), // noon EST
      db,
    )
    // Saturday the 7th, noon local.
    await runRollover(fixedClock(Date.UTC(2026, 2, 7, 17)), db)
    expect((await requireGameState(db)).lastRolloverDayKey).toBe('2026-03-06')

    // Sunday the 8th, noon EDT — one day later despite the 23-hour day.
    const outcome = await runRollover(fixedClock(Date.UTC(2026, 2, 8, 16)), db)
    expect(outcome.daysSettled).toBe(1)
    expect((await requireGameState(db)).lastRolloverDayKey).toBe('2026-03-07')
  })

  it('settles exactly one day when the clocks fall back', async () => {
    // 2026-11-01 in New York is 25 hours long.
    db = new HabitTrackerDb(`roll-dst2-${counter++}`)
    await db.open()
    await ensureInitialised(at(2026, 10, 30), db)
    await updateSettings({ timeZone: 'America/New_York' }, at(2026, 10, 30), db)

    await runRollover(fixedClock(Date.UTC(2026, 9, 31, 16)), db) // 31 Oct, noon EDT
    expect((await requireGameState(db)).lastRolloverDayKey).toBe('2026-10-30')

    const outcome = await runRollover(fixedClock(Date.UTC(2026, 10, 1, 17)), db) // 1 Nov, noon EST
    expect(outcome.daysSettled).toBe(1)
    expect((await requireGameState(db)).lastRolloverDayKey).toBe('2026-10-31')
  })
})

describe('x-per-week habits at rollover', () => {
  it('does not charge a token mid-week', async () => {
    const habit = await setup('2026-08-31', { kind: 'timesPerWeek', target: 3 })
    await runRollover(fixedClock(at(2026, 8, 31)), db)
    // Through Thursday with nothing logged: the week is still open.
    const outcome = await runRollover(fixedClock(at(2026, 9, 4)), db)
    expect(outcome.freezesSpent).toEqual([])
    expect((await streakOf(habit, '2026-09-04')).pending).toBe(true)
  })

  it('covers a short week once it closes', async () => {
    const habit = await setup('2026-08-31', { kind: 'timesPerWeek', target: 3 })
    for (const day of ['2026-08-31', '2026-09-01', '2026-09-02']) {
      await logHabit(
        { habitId: habit.id, dayKey: day, outcome: 'complete' },
        fixedClock(at(2026, 9, Number(day.slice(8)) === 31 ? 1 : Number(day.slice(8)))),
        db,
      )
    }
    await runRollover(fixedClock(at(2026, 9, 6)), db)
    expect((await streakOf(habit, '2026-09-06')).current).toBe(1)

    // Next week goes by with nothing done; it closes on Sunday 13 September.
    const outcome = await runRollover(fixedClock(at(2026, 9, 14)), db)
    expect(outcome.freezesSpent.map((f) => f.dayKey)).toEqual(['2026-09-07'])
    expect((await streakOf(habit, '2026-09-14')).current).toBe(1)
  })
})
