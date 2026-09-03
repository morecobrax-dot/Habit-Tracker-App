import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DayKey, LogOutcome, PartialKind } from '@/domain/types'
import { backdatableDays, diffDays } from '@/domain/time/dayKey'
import { bestStreak } from '@/domain/history'
import { LoggingError, logHabit, unlogHabit } from '@/services/loggingService'
import { ensureDailyFocus } from '@/services/focusService'
import { systemClock } from '@/services/clock'
import { useApp } from '@/state/AppContext'
import { useDayView, type DayEntry } from '@/state/useDayView'
import { useHistoryView, weekdayLabels } from '@/state/useHistoryView'
import { Button, EmptyState } from '@/components/ui'
import { SkeletonBlock } from '@/components/Skeleton'
import { WeekReview } from '@/components/WeekReview'
import { Flame } from '@/components/Flame'
import { Heatmap, WeekBars } from '@/components/History'
import { Gem, DEFAULT_GEM } from '@/components/icons/gems'

/**
 * The screen the app opens on.
 *
 * It is built to answer one question — "what should I start right now?" — and
 * the layout enforces that hierarchy.
 *
 * ## Anchor and invitation are not the same thing
 *
 * The streak hero is the visual *anchor*: the largest thing on the page, at the
 * top, sized so the eye lands there. The focus card is the most inviting
 * *action*: the only red-filled interactive block on the screen. Those are
 * different jobs, which is why both briefs can be satisfied at once — the flame
 * is big and passive, carrying no buttons and no fill, while the focus card is
 * the only thing that looks like it wants pressing.
 *
 * Getting that backwards would produce a page whose loudest element is a score,
 * which is the framing this product exists to avoid.
 *
 * ## Order
 *
 * Act first, reflect second. Everything above the backdate bar is about what to
 * do now; the heatmap and week bars sit below it, because history is context
 * and context that outranks the next action is just a scoreboard.
 */
export function TodayRoute() {
  const { today, settings, lastRollover, dismissRollover } = useApp()
  const [selectedDay, setSelectedDay] = useState<DayKey>(today)
  const [error, setError] = useState<string | null>(null)
  const [gain, setGain] = useState<{ xp: number; at: number } | null>(null)

  const days = backdatableDays(today, settings.backdateWindowDays)
  const activeDay = days.includes(selectedDay) ? selectedDay : today
  const view = useDayView(activeDay)
  const history = useHistoryView()

  useEnsureFocus(today, view)

  const noteGain = (xp: number) => {
    if (xp > 0) setGain({ xp, at: Date.now() })
  }

  const dayLabels = weekdayLabels(today, settings.weekStartsOn)
  const allEntries = view.focus ? [view.focus, ...view.entries] : view.entries
  const hero = bestStreak(allEntries)

  return (
    <div className="flex flex-col gap-6 pb-4">
      <LevelHeader level={view.level} gain={gain} freezeTokens={view.freezeTokens} />

      {!view.loading && view.activeHabitCount > 0 && <StreakHero entry={hero} />}

      {lastRollover && <RolloverNotice onDismiss={dismissRollover} />}

      {/*
        Viewing a past day is a mode, so it gets an unmissable banner. Today —
        the overwhelmingly common case — gets nothing here at all.
      */}
      {activeDay !== today && (
        <div className="flex items-center justify-between gap-3 rounded-card border border-primary/40 bg-surface-raise px-3.5 py-2.5">
          <span className="text-small font-medium text-text-primary">
            Logging {relativeDayLabel(activeDay, today).toLowerCase()}
          </span>
          <button
            type="button"
            onClick={() => setSelectedDay(today)}
            className="-my-2 min-h-11 px-1 text-small font-medium text-text-muted transition-colors hover:text-text-primary"
          >
            Back to today
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          /* Red border and tinted fill carry the alarm; the message stays at
             full contrast. "No red text, ever" applies to errors too. */
          className="rounded-card border border-danger bg-danger/15 px-3 py-2.5 text-small leading-relaxed text-text-primary"
        >
          {error}
        </p>
      )}

      {view.loading ? (
        <TodayBodySkeleton />
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
              bonus={view.focusBonus}
              onError={setError}
              onGain={noteGain}
            />
          )}

          {view.entries.length > 0 && (
            <section className="flex flex-col gap-2">
              {view.focus && <h2 className="label-caps px-1 text-text-secondary">Also today</h2>}
              <ul className="overflow-hidden rounded-card border border-border bg-surface">
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

      {/* Backdating lives below the day's work: available, never in the way. */}
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

      {/*
        History. Deliberately last, and deliberately not inside cards — both
        charts need `bg-base` behind them to read at zero intensity.
      */}
      {!history.loading && view.activeHabitCount > 0 && (
        <div className="flex flex-col gap-6 border-t border-border pt-6">
          <WeekReview review={history.review} />
          <WeekBars days={history.thisWeek} dayLabels={dayLabels} today={today} />
          <Heatmap weeks={history.weeks} dayLabels={dayLabels} />
        </div>
      )}
    </div>
  )
}

/**
 * The part of the page that waits on IndexedDB.
 *
 * Only the body: the level strip and streak hero render their own zero state
 * immediately, and replacing those with placeholders would make a fast load
 * flash twice. Heights match the real focus card and habit list so the page
 * does not jump when the data lands — the entire point of a skeleton.
 */
function TodayBodySkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading your day</span>
      <SkeletonBlock className="h-52 w-full" radius="card" />
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-36 w-full" radius="card" />
      </div>
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

/**
 * Drives the completion moment: a wash, a gem pop, and the XP floating up.
 *
 * Returns an `id` that bumps on every fire. React reuses a DOM node when only
 * its class changes, and a CSS animation on a reused node does not restart — so
 * completing, undoing and completing again would play the animation once and
 * then never again. Keying the animated elements on this id forces a fresh
 * node each time.
 *
 * Unmounts at 750ms rather than at the 400ms the animation takes. Under
 * `prefers-reduced-motion` the global guard collapses the animation to nothing
 * and the XP number falls back to its static base style, so the extra time is
 * what makes it readable for the people who asked for less movement.
 */
function useCelebration() {
  const [state, setState] = useState<{ id: number; xp: number } | null>(null)
  const counter = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const fire = (xp: number) => {
    counter.current += 1
    setState({ id: counter.current, xp })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState(null), 750)
  }

  return { active: state !== null, id: state?.id ?? 0, xp: state?.xp ?? 0, fire }
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

/**
 * A thin progress strip rather than a card.
 *
 * Level is context, not the point of the screen. Giving it a card would say
 * "your score is the headline", which is the framing this product avoids.
 *
 * The fill carries a glow and a travelling sheen; the empty track carries
 * neither. Glow means earned, and the unfilled part of the bar has not been.
 */
function LevelHeader({
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

  const remaining = Math.max(0, level.xpForNextLevel - level.xpIntoLevel)
  // A floor so the first few XP are visible, but only once something has been
  // earned. At exactly zero the fill is omitted: a 2%-wide rounded bar renders
  // as a stray dot, which reads as a rendering fault rather than as an empty
  // bar — and a glowing dot would be claiming credit for nothing.
  const percent = level.progress > 0 ? Math.max(4, Math.min(100, level.progress * 100)) : 0

  return (
    <header className="flex flex-col gap-2 pt-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-micro text-text-muted">Level</span>
          <span className="stat-numerals text-lead text-text-primary">{level.level}</span>
          {flash !== null && (
            <span className="stat-numerals text-body text-gold" role="status">
              +{flash} XP
            </span>
          )}
        </div>
        {/* tabular-nums, not stat-numerals: this string mixes numerals with
            prose, and stat-numerals' negative tracking closes up the spaces
            around the separator ("18 / 40 · 2 freezes" reads as "40·2"). */}
        <span className="text-micro tabular-nums text-text-muted">
          {remaining} XP to level {level.level + 1}
          {freezeTokens > 0 && ` · ${freezeTokens} freeze${freezeTokens === 1 ? '' : 's'}`}
        </span>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-surface-raise"
        role="progressbar"
        aria-valuenow={Math.round(level.progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Level ${level.level} progress`}
      >
        {percent > 0 && (
          <div
            className="xp-sheen relative h-full overflow-hidden rounded-full bg-primary shadow-glow-subtle transition-[width] duration-slow ease-out-soft"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Streak hero                                                         */
/* ------------------------------------------------------------------ */

/**
 * The page's visual anchor: the longest streak currently running.
 *
 * Big and passive. It states a fact and offers no action, so it can be the
 * largest thing on the screen without competing with the focus card for the
 * tap. The flame's hue is the reward — see `components/Flame.tsx`.
 *
 * With nothing lit it shows a dormant flame rather than disappearing, so the
 * space it will occupy is visible from day one. The copy in that state is
 * deliberately forward-looking: "today starts it", never "you have no streak".
 */
function StreakHero({ entry }: { entry: DayEntry | null }) {
  const streak = entry?.streak.current ?? 0
  const unit = entry?.streak.unit === 'week' ? 'week' : 'day'

  return (
    <section className="flex flex-col items-center gap-1 py-1">
      <Flame streak={streak} size={92} />

      {streak > 0 ? (
        <>
          <p className="flex items-baseline gap-2">
            <span className="stat-numerals text-hero text-text-primary">{streak}</span>
            <span className="text-body text-text-secondary">
              {unit}
              {streak === 1 ? '' : 's'}
            </span>
          </p>
          <p className="max-w-[16rem] truncate text-small text-text-muted">
            {entry?.habit.name}
          </p>
        </>
      ) : (
        <>
          <p className="stat-numerals text-stat text-text-secondary">0</p>
          <p className="text-small text-text-muted">Today starts it</p>
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Daily focus                                                         */
/* ------------------------------------------------------------------ */

/**
 * The signature experience, and the only red-filled block on the page.
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
  bonus,
  onError,
  onGain,
}: {
  entry: DayEntry
  day: DayKey
  /** The bonus as it will actually be paid, not the ruleset's flat input. */
  bonus: number
  onError: (message: string | null) => void
  onGain: (xp: number) => void
}) {
  const { habit, log } = entry
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const celebration = useCelebration()

  const run = async (fn: () => Promise<{ xpGained: number } | void>) => {
    setBusy(true)
    onError(null)
    try {
      const result = await fn()
      if (result && 'xpGained' in result) {
        onGain(result.xpGained)
        celebration.fire(result.xpGained)
      }
    } catch (e) {
      onError(e instanceof LoggingError ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const record = (outcome: LogOutcome, partialKind?: PartialKind) =>
    run(() => logHabit({ habitId: habit.id, dayKey: day, outcome, partialKind }, systemClock))

  const done = log?.outcome === 'complete' || log?.outcome === 'partial'

  return (
    <section
      className={[
        'relative overflow-hidden rounded-card border p-5 transition-shadow duration-base',
        // The accent border is what marks this card out, and it strengthens
        // once earned. Glow only on the completed state: it means "earned".
        done
          ? 'border-primary-hot/50 bg-surface-raise shadow-glow-medium'
          : 'border-primary/50 bg-surface-raise',
      ].join(' ')}
    >
      {celebration.active && (
        <span
          key={celebration.id}
          aria-hidden
          className="complete-fill pointer-events-none absolute inset-0 bg-primary"
        />
      )}
      {celebration.active && celebration.xp > 0 && (
        <span
          key={`xp-${celebration.id}`}
          aria-hidden
          className="xp-float pointer-events-none absolute top-4 right-5 stat-numerals text-lead text-gold"
        >
          +{celebration.xp}
        </span>
      )}

      <div className="relative flex items-start justify-between gap-3">
        <p className="label-caps text-text-secondary">Today's focus</p>
        {!done && (
          <span className="shrink-0 rounded-xs border border-gold/30 px-2 py-0.5 text-micro tabular-nums text-gold">
            +{bonus} bonus
          </span>
        )}
      </div>

      {/* Same heading level in both states, so the card's identity in the
          accessibility tree does not change when it is completed. */}
      <h2 className="relative mt-2 text-title leading-tight font-semibold text-text-primary">
        {habit.name}
      </h2>

      <div className="relative">
      {done ? (
        <>
          <p className="mt-2 text-body leading-relaxed text-text-secondary">
            {log?.outcome === 'complete'
              ? 'Done — and this was the one you were most likely to put off.'
              : 'Started. That was the hard part; the rest is optional.'}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {log?.outcome === 'partial' && (
              <Button
                variant="secondary"
                onClick={() => record('complete')}
                disabled={busy}
                className="text-small"
              >
                I did all of it
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => run(() => unlogHabit(habit.id, day, systemClock))}
              disabled={busy}
              className="px-2 text-small"
            >
              Undo
            </Button>
          </div>
        </>
      ) : (
        <>
          {/*
            The primary action is the minimum version, labelled with its own
            text. Making the smallest possible step the biggest button on the
            screen is the entire anti-procrastination mechanism in one control.
          */}
          <button
            type="button"
            onClick={() => record('partial', 'minimum')}
            disabled={busy}
            className="mt-4 flex w-full flex-col items-start gap-1 rounded-md bg-primary px-4 py-3.5 text-left transition-all duration-fast ease-out-soft hover:bg-primary-hot hover:shadow-glow-medium active:bg-primary-hot disabled:opacity-50"
          >
            <span className="text-micro text-text-primary/75">Start with just this</span>
            <span className="text-body leading-snug font-medium text-text-primary">
              {habit.minimumVersion}
            </span>
          </button>

          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => record('complete')}
              disabled={busy}
              className="flex-1 text-small"
            >
              I did all of it
            </Button>
            <Button
              variant="ghost"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="px-3 text-small"
            >
              More
            </Button>
          </div>

          {expanded && (
            <div className="mt-2 flex gap-2">
              <Button
                onClick={() => record('partial', 'other')}
                disabled={busy}
                className="flex-1 text-small"
              >
                Partial
              </Button>
              <Button
                variant="ghost"
                onClick={() => record('skip')}
                disabled={busy}
                className="flex-1 text-small"
              >
                Not today
              </Button>
            </div>
          )}
        </>
      )}
      </div>
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
  const celebration = useCelebration()

  const run = async (fn: () => Promise<{ xpGained: number } | void>) => {
    setBusy(true)
    onError(null)
    try {
      const result = await fn()
      if (result && 'xpGained' in result) {
        onGain(result.xpGained)
        celebration.fire(result.xpGained)
      }
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
    <li className={`relative ${isLast ? '' : 'border-b border-border'}`}>
      {/* The wash. `pointer-events-none` and `aria-hidden` because it is pure
          feedback sitting on top of a live control. */}
      {celebration.active && (
        <span
          key={celebration.id}
          aria-hidden
          className="complete-fill pointer-events-none absolute inset-0 bg-primary"
        />
      )}

      <div className="relative flex items-center gap-3 px-3 py-2">
        {/* 44px: the completion tap is the most-used control in the app and
            the one whose mis-tap is most annoying, so it gets the full
            comfortable target rather than the 36px the visual circle needs. */}
        <button
          type="button"
          onClick={() => (credited ? setExpanded((v) => !v) : void record('complete'))}
          disabled={busy}
          aria-label={credited ? `${habit.name} options` : `Mark ${habit.name} done`}
          className="flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <span
            className={[
              'flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-fast',
              credited
                ? 'border-primary-hot/60 bg-primary/30 text-text-primary shadow-glow-subtle'
                : 'border-border-interactive text-transparent hover:border-primary-hot hover:text-primary-hot/40',
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
          </span>
        </button>

        {/* The gem glows only on the day the habit is credited — glow means
            "earned", so an untouched habit must not carry it — and pops once,
            on the moment it is earned. */}
        <span className={credited ? 'drop-shadow-gem' : undefined}>
          <span key={celebration.id} className={celebration.active ? 'gem-pop' : undefined}>
            <Gem id={habit.icon ?? DEFAULT_GEM} size={24} />
          </span>
        </span>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-w-0 flex-1 py-1 text-left"
        >
          <p
            className={[
              'truncate text-body font-medium',
              credited ? 'text-text-muted line-through' : 'text-text-primary',
            ].join(' ')}
          >
            {habit.name}
          </p>
          <p className="mt-0.5 truncate text-micro tabular-nums text-text-muted">
            <StreakLabel streak={streak} />
            {frozenToday && ' · freeze used'}
            {/* A skip holds the streak. Saying only "not today" would leave the
                user guessing whether it cost them something. */}
            {log?.outcome === 'skip' && ' · not today, streak held'}
            {log?.partialKind === 'minimum' && ' · minimum'}
          </p>
        </button>

        {/*
          The right-hand slot holds the flame normally, and the XP gain for the
          moment after a completion.

          They share the slot rather than stacking because the row is 60px tall
          inside a list that clips its own corners — a number floating *above*
          the row is simply cut off, and one floating beside the flame lands on
          top of it. Sharing also happens to be the honest thing to show: the
          streak that flame represents is what just changed.
        */}
        <span className="flex min-w-9 shrink-0 items-center justify-end gap-1 pr-1">
          {celebration.active && celebration.xp > 0 ? (
            <span
              key={celebration.id}
              aria-hidden
              className="xp-float stat-numerals text-small text-gold"
            >
              +{celebration.xp}
            </span>
          ) : (
            streak.current > 0 && (
              <>
                {/* Silent to screen readers: the count is in the text above. */}
                <Flame streak={streak.current} size={18} />
                <span className="stat-numerals text-small text-text-secondary">
                  {streak.current}
                </span>
              </>
            )
          )}
        </span>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {!credited && (
            <button
              type="button"
              onClick={() => record('partial', 'minimum')}
              disabled={busy}
              className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border-interactive/50 bg-surface-raise px-3 py-2.5 text-left transition-colors duration-fast hover:border-border-interactive disabled:opacity-50"
            >
              <span className="text-micro text-text-muted">Start with just this</span>
              <span className="text-body text-text-primary">{habit.minimumVersion}</span>
            </button>
          )}
          <div className="flex gap-2">
            {!credited && (
              <Button
                onClick={() => record('partial', 'other')}
                disabled={busy}
                className="flex-1 text-small"
              >
                Partial
              </Button>
            )}
            {log ? (
              <Button
                variant="ghost"
                onClick={() => run(() => unlogHabit(habit.id, day, systemClock))}
                disabled={busy}
                className="flex-1 text-small"
              >
                Undo
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => record('skip')}
                disabled={busy}
                className="flex-1 text-small"
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
        className="mx-auto min-h-11 px-3 text-small text-text-muted transition-colors hover:text-text-primary"
      >
        Forgot to log an earlier day?
      </button>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="Day to log"
      className="flex gap-1 rounded-sm border border-border bg-surface p-1"
    >
      {[today, ...past].map((day) => (
        <button
          key={day}
          type="button"
          role="radio"
          aria-checked={day === active}
          onClick={() => onSelect(day)}
          className={[
            // min-h-11 (44px) is the iOS comfortable-tap minimum. These sit in
            // a tight row where mis-taps silently log the wrong day.
            'min-h-11 flex-1 rounded-xs px-2 text-small transition-colors duration-fast',
            day === active
              ? 'bg-primary font-semibold text-text-primary'
              : 'font-medium text-text-muted hover:bg-surface-raise hover:text-text-primary',
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
    <div className="flex items-start gap-3 rounded-card border border-border bg-surface px-3.5 py-3">
      <div className="flex-1 text-small leading-relaxed text-text-muted">
        {freezesSpent.length > 0 && (
          <p>
            <span className="text-text-primary">
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
        className="-m-1 p-1 text-text-muted transition-colors hover:text-text-primary"
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
