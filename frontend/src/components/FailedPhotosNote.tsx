import { useRef } from 'react'
import { ImageOff } from 'lucide-react'
import { SpinIcon } from '@/components/SpinIcon'
import { Button } from '@/components/ui/button'
import { gsap, useGSAP } from '@/lib/gsap'
import { retryAllNote } from '@/lib/messages'

interface FailedPhotosNoteProps {
  /** How many Photos are `failed` right now. */
  count: number
  /** "Reintentar todas" is running. */
  busy: boolean
  /** Photos the last "Reintentar todas" could not retry (still failed). */
  leftOver: number
  onRetryAll: () => void
}

/** A standing summary of failed Photos with a way to retry them all (MASTER section 42). */
export function FailedPhotosNote({ count, busy, leftOver, onRetryAll }: FailedPhotosNoteProps) {
  const root = useRef<HTMLDivElement>(null)
  const shown = count > 0
  useGSAP(
    () => {
      if (!shown) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(root.current, { autoAlpha: 0, y: 4, duration: 0.15, ease: 'power2.out' })
      })
      return () => mm.revert()
    },
    { dependencies: [shown] },
  )
  if (!shown) return null
  return (
    <div
      ref={root}
      role="status"
      data-failed-note
      className="flex flex-col gap-3 rounded-2xl bg-secondary p-4 text-secondary-foreground min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between"
    >
      <div className="flex items-start gap-3">
        <ImageOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} />
        <div>
          <p className="text-base font-bold">{count === 1 ? '1 foto no se ha podido revelar' : `${count} fotos no se han podido revelar`}</p>
          <p className="text-sm text-muted-foreground">
            {leftOver > 0 && !busy ? retryAllNote(leftOver) : count === 1 ? 'Tócala para ver qué ha pasado.' : 'Toca una para ver qué ha pasado.'}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="soft"
        className="min-h-11 bg-card px-5 aria-disabled:pointer-events-none aria-disabled:opacity-50"
        data-retry-all
        aria-disabled={busy}
        onClick={() => !busy && onRetryAll()}
      >
        <SpinIcon spinning={busy} />
        {busy ? 'Reintentando…' : count === 1 ? 'Reintentar' : 'Reintentar todas'}
      </Button>
    </div>
  )
}
