import { ApiError, requestUploadLinks, type UploadForm } from '@/lib/api'
import { checkFile, contentTypeToSend } from '@/lib/upload-checks'

/**
 * The app-level upload queue (MASTER section 29). It lives outside any page, so uploads keep running
 * when the Member leaves the Trip page, and the upload bar can follow them anywhere.
 */

export const BATCH_SIZE = 50
export const PARALLEL_UPLOADS = 3
/** A presigned link lives 15 min; reuse it only while it is younger than this. */
export const LINK_REUSE_MS = 14 * 60 * 1000
/** A send that makes no progress at all for this long is given up, which frees its slot. */
export const SEND_TIMEOUT_MS = 5 * 60 * 1000

export type UploadStatus = 'queued' | 'uploading' | 'failed' | 'sent'

export interface LocalUpload {
  /** The tile's React key from pick to ready, whatever Photo id the API hands out. */
  localId: string
  tripId: string
  filename: string
  size: number
  contentType: string
  status: UploadStatus
  /** 0 to 1, bytes of this file sent. */
  progress: number
  photoId?: string
  link?: { form: UploadForm; issuedAt: number }
  /** Set while the upload waits for its link request; the batch it belongs to. */
  batchId?: number
  /** Dropped once sent, so a big pick does not keep every file in memory. */
  file?: File
  session: number
  /** When the file reached S3. */
  sentAt?: number
}

export interface Refusal {
  filename: string
  code: string
}

export type UploadBanner = { kind: 'links'; batchId: number } | { kind: 'trip-gone' }

export interface UploadState {
  uploads: LocalUpload[]
  /** Refusals of the latest pick, per Trip. */
  refusals: Record<string, { pick: number; items: Refusal[] }>
  banners: Record<string, UploadBanner | undefined>
  /** Photo ids a retry replaced with a fresh link: the page hides their `awaiting-upload` records. */
  abandoned: string[]
  /** Photos this device asked to retry (MASTER section 42): if one fails again, the dialog says so. */
  retried: string[]
  session: { id: number; tripId: string; tripTitle: string; dismissed: boolean }
}

const initial: UploadState = {
  uploads: [],
  refusals: {},
  banners: {},
  abandoned: [],
  retried: [],
  session: { id: 0, tripId: '', tripTitle: '', dismissed: true },
}

let state: UploadState = initial
let nextId = 1
/** Bumped by `cancelAll`, so late events of aborted requests know the store was reset. */
let resets = 0
const listeners = new Set<() => void>()
const batches = new Map<number, { tripId: string; pick: number }>()
/** The requests in flight, so logging out can abort them. */
const sending = new Map<string, XMLHttpRequest>()

function update(change: (s: UploadState) => UploadState) {
  state = change(state)
  syncUnloadGuard()
  listeners.forEach((l) => l())
}

function patchUpload(localId: string, patch: Partial<LocalUpload>) {
  update((s) => ({ ...s, uploads: s.uploads.map((u) => (u.localId === localId ? { ...u, ...patch } : u)) }))
}

export const subscribeUploads = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const getUploadState = () => state

const isActive = (u: LocalUpload) => u.status === 'queued' || u.status === 'uploading'

// --- leaving the page while uploads run -----------------------------------------------------

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault()
}
let guarding = false
function syncUnloadGuard() {
  if (typeof window === 'undefined') return
  const should = state.uploads.some(isActive)
  if (should === guarding) return
  guarding = should
  if (should) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}

// --- picking and asking for links -----------------------------------------------------------

/** Checks the picked files, queues the good ones and asks the API for their links. */
export function pickFiles(tripId: string, tripTitle: string, files: File[]) {
  if (files.length === 0) return
  const pick = nextId++
  const refused: Refusal[] = []
  const accepted: File[] = []
  for (const file of files) {
    const code = checkFile(file)
    if (code) refused.push({ filename: file.name, code })
    else accepted.push(file)
  }

  // A new Upload session starts unless the current one still has files to send or retry.
  const open = state.uploads.some((u) => u.session === state.session.id && u.status !== 'sent')
  const sessionId = open ? state.session.id : nextId++
  const batchIds: number[] = []
  const created: LocalUpload[] = accepted.map((file, i) => {
    if (i % BATCH_SIZE === 0) {
      batchIds.push(nextId++)
      batches.set(batchIds[batchIds.length - 1], { tripId, pick })
    }
    const batchId = batchIds[batchIds.length - 1]
    return {
      localId: `local-${nextId++}`,
      tripId,
      filename: file.name,
      size: file.size,
      contentType: contentTypeToSend(file),
      status: 'queued',
      progress: 0,
      batchId,
      file,
      session: sessionId,
    }
  })

  update((s) => ({
    ...s,
    uploads: [...(open ? s.uploads : s.uploads.filter((u) => u.status !== 'sent')), ...created],
    refusals: { ...s.refusals, [tripId]: { pick, items: refused } },
    banners: { ...s.banners, [tripId]: undefined },
    session: created.length
      ? { id: sessionId, tripId: open ? s.session.tripId : tripId, tripTitle: open ? s.session.tripTitle : tripTitle, dismissed: false }
      : s.session,
  }))
  batchIds.forEach((id) => void requestBatch(id))
}

async function requestBatch(batchId: number) {
  const batch = batches.get(batchId)
  if (!batch) return
  const items = state.uploads.filter((u) => u.batchId === batchId && !u.link)
  if (items.length === 0) return
  update((s) => ({ ...s, banners: { ...s.banners, [batch.tripId]: undefined } }))
  try {
    const results = await requestUploadLinks(
      batch.tripId,
      items.map((u) => ({ filename: u.filename, contentType: u.contentType, size: u.size })),
    )
    if (!batches.has(batchId)) return // cancelled (logged out) while the request was in flight
    if (results.length !== items.length) throw new ApiError(200, 'bad-response')
    const refused: Refusal[] = []
    const links = new Map<string, { photoId: string; form: UploadForm }>()
    results.forEach((r, i) => {
      if ('error' in r) refused.push({ filename: items[i].filename, code: r.error.code })
      else links.set(items[i].localId, { photoId: r.photoId, form: r.upload })
    })
    const now = Date.now()
    update((s) => {
      const current = s.refusals[batch.tripId]
      return {
        ...s,
        uploads: s.uploads.flatMap((u) => {
          if (u.batchId !== batchId || !items.some((i) => i.localId === u.localId)) return [u]
          const link = links.get(u.localId)
          if (!link) return [] // refused by the API: never a tile
          return [{ ...u, photoId: link.photoId, link: { form: link.form, issuedAt: now }, batchId: undefined }]
        }),
        refusals:
          refused.length && current?.pick === batch.pick
            ? { ...s.refusals, [batch.tripId]: { pick: current.pick, items: [...current.items, ...refused] } }
            : s.refusals,
      }
    })
    pump()
  } catch (err) {
    if (!batches.has(batchId)) return
    if (err instanceof ApiError && err.code === 'trip-not-found') {
      update((s) => ({
        ...s,
        uploads: s.uploads.filter((u) => u.batchId !== batchId),
        banners: { ...s.banners, [batch.tripId]: { kind: 'trip-gone' } },
      }))
    } else {
      update((s) => ({ ...s, banners: { ...s.banners, [batch.tripId]: { kind: 'links', batchId } } }))
    }
  }
}

/** Retries a batch whose link request failed. */
export const retryLinks = (batchId: number) => void requestBatch(batchId)

/** Taps on an upload-failed tile: re-send with the same link while it is fresh, else ask for a new one. */
export function retryUpload(localId: string) {
  const u = state.uploads.find((x) => x.localId === localId)
  if (!u || u.status !== 'failed' || !u.file) return
  if (u.link && Date.now() - u.link.issuedAt < LINK_REUSE_MS) {
    patchUpload(localId, { status: 'queued', progress: 0 })
    pump()
    return
  }
  renewLink(u)
}

/** Drops the old link (its Photo record is hidden as abandoned) and asks for a fresh one for this file. */
function renewLink(u: LocalUpload) {
  const batchId = nextId++
  batches.set(batchId, { tripId: u.tripId, pick: state.refusals[u.tripId]?.pick ?? 0 })
  update((s) => ({
    ...s,
    abandoned: u.photoId ? [...s.abandoned, u.photoId] : s.abandoned,
    uploads: s.uploads.map((x) =>
      x.localId === u.localId ? { ...x, status: 'queued', progress: 0, link: undefined, photoId: undefined, batchId } : x,
    ),
  }))
  void requestBatch(batchId)
}

// --- sending ----------------------------------------------------------------------------------

function pump() {
  const free = PARALLEL_UPLOADS - state.uploads.filter((u) => u.status === 'uploading').length
  if (free <= 0) return
  state.uploads
    .filter((u) => u.status === 'queued' && u.link && u.file)
    .slice(0, free)
    .forEach((u) => {
      // A link that waited in the queue past its reuse limit may have expired: get a new one first.
      if (u.link && Date.now() - u.link.issuedAt >= LINK_REUSE_MS) renewLink(u)
      else send(u)
    })
}

function send(u: LocalUpload) {
  const { link, file } = u
  if (!link || !file) return
  patchUpload(u.localId, { status: 'uploading', progress: 0 })

  const form = new FormData()
  for (const [name, value] of Object.entries(link.form.fields)) form.append(name, value)
  form.append('file', file) // the file goes last: S3 ignores fields after it

  const xhr = new XMLHttpRequest()
  const generation = resets
  sending.set(u.localId, xhr)
  let lastTick = 0
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return
    const now = Date.now()
    if (now - lastTick < 100 && e.loaded < e.total) return
    lastTick = now
    patchUpload(u.localId, { progress: Math.min(1, e.loaded / e.total) })
  }
  const settle = () => {
    if (sending.get(u.localId) === xhr) sending.delete(u.localId)
    return generation === resets // false after cancelAll: the store was reset, leave it alone
  }
  const fail = () => {
    if (!settle()) return
    patchUpload(u.localId, { status: 'failed' })
    pump()
  }
  xhr.onload = () => {
    if (!settle()) return
    if (xhr.status >= 200 && xhr.status < 300) {
      patchUpload(u.localId, { status: 'sent', progress: 1, file: undefined, sentAt: Date.now() })
      pump()
    } else fail()
  }
  xhr.onerror = fail
  xhr.onabort = fail
  xhr.ontimeout = fail
  xhr.open('POST', link.form.url)
  xhr.timeout = SEND_TIMEOUT_MS
  xhr.send(form)
}

/** Log-out: aborts every send, forgets every upload and batch. */
export function cancelAll() {
  resets++
  const running = [...sending.values()]
  sending.clear()
  batches.clear()
  running.forEach((x) => x.abort())
  update(() => initial)
}

/** Remembers that this device retried a failed Photo, so a second failure can say so. */
export const noteRetried = (photoId: string) =>
  update((s) => (s.retried.includes(photoId) ? s : { ...s, retried: [...s.retried, photoId] }))

/** How many uploads of a Trip are still being sent (queued or uploading). */
export const activeUploadsFor = (s: UploadState, tripId: string) => s.uploads.filter((u) => u.tripId === tripId && isActive(u)).length

/** Deleting a Trip: stops and forgets the uploads still going to it. */
export function cancelTripUploads(tripId: string) {
  const ids = state.uploads.filter((u) => u.tripId === tripId && isActive(u)).map((u) => u.localId)
  for (const [id, b] of [...batches]) if (b.tripId === tripId) batches.delete(id)
  update((s) => ({ ...s, uploads: s.uploads.filter((u) => !ids.includes(u.localId)) }))
  for (const id of ids) {
    const x = sending.get(id)
    sending.delete(id)
    x?.abort()
  }
}

// --- the bar and the refusals card -------------------------------------------------------------

export const dismissBar = () => update((s) => ({ ...s, session: { ...s.session, dismissed: true } }))
export const dismissRefusals = (tripId: string) =>
  update((s) => {
    const { [tripId]: _gone, ...rest } = s.refusals
    void _gone
    return { ...s, refusals: rest }
  })
export const dismissBanner = (tripId: string) => update((s) => ({ ...s, banners: { ...s.banners, [tripId]: undefined } }))

export type BarPhase = 'sending' | 'done' | 'partial'
export interface BarModel {
  phase: BarPhase
  total: number
  sent: number
  failed: number
  /** 0 to 1 over the bytes of the whole session. */
  progress: number
  tripId: string
  tripTitle: string
}

/** What the upload bar shows, or null when it is hidden. */
export function barModel(s: UploadState): BarModel | null {
  if (s.session.dismissed) return null
  const mine = s.uploads.filter((u) => u.session === s.session.id)
  if (mine.length === 0) return null
  const sent = mine.filter((u) => u.status === 'sent').length
  const failed = mine.filter((u) => u.status === 'failed').length
  const bytes = mine.reduce((n, u) => n + u.size, 0)
  const done = mine.reduce((n, u) => n + u.size * (u.status === 'sent' ? 1 : u.progress), 0)
  const phase: BarPhase = mine.some(isActive) ? 'sending' : failed > 0 ? 'partial' : 'done'
  return {
    phase,
    total: mine.length,
    sent,
    failed,
    progress: bytes > 0 ? done / bytes : 0,
    tripId: s.session.tripId,
    tripTitle: s.session.tripTitle,
  }
}

/** Test helper: back to an empty store. */
export function resetUploadsForTests() {
  state = initial
  batches.clear()
  sending.clear()
  listeners.clear()
  syncUnloadGuard()
}
