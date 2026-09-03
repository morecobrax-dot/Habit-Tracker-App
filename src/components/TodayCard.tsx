import type { AtRiskHabit, TodaySummary } from '@/domain/momentum'
import { describeDormantStreak } from '@/domain/momentum'
import { Flame } from '@/components/Flame'

/**
 * The day's state, as one surface.
 *
 * ## What this replaces, and why
 *
 * The home page used to open with a bare flame and the best streak. On any
 * missed day that became a large grey zero — the single biggest element on the
 * screen, announcing a broken streak, on an account with weeks of real work
 * behind it. No XP was taken, so it passed the letter of "no punishment
 * mechanics" while breaking its spirit as loudly as the layout allowed.
 *
 * So the headline is now *today's progress*, which is always actionable and
 * never a verdict on the past. The flame still appears, but as supporting
 * detail on the right, and only when something is actually lit. A streak of
 * zero simply renders nothing rather than a monument to it.
 *
 * ## The three states
 *
 * - **Rest day** — nothing scheduled. Said plainly, so it reads as planned.
 * - **Done** — everything logged. The one place the card gets its glow.
 * - **In progress** — the count, plus anything with a live streak that today
 *   would end. That list is narrow by construction (`domain/momentum.ts`): a
 *   habit with nothing to lose never appears, so a new user is never shown a
 *   list of ways they are failing.
 */
export function TodayCard({
  summary,
  onQuickLog,
  busyHabitId,
}: {
  summary: TodaySummary
  /** Logs the two-minute version of a habit at risk. One tap, no dialog. */
  onQuickLog: (habitId: string) => void
  busyHabitId: string | null
}) {
  const { due, done, remaining, atRisk, allDone, restDay, bestStreak } = summary

  if (restDay) {
    return (
      <section className="surface-raised rounded-card border border-border bg-surface px-5 py-4">
        <p className="label-caps text-text-secondary">Today</p>
        <p className="mt-1.5 text-lead font-semibold text-text-primary">Nothing scheduled</p>
        <p className="mt-1 text-small leading-relaxed text-text-muted">
          A rest day, not a miss. Nothing is at stake and nothing is lost.
        </p>
      </section>
    )
  }

  return (
    <section
      className={[
        'rounded-card border px-5 py-4 transition-shadow duration-base',
        // Lit, but never the hero: the focus card owns that slot, and two
        // glowing surfaces stacked at the top of the page is how a restrained
        // UI starts looking like a gaming one.
        allDone
          ? 'surface-lifted-lit border-primary-hot/45 bg-surface-raise'
          : 'surface-lifted border-border bg-surface-raise',
      ].join(' ')}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="label-caps text-text-secondary">Today</p>

          {allDone ? (
            <>
              <p className="mt-1.5 text-lead font-semibold text-text-primary">
                That&rsquo;s the day
              </p>
              <p className="mt-1 text-small leading-relaxed text-text-muted">
                {due === 1 ? 'The one thing' : `All ${due}`} logged. Nothing else is asking
                for you today.
              </p>
            </>
          ) : done === 0 ? (
            /*
             * Before anything is logged the headline counts what there is to
             * do, not what has not been done. "0 / 3" is the same fact, but a
             * large zero is the biggest thing on the screen at the start of
             * every single day — a scoreboard reading nil, when what the
             * moment actually needs is an instruction.
             */
            <>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="stat-numerals text-stat text-text-primary">{due}</span>
                <span className="ml-0.5 text-small text-text-secondary">
                  {due === 1 ? 'thing to do' : 'things to do'}
                </span>
              </p>
              <p className="mt-0.5 text-small text-text-muted">
                The smallest version of any of them counts.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="stat-numerals text-stat text-text-primary">{done}</span>
                <span className="stat-numerals text-lead text-text-muted">/ {due}</span>
                <span className="ml-0.5 text-small text-text-secondary">done</span>
              </p>
              <p className="mt-0.5 text-small text-text-muted">{remaining} left.</p>
            </>
          )}
        </div>

        {/* The flame keeps its place, but only when there is something to
            show. Rendering a dormant flame beside a zero is what made the old
            hero read as a failure notice. */}
        {bestStreak > 0 && (
          <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
            <Flame streak={bestStreak} size={38} />
            <span className="stat-numerals text-small text-text-primary">{bestStreak}</span>
            <span className="text-micro text-text-muted">
              {summary.bestStreakUnit === 'week' ? 'wks' : 'days'}
            </span>
          </div>
        )}
      </div>

      {/* Progress as a bar, not a ring: it lines up with the XP bar above it,
          so the screen has one progress language rather than two. */}
      {!allDone && (
        <div
          className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-surface"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={due}
          aria-label={`${done} of ${due} habits done today`}
        >
          {done > 0 && (
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-slow ease-out-soft"
              style={{ width: `${Math.max(4, (done / due) * 100)}%` }}
            />
          )}
        </div>
      )}

      {atRisk.length > 0 && (
        <AtRiskList items={atRisk} onQuickLog={onQuickLog} busyHabitId={busyHabitId} />
      )}
    </section>
  )
}

/**
 * Streaks today would end, with the way back in attached.
 *
 * The framing is the whole point. This is not "you have not done these" — a
 * habit with nothing to lose never reaches this list. It is "these have
 * something running, and here is the two-minute version", which is support
 * rather than pressure. The button logs the minimum version directly: on the
 * day you are least likely to act, the fewest possible taps.
 */
function AtRiskList({
  items,
  onQuickLog,
  busyHabitId,
}: {
  items: readonly AtRiskHabit[]
  onQuickLog: (habitId: string) => void
  busyHabitId: string | null
}) {
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3.5">
      <p className="label-caps text-text-secondary">
        {items.length === 1 ? 'One streak needs today' : `${items.length} streaks need today`}
      </p>

      {items.map((item) => (
        <div
          key={item.habit.id}
          className="flex items-center gap-3 rounded-sm bg-surface px-3 py-2"
        >
          <Flame streak={item.streak} size={20} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-small font-medium text-text-primary">
              {item.habit.name}
            </p>
            <p className="truncate text-micro text-text-muted">
              {item.streak} {item.unit === 'week' ? 'week' : 'day'}
              {item.streak === 1 ? '' : 's'}
              {/* Only promised where a token can actually pay for it — see
                  `summariseToday`. Saying "covered" and then breaking the
                  streak at rollover would be worse than saying nothing. */}
              {item.coveredByFreeze ? ' · a freeze can cover it' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onQuickLog(item.habit.id)}
            disabled={busyHabitId === item.habit.id}
            className="min-h-9 shrink-0 rounded-sm bg-primary px-3 text-micro font-semibold text-text-primary transition-all duration-fast hover:bg-primary-hot hover:shadow-glow-subtle disabled:opacity-50"
          >
            2-min
          </button>
        </div>
      ))}
    </div>
  )
}

export { describeDormantStreak }
