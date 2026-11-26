import { accessToken } from '@/lib/auth'

/** An error response from the Go API, in its one JSON shape: `{"error":{"code","message"}}`. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message = code) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface Member {
  id: string
  displayName: string
}

export type PhotoStatus = 'awaiting-upload' | 'processing' | 'ready' | 'failed'

export interface Photo {
  id: string
  status: PhotoStatus
  filename: string
  takenAt?: string
  width?: number
  height?: number
  /** Same-origin `/media/...` paths, only when `ready`; they need the media-session cookies. */
  thumbnailUrl?: string
  largeUrl?: string
  failureReason?: string
  caption?: string
  /** The uploader's current display name. */
  uploadedBy?: string
}

/** The Trip's Cover photo, computed by the API at read time. `chosen` is false when it is only the first ready Photo. */
export interface CoverPhoto {
  id: string
  thumbnailUrl: string
  largeUrl: string
  chosen: boolean
}

export interface Trip {
  id: string
  title: string
  destination: string
  startDate: string
  endDate: string
  description?: string
  /** Number of `ready` Photos. */
  photoCount: number
  /** Thumbnail addresses of the first (up to) 4 ready Photos. */
  thumbnails: string[]
  /** The Cover photo, or null while the Trip has no ready Photo (the styled placeholder shows). */
  coverPhoto: CoverPhoto | null
  /** Date taken order, oldest first. Absent in the Trip list. */
  photos?: Photo[]
}

/** Calls the API under /api as the logged-in Member; throws an `ApiError` on any error response. */
async function apiRequest(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const token = await accessToken()
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (data as { error?: { code?: unknown; message?: unknown } } | null)?.error
    const code = typeof err?.code === 'string' ? err.code : res.status === 401 ? 'unauthorized' : 'unknown'
    throw new ApiError(res.status, code, typeof err?.message === 'string' ? err.message : undefined)
  }
  return data
}

const apiGet = (path: string, signal?: AbortSignal) => apiRequest('GET', path, undefined, signal)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function isMember(v: unknown): v is Member {
  return isRecord(v) && typeof v.id === 'string' && typeof v.displayName === 'string'
}

const PHOTO_STATUSES: readonly string[] = ['awaiting-upload', 'processing', 'ready', 'failed']
const optionalNumber = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v))
const optionalString = (v: unknown) => v === undefined || typeof v === 'string'

export function isPhoto(v: unknown): v is Photo {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.status === 'string' &&
    PHOTO_STATUSES.includes(v.status) &&
    typeof v.filename === 'string' &&
    optionalString(v.takenAt) &&
    optionalString(v.thumbnailUrl) &&
    optionalString(v.largeUrl) &&
    optionalString(v.failureReason) &&
    optionalString(v.caption) &&
    optionalString(v.uploadedBy) &&
    optionalNumber(v.width) &&
    optionalNumber(v.height)
  )
}

export function isCoverPhoto(v: unknown): v is CoverPhoto {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.thumbnailUrl === 'string' &&
    typeof v.largeUrl === 'string' &&
    typeof v.chosen === 'boolean'
  )
}

export function isTrip(v: unknown): v is Trip {
  return (
    isRecord(v) &&
    typeof v.photoCount === 'number' &&
    Array.isArray(v.thumbnails) &&
    v.thumbnails.every((t) => typeof t === 'string') &&
    (v.coverPhoto === null || isCoverPhoto(v.coverPhoto)) &&
    (v.photos === undefined || (Array.isArray(v.photos) && v.photos.every(isPhoto))) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.destination === 'string' &&
    typeof v.startDate === 'string' &&
    typeof v.endDate === 'string' &&
    (v.description === undefined || typeof v.description === 'string')
  )
}

/** Passes a successful response through only if it has the expected shape; otherwise throws `bad-response`. */
function expectShape<T>(guard: (v: unknown) => v is T) {
  return (data: unknown): T => {
    if (!guard(data)) throw new ApiError(200, 'bad-response')
    return data
  }
}

const isTripList = (v: unknown): v is { trips: Trip[] } => isRecord(v) && Array.isArray(v.trips) && v.trips.every(isTrip)

export const getCurrentMember = (signal?: AbortSignal) => apiGet('/me', signal).then(expectShape(isMember))

export const listTrips = (signal?: AbortSignal) =>
  apiGet('/trips', signal)
    .then(expectShape(isTripList))
    .then((r) => r.trips)

export type TripInput = Pick<Trip, 'title' | 'destination' | 'startDate' | 'endDate'> & { description: string }

/** A file to upload, as the API wants it described. */
export interface UploadRequestFile {
  filename: string
  contentType: string
  size: number
}

/** A presigned S3 POST: every `fields` entry goes first, then the file as the last part named `file`. */
export interface UploadForm {
  url: string
  fields: Record<string, string>
}

/** One entry of the upload-links answer: a link, or the reason that file was refused. */
export type UploadLinkResult =
  | { filename: string; photoId: string; upload: UploadForm }
  | { filename: string; error: { code: string; message: string } }

const isStringRecord = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every((x) => typeof x === 'string')

function isUploadLinkResult(v: unknown): v is UploadLinkResult {
  if (!isRecord(v) || typeof v.filename !== 'string') return false
  if (isRecord(v.error)) return typeof v.error.code === 'string' && typeof v.error.message === 'string'
  return (
    typeof v.photoId === 'string' &&
    isRecord(v.upload) &&
    typeof v.upload.url === 'string' &&
    isStringRecord(v.upload.fields)
  )
}

const isUploadLinks = (v: unknown): v is { results: UploadLinkResult[] } =>
  isRecord(v) && Array.isArray(v.results) && v.results.every(isUploadLinkResult)

/** Asks for upload links for up to 50 files; the answer has one entry per file, same order. */
export const requestUploadLinks = (tripId: string, files: UploadRequestFile[]) =>
  apiRequest('POST', `/trips/${encodeURIComponent(tripId)}/photos/upload-links`, { files })
    .then(expectShape(isUploadLinks))
    .then((r) => r.results)

/** Asks the API to set the signed cookies that unlock `/media/*`. Resolves to when they expire. */
export const createMediaSession = () =>
  apiRequest('POST', '/media-session').then((data) => {
    const at = isRecord(data) && typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : NaN
    if (Number.isNaN(at)) throw new ApiError(200, 'bad-response')
    return at
  })

/** Starts processing again on a `failed` Photo's original; resolves to the Photo, now `processing`. */
export const retryPhoto = (tripId: string, photoId: string, signal?: AbortSignal) =>
  apiRequest('POST', `/trips/${encodeURIComponent(tripId)}/photos/${encodeURIComponent(photoId)}/retry`, undefined, signal).then(
    expectShape(isPhoto),
  )

export const getTrip = (id: string, signal?: AbortSignal) =>
  apiGet(`/trips/${encodeURIComponent(id)}`, signal).then(expectShape(isTrip))
export const createTrip = (input: TripInput) => apiRequest('POST', '/trips', input).then(expectShape(isTrip))
export const updateTrip = (id: string, input: TripInput) =>
  apiRequest('PUT', `/trips/${encodeURIComponent(id)}`, input).then(expectShape(isTrip))
export const deleteTrip = (id: string, signal?: AbortSignal) =>
  apiRequest('DELETE', `/trips/${encodeURIComponent(id)}`, undefined, signal).then(() => undefined)

const photoPath = (tripId: string, photoId: string) =>
  `/trips/${encodeURIComponent(tripId)}/photos/${encodeURIComponent(photoId)}`

/** Sets, edits or (with an empty text) clears a Photo's caption; resolves to the updated Photo. */
export const updatePhotoCaption = (tripId: string, photoId: string, caption: string, signal?: AbortSignal) =>
  apiRequest('PATCH', photoPath(tripId, photoId), { caption }, signal).then(expectShape(isPhoto))

/** Deletes a Photo, whatever its state. A 404 means it was already gone. */
export const deletePhoto = (tripId: string, photoId: string, signal?: AbortSignal) =>
  apiRequest('DELETE', photoPath(tripId, photoId), undefined, signal).then(() => undefined)

/** Makes a ready Photo the Trip's Cover photo; resolves to the whole Trip. */
export const setCoverPhoto = (tripId: string, photoId: string, signal?: AbortSignal) =>
  apiRequest('PUT', `/trips/${encodeURIComponent(tripId)}/cover-photo`, { photoId }, signal).then(expectShape(isTrip))
