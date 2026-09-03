import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/data/db'
import { archiveHabit, reorderHabits, unarchiveHabit } from '@/data/repos/habitRepo'
import { describeSchedule } from '@/domain/schedule'
import { DIFFICULTY_LABELS, type Habit } from '@/domain/types'
import { systemClock } from '@/services/clock'
import { useApp } from '@/state/AppContext'
import { Badge, Button, EmptyState } from '@/components/ui'
import { HabitListSkeleton } from '@/components/Skeleton'
import { DragHandle, Reorderable, type HandleProps } from '@/components/Reorderable'
import { Gem, DEFAULT_GEM } from '@/components/icons/gems'

/**
 * The list of habits: reorder them, archive them, open one.
 *
 * Order matters beyond this screen — it is the order habits appear under
 * "Also today" on the home page — which is why reordering is a first-class
 * gesture here rather than a setting.
 */
export function HabitsRoute() {
  const [showArchived, setShowArchived] = useState(false)

  const habits = useLiveQuery(async () => {
    const all = await db.habits.toArray()
    return all.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }, [])

  if (!habits) return <HabitListSkeleton />

  const active = habits.filter((h) => h.status === 'active')
  const archived = habits.filter((h) => h.status === 'archived')

  const persistOrder = (orderedIds: string[]) => {
    void reorderHabits(orderedIds, systemClock.now())
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <header className="flex items-baseline justify-between gap-3 pt-2">
        <div className="min-w-0">
          <h1 className="text-title font-semibold tracking-tight text-text-primary">Habits</h1>
          <p className="mt-1 text-small tabular-nums text-text-muted">
            {active.length === 0
              ? 'Nothing set up yet'
              : `${active.length} active${archived.length > 0 ? ` · ${archived.length} archived` : ''}`}
          </p>
        </div>
        <Link to="/habits/new" className="shrink-0">
          <Button variant="primary">New habit</Button>
        </Link>
      </header>

      {active.length === 0 ? (
        <EmptyState
          title={archived.length > 0 ? 'Nothing active right now' : 'Start with one'}
          body={
            archived.length > 0
              ? "Everything you have is archived, which is a perfectly fine place to be. Restore one when you're ready, or add something new."
              : "Pick the thing you've been putting off, and write down the two-minute version of it. That fallback is what you'll reach for on bad days."
          }
          action={
            <Link to="/habits/new">
              <Button variant="primary">
                {archived.length > 0 ? 'Add a habit' : 'Add your first habit'}
              </Button>
            </Link>
          }
        />
      ) : (
        <Reorderable
          items={active}
          keyOf={(habit) => habit.id}
          labelOf={(habit) => habit.name}
          onReorder={persistOrder}
        >
          {(habit, handle, state) => (
            <HabitCard habit={habit} handle={handle} dragging={state.dragging} />
          )}
        </Reorderable>
      )}

      {active.length > 1 && (
        <p className="px-1 text-micro text-text-muted">
          Drag the handle to reorder, or focus it and use the arrow keys. This order is the
          order they appear under today's habits.
        </p>
      )}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex min-h-11 items-center gap-2 self-start text-small text-text-secondary transition-colors hover:text-text-primary"
            aria-expanded={showArchived}
          >
            <span
              aria-hidden
              className={[
                'inline-block transition-transform duration-fast',
                showArchived ? 'rotate-90' : '',
              ].join(' ')}
            >
              ›
            </span>
            Archived ({archived.length})
          </button>
          {showArchived && (
            <>
              <p className="px-1 text-micro leading-relaxed text-text-muted">
                Archiving is a pause, not a loss. These days count as not-scheduled, so they
                cannot break a streak — restoring one picks up where it left off.
              </p>
              <ul className="flex flex-col gap-2.5">
                {archived.map((habit) => (
                  <li key={habit.id}>
                    <HabitCard habit={habit} archived />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function HabitCard({
  habit,
  handle,
  dragging = false,
  archived = false,
}: {
  habit: Habit
  handle?: HandleProps
  dragging?: boolean
  archived?: boolean
}) {
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
    <div
      className={[
        'rounded-card border bg-surface transition-all duration-fast',
        // Archived rows deliberately skip the raised depth: a paused habit
        // should sit back into the page rather than stand on it.
        archived
          ? 'border-border opacity-55'
          : 'surface-raised border-border hover:border-border-interactive/60',
        // Lifted rather than tinted while dragging: the row is being *moved*,
        // not completed, and red would say "earned".
        dragging ? 'border-border-interactive shadow-card' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-2 p-3">
        {handle && <DragHandle handle={handle} dragging={dragging} />}

        <span className={handle ? 'mt-2.5 shrink-0' : 'mt-1 ml-1.5 shrink-0'}>
          <Gem id={habit.icon ?? DEFAULT_GEM} size={24} />
        </span>

        <button
          type="button"
          onClick={() => navigate(`/habits/${habit.id}`)}
          className="min-w-0 flex-1 py-1 text-left"
        >
          <p className="truncate text-body font-medium text-text-primary">{habit.name}</p>
          <p className="mt-0.5 text-micro text-text-secondary">
            {describeSchedule(habit.schedule)}
            {habit.category && ` · ${habit.category}`}
            {` · ${DIFFICULTY_LABELS[habit.difficulty]}`}
          </p>
          {/*
            The minimum version is shown on the card, not hidden behind an edit
            screen. On a bad day the user needs to see the small version without
            having to go looking for it.
          */}
          <p className="mt-2 text-micro leading-relaxed text-text-muted">
            <span className="text-text-secondary">Bad day:</span> {habit.minimumVersion}
          </p>
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {habit.estimatedMinutes !== undefined && (
            <Badge>
              <span className="tabular-nums">{habit.estimatedMinutes}</span> min
            </Badge>
          )}
          <Button
            variant="ghost"
            onClick={toggleArchive}
            disabled={busy}
            aria-label={archived ? `Restore ${habit.name}` : `Archive ${habit.name}`}
            className="px-2 text-micro"
          >
            {archived ? 'Restore' : 'Archive'}
          </Button>
        </div>
      </div>
    </div>
  )
}
