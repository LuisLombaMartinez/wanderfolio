import { createContext, useContext } from 'react'
import type { Member } from '@/lib/api'
import type { LoginStep } from '@/lib/auth'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; notice?: 'farewell' | { error: string } }
  | { status: 'signed-in'; member: Member }

export interface AuthContextValue {
  state: AuthState
  logIn(email: string, password: string): Promise<LoginStep>
  setNewPassword(password: string): Promise<LoginStep>
  logOut(): Promise<void>
  /** Logs the Member out if an API call says the login is no longer valid; true if it did. */
  handleApiError(err: unknown): boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
