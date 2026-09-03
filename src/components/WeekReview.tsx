import { Link } from 'react-router-dom'
import type { WeekReview as WeekReviewData } from '@/domain/review'
import { Flame } from '@/components/Flame'

/**
 * The week, summarised: how much got done, what is going best, what is finding
 * this week hard.
 *
 * ## Why the third card is not called "most missed"
 *
 * The brief asked for a "most missed habit", and identifying the habit that is
 * struggling is genuinely useful — it is the same signal that drives the daily
 * focus. But `CLAUDE.md` already settled how that signal gets shown: the focus
 * card deliberately hides how long something has been avoided, because showing
 * it back "would turn the card into a daily accusation, which is an avoidance
 * engine". A card headed "most missed" is that accusation with a leaderboard
 * attached.
 *
 * So the information is all here — the habit, and its real ratio — but the card
 * is headed "Finding it hard" and its body is that habit's two-minute version,
 * which turns a verdict into a next action. The ratio stays because hiding data
 * from someone about their own week is patronising; the framing changes because
 * framing is the part that decides whether they open the app tomorrow.
 *
 * When every habit is at 100% nothing is singled out. There is no "least good"
 * habit on a perfect week, and inventing one would manufacture a failure.
 */
export function WeekReview({ review }: { review: WeekReviewData }) {
  if (review.idle) {
    return (
      <section className="flex flex-col gap-2.5">
        <h2 className="label-caps text-text-secondary">This week</h2>
        <p className="surface-raised rounded-card border border-border bg-surface px-4 py-3.5 text-small leading-relaxed text-text-muted">
          No days have closed yet this week, so there is nothing to review. Today
          is still today.
        </p>
      </section>
    )
  }

  const percent = Math.round(review.completionRate * 100)

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="label-caps text-text-secondary">Week in review</h2>

      <div className="flex flex-col gap-2.5">
        <div className="surface-raised flex items-center gap-4 rounded-card border border-border bg-surface px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="label-caps text-text-muted">Completed</p>
            <p className="mt-0.5 flex items-baseline gap-1.5">
              <span className="stat-numerals text-stat text-text-primary">{percent}%</span>
              {/* "of N" counts habit-days, not days: three habits over three
                  closed days is nine chances, not nine days. Saying "days"
                  here made the figure disagree with the calendar on screen. */}
              <span className="text-small tabular-nums text-text-muted">
                of {review.due} due, through yesterday
              </span>
            </p>
          </div>
        </div>

        {review.best && (
          <div className="surface-raised flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3.5">
            <Flame streak={review.best.streak} size={30} />
            <div className="min-w-0 flex-1">
              <p className="label-caps text-text-muted">Going best</p>
              <p className="mt-0.5 truncate text-body font-medium text-text-primary">
                {review.best.habit.name}
              </p>
            </div>
            <span className="stat-numerals shrink-0 text-lead text-text-primary">
              {review.best.streak}
            </span>
          </div>
        )}

        {review.needsAttention ? (
          <Link
            to={`/habits/${review.needsAttention.habit.id}`}
            className="surface-raised flex flex-col gap-1 rounded-card border border-border bg-surface px-4 py-3.5 transition-colors duration-fast hover:border-border-interactive/60"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="label-caps text-text-muted">Finding it hard</p>
              <span className="shrink-0 text-micro tabular-nums text-text-muted">
                {review.needsAttention.completed + review.needsAttention.partial} of{' '}
                {review.needsAttention.due}
              </span>
            </div>
            <p className="truncate text-body font-medium text-text-primary">
              {review.needsAttention.habit.name}
            </p>
            {/* The two-minute version, not a miss count. This is the one place
                the app names a struggling habit, so it names the way back in
                rather than the size of the hole. */}
            <p className="text-small leading-relaxed text-text-muted">
              <span className="text-text-secondary">Try just:</span>{' '}
              {review.needsAttention.habit.minimumVersion}
            </p>
          </Link>
        ) : (
          <p className="surface-raised rounded-card border border-border bg-surface px-4 py-3.5 text-small leading-relaxed text-text-muted">
            Nothing is struggling this week — every habit is on track.
          </p>
        )}
      </div>
    </section>
  )
}
