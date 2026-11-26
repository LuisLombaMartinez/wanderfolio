import { describe, expect, it } from 'vitest'
import { YES_MAX_SCALE, getBounds, pickPosition, yesCap, yesScale, type Box } from '@/lib/dodge'

const NO = { w: 96, h: 48 }
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }

describe('"No" always lands fully inside the viewport', () => {
  for (const [w, h] of [
    [390, 844],
    [1440, 900],
    [320, 568],
  ]) {
    it(`at ${w}x${h}, with or without room to spare`, () => {
      const bounds = getBounds(NO, 16, { top: 47, right: 0, bottom: 34, left: 0 }, { w, h })
      // A big "Sí" and the question block leave little free space, forcing the fallback grid too.
      const crowded: Box[] = [
        { x: 0, y: h * 0.2, w, h: h * 0.3 },
        { x: w * 0.1, y: h * 0.55, w: w * 0.8, h: h * 0.25 },
      ]
      let current = { x: bounds.minX, y: bounds.minY }
      for (let i = 0; i < 300; i++) {
        const obstacles = i % 2 === 0 ? crowded : []
        const pointer = i % 3 === 0 ? null : { x: (i * 37) % w, y: (i * 53) % h }
        const p = pickPosition({ bounds, size: NO, current, pointer, obstacles })
        expect(p.x).toBeGreaterThanOrEqual(16)
        expect(p.y).toBeGreaterThanOrEqual(16 + 47)
        expect(p.x + NO.w).toBeLessThanOrEqual(w - 16)
        expect(p.y + NO.h).toBeLessThanOrEqual(h - 16 - 34)
        current = p
      }
    })
  }

  it('collapses to the top-left margin when the viewport is smaller than the button and its margins', () => {
    // No position can fit; the bounds degrade to a single point instead of going negative.
    const bounds = getBounds(NO, 16, NO_INSETS, { w: 100, h: 60 })
    const p = pickPosition({ bounds, size: NO, current: { x: 0, y: 0 }, pointer: null, obstacles: [] })
    expect(p).toEqual({ x: 16, y: 16 })
  })
})

describe('"Sí" grows on each dodge up to a cap', () => {
  const yes = { w: 120, h: 56 }

  it('grows by the same step on each dodge', () => {
    const cap = yesCap(yes, { w: 1440, h: 900 })
    expect(yesScale(0, cap)).toBe(1)
    expect(yesScale(1, cap)).toBeCloseTo(1.26)
    expect(yesScale(3, cap)).toBeCloseTo(1.78)
  })

  it('never passes 2.6 however many times "No" dodges', () => {
    const cap = yesCap(yes, { w: 1440, h: 900 })
    expect(cap).toBe(YES_MAX_SCALE)
    expect(YES_MAX_SCALE).toBe(2.6)
    expect(yesScale(1000, cap)).toBe(2.6)
  })

  it('on a small phone it stops before the grown "Sí" would break the layout', () => {
    const cap = yesCap(yes, { w: 320, h: 568 })
    // 86% of 320 px is 275.2 px: a 120 px "Sí" stops at about 2.29.
    expect(cap).toBeCloseTo(2.293, 3)
    expect(yes.w * yesScale(50, cap)).toBeLessThanOrEqual(275.2 + 0.001)
    expect(yes.h * yesScale(50, cap)).toBeLessThanOrEqual(568 * 0.28)
  })

  it('a short landscape screen limits the height too', () => {
    // 28% of 300 px is 84 px: a 56 px tall "Sí" stops at 1.5.
    expect(yesCap(yes, { w: 900, h: 300 })).toBeCloseTo(1.5)
  })

  it('never shrinks "Sí" on a tiny screen', () => {
    expect(yesCap(yes, { w: 100, h: 100 })).toBe(1)
  })
})
