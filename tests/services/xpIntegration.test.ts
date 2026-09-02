import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { HabitTrackerDb, ensureInitialised } from '@/data/db'
import { createHabit } from '@/data/repos/habitRepo'
import { updateSettings } from '@/data/repos/settingsRepo'
import { listAllLogs } from '@/data/repos/logRepo'
import { claimFocus, getFocus, newFocus } from '@/data/repos/focusRepo'
import { logHabit, unlogHabit } from '@/services/loggingService'
import { ensureDailyFocus } from '@/services/focusService'
import { fixedClock } from '@/services/clock'
import { totalXpFromLogs } from '@/domain/xp'
import { levelForXp } from '@/domain/level'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import { importBackup, parseBackup, exportBackup } from '@/data/backup'
import type { Habit, Schedule } from '@/domain/types'

const at = (y: number, m: number, d: number, h = 9) => Date.UTC(y, m - 1, d, h)

let db: HabitTrackerDb
let counter = 0

const setup = async (
  startDay = '2026-09-01',
  schedule: Schedule = { kind: 'daily' },
  difficulty: 1 | 2 | 3 | 4 = 2,
  name = 'Walk',
): Promise<Habit> => {
  await ensureInitialised(at(2026, 9, 1), db)
  await updateSettings({ timeZone: 'UTC' }, at(2026, 9, 1), db)
  return createHabit(
    {
      draft: { name, category: '', difficulty, schedule, minimumVersion: 'small' },
      startDayKey: startDay,
      instant: at(2026, 9, 1),
    },
    db,
  )
}

const totalXp = async () => totalXpFromLogs(await listAllLogs(db))

beforeEach(async () => {
  db = new HabitTrackerDb(`xp-db-${counter++}`)
  await db.open()
})

describe('XP is banked on the log', () => {
  it('awards and snapshots the breakdown', async () => {
    const habit = await setup('2026-09-02', { kind: 'daily' }, 3)
    const { log, award, xpGained } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 2)),
      db,
    )

    expect(log.xpAwarded).toBe(30)
    expect(xpGained).toBe(30)
    expect(log.rulesVersion).toBe('v1')
    expect(log.xpBreakdown).toMatchObject({ base: 30, completionFactor: 1 })
    expect(award.total).toBe(30)
    expect(await totalXp()).toBe(30)
  })

  it('derives the running total from the logs', async () => {
    const habit = await setup('2026-09-01', { kind: 'daily' }, 2)
    for (const day of ['2026-09-01', '2026-09-02', '2026-09-03']) {
      await logHabit(
        { habitId: habit.id, dayKey: day, outcome: 'complete' },
        fixedClock(at(2026, 9, Number(day.slice(8)))),
        db,
      )
    }
    const logs = await listAllLogs(db)
    const summed = logs.reduce((acc, l) => acc + l.xpAwarded, 0)
    expect(await totalXp()).toBe(summed)
    expect(summed).toBeGreaterThan(0)
  })
})

describe('XP never decreases through the system', () => {
  it('pays the difference when a partial is upgraded to a complete', async () => {
    const habit = await setup('2026-09-02', { kind: 'daily' }, 3)
    const clock = fixedClock(at(2026, 9, 2))

    const first = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'partial', partialKind: 'minimum' },
      clock,
      db,
    )
    expect(first.xpGained).toBe(18)

    const second = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      clock,
      db,
    )
    expect(second.xpGained).toBe(12)
    expect(await totalXp()).toBe(30)
  })

  it('keeps banked XP when a completion is downgraded to a skip', async () => {
    // The system never reclaims. Changing your mind about how the day went does
    // not take back what was already earned.
    const habit = await setup('2026-09-02', { kind: 'daily' }, 3)
    const clock = fixedClock(at(2026, 9, 2))

    await logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' }, clock, db)
    const after = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'skip' },
      clock,
      db,
    )

    expect(after.xpGained).toBe(0)
    expect(after.log.outcome).toBe('skip')
    expect(after.log.xpAwarded).toBe(30)
    expect(await totalXp()).toBe(30)
  })

  it('cannot be farmed by re-logging the same day', async () => {
    const habit = await setup('2026-09-02', { kind: 'daily' }, 3)
    const clock = fixedClock(at(2026, 9, 2))
    for (let i = 0; i < 5; i++) {
      await logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' }, clock, db)
    }
    expect(await totalXp()).toBe(30)
    expect(await db.logs.count()).toBe(1)
  })

  it('removes the XP when the user explicitly undoes a log', async () => {
    // Undo is the user retracting their own entry, not the system punishing
    // them — and without it, log/undo/re-log would mint XP indefinitely.
    const habit = await setup('2026-09-02', { kind: 'daily' }, 3)
    const clock = fixedClock(at(2026, 9, 2))

    await logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' }, clock, db)
    expect(await totalXp()).toBe(30)

    await unlogHabit(habit.id, '2026-09-02', clock, db)
    expect(await totalXp()).toBe(0)

    await logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' }, clock, db)
    expect(await totalXp()).toBe(30)
  })

  it('never lets the level go down across a realistic sequence', async () => {
    const habit = await setup('2026-09-01', { kind: 'daily' }, 4)
    let previousLevel = 1

    for (const [day, outcome] of [
      ['2026-09-01', 'complete'],
      ['2026-09-02', 'partial'],
      ['2026-09-03', 'skip'],
      ['2026-09-04', 'complete'],
      ['2026-09-05', 'complete'],
    ] as const) {
      await logHabit(
        { habitId: habit.id, dayKey: day, outcome },
        fixedClock(at(2026, 9, Number(day.slice(8)))),
        db,
      )
      const level = levelForXp(await totalXp(), DEFAULT_XP_RULES).level
      expect(level).toBeGreaterThanOrEqual(previousLevel)
      previousLevel = level
    }
  })
})

describe('focus bonus through the full stack', () => {
  it('pays the bonus when the focus habit is logged', async () => {
    const habit = await setup('2026-09-02', { kind: 'daily' }, 1)
    await claimFocus(newFocus('2026-09-02', habit.id, 10, at(2026, 9, 2)), db)

    const { log, wasFocus } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 2)),
      db,
    )

    expect(wasFocus).toBe(true)
    expect(log.wasFocus).toBe(true)
    expect(log.xpAwarded).toBe(10 + 25)
  })

  it('pays the full bonus for the minimum version', async () => {
    const habit = await setup('2026-09-02', { kind: 'daily' }, 1)
    await claimFocus(newFocus('2026-09-02', habit.id, 10, at(2026, 9, 2)), db)

    const { log } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'partial', partialKind: 'minimum' },
      fixedClock(at(2026, 9, 2)),
      db,
    )
    expect(log.xpAwarded).toBe(6 + 25)
  })

  it('does not pay the bonus to a non-focus habit', async () => {
    const focusHabit = await setup('2026-09-02', { kind: 'daily' }, 1, 'Focus one')
    const other = await createHabit(
      {
        draft: { name: 'Other', category: '', difficulty: 1, schedule: { kind: 'daily' }, minimumVersion: 's' },
        startDayKey: '2026-09-02',
        instant: at(2026, 9, 2),
      },
      db,
    )
    await claimFocus(newFocus('2026-09-02', focusHabit.id, 10, at(2026, 9, 2)), db)

    const { log } = await logHabit(
      { habitId: other.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 2)),
      db,
    )
    expect(log.xpAwarded).toBe(10)
  })

  it('marks the focus resolved', async () => {
    const habit = await setup('2026-09-02', { kind: 'daily' }, 1)
    await claimFocus(newFocus('2026-09-02', habit.id, 10, at(2026, 9, 2)), db)

    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'partial' },
      fixedClock(at(2026, 9, 2)),
      db,
    )
    expect((await getFocus('2026-09-02', db))?.resolved).toBe('partial')
  })

  it('honours a backdated focus from an earlier day', async () => {
    const habit = await setup('2026-09-01')
    await claimFocus(newFocus('2026-09-02', habit.id, 10, at(2026, 9, 2)), db)

    const { log } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 3)),
      db,
    )
    // Doing yesterday's focus habit late still counts as doing it.
    expect(log.wasFocus).toBe(true)
    expect(log.xpAwarded).toBeGreaterThan(18)
  })
})

describe('ensureDailyFocus', () => {
  it('chooses and persists a focus', async () => {
    const habit = await setup('2026-09-01')
    const focus = await ensureDailyFocus(fixedClock(at(2026, 9, 2)), db)
    expect(focus?.habitId).toBe(habit.id)
    expect(await getFocus('2026-09-02', db)).toBeDefined()
  })

  it('is stable across repeated calls in the same day', async () => {
    // A focus that reshuffled on refresh would be untrustworthy within a day.
    await setup('2026-09-01', { kind: 'daily' }, 1, 'A')
    await createHabit(
      {
        draft: { name: 'B', category: '', difficulty: 4, schedule: { kind: 'daily' }, minimumVersion: 's' },
        startDayKey: '2026-09-01',
        instant: at(2026, 9, 1),
      },
      db,
    )
    const clock = fixedClock(at(2026, 9, 2))
    const first = await ensureDailyFocus(clock, db)

    // Log the chosen habit, which would change its neglect score.
    await logHabit(
      { habitId: first!.habitId, dayKey: '2026-09-02', outcome: 'complete' },
      clock,
      db,
    )

    const second = await ensureDailyFocus(clock, db)
    expect(second?.habitId).toBe(first?.habitId)
    expect(await db.dailyFocus.count()).toBe(1)
  })

  it('returns null when no habit is due', async () => {
    await ensureInitialised(at(2026, 9, 1), db)
    await updateSettings({ timeZone: 'UTC' }, at(2026, 9, 1), db)
    expect(await ensureDailyFocus(fixedClock(at(2026, 9, 2)), db)).toBeNull()
  })
})

describe('data safety of the derived-XP change', () => {
  it('imports a pre-Phase-3 backup that still carries gameState.totalXp', async () => {
    // Total XP used to be stored on gameState. Old backups still contain it.
    // It is a non-indexed field, so the row imports cleanly and the stale value
    // is simply never read — no migration, no data loss.
    await ensureInitialised(at(2026, 9, 1), db)

    const legacy = JSON.stringify({
      format: 'habit-tracker-backup',
      version: 1,
      dbVersion: 1,
      exportedAt: at(2026, 9, 1),
      tables: {
        habits: [
          {
            id: 'legacy-habit',
            name: 'Old habit',
            category: '',
            difficulty: 2,
            schedule: { kind: 'daily' },
            minimumVersion: 'small',
            status: 'active',
            startDayKey: '2026-08-01',
            sortOrder: 1,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        logs: [
          {
            id: 'legacy-log',
            habitId: 'legacy-habit',
            dayKey: '2026-08-02',
            outcome: 'complete',
            loggedAt: 0,
            tz: 'UTC',
            isBackdated: false,
            wasFocus: false,
            xpAwarded: 18,
            rulesVersion: 'none',
          },
        ],
        dailyFocus: [],
        freezeEvents: [],
        gameState: [
          {
            id: 'singleton',
            totalXp: 9999,
            freezeTokens: 2,
            lastFreezeGrantWeekKey: null,
            lastRolloverDayKey: null,
            createdAt: 0,
          },
        ],
        settings: [],
      },
    })

    await importBackup(parseBackup(legacy), db)

    expect(await db.habits.count()).toBe(1)
    // The derived total comes from the logs, not the stale stored figure.
    expect(await totalXp()).toBe(18)
    expect((await db.gameState.get('singleton'))?.freezeTokens).toBe(2)
  })

  it('round-trips a Phase 3 backup with XP intact', async () => {
    const habit = await setup('2026-09-02', { kind: 'daily' }, 3)
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 2)),
      db,
    )
    const before = await totalXp()

    const backup = parseBackup(JSON.stringify(await exportBackup(at(2026, 9, 3), db)))
    const restored = new HabitTrackerDb(`xp-restore-${counter++}`)
    await restored.open()
    await importBackup(backup, restored)

    expect(totalXpFromLogs(await listAllLogs(restored))).toBe(before)
  })

  it('survives a log row with a missing xpAwarded', async () => {
    // Corrupted or hand-edited data must not produce NaN XP or a nonsense level.
    await ensureInitialised(at(2026, 9, 1), db)
    await db.logs.add({
      id: 'broken',
      habitId: 'ghost',
      dayKey: '2026-09-02',
      outcome: 'complete',
      loggedAt: 0,
      tz: 'UTC',
      isBackdated: false,
      wasFocus: false,
      xpAwarded: Number.NaN,
      rulesVersion: 'v1',
    })
    const total = totalXpFromLogs(await listAllLogs(db))
    const level = levelForXp(total, DEFAULT_XP_RULES)
    expect(level.level).toBeGreaterThanOrEqual(1)
    expect(level.level).toBeLessThan(10)
  })
})
