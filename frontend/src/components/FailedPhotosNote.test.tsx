import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FailedPhotosNote } from './FailedPhotosNote'

describe('FailedPhotosNote', () => {
  it('renders nothing with no failed Photos', () => {
    const { container } = render(<FailedPhotosNote count={0} busy={false} leftOver={0} onRetryAll={() => undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('speaks of one Photo and offers "Reintentar"', async () => {
    const onRetryAll = vi.fn()
    render(<FailedPhotosNote count={1} busy={false} leftOver={0} onRetryAll={onRetryAll} />)
    expect(screen.getByRole('status')).toHaveTextContent('1 foto no se ha podido revelar')
    expect(screen.getByText('Tócala para ver qué ha pasado.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetryAll).toHaveBeenCalled()
  })

  it('offers "Reintentar todas" for several', () => {
    render(<FailedPhotosNote count={3} busy={false} leftOver={0} onRetryAll={() => undefined} />)
    expect(screen.getByText('3 fotos no se han podido revelar')).toBeInTheDocument()
    expect(screen.getByText('Toca una para ver qué ha pasado.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar todas' })).toBeInTheDocument()
  })

  it('shows "Reintentando…" as aria-disabled, still focusable, and ignores clicks while the requests are in flight', () => {
    const onRetryAll = vi.fn()
    render(<FailedPhotosNote count={3} busy leftOver={0} onRetryAll={onRetryAll} />)
    const button = screen.getByRole('button', { name: 'Reintentando…' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(onRetryAll).not.toHaveBeenCalled()
  })

  it('says how many could not be retried', () => {
    const { rerender } = render(<FailedPhotosNote count={2} busy={false} leftOver={1} onRetryAll={() => undefined} />)
    expect(screen.getByText('No hemos podido reintentar una. ¿Probamos otra vez?')).toBeInTheDocument()
    rerender(<FailedPhotosNote count={3} busy={false} leftOver={2} onRetryAll={() => undefined} />)
    expect(screen.getByText('No hemos podido reintentar 2. ¿Probamos otra vez?')).toBeInTheDocument()
  })
})
