import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Invitation } from '@/lib/api'
import { formatLocalDay } from '@/lib/dates'
import { InvitationStatusBadge } from './InvitationStatusBadge'

const base: Invitation = {
  tripId: 't', question: '¿Vamos?', inviterId: 'a', inviteeId: 'b', status: 'pending', createdAt: '2026-11-26T10:00:00Z', acceptedAt: null,
}

describe('InvitationStatusBadge', () => {
  it('says "pendiente" while Pending, with a hidden prefix for screen readers', () => {
    render(<InvitationStatusBadge invitation={base} />)
    expect(screen.getByText('pendiente')).toBeInTheDocument()
    expect(screen.getByText('Estado de la invitación:')).toHaveClass('sr-only')
  })

  it('says "aceptada el {fecha}" in the viewer\'s local day once Accepted, never the time', () => {
    const acceptedAt = new Date(2027, 4, 12, 23, 59).toISOString()
    render(<InvitationStatusBadge invitation={{ ...base, status: 'accepted', acceptedAt }} />)
    expect(screen.getByText(`aceptada el ${formatLocalDay(acceptedAt)}`)).toBeInTheDocument()
    expect(screen.getByText('aceptada el 12 may 2027')).toBeInTheDocument()
  })

  it('never wraps', () => {
    render(<InvitationStatusBadge invitation={base} />)
    expect(screen.getByText('pendiente').parentElement).toHaveClass('whitespace-nowrap')
  })
})
