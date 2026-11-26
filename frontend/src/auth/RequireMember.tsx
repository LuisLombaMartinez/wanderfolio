import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { BootScreen } from '@/components/BootScreen'
import { useAuth } from './auth-context'

/** Route guard: every page except login needs a logged-in Member. */
export function RequireMember({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === 'loading') return <BootScreen />
  if (state.status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return children
}
