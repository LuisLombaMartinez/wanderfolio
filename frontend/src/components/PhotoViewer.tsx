import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { CalendarHeart, ChevronLeft, ChevronRight, ImageOff, Pencil, PenLine, Trash2, UserRound, X } from 'lucide-react'
import { CoverControl } from '@/components/CoverControl'
import { CaptionEditor } from '@/components/CaptionEditor'
import { DeletePhotoDialog } from '@/components/DeletePhotoDialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/auth-context'
import { ApiError, setCoverPhoto, type Photo, type Trip } from '@/lib/api'
import { coverGradient } from '@/lib/cover'
import { gsap, prefersReducedMotion, useGSAP } from '@/lib/gsap'
import { COVER_LIVE, COVER_NOTICE, MEDIA_FAILED, PHOTO_GONE, coverErrorMessage } from '@/lib/messages'
import { neighbourAfterRemoval, photoDate, photoLabel, readyPhotos, removePhoto, replacePhoto } from '@/lib/photos'
import { useAfter } from '@/lib/useAfter'
import { useMediaImage } from '@/lib/useMediaImage'
import { useMediaSession } from '@/lib/useMediaSession'
import { cn } from '@/lib/utils'

interface PhotoViewerProps {
  trip: Trip
  onTripChange: (change: (trip: Trip) => Trip) => void
  /** The Trip no longer exists. */
  onTripGone: () => void
}

/** What `history.state` carries, so closing knows whether to go Back or to drop the `?foto` param. */
interface ViewerState {
  viewer?: boolean
}

const PARAM = 'foto'

/** Returns the function that opens the viewer on a Photo (pushes `?foto=id`). */
// eslint-disable-next-line react-refresh/only-export-components
export function useOpenViewer() {
  const navigate = useNavigate()
  return useCallback(
    (photoId: string) => navigate({ search: `?${PARAM}=${encodeURIComponent(photoId)}` }, { state: { viewer: true } satisfies ViewerState }),
    [navigate],
  )
}

/**
 * The full-screen Photo viewer, driven by the `?foto={photoId}` URL param (design/MASTER.md section 32).
 * This host decides whether it is open and where it goes when the open Photo leaves the sequence.
 */
export function PhotoViewer({ trip, onTripChange, onTripGone }: PhotoViewerProps) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const fotoId = params.get(PARAM)
  const seq = useMemo(() => readyPhotos(trip.photos), [trip.photos])
  // The sequence before the latest change, to find the neighbour of a Photo that just left it.
  const [tracked, setTracked] = useState({ seq, before: seq })
  if (tracked.seq !== seq) setTracked({ seq, before: tracked.seq })
  const [live, setLive] = useState('')
  const pushed = (location.state as ViewerState | null)?.viewer === true

  const close = useCallback(() => {
    if (pushed) navigate(-1)
    else navigate({ search: '' }, { replace: true })
  }, [pushed, navigate])

  // The open Photo left the sequence (deleted, here or by the other Member): show its neighbour, else close.
  useEffect(() => {
    const before = tracked.before
    if (!fotoId || seq.some((p) => p.id === fotoId)) return
    const next = neighbourAfterRemoval(before, fotoId, seq)
    if (next) navigate({ search: `?${PARAM}=${next.id}` }, { replace: true, state: location.state })
    else close()
  }, [fotoId, seq, tracked.before, navigate, close, location.state])

  // While the open Photo has just left the sequence, its neighbour is shown in the same render, so the viewer never unmounts.
  const shownId = fotoId && !seq.some((p) => p.id === fotoId) ? (neighbourAfterRemoval(tracked.before, fotoId, seq)?.id ?? null) : fotoId
  const index = shownId ? seq.findIndex((p) => p.id === shownId) : -1
  if (index < 0) return null
  return (
    <ViewerBody
      trip={trip}
      seq={seq}
      index={index}
      live={live}
      onLive={setLive}
      onClose={close}
      onTripChange={onTripChange}
      onTripGone={onTripGone}
      onMove={(photo) => navigate({ search: `?${PARAM}=${photo.id}` }, { replace: true, state: location.state })}
    />
  )
}

/**
 * Opening: the stage fades in, the chrome follows 120ms later. Rendered inside the Radix content, and it finds
 * that content through its own marker, because the host's `root` ref is not set yet when this layout effect runs.
 */
function OpeningFade() {
  const marker = useRef<HTMLSpanElement>(null)
  useGSAP(() => {
    const content = marker.current?.closest<HTMLElement>('[data-viewer]')
    if (!content) return
    // Opacity only: `autoAlpha` would hide the Close button, which takes focus as the viewer opens.
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from(content.querySelectorAll('[data-stage]'), { opacity: 0, duration: 0.25, ease: 'power2.out' })
      gsap.from(content.querySelectorAll('[data-chrome]'), { opacity: 0, duration: 0.2, delay: 0.12, ease: 'power2.out' })
    })
    mm.add('(prefers-reduced-motion: reduce)', () => {
      gsap.from(content, { opacity: 0, duration: 0.15 })
    })
    return () => mm.revert()
  }, [])
  return <span ref={marker} hidden />
}

type Enter = 'flip' | 'slide' | 'fade'

const tileOf = (photoId: string) => document.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(photoId)}"]`)
/** The grid tile's box when it is on screen, else null. */
function visibleTileRect(photoId: string): DOMRect | null {
  const rect = tileOf(photoId)?.getBoundingClientRect()
  if (!rect || rect.width === 0) return null
  const onScreen = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
  return onScreen ? rect : null
}

interface ViewerBodyProps {
  trip: Trip
  seq: Photo[]
  index: number
  /** The screen-reader message; it lives in the host so a Photo change cannot lose it. */
  live: string
  onLive: (text: string) => void
  onClose: () => void
  onMove: (photo: Photo) => void
  onTripChange: PhotoViewerProps['onTripChange']
  onTripGone: () => void
}

function ViewerBody({ trip, seq, index, live, onLive, onClose, onMove, onTripChange, onTripGone }: ViewerBodyProps) {
  const photo = seq[index]
  const root = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const prevButton = useRef<HTMLButtonElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const lastShown = useRef(photo.id)
  const enter = useRef<Enter | null>(null)
  enter.current ??= visibleTileRect(photo.id) ? 'flip' : 'fade'
  const dir = useRef(1)
  const moving = useRef(false)
  const closing = useRef(false)
  const [editingFor, setEditingFor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const refocusAction = useRef(false)
  const deleted = useRef(false)
  const removal = useRef<(() => void) | null>(null)
  const { handleApiError } = useAuth()
  // Choosing the Cover photo belongs to a Photo id, not to the screen: moving on does not cancel it.
  const [coverSaving, setCoverSaving] = useState<string | null>(null)
  const [coverError, setCoverError] = useState<{ photoId: string; text: string } | null>(null)
  const [celebrateId, setCelebrateId] = useState<string | null>(null)
  const editing = editingFor === photo.id
  const locked = editing || deleting

  useEffect(() => {
    lastShown.current = photo.id
  }, [photo.id])
  const takeEnter = useCallback(() => {
    const mode = enter.current ?? 'slide'
    enter.current = 'slide'
    return mode
  }, [])
  const getDir = useCallback(() => dir.current, [])
  const prev = seq[index - 1]
  const next = seq[index + 1]

  // Neighbours' large versions load ahead of time.
  useEffect(() => {
    for (const p of [prev, next]) if (p?.largeUrl) new Image().src = p.largeUrl
  }, [prev, next])

  // A Photo is announced after a move, debounced so holding an arrow key does not queue speech.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = window.setTimeout(() => {
      onLive([...(deleted.current ? ['Foto borrada'] : []), 'Foto ' + (index + 1) + ' de ' + seq.length, photoDate(photo.takenAt), photo.caption].filter(Boolean).join('. '))
      deleted.current = false
    }, 300)
    return () => window.clearTimeout(t)
  }, [photo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // A button that disappears at an end while focused hands focus to the other one.
  useEffect(() => {
    const active = document.activeElement
    if (active && active !== document.body && active !== root.current && root.current?.contains(active)) return
    ;(nextButton.current ?? prevButton.current ?? closeButton.current)?.focus()
  }, [photo.id])

  useEffect(() => {
    if (!refocusAction.current || editing) return
    refocusAction.current = false
    root.current?.querySelector<HTMLElement>('[data-caption-action]')?.focus()
  }, [editing])

  const say = onLive
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 3000)
    return () => window.clearTimeout(t)
  }, [notice])

  useEffect(
    () => () => {
      gsap.killTweensOf([frame.current, root.current])
      removal.current?.()
    },
    [],
  )

  const move = useCallback(
    (delta: number, fromX = 0) => {
      const target = seq[index + delta]
      if (!target || moving.current || locked || saving) return
      moving.current = true
      dir.current = delta
      enter.current = 'slide'
      const go = () => {
        moving.current = false
        onMove(target)
      }
      if (prefersReducedMotion() || !frame.current) return go()
      gsap.fromTo(frame.current, { x: fromX }, { x: -delta * 40 + fromX, autoAlpha: 0, duration: 0.18, ease: 'power2.in', onComplete: go })
    },
    [seq, index, locked, saving, onMove],
  )

  const requestClose = useCallback(() => {
    if (closing.current) return
    closing.current = true
    const done = () => onClose()
    if (prefersReducedMotion() || !root.current) {
      if (root.current) gsap.to(root.current, { autoAlpha: 0, duration: 0.15, onComplete: done })
      else done()
      return
    }
    gsap.to('[data-chrome]', { autoAlpha: 0, duration: 0.12 })
    const tile = visibleTileRect(lastShown.current)
    const box = frame.current?.getBoundingClientRect()
    if (tile && box && frame.current) {
      const dx = tile.left + tile.width / 2 - (box.left + box.width / 2)
      const dy = tile.top + tile.height / 2 - (box.top + box.height / 2)
      gsap.to(frame.current, { x: `+=${dx}`, y: `+=${dy}`, scale: tile.width / box.width, duration: 0.3, ease: 'power2.inOut' })
      gsap.to('[data-stage]', { autoAlpha: 0, duration: 0.3, ease: 'power2.inOut', onComplete: done })
    } else {
      gsap.to(root.current, { autoAlpha: 0, duration: 0.2, onComplete: done })
    }
  }, [onClose])

  // Keyboard: arrows, Home and End move; Escape is Radix's (see onEscapeKeyDown).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (locked || saving || el?.closest('textarea, input, [role="alertdialog"]') || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === 'ArrowRight') move(1)
      else if (e.key === 'Home' && index > 0) {
        e.preventDefault()
        jump(0)
      } else if (e.key === 'End' && index < seq.length - 1) {
        e.preventDefault()
        jump(seq.length - 1)
      }
    }
    const jump = (to: number) => {
      enter.current = 'fade'
      onMove(seq[to])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locked, saving, move, index, seq, onMove])

  // Swipe: horizontal moves between Photos, down closes.
  const drag = useRef<{ x: number; y: number; t: number; axis: '' | 'x' | 'y'; dx: number; dy: number } | null>(null)
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' || locked || saving || !e.isPrimary) return
    // A press on a chevron is a tap, not a drag: capturing it would swallow the click.
    if (e.target instanceof Element && e.target.closest('button')) return
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), axis: '', dx: 0, dy: 0 }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* a synthetic pointer has nothing to capture */
    }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    d.dx = e.clientX - d.x
    d.dy = e.clientY - d.y
    if (!d.axis && Math.hypot(d.dx, d.dy) > 8) d.axis = Math.abs(d.dx) > Math.abs(d.dy) ? 'x' : 'y'
    if (prefersReducedMotion() || !frame.current) return
    if (d.axis === 'x') {
      const blocked = (d.dx > 0 && !prev) || (d.dx < 0 && !next)
      gsap.set(frame.current, { x: blocked ? d.dx * 0.3 : d.dx })
    } else if (d.axis === 'y' && d.dy > 0) {
      gsap.set(frame.current, { y: d.dy, scale: 1 - Math.min(d.dy / 800, 0.25) })
      gsap.set('[data-stage]', { opacity: 1 - Math.min(d.dy / 240, 1) * 0.6 })
    }
  }
  /** The browser took the gesture (or the pointer was lost): put the Photo back, never move or close. */
  const onPointerCancel = () => {
    if (!drag.current) return
    drag.current = null
    if (!frame.current || prefersReducedMotion()) return
    gsap.to(frame.current, { x: 0, y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.4)' })
    gsap.to('[data-stage]', { opacity: 1, duration: 0.2 })
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d || !frame.current) return
    const elapsed = Math.max(performance.now() - d.t, 1)
    const reduced = prefersReducedMotion()
    const width = frame.current.getBoundingClientRect().width || window.innerWidth
    if (d.axis === 'x') {
      const delta = d.dx < 0 ? 1 : -1
      const fast = Math.abs(d.dx) / elapsed > 0.5 && Math.abs(d.dx) > 24
      const far = reduced ? Math.abs(d.dx) > 50 : Math.abs(d.dx) > width * 0.25
      if ((far || fast) && seq[index + delta]) return move(delta, reduced ? 0 : d.dx)
      if (!reduced) gsap.to(frame.current, { x: 0, duration: 0.3, ease: 'back.out(1.4)' })
    } else if (d.axis === 'y' && d.dy > 0) {
      const fast = d.dy / elapsed > 0.5 && d.dy > 40
      if (d.dy > 120 || fast) return requestClose()
      if (!reduced) {
        gsap.to(frame.current, { y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.4)' })
        gsap.to('[data-stage]', { opacity: 1, duration: 0.2 })
      }
    }
  }

  const onGone = (what: 'photo' | 'trip') => {
    if (what === 'trip') return onTripGone()
    setNotice(PHOTO_GONE)
    say(PHOTO_GONE)
    setEditingFor(null)
    setDeleting(false)
    onTripChange((t) => removePhoto(t, photo.id))
  }

  const chooseCover = async () => {
    const id = photo.id
    if (coverSaving === id) return
    setCoverError(null)
    setCoverSaving(id)
    try {
      const updated = await setCoverPhoto(trip.id, id)
      setCoverSaving((s) => (s === id ? null : s))
      // The badge takes focus only if the Member is still looking at that Photo.
      if (lastShown.current === id && updated.coverPhoto?.id === id) setCelebrateId(id)
      onTripChange(() => updated)
      setNotice(COVER_NOTICE)
      say(COVER_LIVE)
    } catch (err) {
      setCoverSaving((s) => (s === id ? null : s))
      if (handleApiError(err)) return
      if (err instanceof ApiError && err.code === 'trip-not-found') return onTripGone()
      if (err instanceof ApiError && err.code === 'photo-not-found') {
        if (lastShown.current === id) onGone('photo')
        else onTripChange((t) => removePhoto(t, id))
        return
      }
      setCoverError({ photoId: id, text: coverErrorMessage(err) })
    }
  }

  const afterDelete = () => {
    setDeleting(false)
    const id = photo.id
    let done = false
    const finish = () => {
      if (done) return
      done = true
      removal.current = null
      deleted.current = true
      onTripChange((t) => removePhoto(t, id))
      say('Foto borrada')
    }
    if (prefersReducedMotion() || !frame.current) return finish()
    // If the viewer unmounts before the exit tween ends, the cleanup below still removes the Photo.
    removal.current = finish
    gsap.to(frame.current, { scale: 0.92, autoAlpha: 0, duration: 0.2, ease: 'power2.in', onComplete: finish })
  }

  const title = `Fotos de «${trip.title}»`
  const date = photoDate(photo.takenAt)
  const counter = `${index + 1} de ${seq.length}`

  return (
    <>
      <DialogPrimitive.Root open onOpenChange={(open) => !open && requestClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={root}
          aria-label={title}
          aria-describedby={undefined}
          data-viewer
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            closeButton.current?.focus()
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            const tile = tileOf(lastShown.current)
            if (tile) {
              tile.focus({ preventScroll: true })
              tile.scrollIntoView({ block: 'nearest' })
            } else document.getElementById('photos-title')?.focus()
          }}
          onEscapeKeyDown={(e) => {
            if (saving) return e.preventDefault()
            if (editing) {
              e.preventDefault()
              refocusAction.current = true
              setEditingFor(null)
            } else if (deleting) {
              // While the alert dialog is still mounting, Radix hands this Escape to the viewer first, and a
              // handled Escape is not passed on. Keep the viewer open and answer for the dialog (unless it is busy).
              e.preventDefault()
              if (!document.querySelector('[role="alertdialog"][data-busy]')) setDeleting(false)
            } else {
              e.preventDefault()
              requestClose()
            }
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="fixed inset-0 z-50 h-dvh text-white outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <OpeningFade />
          <div
            data-stage
            aria-hidden="true"
            className="absolute inset-0 bg-foreground/[0.96] bg-[radial-gradient(60%_40%_at_50%_100%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent)]"
          />
          <div className="relative flex h-full flex-col lg:flex-row">
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div
                data-chrome
                className="flex h-[calc(56px+env(safe-area-inset-top))] shrink-0 items-center justify-between px-3 pt-[env(safe-area-inset-top)] lg:hidden"
              >
                <span aria-hidden="true" className="pl-2 text-[15px] font-bold text-white/85">
                  {counter}
                </span>
              </div>
              <div
                data-photo-area
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                className="relative min-h-0 flex-1 touch-none select-none"
              >
                <div ref={frame} data-frame className="absolute inset-0 flex items-center justify-center px-3 py-2 lg:px-24 lg:py-12">
                  <PhotoStage key={photo.id} photo={photo} trip={trip} takeEnter={takeEnter} getDir={getDir} frame={frame} />
                </div>
                {prev && (
                  <Button
                    ref={prevButton}
                    data-chrome
                    type="button"
                    variant="ghost"
                    aria-label="Foto anterior"
                    onClick={() => move(-1)}
                    disabled={locked || saving}
                    className="absolute left-2 top-1/2 size-11 min-h-11 min-w-11 -translate-y-1/2 bg-foreground/55 p-0 text-white backdrop-blur hover:bg-foreground/70 lg:left-6 lg:size-14"
                  >
                    <ChevronLeft aria-hidden="true" className="size-6" />
                  </Button>
                )}
                {next && (
                  <Button
                    ref={nextButton}
                    data-chrome
                    type="button"
                    variant="ghost"
                    aria-label="Foto siguiente"
                    onClick={() => move(1)}
                    disabled={locked || saving}
                    className="absolute right-2 top-1/2 size-11 min-h-11 min-w-11 -translate-y-1/2 bg-foreground/55 p-0 text-white backdrop-blur hover:bg-foreground/70 lg:right-6 lg:size-14"
                  >
                    <ChevronRight aria-hidden="true" className="size-6" />
                  </Button>
                )}
              </div>
            </div>

            <div className="relative shrink-0 max-lg:mx-auto max-lg:w-full max-lg:max-w-[640px] lg:flex lg:w-[360px]">
              <NoticePill text={notice} />
            <div
              data-chrome
              className="relative max-h-[50dvh] shrink-0 overflow-y-auto px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-4 max-lg:w-full lg:max-h-none lg:w-full lg:border-l lg:border-white/10 lg:bg-white/[0.06] lg:p-8"
            >
              <p aria-hidden="true" className="mb-4 hidden text-[15px] font-bold text-white/85 lg:block">
                {counter}
              </p>
              {editing ? (
                <CaptionEditor
                  key={photo.id}
                  tripId={trip.id}
                  photo={photo}
                  onBusy={setSaving}
                  onCancel={() => {
                    refocusAction.current = true
                    setEditingFor(null)
                  }}
                  onGone={onGone}
                  onSaved={(saved) => {
                    refocusAction.current = true
                    setEditingFor(null)
                    onTripChange((t) => replacePhoto(t, saved))
                    say(saved.caption ? 'Frase guardada' : 'Frase quitada')
                  }}
                />
              ) : (
                <PhotoInfo
                  photo={photo}
                  date={date}
                  cover={trip.coverPhoto}
                  coverSaving={coverSaving === photo.id}
                  coverError={coverError?.photoId === photo.id ? coverError.text : undefined}
                  onChooseCover={chooseCover}
                  celebrate={celebrateId === photo.id}
                  onCelebrated={() => setCelebrateId(null)}
                  onEdit={() => setEditingFor(photo.id)}
                  onDelete={() => setDeleting(true)}
                />
              )}
            </div>
            </div>

            <DialogPrimitive.Close asChild>
              <Button
                ref={closeButton}
                data-chrome
                type="button"
                variant="ghost"
                aria-label="Cerrar"
                className="absolute right-3 top-[calc(6px+env(safe-area-inset-top))] size-11 min-h-11 min-w-11 bg-white/12 p-0 text-white hover:bg-white/20 lg:right-6 lg:top-6 lg:size-12"
                onClick={(e) => {
                  e.preventDefault()
                  requestClose()
                }}
              >
                <X aria-hidden="true" className="size-6" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <p aria-live="polite" className="sr-only">
            {live}
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <DeletePhotoDialog
        tripId={trip.id}
        photo={photo}
        mode="viewer"
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={afterDelete}
        onTripGone={onTripGone}
      />
    </>
  )
}

interface PhotoInfoProps {
  photo: Photo
  date?: string
  cover: Trip['coverPhoto']
  coverSaving: boolean
  coverError?: string
  onChooseCover: () => void
  celebrate: boolean
  onCelebrated: () => void
  onEdit: () => void
  onDelete: () => void
}

function PhotoInfo({ photo, date, cover, coverSaving, coverError, onChooseCover, celebrate, onCelebrated, onEdit, onDelete }: PhotoInfoProps) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const text = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const el = text.current
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [photo.caption, expanded])

  return (
    <div className="flex flex-col gap-3">
      {photo.caption ? (
        <div>
          <p ref={text} data-caption className={cn('whitespace-pre-line break-words text-[17px] leading-normal', !expanded && 'line-clamp-3 lg:line-clamp-none')}>
            {photo.caption}
          </p>
          {(clamped || expanded) && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="min-h-11 text-sm font-bold text-white/85 underline lg:hidden"
            >
              {expanded ? 'Ver menos' : 'Ver más'}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          data-caption-action
          onClick={onEdit}
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border-[1.5px] border-dashed border-white/40 px-4 text-[15px] font-bold text-white/85 hover:bg-white/10"
        >
          <PenLine aria-hidden="true" className="size-[18px]" />
          Añadir una frase
        </button>
      )}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/75">
        {date && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarHeart aria-hidden="true" className="size-4" />
            {date}
          </span>
        )}
        {date && photo.uploadedBy && <span aria-hidden="true">·</span>}
        {photo.uploadedBy && (
          <span className="inline-flex items-center gap-1.5">
            <UserRound aria-hidden="true" className="size-4" />
            Subida por {photo.uploadedBy}
          </span>
        )}
      </p>
      <CoverControl photo={photo} cover={cover} saving={coverSaving} error={coverError} onChoose={onChooseCover} celebrate={celebrate} onCelebrated={onCelebrated} />
      <div className="mt-1 flex flex-wrap gap-3">
        {photo.caption && (
          <button
            type="button"
            data-caption-action
            onClick={onEdit}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/12 px-5 text-[15px] font-bold hover:bg-white/20"
          >
            <Pencil aria-hidden="true" className="size-4" />
            Editar frase
          </button>
        )}
        <button
          type="button"
          data-delete-action
          onClick={onDelete}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/12 px-5 text-[15px] font-bold hover:bg-white/20"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Borrar
        </button>
      </div>
    </div>
  )
}

interface PhotoStageProps {
  photo: Photo
  trip: Trip
  takeEnter: () => Enter
  getDir: () => number
  frame: React.RefObject<HTMLDivElement | null>
}

/** One Photo's picture: the blurred thumbnail first, the large version fading over it, or the error placeholder. */
function PhotoStage({ photo, trip, takeEnter, getDir, frame }: PhotoStageProps) {
  const [tries, setTries] = useState(0)
  const media = useMediaSession()

  // Entrance: FLIP from the tile, a slide from the side moved from, or a plain fade.
  useGSAP(
    () => {
      const el = frame.current
      if (!el) return
      const mode = takeEnter()
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        if (mode === 'flip') {
          const tile = visibleTileRect(photo.id)
          const box = el.getBoundingClientRect()
          if (tile && box.width) {
            const dx = tile.left + tile.width / 2 - (box.left + box.width / 2)
            const dy = tile.top + tile.height / 2 - (box.top + box.height / 2)
            gsap.fromTo(el, { x: dx, y: dy, scale: tile.width / box.width, autoAlpha: 1 }, { x: 0, y: 0, scale: 1, duration: 0.38, ease: 'power3.out', clearProps: 'transform' })
            return
          }
        }
        if (mode === 'slide') gsap.fromTo(el, { x: getDir() * 40, y: 0, scale: 1, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.26, ease: 'power2.out' })
        else gsap.fromTo(el, { scale: 0.96, x: 0, y: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'power2.out' })
      })
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.fromTo(el, { x: 0, y: 0, scale: 1, autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12 })
      })
      return () => mm.revert()
    },
    { dependencies: [] },
  )

  const label = photoLabel(photo, `Foto de ${trip.title}`)
  return (
    <LargePicture
      key={tries}
      photo={photo}
      label={label}
      mediaReady={media.status === 'ready'}
      onRetry={() => {
        media.retry()
        setTries((n) => n + 1)
      }}
    />
  )
}

function LargePicture({ photo, label, mediaReady, onRetry }: { photo: Photo; label: string; mediaReady: boolean; onRetry: () => void }) {
  const img = useMediaImage()
  const slow = useAfter(200)
  const failed = img.failed || !photo.largeUrl
  if (failed) {
    return (
      <div className={cn('relative grid aspect-[4/3] w-full max-w-[560px] place-items-center rounded-photo bg-muted p-6', coverGradient(photo.id))}>
        <div className="flex flex-col items-center gap-3 text-center">
          <ImageOff aria-hidden="true" className="size-8 text-secondary-foreground" strokeWidth={1.75} />
          <p className="rounded-full bg-card/85 px-4 py-2 text-base font-bold text-secondary-foreground">{MEDIA_FAILED}</p>
          <Button type="button" variant="soft" className="min-h-11 bg-card px-6" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="relative size-full">
      {photo.thumbnailUrl && mediaReady && (
        <img
          src={photo.thumbnailUrl}
          alt=""
          aria-hidden="true"
          className={cn('absolute inset-0 size-full rounded-xl object-contain blur-[12px] transition-opacity duration-200', img.loaded && 'opacity-0')}
        />
      )}
      {!img.loaded && slow && (
        <span aria-hidden="true" className="absolute inset-0 m-auto size-8 animate-spin rounded-full border-[3px] border-white/20 border-t-white motion-reduce:animate-none" />
      )}
      {mediaReady && (
        <img
          key={img.attempt}
          src={photo.largeUrl}
          alt={label}
          data-large
          decoding="async"
          draggable={false}
          onLoad={img.onLoad}
          onError={img.onError}
          className={cn('absolute inset-0 size-full rounded-xl object-contain transition-opacity duration-200 motion-reduce:transition-none', img.loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  )
}

/**
 * The short visual "¡Nueva portada!" pill. It floats above the info panel (over the stage on desktop), so it never
 * moves the panel's content, and is hidden from assistive tech: the viewer's live region says it once. It fades and
 * rises in, and fades out before leaving the DOM (fade only under reduced motion).
 */
function NoticePill({ text }: { text: string | null }) {
  const pill = useRef<HTMLParagraphElement>(null)
  const [shown, setShown] = useState(text)
  if (text && text !== shown) setShown(text)
  useGSAP(
    () => {
      const el = pill.current
      if (text) {
        if (!el) return
        const rise = prefersReducedMotion() ? 0 : 8
        gsap.fromTo(el, { autoAlpha: 0, y: rise }, { autoAlpha: 1, y: 0, duration: 0.2, ease: 'power2.out', overwrite: true })
      } else if (el) {
        const rise = prefersReducedMotion() ? 0 : 8
        gsap.to(el, { autoAlpha: 0, y: rise, duration: 0.2, ease: 'power2.in', overwrite: true, onComplete: () => setShown(null) })
      }
    },
    { dependencies: [text] },
  )
  if (!shown) return null
  return (
    <p
      ref={pill}
      aria-hidden="true"
      data-cover-notice
      className="pointer-events-none absolute bottom-full left-5 right-5 z-10 mb-3 rounded-2xl bg-card px-4 py-2 text-sm font-bold text-card-foreground shadow-lg lg:bottom-6 lg:left-auto lg:right-full lg:mb-0 lg:mr-4 lg:w-max lg:max-w-[min(320px,calc(100vw-420px))]"
    >
      {shown}
    </p>
  )
}
