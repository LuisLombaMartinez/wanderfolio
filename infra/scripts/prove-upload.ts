// Proves the whole photo flow on the local stack, the way the browser does it:
// sign in -> create a Trip -> ask for an upload link -> POST a JPEG to S3 -> wait for `ready`
// -> get media cookies -> fetch thumb and large through the CloudFront distribution.
// Then the failure path: a corrupt "JPEG" must reach `failed` with a failureReason.
// Usage (stack up): FLOCI_PORT=<port> npx tsx scripts/prove-upload.ts [path/to/photo.jpg]
// With no argument it makes a small JPEG with Python and Pillow (python3 -c, Pillow installed).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AliasExistsException,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Amplify } from 'aws-amplify'
import { fetchAuthSession, signIn, signOut } from 'aws-amplify/auth'
import { readLocalStack } from './local-env.ts'

const stack = readLocalStack()
const backendDir = fileURLToPath(new URL('../../backend', import.meta.url))
const api = `http://${stack.apiId}.execute-api.localhost.floci.io:${stack.flociPort}`
const media = `http://${stack.distributionId.toLowerCase()}.cloudfront.localhost.floci.io:${stack.flociPort}`
const t0 = Date.now()
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`)

// A third Member, so the two test Members keep their temporary passwords (first-login e2e).
const email = 'proof@viajecito.test'
const password = 'Prueba#2026-ok'
const cognito = new CognitoIdentityProviderClient({ endpoint: stack.endpoint, region: 'eu-west-1' })
try {
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: stack.userPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }],
    }),
  )
} catch (err) {
  if (!(err instanceof UsernameExistsException || err instanceof AliasExistsException)) throw err
}
await cognito.send(
  new AdminSetUserPasswordCommand({ UserPoolId: stack.userPoolId, Username: email, Password: password, Permanent: true }),
)
const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: stack.userPoolId, Username: email }))
const sub = user.UserAttributes?.find((a) => a.Name === 'sub')?.Value
execFileSync('go', ['run', './cmd/seed-member', '-table', stack.tableName, '-id', sub!, '-name', 'Prueba'], {
  cwd: backendDir,
  stdio: 'ignore',
  env: { ...process.env, AWS_ENDPOINT_URL: stack.endpoint },
})

Amplify.configure({
  Auth: { Cognito: { userPoolId: stack.userPoolId, userPoolClientId: stack.userPoolClientId, userPoolEndpoint: stack.endpoint } },
})
await signOut().catch(() => {})
await signIn({ username: email, password })
const token = (await fetchAuthSession()).tokens!.accessToken.toString()
log('signed in')

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(api + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { res, json: (await res.json().catch(() => null)) as any }
}

const trip = await call('POST', '/api/trips', {
  title: 'Prueba',
  destination: 'Lisboa',
  startDate: '2027-04-28',
  endDate: '2027-05-07',
})
if (trip.res.status >= 300) throw new Error(`create trip: ${trip.res.status} ${JSON.stringify(trip.json)}`)
log(`trip ${trip.json.id}`)

const jpeg = process.argv[2]
  ? readFileSync(process.argv[2])
  : execFileSync('python3', [
      '-c',
      'import sys,io\nfrom PIL import Image\nb=io.BytesIO()\nImage.effect_noise((1200,800),64).convert("RGB").save(b,"JPEG")\nsys.stdout.buffer.write(b.getvalue())',
    ])
const links = await call('POST', `/api/trips/${trip.json.id}/photos/upload-links`, {
  files: [{ filename: 'prueba.jpg', contentType: 'image/jpeg', size: jpeg.length }],
})
const entry = links.json?.results?.[0]
if (!entry?.upload) throw new Error(`upload link: ${links.res.status} ${JSON.stringify(links.json)}`)
log(`upload link for photo ${entry.photoId}`)

const form = new FormData()
for (const [k, v] of Object.entries(entry.upload.fields)) form.append(k, v as string)
form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'prueba.jpg') // the file part goes last
const post = await fetch(entry.upload.url, { method: 'POST', body: form, headers: { origin: process.env.SPA_ORIGIN ?? 'http://localhost:5173' } })
log(`POST to S3: ${post.status} (CORS origin header: ${post.headers.get('access-control-allow-origin')})`)
if (post.status !== 204) throw new Error(`S3 POST ${post.status}: ${await post.text()}`)

let photo: any
const states: string[] = []
for (let i = 0; i < 180; i++) {
  const t = await call('GET', `/api/trips/${trip.json.id}`)
  photo = t.json.photos.find((p: any) => p.id === entry.photoId)
  if (states.at(-1) !== photo.status) {
    states.push(photo.status)
    log(`photo is ${photo.status}`)
  }
  if (photo.status === 'ready' || photo.status === 'failed') break
  await new Promise((r) => setTimeout(r, 2000))
}
if (photo.status !== 'ready') throw new Error(`photo ended ${photo.status}: ${photo.failureReason}`)
log(`ready ${photo.width}x${photo.height} takenAt ${photo.takenAt} thumb ${photo.thumbnailUrl}`)

const session = await call('POST', '/api/media-session')
const cookies = (session.res.headers.getSetCookie() as string[]).map((c) => c.split(';')[0]).join('; ')
const denied = await fetch(media + photo.thumbnailUrl)
const thumb = await fetch(media + photo.thumbnailUrl, { headers: { cookie: cookies } })
const large = await fetch(media + photo.largeUrl, { headers: { cookie: cookies } })
log(`media without cookies ${denied.status}; thumb ${thumb.status} ${thumb.headers.get('content-type')} ${(await thumb.arrayBuffer()).byteLength} B; large ${large.status} ${large.headers.get('content-type')}`)
if (denied.status !== 403 || thumb.status !== 200 || large.status !== 200) throw new Error('media check failed')

// Failure path: bytes that are not an image. The workflow must catch UnreadableImage into MarkFailed.
const junk = Buffer.from('this is not a jpeg, just text pretending to be one'.repeat(40))
const badLinks = await call('POST', `/api/trips/${trip.json.id}/photos/upload-links`, {
  files: [{ filename: 'rota.jpg', contentType: 'image/jpeg', size: junk.length }],
})
const bad = badLinks.json?.results?.[0]
if (!bad?.upload) throw new Error(`upload link (corrupt): ${badLinks.res.status} ${JSON.stringify(badLinks.json)}`)
const badForm = new FormData()
for (const [k, v] of Object.entries(bad.upload.fields)) badForm.append(k, v as string)
badForm.append('file', new Blob([junk], { type: 'image/jpeg' }), 'rota.jpg')
const badPost = await fetch(bad.upload.url, { method: 'POST', body: badForm, headers: { origin: process.env.SPA_ORIGIN ?? 'http://localhost:5173' } })
if (badPost.status !== 204) throw new Error(`S3 POST (corrupt) ${badPost.status}`)
log(`corrupt upload for photo ${bad.photoId} posted`)
let failed: any
for (let i = 0; i < 90; i++) {
  const t = await call('GET', `/api/trips/${trip.json.id}`)
  failed = t.json.photos.find((p: any) => p.id === bad.photoId)
  if (failed.status === 'failed' || failed.status === 'ready') break
  await new Promise((r) => setTimeout(r, 2000))
}
log(`corrupt photo is ${failed.status}, failureReason ${JSON.stringify(failed.failureReason)}`)
if (failed.status !== 'failed' || !failed.failureReason) throw new Error('corrupt photo did not reach failed with a reason')
const again = await call('GET', `/api/trips/${trip.json.id}`)
if (again.json.photos.find((p: any) => p.id === photo.id)?.status !== 'ready') throw new Error('the good photo is no longer ready')
log('good photo still ready')

// ---- Ticket 11: HEIC, EXIF date taken, and retry ----
const fixtures = fileURLToPath(new URL('../../backend/processing/tests/fixtures/', import.meta.url))
const origin = process.env.SPA_ORIGIN ?? 'http://localhost:5173'
const upload = async (filename: string, contentType: string, bytes: Buffer) => {
  const l = await call('POST', `/api/trips/${trip.json.id}/photos/upload-links`, {
    files: [{ filename, contentType, size: bytes.length }],
  })
  const e = l.json?.results?.[0]
  if (!e?.upload) throw new Error(`upload link (${filename}): ${l.res.status} ${JSON.stringify(l.json)}`)
  const f = new FormData()
  for (const [k, v] of Object.entries(e.upload.fields)) f.append(k, v as string)
  f.append("file", new Blob([new Uint8Array(bytes)]), filename)
  const r = await fetch(e.upload.url, { method: 'POST', body: f, headers: { origin } })
  if (r.status !== 204) throw new Error(`S3 POST (${filename}) ${r.status}: ${await r.text()}`)
  return e.photoId as string
}
const settle = async (photoId: string, from = Date.now()) => {
  let p: any
  for (let i = 0; i < 120; i++) {
    const t = await call('GET', `/api/trips/${trip.json.id}`)
    p = t.json.photos.find((x: any) => x.id === photoId)
    if (!p) throw new Error(`photo ${photoId} is not in the trip any more`)
    if (p.status === 'ready' || p.status === 'failed') break
    await new Promise((r) => setTimeout(r, 1000))
  }
  return { p, seconds: (Date.now() - from) / 1000 }
}

// HEIC (no content type sent: the extension decides) -> ready with WebP versions, EXIF date.
const heicStart = Date.now()
const heicId = await upload('samsung.heic', '', readFileSync(fixtures + 'sample.heic'))
const heic = await settle(heicId, heicStart)
log(`HEIC photo is ${heic.p.status} in ${heic.seconds.toFixed(1)}s, takenAt ${heic.p.takenAt}, ${heic.p.width}x${heic.p.height}`)
if (heic.p.status !== 'ready') throw new Error(`HEIC ended ${heic.p.status}: ${heic.p.failureReason}`)
if (heic.p.takenAt !== '2022-12-25T15:00:00Z') throw new Error(`HEIC takenAt ${heic.p.takenAt}`)
const heicSession = await call('POST', '/api/media-session')
const heicCookies = (heicSession.res.headers.getSetCookie() as string[]).map((c) => c.split(';')[0]).join('; ')
for (const u of [heic.p.thumbnailUrl, heic.p.largeUrl]) {
  const r = await fetch(media + u, { headers: { cookie: heicCookies } })
  const type = r.headers.get('content-type')
  log(`HEIC version ${u}: ${r.status} ${type} ${(await r.arrayBuffer()).byteLength} B`)
  if (r.status !== 200 || type !== 'image/webp') throw new Error(`HEIC version ${u} is not a WebP`)
}

// JPEG with EXIF DateTimeOriginal 2024:07:14 18:30:05 +02:00 -> takenAt 2024-07-14T16:30:05Z.
const exifStart = Date.now()
const exifId = await upload('dated.jpg', 'image/jpeg', readFileSync(fixtures + 'dated.jpg'))
const exif = await settle(exifId, exifStart)
log(`EXIF JPEG is ${exif.p.status} in ${exif.seconds.toFixed(1)}s, takenAt ${exif.p.takenAt}`)
if (exif.p.status !== 'ready' || exif.p.takenAt !== '2024-07-14T16:30:05Z') throw new Error(`EXIF takenAt ${exif.p.takenAt} (${exif.p.status})`)

// Retry: the corrupt photo (failed above) goes back to processing, the real StartExecution runs, it fails again.
const retryStart = Date.now()
const retry = await call('POST', `/api/trips/${trip.json.id}/photos/${bad.photoId}/retry`)
log(`POST retry: ${retry.res.status} status ${retry.json?.status}`)
if (retry.res.status !== 200 || retry.json?.status !== 'processing') throw new Error(`retry ${retry.res.status} ${JSON.stringify(retry.json)}`)
const again2 = await settle(bad.photoId, retryStart)
log(`after retry the corrupt photo is ${again2.p.status} in ${again2.seconds.toFixed(1)}s, ${JSON.stringify(again2.p.failureReason)}`)
if (again2.p.status !== 'failed' || !again2.p.failureReason) throw new Error('retried corrupt photo did not fail again')
const notFailed = await call('POST', `/api/trips/${trip.json.id}/photos/${photo.id}/retry`)
log(`retry on a ready photo: ${notFailed.res.status} ${JSON.stringify(notFailed.json)}`)
if (notFailed.res.status !== 409) throw new Error('retry on a ready photo should be 409')
// Step Functions retries (spec #11): a transient handler error is retried with backoff, UnreadableImage is final.
// Floci has no fault injection, so the transient error is a missing original: ProcessImage raises an S3
// ClientError (NoSuchKey) until the file is back. Retries wait 2 s, 4 s, 8 s, so three attempts take about 14 s.
const s3 = new S3Client({ endpoint: stack.endpoint, region: 'eu-west-1', forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
const originalKey = (id: string) => `originals/${trip.json.id}/${id}`
const unreadableSeconds = again2.seconds
log(`UnreadableImage reached failed in ${unreadableSeconds.toFixed(1)}s (no backoff wait)`)
if (unreadableSeconds >= 8) throw new Error(`UnreadableImage took ${unreadableSeconds}s: it looks retried`)

// A. Transient: the original is missing at first and comes back 5 s later. The retry must find it and finish `ready`.
await s3.send(new DeleteObjectCommand({ Bucket: stack.photoBucketName, Key: originalKey(bad.photoId) }))
const transientStart = Date.now()
const r1 = await call('POST', `/api/trips/${trip.json.id}/photos/${bad.photoId}/retry`)
if (r1.res.status !== 200) throw new Error(`retry (transient) ${r1.res.status}`)
await new Promise((r) => setTimeout(r, 5000))
await s3.send(new PutObjectCommand({ Bucket: stack.photoBucketName, Key: originalKey(bad.photoId), Body: jpeg, ContentType: 'image/jpeg' }))
const recovered = await settle(bad.photoId, transientStart)
log(`transient error: photo is ${recovered.p.status} after ${recovered.seconds.toFixed(1)}s`)
if (recovered.p.status !== 'ready') throw new Error(`transient error not recovered: ${recovered.p.status} ${recovered.p.failureReason}`)

// B. Permanent handler error: the original never comes back. All retries are used, then MarkFailed.
const gone = await upload('rota2.jpg', 'image/jpeg', junk)
await settle(gone) // UnreadableImage: failed
await s3.send(new DeleteObjectCommand({ Bucket: stack.photoBucketName, Key: originalKey(gone) }))
const permanentStart = Date.now()
const r2 = await call('POST', `/api/trips/${trip.json.id}/photos/${gone}/retry`)
if (r2.res.status !== 200) throw new Error(`retry (permanent) ${r2.res.status}`)
const exhausted = await settle(gone, permanentStart)
log(`handler error: photo is ${exhausted.p.status} after ${exhausted.seconds.toFixed(1)}s, ${JSON.stringify(exhausted.p.failureReason)}`)
if (exhausted.p.status !== 'failed' || !/processing-error/.test(exhausted.p.failureReason)) throw new Error('missing original did not end failed with processing-error')
if (exhausted.seconds < 12) throw new Error(`handler error failed after ${exhausted.seconds}s: it was not retried with backoff`)

console.log('PROOF OK')
