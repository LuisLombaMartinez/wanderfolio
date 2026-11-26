/** Grid reorder helpers for the date-taken animation (MASTER section 44). */

/** More tiles than this would move: skip the animation, a big batch reads better as one swap. */
export const MAX_FLIPPED = 24

/** True when tiles present both before and after changed their relative order (not for appends or removals). */
export function orderChanged(prev: readonly string[], next: readonly string[]): boolean {
  const after = new Set(next)
  const before = new Set(prev)
  const a = prev.filter((k) => after.has(k))
  const b = next.filter((k) => before.has(k))
  return a.some((k, i) => k !== b[i])
}

export interface Box {
  x: number
  y: number
}

export interface Move {
  key: string
  /** Where the tile was, relative to where it is now. */
  dx: number
  dy: number
}

/**
 * Which tiles to animate: those that moved and had their old or new box within one viewport of the screen.
 * Boxes are page coordinates (y from the top of the page); `viewport` is the visible band in the same space.
 * Beyond `MAX_FLIPPED` moving tiles nothing is animated.
 */
export function flipPlan(
  before: ReadonlyMap<string, Box>,
  after: ReadonlyMap<string, Box>,
  viewport: { top: number; bottom: number },
): Move[] {
  const height = viewport.bottom - viewport.top
  const near = (y: number) => y >= viewport.top - height && y <= viewport.bottom + height
  const moves: Move[] = []
  for (const [key, to] of after) {
    const from = before.get(key)
    if (!from || (from.x === to.x && from.y === to.y)) continue
    if (!near(from.y) && !near(to.y)) continue
    moves.push({ key, dx: from.x - to.x, dy: from.y - to.y })
  }
  return moves.length > MAX_FLIPPED ? [] : moves
}
