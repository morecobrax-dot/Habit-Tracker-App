import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { DayKey, LogOutcome, PartialKind } from '@/domain/types'
import { backdatableDays, diffDays } from '@/domain/time/dayKey'
import { LoggingError, logHabit, unlogHabit } from '@/services/loggingService'
import { systemClock } from '@/services/clock'
import { useApp } from '@/state/AppContext'
import { useDayView, type DayEntry } from '@/state/useDayView'
import { Button, EmptyState } from '@/components/ui'

export function TodayRoute() {
  const { today, settings, lastRollover, dismissRollover } = useApp()
  const [selectedDay, setSelectedDay] = useState<DayKey>(today)
  const [error, setError] = useState<string | null>(null)

  const days = backdatableDays(today, settings.backdateWindowDays)
  const view = useDayView(selectedDay)

  // If the day rolls over while the app is open, follow it.
  const activeDay = days.includes(selectedDay) ? selectedDay : today

  return (
    <div className="flex flex-col gap-4 pb-6">
      <header className="flex items-baseline justify-between pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        {view.freezeTokens > 0 && (
          <span className="text-xs text-text-muted" title="Freeze tokens protect a streak on a missed day">
            {view.freezeTokens} freeze{view.freezeTokens === 1 ? '' : 's'} banked
          </span>
        )}
      </header>

      {lastRollover && <RolloverNotice onDismiss={dismissRollover} />}

      {days.length > 1 && (
        <div className="flex gap-1 rounded-xl border border-line bg-surface-raised p-1">
          {days.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={day === activeDay}
              onClick={() => {
                setSelectedDay(day)
                setError(null)
              }}
              className={[
                'flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors',
                day === activeDay ? 'bg-brand text-white' : 'text-text-muted hover:bg-surface-hover',
              ].join(' ')}
            >
              {relativeDayLabel(day, today)}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger-dim px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {view.loading ? (
        <p className="py-8 text-sm text-text-faint">Loading…</p>
      ) : view.entries.length === 0 ? (
        <DayEmptyState
          activeHabitCount={view.activeHabitCount}
          notYetExistingCount={view.notYetExistingCount}
          isPast={activeDay !== today}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {view.entries.map((entry) => (
            <LogCard
              key={entry.habit.id}
              entry={entry}
              day={activeDay}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Explains *why* a day is blank.
 *
 * A past day is usually empty because the habits did not exist yet, not because
 * you have none. Showing "add your first habit" there is misleading, and on a
 * backdating screen it reads as though logs have been lost.
 */
function DayEmptyState({
  activeHabitCount,
  notYetExistingCount,
  isPast,
}: {
  activeHabitCount: number
  notYetExistingCount: number
  isPast: boolean
}) {
  if (activeHabitCount === 0) {
    return (
      <EmptyState
        title="No habits yet"
        body="Start with the thing you've been putting off, and write down the two-minute version of it."
        action={
          <Link to="/habits/new">
            <Button variant="primary">Add your first habit</Button>
          </Link>
        }
      />
    )
  }

  if (isPast && notYetExistingCount === activeHabitCount) {
    return (
      <EmptyState
        title="Nothing to log here"
        body="Your habits didn't exist yet on this day, so there's nothing to backdate. Nothing is missing."
      />
    )
  }

  return (
    <EmptyState
      title="Nothing due"
      body="No habits are scheduled for this day. That's a rest day, not a miss — nothing is lost."
    />
  )
}

function RolloverNotice({ onDismiss }: { onDismiss: () => void }) {
  const { lastRollover } = useApp()
  if (!lastRollover) return null
  const { freezesSpent, streaksBroken } = lastRollover

  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2.5">
      <div className="flex-1 text-xs leading-relaxed text-text-muted">
        {freezesSpent.length > 0 && (
          <p>
            <span className="text-text">
              {freezesSpent.length} streak{freezesSpent.length === 1 ? '' : 's'} kept
            </span>{' '}
            by spending a freeze token while you were away.
          </p>
        )}
        {streaksBroken.length > 0 && (
          <p className={freezesSpent.length > 0 ? 'mt-1' : ''}>
            {streaksBroken.length} streak{streaksBroken.length === 1 ? '' : 's'} ended — no tokens
            left. Nothing else was lost.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-text-faint hover:text-text"
      >
        ✕
      </button>
    </div>
  )
}

function LogCard({
  entry,
  day,
  onError,
}: {
  entry: DayEntry
  day: DayKey
  onError: (message: string | null) => void
}) {
  const { habit, log, streak, frozenToday } = entry
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    onError(null)
    try {
      await fn()
    } catch (e) {
      onError(e instanceof LoggingError ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const record = (outcome: LogOutcome, partialKind?: PartialKind) =>
    run(() =>
      logHabit(
        { habitId: habit.id, dayKey: day, outcome, partialKind },
        systemClock,
      ),
    )

  const clear = () => run(() => unlogHabit(habit.id, day, systemClock))

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text">{habit.name}</p>
          <p className="mt-0.5 text-xs text-text-faint">
            <StreakLabel streak={streak} />
            {frozenToday && ' · covered by a freeze'}
          </p>
        </div>
        {log && <OutcomeBadge outcome={log.outcome} partialKind={log.partialKind} />}
      </div>

      {log ? (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="ghost" onClick={clear} disabled={busy} className="min-h-9 px-2 text-xs">
            Undo
          </Button>
          {log.outcome !== 'complete' && (
            <Button
              variant="secondary"
              onClick={() => record('complete')}
              disabled={busy}
              className="min-h-9 px-3 text-xs"
            >
              Mark done
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <Button variant="primary" full onClick={() => record('complete')} disabled={busy}>
            Done
          </Button>
          {/*
            The minimum version is a first-class button with its own text, not a
            hidden fallback. On a bad day the small version has to be the
            easiest thing on screen to tap.
          */}
          <Button
            variant="secondary"
            full
            onClick={() => record('partial', 'minimum')}
            disabled={busy}
            className="h-auto min-h-11 py-2 text-left"
          >
            <span className="flex flex-col items-start gap-0.5">
              <span className="text-xs text-text-muted">Did the minimum</span>
              <span className="text-sm font-normal text-text">{habit.minimumVersion}</span>
            </span>
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={() => record('partial', 'other')}
              disabled={busy}
              className="min-h-10 flex-1 text-xs"
            >
              Partial
            </Button>
            <Button
              variant="ghost"
              onClick={() => record('skip')}
              disabled={busy}
              className="min-h-10 flex-1 text-xs"
            >
              Skip
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function StreakLabel({ streak }: { streak: DayEntry['streak'] }) {
  const unit = streak.unit === 'week' ? 'week' : 'day'
  const parts: string[] = []

  if (streak.current > 0) {
    parts.push(`${streak.current} ${unit}${streak.current === 1 ? '' : 's'} in a row`)
  } else {
    parts.push('No streak yet')
  }

  if (streak.unit === 'week' && streak.progress.target > 0) {
    parts.push(`${streak.progress.done}/${streak.progress.target} this week`)
  }

  if (streak.longest > streak.current) parts.push(`best ${streak.longest}`)

  return <>{parts.join(' · ')}</>
}

function OutcomeBadge({
  outcome,
  partialKind,
}: {
  outcome: LogOutcome
  partialKind?: PartialKind | undefined
}) {
  const label =
    outcome === 'complete'
      ? 'Done'
      : outcome === 'partial'
        ? partialKind === 'minimum'
          ? 'Minimum'
          : 'Partial'
        : 'Skipped'

  const tone =
    outcome === 'complete'
      ? 'text-tier-2 border-tier-2/40'
      : outcome === 'partial'
        ? 'text-tier-3 border-tier-3/40'
        : 'text-text-faint border-line'

  return (
    <span className={`shrink-0 rounded-md border px-2 py-1 text-xs ${tone}`}>{label}</span>
  )
}

function relativeDayLabel(day: DayKey, today: DayKey): string {
  const delta = diffDays(day, today)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Yesterday'
  return `${delta} days ago`
}
