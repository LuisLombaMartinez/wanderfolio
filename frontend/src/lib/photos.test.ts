import { describe, expect, it } from 'vitest'
import type { Photo, Trip } from '@/lib/api'
import { checkCaption, neighbourAfterRemoval, isShowable, photoLabel, readyPhotos, removePhoto, replacePhoto } from '@/lib/photos'

const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  status: 'ready',
  filename: `${id}.jpg`,
  thumbnailUrl: `/media/t/${id}/thumb.webp`,
  largeUrl: `/media/t/${id}/large.webp`,
  ...extra,
})
const trip = (photos: Photo[]): Trip => ({
  id: 't',
  title: 'T',
  destination: 'D',
  startDate: '2026-01-01',
  endDate: '2026-01-02',
  photoCount: 0,
  thumbnails: [],
  coverPhoto: null,
  photos,
})

describe('isShowable', () => {
  it('is a ready Photo with both web versions, the API\'s read-time rule', () => {
    expect(isShowable(photo('a'))).toBe(true)
    expect(isShowable(photo('a', { status: 'failed' }))).toBe(false)
    expect(isShowable(photo('a', { status: 'processing' }))).toBe(false)
    expect(isShowable(photo('a', { thumbnailUrl: undefined }))).toBe(false)
    expect(isShowable(photo('a', { largeUrl: undefined }))).toBe(false)
  })
  it('makes the count, the viewer sequence and the Cover photo agree', () => {
    const list = [photo('a', { thumbnailUrl: undefined }), photo('b'), photo('c')]
    const t = removePhoto(trip(list), 'zzz')
    expect(t.photoCount).toBe(readyPhotos(list).length)
    expect(t.coverPhoto?.id).toBe(readyPhotos(list)[0].id)
  })
})

describe('readyPhotos', () => {
  it('keeps only ready Photos, in the API order', () => {
    const list = [photo('a'), photo('b', { status: 'failed' }), photo('c'), photo('d', { status: 'processing' })]
    expect(readyPhotos(list).map((p) => p.id)).toEqual(['a', 'c'])
    expect(readyPhotos(undefined)).toEqual([])
  })
})

describe('Trip updates', () => {
  it('removes a Photo and recomputes the count and cover thumbnails', () => {
    const t = removePhoto(trip([photo('a'), photo('b'), photo('c', { status: 'failed' })]), 'a')
    expect(t.photos?.map((p) => p.id)).toEqual(['b', 'c'])
    expect(t.photoCount).toBe(1)
    expect(t.thumbnails).toEqual(['/media/t/b/thumb.webp'])
  })

  it('moves the Cover photo to the first ready Photo when the chosen one is removed, or to null', () => {
    const cover = (id: string, chosen: boolean) => ({ id, thumbnailUrl: `/media/t/${id}/thumb.webp`, largeUrl: `/media/t/${id}/large.webp`, chosen })
    const base = { ...trip([photo('a'), photo('b'), photo('c')]), coverPhoto: cover('b', true) }
    expect(removePhoto(base, 'a').coverPhoto).toEqual(cover('b', true)) // another Photo left: the choice stays
    expect(removePhoto(base, 'b').coverPhoto).toEqual(cover('a', false)) // chosen gone: first ready, not chosen
    const byDefault = { ...base, coverPhoto: cover('a', false) }
    expect(removePhoto(byDefault, 'a').coverPhoto).toEqual(cover('b', false))
    expect(removePhoto({ ...trip([photo('a')]), coverPhoto: cover('a', true) }, 'a').coverPhoto).toBeNull()
  })

  it('replaces a Photo with its new caption', () => {
    const t = replacePhoto(trip([photo('a'), photo('b')]), photo('b', { caption: 'hola' }))
    expect(t.photos?.[1].caption).toBe('hola')
    expect(t.photoCount).toBe(2)
  })

  it('keeps the Cover photo in step when a retry or poll changes a Photo status', () => {
    const cover = (id: string, chosen: boolean) => ({ id, thumbnailUrl: `/media/t/${id}/thumb.webp`, largeUrl: `/media/t/${id}/large.webp`, chosen })
    const base = { ...trip([photo('a', { status: 'failed', thumbnailUrl: undefined, largeUrl: undefined }), photo('b')]), coverPhoto: cover('b', false) }
    // A failed Photo going back to processing (retry) leaves the cover alone.
    const retried = replacePhoto(base, photo('a', { status: 'processing', thumbnailUrl: undefined, largeUrl: undefined }))
    expect(retried.coverPhoto).toEqual(cover('b', false))
    expect(retried.photoCount).toBe(1)
    // When it comes out ready and is earlier, it becomes the default cover.
    expect(replacePhoto(retried, photo('a')).coverPhoto).toEqual(cover('a', false))
    // A chosen Photo that no longer reads as ready is never the cover.
    const chosen = { ...base, coverPhoto: cover('b', true) }
    expect(replacePhoto(chosen, photo('b', { status: 'failed', thumbnailUrl: undefined, largeUrl: undefined })).coverPhoto).toBeNull()
  })
})

describe('neighbourAfterRemoval', () => {
  const before = [photo('a'), photo('b'), photo('c')]
  it('shows the next Photo, else the previous one, else nothing', () => {
    expect(neighbourAfterRemoval(before, 'b', [before[0], before[2]])?.id).toBe('c')
    expect(neighbourAfterRemoval(before, 'c', [before[0], before[1]])?.id).toBe('b')
    expect(neighbourAfterRemoval([before[0]], 'a', [])).toBeUndefined()
    expect(neighbourAfterRemoval(before, 'zzz', before)).toBeUndefined()
  })
})

describe('photoLabel', () => {
  it('prefers the caption, then the date, then the fallback', () => {
    expect(photoLabel(photo('a', { caption: 'Atardecer' }))).toBe('Atardecer')
    expect(photoLabel(photo('a', { takenAt: '2026-07-12T10:00:00Z' }))).toBe('Foto del 12 jul 2026')
    expect(photoLabel(photo('a'), 'Foto de Cádiz')).toBe('Foto de Cádiz')
  })
})

describe('checkCaption', () => {
  it('counts characters as code points and trims', () => {
    expect(checkCaption('😀'.repeat(500))).toBeNull()
    expect(checkCaption('😀'.repeat(501))).toBe('caption-too-long')
    expect(checkCaption(`  ${'a'.repeat(500)}  `)).toBeNull()
  })
  it('refuses control characters except line breaks and tabs', () => {
    expect(checkCaption('uno\ndos\ttres\r')).toBeNull()
    expect(checkCaption('mal\u0007')).toBe('invalid-characters')
  })
})
