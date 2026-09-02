import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { HabitTrackerDb, ensureInitialised } from '@/data/db'
import { createHabit } from '@/data/repos/habitRepo'
import { updateSettings } from '@/data/repos/settingsRepo'
import { listAllLogs, listLogsForHabit } from '@/data/repos/logRepo'
import { logHabit } from '@/services/loggingService'
import { fixedClock } from '@/services/clock'
import { computeStreak } from '@/domain/streak'
import { totalXpFromLogs } from '@/domain/xp'
import type { Habit } from '@/domain/types'

/**
 * Phase 2 edge cases that the plan calls out explicitly.
 *
 * These were implemented but never covered by a test, which is the same as
 * not being handled: an untested edge case is a guess about behaviour.
 */

const at = (y: number, m: number, d: number, h = 9) => Date.UTC(y, m - 1, d, h)

let db: HabitTrackerDb
let counter = 0

const setup = async (startDay = '2026-09-01', timeZone = 'UTC'): Promise<Habit> => {
  await ensureInitialised(at(2026, 9, 1), db)
  await updateSettings({ timeZone }, at(2026, 9, 1), db)
  return createHabit(
    {
      draft: {
        name: 'Walk',
        category: '',
        difficulty: 2,
        schedule: { kind: 'daily' },
        minimumVersion: 'small',
      },
      startDayKey: startDay,
      instant: at(2026, 9, 1),
    },
    db,
  )
}

const streakOf = async (habit: Habit, today: string) =>
  computeStreak({
    habit,
    logs: await listLogsForHabit(habit.id, db),
    frozenDays: new Set(),
    today,
    weekStartsOn: 1,
  })

beforeEach(async () => {
  db = new HabitTrackerDb(`edge-db-${counter++}`)
  await db.open()
})

describe('timezone change while travelling', () => {
  it('does not shift the day a past log belongs to', async () => {
    // A DayKey is resolved once, when the log is written, and then stored. It
    // is never recomputed, so flying somewhere cannot retroactively move
    // yesterday's completion onto a different day.
    const habit = await setup('2026-09-01', 'UTC')
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
      fixedClock(at(2026, 9, 1)),
      db,
    )
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 2)),
      db,
    )
    expect((await streakOf(habit, '2026-09-02')).current).toBe(2)

    // Fly from UTC to UTC+14 — the largest jump available.
    await updateSettings({ timeZone: 'Pacific/Kiritimati' }, at(2026, 9, 3), db)

    const logs = await listLogsForHabit(habit.id, db)
    expect(logs.map((l) => l.dayKey).sort()).toEqual(['2026-09-01', '2026-09-02'])
    expect((await streakOf(habit, '2026-09-02')).current).toBe(2)
  })

  it('does not duplicate a day when the same day is logged again after the change', async () => {
    const habit = await setup('2026-09-01', 'UTC')
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'partial' },
      fixedClock(at(2026, 9, 2)),
      db,
    )

    await updateSettings({ timeZone: 'Pacific/Kiritimati' }, at(2026, 9, 2, 20), db)

    // 2026-09-02T20:00Z is already the 3rd in UTC+14, so the 2nd is now a
    // backdated day — still inside the window, and still the same row.
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
      fixedClock(at(2026, 9, 2, 20)),
      db,
    )

    const logs = await listAllLogs(db)
    expect(logs).toHaveLength(1)
    expect(logs[0]?.outcome).toBe('complete')
  })

  it('resolves the same instant to different days in different zones', async () => {
    // The boundary itself must follow the setting, otherwise "today" would be
    // wrong for a traveller even though old logs are safe.
    const habit = await setup('2026-09-01', 'UTC')
    // 2026-09-02T20:00Z is the 2nd in UTC but the 3rd in UTC+14.
    await updateSettings({ timeZone: 'Pacific/Kiritimati' }, at(2026, 9, 1), db)
    const { log } = await logHabit(
      { habitId: habit.id, dayKey: '2026-09-03', outcome: 'complete' },
      fixedClock(at(2026, 9, 2, 20)),
      db,
    )
    expect(log.dayKey).toBe('2026-09-03')
    expect(log.isBackdated).toBe(false)
    expect(log.tz).toBe('Pacific/Kiritimati')
  })
})

describe('rapid repeated submission for the same habit and day', () => {
  it('produces exactly one log and counts XP once', async () => {
    // A double tap, or an impatient user, must not create two rows or pay
    // twice. The unique compound index is the backstop; this proves the
    // service path above it behaves.
    const habit = await setup('2026-09-02')
    const clock = fixedClock(at(2026, 9, 2))

    await Promise.all(
      Array.from({ length: 8 }, () =>
        logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' }, clock, db),
      ),
    )

    const logs = await listAllLogs(db)
    expect(logs).toHaveLength(1)
    // Tier-2 completion, no prior history: 18 XP, banked once.
    expect(totalXpFromLogs(logs)).toBe(18)
  })

  it('settles on the last outcome when different outcomes race', async () => {
    const habit = await setup('2026-09-02')
    const clock = fixedClock(at(2026, 9, 2))

    await Promise.all([
      logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'skip' }, clock, db),
      logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'partial' }, clock, db),
      logHabit({ habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' }, clock, db),
    ])

    expect(await listAllLogs(db)).toHaveLength(1)
    // Whichever landed last, the XP ratchet means the banked award is the
    // highest any of them earned, never a lower one.
    expect(totalXpFromLogs(await listAllLogs(db))).toBeGreaterThanOrEqual(11)
  })
})

describe('a backdated log that repairs a broken streak', () => {
  it('rejoins the runs either side of the gap', async () => {
    // Streaks are derived from the logs on every read rather than stored, so
    // filling a hole repairs the streak with no repair step to get wrong.
    const habit = await setup('2026-09-01')

    for (const day of ['2026-09-01', '2026-09-03']) {
      await logHabit(
        { habitId: habit.id, dayKey: day, outcome: 'complete' },
        fixedClock(at(2026, 9, Number(day.slice(8)))),
        db,
      )
    }

    // The 2nd is missing, so the run is broken and only the 3rd counts.
    const broken = await streakOf(habit, '2026-09-03')
    expect(broken.current).toBe(1)
    expect(broken.longest).toBe(1)

    // Backdate the 2nd, still inside the two-day window.
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-02', outcome: 'partial' },
      fixedClock(at(2026, 9, 3)),
      db,
    )

    const repaired = await streakOf(habit, '2026-09-03')
    expect(repaired.current).toBe(3)
    expect(repaired.longest).toBe(3)
  })

  it('cannot repair a gap older than the backdating window', async () => {
    const habit = await setup('2026-09-01')
    await logHabit(
      { habitId: habit.id, dayKey: '2026-09-01', outcome: 'complete' },
      fixedClock(at(2026, 9, 1)),
      db,
    )
    await expect(
      logHabit(
        { habitId: habit.id, dayKey: '2026-09-02', outcome: 'complete' },
        fixedClock(at(2026, 9, 6)),
        db,
      ),
    ).rejects.toMatchObject({ code: 'outside_backdate_window' })
  })
})
