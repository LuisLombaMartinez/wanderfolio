import { useRef, useState } from 'react'
import { AlertCircle, Frame, Heart, Loader } from 'lucide-react'
import type { CoverPhoto, Photo } from '@/lib/api'
import { gsap, useGSAP } from '@/lib/gsap'

interface CoverControlProps {
  photo: Photo
  cover: CoverPhoto | null
  /** The choice for this very Photo is in flight. */
  saving: boolean
  /** Inline error for this Photo, already in Spanish. */
  error?: string
  onChoose: () => void
  /** True when the badge appears because the Member just chose this Photo; only read when the badge mounts. */
  celebrate: boolean
  /** Called once the badge has celebrated, so the choice is not celebrated again on a later remount. */
  onCelebrated: () => void
}

const ACTION =
  'inline-flex min-h-11 items-center gap-2 rounded-full bg-white/12 px-5 text-[15px] font-bold hover:bg-white/20 aria-disabled:cursor-default aria-disabled:opacity-80 aria-disabled:hover:bg-white/12'

/** The "Usar como portada" control of the viewer's Photo info (design/MASTER.md section 38). */
export function CoverControl({ photo, cover, saving, error, onChoose, celebrate, onCelebrated }: CoverControlProps) {
  const isCover = cover?.id === photo.id
  const chosen = isCover && cover.chosen
  return (
    <div data-cover-control className="flex flex-col items-start gap-2">
      {chosen ? (
        <CoverBadge celebrate={celebrate} onCelebrated={onCelebrated} />
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {isCover && (
            <p className="inline-flex items-center gap-1.5 text-sm text-white/75">
              <Frame aria-hidden="true" className="size-4" />
              Portada por ser la primera
            </p>
          )}
          <button
            type="button"
            data-cover-action
            aria-disabled={saving || undefined}
            onClick={() => !saving && onChoose()}
            className={ACTION}
          >
            {saving ? (
              <>
                <span aria-hidden="true" className="size-4 animate-spin rounded-full border-[3px] border-white/25 border-t-white motion-reduce:hidden" />
                <Loader aria-hidden="true" className="hidden size-4 motion-reduce:block" />
                Poniéndola de portada…
              </>
            ) : (
              <>
                <Frame aria-hidden="true" className="size-[18px]" />
                Usar como portada
              </>
            )}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-flex items-start gap-2 rounded-2xl bg-card/90 px-4 py-2 text-sm font-bold text-secondary-foreground">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          {error}
        </p>
      )}
    </div>
  )
}

/** The pink "Nuestra portada" chip. Right after a choice it takes focus and lands with a pop and one heartbeat. */
function CoverBadge({ celebrate: wanted, onCelebrated }: { celebrate: boolean; onCelebrated: () => void }) {
  const badge = useRef<HTMLParagraphElement>(null)
  const [celebrate] = useState(wanted)
  useGSAP(
    () => {
      if (!celebrate) return
      onCelebrated()
      badge.current?.focus({ preventScroll: true })
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(badge.current, { opacity: 0, scale: 0.8, duration: 0.32, ease: 'back.out(2)' })
        gsap.fromTo('[data-cover-heart]', { scale: 1 }, { scale: 1.25, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.inOut', delay: 0.2 })
      })
      return () => mm.revert()
    },
    { scope: badge, dependencies: [] },
  )
  return (
    <p
      ref={badge}
      tabIndex={-1}
      data-cover-badge
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      <Heart data-cover-heart aria-hidden="true" className="size-4 fill-current" />
      Nuestra portada
    </p>
  )
}
