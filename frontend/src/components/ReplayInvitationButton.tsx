import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gift } from 'lucide-react'
import { Invitation, type Origin } from '@/components/Invitation'
import { useInvitationTakeover } from '@/components/invitation-takeover'
import { Transition } from '@/components/Transition'
import { Button } from '@/components/ui/button'
import type { Invitation as InvitationData } from '@/lib/api'
import { gsap, useGSAP } from '@/lib/gsap'
import { useInvitationLayer } from '@/lib/useInvitationLayer'

interface ReplayInvitationButtonProps {
  /** The Trip's Invitation as the Trip detail gives it; the button only exists once it is Accepted. */
  invitation: InvitationData | null | undefined
  destination: string
  startDate: string
  endDate: string
  /** Called while the screen is covered, as the Trip page is revealed again (replay its entrance here). */
  onLanded?: () => void
  className?: string
}

/** "Sí" in a replay has nothing to wait for: the transition reveals as soon as it has covered the screen. */
const NOTHING_TO_WAIT_FOR = Promise.resolve('reveal' as const)

/**
 * "Ver invitación" (MASTER sections 60 and 61): replays an Accepted Invitation as a layer over the
 * page. "Sí" plays the transition and sends nothing, so the acceptance date never changes. Place
 * it anywhere on the Trip page (the Invitee's row, or the Inviter's "Tu invitación" card).
 */
export function ReplayInvitationButton({ invitation, destination, startDate, endDate, onLanded, className }: ReplayInvitationButtonProps) {
  const button = useRef<HTMLButtonElement>(null)
  const [up, setUp] = useState(false)
  const [origin, setOrigin] = useState<Origin | null>(null)
  const takeover = useInvitationTakeover()
  const open = up && !takeover
  const [lastTakeover, setLastTakeover] = useState(takeover)
  if (lastTakeover !== takeover) {
    setLastTakeover(takeover)
    // A real Pending Invitation replaces the replay at once, with no transition.
    if (takeover) {
      setUp(false)
      setOrigin(null)
    }
  }
  const wasOpen = useRef(false)

  useInvitationLayer(open)
  // The page beneath is out of reach (focus, clicks, screen readers) while the layer is up.
  useEffect(() => {
    if (!open) return
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    root?.setAttribute('aria-hidden', 'true')
    return () => {
      root?.removeAttribute('inert')
      root?.removeAttribute('aria-hidden')
    }
  }, [open])

  // Focus goes back to the button once the replay is over (it is the dialog's trigger).
  const settledOpen = open || origin !== null
  useEffect(() => {
    if (wasOpen.current && !settledOpen) button.current?.focus({ preventScroll: true })
    wasOpen.current = settledOpen
  }, [settledOpen])

  // Hover tilt of the gift, on pointer devices with motion only.
  useGSAP(
    (_, contextSafe) => {
      if (!contextSafe) return
      const mm = gsap.matchMedia()
      mm.add('(hover: hover) and (prefers-reduced-motion: no-preference)', () => {
        const el = button.current
        const icon = el?.querySelector('[data-gift]')
        if (!el || !icon) return
        const tilt = contextSafe(() => {
          gsap.fromTo(icon, { rotation: 0 }, { rotation: -10, duration: 0.15, yoyo: true, repeat: 1, ease: 'back.out(1.7)' })
        })
        el.addEventListener('pointerenter', tilt)
        return () => el.removeEventListener('pointerenter', tilt)
      })
      return () => mm.revert()
    },
    { scope: button },
  )

  if (invitation?.status !== 'accepted') return null

  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="keepsake"
        aria-haspopup="dialog"
        className={className}
        onClick={() => setUp(true)}
      >
        <Gift data-gift aria-hidden="true" className="size-5 text-primary" />
        Ver invitación
      </Button>
      {createPortal(
        <>
          {open && (
            <div className="fixed inset-0 z-50">
              <Invitation
                question={invitation.question}
                destination={destination}
                startDate={startDate}
                endDate={endDate}
                backdrop={{ kind: 'gradient' }}
                leaving={origin !== null}
                busy={origin !== null}
                onYes={(o) => setOrigin((prev) => prev ?? o)}
              />
            </div>
          )}
          {origin && !takeover && (
            <Transition
              origin={origin}
              outcome={NOTHING_TO_WAIT_FOR}
              onReveal={() => {
                setUp(false)
                onLanded?.()
              }}
              onDone={() => setOrigin(null)}
            />
          )}
        </>,
        document.body,
      )}
    </>
  )
}
