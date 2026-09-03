import type { DayRollup, HeatLevel } from '@/domain/history'
import { dayFullness, heatLevel } from '@/domain/history'
import type { WeekdayLabel } from '@/state/useHistoryView'

/**
 * The two history charts: a twelve-week contribution grid and a bar chart of
 * the current week.
 *
 * They share one ramp on purpose. Two charts of the same data in two different
 * colour languages make the page look assembled rather than designed, and the
 * reader has to learn the scale twice.
 *
 * ## Both live directly on `bg-base`, never inside a card
 *
 * `heat-0` and `surface` are the same colour. Put the grid on a card and every
 * empty day disappears into it — a sparse fortnight renders as a handful of
 * floating squares rather than as a sparse fortnight. On `bg-base` the empty
 * cells sit a step above the page and the grid keeps its shape at zero
 * intensity, which is what makes "you did nothing on Tuesday" legible instead
 * of looking like a rendering fault.
 */

/**
 * Written out rather than interpolated. Tailwind scans source text for literal
 * class names, so `bg-heat-${level}` generates nothing at all — the third time
 * this has bitten this codebase, hence the note.
 */
const HEAT_CLASS: Record<HeatLevel, string> = {
  0: 'bg-heat-0',
  1: 'bg-heat-1',
  2: 'bg-heat-2',
  3: 'bg-heat-3',
  4: 'bg-heat-4',
}

/* ------------------------------------------------------------------ */
/* Contribution heatmap                                                */
/* ------------------------------------------------------------------ */

/** Mon / Wed / Fri — the only three initials that are unambiguous together. */
const LABELLED_ROWS: ReadonlySet<number> = new Set([1, 3, 5])

export function Heatmap({
  weeks,
  dayLabels,
}: {
  weeks: DayRollup[][]
  dayLabels: WeekdayLabel[]
}) {
  if (weeks.length === 0) return null

  const days = weeks.flat()
  const lived = days.filter((day) => !day.future && day.due > 0)
  const active = lived.filter((day) => day.credit > 0).length

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label-caps text-text-secondary">Last 12 weeks</h2>
        <span className="text-small tabular-nums text-text-muted">
          {active} of {lived.length} days
        </span>
      </div>

      <div className="flex gap-1.5">
        {/*
          Weekday labels sit outside the grid rather than inside it, so the grid
          stays a clean rectangle. Only Mon/Wed/Fri are labelled: seven initials
          down a 25px row stack is unreadable on a phone, and those three are the
          only ones that stay distinct — S and T each appear twice.

          `text-muted`, not `text-disabled`. These are real words, and
          `text-disabled` is non-text only (it measures 3.10:1 here).
        */}
        <div className="grid shrink-0 grid-rows-7 gap-1 pt-px">
          {dayLabels.map((label) => (
            <span
              key={label.weekday}
              aria-hidden
              className="flex items-center text-micro leading-none text-text-muted"
            >
              {LABELLED_ROWS.has(label.weekday) ? label.initial : ''}
            </span>
          ))}
        </div>

        {/*
          Explicit `1fr` columns, not implicit ones. With `grid-flow-col` alone
          the implicit columns size to content, and `aspect-square` cells then
          have no width to derive a height from — the grid overflows its
          container and the last fortnight is clipped off the right edge.
          Pinning the column count divides the available width instead, which
          also makes the whole grid responsive for free.
        */}
        <div
          role="img"
          aria-label={`Contribution history: ${active} of ${lived.length} scheduled days had at least some progress over the last 12 weeks.`}
          className="grid min-w-0 flex-1 grid-flow-col grid-rows-7 gap-1"
          style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
        >
          {weeks.map((week) =>
            week.map((day) => <HeatCell key={day.dayKey} day={day} />),
          )}
        </div>
      </div>

      <Legend />
    </section>
  )
}

function HeatCell({ day }: { day: DayRollup }) {
  const level = heatLevel(day)

  /*
   * Three states, not two. A future day is not an empty day — rendering it as
   * `heat-0` would show the rest of this week as a row of misses you have not
   * had the chance to avoid yet, which is precisely the dread this app is
   * built to remove. It gets an outline and no fill instead.
   */
  if (day.future) {
    return (
      <span
        aria-hidden
        title={`${day.dayKey} — not yet`}
        className="aspect-square rounded-xs border border-border"
      />
    )
  }

  return (
    <span
      aria-hidden
      title={heatCellTitle(day)}
      className={`aspect-square rounded-xs ${HEAT_CLASS[level]}`}
    />
  )
}

function heatCellTitle(day: DayRollup): string {
  if (day.due === 0) return `${day.dayKey} — nothing scheduled`
  const done = day.completed + day.partial
  return `${day.dayKey} — ${done} of ${day.due} done`
}

function Legend() {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="text-micro text-text-muted">Less</span>
      {([0, 1, 2, 3, 4] as HeatLevel[]).map((level) => (
        <span
          key={level}
          aria-hidden
          className={`h-2.5 w-2.5 rounded-xs ${HEAT_CLASS[level]}`}
        />
      ))}
      <span className="text-micro text-text-muted">More</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* This week's bars                                                    */
/* ------------------------------------------------------------------ */

/**
 * The current week as seven bars.
 *
 * The heatmap answers "how have I been doing?"; this answers "how is this week
 * going?" — a shorter horizon that still fits in a glance. It shares the heat
 * ramp so the two read as one system.
 */
export function WeekBars({
  days,
  dayLabels,
  today,
}: {
  days: DayRollup[]
  dayLabels: WeekdayLabel[]
  today: string
}) {
  if (days.length === 0) return null

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="label-caps text-text-secondary">This week</h2>

      <div className="flex items-end gap-1.5">
        {days.map((day, index) => (
          <WeekBar
            key={day.dayKey}
            day={day}
            label={dayLabels[index]?.initial ?? ''}
            isToday={day.dayKey === today}
          />
        ))}
      </div>
    </section>
  )
}

const BAR_TRACK_HEIGHT = 64

function WeekBar({
  day,
  label,
  isToday,
}: {
  day: DayRollup
  label: string
  isToday: boolean
}) {
  const fullness = dayFullness(day)
  const level = heatLevel(day)

  // A bar with real height even at low fullness, so "a little" is visible
  // rather than a hairline indistinguishable from nothing.
  const height = fullness > 0 ? Math.max(6, Math.round(fullness * BAR_TRACK_HEIGHT)) : 0

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <div
        className="flex w-full items-end justify-center rounded-xs bg-surface"
        style={{ height: BAR_TRACK_HEIGHT }}
        title={heatCellTitle(day)}
      >
        {height > 0 && (
          <div
            className={[
              'w-full rounded-xs transition-[height] duration-slow ease-out-soft',
              HEAT_CLASS[level],
              // Glow marks the day that is still live — the one bar you can
              // still change. Subtle, and only ever on one bar at a time.
              isToday ? 'shadow-glow-subtle' : '',
            ].join(' ')}
            style={{ height }}
          />
        )}
        {/* A day that asked nothing gets a rule at the base rather than an
            empty column, so a rest day reads as planned, not as a failure. */}
        {height === 0 && day.due === 0 && !day.future && (
          <div aria-hidden className="mb-1 h-px w-2/3 bg-text-disabled" />
        )}
      </div>
      <span
        className={[
          'text-micro tabular-nums',
          isToday ? 'font-semibold text-text-primary' : 'text-text-muted',
        ].join(' ')}
      >
        {label}
      </span>
    </div>
  )
}
