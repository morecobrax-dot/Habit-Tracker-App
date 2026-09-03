/**
 * Core entity types.
 *
 * These describe *data*, deliberately, and not behaviour. Schedules and rules
 * are plain serialisable values so that a future AI planning layer can emit
 * them as JSON and drop them in without any code changes here.
 */

/**
 * A calendar day in the user's own reckoning, formatted `YYYY-MM-DD`.
 *
 * This is NOT necessarily the UTC date, nor even the local calendar date: it is
 * the local date after shifting back by `dayStartHour` (default 04:00), so that
 * logging something at 01:30 credits the day you just lived rather than the one
 * that technically started 90 minutes ago.
 *
 * Every scheduling, streak and history calculation works in DayKey space.
 * Converting in and out happens at exactly two places: when a log is written,
 * and when a date is rendered. See `domain/time/dayKey.ts`.
 */
export type DayKey = string

/**
 * A week bucket, identified by the DayKey the week starts on with a `W` prefix
 * (e.g. `W2026-08-31`). Not ISO week numbering — see `domain/time/week.ts` for
 * why.
 */
export type WeekKey = string

/** Milliseconds since the Unix epoch. */
export type Instant = number

/** An IANA timezone identifier, e.g. `Europe/London`. */
export type TimeZone = string

/** 0 = Sunday .. 6 = Saturday. Matches `Date.prototype.getDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

/**
 * Difficulty tier. Drives base XP in phase 3, but is stored here because it is
 * a property of the habit, not of the game rules — the same tier can be worth
 * different XP under different rulesets.
 */
export type DifficultyTier = 1 | 2 | 3 | 4

export const DIFFICULTY_LABELS: Record<DifficultyTier, string> = {
  1: 'Trivial',
  2: 'Light',
  3: 'Moderate',
  4: 'Heavy',
}

/**
 * How often a habit is expected. A discriminated union so that adding a new
 * cadence is a type error everywhere it needs handling, rather than a silent
 * fallthrough.
 */
export type Schedule =
  | { kind: 'daily' }
  | { kind: 'timesPerWeek'; target: number }
  | { kind: 'specificDays'; days: Weekday[] }

export type HabitStatus = 'active' | 'archived'

/** A stretch during which a habit was archived. `to: null` means still archived. */
export interface ArchivedPeriod {
  from: DayKey
  to: DayKey | null
}

/** A cadence and the day it took effect. */
export interface ScheduleChange {
  from: DayKey
  schedule: Schedule
}

/**
 * Identifier for a habit's gem icon.
 *
 * The vocabulary lives in the domain because it is *persisted data*: it is
 * written to IndexedDB and travels in backups. The SVG that draws each gem
 * lives in `components/icons/gems.tsx`, which imports this type — never the
 * other way round, since the domain layer may not depend on UI.
 */
export type HabitIconId =
  | 'brilliant'
  | 'square'
  | 'emerald'
  | 'teardrop'
  | 'marquise'
  | 'hexagon'
  | 'pentagon'
  | 'diamond'
  | 'heart'
  | 'shield'
  | 'arrow'
  | 'trillion'

export const HABIT_ICON_IDS: readonly HabitIconId[] = [
  'brilliant', 'square', 'emerald', 'teardrop', 'marquise', 'hexagon',
  'pentagon', 'diamond', 'heart', 'shield', 'arrow', 'trillion',
]

/** Used when a habit has no icon of its own — including every habit that
 *  existed before icons did. */
export const DEFAULT_HABIT_ICON: HabitIconId = 'brilliant'

export interface Habit {
  id: string
  name: string
  category: string
  difficulty: DifficultyTier
  schedule: Schedule

  /**
   * The two-minute fallback. Required, and required to be non-empty: a habit
   * without a defined minimum version has no bad-day path, which is the whole
   * point of the app.
   */
  minimumVersion: string

  /** Optional time estimate, used later for "what fits in five minutes". */
  estimatedMinutes?: number

  /**
   * Chosen gem icon. Optional by design: habits created before icons existed
   * have no value here and fall back to `DEFAULT_HABIT_ICON`. Non-indexed, so
   * adding it needed no Dexie schema change and no migration.
   */
  icon?: HabitIconId

  status: HabitStatus

  /**
   * First day this habit counts as scheduled. Prevents history from claiming
   * you missed a habit on days before it existed.
   */
  startDayKey: DayKey

  /**
   * Stretches during which the habit was archived.
   *
   * Archiving is a deliberate pause, not a failure, so days inside these
   * ranges are treated as not-scheduled: they cannot be missed and they cannot
   * break a streak. An open range (`to: null`) means currently archived.
   *
   * Optional and additive. Habits archived before this existed have no ranges
   * and keep their previous behaviour, so no migration is required.
   */
  archivedPeriods?: ArchivedPeriod[]

  /**
   * Past cadences, each with the day it took effect.
   *
   * `schedule` above is always the *current* cadence. This records what came
   * before it, so a day in the past is judged by the cadence that was actually
   * in force then rather than by whatever the habit looks like today.
   *
   * Optional and additive: an absent history means the current schedule has
   * always applied, which is exactly the old behaviour.
   */
  scheduleHistory?: ScheduleChange[]

  sortOrder: number
  notes?: string

  createdAt: Instant
  updatedAt: Instant
  archivedAt?: Instant
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

/**
 * `skip` is bookkeeping only: it earns nothing and protects nothing. It exists
 * so the data can distinguish "consciously declined" from "never opened the
 * app", which is real signal for neglect scoring and for the future AI layer.
 */
export type LogOutcome = 'complete' | 'partial' | 'skip'

/** Records whether a partial was the defined minimum version or something else. */
export type PartialKind = 'minimum' | 'other'

/** Transparent record of how an XP award was computed. Populated in phase 3. */
export interface XpBreakdown {
  base: number
  completionFactor: number
  consistencyMultiplier: number
  focusBonus: number
}

export interface HabitLog {
  id: string
  habitId: string

  /** The day this log counts for. Backdating sets this to a past day. */
  dayKey: DayKey

  outcome: LogOutcome
  partialKind?: PartialKind

  /** The real instant the log was written. */
  loggedAt: Instant

  /** IANA zone at the time of writing — provenance for travel/DST forensics. */
  tz: TimeZone

  /** True when `dayKey` is not the day `loggedAt` fell in. */
  isBackdated: boolean

  /**
   * Whether this habit was the daily focus on `dayKey`. Snapshotted so that
   * later recomputation can never retroactively change what was awarded.
   */
  wasFocus: boolean

  /** Snapshotted award. Never recomputed from current rules. */
  xpAwarded: number
  xpBreakdown?: XpBreakdown

  /** Which ruleset produced `xpAwarded`. Lets rules change without rewriting history. */
  rulesVersion: string

  note?: string
}

// ---------------------------------------------------------------------------
// Game state (populated from phase 3 onward; declared now so the schema is stable)
// ---------------------------------------------------------------------------

export type FocusResolution = 'pending' | 'completed' | 'partial' | 'expired'

export interface DailyFocus {
  dayKey: DayKey
  habitId: string
  chosenAt: Instant
  neglectScoreAtChoice: number
  resolved: FocusResolution
}

export type FreezeReason = 'auto_cover_miss' | 'refund_backdated_log'

export interface FreezeEvent {
  id: string
  dayKey: DayKey
  habitId: string
  reason: FreezeReason
  tokensBefore: number
  tokensAfter: number
  createdAt: Instant
}

export interface GameState {
  id: 'singleton'
  /**
   * Total XP is deliberately absent: it is derived by summing `xpAwarded`
   * across logs (`domain/xp.ts#totalXpFromLogs`). A stored running total would
   * be a second source of truth that drifts the first time a write half-fails.
   *
   * Rows written before this change may still carry a `totalXp` property. It is
   * a non-indexed field, so nothing reads it and no migration is required.
   */
  freezeTokens: number
  /** Week of the most recent freeze grant, so grants stay idempotent. */
  lastFreezeGrantWeekKey: WeekKey | null
  /** Last day the rollover job ran, so an absence replays day by day. */
  lastRolloverDayKey: DayKey | null
  createdAt: Instant
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  id: 'singleton'

  /**
   * Hour (0-23, local) at which a new day begins. Default 4: logging at 01:30
   * credits the day you just lived.
   */
  dayStartHour: number

  /** 0 = Sunday .. 6 = Saturday. Default 1 (Monday). */
  weekStartsOn: Weekday

  /**
   * `'auto'` follows the device. An explicit IANA zone pins the app to one
   * timezone, which is what you want if you travel but think in home-time.
   */
  timeZone: TimeZone | 'auto'

  freezeTokensPerWeek: number
  maxFreezeTokens: number

  /** Number of past days that may be backdated. */
  backdateWindowDays: number

  createdAt: Instant
  updatedAt: Instant
}

export const DEFAULT_SETTINGS: Omit<Settings, 'createdAt' | 'updatedAt'> = {
  id: 'singleton',
  dayStartHour: 4,
  weekStartsOn: 1,
  timeZone: 'auto',
  freezeTokensPerWeek: 2,
  maxFreezeTokens: 4,
  backdateWindowDays: 2,
}

/**
 * The subset of settings the pure time functions need. Passing this rather than
 * the whole `Settings` record keeps the domain layer honest about its inputs.
 */
export interface DayContext {
  timeZone: TimeZone
  dayStartHour: number
  weekStartsOn: Weekday
}
