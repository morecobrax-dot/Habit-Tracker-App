/**
 * Loading placeholders shaped like the content they stand in for.
 *
 * The point is not decoration, it is *dimensions*. Every screen here reads
 * IndexedDB before it can render anything, and the previous "Loading…" line
 * collapsed to a single row of text before expanding into a full page — the
 * layout jump this replaces. A skeleton that is the wrong size just moves the
 * jump later, so these mirror the real components' heights and rhythm.
 */

export function SkeletonBlock({
  className = '',
  radius = 'sm',
}: {
  className?: string
  radius?: 'xs' | 'sm' | 'card' | 'full'
}) {
  const RADIUS = {
    xs: 'rounded-xs',
    sm: 'rounded-sm',
    card: 'rounded-card',
    full: 'rounded-full',
  } as const
  return <div aria-hidden className={`skeleton ${RADIUS[radius]} ${className}`} />
}

/**
 * The home screen while it loads.
 *
 * `role="status"` with a polite live region announces the wait once, rather
 * than leaving a screen reader on a page that reads as empty.
 */
export function TodaySkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6 pb-4">
      <span className="sr-only">Loading your day</span>

      {/* Level strip */}
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-baseline justify-between">
          <SkeletonBlock className="h-4 w-20" />
          <SkeletonBlock className="h-3 w-32" />
        </div>
        <SkeletonBlock className="h-2 w-full" radius="full" />
      </div>

      {/* Streak hero */}
      <div className="flex flex-col items-center gap-2 py-1">
        <SkeletonBlock className="h-[92px] w-[74px]" radius="card" />
        <SkeletonBlock className="h-10 w-24" />
        <SkeletonBlock className="h-3 w-28" />
      </div>

      {/* Focus card */}
      <SkeletonBlock className="h-52 w-full" radius="card" />

      {/* Habit rows */}
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-40 w-full" radius="card" />
      </div>
    </div>
  )
}

export function HabitListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-5 pb-6">
      <span className="sr-only">Loading your habits</span>

      <div className="flex items-start justify-between pt-2">
        <div className="flex flex-col gap-2">
          <SkeletonBlock className="h-7 w-32" />
          <SkeletonBlock className="h-3 w-20" />
        </div>
        <SkeletonBlock className="h-11 w-28" radius="sm" />
      </div>

      <div className="flex flex-col gap-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonBlock key={i} className="h-28 w-full" radius="card" />
        ))}
      </div>
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6 pb-6">
      <span className="sr-only">Loading habit</span>
      <div className="flex flex-col gap-2 pt-2">
        <SkeletonBlock className="h-7 w-48" />
        <SkeletonBlock className="h-3 w-32" />
      </div>
      <SkeletonBlock className="h-24 w-full" radius="card" />
      <SkeletonBlock className="h-44 w-full" radius="card" />
    </div>
  )
}
