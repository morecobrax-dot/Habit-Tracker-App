import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Small shared primitives, on the `tokens.css` palette.
 *
 * Every screen renders through these, which is why they moved first: migrating
 * this one file carried most of the app off the legacy palette at once.
 *
 * Two rules are enforced here rather than left to call sites. Radii come only
 * from the token scale — `rounded-card` for cards, `rounded-md` for buttons,
 * `rounded-sm` for inputs — and no control is smaller than 44px, the iOS
 * comfortable-tap minimum.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

/**
 * No variant sets a red foreground, including `danger`.
 *
 * "No red text, ever" is written as a hard constraint, and a red *label* on a
 * delete button is the most conventional place to break it — which is exactly
 * why it is worth not breaking. `danger` carries its warning the way the rules
 * allow: a full-strength red border and a red-tinted fill, with the label left
 * at `text-primary` so the most important word on a destructive control is also
 * the most legible thing on it. Red as a fill is fine; red as text is not.
 *
 * Glow appears on primary hover only. It is the one button state the design
 * rules sanction, and it reads as the control coming alive under the thumb.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-text-primary hover:bg-primary-hot hover:shadow-glow-subtle active:bg-primary-hot',
  secondary:
    'bg-surface-raise text-text-primary border border-border-interactive/60 hover:bg-surface-raise hover:border-border-interactive active:border-border-interactive',
  ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-raise',
  danger: 'bg-danger/15 text-text-primary border border-danger hover:bg-danger/25',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  full?: boolean
}

export function Button({
  variant = 'secondary',
  full = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-body font-medium',
        'transition-all duration-fast ease-out-soft disabled:cursor-not-allowed disabled:opacity-40',
        BUTTON_VARIANTS[variant],
        full ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    />
  )
}

/**
 * The ordinary card, at the `raised` depth tier.
 *
 * The depth lives here rather than at each call site so that every card in the
 * app sits at the same height by default — the tiers above it (`lifted`,
 * `hero`) are then a deliberate choice made by one or two surfaces per screen,
 * not something a card has to opt into to look finished.
 */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`surface-raised rounded-card border border-border bg-surface p-4 ${className}`}
    >
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  error?: string | undefined
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-body font-medium text-text-primary">
        {label}
      </label>
      {hint && <p className="text-small leading-relaxed text-text-muted">{hint}</p>}
      {children}
      {/*
        Not red text — same hard constraint as the danger button. The red signal
        is on the input's border (`invalid`), and the message itself stays at
        full contrast, which is the accessible arrangement anyway: an error the
        user can read beats an error they can only recognise by its colour.
      */}
      {error && (
        <p role="alert" className="text-small font-medium text-text-primary">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * `border-interactive` rather than `border`: an input's edge *is* its
 * affordance, and WCAG 1.4.11 wants 3:1 for that. The decorative `border`
 * token measures 1.13:1 against surface, which is right for a hairline between
 * rows and wrong for the outline of a control.
 */
const INPUT_BASE =
  'w-full rounded-sm border bg-surface-raise px-3 py-2.5 text-text-primary placeholder:text-text-muted transition-colors duration-fast focus:border-primary-hot focus:outline-none'

export function TextInput({
  invalid = false,
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`${INPUT_BASE} ${invalid ? 'border-danger' : 'border-border-interactive'} ${className}`}
      {...rest}
    />
  )
}

export function TextArea({
  invalid = false,
  className = '',
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={`${INPUT_BASE} resize-y ${invalid ? 'border-danger' : 'border-border-interactive'} ${className}`}
      {...rest}
    />
  )
}

export function Select({
  className = '',
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${INPUT_BASE} border-border-interactive ${className}`} {...rest} />
  )
}

/**
 * A segmented single-choice control — fewer taps than a dropdown on mobile.
 *
 * Selection is carried by fill *and* by weight, so it survives being viewed
 * without colour. `aria-checked` inside a `radiogroup` carries it for screen
 * readers.
 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; accent?: string }[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex gap-1 rounded-sm border border-border bg-surface p-1"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={[
              // 44px minimum: these are dense multi-option rows on a phone.
              // `text-micro` and `nowrap` because four options with accent dots
              // is the worst case — at `text-small` "Moderate" overflows its
              // segment and wraps under its own dot at 375px.
              'min-h-11 flex-1 rounded-xs px-2 text-micro whitespace-nowrap transition-colors duration-fast',
              selected
                ? 'bg-primary font-semibold text-text-primary'
                : 'font-medium text-text-muted hover:bg-surface-raise hover:text-text-primary',
            ].join(' ')}
          >
            {option.accent && !selected && (
              <span
                aria-hidden
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ backgroundColor: option.accent }}
              />
            )}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border-interactive/50 px-6 py-12 text-center">
      <h2 className="text-lead font-medium text-text-primary">{title}</h2>
      <p className="max-w-xs text-body leading-relaxed text-text-muted">{body}</p>
      {action}
    </div>
  )
}

export function Badge({
  children,
  color,
}: {
  children: ReactNode
  color?: string
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xs bg-surface-raise px-2 py-1 text-small text-text-muted"
      style={color ? { color } : undefined}
    >
      {children}
    </span>
  )
}
