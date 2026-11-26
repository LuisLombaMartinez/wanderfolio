import { afterEach, describe, expect, it, vi } from 'vitest'

const { createMediaSession } = vi.hoisted(() => ({ createMediaSession: vi.fn() }))
vi.mock('@/lib/api', () => ({ createMediaSession }))

const { getMediaSessionStatus, startMediaSession, stopMediaSession } = await import('./media')

afterEach(() => {
  stopMediaSession()
  createMediaSession.mockReset()
  vi.useRealTimers()
})

describe('media session', () => {
  it('retries about a minute after a failed renewal', async () => {
    vi.useFakeTimers()
    createMediaSession.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(Date.now() + 4 * 3600_000)
    startMediaSession()
    await vi.advanceTimersByTimeAsync(0)
    expect(getMediaSessionStatus()).toBe('failed')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(createMediaSession).toHaveBeenCalledTimes(2)
    expect(getMediaSessionStatus()).toBe('ready')
  })

  it('ignores an answer that arrives after stop', async () => {
    let resolve: (at: number) => void = () => undefined
    createMediaSession.mockReturnValue(new Promise<number>((r) => (resolve = r)))
    startMediaSession()
    stopMediaSession()
    resolve(Date.now() + 4 * 3600_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(getMediaSessionStatus()).toBe('idle')
  })
})
