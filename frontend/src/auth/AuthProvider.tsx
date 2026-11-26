import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, getCurrentMember, type Member } from '@/lib/api'
import * as auth from '@/lib/auth'
import { startMediaSession, stopMediaSession } from '@/lib/media'
import { cancelAll } from '@/lib/upload-store'
import { errorMessage } from '@/lib/messages'
import { AuthContext, type AuthState } from './auth-context'

const isAuthFailure = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 403)

/** Knows whether a Member is logged in, and who. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  // Boot: a saved session is resumed if the API still recognises its Member.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const token = await auth.accessToken()
      if (cancelled) return
      if (!token) {
        setState({ status: 'signed-out' })
        return
      }
      try {
        const member = await getCurrentMember()
        if (!cancelled) setState({ status: 'signed-in', member })
      } catch (err) {
        if (cancelled) return
        // The login is no longer valid (or not a Member): drop it. Any other failure
        // (offline, 5xx) keeps the saved session so the next visit can resume it.
        if (isAuthFailure(err)) await auth.logOut().catch(() => undefined)
        if (cancelled) return
        const notice = err instanceof ApiError && err.status === 401 ? undefined : { error: errorMessage(err) }
        setState({ status: 'signed-out', notice })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** After Cognito accepts a login, the API must recognise the Member; otherwise undo the login. */
  const finishLogin = useCallback(async (): Promise<Member> => {
    try {
      const member = await getCurrentMember()
      setState({ status: 'signed-in', member })
      return member
    } catch (err) {
      await auth.logOut().catch(() => undefined)
      throw err
    }
  }, [])

  const logIn = useCallback(
    async (email: string, password: string) => {
      const step = await auth.logIn(email, password)
      if (step === 'done') await finishLogin()
      return step
    },
    [finishLogin],
  )

  const setNewPassword = useCallback(
    async (password: string) => {
      const step = await auth.setNewPassword(password)
      if (step === 'done') await finishLogin()
      return step
    },
    [finishLogin],
  )

  const logOut = useCallback(async () => {
    // Local tokens are cleared even if the call to Cognito fails.
    await auth.logOut().catch(() => undefined)
    setState({ status: 'signed-out', notice: 'farewell' })
  }, [])

  const handleApiError = useCallback((err: unknown) => {
    if (!isAuthFailure(err)) return false
    void auth.logOut().catch(() => undefined)
    const notice = err instanceof ApiError && err.status === 403 ? { error: errorMessage(err) } : undefined
    setState({ status: 'signed-out', notice })
    return true
  }, [])

  // The signed cookies for /media/* exist before any Photo is drawn, and go when the Member leaves.
  const signedIn = state.status === 'signed-in'
  useEffect(() => {
    if (signedIn) startMediaSession()
    else {
      stopMediaSession()
      cancelAll()
    }
  }, [signedIn])

  const value = useMemo(
    () => ({ state, logIn, setNewPassword, logOut, handleApiError }),
    [state, logIn, setNewPassword, logOut, handleApiError],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
