import { describe, expect, it } from 'vitest'
import { daysToNextTier, flameTierFor, tierRange, type FlameTier } from '@/domain/flameTier'

/**
 * The tier boundaries are the reward ladder, so an off-by-one here would hand
 * out — or withhold — a tier on the wrong day. Every boundary is checked from
 * both sides.
 */

// The table from PLAN.md, transcribed independently of the implementation.
const SPEC: { streak: number; tier: FlameTier }[] = [
  { streak: 0, tier: 0 },
  { streak: 1, tier: 1 },
  { streak: 6, tier: 1 },
  { streak: 7, tier: 2 },
  { streak: 13, tier: 2 },
  { streak: 14, tier: 3 },
  { streak: 29, tier: 3 },
  { streak: 30, tier: 4 },
  { streak: 59, tier: 4 },
  { streak: 60, tier: 5 },
]

describe('flameTierFor', () => {
  it('matches the specified table exactly', () => {
    for (const { streak, tier } of SPEC) {
      expect({ streak, tier: flameTierFor(streak) }).toEqual({ streak, tier })
    }
  })

  it('lights the flame on the very first day', () => {
    // A single completion has to produce visible change, or day one feels
    // identical to having done nothing.
    expect(flameTierFor(0)).toBe(0)
    expect(flameTierFor(1)).toBe(1)
  })

  it('never exceeds the top tier', () => {
    for (const streak of [60, 61, 100, 365, 10_000]) {
      expect(flameTierFor(streak)).toBe(5)
    }
  })

  it('never decreases as the streak grows', () => {
    let previous = flameTierFor(0)
    for (let streak = 1; streak <= 400; streak++) {
      const tier = flameTierFor(streak)
      expect(tier).toBeGreaterThanOrEqual(previous)
      previous = tier
    }
  })

  it('only ever returns a tier the palette has a colour for', () => {
    for (let streak = 0; streak <= 400; streak++) {
      expect(flameTierFor(streak)).toBeGreaterThanOrEqual(0)
      expect(flameTierFor(streak)).toBeLessThanOrEqual(5)
    }
  })

  it('falls back to unlit for corrupted input', () => {
    // A bad row must not produce a tier with no matching colour token.
    expect(flameTierFor(-5)).toBe(0)
    expect(flameTierFor(Number.NaN)).toBe(0)
    expect(flameTierFor(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('daysToNextTier', () => {
  it('counts down to the next boundary', () => {
    expect(daysToNextTier(0)).toBe(1)
    expect(daysToNextTier(1)).toBe(6)
    expect(daysToNextTier(6)).toBe(1)
    expect(daysToNextTier(7)).toBe(7)
    expect(daysToNextTier(29)).toBe(1)
    expect(daysToNextTier(59)).toBe(1)
  })

  it('is null at the top tier', () => {
    expect(daysToNextTier(60)).toBeNull()
    expect(daysToNextTier(500)).toBeNull()
  })

  it('agrees with flameTierFor at every boundary it predicts', () => {
    // Independent cross-check: adding the reported remaining days must always
    // land on exactly the next tier up.
    for (let streak = 0; streak < 60; streak++) {
      const remaining = daysToNextTier(streak)
      expect(remaining).not.toBeNull()
      expect(flameTierFor(streak + remaining!)).toBe(flameTierFor(streak) + 1)
    }
  })
})

describe('tierRange', () => {
  it('describes each tier', () => {
    expect(tierRange(0)).toEqual({ from: 0, to: 0 })
    expect(tierRange(1)).toEqual({ from: 1, to: 6 })
    expect(tierRange(2)).toEqual({ from: 7, to: 13 })
    expect(tierRange(3)).toEqual({ from: 14, to: 29 })
    expect(tierRange(4)).toEqual({ from: 30, to: 59 })
    expect(tierRange(5)).toEqual({ from: 60, to: null })
  })

  it('covers the number line without gaps or overlaps', () => {
    for (let tier = 0; tier < 5; tier++) {
      const here = tierRange(tier as FlameTier)
      const next = tierRange((tier + 1) as FlameTier)
      expect(here.to).not.toBeNull()
      expect(here.to! + 1).toBe(next.from)
    }
  })
})
