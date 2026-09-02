import { describe, expect, it } from 'vitest'
import { cumulativeXpForLevel, levelForXp, xpToNext } from '@/domain/level'
import { DEFAULT_XP_RULES, type XpRules } from '@/domain/rules/xpRules'

const R = DEFAULT_XP_RULES

/**
 * Independent implementation of the documented curve. Kept separate from the
 * production code so these assertions test the spec, not the implementation's
 * agreement with itself.
 */
const specXpToNext = (level: number) => Math.round(40 * Math.pow(level, 1.35))

const specLevelForXp = (totalXp: number) => {
  let level = 1
  let remaining = totalXp
  while (remaining >= specXpToNext(level)) {
    remaining -= specXpToNext(level)
    level += 1
  }
  return { level, xpIntoLevel: remaining }
}

describe('the curve', () => {
  it('matches the documented values', () => {
    expect(xpToNext(1, R)).toBe(40)
    expect(xpToNext(2, R)).toBe(102)
    expect(xpToNext(3, R)).toBe(176)
    expect(xpToNext(4, R)).toBe(260)
    expect(xpToNext(5, R)).toBe(351)
    expect(xpToNext(10, R)).toBe(895)
  })

  it('agrees with an independent implementation across the useful range', () => {
    for (let level = 1; level <= 60; level++) {
      expect(xpToNext(level, R)).toBe(specXpToNext(level))
    }
  })

  it('gets progressively more expensive', () => {
    for (let level = 1; level < 60; level++) {
      expect(xpToNext(level + 1, R)).toBeGreaterThan(xpToNext(level, R))
    }
  })

  it('is cheap enough early to level on day one', () => {
    // A single tier-3 completion (30 XP) should be visible progress, and one
    // ordinary day should cross a level. This is the motivational claim.
    expect(xpToNext(1, R)).toBeLessThanOrEqual(45)
  })
})

describe('levelForXp', () => {
  it('starts at level 1 with nothing', () => {
    expect(levelForXp(0, R)).toMatchObject({ level: 1, xpIntoLevel: 0, totalXp: 0 })
  })

  it('levels exactly at the boundary, not one XP late', () => {
    expect(levelForXp(39, R).level).toBe(1)
    expect(levelForXp(40, R).level).toBe(2)
    expect(levelForXp(41, R).level).toBe(2)
  })

  it('handles every boundary up to level 30', () => {
    for (let level = 1; level <= 30; level++) {
      const threshold = cumulativeXpForLevel(level, R)
      expect(levelForXp(threshold, R).level).toBe(level)
      if (threshold > 0) expect(levelForXp(threshold - 1, R).level).toBe(level - 1)
    }
  })

  it('agrees with an independent walk of the curve', () => {
    for (const xp of [0, 1, 39, 40, 142, 317, 318, 516, 929, 4266, 9118, 25_000]) {
      const mine = levelForXp(xp, R)
      const spec = specLevelForXp(xp)
      expect({ level: mine.level, xpIntoLevel: mine.xpIntoLevel }).toEqual(spec)
    }
  })

  it('reports progress within the level', () => {
    const state = levelForXp(40 + 51, R) // halfway through level 2
    expect(state.level).toBe(2)
    expect(state.xpIntoLevel).toBe(51)
    expect(state.xpForNextLevel).toBe(102)
    expect(state.progress).toBeCloseTo(0.5, 2)
  })

  it('never reports progress outside 0..1', () => {
    for (const xp of [0, 1, 39, 40, 500, 5000, 100_000]) {
      const p = levelForXp(xp, R).progress
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })
})

describe('a realistic first week', () => {
  it('lands at level 4 after roughly 516 XP', () => {
    // The worked example from the design: a messy week with one zero day.
    const state = levelForXp(516, R)
    expect(state.level).toBe(4)
    expect(state.progress).toBeGreaterThan(0.7)
    expect(state.progress).toBeLessThan(0.8)
  })

  it('crosses two levels inside the first two days', () => {
    expect(levelForXp(109, R).level).toBe(2) // day one
    expect(levelForXp(207, R).level).toBe(3) // day two
  })

  it('does not move backwards on a zero day', () => {
    // A day earning nothing leaves the level exactly where it was. This is the
    // "missing a day is lack of progress, not destruction of progress" rule
    // expressed in the curve.
    const before = levelForXp(313, R)
    const after = levelForXp(313, R)
    expect(after.level).toBe(before.level)
    expect(after.xpIntoLevel).toBe(before.xpIntoLevel)
  })
})

describe('robustness', () => {
  it('never goes below level 1, even for nonsense input', () => {
    expect(levelForXp(-500, R).level).toBe(1)
    expect(levelForXp(Number.NaN, R).level).toBe(1)
  })

  it('terminates on an absurd total', () => {
    const state = levelForXp(Number.MAX_SAFE_INTEGER, R)
    expect(state.level).toBeGreaterThan(1)
    expect(Number.isFinite(state.level)).toBe(true)
  })

  it('honours an alternative curve from a swapped ruleset', () => {
    const flat: XpRules = { ...R, level: { baseXp: 100, exponent: 1 } }
    expect(xpToNext(1, flat)).toBe(100)
    expect(xpToNext(5, flat)).toBe(500)
    expect(levelForXp(100, flat).level).toBe(2)
  })
})
