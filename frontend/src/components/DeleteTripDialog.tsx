import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Gift, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ApiError, deleteTrip, type Trip } from '@/lib/api'
import { activeUploadsFor, cancelTripUploads } from '@/lib/upload-store'
import { useUploads } from '@/lib/useUploads'

const MAX_TITLE = 60

interface DeleteTripDialogProps {
  trip: Trip
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called once the Trip is gone (deleted now, or already gone). */
  onDeleted: () => void
  /** Called for an API error that means the login is no longer valid; true when it handled it. */
  onAuthError: (err: unknown) => boolean
}

/** Asks before deleting a Trip (design/MASTER.md section 22). */
export function DeleteTripDialog({ trip, open, onOpenChange, onDeleted, onAuthError }: DeleteTripDialogProps) {
  const uploads = useUploads()
  const inFlight = activeUploadsFor(uploads, trip.id) > 0
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [slow, setSlow] = useState(false)
  // After 3 seconds of waiting the text says what is happening.
  useEffect(() => {
    if (!busy) return
    const t = window.setTimeout(() => setSlow(true), 3000)
    return () => {
      window.clearTimeout(t)
      setSlow(false)
    }
  }, [busy])
  const cancel = useRef<HTMLButtonElement>(null)
  const pending = useRef<AbortController | null>(null)
  const count = trip.photos?.length ?? 0
  const stack = (trip.photos ?? []).flatMap((p) => (p.thumbnailUrl ? [p.thumbnailUrl] : [])).slice(0, 3)
  const title = [...trip.title].length > MAX_TITLE ? `${[...trip.title].slice(0, MAX_TITLE).join('')}…` : trip.title

  // Leaving the page mid-delete aborts the request, so nothing navigates afterwards.
  useEffect(() => () => pending.current?.abort(), [])

  /** Every way of closing goes through here, so a stale error never shows on reopen. */
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
      await deleteTrip(trip.id, ctrl.signal)
      if (ctrl.signal.aborted) return
      // Only once the Trip is really gone: a failed delete must not cost the Member their uploads.
      if (inFlight) cancelTripUploads(trip.id)
      onDeleted()
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (err instanceof ApiError && err.code === 'trip-not-found') {
        if (inFlight) cancelTripUploads(trip.id)
        return onDeleted()
      }
      if (onAuthError(err)) return
      setBusy(false)
      setFailed(true)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        role="alertdialog"
        className="text-center"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancel.current?.focus()
        }}
      >
        {stack.length > 0 ? (
          <div aria-hidden="true" className="mx-auto mt-2 flex h-16 items-center justify-center">
            {stack.map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                className="size-16 rounded-[14px] border-[3px] border-white object-cover shadow-pink"
                style={{ transform: `rotate(${(i - (stack.length - 1) / 2) * 6}deg)`, marginLeft: i === 0 ? 0 : -24 }}
              />
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-2 grid size-16 place-items-center rounded-full bg-secondary text-primary">
            <Trash2 aria-hidden="true" className="size-7" />
          </div>
        )}
        <DialogTitle className="mt-4 px-8 font-serif text-[26px] font-bold leading-tight text-balance">
          ¿Borramos «{title}»?
        </DialogTitle>
        <DialogDescription className="mt-2 text-muted-foreground">
          {busy && slow
            ? 'Borrando el viaje y sus fotos…'
            : `Desaparecerá del álbum para los dos${count === 0 ? '' : count === 1 ? ', con su foto,' : `, con sus ${count} fotos,`} y no hay vuelta atrás.`}
        </DialogDescription>
        {/* Always mounted, so the announcement of the slow delete is spoken when its text changes. */}
        <p role="status" className="sr-only">
          {busy && slow ? 'Borrando el viaje y sus fotos…' : ''}
        </p>
        {trip.invitation?.status === 'pending' && (
          <p className="mt-3 flex items-center justify-center gap-2 text-[15px] text-secondary-foreground">
            <Gift aria-hidden="true" className="size-4 shrink-0" />
            Su invitación se irá con él: nunca llegará a verla.
          </p>
        )}
        {inFlight && (
          <p className="mt-3 flex items-center justify-center gap-2 text-[15px] text-secondary-foreground">
            <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
            Aún se están subiendo fotos a este viaje; se cancelarán.
          </p>
        )}
        {failed && (
          <p
            role="alert"
            className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground"
          >
            <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
            No hemos podido borrarlo. ¿Probamos otra vez?
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:justify-center">
          <Button ref={cancel} type="button" variant="soft" className="min-h-12 px-8" disabled={busy} onClick={() => close(false)}>
            Mejor no
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={confirm}>
            <Trash2 aria-hidden="true" className="size-5" />
            {busy ? 'Borrando…' : 'Sí, borrarlo'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
