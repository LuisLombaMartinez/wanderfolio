import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE_FAILED } from '@/lib/messages'
import { DeleteInvitationDialog, type DeleteOutcome } from './DeleteInvitationDialog'

const api = vi.hoisted(() => ({ remove: vi.fn() }))
const auth = vi.hoisted(() => ({ handleApiError: vi.fn(() => false) }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), deleteInvitation: api.remove }))
vi.mock('@/auth/auth-context', () => ({ useAuth: () => auth }))

const { ApiError } = await import('@/lib/api')

function setup(title = 'Escapada a Roma') {
  const onOpenChange = vi.fn()
  const onDone = vi.fn<(o: DeleteOutcome) => void>()
  render(<DeleteInvitationDialog tripId="t1" tripTitle={title} open onOpenChange={onOpenChange} onDone={onDone} />)
  return { onOpenChange, onDone }
}
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Sí, borrarla' }))

beforeEach(() => {
  api.remove.mockReset()
  auth.handleApiError.mockReset().mockReturnValue(false)
})

describe('DeleteInvitationDialog', () => {
  it('asks "¿Cancelamos la sorpresa?", says what the Invitee will see, and focuses "Mejor no"', () => {
    setup()
    expect(screen.getByRole('alertdialog', { name: '¿Cancelamos la sorpresa?' })).toBeInTheDocument()
    expect(screen.getByText(/«Escapada a Roma» aparecerá en su álbum como cualquier otro viaje\. No hay vuelta atrás\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mejor no' })).toHaveFocus()
  })

  it('shortens a long title after 60 characters', () => {
    setup('x'.repeat(70))
    expect(screen.getByText(new RegExp(`«${'x'.repeat(60)}…»`))).toBeInTheDocument()
  })

  it('deletes, then reports "deleted"', async () => {
    api.remove.mockResolvedValue(undefined)
    const { onDone } = setup()
    confirm()
    expect(screen.getByRole('button', { name: 'Borrando…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mejor no' })).toBeDisabled()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('deleted'))
    expect(api.remove).toHaveBeenCalledWith('t1', expect.any(AbortSignal))
  })

  it('treats "already gone" as deleted', async () => {
    api.remove.mockRejectedValue(new ApiError(404, 'invitation-not-found'))
    const { onDone } = setup()
    confirm()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('deleted'))
  })

  it('reports "accepted" when the Invitee said yes meanwhile', async () => {
    api.remove.mockRejectedValue(new ApiError(409, 'invitation-accepted'))
    const { onDone } = setup()
    confirm()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('accepted'))
  })

  it('reports "trip-gone" when the Trip is not there any more', async () => {
    api.remove.mockRejectedValue(new ApiError(404, 'trip-not-found'))
    const { onDone } = setup()
    confirm()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('trip-gone'))
  })

  it('stays open with an inline alert on a failure, and a retry is possible', async () => {
    api.remove.mockRejectedValueOnce(new ApiError(500, 'internal'))
    const { onDone } = setup()
    confirm()
    expect(await screen.findByRole('alert')).toHaveTextContent(DELETE_FAILED)
    expect(onDone).not.toHaveBeenCalled()
    api.remove.mockResolvedValue(undefined)
    confirm()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('deleted'))
  })

  it('does not sign the Member out for not-the-inviter, and shows the generic alert', async () => {
    api.remove.mockRejectedValue(new ApiError(403, 'not-the-inviter'))
    setup()
    confirm()
    expect(await screen.findByRole('alert')).toHaveTextContent(DELETE_FAILED)
  })

  it('hands a session error to the login handling and shows nothing', async () => {
    auth.handleApiError.mockReturnValue(true)
    api.remove.mockRejectedValue(new ApiError(401, 'unauthorized'))
    const { onDone } = setup()
    confirm()
    await waitFor(() => expect(auth.handleApiError).toHaveBeenCalled())
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
