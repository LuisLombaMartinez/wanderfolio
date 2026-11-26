import { useState } from 'react'
import { renewForBrokenImage } from '@/lib/media'

/**
 * State for an `<img>` of a `/media/` address: it loads, or fails once, renews the media session and
 * tries again (a new `attempt` remounts the `<img>`), or gives up (MASTER section 30).
 */
export function useMediaImage() {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const onError = () => {
    if (attempt > 0) {
      setFailed(true)
      return
    }
    void renewForBrokenImage().then((ok) => (ok ? setAttempt(1) : setFailed(true)))
  }
  return { attempt, loaded, failed, onLoad: () => setLoaded(true), onError }
}
