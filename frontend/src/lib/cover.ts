const GRADIENTS = ['bg-[image:var(--cover-rosa)]', 'bg-[image:var(--cover-atardecer)]', 'bg-[image:var(--cover-mar)]']

/** Stable pick of one of the three sunset gradients from an id (Trip or Photo), as a Tailwind class. */
export function coverGradient(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return GRADIENTS[hash % GRADIENTS.length]
}
