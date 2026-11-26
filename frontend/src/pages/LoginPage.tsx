import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { AlertCircle, Heart } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { ApiError } from '@/lib/api'
import { gsap, useGSAP } from '@/lib/gsap'
import { errorMessage } from '@/lib/messages'

type Step = 'credentials' | 'new-password'

export function LoginPage() {
  const { state, logIn, setNewPassword } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [step, setStep] = useState<Step>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPasswordValue] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const root = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // True once the card moves to the new-password step (not on first paint, even under StrictMode).
  const stepChanged = useRef(false)

  useEffect(() => {
    document.title = 'Entrar · Viajecito'
  }, [])

  useEffect(() => {
    heading.current?.focus()
  }, [step])

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        if (stepChanged.current) {
          gsap.from('[data-step]', { autoAlpha: 0, y: 8, duration: 0.25, ease: 'power2.out' })
        } else {
          gsap.from('[data-enter]', { autoAlpha: 0, y: 16, duration: 0.5, ease: 'power2.out', stagger: 0.08 })
        }
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [step] },
  )

  if (state.status === 'signed-in') return <Navigate to={from} replace />

  const notice = state.status === 'signed-out' ? state.notice : undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (step === 'new-password' && newPassword !== repeat) {
      setError('Las dos contraseñas no coinciden.')
      return
    }
    setBusy(true)
    try {
      const next = step === 'credentials' ? await logIn(email, password) : await setNewPassword(newPassword)
      if (next === 'new-password') {
        setPassword('')
        stepChanged.current = true
        setStep('new-password')
      }
    } catch (err) {
      // An API error after the new password was saved: the login was undone, so the
      // Member logs in again with the new password.
      if (step === 'new-password' && err instanceof ApiError) {
        stepChanged.current = true
        setStep('credentials')
      }
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      ref={root}
      className="flex min-h-dvh flex-col items-center justify-center px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]"
    >
      <p data-enter className="font-script text-[40px] leading-none text-primary md:text-[56px]">
        Viajecito
      </p>
      <p data-enter className="mt-3 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        solo para nosotros dos
      </p>

      {notice === 'farewell' && (
        <p data-enter className="mt-6 font-serif text-xl font-semibold text-secondary-foreground" role="status">
          Hasta pronto 💌
        </p>
      )}

      <section
        data-enter
        data-testid="login-card"
        className="mt-8 w-full max-w-[400px] rounded-photo bg-card p-6 shadow-pink md:max-w-[420px] md:p-8"
      >
        <form onSubmit={submit} noValidate data-step key={step} className="flex flex-col gap-5">
          {step === 'credentials' ? (
            <>
              <div>
                <h1
                  ref={heading}
                  tabIndex={-1}
                  className="font-serif text-[clamp(1.75rem,6vw,2.25rem)] font-bold leading-tight text-balance outline-none"
                >
                  Hola de nuevo, amor
                </h1>
                <p className="mt-1 text-muted-foreground">Entra para ver nuestros viajes juntos.</p>
              </div>
              <Field
                label="Tu correo"
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                invalid={!!error}
              />
              <Field
                label="Tu contraseña"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={!!error}
              />
            </>
          ) : (
            <>
              <div>
                <h1
                  ref={heading}
                  tabIndex={-1}
                  className="font-serif text-[clamp(1.75rem,6vw,2.25rem)] font-bold leading-tight text-balance outline-none"
                >
                  Elige tu contraseña
                </h1>
                <p className="mt-1 text-muted-foreground">
                  Es tu primera vez aquí. Cambia la contraseña temporal por una que solo sepas tú.
                </p>
              </div>
              <Field
                label="Nueva contraseña"
                type="password"
                name="new-password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPasswordValue(e.target.value)}
                hint="Al menos 12 caracteres, con mayúscula, minúscula, número y símbolo."
                invalid={!!error}
              />
              <Field
                label="Repítela"
                type="password"
                name="repeat-password"
                autoComplete="new-password"
                required
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                invalid={!!error}
              />
            </>
          )}

          {(error || (typeof notice === 'object' && notice.error)) && (
            <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-secondary-foreground">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{error ?? (typeof notice === 'object' ? notice.error : '')}</span>
            </p>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            <Heart aria-hidden="true" className="size-5" />
            {step === 'credentials' ? (busy ? 'Entrando…' : 'Entrar') : busy ? 'Guardando…' : 'Guardar y entrar'}
          </Button>
        </form>
      </section>
    </main>
  )
}
