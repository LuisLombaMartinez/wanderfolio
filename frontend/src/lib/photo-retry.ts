import { ApiError, type Photo } from '@/lib/api'

/** What the page does with the answer to a retry (MASTER sections 42 and 45). */
export type RetryOutcome = 'started' | 'refresh' | 'gone' | 'trip-gone' | 'auth' | 'error'

/** Sorts a failed retry into what the UI does next. */
export function classifyRetryError(err: unknown): Exclude<RetryOutcome, 'started' | 'auth'> {
  if (err instanceof ApiError) {
    if (err.code === 'photo-not-failed') return 'refresh'
    if (err.code === 'photo-not-found') return 'gone'
    if (err.code === 'trip-not-found') return 'trip-gone'
  }
  return 'error'
}

export interface RetryResult {
  id: string
  outcome: RetryOutcome
  photo?: Photo
}

const PARALLEL_RETRIES = 3

/** "Reintentar todas": one retry per Photo, three at a time; stops asking once the login is gone. */
export async function retryMany(
  ids: readonly string[],
  call: (id: string) => Promise<Photo>,
  isAuthError: (err: unknown) => boolean = () => false,
): Promise<RetryResult[]> {
  const results: RetryResult[] = new Array<RetryResult>(ids.length)
  let next = 0
  let stop = false
  async function worker() {
    while (!stop && next < ids.length) {
      const i = next++
      try {
        results[i] = { id: ids[i], outcome: 'started', photo: await call(ids[i]) }
      } catch (err) {
        if (isAuthError(err)) {
          stop = true
          results[i] = { id: ids[i], outcome: 'auth' }
        } else results[i] = { id: ids[i], outcome: classifyRetryError(err) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_RETRIES, ids.length) }, worker))
  return results.filter(Boolean)
}
