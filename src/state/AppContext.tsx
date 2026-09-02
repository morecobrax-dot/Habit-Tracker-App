import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { DayContext, DayKey, Settings } from '@/domain/types'
import { DEFAULT_SETTINGS } from '@/domain/types'
import { toDayKey } from '@/domain/time/dayKey'
import { dayEndInstant } from '@/domain/time/dayKey'
import { db, ensureInitialised, requestPersistentStorage } from '@/data/db'
import { dayContextFrom, systemClock } from '@/services/clock'

interface AppContextValue {
  settings: Settings
  dayContext: DayContext
  /** Today, in the user's reckoning. Re-derived when the day rolls over. */
  today: DayKey
  ready: boolean
}

const AppCtx = createContext<AppContextValue | null>(null)

const FALLBACK_SETTINGS: Settings = { ...DEFAULT_SETTINGS, createdAt: 0, updatedAt: 0 }

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureInitialised(systemClock.now())
      // Best-effort: reduces the chance the browser evicts the database.
      void requestPersistentStorage()
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const settings = useLiveQuery(() => db.settings.get('singleton'), [], undefined)
  const resolved = settings ?? FALLBACK_SETTINGS

  const dayContext = useMemo(() => dayContextFrom(resolved), [resolved])

  const today = useTodayKey(dayContext)

  const value = useMemo<AppContextValue>(
    () => ({ settings: resolved, dayContext, today, ready }),
    [resolved, dayContext, today, ready],
  )

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}

/**
 * Today's DayKey, kept current across the day boundary.
 *
 * An installed PWA is frequently left open for days, so a `today` computed once
 * at mount silently goes stale — you would log Tuesday's habits onto Monday.
 * Rather than polling every minute, this schedules a single timeout for the
 * exact instant the day rolls over, and re-checks on wake, since a backgrounded
 * tab's timers are throttled or suspended entirely.
 */
function useTodayKey(ctx: DayContext): DayKey {
  const [today, setToday] = useState(() => toDayKey(systemClock.now(), ctx))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const sync = () => {
      const now = systemClock.now()
      const current = toDayKey(now, ctx)
      setToday((previous) => (previous === current ? previous : current))

      if (timer !== undefined) clearTimeout(timer)
      // setTimeout saturates above ~24.8 days; a day is well inside that, but
      // clamp anyway so a pathological clock can't schedule an immediate loop.
      const msUntilRollover = Math.max(1000, dayEndInstant(current, ctx) - now)
      timer = setTimeout(sync, Math.min(msUntilRollover, 6 * 60 * 60 * 1000))
    }

    sync()

    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [ctx])

  return today
}
