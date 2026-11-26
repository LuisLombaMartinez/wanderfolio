import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { gsap, useGSAP } from '@/lib/gsap'

/** Shown while the saved session is checked; appears only after 200ms so fast boots never flash it. */
export function BootScreen() {
  const [visible, setVisible] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 200)
    return () => window.clearTimeout(t)
  }, [])

  useGSAP(
    () => {
      if (!visible) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.to('[data-heart]', { scale: 1.08, duration: 0.75, ease: 'sine.inOut', yoyo: true, repeat: -1 })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [visible] },
  )

  return (
    <div ref={root} className="grid min-h-dvh place-items-center px-5" role="status" aria-live="polite">
      {visible && (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Heart data-heart aria-hidden="true" className="size-8 fill-primary/20 text-primary" strokeWidth={1.75} />
          <p>Abriendo nuestro álbum…</p>
        </div>
      )}
    </div>
  )
}
