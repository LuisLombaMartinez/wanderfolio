import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gsap } from '@/lib/gsap'
import type { Tile } from '@/lib/tiles'
import { PhotoTile } from './PhotoTile'

vi.mock('@/lib/useMediaSession', () => ({ useMediaSession: () => ({ status: 'ready', retry: () => undefined }) }))

const failedTile: Tile = {
  key: 'p1',
  gradientId: 'p1',
  filename: 'IMG_0042.heic',
  state: { kind: 'failed', photo: { id: 'p1', status: 'failed', filename: 'IMG_0042.heic' } },
}

function renderTile(tile: Tile, onOpenFailed = vi.fn()) {
  render(
    <ul>
      <PhotoTile tile={tile} onRetry={() => undefined} onOpenFailed={onOpenFailed} onOpen={() => undefined} />
    </ul>,
  )
  return onOpenFailed
}

describe('PhotoTile, failed', () => {
  it('is a button labelled "Sin revelar" that opens the failed-Photo dialog', async () => {
    const open = renderTile(failedTile)
    const button = screen.getByRole('button', { name: 'Sin revelar: «IMG_0042.heic». Ver opciones' })
    expect(screen.getByText('Sin revelar')).toBeInTheDocument()
    expect(screen.queryByText('No hemos podido revelarla')).toBeNull()
    fireEvent.click(button)
    expect(open).toHaveBeenCalledWith('p1')
  })

  it('a revealing tile is not a button, and can hold focus after a retry', () => {
    renderTile({ ...failedTile, state: { kind: 'revealing' } })
    expect(screen.queryByRole('button')).toBeNull()
    const holder = screen.getByLabelText('Revelando «IMG_0042.heic»')
    expect(holder).toHaveAttribute('tabindex', '-1')
  })
})

describe('PhotoTile, failed: names and motion', () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
    vi.restoreAllMocks()
  })
  const motion = () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('no-preference'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  }
  const inList = (tile: Tile, retryIndex?: number) => (
    <ul>
      <PhotoTile tile={tile} retryIndex={retryIndex} onRetry={() => undefined} onOpenFailed={() => undefined} onOpen={() => undefined} />
    </ul>
  )

  it('shortens a long filename in the accessible name like the dialog does', () => {
    const long = `${'a'.repeat(60)}.heic`
    renderTile({ ...failedTile, filename: long })
    expect(screen.getByRole('button', { name: /^Sin revelar: «a{10,}….*\.heic». Ver opciones$/ })).toBeInTheDocument()
  })

  it('a tile that fails during the session shakes and comes to rest at x = 0 with no transform left', () => {
    motion()
    const spy = vi.spyOn(gsap, 'to')
    const { container, rerender } = render(inList({ ...failedTile, state: { kind: 'revealing' } }))
    act(() => rerender(inList(failedTile)))
    const shake = spy.mock.results.find((_r, i) => (spy.mock.calls[i][1] as gsap.TweenVars).keyframes !== undefined)
    expect(shake).toBeDefined()
    const keyframes = (spy.mock.calls[spy.mock.results.indexOf(shake!)][1] as { keyframes: { x: number[] } }).keyframes.x
    expect(keyframes.at(-1)).toBe(0)
    act(() => {
      ;(shake!.value as gsap.core.Tween).progress(1)
    })
    const li = container.querySelector('li')!
    expect(li.style.transform).toBe('')
  })

  it('staggers the icon cross-fade of a retried tile by its place in "Reintentar todas"', () => {
    motion()
    const spy = vi.spyOn(gsap, 'from')
    const { rerender } = render(inList(failedTile, 3))
    act(() => rerender(inList({ ...failedTile, state: { kind: 'revealing' } }, 3)))
    const icon = spy.mock.calls.find(([target]) => target === '[data-icon]')
    expect(icon?.[1]).toMatchObject({ delay: 0.09 })
  })
})
