import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invitation } from '@/lib/api'
import { EDIT_FAILED, EDIT_TOO_LATE, INVITATION_MESSAGES, QUESTION_SAVED } from '@/lib/messages'
import { InvitationPanel, type PanelNotice, type PanelRemoval } from './InvitationPanel'

const api = vi.hoisted(() => ({ update: vi.fn(), getTrip: vi.fn(), remove: vi.fn() }))
const auth = vi.hoisted(() => ({ handleApiError: vi.fn(() => false) }))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  updateInvitationQuestion: api.update,
  getTrip: api.getTrip,
  deleteInvitation: api.remove,
}))
vi.mock('@/auth/auth-context', () => ({ useAuth: () => auth }))

const { ApiError } = await import('@/lib/api')

const pending: Invitation = {
  tripId: 't1', question: '¿Te vienes conmigo a Roma?', inviterId: 'leo', inviteeId: 'ana', status: 'pending',
  createdAt: '2026-11-26T10:00:00Z', acceptedAt: null,
}
const accepted: Invitation = { ...pending, status: 'accepted', acceptedAt: new Date(2027, 4, 12, 12).toISOString() }

function setup(initial: Invitation = pending) {
  const spies = {
    onInvitation: vi.fn<(i: Invitation) => void>(),
    onRemoved: vi.fn<(w: PanelRemoval) => void>(),
    onTripGone: vi.fn(),
    onPreview: vi.fn(),
    onNotice: vi.fn<(n: PanelNotice | undefined) => void>(),
  }
  function Host() {
    const [inv, setInv] = useState(initial)
    const [notice, setNotice] = useState<PanelNotice>()
    return (
      <InvitationPanel
        tripId="t1"
        tripTitle="Escapada a Roma"
        invitation={inv}
        notice={notice}
        onNotice={(n) => {
          spies.onNotice(n)
          setNotice(n)
        }}
        onInvitation={(i) => {
          spies.onInvitation(i)
          setInv(i)
        }}
        onRemoved={spies.onRemoved}
        onTripGone={spies.onTripGone}
        onPreview={spies.onPreview}
        acceptedAction={<p>slot-67</p>}
        backdropPicker={<p>slot-63</p>}
      />
    )
  }
  render(<Host />)
  return spies
}

const field = () => screen.getByLabelText('La pregunta')
const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Editar la pregunta' }))
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar pregunta' }))

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset())
  auth.handleApiError.mockReset().mockReturnValue(false)
})

describe('InvitationPanel, Pending', () => {
  it('shows the card, the badge, the quoted question, the hint and the three actions', () => {
    setup()
    expect(screen.getByRole('region', { name: 'Tu invitación' })).toBeInTheDocument()
    expect(screen.getByText('pendiente')).toBeInTheDocument()
    expect(screen.getByText('«¿Te vienes conmigo a Roma?»')).toBeInTheDocument()
    expect(screen.getByText('Aún no ha dicho que sí. El viaje sigue siendo tu secreto.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver cómo queda' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar la pregunta' })).toHaveTextContent('Editar')
    expect(screen.getByRole('button', { name: 'Borrar la invitación' })).toHaveTextContent('Borrar')
    expect(screen.queryByText('slot-67')).toBeNull()
  })

  it('opens the preview from "Ver cómo queda"', () => {
    const { onPreview } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Ver cómo queda' }))
    expect(onPreview).toHaveBeenCalled()
  })
})

describe('editing in place', () => {
  it('opens the editor on the saved question with the counter, the Backdrop slot, and no preview', () => {
    setup()
    edit()
    expect(field()).toHaveValue('¿Te vienes conmigo a Roma?')
    expect(field()).toHaveFocus()
    expect(screen.getByText('26/120')).toBeInTheDocument()
    expect(screen.getByText('slot-63')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver cómo queda' })).toBeNull()
    expect(screen.getByText('pendiente')).toBeInTheDocument()
  })

  it('saves the trimmed, whitespace-collapsed question and says so', async () => {
    api.update.mockResolvedValue({ ...pending, question: '¿Y si nos vamos a Oporto?' })
    const { onInvitation } = setup()
    edit()
    fireEvent.change(field(), { target: { value: '  ¿Y si nos\n\n vamos   a Oporto?  ' } })
    save()
    expect(await screen.findByText(QUESTION_SAVED)).toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith('t1', '¿Y si nos vamos a Oporto?', expect.any(AbortSignal))
    expect(onInvitation).toHaveBeenCalledWith(expect.objectContaining({ question: '¿Y si nos vamos a Oporto?' }))
    expect(screen.getByText('«¿Y si nos vamos a Oporto?»')).toBeInTheDocument()
    expect(screen.queryByLabelText('La pregunta')).toBeNull()
  })

  it('shows "Guardando…" while it waits, and keeps the text read-only', async () => {
    api.update.mockReturnValue(new Promise(() => undefined))
    setup()
    edit()
    fireEvent.change(field(), { target: { value: 'Otra' } })
    save()
    expect(screen.getByRole('button', { name: 'Guardando…' })).toHaveAttribute('aria-disabled', 'true')
    expect(field()).toHaveAttribute('readonly')
  })

  it('sends nothing when the question did not change', () => {
    setup()
    edit()
    fireEvent.change(field(), { target: { value: '  ¿Te vienes conmigo a Roma?  ' } })
    save()
    expect(api.update).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('La pregunta')).toBeNull()
  })

  it('validates like on creation: empty, then live, and too long', () => {
    setup()
    edit()
    fireEvent.change(field(), { target: { value: '   ' } })
    expect(screen.queryByText(INVITATION_MESSAGES['question-required'])).toBeNull()
    save()
    expect(screen.getByText(INVITATION_MESSAGES['question-required'])).toBeInTheDocument()
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(field(), { target: { value: 'a'.repeat(125) } })
    expect(screen.getByText('125/120')).toBeInTheDocument()
    expect(screen.getByText(INVITATION_MESSAGES['question-too-long'])).toBeInTheDocument()
    save()
    expect(api.update).not.toHaveBeenCalled()
  })

  it('shows a server validation code on the field', async () => {
    api.update.mockRejectedValue(new ApiError(422, 'invalid-characters'))
    setup()
    edit()
    fireEvent.change(field(), { target: { value: 'Algo' } })
    save()
    expect(await screen.findByText(/carácter raro/)).toBeInTheDocument()
  })

  it('cancels with the button or Escape, without asking, and drops the draft', () => {
    setup()
    edit()
    fireEvent.change(field(), { target: { value: 'Borrador' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(screen.queryByLabelText('La pregunta')).toBeNull()
    expect(screen.getByText('«¿Te vienes conmigo a Roma?»')).toBeInTheDocument()
    edit()
    expect(field()).toHaveValue('¿Te vienes conmigo a Roma?')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('La pregunta')).toBeNull()
    expect(api.update).not.toHaveBeenCalled()
  })

  it('keeps the editor and the text on a failure, with an alert', async () => {
    api.update.mockRejectedValue(new ApiError(500, 'internal'))
    setup()
    edit()
    fireEvent.change(field(), { target: { value: 'Otra' } })
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent(EDIT_FAILED)
    expect(field()).toHaveValue('Otra')
  })

  it('does not sign the Member out for not-the-inviter, and shows the generic alert', async () => {
    api.update.mockRejectedValue(new ApiError(403, 'not-the-inviter'))
    setup()
    edit()
    fireEvent.change(field(), { target: { value: 'Otra' } })
    save()
    // The real handler ignores action-level 403s (see isSessionFailure); the panel then shows the alert.
    expect(await screen.findByRole('alert')).toHaveTextContent(EDIT_FAILED)
  })

  it('switches to Accepted when the Invitee said yes meanwhile', async () => {
    api.update.mockRejectedValue(new ApiError(409, 'invitation-accepted'))
    api.getTrip.mockResolvedValue({ id: 't1', invitation: accepted })
    const { onInvitation } = setup()
    edit()
    fireEvent.change(field(), { target: { value: 'Otra' } })
    save()
    expect(await screen.findByText(EDIT_TOO_LATE)).toBeInTheDocument()
    expect(onInvitation).toHaveBeenCalledWith(accepted)
    expect(screen.getByText('aceptada el 12 may 2027')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar la pregunta' })).toBeNull()
    expect(screen.queryByLabelText('La pregunta')).toBeNull()
    expect(screen.getByText('«¿Te vienes conmigo a Roma?»')).toBeInTheDocument()
  })

  it('leaves the page when the Invitation is gone, and tells the Trip is gone separately', async () => {
    api.update.mockRejectedValueOnce(new ApiError(404, 'invitation-not-found'))
    const first = setup()
    edit()
    fireEvent.change(field(), { target: { value: 'Otra' } })
    save()
    await waitFor(() => expect(first.onRemoved).toHaveBeenCalledWith('gone'))
  })

  it('reports a vanished Trip', async () => {
    api.update.mockRejectedValue(new ApiError(404, 'trip-not-found'))
    const { onTripGone } = setup()
    edit()
    fireEvent.change(field(), { target: { value: 'Otra' } })
    save()
    await waitFor(() => expect(onTripGone).toHaveBeenCalled())
  })
})

describe('deleting', () => {
  it('asks first, and leaves the page once deleted', async () => {
    api.remove.mockResolvedValue(undefined)
    const { onRemoved } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar la invitación' }))
    expect(screen.getByRole('alertdialog', { name: '¿Cancelamos la sorpresa?' })).toBeInTheDocument()
    expect(api.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrarla' }))
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('deleted'))
  })

  it('switches to Accepted when it was accepted meanwhile', async () => {
    api.remove.mockRejectedValue(new ApiError(409, 'invitation-accepted'))
    api.getTrip.mockResolvedValue({ id: 't1', invitation: accepted })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar la invitación' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrarla' }))
    expect(await screen.findByText('Ya ha dicho que sí, así que esta invitación se queda.')).toBeInTheDocument()
    expect(screen.getByText('aceptada el 12 may 2027')).toBeInTheDocument()
  })
})

describe('Accepted', () => {
  it('shows the status, no controls, and leaves room for "Ver invitación"', () => {
    setup(accepted)
    expect(screen.getByText('aceptada el 12 may 2027')).toBeInTheDocument()
    expect(screen.getByText('Este momento se queda así para siempre.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('slot-67')).toBeInTheDocument()
  })
})
