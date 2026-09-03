import { describe, expect, it } from 'vitest'
import {
  describeCadenceStatus,
  describeLastDone,
  habitCadence,
  type HabitCadence,
} from '@/domain/cadence'
import type { DayKey, Habit, HabitLog, LogOutcome, Schedule } from '@/domain/types'

/*
 * 2026-09-03 is a Thursday. Every fixture below is anchored to it so the
 * weekday-sensitive cases read without arithmetic.
 */
const TODAY: DayKey = '2026-09-03'

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Write',
  category: '',
  difficulty: 2,
  schedule: { kind: 'daily' } as Schedule,
  minimumVersion: 'Open the file',
  status: 'active',
  startDayKey: '2026-08-01',
  sortOrder: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const log = (dayKey: DayKey, outcome: LogOutcome = 'complete'): HabitLog => ({
  id: `h1:${dayKey}`,
  habitId: 'h1',
  dayKey,
  outcome,
  loggedAt: 0,
  tz: 'UTC',
  isBackdated: false,
  wasFocus: false,
  xpAwarded: 10,
  rulesVersion: 'v3',
})

const cadence = (h: Habit, logs: HabitLog[], today: DayKey = TODAY): HabitCadence =>
  habitCadence({ habit: h, logs, today, weekStartsOn: 1 })

describe('last completion', () => {
  it('reports the most recent credited day', () => {
    const c = cadence(habit(), [log('2026-08-28'), log('2026-09-01'), log('2026-08-30')])
    expect(c.lastDone).toBe('2026-09-01')
    expect(c.daysSinceLastDone).toBe(2)
  })

  it('counts a partial as done — starting is the thing being rewarded', () => {
    const c = cadence(habit(), [log('2026-09-02', 'partial')])
    expect(c.lastDone).toBe('2026-09-02')
    expect(c.daysSinceLastDone).toBe(1)
  })

  it('does not count a skip as a completion', () => {
    // A skip holds the streak, but it is not a day the habit was done, and
    // saying otherwise would make "last done" a lie the user can disprove.
    const c = cadence(habit(), [log('2026-09-02', 'skip')])
    expect(c.lastDone).toBeNull()
    expect(c.daysSinceLastDone).toBeNull()
  })

  it('reports never-logged as null rather than as a zero-day gap', () => {
    const c = cadence(habit(), [])
    expect(c.lastDone).toBeNull()
    expect(c.daysSinceLastDone).toBeNull()
    expect(c.doneToday).toBe(false)
  })

  it('ignores logs dated after today', () => {
    // Should not be reachable — the backdate window only looks backwards — but
    // an imported backup from a device with a skewed clock can carry one, and
    // "last done: tomorrow" is worse than ignoring it.
    const c = cadence(habit(), [log('2026-09-10'), log('2026-08-31')])
    expect(c.lastDone).toBe('2026-08-31')
  })

  it('reports today as a zero-day gap, not as yesterday', () => {
    const c = cadence(habit(), [log(TODAY)])
    expect(c.daysSinceLastDone).toBe(0)
    expect(c.doneToday).toBe(true)
  })
})

describe('due today', () => {
  it('is true for a daily habit', () => {
    expect(cadence(habit(), []).dueToday).toBe(true)
  })

  it('follows a set-day cadence', () => {
    // Thursday is 4. A Mon/Wed habit is not on today.
    const c = cadence(habit({ schedule: { kind: 'specificDays', days: [1, 3] } }), [])
    expect(c.dueToday).toBe(false)
    expect(c.nextDue).toBe('2026-09-07') // the following Monday
  })

  it('leaves nextDue null when the habit is due today', () => {
    // "Next on Friday" beside "on for today" is noise at best and a
    // contradiction at worst.
    expect(cadence(habit(), []).nextDue).toBeNull()
  })

  it('reports an archived habit as paused, with nothing due and nothing next', () => {
    const c = cadence(
      habit({
        status: 'archived',
        archivedPeriods: [{ from: '2026-08-20', to: null }],
      }),
      [log('2026-08-19')],
    )
    expect(c.paused).toBe(true)
    expect(c.dueToday).toBe(false)
    expect(c.nextDue).toBeNull()
    // The record survives the pause. Archiving hides a habit; it does not
    // erase what was done.
    expect(c.lastDone).toBe('2026-08-19')
  })

  it('reports a habit whose start day is still ahead as not started', () => {
    const c = cadence(habit({ startDayKey: '2026-09-10' }), [])
    expect(c.notStartedYet).toBe(true)
    expect(c.dueToday).toBe(false)
  })

  it('gives up rather than looping forever when a cadence never comes round', () => {
    const c = cadence(habit({ schedule: { kind: 'specificDays', days: [] } }), [])
    expect(c.dueToday).toBe(false)
    expect(c.nextDue).toBeNull()
  })

  it('reads the cadence in force today, not a superseded one', () => {
    // Switching to weekends should not make Thursday "on for today" just
    // because the old cadence said so.
    const c = cadence(
      habit({
        schedule: { kind: 'specificDays', days: [0, 6] },
        scheduleHistory: [
          { from: '2026-08-01', schedule: { kind: 'daily' } },
          { from: '2026-09-01', schedule: { kind: 'specificDays', days: [0, 6] } },
        ],
      }),
      [],
    )
    expect(c.dueToday).toBe(false)
    expect(c.nextDue).toBe('2026-09-05') // Saturday
  })
})

describe('weekly quota', () => {
  const weekly = (target: number) =>
    habit({ schedule: { kind: 'timesPerWeek', target } })

  it('counts credited days in the current week only', () => {
    // Week of Mon 2026-08-31. The 30th is the previous week and must not count.
    const c = cadence(weekly(3), [log('2026-08-30'), log('2026-08-31'), log('2026-09-02')])
    expect(c.weekly).toMatchObject({ done: 2, target: 3, met: false })
  })

  it('reports days left inclusive of today', () => {
    // Thursday of a Monday-start week: Thu, Fri, Sat, Sun.
    expect(cadence(weekly(3), []).weekly?.daysLeft).toBe(4)
  })

  it('marks the week met once the quota is reached', () => {
    const c = cadence(weekly(2), [log('2026-08-31'), log('2026-09-01')])
    expect(c.weekly?.met).toBe(true)
  })

  it('is null for cadences with a per-day obligation', () => {
    // A "4/7 this week" line on a daily habit turns every morning into a
    // report of what is not yet done. See the note in `weeklyQuota`.
    expect(cadence(habit(), []).weekly).toBeNull()
    expect(
      cadence(habit({ schedule: { kind: 'specificDays', days: [1, 3, 5] } }), []).weekly,
    ).toBeNull()
  })

  it('does not count days before the habit existed', () => {
    // A habit created on Wednesday has not "missed" Monday and Tuesday, and a
    // stray log from before its start day must not inflate the week either.
    const late = habit({
      schedule: { kind: 'timesPerWeek', target: 3 },
      startDayKey: '2026-09-02',
    })
    const c = cadence(late, [log('2026-08-31'), log('2026-09-02')])
    expect(c.weekly?.done).toBe(1)
  })

  it('does not count days later in the week than today', () => {
    const c = cadence(weekly(3), [log('2026-08-31'), log('2026-09-05')])
    expect(c.weekly?.done).toBe(1)
  })
})

describe('copy', () => {
  it('never tells a habit with history that it has not begun', () => {
    expect(describeLastDone(null)).toBe('Not yet logged')
    expect(describeLastDone(0)).toBe('Today')
    expect(describeLastDone(1)).toBe('Yesterday')
    expect(describeLastDone(4)).toBe('4 days ago')
    expect(describeLastDone(9)).toBe('Over a week ago')
    expect(describeLastDone(21)).toBe('3 weeks ago')
    expect(describeLastDone(90)).toBe('3 months ago')
  })

  it('states the gap without editorialising about it', () => {
    // The product rule is that missing a day costs nothing. Copy that scolds
    // is a punishment mechanic wearing a statistic as a disguise.
    for (const days of [0, 1, 3, 8, 30, 200]) {
      const text = describeLastDone(days).toLowerCase()
      for (const word of ['fail', 'lost', 'broke', 'behind', 'should', 'only']) {
        expect(text).not.toContain(word)
      }
    }
  })

  it('leads with a pause, because nothing else is true while paused', () => {
    const c = cadence(
      habit({ status: 'archived', archivedPeriods: [{ from: '2026-08-20', to: null }] }),
      [],
    )
    expect(describeCadenceStatus(c, 'Monday')).toContain('Paused')
  })

  it('says the habit is handled before it says anything about the schedule', () => {
    const c = cadence(habit(), [log(TODAY)])
    expect(describeCadenceStatus(c, 'on Friday')).toBe('Logged — nothing more needed today')
  })

  it('does not print the same fact twice when a habit was done today', () => {
    // "Last done: Done today" beside "Today: Done today" reads as a bug.
    const c = cadence(habit(), [log(TODAY)])
    expect(describeLastDone(c.daysSinceLastDone)).not.toBe(describeCadenceStatus(c, ''))
  })

  it('prefers the weekly quota over "logged", since the quota already counts today', () => {
    const c = cadence(habit({ schedule: { kind: 'timesPerWeek', target: 3 } }), [
      log('2026-08-31'),
      log(TODAY),
    ])
    expect(c.doneToday).toBe(true)
    expect(describeCadenceStatus(c, '')).toBe('2 of 3 this week · 1 to go, 4 days left')
  })

  it('describes a weekly quota by what is left, not by what is missing', () => {
    const c = cadence(habit({ schedule: { kind: 'timesPerWeek', target: 3 } }), [
      log('2026-08-31'),
    ])
    expect(describeCadenceStatus(c, 'Friday')).toBe('1 of 3 this week · 2 to go, 4 days left')
  })

  it('says the week is met rather than counting the unused days', () => {
    const c = cadence(habit({ schedule: { kind: 'timesPerWeek', target: 2 } }), [
      log('2026-08-31'),
      log('2026-09-01'),
    ])
    expect(describeCadenceStatus(c, 'Friday')).toContain('already met')
  })

  it('names the next day when today is not one of them', () => {
    const c = cadence(habit({ schedule: { kind: 'specificDays', days: [1, 3] } }), [])
    expect(describeCadenceStatus(c, 'on Monday')).toBe('Not today — due on Monday')
  })

  it('says nothing about a next day when the cadence never comes round', () => {
    const c = cadence(habit({ schedule: { kind: 'specificDays', days: [] } }), [])
    expect(describeCadenceStatus(c, '')).toBe('Not scheduled')
  })
})
