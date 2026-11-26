import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthState } from '@/auth/auth-context'
import type { PendingInvitation } from '@/lib/api'
import { ACCEPT_FAILED } from '@/lib/messages'
import type { TransitionOutcome } from '@/components/Transition'
import { BOOT_TIMEOUT_MS, InvitationGate, RESUME_AFTER_MS } from './InvitationGate'

const api = vi.hoisted(() => ({ list: vi.fn(), accept: vi.fn() }))
const auth = vi.hoisted(() => ({ state: { status: 'loading' } as unknown, handleApiError: vi.fn(() => false) }))

vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  listPendingInvitations: api.list,
  acceptInvitation: api.accept,
}))
vi.mock('@/auth/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/components/BootScreen', () => ({ BootScreen: () => <p>boot</p> }))
vi.mock('@/components/Invitation', () => ({
  Invitation: (p: { question: string; alert?: string; onYes: (o: object) => void }) => (
    <div role="dialog">
      <h1>{p.question}</h1>
      {p.alert && <p role="alert">{p.alert}</p>}
      <button onClick={() => p.onYes({ x: 0, y: 0, w: 1, h: 1 })}>Sí</button>
    </div>
  ),
}))
// The cover plays out at once: it reveals, then reports how it ended, once the outcome is known.
vi.mock('@/components/Transition', () => ({
  Transition: (p: { outcome: Promise<TransitionOutcome>; onReveal: () => void; onDone: (h: TransitionOutcome) => void }) => {
    void p.outcome.then((how) => {
      if (how === 'reveal') p.onReveal()
      p.onDone(how)
    })
    return <p>cover</p>
  },
}))

const { ApiError } = await import('@/lib/api')

const inv = (tripId: string): PendingInvitation => ({
  tripId,
  question: `Pregunta ${tripId}`,
  destination: 'Roma',
  startDate: '2027-01-05',
  endDate: '2027-01-09',
  inviterId: 'ana',
  inviteeId: 'leo',
  status: 'pending',
  createdAt: '2026-11-26T10:00:00Z',
  acceptedAt: null,
})
const signedIn = (id: string): AuthState => ({
  status: 'signed-in',
  member: { id, displayName: id },
})

function setup() {
  const ui = () => (
    <MemoryRouter>
      <InvitationGate>
        <Routes>
          <Route path="*" element={<p>album</p>} />
        </Routes>
      </InvitationGate>
    </MemoryRouter>
  )
  const view = render(ui())
  return { rerender: () => view.rerender(ui()) }
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
/** A request that never answers, but honours its abort signal. */
const hang = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))))

beforeEach(() => {
  vi.useFakeTimers()
  api.list.mockReset()
  api.accept.mockReset()
  auth.handleApiError.mockReset().mockReturnValue(false)
  auth.state = signedIn('leo')
})
afterEach(() => vi.useRealTimers())

describe('InvitationGate', () => {
  it('holds the boot screen, then shows the Invitation before the Album', async () => {
    api.list.mockResolvedValue([inv('t1')])
    setup()
    expect(screen.getByText('boot')).toBeInTheDocument()
    await flush()
    expect(screen.getByRole('dialog')).toHaveTextContent('Pregunta t1')
    expect(document.title).toBe('Una invitación para ti · Viajecito')
  })

  it('fails open after the boot timeout and lets the app through', async () => {
    api.list.mockImplementation((signal: AbortSignal) => hang(signal))
    setup()
    await advance(BOOT_TIMEOUT_MS - 1)
    expect(screen.getByText('boot')).toBeInTheDocument()
    await advance(1)
    expect(screen.getByText('album')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks again when the app returns after 5 minutes hidden, and not before', async () => {
    api.list.mockResolvedValueOnce([])
    setup()
    await flush()
    const visibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    visibility('hidden')
    await advance(RESUME_AFTER_MS - 1000)
    visibility('visible')
    await flush()
    expect(api.list).toHaveBeenCalledTimes(1)

    api.list.mockResolvedValueOnce([inv('t2')])
    visibility('hidden')
    await advance(RESUME_AFTER_MS)
    visibility('visible')
    await flush()
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog')).toHaveTextContent('Pregunta t2')
  })

  it('a hung resume ask times out and does not block the next one', async () => {
    api.list.mockResolvedValueOnce([])
    setup()
    await flush()
    api.list.mockImplementationOnce((signal: AbortSignal) => hang(signal))
    const back = async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await advance(RESUME_AFTER_MS)
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await flush()
    }
    await back()
    await advance(60_000)
    api.list.mockResolvedValueOnce([inv('t3')])
    await back()
    expect(screen.getByRole('dialog')).toHaveTextContent('Pregunta t3')
  })

  it('shrinks back with the message when the accept fails, and "Sí" can be tried again', async () => {
    api.list.mockResolvedValue([inv('t1')])
    api.accept.mockRejectedValueOnce(new ApiError(500, 'internal'))
    setup()
    await flush()
    await act(async () => screen.getByRole('button', { name: 'Sí' }).click())
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(ACCEPT_FAILED)
    expect(screen.getByRole('dialog')).toHaveTextContent('Pregunta t1')
    expect(auth.handleApiError).toHaveBeenCalled()
  })

  it('a refused accept (403 not-the-invitee) reverts without signing out', async () => {
    api.list.mockResolvedValue([inv('t1')])
    api.accept.mockRejectedValueOnce(new ApiError(403, 'not-the-invitee'))
    setup()
    await flush()
    await act(async () => screen.getByRole('button', { name: 'Sí' }).click())
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(ACCEPT_FAILED)
    expect(auth.handleApiError).not.toHaveBeenCalled()
  })

  it('"gone" (a not-found code) skips the Invitation with no error', async () => {
    api.list.mockResolvedValue([inv('t1')])
    api.accept.mockRejectedValueOnce(new ApiError(404, 'trip-not-found'))
    setup()
    await flush()
    await act(async () => screen.getByRole('button', { name: 'Sí' }).click())
    await flush()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('any other 404 is a failure, not "gone"', async () => {
    api.list.mockResolvedValue([inv('t1')])
    api.accept.mockRejectedValueOnce(new ApiError(404, 'not-found'))
    setup()
    await flush()
    await act(async () => screen.getByRole('button', { name: 'Sí' }).click())
    await flush()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('does not bring back a Trip that was gone when a stale ask answers', async () => {
    api.list.mockResolvedValueOnce([inv('t1')])
    api.accept.mockRejectedValueOnce(new ApiError(404, 'invitation-not-found'))
    setup()
    await flush()
    await act(async () => screen.getByRole('button', { name: 'Sí' }).click())
    await flush()
    api.list.mockResolvedValueOnce([inv('t1')])
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await advance(RESUME_AFTER_MS)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('logout clears the Invitation, the alert and the hold: a re-login holds the boot screen again', async () => {
    api.list.mockResolvedValue([inv('t1')])
    api.accept.mockRejectedValueOnce(new ApiError(500, 'internal'))
    const { rerender } = setup()
    await flush()
    await act(async () => screen.getByRole('button', { name: 'Sí' }).click())
    await flush()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    auth.state = { status: 'signed-out' }
    rerender()
    await flush()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // The same Member again: the Album must not show before the answer arrives.
    api.list.mockImplementation((signal: AbortSignal) => hang(signal))
    auth.state = signedIn('leo')
    rerender()
    expect(screen.getByText('boot')).toBeInTheDocument()
    expect(screen.queryByText('album')).not.toBeInTheDocument()
    await flush()
    api.list.mockReset()
  })

  it('another Member logging in does not inherit the last one\'s request', async () => {
    api.list.mockImplementationOnce((signal: AbortSignal) => hang(signal))
    const { rerender } = setup()
    await flush()
    auth.state = signedIn('ana')
    api.list.mockResolvedValueOnce([inv('c1')])
    rerender()
    await flush()
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog')).toHaveTextContent('Pregunta c1')
  })
})
