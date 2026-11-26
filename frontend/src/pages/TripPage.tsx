import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { CalendarHeart, Check, Hourglass, MapPin, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { Countdown } from '@/components/Countdown'
import { DeleteTripDialog } from '@/components/DeleteTripDialog'
import { InvitationPanel, type PanelNotice, type PanelRemoval } from '@/components/InvitationPanel'
import { InvitationPreview } from '@/components/InvitationPreview'
import { PhotosSection, type PhotoActions } from '@/components/PhotosSection'
import { TripCover } from '@/components/TripCover'
import { TripShell } from '@/components/TripShell'
import { TripLoadErrorCard, TripNotFoundCard } from '@/components/TripStateCards'
import { Button } from '@/components/ui/button'
import { ApiError, getTrip, type Invitation, type Photo, type Trip } from '@/lib/api'
import { daysUntil, formatDateRange, tripLengthLabel } from '@/lib/dates'
import { gsap, useGSAP } from '@/lib/gsap'
import { INVITATION_NOT_THERE, PREVIEW_DONE, surpriseCancelled } from '@/lib/messages'
import { removePhoto, replacePhoto } from '@/lib/photos'
import { useAfter } from '@/lib/useAfter'
import { useTripPolling } from '@/lib/useTripPolling'

type Load = { status: 'loading' } | { status: 'not-found' } | { status: 'error' } | { status: 'ready'; trip: Trip }

/** A Trip's own page: details, countdown while upcoming, edit and delete. */
export function TripPage() {
  const { id = '' } = useParams()
  // Keyed by id so navigating between Trips starts from loading, never from the previous Trip.
  return <TripPageFor key={id} id={id} />
}

function TripPageFor({ id }: { id: string }) {
  const { handleApiError } = useAuth()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    getTrip(id, ctrl.signal)
      .then((trip) => setLoad({ status: 'ready', trip }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        if (handleApiError(err)) return
        setLoad(err instanceof ApiError && err.code === 'trip-not-found' ? { status: 'not-found' } : { status: 'error' })
      })
    return () => ctrl.abort()
  }, [id, attempt, handleApiError])

  const onTrip = useCallback((trip: Trip) => setLoad({ status: 'ready', trip }), [])
  const mutations = useRef(0)
  const { connectionLost, refresh } = useTripPolling(id, load.status === 'ready' ? load.trip : null, onTrip, mutations)

  const patchTrip = useCallback(
    (change: (trip: Trip) => Trip) => {
      // Any poll already in flight is now older than the screen and must not overwrite it.
      mutations.current += 1
      setLoad((l) => (l.status === 'ready' ? { status: 'ready', trip: change(l.trip) } : l))
    },
    [],
  )
  // A retry or a vanished Photo changes one Photo without waiting for the next poll; the count,
  // thumbnails and Cover photo are recomputed with it.
  const onPhoto = useCallback((photo: Photo) => patchTrip((t) => replacePhoto(t, photo)), [patchTrip])
  const onPhotoGone = useCallback((photoId: string) => patchTrip((t) => removePhoto(t, photoId)), [patchTrip])
  const onTripGone = useCallback(() => setLoad({ status: 'not-found' }), [])
  const photoActions = useMemo<PhotoActions>(
    () => ({ onPhoto, onPhotoGone, onTripChange: patchTrip, onTripGone, refresh }),
    [onPhoto, onPhotoGone, patchTrip, onTripGone, refresh],
  )

  const retry = useCallback(() => {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    document.title = load.status === 'ready' ? `${load.trip.title} · Viajecito` : 'Viaje · Viajecito'
  }, [load])

  return (
    <TripShell backTo="/" backLabel="Volver al álbum">
      {load.status === 'loading' && <TripSkeleton />}
      {load.status === 'not-found' && <TripNotFoundCard />}
      {load.status === 'error' && <TripLoadErrorCard onRetry={retry} />}
      {load.status === 'ready' && <TripDetails trip={load.trip} connectionLost={connectionLost} photoActions={photoActions} />}
    </TripShell>
  )
}

const PREVIEW_PARAM = 'vista'
const PREVIEW_VALUE = 'previa'

/** What `history.state` carries, so closing the preview knows whether to go Back or to drop the param. */
interface PreviewState {
  preview?: boolean
}

function TripDetails({ trip, connectionLost, photoActions }: { trip: Trip; connectionLost: boolean; photoActions: PhotoActions }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { state, handleApiError } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [panelNotice, setPanelNotice] = useState<PanelNotice>()
  const [pageNotice, setPageNotice] = useState<string>()
  const root = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const previewButton = useRef<HTMLButtonElement>(null)
  const upcoming = daysUntil(trip.startDate) > 0
  const { onTripChange, onTripGone } = photoActions

  // Only the Inviter looks after the Invitation here; what both see once Accepted is another ticket.
  const invitation = trip.invitation
  const isInviter = invitation != null && state.status === 'signed-in' && invitation.inviterId === state.member.id
  const previewing = isInviter && invitation.status === 'pending' && params.get(PREVIEW_PARAM) === PREVIEW_VALUE
  const pushed = (location.state as PreviewState | null)?.preview === true

  const openPreview = useCallback(
    () => navigate({ search: `?${PREVIEW_PARAM}=${PREVIEW_VALUE}` }, { state: { preview: true } satisfies PreviewState }),
    [navigate],
  )
  // Leaving the preview (Salir, Escape, Back, or "Sí") puts focus back on "Ver cómo queda".
  const wasPreviewing = useRef(false)
  useEffect(() => {
    if (wasPreviewing.current && !previewing) previewButton.current?.focus()
    wasPreviewing.current = previewing
  }, [previewing])
  const closePreview = useCallback(() => {
    if (pushed) navigate(-1)
    else navigate({ search: '' }, { replace: true })
  }, [pushed, navigate])

  const setInvitation = useCallback(
    (next: Invitation | null) => onTripChange((t) => ({ ...t, invitation: next })),
    [onTripChange],
  )

  function panelGone(why: PanelRemoval) {
    setInvitation(null)
    setPanelNotice(undefined)
    setPageNotice(why === 'deleted' ? surpriseCancelled(trip.title) : INVITATION_NOT_THERE)
    requestAnimationFrame(() => heading.current?.focus())
  }

  // The status line above the cover fades out by itself.
  useEffect(() => {
    if (!pageNotice) return
    const t = window.setTimeout(() => setPageNotice(undefined), 5000)
    return () => window.clearTimeout(t)
  }, [pageNotice])

  useEffect(() => {
    heading.current?.focus()
  }, [trip.id])

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-cover]', { scale: 0.98, duration: 0.5, ease: 'power2.out' })
        gsap.from('[data-enter]', { autoAlpha: 0, y: 24, duration: 0.5, ease: 'power2.out', stagger: 0.08 })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [trip.id] },
  )

  return (
    <>
      <div ref={root} inert={previewing || undefined} aria-hidden={previewing || undefined}>
        {pageNotice && (
          <p
            role="status"
            className="mx-auto mb-6 flex w-fit max-w-full items-center gap-2 rounded-full bg-secondary px-4 py-2 text-[15px] text-secondary-foreground"
          >
            <Check aria-hidden="true" className="size-4 shrink-0" />
            {pageNotice}
          </p>
        )}
        <div className={`grid gap-6 lg:grid-cols-12 lg:gap-10 ${isInviter ? 'lg:items-start' : 'lg:items-center'}`}>
          <div data-enter data-cover className="mx-auto w-full max-w-[640px] lg:col-span-7 lg:max-w-none">
            <TripCover
              tripId={trip.id}
              upcoming={upcoming}
              cover={trip.coverPhoto}
              size="page"
              className="rounded-frame shadow-pink"
            />
          </div>
  
          <div className="lg:col-span-5">
            <div data-enter>
              <p aria-hidden="true" className="truncate font-script text-[32px] leading-tight text-primary">
                {trip.destination}
              </p>
              <h1
                ref={heading}
                tabIndex={-1}
                className="font-serif text-[clamp(2rem,8vw,3rem)] font-bold leading-tight text-balance outline-none"
              >
                {trip.title}
              </h1>
              <ul className="mt-4 flex list-none flex-col gap-2 p-0 text-base">
                <li className="flex items-center gap-3">
                  <MapPin aria-hidden="true" className="size-5 shrink-0 text-ocean" />
                  {trip.destination}
                </li>
                <li className="flex items-center gap-3">
                  <CalendarHeart aria-hidden="true" className="size-5 shrink-0 text-ocean" />
                  {formatDateRange(trip.startDate, trip.endDate)}
                </li>
                <li className="flex items-center gap-3">
                  <Hourglass aria-hidden="true" className="size-5 shrink-0 text-ocean" />
                  {tripLengthLabel(trip.startDate, trip.endDate)}
                </li>
              </ul>
              <div className="mt-6 flex gap-3">
                <Button asChild variant="soft" className="min-h-12 flex-1 px-6 sm:flex-none">
                  <Link to={`/trips/${trip.id}/edit`}>
                    <Pencil aria-hidden="true" className="size-5" />
                    Editar
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-12 flex-1 px-6 sm:flex-none"
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 aria-hidden="true" className="size-5" />
                  Borrar
                </Button>
              </div>
            </div>
            {isInviter && (
              <div className="mt-6">
                <InvitationPanel
                  tripId={trip.id}
                  tripTitle={trip.title}
                  invitation={invitation}
                  notice={panelNotice}
                  onNotice={setPanelNotice}
                  onInvitation={setInvitation}
                  onRemoved={panelGone}
                  onTripGone={onTripGone}
                  onPreview={openPreview}
                  previewRef={previewButton}
                />
              </div>
            )}
            {upcoming && (
              <div data-enter className="mt-8">
                <Countdown startDate={trip.startDate} />
              </div>
            )}
          </div>
        </div>
  
        {trip.description && (
          <section data-enter className="mt-12">
            <h2 className="font-serif text-[28px] font-bold leading-tight">{upcoming ? 'Nuestro plan' : 'Lo que vivimos'}</h2>
            <p className="mt-3 max-w-[65ch] whitespace-pre-line text-[17px] leading-[1.65]">{trip.description}</p>
          </section>
        )}
  
        <PhotosSection trip={trip} upcoming={upcoming} connectionLost={connectionLost} actions={photoActions} />
  
        <DeleteTripDialog
          trip={trip}
          open={confirming}
          onOpenChange={setConfirming}
          onAuthError={handleApiError}
          onDeleted={() => navigate('/', { replace: true, state: { deleted: trip.title } })}
        />
      </div>
    {isInviter && invitation.status === 'pending' && (
      <InvitationPreview
        open={previewing}
        question={invitation.question}
        destination={trip.destination}
        startDate={trip.startDate}
        endDate={trip.endDate}
        onClose={closePreview}
        onFinished={() => {
          previewButton.current?.focus()
          setPanelNotice({ text: PREVIEW_DONE, icon: 'sparkles', ms: 5000 })
        }}
      />
    )}
    </>
  )
}

function TripSkeleton() {
  const visible = useAfter(200)
  if (!visible) return null
  return (
    <div role="status" aria-label="Cargando el viaje" className="shimmer mx-auto max-w-[640px] lg:max-w-none">
      <div className="aspect-[4/3] rounded-frame bg-muted lg:w-7/12" />
      <div className="mt-6 h-9 w-3/5 rounded-full bg-muted" />
      <div className="mt-5 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-5 w-40 rounded-full bg-muted" />
        ))}
      </div>
      <div className="mt-12 h-8 w-48 rounded-full bg-muted" />
      <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="aspect-square rounded-[14px] bg-muted" />
        ))}
      </div>
    </div>
  )
}
