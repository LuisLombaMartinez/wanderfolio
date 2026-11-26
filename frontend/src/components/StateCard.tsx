import { useRef, type ReactNode } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'

interface StateCardProps {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  /** Errors announce themselves; plain states (not found) do not. */
  alert?: boolean
}

/** The soft card for an error or not-found state (design/MASTER.md section 16). */
export function StateCard({ icon, title, children, action, alert }: StateCardProps) {
  const card = useRef<HTMLElement>(null)
  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(card.current, { autoAlpha: 0, y: 24, duration: 0.5, delay: 0.1, ease: 'power2.out' })
    })
    return () => mm.revert()
  })
  return (
    <section
      ref={card}
      role={alert ? 'alert' : undefined}
      className="mx-auto flex max-w-[560px] flex-col items-center rounded-frame bg-card px-6 py-8 text-center shadow-pink"
    >
      {icon}
      <h2 className="mt-4 font-serif text-[28px] font-bold leading-tight text-balance">{title}</h2>
      {children && <p className="mt-2 text-muted-foreground">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </section>
  )
}
