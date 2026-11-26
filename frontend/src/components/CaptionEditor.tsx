import { useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, Heart } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { ApiError, updatePhotoCaption, type Photo } from '@/lib/api'
import { CAPTION_LIMIT, checkCaption } from '@/lib/photos'
import { captionErrorMessage } from '@/lib/messages'

const COUNTER_FROM = 450

interface CaptionEditorProps {
  tripId: string
  photo: Photo
  /** The Photo as the API now has it (caption saved or cleared). */
  onSaved: (photo: Photo) => void
  onCancel: () => void
  /** The Photo, or its Trip, no longer exists. */
  onGone: (what: 'photo' | 'trip') => void
  /** Tells the viewer a save is in flight, so swipe, arrows and Escape stay off. */
  onBusy: (busy: boolean) => void
}

/** Inline caption editing in the viewer's panel (design/MASTER.md section 33). */
export function CaptionEditor({ tripId, photo, onSaved, onCancel, onGone, onBusy }: CaptionEditorProps) {
  const { handleApiError } = useAuth()
  const [text, setText] = useState(photo.caption ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<AbortController | null>(null)
  const id = useId()
  const errorId = `${id}-error`
  const count = [...text.trim()].length

  useEffect(() => {
    const el = field.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    onBusy(saving)
    return () => onBusy(false)
  }, [saving, onBusy])

  // The field grows with its text, up to about 8 rows, then scrolls.
  useEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  const problemText = (value: string) => {
    const problem = checkCaption(value)
    return problem ? captionErrorMessage(new ApiError(422, problem)) : null
  }

  async function save() {
    if (saving) return
    const trimmed = text.trim()
    if (trimmed === (photo.caption ?? '')) return onCancel()
    const problem = problemText(text)
    if (problem) {
      setTried(true)
      setError(problem)
      field.current?.focus()
      return
    }
    const ctrl = new AbortController()
    pending.current = ctrl
    setSaving(true)
    setError(null)
    try {
      const saved = await updatePhotoCaption(tripId, photo.id, trimmed, ctrl.signal)
      if (ctrl.signal.aborted) return
      onSaved(saved)
    } catch (err) {
      if (ctrl.signal.aborted) return
      if (err instanceof ApiError && err.code === 'photo-not-found') return onGone('photo')
      if (err instanceof ApiError && err.code === 'trip-not-found') return onGone('trip')
      if (handleApiError(err)) return
      setSaving(false)
      setTried(true)
      setError(captionErrorMessage(err))
      field.current?.focus()
    }
  }

  return (
    <div data-caption-editor className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-bold text-white/85">
        Una frase para esta foto
      </label>
      <textarea
        ref={field}
        id={id}
        rows={3}
        autoComplete="off"
        value={text}
        readOnly={saving}
        placeholder="El atardecer más bonito de todo el viaje…"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          setText(e.target.value)
          if (tried) setError(problemText(e.target.value))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void save()
          }
        }}
        className="w-full resize-none rounded-2xl bg-card p-3 text-base text-card-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      />
      {count >= COUNTER_FROM && (
        <p aria-live="polite" className="text-right text-[13px] text-white/75">
          {count}/{CAPTION_LIMIT}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-2 rounded-2xl bg-card/90 px-3 py-2 text-sm font-bold text-secondary-foreground"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" className="min-h-11 px-5 text-white hover:bg-white/12" disabled={saving} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="button" className="min-h-11 px-6" disabled={saving} onClick={() => void save()}>
          <Heart aria-hidden="true" className={saving ? 'size-[18px] animate-[heart-pulse_1s_ease-in-out_infinite] motion-reduce:animate-none' : 'size-[18px]'} />
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  )
}
