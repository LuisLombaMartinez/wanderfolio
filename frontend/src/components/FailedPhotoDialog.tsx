import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ImageOff, Trash2 } from 'lucide-react'
import { SpinIcon } from '@/components/SpinIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { Photo } from '@/lib/api'
import { coverGradient } from '@/lib/cover'
import { RETRY_FAILED, displayFilename, failureCopy } from '@/lib/messages'
import type { RetryOutcome } from '@/lib/photo-retry'
import { cn } from '@/lib/utils'

interface FailedPhotoDialogProps {
  /** The failed Photo being looked at; null keeps the dialog closed. */
  photo: Photo | null
  /** This device already retried it and it failed again. */
  secondTry: boolean
  /** Asks the API to retry; the page applies the outcome (closing the dialog) except for `error`. */
  onRetry: (photo: Photo) => Promise<RetryOutcome>
  onClose: () => void
  /** "Quitarla del viaje": the page closes this dialog and opens the delete confirmation (MASTER section 43). */
  onRemove?: (photo: Photo) => void
  /** Where focus goes when the dialog has closed (the page picks the tile). */
  onCloseFocus?: () => void
}

/** Tells a Member why a Photo did not come out and offers to try again (MASTER section 42). */
export function FailedPhotoDialog(props: FailedPhotoDialogProps) {
  // Keyed by Photo, so a stale error never shows for another one.
  return <FailedPhotoDialogFor key={props.photo?.id ?? ''} {...props} />
}

function FailedPhotoDialogFor({ photo, secondTry, onRetry, onClose, onRemove, onCloseFocus }: FailedPhotoDialogProps) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const retry = useRef<HTMLButtonElement>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  if (!photo) return <Dialog open={false} />
  const copy = failureCopy(photo.failureReason, secondTry)

  async function go(target: Photo) {
    setBusy(true)
    setFailed(false)
    const outcome = await onRetry(target)
    if (!mounted.current) return
    setBusy(false)
    if (outcome === 'error') setFailed(true)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="max-w-[440px] text-center"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          retry.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          if (!onCloseFocus) return
          e.preventDefault()
          onCloseFocus()
        }}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onInteractOutside={(e) => busy && e.preventDefault()}
      >
        <span
          aria-hidden="true"
          className={cn('mx-auto mt-2 grid size-24 place-items-center rounded-[20px] shadow-pink', coverGradient(photo.id))}
        >
          <span className="grid size-11 place-items-center rounded-full bg-white/60">
            <ImageOff className="size-5 text-secondary-foreground" strokeWidth={1.75} />
          </span>
        </span>
        <DialogTitle className="mt-4 px-8 font-serif text-[26px] font-bold leading-tight text-balance">
          Esta foto se nos ha resistido
        </DialogTitle>
        <p className="mt-2 break-words text-[15px] font-bold text-secondary-foreground">«{displayFilename(photo.filename)}»</p>
        <DialogDescription className="mt-3 text-base text-muted-foreground">{copy.reason}</DialogDescription>
        {copy.hint && <p className="mt-2 text-sm text-muted-foreground">{copy.hint}</p>}
        {failed && (
          <p
            role="alert"
            className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground"
          >
            <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
            {RETRY_FAILED}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3 min-[480px]:flex-row-reverse min-[480px]:justify-center">
          <Button ref={retry} type="button" disabled={busy} onClick={() => void go(photo)}>
            <SpinIcon spinning={busy} />
            {busy ? 'Probando…' : 'Probar otra vez'}
          </Button>
          <Button type="button" variant="soft" className="min-h-12 px-8" disabled={busy} onClick={onClose}>
            Ahora no
          </Button>
        </div>
        {onRemove && (
          <Button type="button" variant="ghost" className="mt-2 min-h-11" disabled={busy} onClick={() => onRemove(photo)}>
            <Trash2 aria-hidden="true" className="size-[18px]" />
            Quitarla del viaje
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
