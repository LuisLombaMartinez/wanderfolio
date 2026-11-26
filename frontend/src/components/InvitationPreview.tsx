import { useEffect, useMemo, useRef, useState } from 'react'
import { Invitation, type Origin } from '@/components/Invitation'
import { Transition, type TransitionOutcome } from '@/components/Transition'

/** The tab title while a preview is up (design/MASTER.md section 57). */
const PREVIEW_TITLE = 'Vista previa · Viajecito'

interface InvitationPreviewProps {
  /** Whether the preview is showing (the page drives it from `?vista=previa`). */
  open: boolean
  question: string
  destination: string
  startDate: string
  endDate: string
  /** Leave the preview: "Salir", Escape, or the covered moment of "Sí". The page undoes the URL. */
  onClose: () => void
  /** The "Sí" transition finished over the Trip page. Nothing was recorded. */
  onFinished: () => void
}

/**
 * The Inviter's rehearsal of an Invitation. "Sí" plays the real transition but records nothing: the
 * outcome is already "reveal", so there is no wait and no request.
 */
export function InvitationPreview({ open, question, destination, startDate, endDate, onClose, onFinished }: InvitationPreviewProps) {
  const [saying, setSaying] = useState<Origin | null>(null)
  const outcome = useMemo(() => Promise.resolve<TransitionOutcome>('reveal'), [])
  const wrap = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // While it is up: its own title (it wins over the page's) and the page beneath doesn't scroll.
  useEffect(() => {
    if (!open) return
    let pageTitle = document.title
    document.title = PREVIEW_TITLE
    const watch = new MutationObserver(() => {
      if (document.title === PREVIEW_TITLE) return
      pageTitle = document.title
      document.title = PREVIEW_TITLE
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
  }, [open])

  // The real Invitation wins: when the gate takes over the page (it makes it inert), the preview closes, no transition.
  useEffect(() => {
    if (!open) return
    const check = () => {
      if (!wrap.current?.closest('[inert]')) return
      setSaying(null)
      closeRef.current()
    }
    const watch = new MutationObserver(check)
    watch.observe(document.body, { attributes: true, attributeFilter: ['inert'], subtree: true })
    return () => watch.disconnect()
  }, [open])

  return (
    <>
      {open && (
        <div ref={wrap} className="fixed inset-0 z-50">
          <Invitation
            question={question}
            destination={destination}
            startDate={startDate}
            endDate={endDate}
            backdrop={{ kind: 'gradient' }}
            leaving={saying !== null}
            busy={saying !== null}
            preview={{ onExit: () => saying === null && onClose() }}
            onYes={(origin) => saying === null && setSaying(origin)}
          />
        </div>
      )}
      {saying && (
        <Transition
          origin={saying}
          outcome={outcome}
          onReveal={onClose}
          onDone={() => {
            setSaying(null)
            onFinished()
          }}
        />
      )}
    </>
  )
}
