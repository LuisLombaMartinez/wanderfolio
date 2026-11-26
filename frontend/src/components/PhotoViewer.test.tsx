import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, useSearchParams } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoViewer } from '@/components/PhotoViewer'
import { PhotoTile } from '@/components/PhotoTile'
import { ApiError, setCoverPhoto, type CoverPhoto, type Photo, type Trip } from '@/lib/api'

vi.mock('@/auth/auth-context', () => ({ useAuth: () => ({ handleApiError: () => false }) }))
vi.mock('@/lib/useMediaSession', () => ({ useMediaSession: () => ({ status: 'ready', retry: () => {} }) }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), deletePhoto: vi.fn().mockResolvedValue(undefined), setCoverPhoto: vi.fn() }))

const photo = (n: number): Photo => ({
  id: `p${n}`,
  status: 'ready',
  filename: `foto-${n}.jpg`,
  takenAt: `2026-08-0${n}T10:00:00Z`,
  thumbnailUrl: `/media/t${n}.jpg`,
  largeUrl: `/media/l${n}.jpg`,
  uploadedBy: 'Leo',
})

const baseTrip: Trip = {
  id: 't1',
  title: 'Verano',
  destination: 'Tenerife',
  startDate: '2026-08-01',
  endDate: '2026-08-09',
  photoCount: 3,
  thumbnails: [],
  coverPhoto: null,
  photos: [photo(1), photo(2), photo(3)],
}

const coverOf = (n: number, chosen: boolean): CoverPhoto => ({ id: `p${n}`, thumbnailUrl: `/media/t${n}.jpg`, largeUrl: `/media/l${n}.jpg`, chosen })

function Host({ first, cover = null, onGone = () => {} }: { first: string; cover?: CoverPhoto | null; onGone?: () => void }) {
  const [trip, setTrip] = useState<Trip>({ ...baseTrip, coverPhoto: cover })
  const [params] = useSearchParams()
  return (
    <>
      <output data-testid="foto">{params.get('foto')}</output>
      <PhotoViewer trip={trip} onTripChange={(change) => setTrip(change)} onTripGone={onGone} />
      <span data-first={first} />
    </>
  )
}

/** Opens the viewer; its fade (reduced motion in jsdom) keeps it hidden for 150 ms, so wait for it to show. */
async function setup(first = 'p2', host: { cover?: CoverPhoto | null; onGone?: () => void } = {}) {
  render(
    <MemoryRouter initialEntries={[`/trips/t1?foto=${first}`]}>
      <Host first={first} {...host} />
    </MemoryRouter>,
  )
  return screen.findByRole('dialog', { name: 'Fotos de «Verano»' })
}

const warn = vi.spyOn(console, 'warn')
beforeEach(() => warn.mockClear())
afterEach(() => vi.useRealTimers())

describe('PhotoViewer', () => {
  it('opens its fade without GSAP warnings (the content exists when the tween runs)', async () => {
    await setup()
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Invalid scope|not found/)
  })

  it('Escape right after the delete dialog opens only closes the delete dialog', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    const alert = await screen.findByRole('alertdialog')
    fireEvent.keyDown(alert, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Fotos de «Verano»' })).toBeInTheDocument()
    expect(screen.getByTestId('foto')).toHaveTextContent('p2')
  })

  it('cancelling the delete dialog returns focus to "Borrar"', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mejor no' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Borrar' })).toHaveFocus())
  })

  it('deleting a Photo announces it and keeps the viewer mounted on the neighbour', async () => {
    const dialog = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, borrarla' }))
    await waitFor(() => expect(screen.getByTestId('foto')).toHaveTextContent('p3'))
    expect(screen.getByRole('dialog', { name: 'Fotos de «Verano»' })).toBe(dialog) // same node: no remount
    await waitFor(() => expect(dialog.querySelector('[aria-live]')?.textContent).toMatch(/Foto borrada/))
  })

  it('Home and End hand focus to the arrow that is still there', async () => {
    const dialog = await setup('p2')
    dialog.focus() // where Radix leaves focus once the arrow is gone
    fireEvent.keyDown(document.body, { key: 'End' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Foto siguiente' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Foto anterior' })).toHaveFocus()
  })
})

describe('Cover photo control', () => {
  const put = vi.mocked(setCoverPhoto)
  beforeEach(() => {
    put.mockReset()
  })
  const chooseButton = () => screen.getByRole('button', { name: 'Usar como portada' })

  it('offers the button on a Photo that is not the cover, and no note or badge', async () => {
    await setup('p2', { cover: coverOf(1, true) })
    expect(chooseButton()).toBeInTheDocument()
    expect(screen.queryByText('Nuestra portada')).toBeNull()
    expect(screen.queryByText('Portada por ser la primera')).toBeNull()
  })

  it('shows the note and still the button on the default cover', async () => {
    await setup('p1', { cover: coverOf(1, false) })
    expect(screen.getByText('Portada por ser la primera')).toBeInTheDocument()
    expect(chooseButton()).toBeInTheDocument()
  })

  it('shows the badge and no button on the chosen cover', async () => {
    await setup('p1', { cover: coverOf(1, true) })
    expect(screen.getByText('Nuestra portada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Usar como portada' })).toBeNull()
  })

  it('shows nothing when the Trip has no cover yet', async () => {
    await setup('p1')
    expect(chooseButton()).toBeInTheDocument()
  })

  it('hides the control while the caption is being edited', async () => {
    await setup('p2')
    fireEvent.click(screen.getByRole('button', { name: 'Añadir una frase' }))
    await screen.findByLabelText('Una frase para esta foto')
    expect(screen.queryByRole('button', { name: 'Usar como portada' })).toBeNull()
  })

  it('chooses the Photo: saving state, then badge with focus, live region and status pill', async () => {
    let resolve!: (t: Trip) => void
    put.mockReturnValue(new Promise<Trip>((r) => (resolve = r)))
    const dialog = await setup('p2', { cover: coverOf(1, false) })
    fireEvent.click(chooseButton())
    expect(put).toHaveBeenCalledWith('t1', 'p2')
    const saving = await screen.findByRole('button', { name: 'Poniéndola de portada…' })
    expect(saving).toHaveAttribute('aria-disabled', 'true')
    resolve({ ...baseTrip, coverPhoto: coverOf(2, true) })
    const badge = await screen.findByText('Nuestra portada')
    expect(screen.queryByRole('button', { name: /portada/ })).toBeNull()
    await waitFor(() => expect(badge).toHaveFocus())
    // One announcement only: the visual pill is hidden from assistive tech, the live region says it.
    const pill = dialog.querySelector('[data-cover-notice]')
    expect(pill).toHaveTextContent('¡Nueva portada! Así nos verá el álbum.')
    expect(pill).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('status')).toBeNull()
    await waitFor(() => expect(dialog.querySelector('[aria-live]')?.textContent).toBe('Ya es la portada del viaje'))
  })

  it('moving on before the choice lands: no badge focus, the Photo is still announced', async () => {
    let resolve!: (t: Trip) => void
    put.mockReturnValue(new Promise<Trip>((r) => (resolve = r)))
    const dialog = await setup('p2', { cover: coverOf(1, false) })
    fireEvent.click(chooseButton())
    await screen.findByRole('button', { name: 'Poniéndola de portada…' })
    fireEvent.click(screen.getByRole('button', { name: 'Foto siguiente' }))
    await waitFor(() => expect(screen.getByTestId('foto')).toHaveTextContent('p3'))
    resolve({ ...baseTrip, coverPhoto: coverOf(2, true) })
    await waitFor(() => expect(dialog.querySelector('[aria-live]')?.textContent).toBe('Ya es la portada del viaje'))
    expect(document.activeElement?.hasAttribute('data-cover-badge')).toBe(false)
    expect(chooseButton()).toBeInTheDocument() // p3 is not the cover
  })

  it('a stale response whose cover is another Photo does not hand focus to a badge', async () => {
    put.mockResolvedValue({ ...baseTrip, coverPhoto: coverOf(3, true) })
    await setup('p2', { cover: coverOf(1, false) })
    fireEvent.click(chooseButton())
    await waitFor(() => expect(put).toHaveBeenCalled())
    await act(async () => {})
    expect(document.querySelector('[data-cover-badge]')).toBeNull()
    expect(chooseButton()).toBeInTheDocument()
  })

  it('after a failure there is no pill and no announcement', async () => {
    put.mockImplementation(async () => { throw new Error('network') })
    const dialog = await setup('p2')
    fireEvent.click(chooseButton())
    await screen.findByRole('alert')
    expect(dialog.querySelector('[data-cover-notice]')).toBeNull()
    expect(dialog.querySelector('[aria-live]')?.textContent).toBe('')
  })

  it('does not call the API twice while saving', async () => {
    put.mockReturnValue(new Promise<Trip>(() => {}))
    await setup('p2')
    fireEvent.click(chooseButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Poniéndola de portada…' }))
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('photo-not-ready: Spanish inline alert, the button is back and keeps focus', async () => {
    put.mockImplementation(async () => { throw new ApiError(409, 'photo-not-ready') })
    await setup('p2')
    fireEvent.click(chooseButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta foto aún se está revelando. Cuando esté lista, la ponemos de portada.')
    expect(chooseButton()).not.toHaveAttribute('aria-disabled')
  })

  it('any other failure: the generic Spanish alert, cleared when moving to another Photo', async () => {
    put.mockImplementation(async () => { throw new Error('network') })
    await setup('p2')
    fireEvent.click(chooseButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('No hemos podido cambiar la portada. ¿Probamos otra vez?')
    fireEvent.click(screen.getByRole('button', { name: 'Foto siguiente' }))
    await waitFor(() => expect(screen.getByTestId('foto')).toHaveTextContent('p3'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('photo-not-found: the Photo leaves the viewer; trip-not-found closes through onTripGone', async () => {
    put.mockImplementationOnce(async () => { throw new ApiError(404, 'photo-not-found') })
    await setup('p2')
    fireEvent.click(chooseButton())
    await waitFor(() => expect(screen.getByTestId('foto')).toHaveTextContent('p3'))

    put.mockImplementationOnce(async () => { throw new ApiError(404, 'trip-not-found') })
    const onGone = vi.fn()
    cleanup()
    await setup('p2', { onGone })
    fireEvent.click(chooseButton())
    await waitFor(() => expect(onGone).toHaveBeenCalled())
  })
})

describe('cover tile marker', () => {
  const tile = (cover?: 'default' | 'chosen') => (
    <PhotoTile
      tile={{ key: 'k', filename: 'a.jpg', gradientId: 'g', state: { kind: 'ready', photo: photo(1) } } as never}
      cover={cover}
      onOpen={() => {}}
      onRetry={() => {}}
      onOpenFailed={() => {}}
    />
  )
  it('names the cover tile "portada del viaje" and marks it; other tiles stay plain', () => {
    const { rerender } = render(tile())
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toMatch(/portada/)
    expect(document.querySelector('[data-cover-marker]')).toBeNull()
    rerender(tile('chosen'))
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/, portada del viaje$/)
    expect(document.querySelector('[data-cover-marker="chosen"]')).not.toBeNull()
    rerender(tile('default'))
    expect(document.querySelector('[data-cover-marker="default"]')).not.toBeNull()
  })
})

describe('failed tile', () => {
  it('its accessible name starts with its visible text (WCAG 2.5.3)', () => {
    render(
      <PhotoTile
        tile={{ key: 'k', filename: 'rota.jpg', gradientId: 'g', state: { kind: 'failed', photo: { id: 'x', status: 'failed', filename: 'rota.jpg' } } }}
        eager={false}
        onOpen={() => {}}
        onRetry={() => {}}
        onOpenFailed={() => {}}
      />,
    )
    const button = screen.getByRole('button', { name: /^Sin revelar/ })
    expect(button).toHaveTextContent('Sin revelar')
  })
})
