import { describe, expect, it } from 'vitest'
import type { Photo } from './api'
import { buildTiles, isUnfinished } from './tiles'
import type { LocalUpload } from './upload-store'

const photo = (id: string, status: Photo['status'], extra: Partial<Photo> = {}): Photo => ({ id, status, filename: `${id}.jpg`, ...extra })
const upload = (localId: string, extra: Partial<LocalUpload> = {}): LocalUpload => ({
  localId,
  tripId: 't',
  filename: `${localId}.jpg`,
  size: 10,
  contentType: 'image/jpeg',
  status: 'queued',
  progress: 0,
  session: 1,
  ...extra,
})

describe('buildTiles', () => {
  it('keeps the API order and puts files the API does not list after it, in pick order', () => {
    const tiles = buildTiles(
      [photo('b', 'ready'), photo('a', 'processing')],
      [upload('l1'), upload('l2', { status: 'uploading', progress: 0.5 })],
      [],
    )
    expect(tiles.map((t) => t.key)).toEqual(['b', 'a', 'l1', 'l2'])
    expect(tiles.map((t) => t.state.kind)).toEqual(['ready', 'revealing', 'queued', 'uploading'])
  })

  it('keeps one key from pick to ready for a file this device sent', () => {
    const sent = upload('l1', { status: 'sent', photoId: 'p1', progress: 1 })
    const before = buildTiles([], [sent], [])
    const during = buildTiles([photo('p1', 'awaiting-upload')], [sent], [])
    const after = buildTiles([photo('p1', 'ready')], [sent], [])
    expect([before[0], during[0], after[0]].map((t) => t.key)).toEqual(['l1', 'l1', 'l1'])
    expect([before[0], during[0], after[0]].map((t) => t.state.kind)).toEqual(['revealing', 'revealing', 'ready'])
  })

  it('shows local state over the API record while the file is still being sent or failed', () => {
    const failed = upload('l1', { status: 'failed', photoId: 'p1' })
    expect(buildTiles([photo('p1', 'awaiting-upload')], [failed], [])[0].state.kind).toBe('upload-failed')
  })

  it('hides the Photos a retry abandoned and shows failed ones', () => {
    const tiles = buildTiles([photo('old', 'awaiting-upload'), photo('bad', 'failed')], [], ['old'])
    expect(tiles.map((t) => [t.key, t.state.kind])).toEqual([['bad', 'failed']])
  })

  it('knows which tiles are still on their way', () => {
    const tiles = buildTiles([photo('a', 'ready'), photo('b', 'failed'), photo('c', 'awaiting-upload')], [upload('l1', { status: 'failed' })], [])
    expect(tiles.map(isUnfinished)).toEqual([false, false, true, false])
  })

  it('stops waiting for a sent file the API no longer lists after the grace period', () => {
    const sent = upload('l1', { status: 'sent', photoId: 'p1', progress: 1, sentAt: 0 })
    expect(buildTiles([], [sent], [], 60_000).some(isUnfinished)).toBe(true)
    expect(buildTiles([], [sent], [], 21 * 60 * 1000)).toEqual([])
  })

  it('hands the failed Photo to its tile, for the reason and the dialog', () => {
    const bad = photo('bad', 'failed', { failureReason: 'unreadable-image: UnreadableImage' })
    const [tile] = buildTiles([bad], [], [])
    expect(tile.state).toEqual({ kind: 'failed', photo: bad })
  })

  it('keeps the Photo id on a tile whose key is a local id, so focus can find it', () => {
    const sent = upload('l1', { status: 'sent', photoId: 'p1', progress: 1 })
    expect(buildTiles([photo('p1', 'failed')], [sent], [])[0]).toMatchObject({ key: 'l1', photoId: 'p1' })
    expect(buildTiles([], [sent], [])[0]).toMatchObject({ key: 'l1', photoId: 'p1' })
  })

  it('treats a failed Photo as finished', () => {
    const tiles = buildTiles([photo('p', 'failed', { failureReason: 'corrupt-image' })], [], [])
    expect(tiles[0].state.kind).toBe('failed')
    expect(tiles.some(isUnfinished)).toBe(false)
  })
})
