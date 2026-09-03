/**
 * The reward ruleset — as *data*, deliberately.
 *
 * Every tunable number lives in this object rather than being scattered through
 * the scoring functions. That is what makes the future AI layer a drop-in: it
 * emits a `XpRules` value (plain JSON), and nothing in the domain engine
 * changes. It also means a ruleset can be versioned, stored alongside the logs
 * it produced, and diffed.
 *
 * Rules are never applied retroactively. Each log snapshots the XP it earned
 * and the `version` that produced it, so changing these numbers cannot rewrite
 * history — a property the "never subtract XP" principle depends on.
 */

import type { DifficultyTier, LogOutcome } from '@/domain/types'

export interface XpRules {
  /** Stamped onto every log this ruleset scores. Change it when numbers change. */
  version: string

  baseXpByDifficulty: Record<DifficultyTier, number>

  /** Multiplier applied to base XP for each outcome. */
  completionFactors: Record<LogOutcome, number>

  consistency: {
    /** Trailing window, in days, used to measure recent consistency. */
    windowDays: number
    /**
     * Floor on the denominator, so a brand-new habit cannot reach the maximum
     * multiplier from a single completion. Ramps the bonus in over ~2 weeks.
     */
    minDenominator: number
    /** Maximum bonus above 1.0. `0.30` means the multiplier tops out at 1.30. */
    maxBonus: number
  }

  /**
   * XP added for completing the day's focus habit, at any credited level.
   *
   * Flat in *difficulty* — a dreaded two-minute task should out-earn a
   * comfortable big one — but scaled by the account's *best* consistency
   * multiplier, so it is sized against the best-paying thing the user could do
   * instead. `domain/xp.ts` has the reasoning and the numbers.
   */
  focusBonus: number

  level: {
    /** XP required to leave level 1. */
    baseXp: number
    /** Curve steepness. `xpToNext(n) = round(baseXp * n^exponent)`. */
    exponent: number
  }
}

export const DEFAULT_XP_RULES: XpRules = {
  /*
   * v3: the focus bonus is scaled by the account's *best* consistency
   * multiplier rather than the focus habit's own.
   *
   * v1 added it flat, so it was diluted as an account matured. v2 scaled it by
   * the habit's own multiplier, which fixed the like-for-like comparison but
   * not the lived one — the focus habit is the neglected one by construction,
   * so its own multiplier is the lowest on the board. v3 sizes the bonus
   * against the best-paying alternative, which is the comparison it exists to
   * win. See `domain/xp.ts`.
   *
   * Bumping the version is the whole point of having one. Logs written under
   * v1 or v2 keep their `rulesVersion` and the XP they banked; nothing is
   * recomputed and no total moves. Only awards made from here on use the new
   * arithmetic.
   */
  version: 'v3',

  // Mildly superlinear: choosing the hard thing should pay, but not so much
  // that easy habits feel pointless.
  baseXpByDifficulty: { 1: 10, 2: 18, 3: 30, 4: 45 },

  completionFactors: {
    complete: 1.0,
    // 0.6, not 0.5. Half says "you did half a person's worth". 0.6 says most of
    // the value was in showing up, while leaving a real reason to finish. This
    // is the single most important dial in the app: it is what makes the
    // two-minute version a legitimate success rather than disguised failure.
    partial: 0.6,
    skip: 0,
  },

  consistency: { windowDays: 14, minDenominator: 5, maxBonus: 0.3 },

  // Flat in difficulty, scaled by the account's best consistency multiplier.
  focusBonus: 25,

  level: { baseXp: 40, exponent: 1.35 },
}
