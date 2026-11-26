import { expect, test, type Page } from '@playwright/test'
import { emptyAlbum, fillTrip } from './support/album'
import { snap } from './support/screenshots'
import { isoDay, signIn } from './support/session'

async function journey(page: Page, project: string, shot: (name: string) => Promise<void>) {
  await signIn(page, project)
  await emptyAlbum(page)
  await expect(page.getByRole('heading', { name: 'Aquí empezará nuestra historia' })).toBeVisible()

  // Create a Trip from the empty Album.
  await page.getByRole('link', { name: 'Crear nuestro primer viaje' }).click()
  await expect(page).toHaveURL(/\/trips\/new$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Un viaje nuevo' })).toBeVisible()
  await shot('form-empty')

  // Friendly Spanish errors from the form, then from the end-before-start rule.
  await page.getByRole('button', { name: 'Guardar viaje' }).click()
  await expect(page.getByText('Ponle un nombre a nuestro viaje.')).toBeVisible()
  await expect(page.getByText('¿A dónde vamos? Falta el destino.')).toBeVisible()
  await expect(page.getByText('¿Cuándo empezamos? Elige una fecha.')).toBeVisible()
  await expect(page.getByLabel('Título')).toBeFocused()
  await shot('form-errors')

  const start = isoDay(21)
  await fillTrip(page, { title: 'Escapada a Lisboa', destination: 'Lisboa, Portugal', start, end: isoDay(20) })
  await page.getByRole('button', { name: 'Guardar viaje' }).click()
  await expect(page.getByText('La vuelta no puede ser antes de la ida.')).toBeVisible()
  await page.getByLabel('Termina el').fill(isoDay(30))
  await page.getByLabel('Descripción (opcional)').fill('Playa, paseos y mucho helado.\nY dormir hasta tarde.')
  await expect(page.getByText('10 días juntos')).toBeVisible()
  await shot('form-filled')
  await page.getByRole('button', { name: 'Guardar viaje' }).click()

  // The Trip page: upcoming, so it has the countdown (singular copy is covered by a unit-level check below).
  await expect(page.getByRole('heading', { level: 1, name: 'Escapada a Lisboa' })).toBeVisible()
  await expect(page).toHaveURL(/\/trips\/[^/]+$/)
  await expect(page.getByText('para estar juntos')).toBeVisible()
  await expect(page.getByText('Nuestro plan')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Aquí vivirán las fotos del viaje' })).toBeVisible()
  await shot('trip-upcoming')
  const tripUrl = page.url()

  // A past Trip too, to see the Album order and both placeholder states.
  await page.goto('/trips/new')
  await fillTrip(page, { title: 'Verano en Tenerife', destination: 'Tenerife', start: isoDay(-60), end: isoDay(-52) })
  await page.getByRole('button', { name: 'Guardar viaje' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Verano en Tenerife' })).toBeVisible()
  await expect(page.getByText('para estar juntos')).toHaveCount(0)
  await shot('trip-past')

  // The Album lists them newest first, each card with the placeholder.
  await page.getByRole('link', { name: 'Volver al álbum' }).click()
  const cards = page.locator('a[data-card]')
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(0)).toContainText('Escapada a Lisboa')
  await expect(cards.nth(0)).toContainText('Lisboa, Portugal')
  await expect(cards.nth(0)).toContainText('En 21 días')
  await expect(cards.nth(1)).toContainText('Verano en Tenerife')
  await expect(page.getByTestId('cover-placeholder')).toHaveCount(2)
  await expect(page.getByText('2 viajes juntos')).toBeVisible()
  await shot('album-trips')

  // Edit the upcoming Trip.
  await cards.nth(0).click()
  await expect(page).toHaveURL(tripUrl)
  await page.getByRole('link', { name: 'Editar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Editar viaje' })).toBeVisible()
  await expect(page.getByLabel('Título')).toHaveValue('Escapada a Lisboa')
  await shot('form-edit')
  await page.getByLabel('Título').fill('Escapada a Oporto')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Escapada a Oporto' })).toBeVisible()

  // Delete it after confirming; backing out first keeps it.
  await page.getByRole('button', { name: 'Borrar', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mejor no' })).toBeFocused()
  await shot('delete-dialog')
  await page.getByRole('button', { name: 'Mejor no' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Borrar', exact: true }).click()
  await page.getByRole('button', { name: 'Sí, borrarlo' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('status').filter({ hasText: 'Hemos borrado «Escapada a Oporto» del álbum.' })).toBeVisible()
  await expect(cards).toHaveCount(1)
  await shot('album-after-delete')

  // The deleted Trip's link now says it is gone.
  await page.goto(tripUrl)
  await expect(page.getByRole('heading', { name: 'Este viaje no está en nuestro álbum' })).toBeVisible()
  await shot('trip-not-found')

  await emptyAlbum(page)
}

test('a Member creates, sees, edits and deletes Trips', async ({ page }, testInfo) => {
  await journey(page, testInfo.project.name, (name) => snap(page, testInfo, name))
})

test('API failures show a friendly Spanish message', async ({ page }, testInfo) => {
  await signIn(page, testInfo.project.name)
  await emptyAlbum(page)
  await page.goto('/trips/new')
  await fillTrip(page, { title: 'Fallo', destination: 'Nunca', start: isoDay(5), end: isoDay(6) })
  await page.route('**/api/trips', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"error":{"code":"internal","message":"boom in english"}}',
        })
      : route.continue(),
  )
  await page.getByRole('button', { name: 'Guardar viaje' }).click()
  await expect(page.locator('form').getByRole('alert')).toHaveText('Algo ha fallado por el camino. ¿Probamos otra vez?')
  await expect(page.getByText('boom in english')).toHaveCount(0)
  await snap(page, testInfo, 'form-api-error')

  // A listing failure shows the Album error card, and Reintentar recovers.
  await page.unroute('**/api/trips')
  let fail = true
  await page.route('**/api/trips', (route) => {
    if (route.request().method() !== 'GET' || !fail) return route.continue()
    fail = false
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"x"}}' })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No hemos podido abrir el álbum' })).toBeVisible()
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByRole('heading', { name: 'Aquí empezará nuestra historia' })).toBeVisible()
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the same journey works and content shows at once', async ({ page }, testInfo) => {
    await journey(page, testInfo.project.name, (name) => snap(page, testInfo, `${name}-reduced-motion`))
  })
})
