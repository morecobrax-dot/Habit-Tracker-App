import { useEffect, useRef, useState } from 'react'
import { flameTierFor, type FlameTier } from '@/domain/flameTier'

/**
 * The streak flame — the home page's visual anchor.
 *
 * Flat bold art, not fire simulation: one clean silhouette, one soft inner
 * core, and a thin dark outline. The outline matters more than it sounds —
 * without it, a bright flame sitting inside its own coloured glow loses its
 * edge and turns into a blob. Drawing it in the page background colour cuts a
 * crisp boundary between the shape and its halo.
 *
 * Tier decides colour and glow strength, and comes from `domain/flameTier`.
 * This component owns only how a tier *looks*; what a streak has earned is
 * game logic and is tested separately.
 *
 * Motion is transform and opacity only, and every animation is behind a
 * `prefers-reduced-motion` guard in `styles/index.css`.
 */

/** Tall rather than square: a flame in a square box wastes half its height. */
const VIEW_W = 24
const VIEW_H = 30

/** Outer silhouette — symmetric, smooth, no licks or wisps to muddy it small. */
const BODY =
  'M12 1.4 C13.7 6.4 16.6 8.9 18.2 12 C19.6 14.8 20 17.7 18.9 20.6 ' +
  'C17.5 24.5 14.1 27.1 12 27.1 C9.9 27.1 6.5 24.5 5.1 20.6 ' +
  'C4 17.7 4.4 14.8 5.8 12 C7.4 8.9 10.3 6.4 12 1.4 Z'

/** Inner core — the same shape, smaller and sitting low, as a hotter centre. */
const CORE =
  'M12 12.4 C12.9 15.1 14.4 16.6 15.2 18.3 C15.9 19.9 15.9 21.5 15.2 23 ' +
  'C14.4 24.8 12.9 25.9 12 25.9 C11.1 25.9 9.6 24.8 8.8 23 ' +
  'C8.1 21.5 8.1 19.9 8.8 18.3 C9.6 16.6 11.1 15.1 12 12.4 Z'

/**
 * Glow classes written out in full.
 *
 * Tailwind scans source text for literal class names, so a template literal
 * like `drop-shadow-flame-${tier}` is invisible to it and the utility is never
 * generated. Writing them out is the difference between a glow and nothing.
 */
const GLOW_CLASS: Record<FlameTier, string> = {
  0: '',
  1: 'drop-shadow-flame-1',
  2: 'drop-shadow-flame-2',
  3: 'drop-shadow-flame-3',
  4: 'drop-shadow-flame-4',
  5: 'drop-shadow-flame-5',
}

export interface FlameProps {
  /** Current streak length. Tier is derived from it. */
  streak: number
  /** Rendered height in px. Width follows the aspect ratio. */
  size?: number
  /**
   * Accessible name. Omit where an adjacent label already states the streak,
   * which is the usual case — otherwise a screen reader hears the number twice.
   */
  title?: string
  className?: string
}

export function Flame({ streak, size = 32, title, className }: FlameProps) {
  const tier = flameTierFor(streak)
  const pulsing = useTierUpPulse(tier)

  const lit = tier > 0
  const width = Math.round((size * VIEW_W) / VIEW_H)

  /*
   * The outline exists to hold the silhouette apart from its own glow, so it
   * wants constant *visual* weight — roughly 1.5 device pixels at any size.
   * A fixed stroke-width in viewBox units would instead scale with the flame,
   * reading as a hairline when small and a heavy cartoon border at hero size.
   * Clamped so extreme sizes stay sane.
   */
  const strokeWidth = Math.min(2.2, Math.max(0.5, (1.5 * VIEW_H) / size))

  return (
    <span
      className={[
        'inline-flex shrink-0',
        // Glow lives on the wrapper so it surrounds the shape rather than
        // being clipped by the SVG box.
        GLOW_CLASS[tier],
        pulsing ? 'flame-pulse' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        width={width}
        height={size}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        focusable="false"
        // An unlit flame is dormant, not absent: dimmed rather than hidden, so
        // the space it will occupy is already visible on day zero.
        style={lit ? undefined : { opacity: 0.4 }}
      >
        {title && <title>{title}</title>}
        <g className={lit ? 'flame-flicker' : undefined}>
          <path
            d={BODY}
            fill={`var(--color-flame-${tier})`}
            stroke="var(--color-bg-base)"
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
          <path d={CORE} fill={`var(--color-flame-${tier}-core)`} />
        </g>
      </svg>
    </span>
  )
}

/**
 * Fires a one-shot pulse when the tier climbs.
 *
 * Only on an increase. Tiers cannot fall through normal use, but a corrupted
 * streak or a reset must never trigger a celebration, and celebrating the
 * first render would fire on every page load.
 */
function useTierUpPulse(tier: FlameTier): boolean {
  const previous = useRef<FlameTier | null>(null)
  const [pulsing, setPulsing] = useState(false)

  useEffect(() => {
    const before = previous.current
    previous.current = tier

    if (before === null || tier <= before) return

    setPulsing(true)
    const timer = setTimeout(() => setPulsing(false), 700)
    return () => clearTimeout(timer)
  }, [tier])

  return pulsing
}
