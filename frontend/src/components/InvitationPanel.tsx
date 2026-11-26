import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'
import { AlertCircle, Check, Eye, Gift, Heart, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { DeleteInvitationDialog, type DeleteOutcome } from '@/components/DeleteInvitationDialog'
import { InvitationStatusBadge } from '@/components/InvitationStatusBadge'
import { Button } from '@/components/ui/button'
import { TextareaField } from '@/components/ui/field'
import { ApiError, getTrip, updateInvitationQuestion, type Invitation } from '@/lib/api'
import { gsap, prefersReducedMotion, useGSAP } from '@/lib/gsap'
import { QUESTION_LIMIT, normalizeQuestion, validateQuestion } from '@/lib/invitation'
import { DELETE_TOO_LATE, EDIT_FAILED, EDIT_TOO_LATE, INVITATION_MESSAGES, QUESTION_SAVED, TRIP_MESSAGES } from '@/lib/messages'

/** A line under the hint that says what just happened; it fades out by itself. */
export interface PanelNotice {
  text: string
  icon: 'check' | 'sparkles'
  /** How long it stays, in ms. */
  ms: number
}

/** Why the panel left the page. */
export type PanelRemoval = 'deleted' | 'gone'

interface InvitationPanelProps {
  tripId: string
  tripTitle: string
  invitation: Invitation
  notice?: PanelNotice
  onNotice: (notice: PanelNotice | undefined) => void
  /** The Invitation changed (a saved question, or it turned out to be Accepted). */
  onInvitation: (invitation: Invitation) => void
  /** The panel is done leaving: the Invitation was deleted, or is gone. */
  onRemoved: (why: PanelRemoval) => void
  onTripGone: () => void
  /** "Ver cómo queda". */
  onPreview: () => void
  /** The preview button, so the page can return focus to it. */
  previewRef?: Ref<HTMLButtonElement>
  /** Slot for #67's "Ver invitación" once Accepted. */
  acceptedAction?: ReactNode
  /** Slot for #63's Backdrop picker, under the question in the editor. */
  backdropPicker?: ReactNode
}

const saved = (text: string): PanelNotice => ({ text, icon: 'check', ms: 4000 })

/**
 * "Tu invitación": the Inviter's card on the Trip page (design/MASTER.md sections 54-58). Status,
 * the question, and, while Pending, preview, edit in place and delete.
 */
export function InvitationPanel({
  tripId,
  tripTitle,
  invitation,
  notice,
  onNotice,
  onInvitation,
  onRemoved,
  onTripGone,
  onPreview,
  previewRef,
  acceptedAction,
  backdropPicker,
}: InvitationPanelProps) {
  const { handleApiError } = useAuth()
  const headingId = useId()
  const root = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const editor = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(invitation.question)
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const accepted = invitation.status === 'accepted'
  const pendingAfterEdit = useRef(false)

  useEffect(() => () => pending.current?.abort(), [])

  // The status line fades out by itself.
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => onNotice(undefined), notice.ms)
    return () => window.clearTimeout(t)
  }, [notice, onNotice])

  // View and edit swap with a 150ms cross-fade of the body (none with reduced motion).
  useGSAP(
    () => {
      if (!pendingAfterEdit.current) return
      pendingAfterEdit.current = false
      if (prefersReducedMotion()) return
      gsap.from(body.current, { opacity: 0, duration: 0.15, ease: 'power1.out' })
    },
    { scope: root, dependencies: [editing, accepted] },
  )

  // Opening the editor puts the caret at the end of the question.
  useEffect(() => {
    if (!editing) return
    const area = editor.current?.querySelector('textarea')
    if (!area) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [editing])

  function swap(next: boolean) {
    pendingAfterEdit.current = true
    setEditing(next)
  }

  function openEditor() {
    setText(invitation.question)
    setSubmitted(false)
    setServerError(undefined)
    setFailed(false)
    onNotice(undefined)
    swap(true)
  }

  function closeEditor(focusEdit = true) {
    swap(false)
    setSubmitted(false)
    setServerError(undefined)
    setFailed(false)
    if (focusEdit) requestAnimationFrame(() => editButton.current?.focus())
  }

  /** The Invitation turned out to be Accepted: show it so, with `line` saying why nothing changed. */
  async function learnAccepted(line: string) {
    let latest: Invitation | null = null
    try {
      const trip = await getTrip(tripId)
      if (trip.invitation?.status === 'accepted') latest = trip.invitation
    } catch {
      // The refetch is a nicety: the panel can say "accepted" without the exact day.
    }
    onInvitation(latest ?? { ...invitation, status: 'accepted', acceptedAt: invitation.acceptedAt ?? new Date().toISOString() })
    swap(false)
    setDeleting(false)
    onNotice(saved(line))
    requestAnimationFrame(() => heading.current?.focus())
  }

  async function save() {
    setSubmitted(true)
    const problem = validateQuestion(text)
    if (problem) return
    const question = normalizeQuestion(text)
    if (question === invitation.question) return closeEditor()
    const ctrl = new AbortController()
    pending.current = ctrl
    setSaving(true)
    setFailed(false)
    setServerError(undefined)
    try {
      const updated = await updateInvitationQuestion(tripId, question, ctrl.signal)
      if (ctrl.signal.aborted) return
      setSaving(false)
      onInvitation(updated)
      closeEditor()
      onNotice(saved(QUESTION_SAVED))
    } catch (err) {
      if (ctrl.signal.aborted) return
      setSaving(false)
      if (handleApiError(err)) return
      const code = err instanceof ApiError ? err.code : ''
      if (code === 'invitation-accepted') return void learnAccepted(EDIT_TOO_LATE)
      if (code === 'invitation-not-found') {
        onNotice(undefined)
        return exit('gone')
      }
      if (code === 'trip-not-found') return onTripGone()
      if (INVITATION_MESSAGES[code] || code === 'invalid-characters') {
        setServerError(INVITATION_MESSAGES[code] ?? TRIP_MESSAGES['invalid-characters'])
        return editor.current?.querySelector('textarea')?.focus()
      }
      setFailed(true)
    }
  }

  /** The card shrinks and fades (200ms), then the page closes the gap. */
  function exit(why: PanelRemoval) {
    const card = root.current
    if (!card || prefersReducedMotion()) return onRemoved(why)
    gsap.to(card, { scale: 0.96, opacity: 0, duration: 0.2, ease: 'power2.in', onComplete: () => onRemoved(why) })
  }

  function onDeleteDone(outcome: DeleteOutcome) {
    setDeleting(false)
    if (outcome === 'deleted') return exit('deleted')
    if (outcome === 'trip-gone') return onTripGone()
    void learnAccepted(DELETE_TOO_LATE)
  }

  const n = Array.from(text).length
  const error = (submitted ? validateQuestion(text) : undefined) ?? serverError
  const shownError = error ?? (n > QUESTION_LIMIT ? INVITATION_MESSAGES['question-too-long'] : undefined)

  return (
    <section
      ref={root}
      data-enter
      data-invitation-panel
      aria-labelledby={headingId}
      className="rounded-photo border border-border bg-card p-5 shadow-pink sm:p-6"
    >
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr_auto]">
        <span
          aria-hidden="true"
          className="grid size-14 shrink-0 place-items-center rounded-2xl"
          style={{ backgroundImage: 'var(--gradient-sunset)' }}
        >
          <span className="grid size-9 place-items-center rounded-full bg-white/60">
            <Gift className="size-[22px] text-primary" />
          </span>
        </span>
        <div className="min-w-0">
          <p aria-hidden="true" className="font-script text-2xl leading-none text-primary">
            tu sorpresa
          </p>
          <h2 ref={heading} id={headingId} tabIndex={-1} className="font-serif text-2xl font-bold leading-tight outline-none">
            Tu invitación
          </h2>
        </div>
        <div className="col-start-2 sm:col-start-3 sm:row-start-1">
          <InvitationStatusBadge invitation={invitation} />
        </div>
      </div>

      <div ref={body} className="mt-5">
        {editing && !accepted ? (
          <div
            ref={editor}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                if (!saving) closeEditor()
              }
            }}
          >
            <TextareaField
              label="La pregunta"
              name="question"
              rows={2}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setServerError(undefined)
              }}
              readOnly={saving}
              error={shownError}
              hint="La verá en cuanto abra el álbum. Hasta que diga que sí, este viaje será vuestro secreto… bueno, tuyo."
              className="[&_textarea]:max-h-[calc(4*1.5rem+1.5rem)]"
              footer={
                <p
                  aria-live={n >= 100 ? 'polite' : undefined}
                  className={`text-right text-sm ${n >= 100 ? 'text-secondary-foreground' : 'text-muted-foreground'}`}
                >
                  {n}/{QUESTION_LIMIT}
                </p>
              }
            />
            {backdropPicker}
            {failed && (
              <p
                role="alert"
                className="mt-4 flex items-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground"
              >
                <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
                {EDIT_FAILED}
              </p>
            )}
            <div className="mt-4 flex flex-col gap-3 min-[480px]:flex-row-reverse min-[480px]:justify-start">
              <Button
                type="button"
                onClick={() => void save()}
                aria-disabled={saving || undefined}
                className={saving ? 'pointer-events-none' : undefined}
              >
                <Heart aria-hidden="true" className={`size-5 fill-current ${saving ? 'motion-safe:animate-pulse' : ''}`} />
                {saving ? 'Guardando…' : 'Guardar pregunta'}
              </Button>
              <Button type="button" variant="ghost" className="min-h-12 px-6" disabled={saving} onClick={() => closeEditor()}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <blockquote className="font-serif text-[22px] font-semibold italic leading-tight text-balance [overflow-wrap:anywhere]">
              «{invitation.question.replace(/\s+/g, ' ').trim()}»
            </blockquote>
            <p className="mt-3 text-[15px] text-muted-foreground">
              {accepted ? 'Este momento se queda así para siempre.' : 'Aún no ha dicho que sí. El viaje sigue siendo tu secreto.'}
            </p>
          </>
        )}
      </div>

      {notice && !editing && (
        <p
          role="status"
          className="mt-4 flex w-fit max-w-full items-center gap-2 rounded-full bg-secondary px-4 py-2 text-[15px] text-secondary-foreground"
        >
          {notice.icon === 'sparkles' ? (
            <Sparkles aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <Check aria-hidden="true" className="size-4 shrink-0" />
          )}
          {notice.text}
        </p>
      )}

      {accepted && acceptedAction}

      {!accepted && !editing && (
        <div className="mt-4 flex flex-col gap-3">
          <Button ref={previewRef} type="button" variant="soft" className="min-h-12 w-full" onClick={onPreview}>
            <Eye aria-hidden="true" className="size-5" />
            Ver cómo queda
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button
              ref={editButton}
              type="button"
              variant="soft"
              className="min-h-12"
              aria-label="Editar la pregunta"
              onClick={openEditor}
            >
              <Pencil aria-hidden="true" className="size-5" />
              Editar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-12"
              aria-label="Borrar la invitación"
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden="true" className="size-5" />
              Borrar
            </Button>
          </div>
        </div>
      )}

      {!accepted && (
        <DeleteInvitationDialog
          tripId={tripId}
          tripTitle={tripTitle}
          open={deleting}
          onOpenChange={setDeleting}
          onDone={onDeleteDone}
        />
      )}
    </section>
  )
}
