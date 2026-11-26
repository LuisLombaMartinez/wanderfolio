import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { emptyAlbum, fillTrip } from './support/album'
import { snap } from './support/screenshots'
import { isoDay, signIn } from './support/session'

const fixture = (n: number) => fileURLToPath(new URL(`./fixtures/playa-${n}.jpg`, import.meta.url))

// Processing runs as Step Functions + arm64 Python Lambdas on Floci: up to ~60 s cold. Poll, never sleep.
const PROCESSING = { timeout: 240_000 }

test.setTimeout(600_000)

const viewer = (page: Page) => page.getByRole('dialog', { name: 'Fotos de «Escapada a La Palma»' })
const tile = (page: Page, id: string) => page.locator(`[data-photo-id="${id}"]`)
const pageCover = (page: Page) => page.getByTestId('trip-cover').locator('img[data-cover-img]')
// While the cover crossfades two layers coexist; the newest one is last.
const photoPath = (src: string | null) => (src ?? '').split('?')[0]

/** The ready Photos' ids in grid order, which is the API's date-taken order. */
const readyIds = (page: Page) =>
  page.locator('[data-tile][data-state="ready"] [data-photo-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-photo-id') ?? ''))

/** The Photo id inside a /media/ address, whatever its size. */
const mediaId = (src: string | null) => photoPath(src).split('/').filter(Boolean).slice(-2)[0]

// Leave the Album as found: the Trip this journey creates must not leak into other specs.
test.afterEach(async ({ page }) => {
  await emptyAlbum(page)
})

test('a Member picks the Cover photo; the Album, the Trip page and the grid follow, and a delete falls back', async ({ page }, testInfo) => {
  const warnings: string[] = []
  page.on('console', (m) => m.type() === 'warning' && /GSAP|Invalid scope/.test(m.text()) && warnings.push(m.text()))
  await signIn(page, testInfo.project.name)
  await emptyAlbum(page)

  // A Trip without Photos shows the placeholder cover.
  await page.goto('/trips/new')
  await fillTrip(page, { title: 'Escapada a La Palma', destination: 'La Palma', start: isoDay(-40), end: isoDay(-34) })
  await page.getByRole('button', { name: 'Guardar viaje' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Escapada a La Palma' })).toBeVisible()
  await expect(page.getByTestId('cover-placeholder')).toBeVisible()

  await page.getByTestId('photo-input').setInputFiles([1, 2, 3].map(fixture))
  await expect(page.locator('[data-tile][data-state="ready"]')).toHaveCount(3, PROCESSING)
  await expect
    .poll(() => page.locator('[data-tile] img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)), PROCESSING)
    .toBe(true)
  const ids = await readyIds(page)
  expect(ids).toHaveLength(3)

  // By default the first ready Photo is the cover: the page cover shows it, its tile carries the "default" marker.
  await expect(pageCover(page).last()).toBeVisible(PROCESSING)
  await expect.poll(async () => mediaId(await pageCover(page).last().getAttribute('src'))).toBe(mediaId(await tile(page, ids[0]).locator('img').getAttribute('src')))
  await expect(page.locator('[data-cover-marker]')).toHaveCount(1)
  await expect(tile(page, ids[0]).locator('[data-cover-marker="default"]')).toHaveCount(1)
  await expect(tile(page, ids[0])).toHaveAttribute('aria-label', /, portada del viaje$/)
  await snap(page, testInfo, 'cover-default')

  // In the viewer: the first Photo says it is the cover by default; the last one offers the button.
  await tile(page, ids[0]).click()
  await expect(viewer(page).getByText('Portada por ser la primera')).toBeVisible()
  await expect(viewer(page).getByRole('button', { name: 'Usar como portada' })).toBeVisible()
  await page.keyboard.press('End')
  await expect(viewer(page).getByText('Portada por ser la primera')).toHaveCount(0)
  await expect(viewer(page).getByText('Nuestra portada')).toHaveCount(0)
  await snap(page, testInfo, 'cover-viewer-button')

  await viewer(page).getByRole('button', { name: 'Usar como portada' }).click()
  const badge = viewer(page).getByText('Nuestra portada')
  await expect(badge).toBeVisible()
  await expect(badge).toBeFocused()
  await expect(viewer(page).getByRole('button', { name: 'Usar como portada' })).toHaveCount(0)
  await expect(viewer(page).locator('[data-cover-notice]')).toHaveText('¡Nueva portada! Así nos verá el álbum.')
  await snap(page, testInfo, 'cover-viewer-chosen')

  // Close: the tile marker moved to the chosen Photo ("chosen" heart), and the page cover changed.
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
  await expect(page.locator('[data-cover-marker]')).toHaveCount(1)
  await expect(tile(page, ids[2]).locator('[data-cover-marker="chosen"]')).toHaveCount(1)
  await expect(tile(page, ids[2])).toHaveAttribute('aria-label', /, portada del viaje$/)
  await expect(tile(page, ids[0])).not.toHaveAttribute('aria-label', /portada/)
  await expect.poll(async () => mediaId(await pageCover(page).last().getAttribute('src'))).toBe(mediaId(await tile(page, ids[2]).locator('img').getAttribute('src')))
  await expect(pageCover(page)).toHaveCount(1) // the old image was removed once the new one loaded
  await snap(page, testInfo, 'cover-page-chosen')

  // It survives a reload and the Album card shows the same Photo's thumbnail.
  await page.reload()
  await expect(tile(page, ids[2]).locator('[data-cover-marker="chosen"]')).toHaveCount(1)
  await page.getByRole('link', { name: 'Volver al álbum' }).first().click()
  const card = page.locator('a[data-card]').first()
  await expect(card.locator('img[data-cover-img]').last()).toBeVisible()
  await expect.poll(async () => mediaId(await card.locator('img[data-cover-img]').last().getAttribute('src'))).toBe(ids[2])
  await snap(page, testInfo, 'cover-album-card')

  // Deleting the chosen Photo: the cover falls back to the first ready Photo, not chosen.
  await card.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Escapada a La Palma' })).toBeVisible()
  await tile(page, ids[2]).click()
  await viewer(page).getByRole('button', { name: 'Borrar' }).click()
  await page.getByRole('button', { name: 'Sí, borrarla' }).click()
  await expect.poll(() => readyIds(page)).toEqual([ids[0], ids[1]])
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
  await expect(page.locator('[data-cover-marker]')).toHaveCount(1)
  await expect(tile(page, ids[0]).locator('[data-cover-marker="default"]')).toHaveCount(1)
  await expect.poll(async () => mediaId(await pageCover(page).last().getAttribute('src'))).toBe(mediaId(await tile(page, ids[0]).locator('img').getAttribute('src')))
  await page.reload() // the server agrees with the local fallback
  await expect(tile(page, ids[0]).locator('[data-cover-marker="default"]')).toHaveCount(1)

  // Deleting every Photo brings the placeholder back.
  await tile(page, ids[0]).click()
  for (const id of [ids[0], ids[1]]) {
    await viewer(page).getByRole('button', { name: 'Borrar' }).click()
    await page.getByRole('button', { name: 'Sí, borrarla' }).click()
    await expect(tile(page, id)).toHaveCount(0)
  }
  await expect(viewer(page)).toHaveCount(0)
  await expect(page.getByTestId('cover-placeholder')).toBeVisible()
  expect(warnings).toEqual([])
})
