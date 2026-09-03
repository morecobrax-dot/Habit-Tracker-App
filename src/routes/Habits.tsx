import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/data/db'
import { archiveHabit, unarchiveHabit } from '@/data/repos/habitRepo'
import { describeSchedule } from '@/domain/schedule'
import { DIFFICULTY_LABELS, type Habit } from '@/domain/types'
import { systemClock } from '@/services/clock'
import { useApp } from '@/state/AppContext'
import { Badge, Button, EmptyState } from '@/components/ui'
import { Gem, DEFAULT_GEM } from '@/components/icons/gems'

export function HabitsRoute() {
  const [showArchived, setShowArchived] = useState(false)

  const habits = useLiveQuery(async () => {
    const all = await db.habits.toArray()
    return all.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }, [])

  if (!habits) return <p className="py-8 text-sm text-text-faint">Loading…</p>

  const active = habits.filter((h) => h.status === 'active')
  const archived = habits.filter((h) => h.status === 'archived')

  return (
    <div className="flex flex-col gap-5 pb-6">
      <header className="flex items-baseline justify-between pt-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Habits</h1>
          <p className="mt-1 text-sm tabular-nums text-legacy-text-muted">
            {active.length === 0
              ? 'Nothing set up yet'
              : `${active.length} active${archived.length > 0 ? ` · ${archived.length} archived` : ''}`}
          </p>
        </div>
        <Link to="/habits/new">
          <Button variant="primary">New habit</Button>
        </Link>
      </header>

      {active.length === 0 ? (
        <EmptyState
          title="Start with one"
          body="Pick the thing you've been putting off, and write down the two-minute version of it. That fallback is what you'll reach for on bad days."
          action={
            <Link to="/habits/new">
              <Button variant="primary">Add your first habit</Button>
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {active.map((habit) => (
            <HabitRow key={habit.id} habit={habit} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-2 self-start text-sm text-legacy-text-muted hover:text-text"
            aria-expanded={showArchived}
          >
            <span aria-hidden className={showArchived ? 'rotate-90 transition' : 'transition'}>
              ›
            </span>
            Archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="flex flex-col gap-2.5">
              {archived.map((habit) => (
                <HabitRow key={habit.id} habit={habit} archived />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function HabitRow({ habit, archived = false }: { habit: Habit; archived?: boolean }) {
  const navigate = useNavigate()
  const { today } = useApp()
  const [busy, setBusy] = useState(false)

  const toggleArchive = async () => {
    setBusy(true)
    try {
      const context = { todayKey: today, instant: systemClock.now() }
      if (archived) await unarchiveHabit(habit.id, context)
      else await archiveHabit(habit.id, context)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      className={[
        'rounded-2xl border border-line bg-legacy-surface transition-colors',
        archived ? 'opacity-55' : 'hover:border-line-strong',
      ].join(' ')}
    >
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 shrink-0">
          <Gem id={habit.icon ?? DEFAULT_GEM} size={24} />
        </span>

        <button
          type="button"
          onClick={() => navigate(`/habits/${habit.id}/edit`)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate font-medium text-text">{habit.name}</p>
          <p className="mt-0.5 text-xs text-legacy-text-muted">
            {describeSchedule(habit.schedule)}
            {habit.category && ` · ${habit.category}`}
            {` · ${DIFFICULTY_LABELS[habit.difficulty]}`}
          </p>
          {/*
            The minimum version is shown on the card, not hidden behind an edit
            screen. On a bad day the user needs to see the small version without
            having to go looking for it.
          */}
          <p className="mt-2 text-xs leading-relaxed text-text-faint">
            <span className="text-legacy-text-muted">Bad day:</span> {habit.minimumVersion}
          </p>
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {habit.estimatedMinutes !== undefined && (
            <Badge><span className="tabular-nums">{habit.estimatedMinutes}</span> min</Badge>
          )}
          <Button
            variant="ghost"
            onClick={toggleArchive}
            disabled={busy}
            aria-label={archived ? `Restore ${habit.name}` : `Archive ${habit.name}`}
            className="min-h-9 px-2 text-xs"
          >
            {archived ? 'Restore' : 'Archive'}
          </Button>
        </div>
      </div>
    </li>
  )
}
