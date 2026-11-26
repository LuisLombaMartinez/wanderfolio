import { useRef } from 'react'
import { Heart } from 'lucide-react'
import { gsap, useGSAP } from '@/lib/gsap'
import type { Origin } from '@/components/Invitation'

interface TransitionProps {
  origin: Origin
  onCover: () => void
  onDone: () => void
}

const HEARTS = 16
const CIRCLE = 100

/** Hearts burst + circular expansion from the Sí button. Reduced motion: 200ms cross-fade. */
export function Transition({ origin, onCover, onDone }: TransitionProps) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(
        {
          reduce: '(prefers-reduced-motion: reduce)',
          motion: '(prefers-reduced-motion: no-preference)',
        },
        (ctx) => {
          if (ctx.conditions?.reduce) {
            gsap
              .timeline({ onComplete: onDone })
              .fromTo('[data-fade]', { opacity: 0 }, { opacity: 1, duration: 0.1 })
              .call(onCover)
              .to('[data-fade]', { opacity: 0, duration: 0.1 })
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
            .timeline({ onComplete: onDone })
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
            .fromTo(
              '[data-circle]',
              { scale: 0 },
              { scale: full, duration: 0.7, ease: 'power2.in' },
              0.2,
            )
            .call(onCover, undefined, 0.9)
            .to('[data-circle]', { opacity: 0, duration: 0.5, ease: 'power1.out' }, 0.9)
        },
      )
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <div ref={root} aria-hidden="true" className="fixed inset-0 z-50 overflow-hidden">
      <div data-fade className="absolute inset-0 bg-background opacity-0" />
      <div
        data-circle
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
          className="absolute size-6 fill-accent text-accent opacity-0"
          style={{ left: origin.x - 12, top: origin.y - 12 }}
        />
      ))}
    </div>
  )
}
