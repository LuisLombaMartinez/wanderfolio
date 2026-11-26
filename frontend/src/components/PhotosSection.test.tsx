import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type Photo, type Trip } from '@/lib/api'
import { gsap } from '@/lib/gsap'

const { retryPhoto, deletePhoto } = vi.hoisted(() => ({ retryPhoto: vi.fn(), deletePhoto: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), retryPhoto, deletePhoto }))
vi.mock('@/auth/auth-context', () => ({ useAuth: () => ({ handleApiError: () => false }) }))
vi.mock('@/lib/useMediaSession', () => ({ useMediaSession: () => ({ status: 'ready', retry: () => undefined }) }))

const { PhotosSection } = await import('./PhotosSection')
const { resetUploadsForTests } = await import('@/lib/upload-store')

const failed = (id: string, extra: Partial<Photo> = {}): Photo => ({ id, status: 'failed', filename: `${id}.heic`, failureReason: 'unreadable-image: UnreadableImage', ...extra })
const ready = (id: string): Photo => ({ id, status: 'ready', filename: `${id}.jpg`, thumbnailUrl: `/media/t/${id}/thumb.webp`, takenAt: '2027-05-01T10:00:00Z' })
const tripWith = (photos: Photo[]): Trip => ({
  id: 't1',
  title: 'Oporto',
  destination: 'Lisboa',
  startDate: '2027-04-28',
  endDate: '2027-05-07',
  photoCount: photos.filter((p) => p.status === 'ready').length,
  thumbnails: [],
  coverPhoto: null,
  photos,
})

function setup(photos: Photo[]) {
  const actions = { onPhoto: vi.fn(), onPhotoGone: vi.fn(), onTripChange: vi.fn(), onTripGone: vi.fn(), refresh: vi.fn(() => Promise.resolve()) }
  const utils = render(
    <MemoryRouter>
      <PhotosSection trip={tripWith(photos)} upcoming={false} connectionLost={false} actions={actions} />
    </MemoryRouter>,
  )
  const again = (next: Photo[]) =>
    utils.rerender(
      <MemoryRouter>
        <PhotosSection trip={tripWith(next)} upcoming={false} connectionLost={false} actions={actions} />
      </MemoryRouter>,
    )
  return { actions, again }
}

/** Like `setup`, but a retried Photo really replaces the old one, as the Trip page does. */
function setupLive(initial: Photo[]) {
  const actions = { onPhoto: vi.fn(), onPhotoGone: vi.fn(), onTripChange: vi.fn(), onTripGone: vi.fn(), refresh: vi.fn(() => Promise.resolve()) }
  function Harness() {
    const [photos, setPhotos] = useState(initial)
    const live = {
      ...actions,
      onPhoto: (p: Photo) => {
        actions.onPhoto(p)
        setPhotos((all) => all.map((x) => (x.id === p.id ? p : x)))
      },
      onTripChange: (update: (t: Trip) => Trip) => {
        actions.onTripChange(update)
        setPhotos((all) => update(tripWith(all)).photos ?? [])
      },
    }
    return (
      <MemoryRouter>
        <PhotosSection trip={tripWith(photos)} upcoming={false} connectionLost={false} actions={live} />
      </MemoryRouter>
    )
  }
  render(<Harness />)
  return { actions }
}

const tileButton = (filename: string) => screen.getByRole('button', { name: `Sin revelar: «${filename}». Ver opciones` })

beforeEach(() => {
  resetUploadsForTests()
  retryPhoto.mockReset()
  deletePhoto.mockReset()
})

describe('PhotosSection with a Cover photo and failed Photos', () => {
  it('marks only the cover tile; the failed tile keeps its own name and no marker', () => {
    const trip = { ...tripWith([ready('a'), failed('b')]), coverPhoto: { id: 'a', thumbnailUrl: '/media/t/a/thumb.webp', largeUrl: '/media/t/a/large.webp', chosen: true } }
    render(
      <MemoryRouter>
        <PhotosSection trip={trip} upcoming={false} connectionLost={false} actions={{ onPhoto: vi.fn(), onPhotoGone: vi.fn(), onTripChange: vi.fn(), onTripGone: vi.fn(), refresh: vi.fn(() => Promise.resolve()) }} />
      </MemoryRouter>,
    )
    const markers = document.querySelectorAll('[data-cover-marker]')
    expect(markers).toHaveLength(1)
    expect(markers[0].closest('[data-tile-photo-id]')?.getAttribute('data-tile-photo-id')).toBe('a')
    expect(markers[0].getAttribute('data-cover-marker')).toBe('chosen')
    expect(tileButton('b.heic')).toBeInTheDocument()
  })
})

describe('PhotosSection with failed Photos', () => {
  it('counts them in the header and shows the note, without announcing Photos already failed on load', () => {
    setup([ready('a'), failed('b'), failed('c')])
    expect(screen.getByText('1 foto · 2 sin revelar')).toBeInTheDocument()
    expect(screen.getByText('2 fotos no se han podido revelar')).toBeInTheDocument()
    expect(screen.getAllByRole('status').every((s) => s.textContent !== 'No hemos podido revelar «b.heic».')).toBe(true)
  })

  it('opens the dialog from a failed tile and retries: the Photo is swapped in, the dialog closes, it says so', async () => {
    retryPhoto.mockResolvedValue({ id: 'b', status: 'processing', filename: 'b.heic' })
    const { actions } = setup([failed('b')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Probar otra vez' }))
    await waitFor(() => expect(actions.onPhoto).toHaveBeenCalledWith({ id: 'b', status: 'processing', filename: 'b.heic' }))
    expect(retryPhoto).toHaveBeenCalledWith('t1', 'b')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Volvemos a revelarla')).toBeInTheDocument()
  })

  it('on 409 refetches the Trip silently', async () => {
    retryPhoto.mockRejectedValue(new ApiError(409, 'photo-not-failed'))
    const { actions } = setup([failed('b')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Probar otra vez' }))
    await waitFor(() => expect(actions.refresh).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('on 404 photo-not-found removes the Photo and says it was not in the album', async () => {
    retryPhoto.mockRejectedValue(new ApiError(404, 'photo-not-found'))
    const { actions } = setup([failed('b')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Probar otra vez' }))
    await waitFor(() => expect(actions.onPhotoGone).toHaveBeenCalledWith('b'))
    expect(screen.getByText('Esta foto ya no estaba en el álbum.')).toBeInTheDocument()
  })

  it('on 404 trip-not-found hands over to the Trip page', async () => {
    retryPhoto.mockRejectedValue(new ApiError(404, 'trip-not-found'))
    const { actions } = setup([failed('b')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Probar otra vez' }))
    await waitFor(() => expect(actions.onTripGone).toHaveBeenCalled())
  })

  it('on a server error keeps the dialog open with the alert', async () => {
    retryPhoto.mockRejectedValue(new ApiError(500, 'internal'))
    setup([failed('b')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Probar otra vez' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No hemos podido volver a intentarlo')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('"Reintentar todas" retries each failed Photo and reports the ones that did not go', async () => {
    retryPhoto.mockImplementation((_t: string, id: string) =>
      id === 'c' ? Promise.reject(new ApiError(500, 'internal')) : Promise.resolve({ id, status: 'processing', filename: `${id}.heic` }),
    )
    const { actions } = setup([failed('b'), failed('c'), failed('d')])
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar todas' }))
    await waitFor(() => expect(actions.onPhoto).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No hemos podido reintentar una. ¿Probamos otra vez?')).toBeInTheDocument()
    expect(screen.getByText('Volvemos a revelar 2 fotos')).toBeInTheDocument()
  })

  it('announces a Photo that turns failed while the page is open, and "tampoco" after a retry', async () => {
    const { again } = setup([{ id: 'b', status: 'processing', filename: 'b.heic' }])
    act(() => again([failed('b')]))
    expect(await screen.findByText('No hemos podido revelar «b.heic».')).toBeInTheDocument()
  })

  it('closes the dialog when the Photo is retried elsewhere', async () => {
    const { again } = setup([failed('b')])
    fireEvent.click(tileButton('b.heic'))
    await screen.findByRole('dialog')
    act(() => again([{ id: 'b', status: 'processing', filename: 'b.heic' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Ya se está revelando otra vez.')).toBeInTheDocument()
  })
})

describe('PhotosSection removing a failed Photo (MASTER section 43)', () => {
  it('"Quitarla del viaje" closes the dialog and opens the delete alertdialog, never both', async () => {
    setup([failed('b')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Quitarla del viaje' }))
    expect(await screen.findByRole('alertdialog', { name: '¿Quitamos esta foto?' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Esta foto se nos ha resistido' })).toBeNull())
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mejor no' })).toHaveFocus())
  })

  it('"Mejor no" returns focus to the failed tile', async () => {
    setup([failed('b')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Quitarla del viaje' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mejor no' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(tileButton('b.heic')).toHaveFocus())
  })

  it('closes the delete dialog and says so when the Photo is retried elsewhere', async () => {
    const { again } = setup([failed('b'), failed('c')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Quitarla del viaje' }))
    await screen.findByRole('alertdialog')
    act(() => again([{ id: 'b', status: 'processing', filename: 'b.heic' }, failed('c')]))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByText('Ya se está revelando otra vez.')).toBeInTheDocument()
  })

  it('closes the delete dialog and focuses the neighbour when the Photo is gone', async () => {
    const { again } = setup([failed('b'), failed('c')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Quitarla del viaje' }))
    await screen.findByRole('alertdialog')
    act(() => again([failed('c')]))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(tileButton('c.heic')).toHaveFocus())
  })

  it('"Sí, quitarla" deletes it, announces it and focuses the next tile', async () => {
    deletePhoto.mockResolvedValue(undefined)
    const { actions } = setupLive([failed('b'), failed('c')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Quitarla del viaje' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, quitarla' }))
    await waitFor(() => expect(deletePhoto).toHaveBeenCalled())
    await waitFor(() => expect(actions.onTripChange).toHaveBeenCalled())
    expect(screen.getByText('Foto borrada')).toBeInTheDocument()
    await waitFor(() => expect(tileButton('c.heic')).toHaveFocus())
  })
})

describe('PhotosSection focus', () => {
  it('"Reintentar todas" keeps focus on the button while it runs, then moves it to the first retried tile', async () => {
    const releases: (() => void)[] = []
    retryPhoto.mockImplementation(
      (_t: string, id: string) => new Promise((resolve) => releases.push(() => resolve({ id, status: 'processing', filename: `${id}.heic` }))),
    )
    const { actions } = setupLive([failed('b'), failed('c')])
    const button = screen.getByRole('button', { name: 'Reintentar todas' })
    button.focus()
    fireEvent.click(button)
    const busy = await screen.findByRole('button', { name: 'Reintentando…' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).not.toBeDisabled()
    expect(document.activeElement).toBe(busy)
    fireEvent.click(busy)
    expect(retryPhoto).toHaveBeenCalledTimes(2) // a click while busy does nothing
    releases.forEach((release) => release())
    await waitFor(() => expect(actions.onPhoto).toHaveBeenCalled())
    await waitFor(() => expect(document.querySelector('[data-tile-photo-id="b"] [data-revealing]')).toBe(document.activeElement))
    expect(screen.queryByText(/no se han podido revelar/)).toBeNull() // the note is gone, focus did not fall to the page
  })

  it('"Reintentar todas" leaves focus alone when the Member tabbed elsewhere meanwhile', async () => {
    const releases: (() => void)[] = []
    retryPhoto.mockImplementation(
      (_t: string, id: string) => new Promise((resolve) => releases.push(() => resolve({ id, status: 'processing', filename: `${id}.heic` }))),
    )
    const { actions } = setupLive([failed('b'), failed('c')])
    const button = screen.getByRole('button', { name: 'Reintentar todas' })
    button.focus()
    fireEvent.click(button)
    await screen.findByRole('button', { name: 'Reintentando…' })
    const elsewhere = screen.getByRole('button', { name: 'Subir fotos' })
    elsewhere.focus()
    releases.forEach((release) => release())
    await waitFor(() => expect(actions.onPhoto).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/no se han podido revelar/)).toBeNull())
    expect(document.activeElement).toBe(elsewhere)
  })

  it('returns focus to the tile when the dialog closes', async () => {
    setup([failed('b')])
    fireEvent.click(tileButton('b.heic'))
    fireEvent.click(await screen.findByRole('button', { name: 'Ahora no' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(tileButton('b.heic')))
  })

  it('still announces the Photos that started when "Reintentar todas" finds the Trip gone', async () => {
    retryPhoto.mockImplementation((_t: string, id: string) =>
      id === 'c' ? Promise.reject(new ApiError(404, 'trip-not-found')) : Promise.resolve({ id, status: 'processing', filename: `${id}.heic` }),
    )
    const { actions } = setup([failed('b'), failed('c')])
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar todas' }))
    await waitFor(() => expect(actions.onTripGone).toHaveBeenCalled())
    expect(screen.getByText('Volvemos a revelarla')).toBeInTheDocument()
  })
})

describe('PhotosSection reorder animation', () => {
  const photo = (id: string, takenAt: string): Photo => ({ ...ready(id), takenAt })
  const original = window.matchMedia
  const offsets = [
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft'),
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop'),
  ]
  const slot = (el: HTMLElement) => (el.parentElement ? [...el.parentElement.children].indexOf(el) : 0)

  beforeEach(() => {
    // jsdom has no layout: put the tiles on a 3-column grid by their place in the list.
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get(this: HTMLElement) { return (slot(this) % 3) * 100 } })
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get(this: HTMLElement) { return Math.floor(slot(this) / 3) * 100 } })
  })
  afterEach(() => {
    window.matchMedia = original
    if (offsets[0]) Object.defineProperty(HTMLElement.prototype, 'offsetLeft', offsets[0])
    if (offsets[1]) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsets[1])
    vi.restoreAllMocks()
  })
  const motion = (reduce: boolean) => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('no-preference') ? !reduce : reduce, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  }
  const flips = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter(([target]: unknown[]) => target instanceof HTMLElement && target.dataset.tileKey !== undefined)

  it('tweens the tiles that moved when the date-taken order changes', () => {
    motion(false)
    const { again } = setup([photo('a', '2027-04-29T10:00:00Z'), photo('b', '2027-04-30T10:00:00Z'), photo('c', '2027-05-01T10:00:00Z')])
    const spy = vi.spyOn(gsap, 'fromTo')
    act(() => again([photo('c', '2027-04-29T10:00:00Z'), photo('b', '2027-04-30T10:00:00Z'), photo('a', '2027-05-01T10:00:00Z')]))
    const moved = flips(spy).map(([target]: unknown[]) => (target as HTMLElement).dataset.tileKey)
    expect(moved.sort()).toEqual(['a', 'c'])
    expect(flips(spy)[0][2]).toMatchObject({ x: 0, y: 0 })
  })

  it('does not tween when the order stays the same', () => {
    motion(false)
    const { again } = setup([photo('a', '2027-04-29T10:00:00Z'), photo('b', '2027-04-30T10:00:00Z')])
    const spy = vi.spyOn(gsap, 'fromTo')
    act(() => again([photo('a', '2027-04-29T10:00:00Z'), photo('b', '2027-04-30T10:00:00Z')]))
    expect(flips(spy)).toHaveLength(0)
  })

  it('does not tween under reduced motion', () => {
    motion(true)
    const { again } = setup([photo('a', '2027-04-29T10:00:00Z'), photo('b', '2027-04-30T10:00:00Z')])
    const spy = vi.spyOn(gsap, 'fromTo')
    act(() => again([photo('b', '2027-04-30T10:00:00Z'), photo('a', '2027-04-29T10:00:00Z')]))
    expect(flips(spy)).toHaveLength(0)
  })
})
