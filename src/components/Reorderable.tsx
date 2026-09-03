import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Drag-to-reorder with a real keyboard path.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, which does not fire
 * on touch at all — a drag feature that only works with a mouse is no feature
 * on a phone-first app.
 *
 * ## The handle is focusable and the arrows move the row
 *
 * A drag handle that only responds to pointers locks out keyboard and switch
 * users entirely, and reordering is not decoration here: the list order is the
 * order habits appear on the home screen. So the handle is a button; arrow keys
 * move its row; and every move is announced through a live region, because a
 * change you cannot see and are not told about has not happened as far as a
 * screen-reader user is concerned.
 *
 * Ordering is committed to storage only when the gesture ends, so a drag across
 * five positions is one write rather than five.
 */

export interface ReorderableProps<T> {
  items: readonly T[]
  keyOf: (item: T) => string
  /** Called once per completed gesture with the full new order. */
  onReorder: (orderedKeys: string[]) => void
  children: (item: T, handle: HandleProps, state: { dragging: boolean }) => ReactNode
  /** Describes an item for the live region, e.g. its name. */
  labelOf: (item: T) => string
}

export interface HandleProps {
  ref: (node: HTMLElement | null) => void
  onPointerDown: (event: React.PointerEvent) => void
  onKeyDown: (event: React.KeyboardEvent) => void
  'aria-label': string
  tabIndex: 0
  type: 'button'
}

export function Reorderable<T>({
  items,
  keyOf,
  onReorder,
  labelOf,
  children,
}: ReorderableProps<T>) {
  // Local order so the list reacts under the finger; storage catches up on
  // release. Re-synced whenever the incoming list changes identity.
  const [order, setOrder] = useState<string[]>(() => items.map(keyOf))
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const incoming = items.map(keyOf).join('|')
  useEffect(() => {
    setOrder(items.map(keyOf))
    // `incoming` is the identity of the list; `items`/`keyOf` are recreated
    // every render and would restart this on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])

  const rowRefs = useRef(new Map<string, HTMLElement>())
  const gesture = useRef<{ key: string; from: number } | null>(null)

  const byKey = new Map(items.map((item) => [keyOf(item), item]))
  const ordered = order.map((key) => byKey.get(key)).filter((item): item is T => item !== undefined)

  const move = useCallback(
    (key: string, to: number, commit: boolean) => {
      setOrder((current) => {
        const from = current.indexOf(key)
        if (from === -1 || to < 0 || to >= current.length || to === from) return current
        const next = [...current]
        next.splice(from, 1)
        next.splice(to, 0, key)
        if (commit) onReorder(next)
        return next
      })
    },
    [onReorder],
  )

  const onKeyDown = (key: string) => (event: React.KeyboardEvent) => {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (delta === 0) return
    event.preventDefault()

    const from = order.indexOf(key)
    const to = from + delta
    if (to < 0 || to >= order.length) return

    move(key, to, true)
    const item = byKey.get(key)
    if (item) setAnnouncement(`${labelOf(item)} moved to position ${to + 1} of ${order.length}`)

    // Keep focus on the handle that just moved, so a run of presses works.
    requestAnimationFrame(() => {
      rowRefs.current.get(key)?.querySelector<HTMLElement>('[data-reorder-handle]')?.focus()
    })
  }

  const onPointerDown = (key: string) => (event: React.PointerEvent) => {
    // Primary button / single touch only: a right-click or a second finger
    // mid-drag should not start a competing gesture.
    if (event.button !== 0) return
    event.preventDefault()
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
    gesture.current = { key, from: order.indexOf(key) }
    setDraggingKey(key)
  }

  useEffect(() => {
    if (draggingKey === null) return

    const onMove = (event: PointerEvent) => {
      const current = gesture.current
      if (!current) return

      // Hit-test against the rows themselves rather than tracking offsets:
      // rows here are different heights, so a fixed row-height assumption
      // would drift further the longer the drag went on.
      const target = order.findIndex((key) => {
        const node = rowRefs.current.get(key)
        if (!node) return false
        const box = node.getBoundingClientRect()
        return event.clientY >= box.top && event.clientY <= box.bottom
      })
      if (target !== -1) move(current.key, target, false)
    }

    const onUp = () => {
      const current = gesture.current
      gesture.current = null
      setDraggingKey(null)
      if (!current) return

      setOrder((latest) => {
        if (latest.indexOf(current.key) !== current.from) onReorder(latest)
        return latest
      })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [draggingKey, order, move, onReorder])

  return (
    <>
      <ul className="flex flex-col gap-2.5">
        {ordered.map((item, index) => {
          const key = keyOf(item)
          const handle: HandleProps = {
            ref: () => {},
            onPointerDown: onPointerDown(key),
            onKeyDown: onKeyDown(key),
            'aria-label': `Reorder ${labelOf(item)}. Position ${index + 1} of ${ordered.length}. Use the up and down arrow keys to move it.`,
            tabIndex: 0,
            type: 'button',
          }
          return (
            <li
              key={key}
              ref={(node) => {
                if (node) rowRefs.current.set(key, node)
                else rowRefs.current.delete(key)
              }}
              // `touch-none` on the row stops the browser scrolling the page
              // when the drag starts on the handle.
              className={draggingKey === key ? 'relative z-10 touch-none' : ''}
            >
              {children(item, handle, { dragging: draggingKey === key })}
            </li>
          )
        })}
      </ul>

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  )
}

/** The grip itself. Six dots, the near-universal signal for "drag me". */
export function DragHandle({
  handle,
  dragging,
}: {
  handle: HandleProps
  dragging: boolean
}) {
  const { ref: _ref, ...rest } = handle
  return (
    <button
      {...rest}
      data-reorder-handle
      className={[
        // 44px target on a control that is easy to miss and annoying to miss.
        'flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-xs',
        'transition-colors duration-fast',
        dragging
          ? 'cursor-grabbing bg-surface-raise text-text-primary'
          : 'text-text-muted hover:bg-surface-raise hover:text-text-secondary',
      ].join(' ')}
    >
      <svg viewBox="0 0 10 16" className="h-4 w-2.5" fill="currentColor" aria-hidden>
        {[3, 8, 13].map((y) =>
          [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.15" />),
        )}
      </svg>
    </button>
  )
}
