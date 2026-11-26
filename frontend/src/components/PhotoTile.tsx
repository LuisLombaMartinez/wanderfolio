import { memo, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { Frame, Heart, ImageOff, RotateCcw, Sparkles } from 'lucide-react'
import { coverGradient } from '@/lib/cover'
import { photoDate, photoLabel } from '@/lib/photos'
import { gsap, prefersReducedMotion, useGSAP } from '@/lib/gsap'
import type { Photo } from '@/lib/api'
import type { Tile } from '@/lib/tiles'
import { displayFilename } from '@/lib/messages'
import { useMediaImage } from '@/lib/useMediaImage'
import { useMediaSession } from '@/lib/useMediaSession'
import { cn } from '@/lib/utils'

const SLOW_REVEAL_MS = 2 * 60 * 1000
const RING_RADIUS = 20.5
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

interface PhotoTileProps {
  tile: Tile
  /** Position among the tiles that enter with a fresh pick (capped by the caller). */
  enterIndex?: number
  /** The first tiles load eagerly, the rest lazily. */
  eager?: boolean
  /** Place among the tiles flipping back to revealing in one "Reintentar todas" (staggers the icon swap). */
  retryIndex?: number
  onRetry: (localId: string) => void
  /** Opens the failed-Photo dialog for a Photo that could not be developed (MASTER section 42). */
  onOpenFailed: (photoId: string) => void
  /** Opens the viewer on a ready Photo. */
  onOpen: (photoId: string) => void
  /** Set on the one ready tile that is the Trip's Cover photo: chosen by a Member, or the default first one. */
  cover?: 'default' | 'chosen'
}


/** One square in the Photos grid; the same element goes from queued to uploading to revealing to ready. */
export const PhotoTile = memo(function PhotoTile({ tile, enterIndex, eager, retryIndex, onRetry, onOpenFailed, onOpen, cover }: PhotoTileProps) {
  const root = useRef<HTMLLIElement>(null)
  const kind = tile.state.kind

  // A fresh pick enters with a soft pop; the upload-failed tile shakes once.
  useGSAP(
    () => {
      if (enterIndex === undefined) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(root.current, { autoAlpha: 0, scale: 0.96, duration: 0.25, delay: enterIndex * 0.03, ease: 'power2.out' })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [] },
  )
  useGSAP(
    () => {
      if (kind !== 'upload-failed') return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(root.current, { x: -4 }, { x: 0, duration: 0.3, ease: 'elastic.out(1, 0.3)' })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [kind] },
  )

  // revealing -> failed during the session: the icon swaps and the tile shakes once; failed -> revealing: the icon swaps.
  const previous = useRef<string | undefined>(undefined)
  useGSAP(
    () => {
      const before = previous.current
      previous.current = kind
      const failedNow = before === 'revealing' && kind === 'failed'
      const retriedNow = before === 'failed' && kind === 'revealing'
      if (!failedNow && !retriedNow) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-icon]', { autoAlpha: 0, duration: 0.2, delay: retriedNow ? (retryIndex ?? 0) * 0.03 : 0, ease: 'power2.out' })
        // Two cycles in 300ms that end at rest: the tile must not stay shifted.
        if (failedNow) {
          gsap.to(root.current, {
            keyframes: { x: [-4, 4, -4, 4, 0], easeEach: 'power1.inOut' },
            duration: 0.3,
            onComplete: () => void gsap.set(root.current, { clearProps: 'x' }),
          })
        }
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [kind] },
  )

  return (
    <li
      ref={root}
      data-tile
      data-tile-key={tile.key}
      data-tile-photo-id={tile.photoId}
      data-state={kind}
      className={cn('relative aspect-square overflow-hidden rounded-[14px] bg-muted', coverGradient(tile.gradientId))}
    >
      {tile.state.kind === 'ready' ? (
        <ReadyTile tile={tile} photo={tile.state.photo} eager={eager} onOpen={onOpen} cover={cover} />
      ) : tile.state.kind === 'upload-failed' ? (
        <button
          type="button"
          aria-label={`Reintentar subir ${tile.filename}`}
          onClick={() => tile.localId && onRetry(tile.localId)}
          className="absolute inset-0 size-full focus-visible:outline-offset-[-4px]"
        >
          <Overlay icon={<RotateCcw className="size-5 text-primary" strokeWidth={2} />} label="No ha llegado" />
        </button>
      ) : tile.state.kind === 'failed' ? (
        <button
          type="button"
          data-photo-id={tile.state.photo.id}
          aria-label={`Sin revelar: «${displayFilename(tile.filename)}». Ver opciones`}
          onClick={() => onOpenFailed(tile.state.kind === 'failed' ? tile.state.photo.id : tile.key)}
          className="group absolute inset-0 size-full transition-transform duration-100 active:scale-[0.97] focus-visible:outline-offset-[-4px] motion-reduce:transition-none"
        >
          <Overlay icon={<ImageOff className="size-5 text-secondary-foreground" strokeWidth={1.75} />} label="Sin revelar" hoverable />
        </button>
      ) : tile.state.kind === 'revealing' ? (
        <RevealingOverlay filename={tile.filename} />
      ) : (
        <Overlay
          icon={<Ring progress={tile.state.kind === 'uploading' ? tile.state.progress : 0} filename={tile.filename} active={tile.state.kind === 'uploading'} />}
          label={tile.state.kind === 'uploading' ? 'Subiendo…' : 'En cola'}
        />
      )}
    </li>
  )
})

/** The centred 44px circle and the label pill shared by every non-ready state. */
function Overlay({ icon, label, hoverable }: { icon: ReactNode; label: string; hoverable?: boolean }) {
  return (
    <>
      <span className="absolute inset-0 grid place-items-center">
        <span
          data-icon
          className={cn('grid size-11 place-items-center rounded-full bg-white/60', hoverable && 'transition-colors duration-200 [@media(hover:hover)]:group-hover:bg-white/80')}
        >
          {icon}
        </span>
      </span>
      <span className="absolute inset-x-[11px] bottom-[11px] truncate rounded-full bg-card/85 px-2 py-1 text-center text-xs font-bold text-secondary-foreground">
        {label}
      </span>
    </>
  )
}

function RevealingOverlay({ filename }: { filename: string }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_REVEAL_MS)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div
      className="reveal-sweep absolute inset-0 outline-none"
      data-revealing
      tabIndex={-1}
      role="group"
      aria-label={`Revelando «${filename}»`}
    >
      <Overlay icon={<Sparkles aria-hidden="true" className="size-5 text-primary" strokeWidth={1.75} />} label={slow ? 'Tarda un poquito…' : 'Revelando…'} />
    </div>
  )
}

function Ring({ progress, filename, active }: { progress: number; filename: string; active: boolean }) {
  const arc = useRef<SVGCircleElement>(null)
  useGSAP(
    () => {
      const offset = RING_LENGTH * (1 - progress)
      if (prefersReducedMotion()) gsap.set(arc.current, { strokeDashoffset: offset })
      else gsap.to(arc.current, { strokeDashoffset: offset, duration: 0.2, ease: 'none' })
    },
    { dependencies: [progress] },
  )
  const pct = Math.round(progress * 100)
  return (
    <span
      {...(active
        ? { role: 'progressbar', 'aria-label': `Subiendo ${filename}`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }
        : { 'aria-label': `${filename}: en cola`, role: 'img' })}
      className="relative grid size-11 place-items-center"
    >
      <svg viewBox="0 0 44 44" className="absolute inset-0 size-full -rotate-90" fill="none" aria-hidden="true">
        <circle cx="22" cy="22" r={RING_RADIUS} stroke="var(--secondary)" strokeWidth="3" />
        <circle
          ref={arc}
          cx="22"
          cy="22"
          r={RING_RADIUS}
          stroke="var(--primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH}
        />
      </svg>
      {active && <span aria-hidden="true" className="text-xs font-bold text-secondary-foreground">{pct}</span>}
    </span>
  )
}

function ReadyTile({ tile, photo, eager, onOpen, cover }: { tile: Tile; photo: Photo; eager?: boolean; onOpen: (photoId: string) => void; cover?: 'default' | 'chosen' }) {
  const { status } = useMediaSession()
  const img = useMediaImage()
  const src = photo.thumbnailUrl
  const failed = img.failed || status === 'failed' || !src

  // The "developed" settle: the image fades in while easing from 1.04 to 1.
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    img.onLoad()
    if (!prefersReducedMotion()) {
      gsap.fromTo(e.currentTarget, { autoAlpha: 0, scale: 1.04 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'power2.out' })
    }
  }

  return (
    <button
      type="button"
      data-photo-id={photo.id}
      aria-label={
        (photo.caption ? [...photo.caption].slice(0, 120).join('') : photo.takenAt ? `Abrir la foto del ${photoDate(photo.takenAt)}` : 'Abrir foto') +
        (cover ? ', portada del viaje' : '')
      }
      onClick={() => onOpen(photo.id)}
      className="group absolute inset-0 size-full cursor-pointer overflow-hidden focus-visible:outline-offset-[-4px]"
    >
      {cover && <CoverMarker kind={cover} />}
      {!img.loaded && !failed && <RevealingOverlay filename={tile.filename} />}
      {failed && <Overlay icon={<ImageOff className="size-5 text-secondary-foreground" strokeWidth={1.75} />} label="No se ha podido cargar" />}
      {!failed && status === 'ready' && (
        <img
          key={img.attempt}
          src={src}
          alt={photoLabel(photo)}
          width={400}
          height={400}
          decoding="async"
          loading={eager ? 'eager' : 'lazy'}
          onLoad={onLoad}
          onError={img.onError}
          className={cn('absolute inset-0 size-full object-cover [@media(hover:hover)]:motion-safe:transition-transform [@media(hover:hover)]:motion-safe:duration-200 [@media(hover:hover)]:motion-safe:group-hover:scale-[1.03]', img.loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </button>
  )
}

/** The small circle top-left of the Cover photo's tile; it pops in when it lands on a tile (MASTER section 38). */
function CoverMarker({ kind }: { kind: 'default' | 'chosen' }) {
  const marker = useRef<HTMLSpanElement>(null)
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(marker.current, { scale: 0.6, opacity: 0, duration: 0.2, ease: 'power2.out' })
      })
      return () => mm.revert()
    },
    { scope: marker, dependencies: [] },
  )
  const Icon = kind === 'chosen' ? Heart : Frame
  return (
    <span
      ref={marker}
      data-cover-marker={kind}
      aria-hidden="true"
      className="absolute left-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-full bg-white/85"
    >
      <Icon className={cn('size-3.5 text-primary', kind === 'chosen' && 'fill-current')} />
    </span>
  )
}
