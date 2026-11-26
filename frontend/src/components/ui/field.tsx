import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

type FieldProps = Omit<ComponentProps<'input'>, 'id'> & {
  label: string
  hint?: string
  invalid?: boolean
  /** Error text shown under the input (it also marks the input invalid). */
  error?: string
  /** A decorative icon inside the input, on the left. */
  icon?: ReactNode
  /** Extra content under the input, e.g. a character counter. */
  footer?: ReactNode
}

/** A labelled text input (label above, never placeholder-only). Password fields get a show/hide toggle. */
export function Field({ label, hint, invalid, error, icon, footer, type = 'text', className, ...props }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const isInvalid = invalid || !!error
  const [shown, setShown] = useState(false)
  const isPassword = type === 'password'

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[15px] font-semibold text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && shown ? 'text' : type}
          aria-invalid={isInvalid || undefined}
          aria-describedby={[hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined}
          className={cn(
            'h-12 w-full rounded-2xl border bg-card px-4 text-base text-foreground shadow-field transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
            isInvalid ? 'border-primary' : 'border-border',
            isPassword && 'pr-12',
            icon && 'pl-11',
          )}
          {...props}
        />
        {icon && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 grid w-11 place-items-center text-ocean">
            {icon}
          </span>
        )}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-2xl text-muted-foreground hover:text-primary"
          >
            {shown ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
          </button>
        )}
      </div>
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError id={errorId} error={error} />
      {footer}
    </div>
  )
}

/** An error message under a field; it eases in (opacity and a 4px rise). */
export function FieldError({ id, error }: { id?: string; error?: string }) {
  if (!error) return null
  return (
    <p id={id} className="field-error text-[15px] font-semibold text-primary">
      {error}
    </p>
  )
}

type TextareaFieldProps = Omit<ComponentProps<'textarea'>, 'id'> & {
  label: string
  error?: string
  footer?: ReactNode
}

/** A labelled textarea that grows with its content, up to 12 rows. */
export function TextareaField({ label, error, footer, className, value, ...props }: TextareaFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const area = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[15px] font-semibold text-foreground">
        {label}
      </label>
      <textarea
        ref={area}
        id={id}
        rows={4}
        value={value}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'max-h-[calc(12*1.5rem+1.5rem)] w-full resize-none rounded-2xl border bg-card px-4 py-3 text-base leading-6 text-foreground shadow-field placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          error ? 'border-primary' : 'border-border',
        )}
        {...props}
      />
      <FieldError id={errorId} error={error} />
      {footer}
    </div>
  )
}
