import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TripCover } from '@/components/TripCover'
import type { CoverPhoto } from '@/lib/api'

vi.mock('@/lib/useMediaSession', () => ({ useMediaSession: () => ({ status: 'ready', retry: () => {} }) }))
vi.mock('@/lib/media', async (orig) => ({ ...(await orig<typeof import('@/lib/media')>()), renewForBrokenImage: () => Promise.resolve(false) }))
const reduced = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/gsap', async (orig) => ({ ...(await orig<typeof import('@/lib/gsap')>()), prefersReducedMotion: () => reduced.on }))
afterEach(() => {
  reduced.on = false
  vi.useRealTimers()
})

const cover = (n: number): CoverPhoto => ({ id: `p${n}`, thumbnailUrl: `/media/t${n}.jpg`, largeUrl: `/media/l${n}.jpg`, chosen: true })
const imgs = () => Array.from(document.querySelectorAll<HTMLImageElement>('[data-cover-img]'))
const srcs = () => imgs().map((i) => i.getAttribute('src'))

describe('TripCover', () => {
  it('shows the placeholder when there is no Cover photo', () => {
    render(<TripCover tripId="t" upcoming={false} cover={null} size="page" />)
    expect(imgs()).toHaveLength(0)
    expect(screen.getByTestId('cover-placeholder')).toBeInTheDocument()
  })

  it('uses the thumbnail on cards and the large version on the page', () => {
    const { unmount } = render(<TripCover tripId="t" upcoming={false} cover={cover(1)} />)
    expect(srcs()).toEqual(['/media/t1.jpg'])
    unmount()
    render(<TripCover tripId="t" upcoming={false} cover={cover(1)} size="page" />)
    expect(srcs()).toEqual(['/media/l1.jpg'])
  })

  it('keeps the old image until the new one has finished fading in, then drops it', () => {
    const { rerender } = render(<TripCover tripId="t" upcoming={false} cover={cover(1)} />)
    fireEvent.load(imgs()[0])
    rerender(<TripCover tripId="t" upcoming={false} cover={cover(2)} />)
    expect(srcs()).toEqual(['/media/t1.jpg', '/media/t2.jpg'])
    fireEvent.load(imgs()[1])
    // The fade has started but not ended: the old image must still be underneath.
    expect(srcs()).toEqual(['/media/t1.jpg', '/media/t2.jpg'])
    fireEvent.transitionEnd(imgs()[1], { propertyName: 'opacity' })
    expect(srcs()).toEqual(['/media/t2.jpg'])
  })

  it('drops the old image after a timeout when no transitionend arrives', () => {
    vi.useFakeTimers()
    const { rerender } = render(<TripCover tripId="t" upcoming={false} cover={cover(1)} />)
    fireEvent.load(imgs()[0])
    rerender(<TripCover tripId="t" upcoming={false} cover={cover(2)} />)
    fireEvent.load(imgs()[1])
    expect(srcs()).toHaveLength(2)
    act(() => void vi.advanceTimersByTime(500))
    expect(srcs()).toEqual(['/media/t2.jpg'])
  })

  it('settles when the Cover photo flips back to one already loaded (A, B, A)', () => {
    vi.useFakeTimers()
    const { rerender } = render(<TripCover tripId="t" upcoming={false} cover={cover(1)} />)
    fireEvent.load(imgs()[0])
    rerender(<TripCover tripId="t" upcoming={false} cover={cover(2)} />)
    fireEvent.load(imgs()[1])
    rerender(<TripCover tripId="t" upcoming={false} cover={cover(1)} />)
    act(() => void vi.advanceTimersByTime(500))
    expect(srcs()).toEqual(['/media/t1.jpg'])
  })

  it('A, B, C before B loads keeps the loaded A under C, not the blank B', () => {
    const { rerender } = render(<TripCover tripId="t" upcoming={false} cover={cover(1)} />)
    fireEvent.load(imgs()[0])
    rerender(<TripCover tripId="t" upcoming={false} cover={cover(2)} />)
    rerender(<TripCover tripId="t" upcoming={false} cover={cover(3)} />)
    expect(srcs()).toEqual(['/media/t1.jpg', '/media/t3.jpg'])
  })

  it('under reduced motion the old image goes as soon as the new one loads', () => {
    reduced.on = true
    const { rerender } = render(<TripCover tripId="t" upcoming={false} cover={cover(1)} />)
    fireEvent.load(imgs()[0])
    rerender(<TripCover tripId="t" upcoming={false} cover={cover(2)} />)
    fireEvent.load(imgs()[1])
    expect(srcs()).toEqual(['/media/t2.jpg'])
  })

  it('a failed image shows the placeholder with the load-failure label', async () => {
    render(<TripCover tripId="t" upcoming={false} cover={cover(1)} size="page" />)
    fireEvent.error(imgs()[0])
    expect(await screen.findByTestId('cover-placeholder')).toHaveTextContent('No hemos podido cargar la portada')
    expect(imgs()).toHaveLength(0)
  })

  it('a failed new image keeps the previous one on screen', async () => {
    const { rerender } = render(<TripCover tripId="t" upcoming={false} cover={cover(1)} />)
    fireEvent.load(imgs()[0])
    rerender(<TripCover tripId="t" upcoming={false} cover={cover(2)} />)
    fireEvent.error(imgs()[1])
    await act(async () => {})
    expect(srcs()).toEqual(['/media/t1.jpg'])
    expect(screen.queryByTestId('cover-placeholder')).toBeNull()
  })

  it('goes back to the placeholder when the Cover photo disappears', () => {
    const { rerender } = render(<TripCover tripId="t" upcoming={false} cover={cover(1)} />)
    rerender(<TripCover tripId="t" upcoming={false} cover={null} />)
    expect(imgs()).toHaveLength(0)
    expect(screen.getByTestId('cover-placeholder')).toBeInTheDocument()
  })
})
