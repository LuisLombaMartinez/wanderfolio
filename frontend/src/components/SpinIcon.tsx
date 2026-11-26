import { useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { gsap, useGSAP } from '@/lib/gsap'

/** The retry icon; it turns once a second while `spinning` (not with reduced motion: the button text says it). */
export function SpinIcon({ spinning, className }: { spinning: boolean; className?: string }) {
  const icon = useRef<SVGSVGElement>(null)
  useGSAP(
    () => {
      if (!spinning) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.to(icon.current, { rotation: -360, duration: 0.7, ease: 'none', repeat: -1, transformOrigin: '50% 50%' })
      })
      return () => mm.revert()
    },
    { dependencies: [spinning] },
  )
  return <RotateCcw ref={icon} aria-hidden="true" className={className ?? 'size-[18px]'} />
}
