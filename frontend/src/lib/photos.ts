import type { CoverPhoto, Photo, Trip } from '@/lib/api'
import { formatDateRange } from '@/lib/dates'

/**
 * Whether a Photo can be shown: ready, with both web versions. The one definition behind the Photo count,
 * the viewer sequence, the card previews and the Cover photo. The API sends the URLs exactly when ready.
 */
export const isShowable = (p: Photo): boolean => p.status === 'ready' && Boolean(p.thumbnailUrl) && Boolean(p.largeUrl)

/** The showable Photos in the API's order: what the viewer goes through. Never re-sorted. */
export const readyPhotos = (photos: readonly Photo[] | undefined): Photo[] => (photos ?? []).filter(isShowable)

/** How many Photos a Trip card previews. */
const CARD_PREVIEW_COUNT = 4

const coverOf = (p: Photo, chosen: boolean): CoverPhoto => ({ id: p.id, thumbnailUrl: p.thumbnailUrl as string, largeUrl: p.largeUrl as string, chosen })

/**
 * The Cover photo after the Photo list changed here, mirroring the API's read-time rule: a chosen Photo that is
 * still ready stays, else the first ready Photo (not chosen), else none. The next poll confirms it.
 */
function coverAfter(current: CoverPhoto | null, photos: readonly Photo[]): CoverPhoto | null {
  const ready = photos.filter(isShowable)
  const kept = current?.chosen ? ready.find((p) => p.id === current.id) : undefined
  if (kept) return coverOf(kept, true)
  return ready[0] ? coverOf(ready[0], false) : null
}

/** The Trip with its list, count, cover thumbnails and Cover photo recomputed from a new Photo list. */
function withPhotos(trip: Trip, photos: Photo[]): Trip {
  const ready = photos.filter(isShowable)
  return {
    ...trip,
    photos,
    photoCount: ready.length,
    coverPhoto: coverAfter(trip.coverPhoto, photos),
    thumbnails: ready.slice(0, CARD_PREVIEW_COUNT).map((p) => p.thumbnailUrl as string),
  }
}

/** The Trip with one Photo replaced (a caption saved). */
export const replacePhoto = (trip: Trip, photo: Photo): Trip =>
  withPhotos(trip, (trip.photos ?? []).map((p) => (p.id === photo.id ? photo : p)))

/** The Trip without a Photo (deleted here, or found gone). */
export const removePhoto = (trip: Trip, photoId: string): Trip =>
  withPhotos(trip, (trip.photos ?? []).filter((p) => p.id !== photoId))

/** "12 jul 2026" for a Photo's date taken, or undefined without one. */
export const photoDate = (takenAt?: string): string | undefined =>
  takenAt ? formatDateRange(takenAt.slice(0, 10), takenAt.slice(0, 10)) : undefined

/** The accessible name of a Photo: its caption, else its date, else the fallback. */
export const photoLabel = (photo: Photo, fallback = 'Foto'): string => {
  if (photo.caption) return photo.caption
  const date = photoDate(photo.takenAt)
  return date ? `Foto del ${date}` : fallback
}

/** Where the viewer goes when `current` has left the sequence: the Photo now at its place, else the last one. */
export function neighbourAfterRemoval(before: readonly Photo[], current: string, after: readonly Photo[]): Photo | undefined {
  const at = before.findIndex((p) => p.id === current)
  if (at < 0) return undefined
  return after[Math.min(at, after.length - 1)]
}

const CAPTION_MAX = 500

export type CaptionProblem = 'caption-too-long' | 'invalid-characters'

/** The same rules as the API: at most 500 characters (code points), no control characters but line breaks and tabs. */
export function checkCaption(text: string): CaptionProblem | null {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) return 'invalid-characters'
  if ([...text.trim()].length > CAPTION_MAX) return 'caption-too-long'
  return null
}
export const CAPTION_LIMIT = CAPTION_MAX
