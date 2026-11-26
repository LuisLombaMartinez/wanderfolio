export interface Point {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const MIN_DISTANCE = 120
const ATTEMPTS = 10

/** Visible area available to the "No" button, honouring margin and safe areas. */
export function getBounds(
  size: Size,
  margin: number,
  insets: { top: number; right: number; bottom: number; left: number },
  viewport: Size,
): Bounds {
  const vw = viewport.w
  const vh = viewport.h
  const minX = margin + insets.left
  const minY = margin + insets.top
  return {
    minX,
    minY,
    maxX: Math.max(minX, vw - size.w - margin - insets.right),
    maxY: Math.max(minY, vh - size.h - margin - insets.bottom),
  }
}

export function clampPoint(p: Point, b: Bounds): Point {
  return {
    x: Math.min(Math.max(p.x, b.minX), b.maxX),
    y: Math.min(Math.max(p.y, b.minY), b.maxY),
  }
}

function overlaps(a: Box, b: Box, pad: number) {
  return (
    a.x < b.x + b.w + pad && a.x + a.w > b.x - pad && a.y < b.y + b.h + pad && a.y + a.h > b.y - pad
  )
}

function distanceToBox(p: Point, box: Box) {
  const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.w))
  const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.h))
  return Math.hypot(dx, dy)
}

function centerDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Picks a new position fully inside the bounds, away from the current spot and
 * the pointer, and not overlapping any obstacle (Sí button, question text).
 */
export function pickPosition(args: {
  bounds: Bounds
  size: Size
  current: Point
  pointer: Point | null
  obstacles: Box[]
}): Point {
  const { bounds, size, current, pointer, obstacles } = args
  const isFree = (p: Point) =>
    !obstacles.some((o) => overlaps({ x: p.x, y: p.y, w: size.w, h: size.h }, o, 8))

  for (let i = 0; i < ATTEMPTS; i++) {
    const p = {
      x: bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
      y: bounds.minY + Math.random() * (bounds.maxY - bounds.minY),
    }
    const far = centerDistance(p, current) >= MIN_DISTANCE
    const awayFromPointer =
      !pointer || distanceToBox(pointer, { x: p.x, y: p.y, w: size.w, h: size.h }) >= MIN_DISTANCE
    if (far && awayFromPointer && isFree(p)) return p
  }

  // No free spot: take the candidate with the least overlap (corners plus a coarse grid).
  const candidates: Point[] = []
  const steps = 6
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      candidates.push({
        x: bounds.minX + ((bounds.maxX - bounds.minX) * i) / steps,
        y: bounds.minY + ((bounds.maxY - bounds.minY) * j) / steps,
      })
    }
  }
  const overlapArea = (p: Point) =>
    obstacles.reduce((sum, o) => {
      const w = Math.min(p.x + size.w, o.x + o.w) - Math.max(p.x, o.x)
      const h = Math.min(p.y + size.h, o.y + o.h) - Math.max(p.y, o.y)
      return sum + (w > 0 && h > 0 ? w * h : 0)
    }, 0)
  let best = candidates[0]
  let bestArea = Infinity
  for (const c of candidates) {
    const area = overlapArea(c)
    const better =
      area < bestArea - 1 ||
      (Math.abs(area - bestArea) <= 1 && centerDistance(c, current) > centerDistance(best, current))
    if (better) {
      best = c
      bestArea = area
    }
  }
  return best
}

/** Reads the device safe-area insets in px. */
export function readSafeInsets() {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;inset:0;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const insets = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  }
  probe.remove()
  return insets
}

/** How much "Sí" grows on each dodge, and the most it ever grows (MASTER section 47). */
export const YES_SCALE_STEP = 0.26
export const YES_MAX_SCALE = 2.6

/**
 * Largest scale "Sí" may reach without breaking the layout: at most 2.6, at most 86% of the
 * viewport width (and 520px), at most 28% of its height, and never below 1.
 */
export function yesCap(yes: Size, viewport: Size): number {
  if (yes.w <= 0 || yes.h <= 0) return 1
  const maxW = Math.min(viewport.w * 0.86, 520)
  const maxH = viewport.h * 0.28
  return Math.max(1, Math.min(YES_MAX_SCALE, maxW / yes.w, maxH / yes.h))
}

/** The scale of "Sí" after `dodges` dodges, under `cap` (see yesCap). */
export function yesScale(dodges: number, cap: number): number {
  return Math.min(1 + YES_SCALE_STEP * dodges, cap)
}
