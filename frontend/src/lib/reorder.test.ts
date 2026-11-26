import { describe, expect, it } from 'vitest'
import { MAX_FLIPPED, flipPlan, orderChanged } from './reorder'

describe('orderChanged', () => {
  it('is false for the same order, for tiles appended at the end and for tiles that left', () => {
    expect(orderChanged(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(false)
    expect(orderChanged(['a', 'b'], ['a', 'b', 'new'])).toBe(false)
    expect(orderChanged(['a', 'b', 'c'], ['a', 'c'])).toBe(false)
  })
  it('is false when a tile is listed in the middle without moving the others', () => {
    expect(orderChanged(['a', 'b', 'l1'], ['a', 'b', 'l1', 'x'])).toBe(false)
    expect(orderChanged(['a', 'c'], ['a', 'b', 'c'])).toBe(false)
  })
  it('is true when tiles already on screen swap places, e.g. a sent file lands in the middle', () => {
    expect(orderChanged(['a', 'b', 'c'], ['a', 'c', 'b'])).toBe(true)
    expect(orderChanged(['a', 'c', 'l1'], ['a', 'l1', 'c'])).toBe(true)
  })
})

const box = (x: number, y: number) => ({ x, y })

describe('flipPlan', () => {
  const viewport = { top: 0, bottom: 800 }
  it('animates the tiles whose box changed, from where they were', () => {
    const plan = flipPlan(
      new Map([['a', box(0, 0)], ['b', box(100, 0)]]),
      new Map([['a', box(100, 0)], ['b', box(0, 0)]]),
      viewport,
    )
    expect(plan).toEqual([
      { key: 'a', dx: -100, dy: 0 },
      { key: 'b', dx: 100, dy: 0 },
    ])
  })
  it('skips tiles that did not move and tiles with no old box', () => {
    expect(flipPlan(new Map([['a', box(0, 0)]]), new Map([['a', box(0, 0)], ['n', box(10, 0)]]), viewport)).toEqual([])
  })
  it('lets tiles far from the viewport jump', () => {
    const plan = flipPlan(
      new Map([['far', box(0, 5000)], ['near', box(0, 100)]]),
      new Map([['far', box(100, 5000)], ['near', box(100, 100)]]),
      viewport,
    )
    expect(plan.map((p) => p.key)).toEqual(['near'])
  })
  it('animates a tile that crosses the viewport edge through a near box', () => {
    const plan = flipPlan(new Map([['t', box(0, 900)]]), new Map([['t', box(0, 100)]]), viewport)
    expect(plan).toHaveLength(1)
  })
  it('skips the whole animation when too many tiles would move', () => {
    const old = new Map(Array.from({ length: MAX_FLIPPED + 1 }, (_, i) => [`t${i}`, box(0, i)] as const))
    const next = new Map(Array.from({ length: MAX_FLIPPED + 1 }, (_, i) => [`t${i}`, box(1, i)] as const))
    expect(flipPlan(old, next, viewport)).toEqual([])
    expect(MAX_FLIPPED).toBe(24)
  })
})
