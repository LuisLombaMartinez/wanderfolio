import { describe, expect, it, vi } from 'vitest'
import { ApiError, type Photo } from './api'
import { classifyRetryError, retryMany } from './photo-retry'

describe('classifyRetryError', () => {
  it('maps the API codes to what the UI does', () => {
    expect(classifyRetryError(new ApiError(409, 'photo-not-failed'))).toBe('refresh')
    expect(classifyRetryError(new ApiError(404, 'photo-not-found'))).toBe('gone')
    expect(classifyRetryError(new ApiError(404, 'trip-not-found'))).toBe('trip-gone')
    expect(classifyRetryError(new ApiError(500, 'internal'))).toBe('error')
    expect(classifyRetryError(new TypeError('Failed to fetch'))).toBe('error')
    expect(classifyRetryError(new ApiError(502, 'unknown'))).toBe('error')
  })
})

const photo = (id: string): Photo => ({ id, status: 'processing', filename: `${id}.heic` })

describe('retryMany', () => {
  it('runs three at a time and reports each outcome', async () => {
    let running = 0
    let peak = 0
    const call = vi.fn(async (id: string) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      if (id === 'b') throw new ApiError(500, 'internal')
      if (id === 'c') throw new ApiError(409, 'photo-not-failed')
      return photo(id)
    })
    const results = await retryMany(['a', 'b', 'c', 'd', 'e', 'f', 'g'], call)
    expect(peak).toBe(3)
    expect(call).toHaveBeenCalledTimes(7)
    expect(results.map((r) => [r.id, r.outcome])).toEqual([
      ['a', 'started'], ['b', 'error'], ['c', 'refresh'], ['d', 'started'], ['e', 'started'], ['f', 'started'], ['g', 'started'],
    ])
    expect(results[0].photo).toEqual(photo('a'))
  })
  it('stops asking once an authentication error says the login is gone', async () => {
    const call = vi.fn(() => Promise.reject(new ApiError(401, 'unauthorized')))
    const results = await retryMany(['a', 'b', 'c', 'd'], call, (err) => err instanceof ApiError && err.status === 401)
    expect(results.some((r) => r.outcome === 'auth')).toBe(true)
    expect(call.mock.calls.length).toBeLessThan(4)
  })
})
