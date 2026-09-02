/**
 * Levels. Derived from total XP, never stored.
 *
 * The curve is `xpToNext(n) = round(baseXp * n^exponent)` with exponent 1.35:
 * fast early, progressively slower. Levelling twice on day one matters, because
 * that is when motivation is lowest and visible motion is worth most. By month
 * three a level takes a couple of weeks, which is a sane long arc — no wall,
 * no infinite grind.
 *
 * Levels never decrease. There is no code path here that can lower one, because
 * total XP is a sum of non-negative awards.
 */

import type { XpRules } from '@/domain/rules/xpRules'

/** Guards against a pathological ruleset turning the loop below into a hang. */
const MAX_LEVEL = 500

export interface LevelState {
  level: number
  /** XP accumulated inside the current level. */
  xpIntoLevel: number
  /** XP required to move from the current level to the next. */
  xpForNextLevel: number
  /** 0..1 progress through the current level. */
  progress: number
  totalXp: number
}

export function xpToNext(level: number, rules: XpRules): number {
  if (level < 1) return rules.level.baseXp
  return Math.round(rules.level.baseXp * Math.pow(level, rules.level.exponent))
}

export function levelForXp(totalXp: number, rules: XpRules): LevelState {
  // A non-finite total must collapse to zero, not fall through. `NaN < needed`
  // is false, so an unguarded NaN would run the loop to MAX_LEVEL and report
  // level 500 — a corrupted log row should never be able to do that.
  const safeTotal = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0

  let level = 1
  let remaining = safeTotal

  while (level < MAX_LEVEL) {
    const needed = xpToNext(level, rules)
    if (needed <= 0 || remaining < needed) break
    remaining -= needed
    level += 1
  }

  const xpForNextLevel = xpToNext(level, rules)

  return {
    level,
    xpIntoLevel: remaining,
    xpForNextLevel,
    progress: xpForNextLevel > 0 ? Math.min(1, remaining / xpForNextLevel) : 0,
    totalXp: safeTotal,
  }
}

/** Cumulative XP required to reach a level from zero. Used by tests and history. */
export function cumulativeXpForLevel(level: number, rules: XpRules): number {
  let total = 0
  for (let n = 1; n < level; n++) total += xpToNext(n, rules)
  return total
}
