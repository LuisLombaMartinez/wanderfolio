import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import { Heart } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { LostCompass } from '@/components/LostCompass'
import { Button } from '@/components/ui/button'
import { gsap, useGSAP } from '@/lib/gsap'

/** The 404: an unknown route, for a signed-in Member (design/MASTER.md section 25). */
export function NotFoundPage() {
  const heading = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLElement>(null)

  const { pathname } = useLocation()

  // Runs again when one unknown URL is replaced by another (the page stays mounted).
  useEffect(() => {
    document.title = 'Nos hemos perdido · Viajecito'
    heading.current?.focus()
  }, [pathname])

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        // opacity, not autoAlpha: the h1 must stay focusable while it fades in.
        gsap.from('[data-enter]', { opacity: 0, y: 16, duration: 0.45, ease: 'power2.out', stagger: 0.07, delay: 0.2 })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <>
      <AppHeader />
      <main
        ref={root}
        className="mx-auto flex min-h-[calc(100dvh-var(--app-header-height)-env(safe-area-inset-top))] w-full max-w-[520px] flex-col items-center justify-center px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] text-center lg:pb-[8dvh]"
      >
        <LostCompass size="page" animated />
        <p data-enter aria-hidden="true" className="mt-6 font-script text-[32px] leading-tight text-primary">
          uy, nos hemos perdido
        </p>
        <h1
          ref={heading}
          data-enter
          tabIndex={-1}
          className="mt-2 font-serif text-[clamp(2rem,8vw,2.75rem)] font-bold leading-tight text-balance outline-none"
        >
          Este camino no lleva a ningún sitio
        </h1>
        <p data-enter className="mt-3 max-w-[36ch] leading-[1.55] text-muted-foreground">
          Aquí no hay ningún viaje, solo un enlace que se ha perdido por el camino. Pero perderse contigo tampoco está
          tan mal… ¿volvemos a nuestros viajes?
        </p>
        {/* The wrapper animates: the Button's own CSS transition on opacity would fight GSAP. */}
        <div data-enter className="mt-7 w-full max-w-[320px] lg:w-auto">
          <Button asChild className="w-full lg:min-w-[220px]">
            <Link to="/">
              <Heart aria-hidden="true" className="size-5" />
              Volver al álbum
            </Link>
          </Button>
        </div>
        <p data-enter className="mt-4 text-[13px] tracking-[0.04em] text-muted-foreground">
          Error 404 · página no encontrada
        </p>
      </main>
    </>
  )
}
