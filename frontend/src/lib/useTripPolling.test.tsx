import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trip } from '@/lib/api'
import { useTripPolling } from './useTripPolling'

const getTrip = vi.fn()
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), getTrip: (...a: unknown[]) => getTrip(...a) }))
vi.mock('@/auth/auth-context', () => ({ useAuth: () => ({ handleApiError: () => false }) }))

const trip = (caption: string): Trip => ({
  id: 't1',
  title: 'Roma',
  destination: 'Roma',
  startDate: '2026-01-01',
  endDate: '2026-01-02',
  photoCount: 1,
  thumbnails: [],
  coverPhoto: null,
  photos: [{ id: 'p1', status: 'processing', filename: 'a.jpg', caption }],
})

describe('useTripPolling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    getTrip.mockReset()
  })

  it('applies an answer when nothing changed locally in the meantime', async () => {
    getTrip.mockResolvedValue(trip('fresh'))
    const onTrip = vi.fn()
    renderHook(() => useTripPolling('t1', trip('old'), onTrip, { current: 0 }))
    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(onTrip).toHaveBeenCalledTimes(1)
  })

  it('drops an answer that was requested before a local mutation', async () => {
    let resolve: (t: Trip) => void = () => {}
    getTrip.mockReturnValue(new Promise<Trip>((r) => (resolve = r)))
    const onTrip = vi.fn()
    const mutations = { current: 0 }
    renderHook(() => useTripPolling('t1', trip('old'), onTrip, mutations))
    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(getTrip).toHaveBeenCalledTimes(1)
    mutations.current += 1 // a caption was saved or a Photo deleted while the poll was in flight
    await act(async () => resolve(trip('stale')))
    expect(onTrip).not.toHaveBeenCalled()
  })
})
