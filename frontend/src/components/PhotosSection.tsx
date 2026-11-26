import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AlertCircle, ImagePlus, WifiOff } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { DeletePhotoDialog } from '@/components/DeletePhotoDialog'
import { FailedPhotoDialog } from '@/components/FailedPhotoDialog'
import { FailedPhotosNote } from '@/components/FailedPhotosNote'
import { PhotoTile } from '@/components/PhotoTile'
import { PhotoViewer, useOpenViewer } from '@/components/PhotoViewer'
import { UploadRefusals } from '@/components/UploadRefusals'
import { Button } from '@/components/ui/button'
import { retryPhoto, type Photo, type Trip } from '@/lib/api'
import { gsap, prefersReducedMotion, useGSAP } from '@/lib/gsap'
import {
  MEDIA_SESSION_ERROR,
  PHOTO_GONE,
  POLLING_LOST,
  RETRY_ALREADY,
  RETRY_STARTED,
  UPLOAD_LINKS_ERROR,
  UPLOAD_TRIP_GONE,
  failureAnnouncement,
  retryAllStarted,
} from '@/lib/messages'
import { classifyRetryError, retryMany, type RetryOutcome } from '@/lib/photo-retry'
import { removePhoto } from '@/lib/photos'
import { flipPlan, orderChanged, type Box } from '@/lib/reorder'
import { buildTiles, isUnfinished } from '@/lib/tiles'
import { ACCEPT } from '@/lib/upload-checks'
import { barModel, dismissRefusals, noteRetried, pickFiles, retryLinks, retryUpload } from '@/lib/upload-store'
import { useMediaSession } from '@/lib/useMediaSession'
import { useUploads } from '@/lib/useUploads'

const ENTER_CAP = 12
const EAGER_TILES = 9
/** "Reintentar todas": tiles that flip back to revealing one after the other, the rest go at once. */
const STAGGER_CAP = 12

interface PhotosSectionProps {
  trip: Trip
  upcoming: boolean
  /** Polling has failed several times in a row. */
  connectionLost: boolean
  actions: PhotoActions
}

/** How the Trip page lets the Photos change under it (a retry, a caption, a delete, a silent refetch). */
export interface PhotoActions {
  /** One Photo changed (a retry started): swap it into the Trip. */
  onPhoto: (photo: Photo) => void
  /** One Photo no longer exists. */
  onPhotoGone: (photoId: string) => void
  /** Any local change to the Trip (a caption saved, a Photo deleted); polls already in flight are dropped. */
  onTripChange: (change: (trip: Trip) => Trip) => void
  /** The Trip itself no longer exists. */
  onTripGone: () => void
  /** Fetches the Trip again without any message. */
  refresh: () => Promise<void>
}

/** The Trip page's Photos: header, upload button, grid of tiles, empty state and banners (MASTER section 28). */
export function PhotosSection({ trip, upcoming, connectionLost, actions }: PhotosSectionProps) {
  const { handleApiError } = useAuth()
  const { onTripChange, onTripGone } = actions
  const uploads = useUploads()
  const media = useMediaSession()
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLElement>(null)
  const openViewer = useOpenViewer()
  const [removing, setRemoving] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const removingPhoto = trip.photos?.find((p) => p.id === removing)

  const mine = useMemo(() => uploads.uploads.filter((u) => u.tripId === trip.id), [uploads.uploads, trip.id])
  const tiles = useMemo(() => buildTiles(trip.photos ?? [], mine, uploads.abandoned), [trip.photos, mine, uploads.abandoned])
  const coverKind = (tile: (typeof tiles)[number]) =>
    tile.state.kind === 'ready' && trip.coverPhoto?.id === tile.state.photo.id ? (trip.coverPhoto.chosen ? 'chosen' : 'default') : undefined
  const unfinished = tiles.filter(isUnfinished).length
  const [removedFocus, setRemovedFocus] = useState<{ key: string | null } | null>(null)
  // The Photo behind the delete dialog stopped being failed (the other Member retried it) or disappeared:
  // close the dialog, say so, and keep focus on the page.
  if (removing !== null && removingPhoto?.status !== 'failed') {
    setRemoving(null)
    setAnnounce(removingPhoto ? RETRY_ALREADY : PHOTO_GONE)
    setRemovedFocus({ key: removingPhoto ? removing : neighbourKey(tiles, removing) })
  }
  useEffect(() => {
    if (!removedFocus) return
    const t = window.setTimeout(() => focusTile(removedFocus.key), 0)
    return () => window.clearTimeout(t)
  }, [removedFocus])
  const failedPhotos = useMemo(() => tiles.flatMap((t) => (t.state.kind === 'failed' ? [t.state.photo] : [])), [tiles])
  const refusals = uploads.refusals[trip.id]?.items ?? []
  const banner = uploads.banners[trip.id]
  const barShowing = barModel(uploads) !== null

  // Refusals describe the latest pick only until the Member leaves this Trip.
  useEffect(() => () => dismissRefusals(trip.id), [trip.id])

  const pick = (list: FileList | null) => {
    const files = list ? Array.from(list) : []
    if (input.current) input.current.value = '' // so picking the same file again still fires
    pickFiles(trip.id, trip.title, files)
  }
  const choose = () => input.current?.click()

  const empty = tiles.length === 0
  let enterOrdinal = 0

  const { dialogPhoto, closeDialog, openDialog, removeFailed, retryOne, retryAll, retryingAll, retryOrder, onCloseFocus, leftOver, announcement } =
    useFailedPhotos({ trip, tiles, failedPhotos, retried: uploads.retried, actions, onAuthError: handleApiError })
  const grid = useReorderAnimation(tiles.map((t) => t.key))

  useGSAP(
    () => {
      if (!root.current?.querySelector('[data-banner]')) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-banner]', { autoAlpha: 0, y: 4, duration: 0.15, ease: 'power2.out' })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [banner?.kind, media.status === 'failed'] },
  )

  return (
    <section
      ref={root}
      data-enter
      aria-labelledby="photos-title"
      className={barShowing ? 'mt-12 pb-32 lg:pb-12' : 'mt-12'}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="photo-input"
        accept={ACCEPT}
        onChange={(e) => pick(e.target.files)}
      />
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h2 id="photos-title" tabIndex={-1} className="font-serif text-[28px] font-bold leading-tight outline-none">
            Nuestras fotos
          </h2>
          {!empty && (
            <p className="text-[15px] text-muted-foreground">
              {trip.photoCount > 0 && (trip.photoCount === 1 ? '1 foto' : `${trip.photoCount} fotos`)}
              {trip.photoCount > 0 && unfinished > 0 && ' · '}
              {unfinished > 0 && `${unfinished} revelándose`}
              {failedPhotos.length > 0 && (trip.photoCount > 0 || unfinished > 0) && ' · '}
              {failedPhotos.length > 0 && `${failedPhotos.length} sin revelar`}
            </p>
          )}
        </div>
        {!empty && (
          <Button type="button" className="min-w-0 px-5 max-[359px]:w-full" onClick={choose}>
            <ImagePlus aria-hidden="true" className="size-5" />
            Subir fotos
          </Button>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-4 empty:hidden">
        {banner?.kind === 'links' && (
          <div role="alert" data-banner className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary p-4 text-secondary-foreground">
            <p className="flex items-center gap-2">
              <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
              {UPLOAD_LINKS_ERROR}
            </p>
            <Button type="button" variant="soft" className="min-h-11 bg-card px-5" onClick={() => retryLinks(banner.batchId)}>
              Reintentar
            </Button>
          </div>
        )}
        {banner?.kind === 'trip-gone' && (
          <div role="alert" data-banner className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary p-4 text-secondary-foreground">
            <p className="flex items-center gap-2">
              <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
              {UPLOAD_TRIP_GONE}
            </p>
            <Button asChild variant="soft" className="min-h-11 bg-card px-5">
              <Link to="/">Volver al álbum</Link>
            </Button>
          </div>
        )}
        {media.status === 'failed' && (
          <div role="alert" data-banner className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary p-4 text-secondary-foreground">
            <p className="flex items-center gap-2">
              <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
              {MEDIA_SESSION_ERROR}
            </p>
            <Button type="button" variant="soft" className="min-h-11 bg-card px-5" onClick={media.retry}>
              Reintentar
            </Button>
          </div>
        )}
        {connectionLost && (
          <p role="status" className="flex items-center gap-2 text-[15px] text-muted-foreground">
            <WifiOff aria-hidden="true" className="size-4 shrink-0" />
            {POLLING_LOST}
          </p>
        )}
        <UploadRefusals refusals={refusals} onDismiss={() => dismissRefusals(trip.id)} />
        <FailedPhotosNote count={failedPhotos.length} busy={retryingAll} leftOver={leftOver} onRetryAll={() => void retryAll()} />
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {empty ? (
        <EmptyPhotos upcoming={upcoming} onChoose={choose} />
      ) : (
        <ul ref={grid} data-testid="photo-grid" className="mt-5 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5">
          {tiles.map((tile, i) => {
            const enterIndex = tile.state.kind === 'queued' && tile.localId && enterOrdinal < ENTER_CAP ? enterOrdinal++ : undefined
            return (
              <PhotoTile
                key={tile.key}
                tile={tile}
                enterIndex={enterIndex}
                eager={i < EAGER_TILES}
                retryIndex={tile.photoId ? retryOrder[tile.photoId] : undefined}
                onRetry={retryUpload}
                onOpenFailed={openDialog}
                onOpen={openViewer}
                cover={coverKind(tile)}
              />
            )
          })}
        </ul>
      )}
      <FailedPhotoDialog
        photo={dialogPhoto}
        secondTry={dialogPhoto ? uploads.retried.includes(dialogPhoto.id) : false}
        onRetry={retryOne}
        onClose={closeDialog}
        onRemove={(p) => {
          removeFailed()
          setRemoving(p.id)
        }}
        onCloseFocus={onCloseFocus}
      />
      <p role="status" className="sr-only">
        {announce}
      </p>
      <PhotoViewer trip={trip} onTripChange={onTripChange} onTripGone={onTripGone} />
      {/* Removing a failed Photo (MASTER sections 34 and 43): opened from FailedPhotoDialog, never stacked. */}
      {removingPhoto && (
        <DeletePhotoDialog
          tripId={trip.id}
          photo={removingPhoto}
          mode="failed"
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          onTripGone={onTripGone}
          onDeleted={() => {
            // Focus goes to the next tile, else the previous one, else the heading.
            const ids = tiles.flatMap((t) => (t.state.kind === 'failed' || t.state.kind === 'ready' ? [t.state.photo.id] : []))
            const at = ids.indexOf(removingPhoto.id)
            const target = ids[at + 1] ?? ids[at - 1]
            setRemoving(null)
            onTripChange((t) => removePhoto(t, removingPhoto.id))
            setAnnounce('Foto borrada')
            window.setTimeout(() => {
              const el = target ? document.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(target)}"]`) : null
              ;(el ?? document.getElementById('photos-title'))?.focus()
            }, 0)
          }}
        />
      )}
    </section>
  )
}

/** Everything about failed Photos on the page: the dialog, retry one or all, live announcements, focus. */
function useFailedPhotos({
  trip,
  tiles,
  failedPhotos,
  retried,
  actions,
  onAuthError,
}: {
  trip: Trip
  tiles: ReturnType<typeof buildTiles>
  failedPhotos: Photo[]
  retried: readonly string[]
  actions: PhotoActions
  onAuthError: (err: unknown) => boolean
}) {
  const [dialogId, setDialogId] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)
  const [leftOver, setLeftOver] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const alive = useRef(true)
  // Where focus goes once the dialog has closed (Radix hands it to `onCloseFocus`).
  const closeFocus = useRef<string | null>(null)
  const skipCloseFocus = useRef(false)
  const [goneFocus, setGoneFocus] = useState<{ key: string | null } | null>(null)
  useEffect(() => {
    if (goneFocus) closeFocus.current = goneFocus.key
  }, [goneFocus])
  // Where focus goes after "Reintentar todas" ends, when no dialog was involved.
  const [runFocus, setRunFocus] = useState<{ key: string | null } | null>(null)
  const [retryOrder, setRetryOrder] = useState<Record<string, number>>({})
  const statuses = useRef<Map<string, string> | null>(null)
  const retriedNow = useRef(retried)
  useEffect(() => {
    retriedNow.current = retried
  })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const dialogPhoto = failedPhotos.find((p) => p.id === dialogId) ?? null

  // Photos that turn failed while the Member watches are announced; those failed on load are not.
  const photos = trip.photos
  useEffect(() => {
    const before = statuses.current
    statuses.current = new Map((photos ?? []).map((p) => [p.id, p.status]))
    if (!before) return
    const turned = (photos ?? []).filter((p) => p.status === 'failed' && before.get(p.id) !== 'failed')
    if (turned.length === 0) return
    setAnnouncement(failureAnnouncement(turned.map((p) => ({ filename: p.filename, again: retriedNow.current.includes(p.id) }))))
  }, [photos])

  // The Photo under an open dialog stopped being failed (the other Member retried it) or disappeared.
  if (dialogId !== null && !dialogPhoto) {
    const now = photos?.find((p) => p.id === dialogId)
    setGoneFocus({ key: now ? dialogId : neighbourKey(tiles, dialogId) })
    setDialogId(null)
    setAnnouncement(now ? RETRY_ALREADY : PHOTO_GONE)
  }

  // "Reintentar todas" ended: the button may be gone with the note, so focus goes to a retried tile.
  useEffect(() => {
    if (!runFocus) return
    // Only when focus is still on the retry-all button (about to vanish with the note) or nowhere.
    const active = document.activeElement
    if (!active || active === document.body || active.closest('[data-retry-all]')) focusTile(runFocus.key)
  }, [runFocus])

  const retryOne = useCallback(
    async (photo: Photo): Promise<RetryOutcome> => {
      try {
        const fresh = await retryPhoto(trip.id, photo.id)
        if (!alive.current) return 'started'
        noteRetried(photo.id)
        closeFocus.current = photo.id
        setDialogId(null)
        setAnnouncement(RETRY_STARTED)
        actions.onPhoto(fresh)
        return 'started'
      } catch (err) {
        if (!alive.current) return 'error'
        if (onAuthError(err)) return 'auth'
        const outcome = classifyRetryError(err)
        if (outcome === 'error') return outcome
        closeFocus.current = outcome === 'gone' ? neighbourKey(tiles, photo.id) : photo.id
        setDialogId(null)
        if (outcome === 'gone') {
          setAnnouncement(PHOTO_GONE)
          actions.onPhotoGone(photo.id)
        } else if (outcome === 'trip-gone') actions.onTripGone()
        else void actions.refresh()
        return outcome
      }
    },
    [trip.id, tiles, actions, onAuthError],
  )

  const retryAll = useCallback(async () => {
    if (retryingAll) return
    const ids = failedPhotos.map((p) => p.id)
    setRetryingAll(true)
    setLeftOver(0)
    const results = await retryMany(ids, (id) => retryPhoto(trip.id, id), onAuthError)
    if (!alive.current) return
    setRetryingAll(false)
    let started = 0
    let refresh = false
    let tripGone = false
    let first: string | null = null
    const order: Record<string, number> = {}
    for (const r of results) {
      if (r.outcome === 'started' && r.photo) {
        // The tiles flip one after the other (MASTER section 42); past the cap they go at once.
        if (started < STAGGER_CAP) order[r.id] = started
        first ??= r.id
        started++
        noteRetried(r.id)
        actions.onPhoto(r.photo)
      } else if (r.outcome === 'gone') actions.onPhotoGone(r.id)
      else if (r.outcome === 'refresh') refresh = true
      else if (r.outcome === 'trip-gone') tripGone = true
    }
    setRetryOrder(order)
    if (started > 0) setAnnouncement(retryAllStarted(started))
    if (tripGone) return actions.onTripGone()
    if (results.some((r) => r.outcome === 'auth')) return
    if (refresh) void actions.refresh()
    setLeftOver(results.filter((r) => r.outcome === 'error').length + (ids.length - results.length))
    setRunFocus({ key: first })
  }, [retryingAll, failedPhotos, trip.id, actions, onAuthError])

  return {
    dialogPhoto,
    openDialog: (id: string) => {
      skipCloseFocus.current = false
      setDialogId(id)
    },
    closeDialog: () => {
      closeFocus.current = dialogId
      setDialogId(null)
    },
    // "Quitarla del viaje" hands focus to the delete dialog; this one must not steal it back.
    removeFailed: () => {
      skipCloseFocus.current = true
      setDialogId(null)
    },
    onCloseFocus: () => {
      if (skipCloseFocus.current) {
        skipCloseFocus.current = false
        return
      }
      focusTile(closeFocus.current)
    },
    retryOne,
    retryAll,
    retryingAll,
    retryOrder,
    leftOver,
    announcement,
  }
}

/** Focus the tile of a Photo (its revealing marker or button), else the Photos heading. */
function focusTile(key: string | null) {
  const li = key ? document.querySelector<HTMLElement>(`[data-tile-photo-id="${CSS.escape(key)}"]`) : null
  const target = li?.querySelector<HTMLElement>('[data-revealing], button') ?? document.getElementById('photos-title')
  target?.focus()
}

/** After a Photo leaves the grid, focus goes to the next tile, else the previous one. */
function neighbourKey(tiles: ReturnType<typeof buildTiles>, photoId: string): string | null {
  const i = tiles.findIndex((t) => t.photoId === photoId)
  return tiles[i + 1]?.photoId ?? tiles[i - 1]?.photoId ?? null
}

/**
 * Animates the tiles that change place when the date-taken order changes (MASTER section 44): the old
 * and new boxes are compared after each change of order and the tiles tween from where they were (400ms).
 */
function useReorderAnimation(keys: string[]) {
  const grid = useRef<HTMLUListElement>(null)
  const boxes = useRef(new Map<string, Box>())
  const order = useRef<string[]>([])
  const orderKey = keys.join('|')

  // Boxes are relative to the grid, so a banner appearing above it does not look like every tile moved.
  const measure = useCallback(() => {
    const ul = grid.current
    const next = new Map<string, Box>()
    if (!ul) return next
    ul.querySelectorAll<HTMLElement>(':scope > [data-tile-key]').forEach((li) => {
      next.set(li.dataset.tileKey ?? '', { x: li.offsetLeft - ul.offsetLeft, y: li.offsetTop - ul.offsetTop })
    })
    return next
  }, [])

  // Runs on mount and whenever the order (or the set of tiles) changes; with dependencies the context is
  // only reverted on unmount, so a Flip in progress is not cut short by the next render.
  useGSAP(
    () => {
      const next = measure()
      if (orderChanged(order.current, keys) && !prefersReducedMotion()) {
        const ul = grid.current
        const gridTop = ul ? ul.getBoundingClientRect().top + window.scrollY : 0
        const viewport = { top: window.scrollY - gridTop, bottom: window.scrollY - gridTop + window.innerHeight }
        const moves = flipPlan(boxes.current, next, viewport)
        const els = ul?.querySelectorAll<HTMLElement>(':scope > [data-tile-key]')
        if (els) {
          // Only the tiles that move get a tween, so a tile's own enter or shake tween is left alone.
          for (const move of moves) {
            const el = [...els].find((e) => e.dataset.tileKey === move.key)
            if (el) gsap.fromTo(el, { x: move.dx, y: move.dy }, { x: 0, y: 0, duration: 0.4, ease: 'power2.inOut', overwrite: 'auto', clearProps: 'x,y' })
          }
        }
      }
      boxes.current = next
      order.current = keys
    },
    { dependencies: [orderKey] },
  )

  useEffect(() => {
    const onResize = () => {
      boxes.current = measure()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure])

  return grid
}

function EmptyPhotos({ upcoming, onChoose }: { upcoming: boolean; onChoose: () => void }) {
  return (
    <div className="mx-auto mt-5 flex max-w-[560px] flex-col items-center rounded-photo border-2 border-dashed border-border p-8 text-center">
      <span aria-hidden="true" className="grid size-[88px] place-items-center rounded-full bg-secondary">
        <ImagePlus className="size-9 text-primary" strokeWidth={1.75} />
      </span>
      <h3 className="mt-4 font-serif text-2xl font-bold leading-tight">
        {upcoming ? 'Aquí vivirán las fotos del viaje' : 'Aún no hay fotos de este viaje'}
      </h3>
      <p className="mt-2 text-muted-foreground">
        {upcoming
          ? 'Cuando estemos allí, sube las fotos y aparecerán aquí.'
          : 'Elige todas las que quieras de tu galería y las vamos colocando solitas.'}
      </p>
      <Button type="button" className="mt-5" onClick={onChoose}>
        <ImagePlus aria-hidden="true" className="size-5" />
        Elegir fotos
      </Button>
      <p className="mt-3 text-sm text-muted-foreground">JPG, PNG, WebP o HEIC, hasta 30 MB cada una.</p>
    </div>
  )
}
