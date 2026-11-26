import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useAuth } from '@/auth/auth-context'
import { getTrip, type Trip } from '@/lib/api'
import { buildTiles, isUnfinished } from '@/lib/tiles'
import { useUploads } from '@/lib/useUploads'

const POLL_MS = 4000
const LOST_AFTER = 3

/**
 * Polls the Trip every few seconds while any Photo is unfinished. `connectionLost` is true after several
 * failures in a row; `refresh` fetches once now (a retry the API refused with a conflict).
 */
export function useTripPolling(
  id: string,
  trip: Trip | null,
  onTrip: (trip: Trip) => void,
  mutations: RefObject<number>,
): { connectionLost: boolean; refresh: () => Promise<void> } {
  const { handleApiError } = useAuth()
  const uploads = useUploads()
  const [failures, setFailures] = useState(0)
  const busy = useRef(false)
  const alive = useRef(new AbortController())
  // One controller per mount: leaving the page aborts the request in flight and drops late answers.
  useEffect(() => {
    const ctrl = new AbortController()
    alive.current = ctrl
    return () => ctrl.abort()
  }, [id])

  const mine = useMemo(() => uploads.uploads.filter((u) => u.tripId === id), [uploads.uploads, id])
  const unfinished = useMemo(
    () => trip !== null && buildTiles(trip.photos ?? [], mine, uploads.abandoned).some(isUnfinished),
    [trip, mine, uploads.abandoned],
  )
  const sent = mine.filter((u) => u.status === 'sent').length

  const refresh = useCallback(async () => {
    if (busy.current || document.hidden) return
    busy.current = true
    const { signal } = alive.current
    const version = mutations.current
    try {
      const fresh = await getTrip(id, signal)
      if (signal.aborted || version !== mutations.current) return
      onTrip(fresh)
      setFailures(0)
    } catch (err) {
      if (signal.aborted) return
      if (!handleApiError(err)) setFailures((n) => n + 1)
    } finally {
      busy.current = false
    }
  }, [id, onTrip, handleApiError, mutations])

  useEffect(() => {
    if (!unfinished) return
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    const onVisible = () => void refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [unfinished, refresh])

  // A file that has just arrived at S3 shows up as a Photo without waiting for the next tick.
  useEffect(() => {
    if (sent === 0) return
    const t = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(t)
  }, [sent, refresh])

  return { connectionLost: failures >= LOST_AFTER, refresh }
}
