import { useEffect, useId, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  validateHabitDraft,
  type HabitDraft,
  type HabitFieldErrors,
  MINIMUM_VERSION_MAX,
  NAME_MAX,
} from '@/domain/habitValidation'
import { WEEKDAY_NAMES } from '@/domain/schedule'
import { DIFFICULTY_LABELS, type DifficultyTier, type Schedule, type Weekday } from '@/domain/types'
import {
  createHabit,
  deleteHabitPermanently,
  getHabit,
  updateHabit,
} from '@/data/repos/habitRepo'
import { systemClock } from '@/services/clock'
import { useApp } from '@/state/AppContext'
import { Button, Field, SegmentedControl, TextArea, TextInput } from '@/components/ui'
import { GemPicker } from '@/components/icons/GemPicker'
import { DEFAULT_HABIT_ICON } from '@/domain/types'

const EMPTY_DRAFT: HabitDraft = {
  name: '',
  category: '',
  difficulty: 2,
  schedule: { kind: 'daily' },
  minimumVersion: '',
  icon: DEFAULT_HABIT_ICON,
}

const TIER_COLORS: Record<DifficultyTier, string> = {
  1: 'var(--color-tier-1)',
  2: 'var(--color-tier-2)',
  3: 'var(--color-tier-3)',
  4: 'var(--color-tier-4)',
}

export function HabitEditorRoute() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { today } = useApp()
  const fieldId = useId()

  const isEditing = Boolean(id)
  const [draft, setDraft] = useState<HabitDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<HabitFieldErrors>({})
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      const habit = await getHabit(id)
      if (cancelled) return
      if (!habit) {
        setNotFound(true)
      } else {
        const loaded: HabitDraft = {
          name: habit.name,
          category: habit.category,
          difficulty: habit.difficulty,
          schedule: habit.schedule,
          minimumVersion: habit.minimumVersion,
        }
        loaded.icon = habit.icon ?? DEFAULT_HABIT_ICON
        if (habit.estimatedMinutes !== undefined) loaded.estimatedMinutes = habit.estimatedMinutes
        if (habit.notes !== undefined) loaded.notes = habit.notes
        setDraft(loaded)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const patch = (changes: Partial<HabitDraft>) => {
    setDraft((current) => ({ ...current, ...changes }))
    // Clear errors on the fields being edited: keeping a red message under a
    // field the user is actively fixing just nags.
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(changes)) delete next[key as keyof HabitDraft]
      return next
    })
  }

  const save = async () => {
    const found = validateHabitDraft(draft)
    if (Object.keys(found).length > 0) {
      setErrors(found)
      return
    }

    setSaving(true)
    try {
      const now = systemClock.now()
      if (id) await updateHabit(id, draft, now)
      else await createHabit({ draft, startDayKey: today, instant: now })
      navigate('/habits', { replace: true })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!id) return
    const confirmed = window.confirm(
      'Delete this habit and all of its history permanently?\n\nArchiving keeps the record and hides the habit — that is usually what you want.',
    )
    if (!confirmed) return
    await deleteHabitPermanently(id)
    navigate('/habits', { replace: true })
  }

  if (loading) return <p className="py-8 text-sm text-text-faint">Loading…</p>

  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-4 py-8">
        <p className="text-sm text-legacy-text-muted">That habit no longer exists.</p>
        <Button onClick={() => navigate('/habits', { replace: true })}>Back to habits</Button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-5 pb-8"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <header className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isEditing ? 'Edit habit' : 'New habit'}
        </h1>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Cancel
        </Button>
      </header>

      <Field label="Name" htmlFor={`${fieldId}-name`} error={errors.name}>
        <TextInput
          id={`${fieldId}-name`}
          value={draft.name}
          maxLength={NAME_MAX}
          placeholder="Morning walk"
          invalid={Boolean(errors.name)}
          onChange={(e) => patch({ name: e.target.value })}
          autoFocus={!isEditing}
        />
      </Field>

      <Field
        label="Minimum version"
        hint="The two-minute fallback. What still counts on a day when you have nothing left? This is required — a habit without one has no bad-day path."
        htmlFor={`${fieldId}-minimum`}
        error={errors.minimumVersion}
      >
        <TextInput
          id={`${fieldId}-minimum`}
          value={draft.minimumVersion}
          maxLength={MINIMUM_VERSION_MAX}
          placeholder="Put my shoes on and step outside"
          invalid={Boolean(errors.minimumVersion)}
          onChange={(e) => patch({ minimumVersion: e.target.value })}
        />
      </Field>

      <Field label="Difficulty" hint="Used to weight rewards later.">
        <SegmentedControl
          ariaLabel="Difficulty tier"
          value={draft.difficulty}
          onChange={(difficulty) => patch({ difficulty })}
          options={([1, 2, 3, 4] as DifficultyTier[]).map((tier) => ({
            value: tier,
            label: DIFFICULTY_LABELS[tier],
            accent: TIER_COLORS[tier],
          }))}
        />
      </Field>

      <Field label="Icon" error={errors.icon}>
        <GemPicker
          value={draft.icon ?? DEFAULT_HABIT_ICON}
          onChange={(icon) => patch({ icon })}
        />
      </Field>

      <Field label="Cadence" error={errors.schedule}>
        <ScheduleEditor
          schedule={draft.schedule}
          onChange={(schedule) => patch({ schedule })}
        />
      </Field>

      <Field label="Category" htmlFor={`${fieldId}-category`} error={errors.category}>
        <TextInput
          id={`${fieldId}-category`}
          value={draft.category}
          placeholder="Health, Work, Admin…"
          invalid={Boolean(errors.category)}
          onChange={(e) => patch({ category: e.target.value })}
        />
      </Field>

      <Field
        label="Estimated minutes"
        hint="Optional."
        htmlFor={`${fieldId}-minutes`}
        error={errors.estimatedMinutes}
      >
        <TextInput
          id={`${fieldId}-minutes`}
          type="number"
          inputMode="numeric"
          min={1}
          max={1440}
          value={draft.estimatedMinutes ?? ''}
          placeholder="20"
          invalid={Boolean(errors.estimatedMinutes)}
          onChange={(e) =>
            patch({
              estimatedMinutes: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        />
      </Field>

      <Field label="Notes" hint="Optional." htmlFor={`${fieldId}-notes`} error={errors.notes}>
        <TextArea
          id={`${fieldId}-notes`}
          rows={3}
          value={draft.notes ?? ''}
          invalid={Boolean(errors.notes)}
          onChange={(e) => patch({ notes: e.target.value || undefined })}
        />
      </Field>

      <div className="flex flex-col gap-3 pt-2">
        <Button type="submit" variant="primary" full disabled={saving}>
          {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create habit'}
        </Button>

        {isEditing && (
          <Button variant="danger" full onClick={() => void remove()}>
            Delete permanently
          </Button>
        )}
      </div>
    </form>
  )
}

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: Schedule
  onChange: (schedule: Schedule) => void
}) {
  // Remember the last configuration of each kind, so flipping between tabs to
  // compare options doesn't silently discard the days you already picked.
  const [lastDays, setLastDays] = useState<Weekday[]>(
    schedule.kind === 'specificDays' ? schedule.days : [1, 3, 5],
  )
  const [lastTarget, setLastTarget] = useState<number>(
    schedule.kind === 'timesPerWeek' ? schedule.target : 3,
  )

  const selectKind = (kind: Schedule['kind']) => {
    if (kind === 'daily') onChange({ kind: 'daily' })
    else if (kind === 'timesPerWeek') onChange({ kind: 'timesPerWeek', target: lastTarget })
    else onChange({ kind: 'specificDays', days: lastDays })
  }

  const toggleDay = (day: Weekday) => {
    if (schedule.kind !== 'specificDays') return
    const next = schedule.days.includes(day)
      ? schedule.days.filter((d) => d !== day)
      : [...schedule.days, day].sort((a, b) => a - b)
    setLastDays(next)
    onChange({ kind: 'specificDays', days: next })
  }

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        ariaLabel="Cadence type"
        value={schedule.kind}
        onChange={selectKind}
        options={[
          { value: 'daily', label: 'Daily' },
          { value: 'timesPerWeek', label: 'X per week' },
          { value: 'specificDays', label: 'Set days' },
        ]}
      />

      {schedule.kind === 'timesPerWeek' && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={schedule.target === n}
                onClick={() => {
                  setLastTarget(n)
                  onChange({ kind: 'timesPerWeek', target: n })
                }}
                className={[
                  'h-11 flex-1 rounded-lg border text-sm font-medium transition-colors',
                  schedule.target === n
                    ? 'border-brand bg-brand text-white'
                    : 'border-line bg-surface-raised text-legacy-text-muted hover:bg-surface-hover',
                ].join(' ')}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-text-faint">
            No particular day — you choose when. The streak counts consecutive weeks you hit the
            target, so there's no mid-week deadline to miss.
          </p>
        </div>
      )}

      {schedule.kind === 'specificDays' && (
        <div className="flex gap-1.5">
          {WEEKDAY_NAMES.map((name, index) => {
            const day = index as Weekday
            const selected = schedule.days.includes(day)
            return (
              <button
                key={name}
                type="button"
                aria-pressed={selected}
                aria-label={name}
                onClick={() => toggleDay(day)}
                className={[
                  'h-11 flex-1 rounded-lg border text-xs font-medium transition-colors',
                  selected
                    ? 'border-brand bg-brand text-white'
                    : 'border-line bg-surface-raised text-legacy-text-muted hover:bg-surface-hover',
                ].join(' ')}
              >
                {name.slice(0, 2)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
