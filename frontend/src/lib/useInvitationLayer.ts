import { useEffect } from 'react'

/** The tab title while an Invitation is up (MASTER section 47). */
export const INVITATION_TITLE = 'Una invitación para ti · Viajecito'

/**
 * While an Invitation layer is up: its own title (it wins over the page's, which may set its own
 * after this runs, and is put back afterwards) and the page beneath doesn't scroll.
 */
export function useInvitationLayer(active: boolean) {
  useEffect(() => {
    if (!active) return
    let pageTitle = document.title
    document.title = INVITATION_TITLE
    const watch = new MutationObserver(() => {
      if (document.title === INVITATION_TITLE) return
      pageTitle = document.title
      document.title = INVITATION_TITLE
    })
    const titleEl = document.querySelector('title')
    if (titleEl) watch.observe(titleEl, { childList: true, characterData: true, subtree: true })
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      watch.disconnect()
      document.title = pageTitle
      document.body.style.overflow = overflow
    }
  }, [active])
}
