import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AlertCircle, Gift, Heart, Hourglass, MapPin } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { TripShell } from '@/components/TripShell'
import { TripLoadErrorCard, TripNotFoundCard } from '@/components/TripStateCards'
import { Button } from '@/components/ui/button'
import { Field, TextareaField } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { ApiError, createTrip, getTrip, updateTrip } from '@/lib/api'
import { isRealDate, tripLength, tripLengthLabel } from '@/lib/dates'
import { gsap, useGSAP } from '@/lib/gsap'
import { INVITATION_MESSAGES, tripErrorMessage } from '@/lib/messages'
import { QUESTION_LIMIT, questionFollows, suggestedQuestion, validateQuestion } from '@/lib/invitation'
import { prefersReducedMotion } from '@/lib/utils'
import { LIMITS, fieldForCode, validateTrip, type TripErrors, type TripField, type TripValues } from '@/lib/trip-form'
import { useAfter } from '@/lib/useAfter'

const EMPTY: TripValues = { title: '', destination: '', startDate: '', endDate: '', description: '' }
const FIELD_ORDER: TripField[] = ['title', 'destination', 'startDate', 'endDate', 'description']

/** The Trip form: `/trips/new` creates, `/trips/:id/edit` edits (design/MASTER.md section 21). */
export function TripFormPage() {
  const { id } = useParams()
  // Keyed by id so navigating between Trips never shows the previous Trip's values.
  return <TripFormFor key={id ?? 'new'} id={id} />
}

function TripFormFor({ id }: { id?: string }) {
  const editing = id !== undefined
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<
    { status: 'loading' } | { status: 'not-found' } | { status: 'error' } | { status: 'ready'; values: TripValues }
  >(editing ? { status: 'loading' } : { status: 'ready', values: EMPTY })
  const { handleApiError } = useAuth()
  const heading = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.title = `${editing ? 'Editar viaje' : 'Un viaje nuevo'} · Viajecito`
    heading.current?.focus()
  }, [editing])

  useEffect(() => {
    if (!id) return
    const ctrl = new AbortController()
    getTrip(id, ctrl.signal)
      .then((trip) =>
        setLoad({
          status: 'ready',
          values: {
            title: trip.title,
            destination: trip.destination,
            startDate: trip.startDate,
            endDate: trip.endDate,
            description: trip.description ?? '',
          },
        }),
      )
      .catch((err: unknown) => {
        if (ctrl.signal.aborted || handleApiError(err)) return
        setLoad(err instanceof ApiError && err.code === 'trip-not-found' ? { status: 'not-found' } : { status: 'error' })
      })
    return () => ctrl.abort()
  }, [id, attempt, handleApiError])

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('[data-enter]', { autoAlpha: 0, y: 16, duration: 0.5, ease: 'power2.out', stagger: 0.08 })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  const backTo = editing ? `/trips/${id}` : '/'
  return (
    <TripShell narrow backTo={backTo} backLabel={editing ? 'Volver al viaje' : 'Volver al álbum'}>
      <div ref={root}>
        <div data-enter>
          <p aria-hidden="true" className="font-script text-[28px] leading-none text-primary">
            {editing ? 'retocando recuerdos' : '¿a dónde nos escapamos?'}
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="mt-1 font-serif text-[clamp(2rem,7vw,2.75rem)] font-bold leading-tight outline-none"
          >
            {editing ? 'Editar viaje' : 'Un viaje nuevo'}
          </h1>
        </div>
        <div className="mt-6">
          {load.status === 'loading' && <FormSkeleton />}
          {load.status === 'not-found' && <TripNotFoundCard />}
          {load.status === 'error' && <TripLoadErrorCard onRetry={() => {
                setLoad({ status: 'loading' })
                setAttempt((n) => n + 1)
              }} />}
          {load.status === 'ready' && <TripForm tripId={id} initial={load.values} cancelTo={backTo} />}
        </div>
      </div>
    </TripShell>
  )
}

function TripForm({ tripId, initial, cancelTo }: { tripId?: string; initial: TripValues; cancelTo: string }) {
  const navigate = useNavigate()
  const { handleApiError } = useAuth()
  const form = useRef<HTMLFormElement>(null)
  const [values, setValues] = useState<TripValues>(initial)
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<TripErrors>({})
  const [banner, setBanner] = useState<{ text: string; gone?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  // The Invitation (create only). The question follows the destination until it is edited (null).
  const [inviting, setInviting] = useState(false)
  const [customQuestion, setCustomQuestion] = useState<string | null>(null)
  const [questionServerError, setQuestionServerError] = useState<string>()
  const creating = tripId === undefined
  const question = customQuestion ?? suggestedQuestion(values.destination)
  const questionError =
    creating && inviting ? (submitted ? validateQuestion(question) : undefined) ?? questionServerError : undefined

  // After the first submit, every change is checked live; the API's own errors stick until the field changes.
  const clientErrors = submitted ? validateTrip(values) : {}
  const errors: TripErrors = { ...serverErrors, ...clientErrors }

  function set(field: TripField, value: string) {
    setValues((v) => {
      const next = { ...v, [field]: value }
      // A first date pre-fills the end (a one-day Trip); a filled end is never changed silently.
      if (field === 'startDate' && isRealDate(value) && !v.endDate) next.endDate = value
      return next
    })
    setServerErrors((e) => ({ ...e, [field]: undefined }))
  }

  function focusFirst(errs: TripErrors, questionInvalid = false) {
    const first = FIELD_ORDER.find((f) => errs[f]) ?? (questionInvalid ? 'question' : undefined)
    if (first) form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setSubmitted(true)
    setBanner(null)
    const found = validateTrip(values)
    const questionInvalid = creating && inviting && validateQuestion(question) !== undefined
    if (Object.keys(found).length > 0 || questionInvalid) return focusFirst(found, questionInvalid)
    setBusy(true)
    const input = {
      title: values.title.trim(),
      destination: values.destination.trim(),
      startDate: values.startDate,
      endDate: values.endDate,
      description: values.description.trim(),
    }
    try {
      const saved = tripId
        ? await updateTrip(tripId, input)
        : await createTrip(inviting ? { ...input, invitation: { question: question.replace(/\s+/g, ' ').trim() } } : input)
      navigate(`/trips/${saved.id}`, { replace: true })
    } catch (err) {
      if (handleApiError(err)) return
      setBusy(false)
      const code = err instanceof ApiError ? err.code : ''
      const field = fieldForCode(code)
      if (INVITATION_MESSAGES[code] && inviting) {
        setQuestionServerError(INVITATION_MESSAGES[code])
        focusFirst({}, true)
      } else if (field) {
        const errs = { [field]: tripErrorMessage(err) }
        setServerErrors(errs)
        focusFirst(errs)
      } else if (code === 'trip-not-found') {
        setBanner({ text: 'Este viaje ya no está en el álbum. Puede que lo hayamos borrado.', gone: true })
      } else {
        setBanner({ text: tripErrorMessage(err) })
      }
    }
  }

  const datesOk = isRealDate(values.startDate) && isRealDate(values.endDate) && tripLength(values.startDate, values.endDate) >= 1
  const counter = (field: 'title' | 'destination' | 'description', from: number) => {
    const n = [...values[field]].length
    // Visible from `from`; announced only at the limit, never per keystroke. The status region is
    // always mounted so the announcement at the limit is reliably read.
    const atLimit = n >= LIMITS[field]
    return (
      <>
        {n >= from && (
          <p aria-hidden="true" className="text-right text-sm text-muted-foreground">
            {n}/{LIMITS[field]}
          </p>
        )}
        <p role="status" className="sr-only">
          {atLimit ? `Has llegado al límite de ${LIMITS[field]} caracteres.` : ''}
        </p>
      </>
    )
  }

  return (
    <form
      ref={form}
      noValidate
      onSubmit={submit}
      data-enter
      aria-busy={busy}
      className="flex flex-col gap-5 rounded-photo bg-card p-5 shadow-pink sm:p-8"
    >
      {banner && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl bg-secondary px-4 py-3 text-secondary-foreground">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p>
            {banner.text}
            {banner.gone && (
              <>
                {' '}
                <Link to="/" className="font-bold underline">
                  Volver al álbum
                </Link>
              </>
            )}
          </p>
        </div>
      )}

      <Field
        label="Título"
        name="title"
        value={values.title}
        onChange={(e) => set('title', e.target.value)}
        readOnly={busy}
        maxLength={LIMITS.title}
        placeholder="Escapada a Gran Canaria"
        autoComplete="off"
        error={errors.title}
        footer={counter('title', 100)}
      />
      <Field
        label="Destino"
        name="destination"
        value={values.destination}
        onChange={(e) => set('destination', e.target.value)}
        readOnly={busy}
        maxLength={LIMITS.destination}
        placeholder="Las Palmas de Gran Canaria"
        autoComplete="off"
        icon={<MapPin className="size-5" />}
        error={errors.destination}
        footer={counter('destination', 100)}
      />
      <div className="flex flex-col gap-5 min-[360px]:grid min-[360px]:grid-cols-2 min-[360px]:items-start min-[360px]:gap-3">
        <Field
          label="Empieza el"
          name="startDate"
          type="date"
          value={values.startDate}
          onChange={(e) => set('startDate', e.target.value)}
          readOnly={busy}
          error={errors.startDate}
        />
        <Field
          label="Termina el"
          name="endDate"
          type="date"
          value={values.endDate}
          min={values.startDate || undefined}
          onChange={(e) => set('endDate', e.target.value)}
          readOnly={busy}
          error={errors.endDate}
        />
      </div>
      <p aria-live="polite" className="-mt-2 flex min-h-6 items-center gap-2 text-[15px] text-muted-foreground">
        {datesOk && (
          <>
            <Hourglass aria-hidden="true" className="size-4 text-ocean" />
            {tripLengthLabel(values.startDate, values.endDate)}
          </>
        )}
      </p>
      <TextareaField
        label="Descripción (opcional)"
        name="description"
        value={values.description}
        onChange={(e) => set('description', e.target.value)}
        readOnly={busy}
        maxLength={LIMITS.description}
        placeholder="Lo que soñamos hacer, dónde dormiremos, lo que no nos podemos perder…"
        error={errors.description}
        footer={counter('description', 1800)}
      />

      {creating && (
        <InvitationOption
          on={inviting}
          onToggle={setInviting}
          question={question}
          onQuestion={(q) => {
            setCustomQuestion(questionFollows(q, values.destination) ? null : q)
            setQuestionServerError(undefined)
          }}
          error={questionError}
          busy={busy}
        />
      )}

      <div className="mt-2 flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" disabled={busy}>
          <Heart aria-hidden="true" className={busy ? 'heart-pulse size-5 fill-current' : 'size-5'} />
          {busy ? 'Guardando…' : tripId ? 'Guardar cambios' : 'Guardar viaje'}
        </Button>
        <Button asChild variant="ghost" className="min-h-12 px-8">
          <Link to={cancelTo}>Cancelar</Link>
        </Button>
      </div>
    </form>
  )
}

/** "Añadir invitación": the switch row and, when on, the question (MASTER section 51). */
function InvitationOption({
  on,
  onToggle,
  question,
  onQuestion,
  error,
  busy,
}: {
  on: boolean
  onToggle: (on: boolean) => void
  question: string
  onQuestion: (q: string) => void
  error?: string
  busy: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const n = Array.from(question).length

  useGSAP(
    () => {
      if (!on || prefersReducedMotion()) return
      gsap.from(panel.current, { opacity: 0, y: 8, duration: 0.2, ease: 'power2.out' })
    },
    { dependencies: [on] },
  )

  return (
    <div className="-mx-5 border-t border-border px-5 pt-6 sm:-mx-8 sm:px-8">
      <div
        className="flex min-h-14 cursor-pointer items-center gap-3"
        onClick={(e) => {
          // The whole row toggles; the switch handles its own click.
          if (!(e.target instanceof Element && e.target.closest('[role="switch"]')) && !busy) onToggle(!on)
        }}
      >
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary">
          <Gift className="size-5 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span id="invitation-toggle-label" className="block text-[17px] font-bold text-foreground">
            Añadir invitación
          </span>
          <span id="invitation-toggle-hint" className="block text-sm text-muted-foreground">
            Que el viaje sea una sorpresa hasta que diga que sí.
          </span>
        </span>
        <Switch
          checked={on}
          onCheckedChange={onToggle}
          disabled={busy}
          aria-labelledby="invitation-toggle-label"
          aria-describedby="invitation-toggle-hint"
        />
      </div>
      {on && (
        <div ref={panel} className="mt-5 pb-1">
          <TextareaField
            label="La pregunta"
            name="question"
            rows={2}
            value={question}
            onChange={(e) => onQuestion(e.target.value)}
            readOnly={busy}
            error={error ?? (n > QUESTION_LIMIT ? INVITATION_MESSAGES['question-too-long'] : undefined)}
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
        </div>
      )}
    </div>
  )
}

function FormSkeleton() {
  const visible = useAfter(200)
  if (!visible) return null
  return (
    <div role="status" aria-label="Cargando el viaje" className="shimmer flex flex-col gap-5 rounded-photo bg-card p-5 shadow-pink sm:p-8">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-12 rounded-2xl bg-muted" />
      ))}
    </div>
  )
}
