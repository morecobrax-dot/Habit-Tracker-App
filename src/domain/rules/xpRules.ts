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

  /** Flat XP added for completing the day's focus habit, at any credited level. */
  focusBonus: number

  level: {
    /** XP required to leave level 1. */
    baseXp: number
    /** Curve steepness. `xpToNext(n) = round(baseXp * n^exponent)`. */
    exponent: number
  }
}

export const DEFAULT_XP_RULES: XpRules = {
  version: 'v1',

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

  // Flat, not multiplicative — see `domain/xp.ts` for why that matters.
  focusBonus: 25,

  level: { baseXp: 40, exponent: 1.35 },
}
