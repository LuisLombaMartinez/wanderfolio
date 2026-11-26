import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TransitionOutcome } from '@/components/Transition'
import { InvitationPreview } from './InvitationPreview'

// The cover plays out at once, so the test sees what happens when it reveals and finishes.
vi.mock('@/components/Transition', () => ({
  Transition: (p: { outcome: Promise<TransitionOutcome>; onReveal: () => void; onDone: (h: TransitionOutcome) => void }) => {
    void p.outcome.then((how) => {
      p.onReveal()
      p.onDone(how)
    })
    return <p>cover</p>
  },
}))

function setup(open = true) {
  const onClose = vi.fn()
  const onFinished = vi.fn()
  const ui = (o: boolean) => (
    <InvitationPreview open={o} question="¿Te vienes a Roma?" destination="Roma" startDate="2027-01-05" endDate="2027-01-09" onClose={onClose} onFinished={onFinished} />
  )
  const view = render(ui(open))
  return { onClose, onFinished, rerender: (o: boolean) => view.rerender(ui(o)) }
}

describe('InvitationPreview', () => {
  it('shows the real Invitation with the "Vista previa" ribbon and "Salir"', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: '¿Te vienes a Roma?' })
    expect(dialog).toHaveAccessibleDescription(/Vista previa · Tu sí aquí no cuenta/)
    expect(screen.getByRole('button', { name: 'Sí' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument()
  })

  it('has its own tab title and gives the old one back', () => {
    document.title = 'Roma · Viajecito'
    const { rerender } = setup()
    expect(document.title).toBe('Vista previa · Viajecito')
    rerender(false)
    expect(document.title).toBe('Roma · Viajecito')
  })

  it('leaves with "Salir" and with Escape', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Tab inside: Shift+Tab from "Sí" wraps to "Salir" and Tab comes back (the full ring is in e2e)', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Salir' })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Sí' })).toHaveFocus()
  })

  it('"Sí" plays the transition, closes over the page and records nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { onClose, onFinished } = setup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sí' }))
    })
    expect(onClose).toHaveBeenCalled()
    expect(onFinished).toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('renders nothing while closed', () => {
    setup(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
