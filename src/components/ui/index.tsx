import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** Small shared primitives. Deliberately plain — no component library yet. */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong active:bg-brand-strong',
  secondary:
    'bg-surface-raised text-text border border-line hover:bg-surface-hover active:bg-surface-hover',
  ghost: 'bg-transparent text-legacy-text-muted hover:text-text hover:bg-surface-raised',
  danger: 'bg-danger-dim text-legacy-danger border border-legacy-danger/40 hover:bg-legacy-danger/20',
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
        // 44px min height: the iOS minimum comfortable tap target.
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        BUTTON_VARIANTS[variant],
        full ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    />
  )
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-line bg-legacy-surface p-4 ${className}`}>{children}</div>
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
      <label htmlFor={htmlFor} className="text-sm font-medium text-text">
        {label}
      </label>
      {hint && <p className="text-xs leading-relaxed text-text-faint">{hint}</p>}
      {children}
      {error && (
        <p role="alert" className="text-xs text-legacy-danger">
          {error}
        </p>
      )}
    </div>
  )
}

const INPUT_BASE =
  'w-full rounded-xl border bg-surface-raised px-3 py-2.5 text-text placeholder:text-text-faint transition-colors focus:border-brand focus:outline-none'

export function TextInput({
  invalid = false,
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`${INPUT_BASE} ${invalid ? 'border-legacy-danger' : 'border-line'} ${className}`}
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
      className={`${INPUT_BASE} resize-y ${invalid ? 'border-legacy-danger' : 'border-line'} ${className}`}
      {...rest}
    />
  )
}

export function Select({
  className = '',
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${INPUT_BASE} border-line ${className}`} {...rest} />
}

/** A segmented single-choice control — fewer taps than a dropdown on mobile. */
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
      className="flex gap-1 rounded-xl border border-line bg-surface-raised p-1"
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
              'min-h-11 flex-1 rounded-lg px-2 text-xs font-medium transition-colors',
              selected ? 'bg-brand text-white' : 'text-legacy-text-muted hover:bg-surface-hover',
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
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <h2 className="text-base font-medium text-text">{title}</h2>
      <p className="max-w-xs text-sm leading-relaxed text-legacy-text-muted">{body}</p>
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
      className="inline-flex items-center gap-1.5 rounded-md bg-surface-raised px-2 py-1 text-xs text-legacy-text-muted"
      style={color ? { color } : undefined}
    >
      {children}
    </span>
  )
}
