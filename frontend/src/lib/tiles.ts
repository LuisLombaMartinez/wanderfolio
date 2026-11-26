import type { Photo } from '@/lib/api'
import type { LocalUpload } from '@/lib/upload-store'

export type TileState =
  | { kind: 'queued' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'upload-failed' }
  | { kind: 'revealing' }
  | { kind: 'failed'; photo: Photo }
  | { kind: 'ready'; photo: Photo }

export interface Tile {
  /** One React key from pick to ready: the local id while this device knows the file, else the Photo id. */
  key: string
  /** What the placeholder gradient is picked from. */
  gradientId: string
  filename: string
  /** The API's Photo id, once this tile has one (it never changes, unlike `key` for a local upload). */
  photoId?: string
  localId?: string
  state: TileState
}

/** How long a sent file may stay unlisted by the API (it hides abandoned records after 20 min). */
export const UNLISTED_GRACE_MS = 20 * 60 * 1000

function localState(u: LocalUpload): TileState | null {
  switch (u.status) {
    case 'queued':
      return { kind: 'queued' }
    case 'uploading':
      return { kind: 'uploading', progress: u.progress }
    case 'failed':
      return { kind: 'upload-failed' }
    case 'sent':
      return null
  }
}

/**
 * The grid, in order: the API's Photos as listed (never re-sorted), then the files this device is
 * still sending or that the API does not list yet, in pick order (MASTER section 28).
 */
export function buildTiles(
  photos: readonly Photo[],
  uploads: readonly LocalUpload[],
  abandoned: readonly string[],
  now: number = Date.now(),
): Tile[] {
  const byPhoto = new Map<string, LocalUpload>()
  for (const u of uploads) if (u.photoId) byPhoto.set(u.photoId, u)
  const gone = new Set(abandoned)
  const listed = new Set<string>()
  const tiles: Tile[] = []

  for (const photo of photos) {
    if (gone.has(photo.id)) continue
    listed.add(photo.id)
    const u = byPhoto.get(photo.id)
    const state: TileState =
      (u && localState(u)) ||
      (photo.status === 'ready'
        ? { kind: 'ready', photo }
        : photo.status === 'failed'
          ? { kind: 'failed', photo }
          : { kind: 'revealing' })
    tiles.push({ key: u?.localId ?? photo.id, gradientId: u?.localId ?? photo.id, filename: photo.filename, photoId: photo.id, localId: u?.localId, state })
  }

  for (const u of uploads) {
    if (u.photoId && listed.has(u.photoId)) continue
    // Sent long ago and the API no longer lists it (an abandoned record expired): nothing left to wait for.
    if (u.status === 'sent' && u.sentAt !== undefined && now - u.sentAt > UNLISTED_GRACE_MS) continue
    tiles.push({
      key: u.localId,
      gradientId: u.localId,
      filename: u.filename,
      photoId: u.photoId,
      localId: u.localId,
      state: localState(u) ?? { kind: 'revealing' },
    })
  }
  return tiles
}

/** True while a tile is still on its way to ready, so the page keeps polling. */
export const isUnfinished = (t: Tile) => t.state.kind === 'queued' || t.state.kind === 'uploading' || t.state.kind === 'revealing'
