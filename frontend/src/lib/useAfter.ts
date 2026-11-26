import { useEffect, useState } from 'react'

/** True once `ms` have passed since mount (used to show skeletons only for slow loads). */
export function useAfter(ms: number): boolean {
  const [done, setDone] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setDone(true), ms)
    return () => window.clearTimeout(t)
  }, [ms])
  return done
}
