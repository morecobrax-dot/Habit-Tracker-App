import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/data/db'
import type { DayKey, HabitLog } from '@/domain/types'
import { DIFFICULTY_LABELS } from '@/domain/types'
import { addDays, diffDays, weekdayOf } from '@/domain/time/dayKey'
import { startOfWeek } from '@/domain/time/week'
import { WEEKDAY_NAMES, describeSchedule } from '@/domain/schedule'
import { computeStreak } from '@/domain/streak'
import { describeCadenceStatus, describeLastDone, habitCadence } from '@/domain/cadence'
import { habitStats } from '@/domain/review'
import { DEFAULT_XP_RULES } from '@/domain/rules/xpRules'
import { useApp } from '@/state/AppContext'
import { HEATMAP_WEEKS, weekdayLabels } from '@/state/useHistoryView'
import { Button, Card, EmptyState } from '@/components/ui'
import { DetailSkeleton } from '@/components/Skeleton'
import { Heatmap } from '@/components/History'
import { Flame } from '@/components/Flame'
import { Gem, DEFAULT_GEM } from '@/components/icons/gems'

/**
 * One habit's own page: its record, its streak, its calendar.
 *
 * Separate from the editor on purpose. Tapping a habit to *look* at it and
 * tapping it to *change* it are different intentions, and routing both to a
 * form makes the common one (how am I doing at this?) the harder one.
 *
 * Everything here is derived from the logs on read, exactly as the home screen
 * is. Nothing on this page writes.
 */
export function HabitDetailRoute() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { today, settings } = useApp()

  const data = useLiveQuery(async () => {
    const habit = id ? await db.habits.get(id) : undefined
    if (!habit) return { habit: null, logs: [] as HabitLog[], frozen: [] as DayKey[] }
    const [logs, freezes] = await Promise.all([
      db.logs.where('habitId').equals(habit.id).toArray(),
      db.freezeEvents.where('habitId').equals(habit.id).toArray(),
    ])
    return { habit, logs, frozen: freezes.map((f) => f.dayKey) }
  }, [id])

  const view = useMemo(() => {
    if (!data?.habit) return null

    const streak = computeStreak({
      habit: data.habit,
      logs: data.logs,
      frozenDays: new Set(data.frozen),
      today,
      weekStartsOn: settings.weekStartsOn,
    })

    // Same twelve-week window as the home page, snapped to whole weeks so the
    // grid is rectangular.
    const currentWeekStart = startOfWeek(today, settings.weekStartsOn)
    const from = addDays(currentWeekStart, -7 * (HEATMAP_WEEKS - 1))
    const to = addDays(currentWeekStart, 6)

    const stats = habitStats(
      data.habit,
      data.logs,
      from,
      to,
      today,
      DEFAULT_XP_RULES.completionFactors,
    )

    const weeks: (typeof stats.days)[] = []
    for (let i = 0; i < stats.days.length; i += 7) weeks.push(stats.days.slice(i, i + 7))

    const xp = data.logs.reduce((total, entry) => total + (entry.xpAwarded || 0), 0)

    const cadence = habitCadence({
      habit: data.habit,
      logs: data.logs,
      today,
      weekStartsOn: settings.weekStartsOn,
    })

    return { habit: data.habit, streak, stats, weeks, xp, cadence, logged: data.logs.length }
  }, [data, today, settings.weekStartsOn])

  if (!data) return <DetailSkeleton />

  if (!data.habit) {
    return (
      <div className="flex flex-col gap-5 pt-2 pb-6">
        <EmptyState
          title="That habit is gone"
          body="It was deleted, or the link is stale. Nothing else has been affected."
          action={
            <Button variant="primary" onClick={() => navigate('/habits', { replace: true })}>
              Back to habits
            </Button>
          }
        />
      </div>
    )
  }

  const { habit, streak, stats, weeks, xp, cadence, logged } = view!
  const dayLabels = weekdayLabels(today, settings.weekStartsOn)

  return (
    <div className="flex flex-col gap-6 pb-6">
      <header className="flex items-start gap-3 pt-2">
        <span className="mt-1 shrink-0">
          <Gem id={habit.icon ?? DEFAULT_GEM} size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-title leading-tight font-semibold tracking-tight text-text-primary">
            {habit.name}
          </h1>
          <p className="mt-1 text-small text-text-muted">
            {describeSchedule(habit.schedule)}
            {habit.category && ` · ${habit.category}`}
            {` · ${DIFFICULTY_LABELS[habit.difficulty]}`}
          </p>
        </div>
        <Link to={`/habits/${habit.id}/edit`} className="shrink-0">
          <Button className="text-small">Edit</Button>
        </Link>
      </header>

      <CadencePanel cadence={cadence} today={today} />

      {/* The two-minute version, given real estate rather than buried in a
          form. It is the thing to reach for on a bad day, so it should be
          findable on a bad day. */}
      <Card className="flex flex-col gap-1">
        <p className="label-caps text-text-secondary">On a bad day</p>
        <p className="text-body leading-relaxed text-text-primary">{habit.minimumVersion}</p>
      </Card>

      <StreakPanel streak={streak} />

      <section className="grid grid-cols-2 gap-2.5">
        <Stat label="Showed up" value={`${stats.showedUp}`} sub={`of ${stats.due} due`} />
        {/* The unweighted rate, so this reconciles with the fraction beside it.
            The weighted one still drives the heat ramp. */}
        <Stat
          label="Rate"
          value={`${Math.round(stats.showedUpRate * 100)}%`}
          sub="last 12 weeks"
        />
        <Stat label="Longest" value={`${streak.longest}`} sub={unitLabel(streak.unit, streak.longest)} />
        <Stat label="XP earned" value={`${xp}`} sub="from this habit" />
      </section>

      {logged === 0 ? (
        <EmptyState
          title="No history yet"
          body="Nothing has been logged for this habit. The first entry is the hard one — and the two-minute version counts."
          action={
            <Link to="/today">
              <Button variant="primary">Go log it</Button>
            </Link>
          }
        />
      ) : (
        <Heatmap weeks={weeks} dayLabels={dayLabels} />
      )}
    </div>
  )
}

/**
 * Where this habit stands right now: last done, and what today asks of it.
 *
 * These are the two questions someone opening a habit's page actually has, and
 * before this the page answered neither — it went straight from the name to a
 * streak number and a heat grid, which is a scoreboard rather than a record.
 *
 * Placed above the streak on purpose. "Last done four days ago, on for today"
 * is orientation; the streak is a score, and a score should not be the first
 * thing a habit says about itself.
 *
 * The gap is stated and then left alone. No "you're slipping", no colour change
 * as it grows — a long gap is exactly when the page must not become unpleasant
 * to look at, because the person reading it is already avoiding the thing.
 */
function CadencePanel({
  cadence,
  today,
}: {
  cadence: ReturnType<typeof habitCadence>
  today: DayKey
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-caps text-text-secondary">Last done</span>
        <span className="text-body font-medium text-text-primary">
          {describeLastDone(cadence.daysSinceLastDone)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
        <span className="label-caps text-text-secondary">Today</span>
        <span className="text-right text-small text-text-muted">
          {describeCadenceStatus(cadence, nextDueLabel(cadence.nextDue, today))}
        </span>
      </div>
    </Card>
  )
}

/**
 * "tomorrow", or "on Tuesday" — the phrase `describeCadenceStatus` drops into
 * its sentence. Formatting lives here rather than in the domain, which has no
 * locale and no opinion about how the app writes dates.
 */
function nextDueLabel(nextDue: DayKey | null, today: DayKey): string {
  if (nextDue === null) return ''
  if (diffDays(today, nextDue) === 1) return 'tomorrow'
  return `on ${WEEKDAY_NAMES[weekdayOf(nextDue)]}`
}

/**
 * The streak, stated once and explained.
 *
 * `frozenInStreak` is surfaced rather than hidden: "never break a streak
 * silently" cuts both ways, and a streak resting on spent freeze tokens is
 * something the user is entitled to know about before it surprises them.
 */
function StreakPanel({ streak }: { streak: ReturnType<typeof computeStreak> }) {
  const frozen = streak.frozenInStreak.length

  return (
    <Card className="flex items-center gap-4">
      <Flame streak={streak.current} size={48} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5">
          <span className="stat-numerals text-stat text-text-primary">{streak.current}</span>
          <span className="text-body text-text-secondary">
            {unitLabel(streak.unit, streak.current)}
          </span>
        </p>
        <p className="mt-0.5 text-small text-text-muted">
          {streak.current === 0
            ? 'Not running right now. Nothing is lost — it starts again whenever you do.'
            : frozen > 0
              ? `Held up by ${frozen} freeze ${frozen === 1 ? 'token' : 'tokens'}.`
              : 'Running.'}
        </p>
      </div>
    </Card>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="surface-raised flex flex-col gap-0.5 rounded-card border border-border bg-surface px-3.5 py-3">
      <p className="label-caps text-text-muted">{label}</p>
      <p className="stat-numerals text-lead text-text-primary">{value}</p>
      <p className="text-micro text-text-muted">{sub}</p>
    </div>
  )
}

function unitLabel(unit: 'day' | 'week', count: number): string {
  const word = unit === 'week' ? 'week' : 'day'
  return `${word}${count === 1 ? '' : 's'}`
}

