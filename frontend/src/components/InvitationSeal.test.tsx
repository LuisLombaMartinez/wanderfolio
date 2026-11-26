import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { invitationSealCopy } from '@/lib/invitation'
import { InvitationSeal, InvitationSealNote } from './InvitationSeal'

describe('InvitationSeal', () => {
  it('is a decorative pill with the label; the meaning is in the screen-reader note', () => {
    const { container } = render(
      <>
        <InvitationSeal status="accepted" />
        <InvitationSealNote status="accepted" />
      </>,
    )
    const pill = container.querySelector('[data-seal]')
    expect(pill).toHaveAttribute('aria-hidden', 'true')
    expect(pill).toHaveTextContent('Empezó con un sí')
    expect(screen.getByText('Empezó con una invitación.')).toHaveClass('sr-only')
  })

  it('has its own copy for a Pending one', () => {
    expect(invitationSealCopy('pending')).toEqual({ label: 'Esperando su sí', note: 'Con una invitación esperando su sí.' })
    expect(invitationSealCopy('accepted')).toEqual({ label: 'Empezó con un sí', note: 'Empezó con una invitación.' })
  })
})
