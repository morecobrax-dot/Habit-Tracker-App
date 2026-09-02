import { useId } from 'react'
import type { HabitIconId } from '@/domain/types'
import { DEFAULT_HABIT_ICON, HABIT_ICON_IDS } from '@/domain/types'

/**
 * Gem icon library — original geometric SVG, drawn from scratch.
 *
 * Each gem is three flat planes and one sparkle:
 *   body   the full silhouette, in the base tone
 *   light  an upper facet, in the light tone
 *   deep   a lower facet, in the deep tone
 *
 * No gradients, no photorealism. Facets are clipped to the silhouette so a
 * curved shape (heart, teardrop) keeps a clean edge without hand-fitting every
 * curve twice.
 *
 * ## Legibility at two sizes
 *
 * These render at ~24px on habit cards and ~44px in the picker. Detail that
 * looks refined at 44px turns to mud at 24px, so every gem is built from at
 * most three planes with a single strong silhouette. The rule while drawing
 * these: if the outline alone does not identify the shape, the facets will not
 * rescue it. `/styleguide` renders both sizes side by side for exactly this
 * check.
 *
 * ## Count
 *
 * Twelve, not sixteen. Twelve distinct silhouettes fit a 4x3 grid with room to
 * spare at phone width, so the picker never needs its own scroll area — and
 * fewer options means less time spent choosing an icon instead of doing the
 * habit.
 */


/**
 * The id vocabulary lives in the domain layer, because it is persisted data.
 * This module owns only how each id is drawn.
 */
export type GemId = HabitIconId
export const DEFAULT_GEM = DEFAULT_HABIT_ICON

/**
 * Tone families. Each maps to existing palette tokens — no hex lives here, so
 * a palette change flows through automatically.
 */
export type GemTone = 'gold' | 'primary' | 'maroon'

const TONES: Record<GemTone, { base: string; light: string; deep: string }> = {
  gold: {
    base: 'var(--color-gold)',
    light: 'var(--color-gold-light)',
    deep: 'var(--color-gold-deep)',
  },
  primary: {
    base: 'var(--color-primary)',
    light: 'var(--color-primary-hot)',
    deep: 'var(--color-maroon)',
  },
  maroon: {
    base: 'var(--color-maroon)',
    light: 'var(--color-primary)',
    deep: 'var(--color-border)',
  },
}

interface GemShape {
  label: string
  body: string
  light: string
  deep: string
  sparkle: [number, number]
}

/** A small four-point star. Kept tiny so it reads as a glint, not a decal. */
function sparklePath(x: number, y: number, r = 1.7): string {
  const i = r * 0.32
  return [
    `M${x} ${y - r}`,
    `L${x + i} ${y - i}`,
    `L${x + r} ${y}`,
    `L${x + i} ${y + i}`,
    `L${x} ${y + r}`,
    `L${x - i} ${y + i}`,
    `L${x - r} ${y}`,
    `L${x - i} ${y - i}`,
    'Z',
  ].join(' ')
}

/**
 * All twelve shapes on a 24x24 grid.
 *
 * Facet paths may overrun the silhouette; they are clipped at render time.
 */
const GEMS: Record<GemId, GemShape> = {
  brilliant: {
    label: 'Brilliant',
    body: 'M12 2.5 L18.7 5.3 L21.5 12 L18.7 18.7 L12 21.5 L5.3 18.7 L2.5 12 L5.3 5.3 Z',
    light: 'M12 2.5 L18.7 5.3 L12 12 L5.3 5.3 Z',
    deep: 'M21.5 12 L18.7 18.7 L12 21.5 L12 12 Z',
    sparkle: [8, 7.4],
  },
  square: {
    label: 'Square cut',
    body: 'M7 3 L17 3 L21 7 L21 17 L17 21 L7 21 L3 17 L3 7 Z',
    light: 'M3 7 L7 3 L17 3 L12 12 Z',
    deep: 'M21 17 L17 21 L7 21 L12 12 Z',
    sparkle: [7.6, 7.2],
  },
  emerald: {
    label: 'Emerald cut',
    body: 'M8 2.5 L16 2.5 L19.5 6 L19.5 18 L16 21.5 L8 21.5 L4.5 18 L4.5 6 Z',
    light: 'M7.2 5.4 L16.8 5.4 L16.8 11.2 L7.2 11.2 Z',
    deep: 'M7.2 11.2 L16.8 11.2 L16.8 18.6 L7.2 18.6 Z',
    sparkle: [9.6, 8],
  },
  teardrop: {
    label: 'Teardrop',
    body: 'M12 2.2 C12 2.2 20 10 20 14.4 A8 8 0 0 1 4 14.4 C4 10 12 2.2 12 2.2 Z',
    light: 'M12 2.2 C12 2.2 4 10 4 14.4 L12 14.4 Z',
    deep: 'M12 14.4 L20 14.4 A8 8 0 0 1 12 22.4 Z',
    sparkle: [9, 9.4],
  },
  marquise: {
    label: 'Marquise',
    body: 'M12 2 C15 6 17 9 17 12 C17 15 15 18 12 22 C9 18 7 15 7 12 C7 9 9 6 12 2 Z',
    light: 'M12 2 C9 6 7 9 7 12 L12 12 Z',
    deep: 'M12 22 C15 18 17 15 17 12 L12 12 Z',
    sparkle: [10, 8.6],
  },
  hexagon: {
    label: 'Hexagon',
    body: 'M12 2.5 L20 7 L20 17 L12 21.5 L4 17 L4 7 Z',
    light: 'M12 2.5 L20 7 L12 12 L4 7 Z',
    deep: 'M20 17 L12 21.5 L12 12 Z',
    sparkle: [7.6, 7.4],
  },
  pentagon: {
    label: 'Pentagon',
    body: 'M12 2.5 L21 9.3 L17.6 20 L6.4 20 L3 9.3 Z',
    light: 'M12 2.5 L21 9.3 L12 12 L3 9.3 Z',
    deep: 'M17.6 20 L6.4 20 L12 12 Z',
    sparkle: [7.6, 8.2],
  },
  diamond: {
    label: 'Diamond',
    body: 'M12 2 L21 12 L12 22 L3 12 Z',
    light: 'M12 2 L3 12 L12 12 Z',
    deep: 'M12 22 L21 12 L12 12 Z',
    sparkle: [8.4, 8.6],
  },
  heart: {
    label: 'Heart',
    body: 'M12 21.4 C12 21.4 3.4 14.6 3.4 9.2 A4.9 4.9 0 0 1 12 6.4 A4.9 4.9 0 0 1 20.6 9.2 C20.6 14.6 12 21.4 12 21.4 Z',
    light: 'M12 6.4 A4.9 4.9 0 0 0 3.4 9.2 C3.4 11 4.2 12.8 5.4 14.4 L12 14.4 Z',
    deep: 'M12 14.4 L18.6 14.4 C16.4 17.4 12 21.4 12 21.4 Z',
    sparkle: [8, 9.6],
  },
  shield: {
    label: 'Shield',
    body: 'M12 2.4 L20.5 5.4 L20.5 12 C20.5 17 16.5 20.6 12 21.8 C7.5 20.6 3.5 17 3.5 12 L3.5 5.4 Z',
    light: 'M12 2.4 L3.5 5.4 L3.5 12 L12 12 Z',
    deep: 'M12 12 L20.5 12 C20.5 17 16.5 20.6 12 21.8 Z',
    sparkle: [7.4, 7.6],
  },
  arrow: {
    label: 'Arrow',
    body: 'M12 2 L20.5 12.6 L15.2 12.6 L15.2 21.4 L8.8 21.4 L8.8 12.6 L3.5 12.6 Z',
    light: 'M12 2 L3.5 12.6 L12 12.6 Z',
    deep: 'M12 2 L20.5 12.6 L12 12.6 Z',
    sparkle: [9.2, 8.4],
  },
  trillion: {
    label: 'Trillion',
    body: 'M12 2.8 L21 19.2 L3 19.2 Z',
    light: 'M12 2.8 L6.8 11.6 L17.2 11.6 Z',
    deep: 'M17.2 11.6 L21 19.2 L12 19.2 Z',
    sparkle: [10.5, 10.4],
  },
}

/** Ordered by the domain list, so the picker order is stable and data-driven. */
export const GEM_IDS: readonly GemId[] = HABIT_ICON_IDS

export function gemLabel(id: GemId): string {
  return GEMS[id].label
}

export interface GemProps {
  id: GemId
  /** Rendered size in px. 24 on cards, 44 in the picker. */
  size?: number
  tone?: GemTone
  /**
   * Accessible name. Omit for decorative use beside a text label, which is the
   * normal case on a habit card — the habit's name already says what it is.
   */
  title?: string
  className?: string
}

export function Gem({ id, size = 24, tone = 'gold', title, className }: GemProps) {
  const shape = GEMS[id] ?? GEMS[DEFAULT_GEM]
  const clipId = useId()
  const palette = TONES[tone]

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={clipId}>
          <path d={shape.body} />
        </clipPath>
      </defs>
      <path d={shape.body} fill={palette.base} />
      <g clipPath={`url(#${clipId})`}>
        <path d={shape.light} fill={palette.light} />
        <path d={shape.deep} fill={palette.deep} />
      </g>
      <path
        d={sparklePath(shape.sparkle[0], shape.sparkle[1])}
        fill="var(--color-text-primary)"
        opacity="0.9"
      />
    </svg>
  )
}
