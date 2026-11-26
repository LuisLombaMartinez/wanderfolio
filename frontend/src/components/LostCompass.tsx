import { useRef } from 'react'
import { Compass, Heart, Plane, type LucideIcon } from 'lucide-react'
import { gsap, useGSAP } from '@/lib/gsap'
import { cn } from '@/lib/utils'

interface LostCompassProps {
  /** `page` is the big 404 illustration; `card` is the small one inside a state card. */
  size: 'page' | 'card'
  /** Replaces the compass (the Trip not-found card uses `MapPinOff`). */
  icon?: LucideIcon
  /** Plays the entrance, the plane's lap and the idle loops. Only the 404 screen sets it. */
  animated?: boolean
}

// The plane rests at 1 o'clock: 30 degrees clockwise from the top of the path.
const REST_ANGLE = 30

/** The lost compass illustration (design/MASTER.md section 25): all decorative, built from Lucide icons and SVG. */
export function LostCompass({ size, icon, animated = false }: LostCompassProps) {
  const root = useRef<HTMLDivElement>(null)
  const orbit = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const compass = useRef<HTMLDivElement>(null)
  const page = size === 'page'
  const Icon = icon ?? Compass

  useGSAP(
    () => {
      if (!animated) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline()
        tl.from(root.current, { autoAlpha: 0, scale: 0.9, duration: 0.5, ease: 'back.out(1.6)' }, 0)
          // One lap of the dashed path, back to 1 o'clock.
          .fromTo(
            orbit.current,
            { rotation: REST_ANGLE },
            { rotation: REST_ANGLE + 360, duration: 1.6, ease: 'power2.inOut' },
            0.2,
          )
          // The compass "looks for north".
          .to(
            compass.current,
            {
              keyframes: [{ rotation: -25 }, { rotation: 18 }, { rotation: -8 }, { rotation: 0 }],
              duration: 1.4,
              ease: 'sine.inOut',
            },
            0.2,
          )
        // Idle: the plane bobs on its spot, the compass wobbles now and then.
        gsap.to(plane.current, { y: 3, duration: 1.5, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.8 })
        gsap.to(compass.current, {
          keyframes: [{ rotation: 6 }, { rotation: -6 }, { rotation: 0 }],
          duration: 0.8,
          ease: 'sine.inOut',
          repeat: -1,
          repeatDelay: 7,
          delay: 8,
        })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [animated] },
  )

  return (
    <div
      ref={root}
      aria-hidden="true"
      className={cn('relative shrink-0', page ? 'size-[200px] lg:size-[250px]' : 'size-[120px]')}
    >
      {/* The --secondary disc is 80% of the box; the dashed path sits 14/200 outside it. */}
      <div className="absolute inset-[10%] rounded-full bg-secondary" />
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full">
        <circle cx="100" cy="100" r="94" fill="none" stroke="var(--primary)" strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="4 6" />
      </svg>
      <div
        ref={compass}
        className={cn(
          'absolute left-1/2 top-1/2 flex size-[28%] -translate-x-1/2 -translate-y-1/2 items-center justify-center',
          page ? 'text-ocean' : 'text-primary',
        )}
      >
        <Icon className="size-full" strokeWidth={1.75} />
      </div>
      <div ref={orbit} data-testid="lost-compass-orbit" className="absolute inset-0" style={{ transform: `rotate(${REST_ANGLE}deg)` }}>
        <div ref={plane} className="absolute left-1/2 top-[3%] -translate-x-1/2 -translate-y-1/2 text-primary">
          <Plane className="size-6 rotate-45" strokeWidth={2} />
        </div>
      </div>
      {page && (
        <>
          <Heart className="absolute left-[2%] top-[66%] size-3 fill-accent text-accent" />
          <Heart className="absolute left-[82%] top-[78%] size-3 fill-accent text-accent" />
        </>
      )}
    </div>
  )
}
