import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invitation as InvitationData } from '@/lib/api'
import type { TransitionOutcome } from '@/components/Transition'
import { InvitationTakeoverContext } from '@/components/invitation-takeover'
import { ReplayInvitationButton } from './ReplayInvitationButton'

const api = vi.hoisted(() => ({ accept: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), acceptInvitation: api.accept }))
vi.mock('@/components/Invitation', () => ({
  Invitation: (p: { question: string; leaving: boolean; busy?: boolean; alert?: string; onYes: (o: object) => void }) => (
    <div role="dialog" data-leaving={p.leaving}>
      <h1>{p.question}</h1>
      <button onClick={() => p.onYes({ x: 1, y: 1 })}>Sí</button>
    </div>
  ),
}))
const transition = vi.hoisted(() => ({ outcome: null as Promise<TransitionOutcome> | null }))
vi.mock('@/components/Transition', () => ({
  Transition: (p: { outcome: Promise<TransitionOutcome>; onReveal: () => void; onDone: (h: TransitionOutcome) => void }) => {
    transition.outcome = p.outcome
    void p.outcome.then(() => {
      p.onReveal()
      p.onDone('reveal')
    })
    return <p>cover</p>
  },
}))

const invitation = (status: 'pending' | 'accepted'): InvitationData => ({
  tripId: 't1',
  question: '¿Te vienes conmigo a Roma?',
  inviterId: 'leo',
  inviteeId: 'ana',
  status,
  createdAt: '2026-11-01T10:00:00.000Z',
  acceptedAt: status === 'accepted' ? '2026-11-02T10:00:00.000Z' : null,
})
const dates = { destination: 'Roma', startDate: '2027-01-05', endDate: '2027-01-09' }

beforeEach(() => {
  api.accept.mockReset()
  document.title = 'Roma · Viajecito'
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
})
afterEach(() => document.getElementById('root')?.remove())

const mount = (inv: InvitationData | null | undefined, onLanded?: () => void, takeover = false) =>
  render(
    <InvitationTakeoverContext value={takeover}>
      <ReplayInvitationButton {...dates} invitation={inv} onLanded={onLanded} />
    </InvitationTakeoverContext>,
    { container: document.getElementById('root')! },
  )

describe('ReplayInvitationButton', () => {
  it.each([null, undefined, invitation('pending')])('shows nothing without an Accepted Invitation (%j)', (inv) => {
    mount(inv)
    expect(screen.queryByRole('button', { name: 'Ver invitación' })).toBeNull()
  })

  it('opens the Invitation as a layer without any request, and locks the page underneath', () => {
    mount(invitation('accepted'))
    const button = screen.getByRole('button', { name: 'Ver invitación' })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(button)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '¿Te vienes conmigo a Roma?' })).toBeInTheDocument()
    expect(document.getElementById('root')).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.title).toBe('Una invitación para ti · Viajecito')
    expect(api.accept).not.toHaveBeenCalled()
  })

  it('"Sí" plays the transition and records nothing: no accept call, the page comes back and focus returns', async () => {
    const onLanded = vi.fn()
    mount(invitation('accepted'), onLanded)
    const button = screen.getByRole('button', { name: 'Ver invitación' })
    fireEvent.click(button)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sí' }))
    })
    expect(transition.outcome).not.toBeNull()
    await act(async () => void (await transition.outcome))
    expect(api.accept).not.toHaveBeenCalled()
    expect(onLanded).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.getElementById('root')).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).not.toBe('hidden')
    expect(document.title).toBe('Roma · Viajecito')
    expect(button).toHaveFocus()
  })

  it('starts fresh each time it is opened', async () => {
    mount(invitation('accepted'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver invitación' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sí' }))
    })
    await act(async () => void (await transition.outcome))
    fireEvent.click(screen.getByRole('button', { name: 'Ver invitación' }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-leaving', 'false')
  })

  it('gives way at once to a real Pending Invitation taking over', () => {
    const view = mount(invitation('accepted'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver invitación' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    view.rerender(
      <InvitationTakeoverContext value={true}>
        <ReplayInvitationButton {...dates} invitation={invitation('accepted')} />
      </InvitationTakeoverContext>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.getElementById('root')).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
