import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, acceptInvitation, getCurrentMember, getTrip, listPendingInvitations, listTrips, retryPhoto, setCoverPhoto } from '@/lib/api'

vi.mock('@/lib/auth', () => ({ accessToken: () => Promise.resolve('t') }))

const reply = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))

const trip = { id: 'a'.repeat(32), title: 'T', destination: 'D', startDate: '2026-12-01', endDate: '2026-12-02', photoCount: 1, thumbnails: ['/media/a/b/thumb.webp'], coverPhoto: null }

afterEach(() => vi.restoreAllMocks())

describe('response shape checks', () => {
  it('accepts well-formed responses', async () => {
    reply(trip)
    await expect(getTrip('x')).resolves.toMatchObject({ title: 'T' })
    reply({ trips: [trip] })
    await expect(listTrips()).resolves.toHaveLength(1)
  })

  it('reads the Cover photo, or null, and refuses a malformed one', async () => {
    const coverPhoto = { id: 'p', thumbnailUrl: '/media/t', largeUrl: '/media/l', chosen: true }
    reply({ ...trip, coverPhoto })
    await expect(getTrip('x')).resolves.toMatchObject({ coverPhoto })
    reply({ ...trip, coverPhoto: { ...coverPhoto, chosen: 'yes' } })
    await expect(getTrip('x')).rejects.toMatchObject({ code: 'bad-response' })
    reply({ ...trip, coverPhoto: undefined })
    await expect(getTrip('x')).rejects.toMatchObject({ code: 'bad-response' })
  })

  it('sets the Cover photo with PUT and reads the Trip back', async () => {
    const spy = reply({ ...trip, coverPhoto: { id: 'p', thumbnailUrl: '/t', largeUrl: '/l', chosen: true } })
    await expect(setCoverPhoto('trip 1', 'p')).resolves.toMatchObject({ coverPhoto: { chosen: true } })
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('/api/trips/trip%201/cover-photo')
    expect(init).toMatchObject({ method: 'PUT', body: JSON.stringify({ photoId: 'p' }) })
    reply({ error: { code: 'photo-not-ready', message: 'x' } }, 409)
    await expect(setCoverPhoto('t', 'p')).rejects.toMatchObject({ status: 409, code: 'photo-not-ready' })
  })

  it('reads Photos on a Trip and refuses an unknown Photo status', async () => {
    const photos = [{ id: 'p', status: 'ready', filename: 'a.jpg', thumbnailUrl: '/media/a/p/thumb.webp' }]
    reply({ ...trip, photos })
    await expect(getTrip('x')).resolves.toMatchObject({ photos })
    reply({ ...trip, photos: [{ id: 'p', status: 'weird', filename: 'a.jpg' }] })
    await expect(getTrip('x')).rejects.toMatchObject({ code: 'bad-response' })
  })

  it('checks the optional Photo numbers and strings', async () => {
    const bad = (extra: object) => reply({ ...trip, photos: [{ id: 'p', status: 'failed', filename: 'a.jpg', ...extra }] })
    bad({ width: '10' })
    await expect(getTrip('x')).rejects.toMatchObject({ code: 'bad-response' })
    bad({ failureReason: 5 })
    await expect(getTrip('x')).rejects.toMatchObject({ code: 'bad-response' })
    bad({ width: 10, height: 20, failureReason: 'corrupt-image' })
    await expect(getTrip('x')).resolves.toBeTruthy()
  })

  it('throws bad-response for a wrong shape on a 200', async () => {
    reply({ id: 1 })
    await expect(getTrip('x')).rejects.toMatchObject({ code: 'bad-response' })
    reply({ trips: [{}] })
    await expect(listTrips()).rejects.toBeInstanceOf(ApiError)
    reply(null)
    await expect(getCurrentMember()).rejects.toMatchObject({ code: 'bad-response' })
  })
})

describe('retryPhoto', () => {
  it('posts to the retry route and returns the Photo, now processing', async () => {
    const spy = reply({ id: 'p1', status: 'processing', filename: 'a.heic' })
    await expect(retryPhoto('trip1', 'p1')).resolves.toMatchObject({ status: 'processing' })
    expect(spy.mock.calls[0][0]).toBe('/api/trips/trip1/photos/p1/retry')
    expect(spy.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })
  it('surfaces the API error codes', async () => {
    reply({ error: { code: 'photo-not-failed', message: 'x' } }, 409)
    await expect(retryPhoto('t', 'p')).rejects.toMatchObject({ status: 409, code: 'photo-not-failed' })
    reply({ id: 'p1' })
    await expect(retryPhoto('t', 'p')).rejects.toMatchObject({ code: 'bad-response' })
  })
})

describe('Invitations', () => {
  const invitation = {
    tripId: 't1', question: '¿Vienes?', inviterId: 'a', inviteeId: 'b',
    status: 'pending', createdAt: '2026-11-26T10:00:00.000Z', acceptedAt: null,
  }

  it('lists Pending Invitations in the order the API gives', async () => {
    const second = { ...invitation, tripId: 't2', destination: 'Roma', startDate: '2027-01-01', endDate: '2027-01-02' }
    const first = { ...invitation, destination: 'París', startDate: '2027-03-01', endDate: '2027-03-02' }
    const spy = reply({ invitations: [first, second] })
    await expect(listPendingInvitations()).resolves.toEqual([first, second])
    expect(spy.mock.calls[0][0]).toBe('/api/invitations/pending')
    reply({ invitations: [{ ...first, destination: undefined }] })
    await expect(listPendingInvitations()).rejects.toMatchObject({ code: 'bad-response' })
  })

  it('accepts with a POST and reads the accepted Invitation back', async () => {
    const spy = reply({ ...invitation, status: 'accepted', acceptedAt: '2026-11-26T11:00:00.000Z' })
    await expect(acceptInvitation('t 1')).resolves.toMatchObject({ status: 'accepted' })
    expect(spy.mock.calls[0][0]).toBe('/api/trips/t%201/invitation/accept')
    expect(spy.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    reply({ error: { code: 'invitation-not-found', message: 'x' } }, 404)
    await expect(acceptInvitation('t')).rejects.toMatchObject({ status: 404, code: 'invitation-not-found' })
  })

  it('reads a Trip with or without its Invitation and refuses a malformed one', async () => {
    reply({ ...trip, invitation })
    await expect(getTrip('x')).resolves.toMatchObject({ invitation })
    reply({ ...trip, invitation: null })
    await expect(getTrip('x')).resolves.toMatchObject({ invitation: null })
    reply({ ...trip, invitation: { ...invitation, status: 'maybe' } })
    await expect(getTrip('x')).rejects.toMatchObject({ code: 'bad-response' })
  })
})
