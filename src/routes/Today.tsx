import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DayKey, LogOutcome, PartialKind } from '@/domain/types'
import { backdatableDays, diffDays } from '@/domain/time/dayKey'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import { LoggingError, logHabit, unlogHabit } from '@/services/loggingService'
import { ensureDailyFocus } from '@/services/focusService'
import { systemClock } from '@/services/clock'
import { useApp } from '@/state/AppContext'
import { useDayView, type DayEntry } from '@/state/useDayView'
import { Button, EmptyState } from '@/components/ui'

/**
 * The screen the app opens on.
 *
 * It is built to answer one question — "what should I start right now?" — and
 * the layout enforces that hierarchy: level and progress are a thin strip, the
 * focus habit is the hero, and everything else is a quiet list. Statistics that
 * do not change what the user does next are deliberately absent.
 */
export function TodayRoute() {
  const { today, settings, lastRollover, dismissRollover } = useApp()
  const [selectedDay, setSelectedDay] = useState<DayKey>(today)
  const [error, setError] = useState<string | null>(null)
  const [gain, setGain] = useState<{ xp: number; at: number } | null>(null)

  const days = backdatableDays(today, settings.backdateWindowDays)
  const activeDay = days.includes(selectedDay) ? selectedDay : today
  const view = useDayView(activeDay)

  useEnsureFocus(today, view)

  const noteGain = (xp: number) => {
    if (xp > 0) setGain({ xp, at: Date.now() })
  }

  return (
    <div className="flex flex-col gap-5 pb-4">
      <LevelStrip level={view.level} gain={gain} freezeTokens={view.freezeTokens} />

      {lastRollover && <RolloverNotice onDismiss={dismissRollover} />}

      {/*
        Viewing a past day is a mode, so it gets an unmissable banner. Today —
        the overwhelmingly common case — gets nothing here at all, because the
        answer to "what do I start now?" must be the first thing on the screen.
      */}
      {activeDay !== today && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-dim/40 px-3.5 py-2.5">
          <span className="text-xs font-medium text-brand-strong">
            Logging {relativeDayLabel(activeDay, today).toLowerCase()}
          </span>
          <button
            type="button"
            onClick={() => setSelectedDay(today)}
            className="-my-2 min-h-11 px-1 text-xs font-medium text-text-muted hover:text-text"
          >
            Back to today
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger-dim px-3 py-2.5 text-xs leading-relaxed text-danger"
        >
          {error}
        </p>
      )}

      {view.loading ? (
        <p className="py-10 text-center text-sm text-text-faint">Loading…</p>
      ) : view.focus === null && view.entries.length === 0 ? (
        <DayEmptyState
          activeHabitCount={view.activeHabitCount}
          notYetExistingCount={view.notYetExistingCount}
          isPast={activeDay !== today}
        />
      ) : (
        <>
          {view.focus && (
            <FocusCard
              entry={view.focus}
              day={activeDay}
              onError={setError}
              onGain={noteGain}
            />
          )}

          {view.entries.length > 0 && (
            <section className="flex flex-col gap-2">
              {view.focus && (
                <h2 className="px-1 text-xs font-medium tracking-wide text-text-faint uppercase">
                  Also today
                </h2>
              )}
              <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
                {view.entries.map((entry, index) => (
                  <HabitRow
                    key={entry.habit.id}
                    entry={entry}
                    day={activeDay}
                    isLast={index === view.entries.length - 1}
                    onError={setError}
                    onGain={noteGain}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Backdating lives at the bottom: available, never in the way. */}
      {days.length > 1 && !view.loading && (
        <BackdateBar
          days={days}
          today={today}
          active={activeDay}
          onSelect={(day) => {
            setSelectedDay(day)
            setError(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Chooses today's focus if the day does not have one yet.
 *
 * App start is not sufficient on its own: on first run there are no habits to
 * choose from, so creating your first ones would otherwise leave the app's
 * signature mechanic missing until the next launch. Habits can also be added or
 * un-archived at any point during a session.
 *
 * `ensureDailyFocus` is idempotent — it never overwrites an existing choice —
 * so the only thing to guard is re-attempting on every render when there is
 * genuinely nothing eligible to pick.
 */
function useEnsureFocus(today: DayKey, view: ReturnType<typeof useDayView>) {
  const attempted = useRef<DayKey | null>(null)

  useEffect(() => {
    if (view.loading) return
    if (view.focusRecord) return
    if (view.activeHabitCount === 0) return
    if (attempted.current === today) return

    attempted.current = today
    void ensureDailyFocus()
  }, [today, view.loading, view.focusRecord, view.activeHabitCount])
}

/* ------------------------------------------------------------------ */
/* Level                                                               */
/* ------------------------------------------------------------------ */

/**
 * A thin progress strip rather than a card.
 *
 * Level is context, not the point of the screen. Giving it a card would say
 * "your score is the headline", which is exactly the framing this product is
 * trying to avoid.
 */
function LevelStrip({
  level,
  gain,
  freezeTokens,
}: {
  level: ReturnType<typeof useDayView>['level']
  gain: { xp: number; at: number } | null
  freezeTokens: number
}) {
  const [flash, setFlash] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!gain) return
    setFlash(gain.xp)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(null), 2200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [gain])

  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight text-text">
            Level {level.level}
          </span>
          {flash !== null && (
            <span className="text-sm font-semibold text-xp" role="status">
              +{flash} XP
            </span>
          )}
        </div>
        <span className="text-xs tabular-nums text-text-faint">
          {level.xpIntoLevel} / {level.xpForNextLevel}
          {freezeTokens > 0 && ` · ${freezeTokens} freeze${freezeTokens === 1 ? '' : 's'}`}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
        role="progressbar"
        aria-valuenow={Math.round(level.progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Level ${level.level} progress`}
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(2, level.progress * 100)}%` }}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Daily focus                                                         */
/* ------------------------------------------------------------------ */

/**
 * The signature experience.
 *
 * Two rules shape this card. The largest, most obvious action is the *smallest*
 * possible version of the task — the longer something has been avoided, the
 * less the app asks for. And nothing here counts or displays how long it has
 * been avoided: neglect drives selection, but showing it back would turn the
 * card into a daily accusation, which is an avoidance engine.
 */
function FocusCard({
  entry,
  day,
  onError,
  onGain,
}: {
  entry: DayEntry
  day: DayKey
  onError: (message: string | null) => void
  onGain: (xp: number) => void
}) {
  const { habit, log } = entry
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const run = async (fn: () => Promise<{ xpGained: number } | void>) => {
    setBusy(true)
    onError(null)
    try {
      const result = await fn()
      if (result && 'xpGained' in result) onGain(result.xpGained)
    } catch (e) {
      onError(e instanceof LoggingError ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const record = (outcome: LogOutcome, partialKind?: PartialKind) =>
    run(() => logHabit({ habitId: habit.id, dayKey: day, outcome, partialKind }, systemClock))

  if (log && (log.outcome === 'complete' || log.outcome === 'partial')) {
    return (
      <section className="rounded-2xl border border-brand/40 bg-brand-dim/60 p-5">
        <p className="text-xs font-medium tracking-wide text-brand-strong uppercase">
          Today's focus
        </p>
        {/* Same heading level as the pending state, so the card's identity in
            the accessibility tree does not change when it is completed. */}
        <h2 className="mt-2 text-lg font-semibold tracking-tight text-text">{habit.name}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          {log.outcome === 'complete'
            ? 'Done — and this was the one you were most likely to put off.'
            : 'Started. That was the hard part; the rest is optional.'}
        </p>
        <div className="mt-3 flex items-center gap-2">
          {log.outcome === 'partial' && (
            <Button
              variant="secondary"
              onClick={() => record('complete')}
              disabled={busy}
              className="min-h-10 text-xs"
            >
              I did all of it
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => run(() => unlogHabit(habit.id, day, systemClock))}
            disabled={busy}
            className="min-h-10 px-2 text-xs"
          >
            Undo
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-brand/40 bg-brand-dim/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-brand-strong uppercase">
          Today's focus
        </p>
        <span className="shrink-0 rounded-md bg-xp/15 px-2 py-0.5 text-xs font-medium text-xp">
          +{DEFAULT_XP_RULES.focusBonus} bonus
        </span>
      </div>

      <h2 className="mt-2 text-xl leading-tight font-semibold tracking-tight text-text">
        {habit.name}
      </h2>

      {/*
        The primary action is the minimum version, labelled with its own text.
        Making the smallest possible step the biggest button on the screen is
        the entire anti-procrastination mechanism in one control.
      */}
      <button
        type="button"
        onClick={() => record('partial', 'minimum')}
        disabled={busy}
        className="mt-4 flex w-full flex-col items-start gap-1 rounded-xl bg-brand px-4 py-3.5 text-left transition-colors hover:bg-brand-strong active:bg-brand-strong disabled:opacity-50"
      >
        <span className="text-xs text-white/70">Start with just this</span>
        <span className="text-[0.95rem] leading-snug font-medium text-white">
          {habit.minimumVersion}
        </span>
      </button>

      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => record('complete')}
          disabled={busy}
          className="flex-1 text-xs"
        >
          I did all of it
        </Button>
        <Button
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-h-11 px-3 text-xs"
        >
          More
        </Button>
      </div>

      {expanded && (
        <div className="mt-2 flex gap-2">
          <Button
            onClick={() => record('partial', 'other')}
            disabled={busy}
            className="flex-1 text-xs"
          >
            Partial
          </Button>
          <Button
            variant="ghost"
            onClick={() => record('skip')}
            disabled={busy}
            className="flex-1 text-xs"
          >
            Not today
          </Button>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Everything else                                                     */
/* ------------------------------------------------------------------ */

/**
 * A compact row with progressive disclosure.
 *
 * One tap on the check completes it; the outcomes that matter less are behind
 * a tap on the row. Four buttons per habit turns a five-habit day into twenty
 * decisions before any real work starts.
 */
function HabitRow({
  entry,
  day,
  isLast,
  onError,
  onGain,
}: {
  entry: DayEntry
  day: DayKey
  isLast: boolean
  onError: (message: string | null) => void
  onGain: (xp: number) => void
}) {
  const { habit, log, streak, frozenToday } = entry
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const run = async (fn: () => Promise<{ xpGained: number } | void>) => {
    setBusy(true)
    onError(null)
    try {
      const result = await fn()
      if (result && 'xpGained' in result) onGain(result.xpGained)
      setExpanded(false)
    } catch (e) {
      onError(e instanceof LoggingError ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const record = (outcome: LogOutcome, partialKind?: PartialKind) =>
    run(() => logHabit({ habitId: habit.id, dayKey: day, outcome, partialKind }, systemClock))

  const credited = log?.outcome === 'complete' || log?.outcome === 'partial'

  return (
    <li className={isLast ? '' : 'border-b border-line'}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => (credited ? setExpanded((v) => !v) : void record('complete'))}
          disabled={busy}
          aria-label={credited ? `${habit.name} options` : `Mark ${habit.name} done`}
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
            credited
              ? 'border-tier-2/50 bg-tier-2/15 text-tier-2'
              : 'border-line-strong text-transparent hover:border-brand hover:text-brand/40',
          ].join(' ')}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden>
            <path
              d="M5 10.5l3.5 3.5L15 7"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-w-0 flex-1 text-left"
        >
          <p
            className={[
              'truncate text-sm font-medium',
              credited ? 'text-text-muted line-through decoration-text-faint' : 'text-text',
            ].join(' ')}
          >
            {habit.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-faint">
            <StreakLabel streak={streak} />
            {frozenToday && ' · freeze used'}
            {log?.outcome === 'skip' && ' · not today'}
            {log?.partialKind === 'minimum' && ' · minimum'}
          </p>
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          {!credited && (
            <button
              type="button"
              onClick={() => record('partial', 'minimum')}
              disabled={busy}
              className="flex w-full flex-col items-start gap-0.5 rounded-xl border border-line bg-surface-raised px-3 py-2.5 text-left transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              <span className="text-xs text-text-faint">Start with just this</span>
              <span className="text-sm text-text">{habit.minimumVersion}</span>
            </button>
          )}
          <div className="flex gap-2">
            {!credited && (
              <Button
                onClick={() => record('partial', 'other')}
                disabled={busy}
                className="min-h-10 flex-1 text-xs"
              >
                Partial
              </Button>
            )}
            {log ? (
              <Button
                variant="ghost"
                onClick={() => run(() => unlogHabit(habit.id, day, systemClock))}
                disabled={busy}
                className="min-h-10 flex-1 text-xs"
              >
                Undo
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => record('skip')}
                disabled={busy}
                className="min-h-10 flex-1 text-xs"
              >
                Not today
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Supporting pieces                                                   */
/* ------------------------------------------------------------------ */

/**
 * Backdating, kept quiet.
 *
 * Collapsed to a single unobtrusive line until asked for. Forgetting to log
 * yesterday is common enough to support properly, and rare enough that it must
 * not compete with today for attention.
 */
function BackdateBar({
  days,
  today,
  active,
  onSelect,
}: {
  days: DayKey[]
  today: DayKey
  active: DayKey
  onSelect: (day: DayKey) => void
}) {
  const [open, setOpen] = useState(false)
  const past = days.filter((day) => day !== today)

  if (!open && active === today) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto min-h-11 px-3 text-xs text-text-faint transition-colors hover:text-text-muted"
      >
        Forgot to log an earlier day?
      </button>
    )
  }

  return (
    <div className="flex gap-1 rounded-xl border border-line bg-surface-raised p-1">
      {[today, ...past].map((day) => (
        <button
          key={day}
          type="button"
          aria-pressed={day === active}
          onClick={() => onSelect(day)}
          className={[
            // min-h-11 (44px) is the iOS comfortable-tap minimum. These sit in
            // a tight row where mis-taps silently log the wrong day.
            'min-h-11 flex-1 rounded-lg px-2 text-xs font-medium transition-colors',
            day === active ? 'bg-brand text-white' : 'text-text-muted hover:bg-surface-hover',
          ].join(' ')}
        >
          {relativeDayLabel(day, today)}
        </button>
      ))}
    </div>
  )
}

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
        title="Start with one"
        body="Pick the thing you've been putting off, and write down the two-minute version of it. That fallback is what you'll reach for on bad days."
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
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className="flex-1 text-xs leading-relaxed text-text-muted">
        {freezesSpent.length > 0 && (
          <p>
            <span className="text-text">
              {freezesSpent.length} streak{freezesSpent.length === 1 ? '' : 's'} kept
            </span>{' '}
            with a freeze token while you were away.
          </p>
        )}
        {streaksBroken.length > 0 && (
          <p className={freezesSpent.length > 0 ? 'mt-1' : ''}>
            {streaksBroken.length} streak{streaksBroken.length === 1 ? '' : 's'} ended — no tokens
            left. Your XP and level are untouched.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-m-1 p-1 text-text-faint hover:text-text"
      >
        ✕
      </button>
    </div>
  )
}

function StreakLabel({ streak }: { streak: DayEntry['streak'] }) {
  const unit = streak.unit === 'week' ? 'week' : 'day'
  const parts: string[] = []

  if (streak.current > 0) {
    parts.push(`${streak.current} ${unit}${streak.current === 1 ? '' : 's'}`)
  }
  if (streak.unit === 'week' && streak.progress.target > 0) {
    parts.push(`${streak.progress.done}/${streak.progress.target} this week`)
  }
  if (parts.length === 0) parts.push('Not started yet')

  return <>{parts.join(' · ')}</>
}

function relativeDayLabel(day: DayKey, today: DayKey): string {
  const delta = diffDays(day, today)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Yesterday'
  return `${delta} days ago`
}
