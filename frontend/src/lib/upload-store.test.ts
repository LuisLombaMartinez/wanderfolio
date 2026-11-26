import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'

const { requestUploadLinks } = vi.hoisted(() => ({ requestUploadLinks: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('./api')>()), requestUploadLinks }))

const { barModel, cancelAll, getUploadState, noteRetried, pickFiles, resetUploadsForTests, retryUpload, SEND_TIMEOUT_MS } = await import('./upload-store')

class FakeXhr {
  static all: FakeXhr[] = []
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
  onload?: () => void
  onerror?: () => void
  onabort?: () => void
  ontimeout?: () => void
  timeout = 0
  aborted = false
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  status = 0
  body?: FormData
  url = ''
  open(_m: string, url: string) {
    this.url = url
  }
  send(body: FormData) {
    this.body = body
    FakeXhr.all.push(this)
  }
  finish(status: number) {
    this.status = status
    this.onload?.()
  }
}
vi.stubGlobal('XMLHttpRequest', FakeXhr)

const jpg = (name: string, size = 100) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' })
const link = (n: number) => ({ filename: `f${n}.jpg`, photoId: `p${n}`, upload: { url: `http://s3/${n}`, fields: { key: `k${n}`, 'Content-Type': 'image/jpeg' } } })
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  resetUploadsForTests()
  FakeXhr.all = []
  requestUploadLinks.mockReset()
})

describe('upload store', () => {
  it('refuses bad files in the browser without asking the API, with the API codes', () => {
    pickFiles('t', 'Trip', [new File(['x'], 'a.mov', { type: 'video/quicktime' }), new File([], 'b.jpg', { type: 'image/jpeg' })])
    expect(requestUploadLinks).not.toHaveBeenCalled()
    expect(getUploadState().refusals.t.items.map((r) => r.code)).toEqual(['unsupported-file-type', 'empty-file'])
    expect(getUploadState().uploads).toHaveLength(0)
  })

  it('sends 3 at a time, file last, and marks files sent', async () => {
    requestUploadLinks.mockResolvedValue([1, 2, 3, 4].map(link))
    pickFiles('t', 'Trip', [1, 2, 3, 4].map((n) => jpg(`f${n}.jpg`)))
    await flush()
    expect(FakeXhr.all).toHaveLength(3)
    const keys = [...FakeXhr.all[0].body!.keys()]
    expect(keys).toEqual(['key', 'Content-Type', 'file'])
    FakeXhr.all[0].finish(204)
    expect(FakeXhr.all).toHaveLength(4)
    FakeXhr.all.slice(1).forEach((x) => x.finish(204))
    expect(getUploadState().uploads.every((u) => u.status === 'sent' && u.file === undefined)).toBe(true)
    expect(barModel(getUploadState())?.phase).toBe('done')
  })

  it('splits a big pick into batches of 50', async () => {
    requestUploadLinks.mockImplementation((_t: string, files: unknown[]) => Promise.resolve(files.map((_, i) => link(i))))
    pickFiles('t', 'Trip', Array.from({ length: 120 }, (_, i) => jpg(`f${i}.jpg`)))
    await flush()
    expect(requestUploadLinks.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([50, 50, 20])
  })

  it('adds the files the API refuses to the refusals, without a tile', async () => {
    requestUploadLinks.mockResolvedValue([link(1), { filename: 'f2.jpg', error: { code: 'file-too-large', message: 'x' } }])
    pickFiles('t', 'Trip', [jpg('f1.jpg'), jpg('f2.jpg')])
    await flush()
    expect(getUploadState().uploads).toHaveLength(1)
    expect(getUploadState().refusals.t.items).toEqual([{ filename: 'f2.jpg', code: 'file-too-large' }])
  })

  it('keeps tiles queued with a retry banner when links fail, and drops them when the Trip is gone', async () => {
    requestUploadLinks.mockRejectedValueOnce(new ApiError(500, 'internal'))
    pickFiles('t', 'Trip', [jpg('a.jpg')])
    await flush()
    expect(getUploadState().banners.t?.kind).toBe('links')
    expect(getUploadState().uploads[0].status).toBe('queued')

    requestUploadLinks.mockRejectedValueOnce(new ApiError(404, 'trip-not-found'))
    pickFiles('t', 'Trip', [jpg('b.jpg')])
    await flush()
    expect(getUploadState().banners.t?.kind).toBe('trip-gone')
    expect(getUploadState().uploads.map((u) => u.filename)).toEqual(['a.jpg'])
  })

  it('retries a failed upload with the same link while it is fresh', async () => {
    requestUploadLinks.mockResolvedValue([link(1)])
    pickFiles('t', 'Trip', [jpg('f1.jpg')])
    await flush()
    FakeXhr.all[0].finish(500)
    const u = getUploadState().uploads[0]
    expect(u.status).toBe('failed')
    expect(barModel(getUploadState())?.phase).toBe('partial')
    retryUpload(u.localId)
    expect(FakeXhr.all).toHaveLength(2)
    expect(requestUploadLinks).toHaveBeenCalledTimes(1)
  })

  it('asks for a fresh link when the old one is stale, keeping the tile and hiding the old record', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    requestUploadLinks.mockResolvedValueOnce([link(1)]).mockResolvedValueOnce([link(2)])
    pickFiles('t', 'Trip', [jpg('f1.jpg')])
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(1))
    FakeXhr.all[0].finish(500)
    const { localId } = getUploadState().uploads[0]
    vi.setSystemTime(Date.now() + 15 * 60 * 1000)
    retryUpload(localId)
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(2))
    const after = getUploadState()
    expect(after.uploads[0].localId).toBe(localId)
    expect(after.uploads[0].photoId).toBe('p2')
    expect(after.abandoned).toEqual(['p1'])
    vi.useRealTimers()
  })

  it('asks for a new link when a queued file waited past the reuse limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    requestUploadLinks
      .mockResolvedValueOnce([1, 2, 3, 4].map(link))
      .mockResolvedValueOnce([link(5)])
    pickFiles('t', 'Trip', [1, 2, 3, 4].map((n) => jpg(`f${n}.jpg`)))
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(3))
    vi.setSystemTime(Date.now() + 15 * 60 * 1000)
    FakeXhr.all[0].finish(204) // frees a slot; the 4th file's link is now old
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(4))
    expect(requestUploadLinks).toHaveBeenCalledTimes(2)
    expect(getUploadState().abandoned).toEqual(['p4'])
    vi.useRealTimers()
  })

  it('cancelAll aborts the sends, empties the store and does not mark anything failed', async () => {
    requestUploadLinks.mockResolvedValue([1, 2].map(link))
    pickFiles('t', 'Trip', [jpg('f1.jpg'), jpg('f2.jpg')])
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(2))
    cancelAll()
    expect(FakeXhr.all.every((x) => x.aborted)).toBe(true)
    expect(getUploadState().uploads).toEqual([])
    expect(barModel(getUploadState())).toBeNull()
  })

  it('cancelAll drops a link answer that arrives after it', async () => {
    let answer: (v: unknown) => void = () => undefined
    requestUploadLinks.mockReturnValue(new Promise((r) => (answer = r)))
    pickFiles('t', 'Trip', [jpg('f1.jpg')])
    cancelAll()
    answer([link(1)])
    await flush()
    expect(getUploadState().uploads).toEqual([])
    expect(FakeXhr.all).toHaveLength(0)
  })

  it('gives every send a timeout, and a timed-out file fails and frees its slot', async () => {
    requestUploadLinks.mockResolvedValue([1, 2, 3, 4].map(link))
    pickFiles('t', 'Trip', [1, 2, 3, 4].map((n) => jpg(`f${n}.jpg`)))
    await vi.waitFor(() => expect(FakeXhr.all).toHaveLength(3))
    expect(FakeXhr.all[0].timeout).toBe(SEND_TIMEOUT_MS)
    FakeXhr.all[0].ontimeout?.()
    expect(getUploadState().uploads[0].status).toBe('failed')
    expect(FakeXhr.all).toHaveLength(4)
  })

  it('sends a HEIC file picked with no type as an empty content type, so the API reads the extension', async () => {
    requestUploadLinks.mockResolvedValue([link(1), link(2), link(3)])
    pickFiles('t', 'Trip', [
      new File([new Uint8Array(10)], 'IMG_0001.HEIC', { type: '' }),
      new File([new Uint8Array(10)], 'IMG_0002.heif', { type: 'application/octet-stream' }),
      new File([new Uint8Array(10)], 'IMG_0003.heic', { type: 'image/heic' }),
    ])
    await flush()
    expect(getUploadState().refusals.t?.items).toEqual([])
    expect(requestUploadLinks.mock.calls[0][1]).toEqual([
      { filename: 'IMG_0001.HEIC', contentType: '', size: 10 },
      { filename: 'IMG_0002.heif', contentType: '', size: 10 },
      { filename: 'IMG_0003.heic', contentType: 'image/heic', size: 10 },
    ])
  })

  it('remembers which Photos this device retried, until log-out', () => {
    expect(getUploadState().retried).toEqual([])
    noteRetried('p1')
    noteRetried('p1')
    noteRetried('p2')
    expect(getUploadState().retried).toEqual(['p1', 'p2'])
    cancelAll()
    expect(getUploadState().retried).toEqual([])
  })
})
