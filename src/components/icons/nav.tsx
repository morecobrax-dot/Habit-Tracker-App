/**
 * Bottom-navigation icons.
 *
 * Deliberately plain single-weight strokes, and deliberately *not* gems or
 * flames: gold belongs to habit icons and flame hues to the streak ladder, so
 * borrowing either here would leak two reserved vocabularies into chrome. These
 * take their colour from the surrounding text, so the tab's active state is the
 * only thing that decides how they look.
 *
 * A flame for "Today" was the obvious choice and is the reason not to — the
 * flame already means "streak", and a second meaning would dilute the first.
 */

type IconProps = { className?: string }

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false',
} as const

/** A check in a circle — the completion action, which is what Today is for. */
export function TodayIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M8.25 12.25l2.6 2.6 5-5.4" />
    </svg>
  )
}

/** Stacked rows — the list of things you keep. */
export function HabitsIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M4.5 7h15M4.5 12h15M4.5 17h9" />
      <circle cx="4.5" cy="7" r="0.1" />
    </svg>
  )
}

/** Sliders rather than a gear: a gear's teeth turn to mush below 20px. */
export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M4.5 8h15M4.5 16h15" />
      <circle cx="9.5" cy="8" r="2.25" />
      <circle cx="15" cy="16" r="2.25" />
    </svg>
  )
}
