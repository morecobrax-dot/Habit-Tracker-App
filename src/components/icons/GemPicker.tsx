import { useRef, type KeyboardEvent } from 'react'
import { GEM_IDS, Gem, gemLabel, type GemId } from '@/components/icons/gems'

/**
 * Icon picker — a real radio group, not a grid of divs.
 *
 * Semantics and keyboard behaviour follow the WAI-ARIA radio group pattern:
 *
 *  - `role="radiogroup"` wrapping `role="radio"` options, each with an
 *    accessible name, so a screen reader announces "Hexagon, radio button,
 *    3 of 12" rather than reading twelve unlabelled graphics.
 *  - Roving tabindex: the group is one tab stop. Tab moves past it; arrows
 *    move within it. Twelve separate tab stops would make the form tedious to
 *    traverse with a keyboard.
 *  - Arrow keys move selection as well as focus, which is what a radio group
 *    does. Left/Right step by one, Up/Down by a row, and both wrap. Home and
 *    End jump to the ends.
 *
 * Selection is never signalled by colour alone: the selected option gains a
 * thicker ring, a raised surface, and a check glyph. Any one of those survives
 * greyscale or a colour-vision difference.
 *
 * The 4-column grid holds all twelve without its own scroll area at phone
 * width — a nested scroller inside a scrolling form is a hit-target trap.
 */

const COLUMNS = 4

export interface GemPickerProps {
  value: GemId
  onChange: (id: GemId) => void
  /** Labels the group for assistive technology. */
  ariaLabel?: string
}

export function GemPicker({ value, onChange, ariaLabel = 'Habit icon' }: GemPickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (from: number, delta: number) => {
    const count = GEM_IDS.length
    const next = (from + delta + count) % count
    const id = GEM_IDS[next]
    if (!id) return
    onChange(id)
    refs.current[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
        move(index, 1)
        break
      case 'ArrowLeft':
        move(index, -1)
        break
      case 'ArrowDown':
        move(index, COLUMNS)
        break
      case 'ArrowUp':
        move(index, -COLUMNS)
        break
      case 'Home':
        move(index, -index)
        break
      case 'End':
        move(index, GEM_IDS.length - 1 - index)
        break
      default:
        return
    }
    // Only reached when a key was handled; stops the page scrolling under it.
    event.preventDefault()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid grid-cols-4 gap-2"
    >
      {GEM_IDS.map((id, index) => {
        const selected = id === value
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={gemLabel(id)}
            // Roving tabindex: exactly one option is reachable by Tab.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={[
              'relative flex aspect-square min-h-11 items-center justify-center rounded-sm border transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hot',
              selected
                ? 'border-2 border-border-interactive bg-surface-raise'
                : 'border-border bg-surface hover:border-border-interactive hover:bg-surface-raise',
            ].join(' ')}
          >
            <Gem id={id} size={44} />
            {/* Non-colour selection cue, so the state survives greyscale. */}
            {selected && (
              <span
                aria-hidden
                className="absolute right-1 bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary"
              >
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
                  <path
                    d="M2.5 6.2 L4.8 8.5 L9.5 3.5"
                    stroke="var(--color-text-primary)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
