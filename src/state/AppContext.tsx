import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { DayContext, DayKey, Settings } from '@/domain/types'
import { DEFAULT_SETTINGS } from '@/domain/types'
import { dayEndInstant, toDayKey } from '@/domain/time/dayKey'
import { db, ensureInitialised, requestPersistentStorage } from '@/data/db'
import { dayContextFrom, systemClock } from '@/services/clock'
import { runRollover, type RolloverOutcome } from '@/services/rolloverService'

interface AppContextValue {
  settings: Settings
  dayContext: DayContext
  /** Today, in the user's reckoning. Re-derived when the day rolls over. */
  today: DayKey
  ready: boolean
  /** Result of the most recent rollover, for the "while you were away" notice. */
  lastRollover: RolloverOutcome | null
  dismissRollover: () => void
}

const AppCtx = createContext<AppContextValue | null>(null)

const FALLBACK_SETTINGS: Settings = { ...DEFAULT_SETTINGS, createdAt: 0, updatedAt: 0 }

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [lastRollover, setLastRollover] = useState<RolloverOutcome | null>(null)

  const settings = useLiveQuery(() => db.settings.get('singleton'), [], undefined)
  const resolved = settings ?? FALLBACK_SETTINGS
  const dayContext = useMemo(() => dayContextFrom(resolved), [resolved])
  const today = useTodayKey(dayContext)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureInitialised(systemClock.now())
      void requestPersistentStorage()
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Settle closed days on start, and again whenever the day rolls over beneath
   * an app that was left open. `runRollover` is idempotent, so re-running it is
   * free — which matters, because StrictMode invokes this twice in development.
   */
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void (async () => {
      const outcome = await runRollover()
      if (cancelled) return
      // Only surface it when something actually happened to the user's streaks.
      if (outcome.freezesSpent.length > 0 || outcome.streaksBroken.length > 0) {
        setLastRollover(outcome)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, today])

  const value = useMemo<AppContextValue>(
    () => ({
      settings: resolved,
      dayContext,
      today,
      ready,
      lastRollover,
      dismissRollover: () => setLastRollover(null),
    }),
    [resolved, dayContext, today, ready, lastRollover],
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
