import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { emptyAlbum, fillTrip } from './support/album'
import { snap } from './support/screenshots'
import { isoDay, signIn } from './support/session'

const fixture = (n: number) => fileURLToPath(new URL(`./fixtures/playa-${n}.jpg`, import.meta.url))
const FOUR = [1, 2, 3, 4].map(fixture)
const bytes = (file: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)))

// Processing runs as Step Functions + arm64 Python Lambdas on Floci: up to ~60 s cold. Poll, never sleep.
const PROCESSING = { timeout: 240_000 }

test.setTimeout(480_000)

async function createPastTrip(page: Page) {
  await page.goto('/trips/new')
  await fillTrip(page, { title: 'Verano en Tenerife', destination: 'Tenerife', start: isoDay(-60), end: isoDay(-52) })
  await page.getByRole('button', { name: 'Guardar viaje' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Verano en Tenerife' })).toBeVisible()
}

/** Slows the browser's uploads so the per-file progress can be seen (Chromium only). */
async function throttleUploads(page: Page, bytesPerSecond: number) {
  const client = await page.context().newCDPSession(page)
  await client.send('Network.enable')
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: -1,
    uploadThroughput: bytesPerSecond,
  })
}

async function journey(page: Page, project: string, shot: (name: string) => Promise<void>) {
  await signIn(page, project)
  await emptyAlbum(page)
  await createPastTrip(page)
  const tripUrl = page.url()

  // Empty state of a past Trip.
  await expect(page.getByRole('heading', { name: 'Aún no hay fotos de este viaje' })).toBeVisible()
  await expect(page.getByText('JPG, PNG, WebP o HEIC, hasta 30 MB cada una.')).toBeVisible()
  await shot('photos-empty')

  const input = page.getByTestId('photo-input')

  // A wrong type, an oversized file and an empty one are refused in Spanish, and never become tiles.
  await input.setInputFiles([
    { name: 'video-del-viaje.mov', mimeType: 'video/quicktime', buffer: Buffer.from('not a photo') },
    { name: 'panoramica-enorme.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(31_457_281) },
    { name: 'vacia.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
  ])
  const refusals = page.locator('[data-refusals]')
  await expect(refusals).toBeVisible()
  await expect(refusals).toContainText('No hemos podido subir 3 fotos')
  await expect(refusals).toContainText('«video-del-viaje.mov» no es una foto que sepamos abrir. Por ahora solo JPG, PNG, WebP o HEIC.')
  await expect(refusals).toContainText('«panoramica-enorme.jpg» pesa más de 30 MB y no nos cabe. ¿Tienes una versión más ligera?')
  await expect(refusals).toContainText('«vacia.png» está vacía. Puede que no se haya copiado bien.')
  await expect(page.locator('[data-tile]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Aún no hay fotos de este viaje' })).toBeVisible()
  await shot('photos-refused')
  await refusals.getByRole('button', { name: 'Entendido' }).click()
  await expect(refusals).toHaveCount(0)

  // Pick several photos at once. A marker proves the page never reloads while they turn into thumbnails.
  await page.evaluate(() => {
    ;(window as unknown as { __noReload: boolean }).__noReload = true
  })
  await throttleUploads(page, 15_000)
  await input.setInputFiles(FOUR)
  const tiles = page.locator('[data-tile]')
  await expect(tiles).toHaveCount(4)
  await expect(page.getByRole('heading', { name: 'Aún no hay fotos de este viaje' })).toHaveCount(0)

  // Per-file progress, and the bar that says not to close the app.
  const bar = page.locator('[data-upload-bar]')
  await expect(bar).toContainText('Subiendo')
  await expect(page.getByRole('progressbar', { name: /^Subiendo playa-\d\.jpg$/ }).first()).toBeVisible()
  await shot('photos-uploading')
  await expect(page.locator('[data-tile][data-state="uploading"]').first()).toBeVisible()

  // Sent: the bar reassures; the tiles are being "developed".
  await throttleUploads(page, -1)
  await expect(bar).toContainText('¡4 fotos a salvo!', PROCESSING)
  await expect(bar).toContainText('Ya puedes cerrar la app.')

  // Placeholders turn into thumbnails with no reload.
  await expect(tiles.locator('img')).toHaveCount(4, PROCESSING)
  await expect(page.locator('[data-tile][data-state="ready"]')).toHaveCount(4, PROCESSING)
  await expect
    .poll(() => tiles.locator('img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)), PROCESSING)
    .toBe(true)
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
  await expect(page.getByText('4 fotos', { exact: true })).toBeVisible()
  await expect(tiles.locator('img').first()).toHaveAttribute('alt', /^Foto del \d{1,2} [a-z]{3} \d{4}$/)
  await shot('photos-ready')

  // The Trip page Cover now shows the first Photo.
  await expect(page.getByTestId('trip-cover').locator('img')).toBeVisible()

  // Media without the signed cookies is refused; with the Member's own cookies it is served.
  const thumb = await tiles.locator('img').first().getAttribute('src')
  expect(thumb).toMatch(/^\/media\//)
  const anonymous = await page.context().browser()!.newContext({ baseURL: page.url() })
  const refused = await anonymous.request.get(thumb!)
  expect(refused.status()).toBe(403)
  await anonymous.close()
  const allowed = await page.request.get(thumb!)
  expect(allowed.status()).toBe(200)
  expect(allowed.headers()['content-type']).toContain('image/webp')

  // The Album card shows the Cover photo and the count.
  await page.getByRole('link', { name: 'Volver al álbum' }).click()
  const card = page.locator('a[data-card]').first()
  await expect(card).toContainText('4 fotos')
  await expect(card.locator('img')).toBeVisible()
  await expect(page.getByTestId('cover-placeholder')).toHaveCount(0)
  await shot('album-with-cover')

  // Coming back: the Photos are there at once, nothing to wait for.
  await page.goto(tripUrl)
  await expect(page.locator('[data-tile][data-state="ready"]')).toHaveCount(4)
  await emptyAlbum(page)
}

test('a Member uploads several photos and watches them turn into thumbnails', async ({ page }, testInfo) => {
  await journey(page, testInfo.project.name, (name) => snap(page, testInfo, name))
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the same upload journey works', async ({ page }, testInfo) => {
    await journey(page, testInfo.project.name, (name) => snap(page, testInfo, `${name}-reduced-motion`))
  })
})

test('a failed link request shows a friendly message and Reintentar recovers', async ({ page }, testInfo) => {
  await signIn(page, testInfo.project.name)
  await emptyAlbum(page)
  await createPastTrip(page)
  let fail = true
  await page.route('**/photos/upload-links', (route) => {
    if (!fail) return route.continue()
    fail = false
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"boom in english"}}' })
  })
  await page.getByTestId('photo-input').setInputFiles([fixture(1)])
  await expect(page.getByRole('alert').filter({ hasText: 'No hemos podido preparar la subida. ¿Probamos otra vez?' })).toBeVisible()
  await expect(page.getByText('boom in english')).toHaveCount(0)
  await expect(page.locator('[data-tile][data-state="queued"]')).toHaveCount(1)
  await snap(page, testInfo, 'photos-links-error')
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.locator('[data-tile][data-state="ready"]')).toHaveCount(1, PROCESSING)
  await emptyAlbum(page)
})

test('a corrupt image ends in a "Sin revelar" tile that can be retried', async ({ page }, testInfo) => {
  await signIn(page, testInfo.project.name)
  await emptyAlbum(page)
  await createPastTrip(page)

  // Right type and name, wrong bytes: it passes the browser checks and fails in processing.
  await page.getByTestId('photo-input').setInputFiles([
    { name: 'rota.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not really a jpeg') },
  ])
  const tile = page.locator('[data-tile]')
  await expect(tile).toHaveCount(1)
  await expect(page.locator('[data-tile][data-state="failed"]')).toHaveCount(1, PROCESSING)
  await expect(tile).toContainText('Sin revelar')
  await expect(tile).not.toContainText('No hemos podido revelarla')
  await expect(page.getByText('1 sin revelar', { exact: true })).toBeVisible()
  const note = page.locator('[data-failed-note]')
  await expect(note).toContainText('1 foto no se ha podido revelar')
  await expect(note.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await snap(page, testInfo, 'photos-failed')

  // The dialog gives the reason in Spanish, never the raw one.
  const open = tile.getByRole('button', { name: 'Sin revelar: «rota.jpg». Ver opciones' })
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Esta foto se nos ha resistido' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('No hemos sabido abrirla')
  await expect(dialog).toContainText('mejor la quitamos')
  await expect(dialog).not.toContainText('UnreadableImage')
  await expect(dialog.getByRole('button', { name: 'Probar otra vez' })).toBeFocused()
  await snap(page, testInfo, 'photos-failed-dialog')

  // A real retry: the API puts it back to processing, the workflow fails on the same file again.
  const retry = page.waitForResponse((r) => /\/photos\/[^/]+\/retry$/.test(r.url()) && r.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Probar otra vez' }).click()
  expect((await retry).status()).toBe(200)
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Volvemos a revelarla' })).toBeAttached()
  await expect(page.locator('[data-tile][data-state="failed"]')).toHaveCount(1, PROCESSING)
  await expect(page.getByRole('status').filter({ hasText: 'No hemos podido revelar «rota.jpg» tampoco esta vez.' })).toBeAttached()

  // Second try: the dialog says so.
  await open.click()
  await expect(dialog).toContainText('Ya lo hemos intentado otra vez y nada.')
  await snap(page, testInfo, 'photos-failed-second-try')
  await dialog.getByRole('button', { name: 'Ahora no' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(open).toBeFocused()

  // The page stops polling once nothing is left to wait for.
  const polls: string[] = []
  page.on('request', (r) => {
    if (/\/api\/trips\/[^/]+$/.test(new URL(r.url()).pathname) && r.method() === 'GET') polls.push(r.url())
  })
  await page.waitForTimeout(9000)
  expect(polls).toHaveLength(0)
  await emptyAlbum(page)
})

test('"Reintentar todas" retries every failed Photo at once, and a corrupt HEIC gets the same treatment', async ({ page }, testInfo) => {
  await signIn(page, testInfo.project.name)
  await emptyAlbum(page)
  await createPastTrip(page)
  await page.getByTestId('photo-input').setInputFiles([
    { name: 'rota-1.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a jpeg 1') },
    { name: 'rota-2.png', mimeType: 'image/png', buffer: Buffer.from('not a png 2') },
    { name: 'rota.heic', mimeType: '', buffer: bytes('rota.heic') },
  ])
  await expect(page.locator('[data-tile][data-state="failed"]')).toHaveCount(3, PROCESSING)
  const note = page.locator('[data-failed-note]')
  await expect(note).toContainText('3 fotos no se han podido revelar')
  await expect(page.getByText('3 sin revelar', { exact: true })).toBeVisible()
  await snap(page, testInfo, 'photos-failed-several')

  const retries: number[] = []
  page.on('response', (r) => {
    if (/\/photos\/[^/]+\/retry$/.test(r.url()) && r.request().method() === 'POST') retries.push(r.status())
  })
  await note.getByRole('button', { name: 'Reintentar todas' }).click()
  await expect.poll(() => retries.length).toBe(3)
  expect(retries).toEqual([200, 200, 200])
  // They fail again on the same bytes, and the note is still there.
  await expect(page.locator('[data-tile][data-state="failed"]')).toHaveCount(3, PROCESSING)
  await expect(note).toContainText('3 fotos no se han podido revelar')
  await emptyAlbum(page)
})

async function dateTakenJourney(page: Page, project: string, shot: (name: string) => Promise<void>) {
  await signIn(page, project)
  await emptyAlbum(page)
  await createPastTrip(page)

  // Picked newest first. Chromium derives image/heic from the extension itself, so the empty-type path
  // (some Android pickers) is covered by the upload-store unit test, not here.
  const linkRequests: string[] = []
  page.on('request', (r) => {
    if (r.url().endsWith('/photos/upload-links') && r.method() === 'POST') linkRequests.push(r.postData() ?? '')
  })
  await page.getByTestId('photo-input').setInputFiles([
    { name: 'sin-exif.jpg', mimeType: 'image/jpeg', buffer: bytes('sin-exif.jpg') },
    { name: 'exif-2024-07-14.jpg', mimeType: 'image/jpeg', buffer: bytes('exif-2024-07-14.jpg') },
    { name: 'exif-2023-01-02.jpg', mimeType: 'image/jpeg', buffer: bytes('exif-2023-01-02.jpg') },
    { name: 'IMG_2022.HEIC', mimeType: '', buffer: bytes('exif-2022-12-25.heic') },
  ])
  const ready = page.locator('[data-tile][data-state="ready"]')
  await expect(ready).toHaveCount(4, PROCESSING)
  expect(linkRequests.join('')).toContain('"filename":"IMG_2022.HEIC","contentType":"image/heic"')

  // The grid is in date-taken order whatever the pick order: oldest first, the file without a date last.
  const alts = () => page.locator('[data-tile] img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('alt')))
  await expect.poll(alts).toEqual([
    'Foto del 25 dic 2022',
    'Foto del 2 ene 2023',
    'Foto del 14 jul 2024',
    expect.stringMatching(/^Foto del \d{1,2} [a-z]{3} \d{4}$/),
  ])
  await expect
    .poll(() => page.locator('[data-tile] img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)), PROCESSING)
    .toBe(true)
  await shot('photos-date-order')

  // The HEIC was served as a WebP thumbnail any browser can show.
  const thumb = await page.locator('[data-tile] img').first().getAttribute('src')
  const served = await page.request.get(thumb!)
  expect(served.status()).toBe(200)
  expect(served.headers()['content-type']).toContain('image/webp')
  await emptyAlbum(page)
}

test('photos land in date-taken order and a HEIC upload comes out as a thumbnail', async ({ page }, testInfo) => {
  await dateTakenJourney(page, testInfo.project.name, (name) => snap(page, testInfo, name))
})

test.describe('date taken with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the same order, with no reorder animation', async ({ page }, testInfo) => {
    await dateTakenJourney(page, testInfo.project.name, (name) => snap(page, testInfo, `${name}-reduced-motion`))
  })
})
