import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { emptyAlbum, fillTrip } from './support/album'
import { memberFor } from './support/members'
import { snap } from './support/screenshots'
import { isoDay, signIn } from './support/session'

const fixture = (n: number) => fileURLToPath(new URL(`./fixtures/playa-${n}.jpg`, import.meta.url))

// Processing runs as Step Functions + arm64 Python Lambdas on Floci: up to ~60 s cold. Poll, never sleep.
const PROCESSING = { timeout: 240_000 }

test.setTimeout(600_000)

async function createPastTrip(page: Page) {
  await page.goto('/trips/new')
  await fillTrip(page, { title: 'Verano en Tenerife', destination: 'Tenerife', start: isoDay(-60), end: isoDay(-52) })
  await page.getByRole('button', { name: 'Guardar viaje' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Verano en Tenerife' })).toBeVisible()
}

const fotoParam = (page: Page) => new URL(page.url()).searchParams.get('foto')
const viewer = (page: Page) => page.getByRole('dialog', { name: 'Fotos de «Verano en Tenerife»' })

/** The ready Photos' ids in grid order, which is the API's date-taken order. */
const readyIds = (page: Page) =>
  page.locator('[data-tile][data-state="ready"] [data-photo-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-photo-id') ?? ''))

/** A touch swipe on the Photo area, as pointer events (Playwright has no touch drag). */
async function swipe(page: Page, from: number, to: number) {
  await page.locator('[data-photo-area]').evaluate(async (el, [a, b]) => {
    const fire = (type: string, x: number) =>
      el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: x, clientY: 400, bubbles: true }))
    fire('pointerdown', a)
    const step = (b - a) / 8
    for (let i = 1; i <= 8; i++) {
      fire('pointermove', a + step * i)
      await new Promise((r) => setTimeout(r, 16))
    }
    fire('pointerup', b)
  }, [from, to])
}

async function uploadAndWait(page: Page, files: Parameters<ReturnType<Page['getByTestId']>['setInputFiles']>[0], ready: number) {
  await page.getByTestId('photo-input').setInputFiles(files)
  await expect(page.locator('[data-tile][data-state="ready"]')).toHaveCount(ready, PROCESSING)
  await expect
    .poll(() => page.locator('[data-tile] img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)), PROCESSING)
    .toBe(true)
}

test('a Member goes through the Photos, captions one, deletes Photos and a Trip with Photos', async ({ page }, testInfo) => {
  const warnings: string[] = []
  page.on('console', (m) => m.type() === 'warning' && /GSAP|Invalid scope/.test(m.text()) && warnings.push(m.text()))
  await signIn(page, testInfo.project.name)
  await emptyAlbum(page)
  await createPastTrip(page)
  await uploadAndWait(page, [1, 2, 3, 4].map(fixture), 4)

  // A Photo that cannot be developed.
  await page.getByTestId('photo-input').setInputFiles([{ name: 'rota.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not really a jpeg') }])
  await expect(page.locator('[data-tile][data-state="failed"]')).toHaveCount(1, PROCESSING)

  const ids = await readyIds(page)
  expect(ids).toHaveLength(4)
  const tripUrl = page.url()

  // Open the viewer from a tile; the URL carries the Photo.
  await page.locator(`[data-photo-id="${ids[0]}"]`).click()
  const dialog = viewer(page)
  await expect(dialog).toBeVisible()
  expect(fotoParam(page)).toBe(ids[0])
  await expect(dialog.getByRole('button', { name: 'Cerrar' })).toBeFocused()
  await expect(dialog.getByText('1 de 4').locator('visible=true')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Foto anterior' })).toHaveCount(0) // no wrap-around
  await expect(dialog.locator('img[data-large]')).toBeVisible()
  await expect.poll(() => dialog.locator('img[data-large]').evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(dialog.getByText(/^Subida por (Leo|Ana)$/)).toBeVisible()
  await expect(dialog.getByText(`Subida por ${memberFor(testInfo.project.name).displayName}`)).toBeVisible()
  await snap(page, testInfo, 'viewer-open')

  // Arrows, the buttons and a swipe, always in date-taken order.
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => fotoParam(page)).toBe(ids[1])
  await dialog.getByRole('button', { name: 'Foto siguiente' }).click()
  await expect.poll(() => fotoParam(page)).toBe(ids[2])
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => fotoParam(page)).toBe(ids[1])
  await swipe(page, 300, 80) // swipe left: next
  await expect.poll(() => fotoParam(page)).toBe(ids[2])
  await swipe(page, 80, 300) // swipe right: previous
  await expect.poll(() => fotoParam(page)).toBe(ids[1])
  await page.keyboard.press('End')
  await expect.poll(() => fotoParam(page)).toBe(ids[3])
  await expect(dialog.getByRole('button', { name: 'Foto siguiente' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Foto anterior' })).toBeFocused() // focus goes to the arrow still there
  await page.keyboard.press('Home')
  await expect.poll(() => fotoParam(page)).toBe(ids[0])
  await expect(dialog.getByRole('button', { name: 'Foto siguiente' })).toBeFocused()

  // Escape closes and focus returns to that Photo's tile.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(fotoParam(page)).toBeNull()
  await expect(page.locator(`[data-photo-id="${ids[0]}"]`)).toBeFocused()

  // The browser Back closes it too.
  await page.locator(`[data-photo-id="${ids[2]}"]`).click()
  await expect(dialog).toBeVisible()
  await page.goBack()
  await expect(dialog).toHaveCount(0)
  expect(page.url()).toBe(tripUrl)
  await page.locator(`[data-photo-id="${ids[2]}"]`).click()
  await dialog.getByRole('button', { name: 'Cerrar' }).click()
  await expect(dialog).toHaveCount(0)

  // A caption: add it, see it, reload and see it again.
  await page.locator(`[data-photo-id="${ids[1]}"]`).click()
  await dialog.getByRole('button', { name: 'Añadir una frase' }).click()
  const field = dialog.getByLabel('Una frase para esta foto')
  await expect(field).toBeFocused()
  await field.fill('El atardecer más bonito del viaje')
  await snap(page, testInfo, 'viewer-caption-editor')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog.getByText('El atardecer más bonito del viaje')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Editar frase' })).toBeFocused()
  await snap(page, testInfo, 'viewer-caption')
  await page.reload()
  await expect(viewer(page)).toBeVisible() // the link opens the viewer again
  await expect(viewer(page).getByText('El atardecer más bonito del viaje')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toHaveCount(0)
  await expect(page.locator(`[data-photo-id="${ids[1]}"]`)).toHaveAttribute('aria-label', 'El atardecer más bonito del viaje')

  // Too long a caption is refused in Spanish; clearing one removes it.
  await page.locator(`[data-photo-id="${ids[1]}"]`).click()
  await viewer(page).getByRole('button', { name: 'Editar frase' }).click()
  await viewer(page).getByLabel('Una frase para esta foto').fill('a'.repeat(501))
  await viewer(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(viewer(page).getByRole('alert')).toContainText('caben 500 caracteres como mucho')
  await viewer(page).getByLabel('Una frase para esta foto').fill('')
  await viewer(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(viewer(page).getByRole('button', { name: 'Añadir una frase' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Delete a Photo from the viewer, after confirming; "Mejor no" keeps it.
  await page.locator(`[data-photo-id="${ids[1]}"]`).click()
  await viewer(page).getByRole('button', { name: 'Borrar' }).click()
  const confirm = page.getByRole('alertdialog', { name: '¿Borramos esta foto?' })
  await expect(confirm).toBeVisible()
  await expect(confirm.getByRole('button', { name: 'Mejor no' })).toBeFocused()
  await snap(page, testInfo, 'viewer-delete-dialog')
  await confirm.getByRole('button', { name: 'Mejor no' }).click()
  await expect(confirm).toHaveCount(0)
  expect(fotoParam(page)).toBe(ids[1])
  await expect(viewer(page).getByRole('button', { name: 'Borrar' })).toBeFocused() // focus comes back to where it was
  // Escape right as the dialog appears closes only the dialog, not the viewer.
  await viewer(page).getByRole('button', { name: 'Borrar' }).click()
  await expect(confirm).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  await expect(viewer(page)).toBeVisible()
  expect(fotoParam(page)).toBe(ids[1])
  await expect(viewer(page).getByRole('button', { name: 'Borrar' })).toBeFocused()
  await viewer(page).getByRole('button', { name: 'Borrar' }).click()
  await viewer(page).evaluate((el) => el.setAttribute('data-same-node', 'yes'))
  await confirm.getByRole('button', { name: 'Sí, borrarla' }).click()
  await expect(confirm).toHaveCount(0)
  await expect.poll(() => fotoParam(page)).toBe(ids[2]) // the next Photo takes its place
  await expect(viewer(page)).toHaveAttribute('data-same-node', 'yes') // the viewer did not remount
  await expect(viewer(page).locator('[aria-live]')).toContainText('Foto borrada')
  await page.keyboard.press('Escape')
  await expect(page.locator(`[data-photo-id="${ids[1]}"]`)).toHaveCount(0)
  await expect(page.getByText('3 fotos · 1 sin revelar', { exact: true })).toBeVisible()

  // Remove the failed tile through its dialog (MASTER section 43): never two dialogs at once.
  const failedTile = page.getByRole('button', { name: /^Sin revelar: «rota\.jpg»/ })
  await failedTile.click()
  const retryDialog = page.getByRole('dialog', { name: 'Esta foto se nos ha resistido' })
  await snap(page, testInfo, 'failed-dialog-with-remove')
  await retryDialog.getByRole('button', { name: 'Quitarla del viaje' }).click()
  const quit = page.getByRole('alertdialog', { name: '¿Quitamos esta foto?' })
  await expect(quit).toContainText('«rota.jpg» no se ha podido revelar.')
  await expect(retryDialog).toHaveCount(0)
  await snap(page, testInfo, 'failed-delete-dialog')
  await quit.getByRole('button', { name: 'Mejor no' }).click()
  await expect(failedTile).toBeFocused() // focus back on the tile
  await failedTile.click()
  await retryDialog.getByRole('button', { name: 'Quitarla del viaje' }).click()
  await quit.getByRole('button', { name: 'Sí, quitarla' }).click()
  await expect(page.locator('[data-tile]')).toHaveCount(3)
  await expect(page.locator('[data-tile][data-state="failed"]')).toHaveCount(0)

  await snap(page, testInfo, 'photos-after-deletes')

  expect(warnings).toEqual([])

  // Still gone after a reload.
  await page.reload()
  await expect(page.locator('[data-tile][data-state="ready"]')).toHaveCount(3)
  await expect(page.locator('[data-tile]')).toHaveCount(3)

  // Delete the Trip with its Photos.
  await page.getByRole('button', { name: 'Borrar', exact: true }).click()
  const tripDialog = page.getByRole('alertdialog', { name: /¿Borramos «Verano en Tenerife»\?/ })
  await expect(tripDialog).toContainText('con sus 3 fotos')
  await snap(page, testInfo, 'trip-delete-with-photos')
  await tripDialog.getByRole('button', { name: 'Sí, borrarlo' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Hemos borrado' })).toBeVisible()
  await expect(page.locator('a[data-card]')).toHaveCount(0)
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the viewer opens, moves and closes with fades only', async ({ page }, testInfo) => {
    await signIn(page, testInfo.project.name)
    await emptyAlbum(page)
    await createPastTrip(page)
    await uploadAndWait(page, [1, 2].map(fixture), 2)
    const ids = await readyIds(page)

    await page.locator(`[data-photo-id="${ids[0]}"]`).click()
    await expect(viewer(page)).toBeVisible()
    await snap(page, testInfo, 'viewer-open-reduced-motion')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => fotoParam(page)).toBe(ids[1])
    await swipe(page, 300, 200) // past 50px, no following the finger
    await expect.poll(() => fotoParam(page)).toBe(ids[1]) // already the last one: stays
    await swipe(page, 100, 300)
    await expect.poll(() => fotoParam(page)).toBe(ids[0])
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toHaveCount(0)
    await emptyAlbum(page)
  })
})
