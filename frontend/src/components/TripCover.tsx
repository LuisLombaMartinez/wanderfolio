import { useCallback, useEffect, useState } from 'react'
import { Images } from 'lucide-react'
import type { CoverPhoto } from '@/lib/api'
import { CoverPlaceholder } from '@/components/CoverPlaceholder'
import { coverGradient } from '@/lib/cover'
import { useMediaSession } from '@/lib/useMediaSession'
import { useMediaImage } from '@/lib/useMediaImage'
import { prefersReducedMotion } from '@/lib/gsap'
import { cn } from '@/lib/utils'

interface TripCoverProps {
  tripId: string
  upcoming: boolean
  /** The Trip's Cover photo (computed by the API); without one the Cover placeholder shows. */
  cover: CoverPhoto | null
  /** Cards show the thumbnail, the page the large version. */
  size?: 'card' | 'page'
  /** Cards show a "{n} fotos" chip over the image. */
  photoCount?: number
  /** Cards after the first row load their image lazily. */
  lazy?: boolean
  className?: string
}

interface Layer {
  id: string
  src: string
  /** Its image has loaded, so it can stand in while a newer one loads. */
  loaded: boolean
}

/** Longer than the 400 ms fade, for when `transitionend` never fires (hidden tab, interrupted transition). */
const FADE_FALLBACK_MS = 450

/**
 * The Cover area of the Trip card and the Trip page (MASTER sections 27 and 39). When the Cover photo changes, the old
 * image stays until the new one has loaded and finished fading in over it, then the old one is removed. An image that
 * cannot load keeps the previous one on screen, or, with none, shows the placeholder with the load-failure label.
 */
export function TripCover({ tripId, upcoming, cover, size = 'card', photoCount = 0, lazy, className }: TripCoverProps) {
  const src = cover ? (size === 'page' ? cover.largeUrl : cover.thumbnailUrl) : undefined
  const [layers, setLayers] = useState<Layer[]>(cover && src ? [{ id: cover.id, src, loaded: false }] : [])
  // The id of the Cover photo whose image could not be loaded; forgotten once the Cover photo changes.
  const [failedId, setFailedId] = useState<string | null>(null)

  // Derived during render: a new Cover photo goes on top of the one shown; none at all clears the area.
  if (failedId && failedId !== cover?.id) setFailedId(null)
  if (!cover || !src) {
    if (layers.length) setLayers([])
  } else if (failedId !== cover.id && layers[layers.length - 1]?.id !== cover.id) {
    // Keep the last layer that has *loaded* under the new one (not a newer one still loading, which is blank).
    const lastLoaded = layers.filter((l) => l.loaded).slice(-1)
    setLayers([...lastLoaded, { id: cover.id, src, loaded: false }])
  }

  const settle = useCallback((id: string) => setLayers((all) => (all[all.length - 1]?.id === id ? all.slice(-1) : all)), [])
  const markLoaded = useCallback((id: string) => setLayers((all) => all.map((l) => (l.id === id && !l.loaded ? { ...l, loaded: true } : l))), [])
  const fail = useCallback((id: string) => {
    setFailedId(id)
    setLayers((all) => all.filter((l) => l.id !== id))
  }, [])

  if (!cover || !src || layers.length === 0) {
    return (
      <CoverPlaceholder
        tripId={tripId}
        upcoming={upcoming}
        size={size}
        className={className}
        {...(cover && failedId === cover.id ? { label: 'No hemos podido cargar la portada', shortLabel: 'Sin portada' } : {})}
      />
    )
  }
  return (
    <div
      data-testid="trip-cover"
      className={cn('relative aspect-[4/3] w-full overflow-hidden', coverGradient(tripId), className)}
    >
      {layers.map((layer, i) => (
        <CoverImage key={layer.id} id={layer.id} top={i === layers.length - 1} src={layer.src} lazy={lazy} onLoaded={markLoaded} onSettled={settle} onFailed={fail} />
      ))}
      {size === 'card' && photoCount > 0 && (
        <span className="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-card/85 px-3 py-1 text-[13px] font-bold text-secondary-foreground backdrop-blur-sm">
          <Images aria-hidden="true" className="size-3.5" />
          {photoCount === 1 ? '1 foto' : `${photoCount} fotos`}
        </span>
      )}
    </div>
  )
}

interface CoverImageProps {
  id: string
  src: string
  /** The newest layer: the one that has to finish fading in before older ones go. */
  top: boolean
  lazy?: boolean
  /** The image has loaded. */
  onLoaded: (id: string) => void
  /** The image has loaded and its fade has ended (at once under reduced motion), so older layers can go. */
  onSettled: (id: string) => void
  /** The image gave up loading for good. */
  onFailed: (id: string) => void
}

/** One image of the Cover area. */
function CoverImage({ id, src, top, lazy, onLoaded, onSettled, onFailed }: CoverImageProps) {
  const { status } = useMediaSession()
  const img = useMediaImage()
  const showImage = status === 'ready' && !img.failed
  const { failed, loaded } = img
  useEffect(() => {
    if (loaded) onLoaded(id)
  }, [loaded, id, onLoaded])
  useEffect(() => {
    if (failed) onFailed(id)
  }, [failed, id, onFailed])
  // Fallback for a `transitionend` that never comes. `top` is a dependency because a Cover photo that comes back
  // (A, B, A) reuses its loaded layer: no new load or transition happens, but it is on top again.
  useEffect(() => {
    if (!loaded || !top) return
    const t = window.setTimeout(() => onSettled(id), FADE_FALLBACK_MS)
    return () => window.clearTimeout(t)
  }, [loaded, top, id, onSettled])
  if (!showImage) return null
  return (
    <img
      key={img.attempt}
      data-cover-img
      src={src}
      alt=""
      decoding="async"
      loading={lazy ? 'lazy' : undefined}
      onLoad={() => {
        img.onLoad()
        if (prefersReducedMotion()) onSettled(id)
      }}
      onError={img.onError}
      onTransitionEnd={(e) => e.propertyName === 'opacity' && onSettled(id)}
      className={cn(
        'absolute inset-0 size-full object-cover transition-opacity duration-[400ms] ease-out motion-reduce:transition-none',
        loaded ? 'opacity-100' : 'opacity-0',
      )}
    />
  )
}
