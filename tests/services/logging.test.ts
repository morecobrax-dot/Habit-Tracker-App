import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { HabitTrackerDb, ensureInitialised } from '@/data/db'
import { createHabit, archiveHabit } from '@/data/repos/habitRepo'
import { updateSettings } from '@/data/repos/settingsRepo'
import { getLog } from '@/data/repos/logRepo'
import { requireGameState, listFreezeEvents } from '@/data/repos/gameStateRepo'
import { LoggingError, logHabit, unlogHabit } from '@/services/loggingService'
import { runRollover } from '@/services/rolloverService'
import { fixedClock } from '@/services/clock'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import type { HabitDraft } from '@/domain/habitValidation'
import type { Habit, Schedule } from '@/domain/types'

/**
 * These run against a real IndexedDB (faked) and a controllable clock, so day
 * rollover is exercised the way it actually happens rather than mocked away.
 */

// 09:00 UTC on the given date — comfortably inside the day under a 04:00 cutoff
// in UTC, so the DayKey equals the calendar date.
const at = (y: number, m: number, d: number, h = 9) => Date.UTC(y, m - 1, d, h)

const draft = (overrides: Partial<HabitDraft> = {}): HabitDraft => ({
  name: 'Walk',
  category: '',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: 'Shoes on',
  ...overrides,
})

let db: HabitTrackerDb
let counter = 0

const setup = async (startDay = '2026-09-01', schedule?: Schedule): Promise<Habit> => {
  await ensureInitialised(at(2026, 9, 1), db)
  // Pin the timezone so DayKeys in these tests are unambiguous.
  await updateSettings({ timeZone: 'UTC' }, at(2026, 9, 1), db)
  return createHabit(
    {
      draft: schedule ? draft({ schedule }) : draft(),
      startDayKey: startDay,
      instant: at(2026, 9, 1),
    },
    db,
  )
}

beforeEach(async () => {
  db = new HabitTrackerDb(`svc-db-${counter++}`)
  await db.open()
})

describe('logHabit', () => {
  it('writes a log for today', async () => {
    const habit = await setup()
    const { log } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 2)),
      db,
    )
    expect(log.outcome).toBe('complete')
    expect(log.isBackdated).toBe(false)
    expect(log.dayKey).toBe('2026-09-02')
    // A tier-2 completion with no prior history: full base XP, multiplier 1.0.
    // The award is snapshotted onto the row along with the ruleset that made it.
    expect(log.xpAwarded).toBe(18)
    expect(log.rulesVersion).toBe(DEFAULT_XP_RULES.version)
  })

  it('records the partial kind', async () => {
    const habit = await setup()
    const { log } = await logHabit(
      {
        habitId: habit.id,
        dayKey: '2026-09-02',
        outcome: 'partial',
        partialKind: 'minimum',
      },
      fixedClock(at(2026, 9, 2)),
      db,
    )
    expect(log.partialKind).toBe('minimum')
  })

  it('updates in place rather than inserting a second row', async () => {
    const habit = await setup()
    const clock = fixedClock(at(2026, 9, 2))
    await logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'skip' }, clock, db)
    await logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' }, clock, db)

    expect(await db.logs.count()).toBe(1)
    expect((await getLog(habit.id, '2026-09-02', db))?.outcome).toBe('complete')
  })
})

describe('backdating', () => {
  it('allows logging within the window and marks it backdated', async () => {
    const habit = await setup()
    const { log } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 4)),
      db,
    )
    expect(log.isBackdated).toBe(true)
  })

  it('rejects a day outside the window', async () => {
    const habit = await setup()
    await expect(
      logHabit(
        { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
        fixedClock(at(2026, 9, 4)),
        db,
      ),
    ).rejects.toMatchObject({ code: 'outside_backdate_window' })
  })

  it('rejects the future', async () => {
    const habit = await setup()
    await expect(
      logHabit(
        { habitId: habit.id, dayKey: '2026-09-05', outcome: 'complete' },
        fixedClock(at(2026, 9, 4)),
        db,
      ),
    ).rejects.toMatchObject({ code: 'outside_backdate_window' })
  })

  it('honours a changed window setting', async () => {
    const habit = await setup()
    await updateSettings({ backdateWindowDays: 0 }, at(2026, 9, 1), db)
    await expect(
      logHabit(
        { habitId: habit.id, dayKey: '2026-09-03', outcome: 'complete' },
        fixedClock(at(2026, 9, 4)),
        db,
      ),
    ).rejects.toMatchObject({ code: 'outside_backdate_window' })
  })

  it('rejects a day before the habit existed', async () => {
    const habit = await setup('2026-09-03')
    await expect(
      logHabit(
        { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
        fixedClock(at(2026, 9, 3)),
        db,
      ),
    ).rejects.toMatchObject({ code: 'before_habit_start' })
  })

  it('rejects a day the habit is not scheduled on', async () => {
    // Mon/Wed/Fri habit, logged on a Tuesday.
    const habit = await setup('2026-08-31', { kind: 'specificDays', days: [1, 3, 5] })
    await expect(
      logHabit(
        { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
        fixedClock(at(2026, 9, 1)),
        db,
      ),
    ).rejects.toMatchObject({ code: 'not_scheduled' })
  })

  it('rejects a day inside an archived stretch', async () => {
    const habit = await setup()
    // Archived on the 1st, so the pause covers the 2nd onward.
    await archiveHabit(habit.id, { todayKey: '2026-09-01', instant: at(2026, 9, 1) }, db)
    await expect(
      logHabit(
        { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
        fixedClock(at(2026, 9, 2)),
        db,
      ),
    ).rejects.toMatchObject({ code: 'archived_habit' })
  })

  it('still accepts the day the habit was archived on', async () => {
    // The pause starts tomorrow, so today is still live. If this were refused,
    // archiving would leave behind a day that is owed but impossible to log —
    // a guaranteed miss the user cannot prevent.
    const habit = await setup()
    await archiveHabit(habit.id, { todayKey: '2026-09-02', instant: at(2026, 9, 2) }, db)
    const result = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 2)),
      db,
    )
    expect(result.log.outcome).toBe('complete')
  })

  it('rejects every day for a habit archived before ranges existed', async () => {
    // Backward compatibility: no recorded ranges means the status flag is all
    // we know, and it applies to every day — the previous behaviour exactly.
    const habit = await setup()
    await db.habits.update(habit.id, { status: 'archived' })
    await expect(
      logHabit(
        { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
        fixedClock(at(2026, 9, 2)),
        db,
      ),
    ).rejects.toMatchObject({ code: 'archived_habit' })
  })

  it('rejects an unknown habit', async () => {
    await setup()
    await expect(
      logHabit(
        { habitId: 'nope', dayKey: '2026-09-02', outcome: 'complete' },
        fixedClock(at(2026, 9, 2)),
        db,
      ),
    ).rejects.toBeInstanceOf(LoggingError)
  })
})

describe('the day boundary decides which day a log lands on', () => {
  it('credits a 01:30 log to the day just lived', async () => {
    const habit = await setup()
    // 01:30 UTC on 3 September, with a 04:00 cutoff, is still the 2nd.
    const { log } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 3, 1) + 30 * 60_000),
      db,
    )
    expect(log.dayKey).toBe('2026-09-02')
    // Not backdated: the 2nd *is* today at 01:30 on the 3rd.
    expect(log.isBackdated).toBe(false)
  })

  it('treats the same wall-clock time as a new day past the cutoff', async () => {
    const habit = await setup()
    const { log } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-03', outcome: 'complete' },
      fixedClock(at(2026, 9, 3, 4)),
      db,
    )
    expect(log.isBackdated).toBe(false)
    expect(log.dayKey).toBe('2026-09-03')
  })
})

describe('unlogHabit', () => {
  it('removes a log inside the window', async () => {
    const habit = await setup()
    const clock = fixedClock(at(2026, 9, 2))
    await logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' }, clock, db)
    await unlogHabit(habit.id, '2026-09-02', clock, db)
    expect(await getLog(habit.id, '2026-09-02', db)).toBeUndefined()
  })

  it('refuses to edit a day outside the window', async () => {
    const habit = await setup()
    await expect(
      unlogHabit(habit.id, '2026-08-20', fixedClock(at(2026, 9, 4)), db),
    ).rejects.toBeInstanceOf(LoggingError)
  })
})

describe('backdating refunds a spent freeze', () => {
  it('returns the token and deletes the freeze event', async () => {
    const habit = await setup('2026-09-01')

    // Build a streak on the 1st, then let the 2nd close unlogged.
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
      fixedClock(at(2026, 9, 1)),
      db,
    )
    // First rollover establishes the high-water mark and grants tokens.
    await runRollover(fixedClock(at(2026, 9, 2)), db)
    // Next day: the 2nd has closed unlogged, so a freeze covers it.
    const outcome = await runRollover(fixedClock(at(2026, 9, 3)), db)

    expect(outcome.freezesSpent).toHaveLength(1)
    expect(outcome.freezesSpent[0]?.dayKey).toBe('2026-09-02')
    const afterSpend = await requireGameState(db)

    // Now backdate the 2nd: you did do it after all.
    const { freezeRefunded } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 3)),
      db,
    )

    expect(freezeRefunded).toBe(true)
    expect((await requireGameState(db)).freezeTokens).toBe(afterSpend.freezeTokens + 1)
    expect(await listFreezeEvents(db)).toHaveLength(0)
  })

  it('does not refund for a skip', async () => {
    const habit = await setup('2026-09-01')
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
      fixedClock(at(2026, 9, 1)),
      db,
    )
    await runRollover(fixedClock(at(2026, 9, 2)), db)
    await runRollover(fixedClock(at(2026, 9, 3)), db)
    expect(await listFreezeEvents(db)).toHaveLength(1)

    const { freezeRefunded } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'skip' },
      fixedClock(at(2026, 9, 3)),
      db,
    )
    expect(freezeRefunded).toBe(false)
    expect(await listFreezeEvents(db)).toHaveLength(1)
  })
})
