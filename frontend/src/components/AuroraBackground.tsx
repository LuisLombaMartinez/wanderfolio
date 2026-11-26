import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'

/** Sunset gradient with three blurred blobs; the slow drift stops with reduced motion. */
export function AuroraBackground() {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.utils.toArray<HTMLElement>('[data-blob]').forEach((blob, i) => {
          gsap.to(blob, {
            x: (i % 2 === 0 ? 1 : -1) * 40,
            y: (i === 1 ? -1 : 1) * 30,
            duration: 9 + i * 2,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          })
        })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <div
      ref={root}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ backgroundImage: 'var(--gradient-sunset)' }}
    >
      <div data-blob className="absolute -left-24 -top-24 size-80 rounded-full bg-primary/15 blur-3xl" />
      <div data-blob className="absolute -right-20 top-1/3 size-72 rounded-full bg-accent/20 blur-3xl" />
      <div data-blob className="absolute -bottom-24 left-1/4 size-80 rounded-full bg-ocean/15 blur-3xl" />
    </div>
  )
}
