import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Gift, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ApiError, deleteInvitation } from '@/lib/api'
import { DELETE_FAILED } from '@/lib/messages'

const MAX_TITLE = 60

/** How a confirmed delete ended; the caller decides what the page does next. */
export type DeleteOutcome = 'deleted' | 'accepted' | 'trip-gone'

interface DeleteInvitationDialogProps {
  tripId: string
  tripTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called once the dialog has nothing more to do: the Invitation is gone, was accepted meanwhile, or its Trip is gone. */
  onDone: (outcome: DeleteOutcome) => void
}

/** Asks before cancelling a Pending Invitation (design/MASTER.md section 58). */
export function DeleteInvitationDialog({ tripId, tripTitle, open, onOpenChange, onDone }: DeleteInvitationDialogProps) {
  const { handleApiError } = useAuth()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const pending = useRef<AbortController | null>(null)
  const title = [...tripTitle].length > MAX_TITLE ? `${[...tripTitle].slice(0, MAX_TITLE).join('')}…` : tripTitle

  // Leaving the page mid-delete aborts the request, so nothing happens afterwards.
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
      await deleteInvitation(tripId, ctrl.signal)
      if (!ctrl.signal.aborted) onDone('deleted')
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (err instanceof ApiError && err.code === 'invitation-not-found') return onDone('deleted')
      if (err instanceof ApiError && err.code === 'invitation-accepted') return onDone('accepted')
      if (err instanceof ApiError && err.code === 'trip-not-found') return onDone('trip-gone')
      if (handleApiError(err)) return
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
        <div className="mx-auto mt-2 grid size-16 place-items-center rounded-full bg-secondary text-primary">
          <Gift aria-hidden="true" className="size-7" />
        </div>
        <DialogTitle className="mt-4 px-8 font-serif text-[26px] font-bold leading-tight text-balance">
          ¿Cancelamos la sorpresa?
        </DialogTitle>
        <DialogDescription className="mt-2 text-muted-foreground">
          La invitación desaparecerá y «{title}» aparecerá en su álbum como cualquier otro viaje. No hay vuelta atrás.
        </DialogDescription>
        {failed && (
          <p
            role="alert"
            className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground"
          >
            <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
            {DELETE_FAILED}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:justify-center">
          <Button ref={cancel} type="button" variant="soft" className="min-h-12 px-8" disabled={busy} onClick={() => close(false)}>
            Mejor no
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={confirm}>
            <Trash2 aria-hidden="true" className="size-5" />
            {busy ? 'Borrando…' : 'Sí, borrarla'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
