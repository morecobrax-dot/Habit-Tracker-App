import { useRef, useState } from 'react'
import { toDayKey } from '@/domain/time/dayKey'
import { WEEKDAY_NAMES } from '@/domain/schedule'
import type { Weekday } from '@/domain/types'
import { updateSettings, deviceTimeZone } from '@/data/repos/settingsRepo'
import {
  backupFilename,
  clearAllData,
  exportBackup,
  importBackup,
  parseBackup,
} from '@/data/backup'
import { systemClock } from '@/services/clock'
import { useApp } from '@/state/AppContext'
import { Button, Card, Field, SegmentedControl, Select } from '@/components/ui'

export function SettingsRoute() {
  const { settings, dayContext, today } = useApp()

  return (
    <div className="flex flex-col gap-5 pb-6">
      <header className="pt-2">
        <h1 className="text-title font-semibold tracking-tight">Settings</h1>
      </header>

      <Card className="flex flex-col gap-5">
        <h2 className="label-caps text-text-secondary">Your day</h2>

        <Field
          label="A new day starts at"
          hint="Logging at 1am should credit the day you just lived, not the one that technically just started. Everything — streaks, history, the day rollover — uses this boundary."
        >
          <Select
            value={settings.dayStartHour}
            onChange={(e) =>
              void updateSettings({ dayStartHour: Number(e.target.value) }, systemClock.now())
            }
          >
            {Array.from({ length: 13 }, (_, hour) => (
              <option key={hour} value={hour}>
                {hour === 0 ? 'Midnight' : `${String(hour).padStart(2, '0')}:00`}
                {hour === 4 ? ' (default)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Weeks start on">
          <SegmentedControl
            ariaLabel="Week start day"
            value={settings.weekStartsOn}
            onChange={(weekStartsOn) =>
              void updateSettings({ weekStartsOn: weekStartsOn as Weekday }, systemClock.now())
            }
            options={[
              { value: 1, label: 'Monday' },
              { value: 0, label: 'Sunday' },
            ]}
          />
        </Field>

        <Field
          label="Timezone"
          hint="Following the device is right for most people. Pinning to one zone keeps your days consistent if you travel but still think in home time."
        >
          <Select
            value={settings.timeZone}
            onChange={(e) => void updateSettings({ timeZone: e.target.value }, systemClock.now())}
          >
            <option value="auto">Follow this device ({deviceTimeZone()})</option>
            <option value={deviceTimeZone()}>Pin to {deviceTimeZone()}</option>
            {deviceTimeZone() !== 'UTC' && <option value="UTC">Pin to UTC</option>}
          </Select>
        </Field>

        <div className="rounded-card border border-border bg-surface-raise px-3 py-2.5 text-micro leading-relaxed text-text-muted">
          Right now it is <span className="text-text-secondary">{today}</span> for you. This day ends at{' '}
          <span className="text-text-secondary">
            {String(dayContext.dayStartHour).padStart(2, '0')}:00
          </span>{' '}
          tomorrow in {dayContext.timeZone}.
          {toDayKey(systemClock.now(), { ...dayContext, dayStartHour: 0 }) !== today && (
            <>
              {' '}
              The calendar date is already{' '}
              <span className="text-text-secondary">
                {toDayKey(systemClock.now(), { ...dayContext, dayStartHour: 0 })}
              </span>
              , but your day hasn't rolled over yet.
            </>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="label-caps text-text-secondary">Logging</h2>
        <Field
          label="Backdating window"
          hint="How far back you can log. Kept short on purpose: reconstructing last week from memory is fiction, and fiction in the log makes every number downstream meaningless."
        >
          <Select
            value={settings.backdateWindowDays}
            onChange={(e) =>
              void updateSettings({ backdateWindowDays: Number(e.target.value) }, systemClock.now())
            }
          >
            <option value={0}>Today only</option>
            <option value={1}>1 day back</option>
            <option value={2}>2 days back (default)</option>
            <option value={3}>3 days back</option>
          </Select>
        </Field>
      </Card>

      <DataCard />

      <p className="px-1 text-micro leading-relaxed text-text-muted">
        Everything is stored on this device only. Nothing is uploaded, and there is no account.
        {' '}
        {WEEKDAY_NAMES[settings.weekStartsOn]}-start weeks.
      </p>
    </div>
  )
}

/**
 * Export and import.
 *
 * With no backend, a lost phone or a cleared site-data setting is total data
 * loss. This is the only recovery path, which is why it ships in phase 1 rather
 * than waiting for polish.
 */
function DataCard() {
  const { dayContext } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const doExport = async () => {
    setBusy(true)
    try {
      const now = systemClock.now()
      const backup = await exportBackup(now)
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = backupFilename(now, dayContext.timeZone)
      anchor.click()
      URL.revokeObjectURL(url)
      setStatus({ tone: 'ok', message: 'Backup downloaded.' })
    } catch (error) {
      setStatus({ tone: 'error', message: describeError(error) })
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (file: File) => {
    setBusy(true)
    try {
      const backup = parseBackup(await file.text())
      const counts = Object.entries(backup.tables)
        .map(([name, rows]) => `${(rows as unknown[]).length} ${name}`)
        .join(', ')
      const confirmed = window.confirm(
        `Replace everything on this device with the contents of this backup?\n\n${counts}\n\nThis cannot be undone.`,
      )
      if (!confirmed) return
      await importBackup(backup)
      setStatus({ tone: 'ok', message: 'Backup restored.' })
    } catch (error) {
      setStatus({ tone: 'error', message: describeError(error) })
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const doReset = async () => {
    const confirmed = window.confirm(
      'Delete every habit and all history on this device?\n\nExport a backup first if you might want any of it back. This cannot be undone.',
    )
    if (!confirmed) return
    setBusy(true)
    try {
      await clearAllData()
      setStatus({ tone: 'ok', message: 'All data cleared.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="label-caps text-text-secondary">Your data</h2>
        <p className="mt-2 text-micro leading-relaxed text-text-muted">
          This app has no backend, so this device is the only copy. Browsers can evict local storage
          under pressure. Export occasionally.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button full onClick={() => void doExport()} disabled={busy}>
          Export backup
        </Button>
        <Button full onClick={() => fileInput.current?.click()} disabled={busy}>
          Import backup
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void doImport(file)
          }}
        />
      </div>

      {status && (
        <p
          role="status"
          /* Failure is carried by weight rather than by red text. */
          className={`text-micro ${status.tone === 'ok' ? 'text-text-secondary' : 'font-semibold text-text-primary'}`}
        >
          {status.message}
        </p>
      )}

      <Button variant="danger" full onClick={() => void doReset()} disabled={busy}>
        Delete all data
      </Button>
    </Card>
  )
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
