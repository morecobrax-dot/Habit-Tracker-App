import type { DayKey, FreezeEvent, GameState, Instant, WeekKey } from '@/domain/types'
import { db, type HabitTrackerDb } from '@/data/db'
import { newId } from '@/data/id'

/**
 * Game state and the freeze-token ledger.
 *
 * The token count lives on the singleton `gameState` row; every change to it is
 * mirrored by a `freezeEvents` row recording what it bought. That ledger is what
 * lets the UI say "Tuesday was covered by a freeze" instead of showing an
 * unbroken streak and quietly lying about it.
 */

export async function getGameState(
  database: HabitTrackerDb = db,
): Promise<GameState | undefined> {
  return database.gameState.get('singleton')
}

export async function requireGameState(database: HabitTrackerDb = db): Promise<GameState> {
  const state = await database.gameState.get('singleton')
  if (!state) throw new Error('Game state missing — ensureInitialised has not run')
  return state
}

export async function listFreezeEvents(
  database: HabitTrackerDb = db,
): Promise<FreezeEvent[]> {
  return database.freezeEvents.toArray()
}

export async function listFreezeEventsForHabit(
  habitId: string,
  database: HabitTrackerDb = db,
): Promise<FreezeEvent[]> {
  return database.freezeEvents.where('habitId').equals(habitId).toArray()
}

export async function getFreezeEvent(
  habitId: string,
  dayKey: DayKey,
  database: HabitTrackerDb = db,
): Promise<FreezeEvent | undefined> {
  return database.freezeEvents
    .where('habitId')
    .equals(habitId)
    .filter((event) => event.dayKey === dayKey)
    .first()
}

export interface RolloverCommit {
  /** Tokens granted this run. */
  tokensGranted: number
  /** Week key to record as granted, when a grant happened. */
  grantedWeekKey?: WeekKey | undefined
  /** Freezes to spend, each costing one token. */
  spends: { habitId: string; dayKey: DayKey }[]
  /** New high-water mark for settled days. */
  lastRolloverDayKey: DayKey
  instant: Instant
}

/**
 * Applies a whole rollover in one transaction.
 *
 * Atomic on purpose: a partial apply that deducted tokens without writing the
 * freeze events would silently lose streak protection the user had paid for.
 */
export async function commitRollover(
  commit: RolloverCommit,
  database: HabitTrackerDb = db,
): Promise<GameState> {
  return database.transaction('rw', database.gameState, database.freezeEvents, async () => {
    const state = await database.gameState.get('singleton')
    if (!state) throw new Error('Game state missing — ensureInitialised has not run')

    let tokens = state.freezeTokens + commit.tokensGranted

    for (const spend of commit.spends) {
      if (tokens <= 0) break
      const before = tokens
      tokens -= 1
      const event: FreezeEvent = {
        id: newId(),
        dayKey: spend.dayKey,
        habitId: spend.habitId,
        reason: 'auto_cover_miss',
        tokensBefore: before,
        tokensAfter: tokens,
        createdAt: commit.instant,
      }
      await database.freezeEvents.add(event)
    }

    const next: GameState = {
      ...state,
      freezeTokens: tokens,
      lastRolloverDayKey: commit.lastRolloverDayKey,
    }
    if (commit.grantedWeekKey !== undefined) next.lastFreezeGrantWeekKey = commit.grantedWeekKey

    await database.gameState.put(next)
    return next
  })
}

/**
 * Returns a freeze token and removes its event.
 *
 * Used when a backdated completion makes a previously spent freeze unnecessary:
 * you actually did the thing, so the token should not have been spent.
 */
export async function refundFreeze(
  habitId: string,
  dayKey: DayKey,
  database: HabitTrackerDb = db,
): Promise<boolean> {
  return database.transaction('rw', database.gameState, database.freezeEvents, async () => {
    const events = await database.freezeEvents.where('habitId').equals(habitId).toArray()
    const match = events.find((event) => event.dayKey === dayKey)
    if (!match) return false

    const state = await database.gameState.get('singleton')
    if (!state) throw new Error('Game state missing — ensureInitialised has not run')

    // The event is deleted rather than annotated: the spend should never have
    // happened, so the ledger should not claim the day was frozen.
    await database.freezeEvents.delete(match.id)
    // Deliberately not clamped to `maxFreezeTokens`. The cap governs how many
    // tokens may be *granted*; returning one the user had already earned and
    // that was spent in error is not a grant.
    await database.gameState.put({ ...state, freezeTokens: state.freezeTokens + 1 })
    return true
  })
}
