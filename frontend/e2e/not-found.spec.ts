import { expect, test } from '@playwright/test'
import { snap } from './support/screenshots'
import { signIn } from './support/session'

test('a Member on an unknown route sees the 404 and can go back to the Album', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  await signIn(page, project)

  await page.goto('/cualquier/cosa')
  const heading = page.getByRole('heading', { level: 1, name: 'Este camino no lleva a ningún sitio' })
  await expect(heading).toBeVisible()
  // The URL stays as typed; the title and focus follow the screen.
  await expect(page).toHaveURL(/\/cualquier\/cosa$/)
  await expect(page).toHaveTitle('Nos hemos perdido · Viajecito')
  await expect(heading).toBeFocused()
  await expect(page.getByText('Error 404 · página no encontrada')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible()
  // Wait for the entrance (the last staggered item reaches full opacity) and the plane's lap
  // (the orbit stops turning) instead of sleeping; both must be over before measuring or shooting.
  await expect(page.getByText('Error 404 · página no encontrada')).toHaveCSS('opacity', '1')
  const orbit = page.getByTestId('lost-compass-orbit')
  let previous = ''
  await expect
    .poll(async () => {
      const current = await orbit.evaluate((el) => getComputedStyle(el).transform)
      const settled = current === previous
      previous = current
      return settled
    }, { intervals: [250] })
    .toBe(true)
  // The whole screen fits without scrolling.
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
  expect(overflow).toBeLessThanOrEqual(0)
  await snap(page, testInfo, '404')

  // Everything is visible at once under reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(heading).toBeVisible()
  await expect(page.getByRole('link', { name: 'Volver al álbum' })).toBeVisible()
  await snap(page, testInfo, '404-reduced-motion')

  await page.getByRole('link', { name: 'Volver al álbum' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Nuestro álbum' })).toBeVisible()
})

test('a missing Trip keeps its own not-found card, now with the lost compass', async ({ page }, testInfo) => {
  await signIn(page, testInfo.project.name)
  await page.goto('/trips/no-existe')
  await expect(page.getByRole('heading', { name: 'Este viaje no está en nuestro álbum' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Volver al álbum' }).last()).toBeVisible()
  await snap(page, testInfo, 'trip-not-found')
})

test('moving between two unknown URLs refreshes the focus', async ({ page }, testInfo) => {
  await signIn(page, testInfo.project.name)
  await page.goto('/uno/perdido')
  const heading = page.getByRole('heading', { level: 1, name: 'Este camino no lleva a ningún sitio' })
  await expect(heading).toBeFocused()
  await heading.evaluate((el) => (el as HTMLElement).blur())
  await expect(heading).not.toBeFocused()
  await page.evaluate(() => {
    window.history.pushState({}, '', '/otro/perdido')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page).toHaveURL(/\/otro\/perdido$/)
  await expect(heading).toBeFocused()
})
