import { createMediaSession } from '@/lib/api'

/** Renew this long before the cookies expire; the API says 4 h, MASTER section 30 asks for 3 h. */
const RENEW_BEFORE_MS = 60 * 60 * 1000
const MIN_RENEW_MS = 60_000
const RETRY_AFTER_FAILURE_MS = 60_000

type Listener = () => void
export type MediaSessionStatus = 'idle' | 'pending' | 'ready' | 'failed'

let status: MediaSessionStatus = 'idle'
let inflight: Promise<boolean> | null = null
let timer: number | undefined
/** Bumped by `stopMediaSession`, so an answer to a request made before it is ignored. */
let epoch = 0
let lastRenewed = 0
const listeners = new Set<Listener>()

function set(next: MediaSessionStatus) {
  if (status === next) return
  status = next
  listeners.forEach((l) => l())
}

export const subscribeMediaSession = (l: Listener) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const getMediaSessionStatus = () => status

/** Creates (or renews) the media session. Concurrent calls share one request. */
export function renewMediaSession(): Promise<boolean> {
  if (inflight) return inflight
  if (status !== 'ready') set('pending')
  const mine = epoch
  const request: Promise<boolean> = createMediaSession()
    .then((expiresAt) => {
      if (mine !== epoch) return false
      window.clearTimeout(timer)
      const wait = Math.max(MIN_RENEW_MS, expiresAt - Date.now() - RENEW_BEFORE_MS)
      timer = window.setTimeout(() => void renewMediaSession(), wait)
      lastRenewed = Date.now()
      set('ready')
      return true
    })
    .catch(() => {
      if (mine !== epoch) return false
      // Keep working with the old cookies if we had some; otherwise images fall back to placeholders.
      if (status !== 'ready') set('failed')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void renewMediaSession(), RETRY_AFTER_FAILURE_MS)
      return false
    })
    .finally(() => {
      if (inflight === request) inflight = null
    })
  inflight = request
  return request
}

/** For a broken `/media/` image: renew the cookies, unless they were renewed a moment ago. */
export function renewForBrokenImage(): Promise<boolean> {
  if (!inflight && Date.now() - lastRenewed < 10_000) return Promise.resolve(true)
  return renewMediaSession()
}

/** Starts the session once per login; later calls are no-ops until `stopMediaSession`. */
export function startMediaSession() {
  if (status === 'idle' || status === 'failed') void renewMediaSession()
}

/** Forgets the session (on log-out). */
export function stopMediaSession() {
  epoch++
  inflight = null
  lastRenewed = 0
  window.clearTimeout(timer)
  set('idle')
}
