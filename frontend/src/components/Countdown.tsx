import { useRef } from 'react'
import { gsap, useGSAP, ScrollTrigger } from '@/lib/gsap'
import { daysUntil } from '@/lib/dates'

interface CountdownProps {
  /** The Trip's start date, a `YYYY-MM-DD` calendar date (counted in the viewer's local time). */
  startDate: string
}

/** Days left until an upcoming Trip starts. */
export function Countdown({ startDate }: CountdownProps) {
  const root = useRef<HTMLDivElement>(null)
  const numberRef = useRef<HTMLSpanElement>(null)
  const days = daysUntil(startDate)
  const started = days <= 0

  useGSAP(
    () => {
      if (started) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const counter = { value: 0 }
        ScrollTrigger.create({
          trigger: root.current,
          start: 'top 90%',
          once: true,
          onEnter: () =>
            gsap.to(counter, {
              value: days,
              duration: 1,
              ease: 'power2.out',
              onUpdate: () => {
                if (numberRef.current) numberRef.current.textContent = String(Math.round(counter.value))
              },
            }),
        })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <div
      ref={root}
      data-reveal
      className="mx-auto w-full max-w-sm rounded-photo bg-card p-6 text-center shadow-pink"
    >
      {started ? (
        <p className="font-serif text-3xl font-bold text-primary">¡Ya estamos de viaje!</p>
      ) : (
        <>
          <p className="text-base text-muted-foreground">{days === 1 ? 'Falta' : 'Faltan'}</p>
          <p className="font-sans text-7xl font-bold leading-none tabular-nums text-primary">
            <span ref={numberRef}>{days}</span>
          </p>
          <p className="mt-2 text-base text-foreground">
            {days === 1 ? 'día' : 'días'} para estar juntos
          </p>
        </>
      )}
    </div>
  )
}
