import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { gsap, useGSAP } from '@/lib/gsap'
import { barModel, dismissBar, getUploadState } from '@/lib/upload-store'
import { useUploads } from '@/lib/useUploads'

const DONE_VISIBLE_MS = 6000

/** Answers "is it safe to close the app?": follows the Member across screens while files are sent. */
export function UploadBar() {
  const { pathname } = useLocation()
  const uploads = useUploads()
  const bar = barModel(uploads)
  const root = useRef<HTMLDivElement>(null)
  const check = useRef<SVGSVGElement>(null)
  const phase = bar?.phase

  // The "all sent" message goes by itself after a few seconds.
  useEffect(() => {
    if (phase !== 'done') return
    const t = window.setTimeout(() => {
      if (barModel(getUploadState())?.phase === 'done') dismissBar()
    }, DONE_VISIBLE_MS)
    return () => window.clearTimeout(t)
  }, [phase])

  const visible = bar !== null
  useGSAP(
    () => {
      if (!visible) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(root.current, { yPercent: 100, autoAlpha: 0, duration: 0.3, ease: 'power2.out' })
      })
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.from(root.current, { autoAlpha: 0, duration: 0.1 })
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [visible] },
  )
  useGSAP(
    () => {
      if (phase !== 'done' || !check.current) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(check.current, { scale: 0.6, duration: 0.35, ease: 'back.out(2)' })
      })
      return () => mm.revert()
    },
    { dependencies: [phase] },
  )

  if (!bar) return null
  const announcement =
    bar.phase === 'sending'
      ? bar.total === 1
        ? 'Subiendo 1 foto'
        : `Subiendo ${bar.total} fotos`
      : bar.phase === 'done'
        ? bar.total === 1
          ? '¡Foto a salvo!'
          : `¡${bar.total} fotos a salvo!`
        : `Han llegado ${bar.sent} de ${bar.total}`
  const away = pathname !== `/trips/${bar.tripId}`
  const pct = Math.round(bar.progress * 100)
  return (
    <div
      ref={root}
      data-upload-bar
      className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 rounded-[20px] bg-card p-4 shadow-pink lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[380px]"
    >
      {/* Announced on phase changes only (start, done, partial), never on every bit of progress. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex items-start gap-3">
        {bar.phase === 'done' && <CheckCircle2 ref={check} aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ocean" />}
        {bar.phase === 'partial' && <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />}
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">
            {bar.phase === 'sending' &&
              (bar.total === 1 ? 'Subiendo 1 foto' : `Subiendo ${bar.sent} de ${bar.total} fotos`)}
            {bar.phase === 'done' && (bar.total === 1 ? '¡Foto a salvo!' : `¡${bar.total} fotos a salvo!`)}
            {bar.phase === 'partial' && `Han llegado ${bar.sent} de ${bar.total}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {bar.phase === 'sending' &&
              (away ? (
                <Link to={`/trips/${bar.tripId}`} className="font-semibold text-primary underline underline-offset-2">
                  Ver «{bar.tripTitle}»
                </Link>
              ) : (
                'No cierres la app hasta que terminen'
              ))}
            {bar.phase === 'done' && 'Ya puedes cerrar la app. Las terminamos de revelar nosotros.'}
            {bar.phase === 'partial' && 'Toca las que faltan para reintentarlo.'}
          </p>
        </div>
        {bar.phase !== 'sending' && (
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" className="-mr-2 -mt-2 shrink-0" onClick={dismissBar}>
            <X aria-hidden="true" className="size-5" />
          </Button>
        )}
      </div>
      {bar.phase === 'sending' && (
        <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            data-bar-progress={pct}
            className="h-full origin-left rounded-full bg-primary transition-transform duration-200 ease-linear motion-reduce:transition-none"
            style={{ transform: `scaleX(${bar.progress})` }}
          />
        </div>
      )}
    </div>
  )
}
