import { useSyncExternalStore } from 'react'
import { getMediaSessionStatus, renewMediaSession, subscribeMediaSession } from '@/lib/media'

/** Whether the signed cookies for `/media/*` are in place, plus a retry for when they failed. */
export function useMediaSession() {
  const status = useSyncExternalStore(subscribeMediaSession, getMediaSessionStatus)
  return { status, retry: () => void renewMediaSession() }
}
