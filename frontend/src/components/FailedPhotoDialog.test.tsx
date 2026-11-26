import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Photo } from '@/lib/api'
import type { RetryOutcome } from '@/lib/photo-retry'
import { FailedPhotoDialog } from './FailedPhotoDialog'

const photo = (extra: Partial<Photo> = {}): Photo => ({ id: 'p1', status: 'failed', filename: 'IMG_0042.heic', failureReason: 'unreadable-image: UnreadableImage', ...extra })

function setup(props: { photo?: Photo; secondTry?: boolean; onRetry?: (p: Photo) => Promise<RetryOutcome>; onClose?: () => void; onRemove?: (p: Photo) => void } = {}) {
  const onRetry = props.onRetry ?? vi.fn(() => Promise.resolve<RetryOutcome>('started'))
  const onClose = props.onClose ?? vi.fn()
  const onRemove = vi.fn()
  render(<FailedPhotoDialog photo={props.photo ?? photo()} secondTry={props.secondTry ?? false} onRetry={onRetry} onClose={onClose} onRemove={props.onRemove ?? onRemove} />)
  return { onRetry, onClose, onRemove }
}

describe('FailedPhotoDialog', () => {
  it('offers "Quitarla del viaje" as a ghost action that asks the page to remove the Photo', () => {
    const { onRemove, onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Quitarla del viaje' }))
    expect(onRemove).toHaveBeenCalledWith(photo())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('disables "Quitarla del viaje" while retrying', () => {
    setup({ onRetry: vi.fn(() => new Promise<RetryOutcome>(() => undefined)) })
    fireEvent.click(screen.getByRole('button', { name: 'Probar otra vez' }))
    expect(screen.getByRole('button', { name: 'Quitarla del viaje' })).toBeDisabled()
  })

  it('explains an unreadable Photo, with the filename and the upload-again hint, never the raw reason', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Esta foto se nos ha resistido' })).toBeInTheDocument()
    expect(screen.getByText('«IMG_0042.heic»')).toBeInTheDocument()
    expect(screen.getByText(/No hemos sabido abrirla/)).toBeInTheDocument()
    expect(screen.getByText(/mejor la quitamos y la subes de nuevo desde tu galería/)).toBeInTheDocument()
    expect(screen.queryByText(/UnreadableImage/)).toBeNull()
  })

  it('uses the generic reason with no hint for any other failure', () => {
    setup({ photo: photo({ failureReason: 'processing-error: Boom' }) })
    expect(screen.getByText(/Algo se nos ha atascado/)).toBeInTheDocument()
    expect(screen.queryByText(/la quitamos/)).toBeNull()
  })

  it('says it already tried when this device retried it', () => {
    setup({ secondTry: true })
    expect(screen.getByText('Ya lo hemos intentado otra vez y nada. Mejor la quitamos y la vuelves a subir.')).toBeInTheDocument()
  })

  it('puts the initial focus on "Probar otra vez"', async () => {
    setup()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Probar otra vez' })).toHaveFocus())
  })

  it('asks for the retry, and shows "Probando…" with both buttons disabled until it answers', async () => {
    let answer: (o: RetryOutcome) => void = () => undefined
    const { onRetry } = setup({ onRetry: vi.fn(() => new Promise<RetryOutcome>((r) => (answer = r))) })
    fireEvent.click(screen.getByRole('button', { name: 'Probar otra vez' }))
    expect(onRetry).toHaveBeenCalledWith(photo())
    const busy = screen.getByRole('button', { name: 'Probando…' })
    expect(busy).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ahora no' })).toBeDisabled()
    answer('started')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Probando…' })).toBeNull())
  })

  it('shows the alert and re-enables the buttons when the retry fails', async () => {
    setup({ onRetry: vi.fn(() => Promise.resolve<RetryOutcome>('error')) })
    fireEvent.click(screen.getByRole('button', { name: 'Probar otra vez' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No hemos podido volver a intentarlo. ¿Probamos otra vez?')
    expect(screen.getByRole('button', { name: 'Probar otra vez' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ahora no' })).toBeEnabled()
  })

  it('closes with "Ahora no"', async () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on Escape while the retry is in flight', async () => {
    const { onClose } = setup({ onRetry: vi.fn(() => new Promise<RetryOutcome>(() => undefined)) })
    fireEvent.click(screen.getByRole('button', { name: 'Probar otra vez' }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
