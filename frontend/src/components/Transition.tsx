import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { gsap, useGSAP } from '@/lib/gsap'
import type { Origin } from '@/components/Invitation'

/** What to do once the screen is covered: show what is underneath, or go back to the Invitation. */
export type TransitionOutcome = 'reveal' | 'revert'

interface TransitionProps {
  origin: Origin
  /** Settles when the "Sí" has its answer. The cover holds until then. */
  outcome: Promise<TransitionOutcome>
  /** Called while the screen is covered, just before it clears (navigate here). */
  onReveal: () => void
  /** Called when the transition has finished, with how it ended. */
  onDone: (outcome: TransitionOutcome) => void
}

const HEARTS = 16
const CIRCLE = 100
/** "Guardando tu sí…" appears only if the wait lasts longer than this. */
const WAIT_LABEL_MS = 600

/**
 * Hearts burst + circular expansion from the Sí button (MASTER sections 7 and 50). Once the screen
 * is covered it waits for `outcome`: "reveal" clears over the new screen, "revert" shrinks back
 * into "Sí". Reduced motion: 200ms cross-fades to a plain layer instead.
 */
export function Transition({ origin, outcome, onReveal, onDone }: TransitionProps) {
  const root = useRef<HTMLDivElement>(null)
  const [waiting, setWaiting] = useState(false)
  const [label, setLabel] = useState(false)
  const callbacks = useRef({ onReveal, onDone })
  useEffect(() => {
    callbacks.current = { onReveal, onDone }
  })

  useEffect(() => {
    if (!waiting) return
    const t = window.setTimeout(() => setLabel(true), WAIT_LABEL_MS)
    return () => window.clearTimeout(t)
  }, [waiting])

  useGSAP(
    (_, ctxSafe) => {
      if (!ctxSafe) return
      let settled: TransitionOutcome | null = null
      let covered = false
      const finish = ctxSafe((how: TransitionOutcome) => {
        setWaiting(false)
        if (how === 'reveal') {
          callbacks.current.onReveal()
          gsap
            .timeline({ onComplete: () => callbacks.current.onDone('reveal') })
            .to('[data-circle]', { opacity: 0, duration: 0.5, ease: 'power1.out' }, 0)
            .to('[data-fade]', { opacity: 0, duration: 0.2 }, 0)
            .to('[data-wait]', { opacity: 0, duration: 0.2 }, 0)
          return
        }
        gsap
          .timeline({ onComplete: () => callbacks.current.onDone('revert') })
          .to('[data-circle]', { scale: 0, duration: 0.5, ease: 'power2.inOut' }, 0)
          .to('[data-fade]', { opacity: 0, duration: 0.2 }, 0)
          .to('[data-wait]', { opacity: 0, duration: 0.2 }, 0)
      })
      const onCovered = () => {
        covered = true
        if (settled) finish(settled)
        else setWaiting(true)
      }
      outcome.then(
        (how) => {
          settled = how
          if (covered) finish(how)
        },
        () => {
          settled = 'revert'
          if (covered) finish('revert')
        },
      )

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) {
        gsap.timeline().fromTo('[data-fade]', { opacity: 0 }, { opacity: 1, duration: 0.2 }).call(onCovered)
        return
      }
      const vw = window.innerWidth
      const vh = window.innerHeight
      const radius = Math.max(
        Math.hypot(origin.x, origin.y),
        Math.hypot(vw - origin.x, origin.y),
        Math.hypot(origin.x, vh - origin.y),
        Math.hypot(vw - origin.x, vh - origin.y),
      )
      const full = ((radius * 2) / CIRCLE) * 1.02
      const spread = Math.min(vw, vh) * 0.45

      gsap
        .timeline()
        .fromTo(
          '[data-heart]',
          { scale: 0, opacity: 1, x: 0, y: 0 },
          {
            scale: () => gsap.utils.random(0.8, 1.5),
            x: (i) => Math.cos((i / HEARTS) * Math.PI * 2) * spread * gsap.utils.random(0.6, 1.1),
            y: (i) => Math.sin((i / HEARTS) * Math.PI * 2) * spread * gsap.utils.random(0.6, 1.1),
            rotation: () => gsap.utils.random(-40, 40),
            duration: 0.9,
            ease: 'power2.out',
          },
          0,
        )
        .to('[data-heart]', { opacity: 0, duration: 0.4 }, 0.5)
        .fromTo('[data-circle]', { scale: 0 }, { scale: full, duration: 0.7, ease: 'power2.in' }, 0.2)
        .call(onCovered, undefined, 0.9)
    },
    { scope: root },
  )

  // The beating heart while the answer is on its way (static with reduced motion).
  useGSAP(
    () => {
      if (!waiting) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.to('[data-wait-heart]', { scale: 1.15, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1 })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [waiting] },
  )

  return (
    <div ref={root} className="fixed inset-0 z-[60] overflow-hidden">
      <div data-fade aria-hidden="true" className="absolute inset-0 bg-background opacity-0" />
      <div
        data-circle
        aria-hidden="true"
        className="absolute rounded-full bg-primary"
        style={{
          width: CIRCLE,
          height: CIRCLE,
          left: origin.x - CIRCLE / 2,
          top: origin.y - CIRCLE / 2,
          transform: 'scale(0)',
        }}
      />
      {Array.from({ length: HEARTS }, (_, i) => (
        <Heart
          key={i}
          data-heart
          aria-hidden="true"
          className="absolute size-6 fill-accent text-accent opacity-0"
          style={{ left: origin.x - 12, top: origin.y - 12 }}
        />
      ))}
      {waiting && (
        <div data-wait className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Heart
            data-wait-heart
            aria-hidden="true"
            className="size-10 fill-current text-primary-foreground motion-reduce:text-primary"
          />
          <p role="status" className="min-h-7 text-[17px] font-semibold text-primary-foreground motion-reduce:text-foreground">
            {label ? 'Guardando tu sí…' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
