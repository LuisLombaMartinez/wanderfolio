import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ImageOff, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ApiError, deletePhoto, type Photo } from '@/lib/api'
import { coverGradient } from '@/lib/cover'
import { PHOTO_DELETE_ERROR, displayFilename } from '@/lib/messages'
import { cn } from '@/lib/utils'

interface DeletePhotoDialogProps {
  tripId: string
  photo: Photo
  /** `viewer` for a ready Photo shown in the viewer, `failed` for a tile that could not be developed. */
  mode: 'viewer' | 'failed'
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The Photo is gone (deleted now, or already gone). */
  onDeleted: () => void
  /** The Trip itself is gone. */
  onTripGone: () => void
}

/** Asks before deleting a Photo (design/MASTER.md section 34). */
export function DeletePhotoDialog({ tripId, photo, mode, open, onOpenChange, onDeleted, onTripGone }: DeletePhotoDialogProps) {
  const { handleApiError } = useAuth()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [thumbBroken, setThumbBroken] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const pending = useRef<AbortController | null>(null)
  const isFailedTile = mode === 'failed'

  useEffect(() => () => pending.current?.abort(), [])

  function close(next: boolean) {
    if (busy) return
    if (!next) setFailed(false)
    onOpenChange(next)
  }

  async function confirm() {
    const ctrl = new AbortController()
    pending.current = ctrl
    setBusy(true)
    setFailed(false)
    try {
      await deletePhoto(tripId, photo.id, ctrl.signal)
      if (ctrl.signal.aborted) return
      setBusy(false)
      onDeleted()
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (err instanceof ApiError && err.code === 'photo-not-found') {
        setBusy(false)
        return onDeleted()
      }
      if (err instanceof ApiError && err.code === 'trip-not-found') return onTripGone()
      if (handleApiError(err)) return
      setBusy(false)
      setFailed(true)
    }
  }

  const showThumb = !isFailedTile && photo.thumbnailUrl && !thumbBroken
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        role="alertdialog"
        data-busy={busy || undefined}
        className="text-center"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancel.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          // Nothing opened this dialog with a trigger, so hand focus back by hand (MASTER section 34).
          e.preventDefault()
          const back = isFailedTile ? `[data-photo-id="${CSS.escape(photo.id)}"]` : '[data-viewer] [data-delete-action]'
          document.querySelector<HTMLElement>(back)?.focus({ preventScroll: true })
        }}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onPointerDownOutside={(e) => busy && e.preventDefault()}
      >
        {showThumb ? (
          <img
            src={photo.thumbnailUrl}
            alt=""
            onError={() => setThumbBroken(true)}
            className="mx-auto mt-2 size-24 rounded-[20px] object-cover shadow-pink"
          />
        ) : isFailedTile ? (
          <div
            aria-hidden="true"
            className={cn('mx-auto mt-2 grid size-24 place-items-center rounded-[20px] bg-muted shadow-pink', coverGradient(photo.id))}
          >
            <ImageOff className="size-7 text-secondary-foreground" strokeWidth={1.75} />
          </div>
        ) : (
          <div className="mx-auto mt-2 grid size-16 place-items-center rounded-full bg-secondary text-primary">
            <Trash2 aria-hidden="true" className="size-7" />
          </div>
        )}
        <DialogTitle className="mt-4 px-4 font-serif text-[26px] font-bold leading-tight text-balance">
          {isFailedTile ? '¿Quitamos esta foto?' : '¿Borramos esta foto?'}
        </DialogTitle>
        <DialogDescription className="mt-2 text-muted-foreground">
          {isFailedTile
            ? `«${displayFilename(photo.filename)}» no se ha podido revelar. La quitamos del viaje para que no estorbe.`
            : 'Desaparecerá del viaje para los dos y no hay vuelta atrás.'}
        </DialogDescription>
        {failed && (
          <p role="alert" className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground">
            <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
            {PHOTO_DELETE_ERROR}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:justify-center">
          <Button ref={cancel} type="button" variant="soft" className="min-h-12 px-8" disabled={busy} onClick={() => close(false)}>
            Mejor no
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>
            <Trash2 aria-hidden="true" className="size-5" />
            {busy ? 'Borrando…' : isFailedTile ? 'Sí, quitarla' : 'Sí, borrarla'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
