import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Link, useLocation } from 'react-router'
import { Check, CloudOff, Heart, Info, Plane, Plus } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { AppHeader } from '@/components/AppHeader'
import { StateCard } from '@/components/StateCard'
import { TripCard } from '@/components/TripCard'
import { Button } from '@/components/ui/button'
import { listTrips, type Trip } from '@/lib/api'
import { gsap, useGSAP } from '@/lib/gsap'
import { useAfter } from '@/lib/useAfter'
import { INVITATION_GONE } from '@/lib/messages'

// The Album's entrances play once per visit to the app, not on every return from a Trip page.
let albumEntered = false

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; trips: Trip[] }

/** The Album: every Trip, newest first. This ticket ships its shell and empty state. */
export function AlbumPage() {
  const { handleApiError } = useAuth()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLElement>(null)
  const location = useLocation()
  const [deleted, setDeleted] = useState<string | null>(
    () => (location.state as { deleted?: string } | null)?.deleted ?? null,
  )
  // Set by the InvitationGate when the Invitation said "Sí" to no longer exists (MASTER section 50).
  const invitationGone = (location.state as { invitationGone?: boolean } | null)?.invitationGone === true
  const ready = load.status === 'ready'
  const hasTrips = ready && load.trips.length > 0

  // The delete notice shows for 5s, and not again when coming back to this entry.
  useEffect(() => {
    if (!deleted) return
    window.history.replaceState({ ...window.history.state, usr: null }, '')
    const t = window.setTimeout(() => setDeleted(null), 5000)
    return () => window.clearTimeout(t)
  }, [deleted])

  useEffect(() => {
    document.title = 'Nuestro álbum · Viajecito'
    heading.current?.focus()
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    listTrips(ctrl.signal)
      .then((trips) => setLoad({ status: 'ready', trips }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        // An expired or revoked login goes back to the login page (via the route guard).
        if (!handleApiError(err)) setLoad({ status: 'error' })
      })
    return () => ctrl.abort()
  }, [attempt, handleApiError])

  const retry = useCallback(() => {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        if (albumEntered) return
        gsap.from('[data-enter]', { autoAlpha: 0, y: 24, duration: 0.5, ease: 'power2.out' })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  // Cards enter once after the title row (the first 9 only, staggered).
  useGSAP(
    () => {
      if (!hasTrips) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        if (albumEntered) return
        gsap.from(gsap.utils.toArray<HTMLElement>('[data-card]').slice(0, 9), {
          autoAlpha: 0,
          y: 24,
          duration: 0.45,
          delay: 0.2,
          stagger: 0.06,
          ease: 'power2.out',
        })
      })
      albumEntered = true
      return () => mm.revert()
    },
    { scope: root, dependencies: [hasTrips] },
  )

  return (
    <>
      <AppHeader />
      <main ref={root} className="mx-auto w-full max-w-[1100px] px-5 pb-16 pt-8 md:pt-12">
        <div
          data-enter
          className={hasTrips ? 'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between' : 'text-center'}
        >
          <div>
            <p aria-hidden="true" className="font-script text-[28px] leading-none text-primary">
              todos nuestros viajes
            </p>
            <h1
              ref={heading}
              tabIndex={-1}
              className="mt-1 font-serif text-[clamp(2rem,7vw,3rem)] font-bold leading-tight outline-none"
            >
              Nuestro álbum
            </h1>
            {load.status === 'ready' && hasTrips && (
              <p className="mt-1 text-[15px] text-muted-foreground">
                {load.trips.length === 1 ? '1 viaje juntos' : `${load.trips.length} viajes juntos`}
              </p>
            )}
          </div>
          {hasTrips && (
            <Button asChild className="w-full sm:w-auto">
              <Link to="/trips/new">
                <Plus aria-hidden="true" className="size-5" />
                Nuevo viaje
              </Link>
            </Button>
          )}
        </div>

        {deleted && (
          <p
            role="status"
            className="mx-auto mt-8 flex w-fit max-w-full items-center gap-2 rounded-full bg-secondary px-4 py-2 text-[15px] text-secondary-foreground"
          >
            <Check aria-hidden="true" className="size-4 shrink-0" />
            Hemos borrado «{deleted}» del álbum.
          </p>
        )}
        {invitationGone && (
          <p
            role="status"
            className="mx-auto mt-8 flex w-fit max-w-full items-center gap-2 rounded-full bg-secondary px-4 py-2 text-[15px] text-secondary-foreground"
          >
            <Info aria-hidden="true" className="size-4 shrink-0" />
            {INVITATION_GONE}
          </p>
        )}

        <div className="mt-10">
          {load.status === 'loading' && <AlbumSkeleton />}
          {load.status === 'error' && <AlbumError onRetry={retry} />}
          {load.status === 'ready' && load.trips.length === 0 && <EmptyAlbum />}
          {load.status === 'ready' && hasTrips && (
            <ul className="grid list-none gap-5 p-0 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              {load.trips.map((trip, i) => (
                <li key={trip.id}>
                  <TripCard trip={trip} lazy={i >= 3} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  )
}

/** Entrance for a state card, once on mount: opacity and y 24px -> 0. */
function useCardEntrance(card: RefObject<HTMLElement | null>) {
  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(card.current, { autoAlpha: 0, y: 24, duration: 0.5, delay: 0.1, ease: 'power2.out' })
    })
    return () => mm.revert()
  })
}

function EmptyAlbum() {
  const card = useRef<HTMLElement>(null)
  const art = useRef<HTMLDivElement>(null)
  useCardEntrance(card)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.to('[data-plane]', { y: -4, rotation: 3, duration: 2, ease: 'sine.inOut', yoyo: true, repeat: -1 })
      })
      return () => mm.revert()
    },
    { scope: art },
  )

  return (
    <section
      ref={card}
      aria-labelledby="empty-album-title"
      className="mx-auto flex max-w-[560px] flex-col items-center rounded-frame bg-card px-6 py-8 text-center shadow-pink md:px-10 md:py-10"
    >
      <div ref={art} aria-hidden="true" className="relative grid size-[120px] place-items-center rounded-full bg-secondary">
        <svg viewBox="0 0 120 120" className="absolute inset-0 size-full text-primary/40" fill="none">
          <path d="M22 84 C 40 40, 80 34, 96 58" stroke="currentColor" strokeWidth="2" strokeDasharray="4 6" strokeLinecap="round" />
        </svg>
        <span data-plane className="absolute left-[18px] top-[52px]">
          <Plane className="size-10 -rotate-12 text-ocean" strokeWidth={1.75} />
        </span>
        <Heart className="absolute right-[14px] top-[44px] size-7 fill-primary/20 text-primary" strokeWidth={1.75} />
      </div>
      <h2 id="empty-album-title" className="mt-6 font-serif text-[28px] font-bold leading-tight text-balance">
        Aquí empezará nuestra historia
      </h2>
      <p className="mt-2 max-w-[38ch] text-muted-foreground">
        Todavía no hay ningún viaje en el álbum. ¿Planeamos el primero juntos?
      </p>
      <Button asChild className="mt-6">
        <Link to="/trips/new">
          <Plus aria-hidden="true" className="size-5" />
          Crear nuestro primer viaje
        </Link>
      </Button>
    </section>
  )
}

function AlbumSkeleton() {
  const visible = useAfter(200)
  if (!visible) return null
  return (
    <div role="status" aria-label="Cargando nuestros viajes" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1].map((i) => (
        <div key={i} className="shimmer rounded-photo bg-card p-3 shadow-pink">
          <div className="aspect-[4/3] rounded-[18px] bg-muted" />
          <div className="mt-4 h-5 w-2/3 rounded-full bg-muted" />
          <div className="mb-2 mt-2 h-4 w-1/3 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  )
}

function AlbumError({ onRetry }: { onRetry: () => void }) {
  return (
    <StateCard
      alert
      icon={<CloudOff aria-hidden="true" className="size-10 text-muted-foreground" strokeWidth={1.75} />}
      title="No hemos podido abrir el álbum"
      action={
        <Button type="button" variant="soft" className="min-h-12 px-8" onClick={onRetry}>
          Reintentar
        </Button>
      }
    >
      Algo ha fallado por el camino. ¿Probamos otra vez?
    </StateCard>
  )
}
