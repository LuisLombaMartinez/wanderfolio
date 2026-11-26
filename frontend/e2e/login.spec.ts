import { expect, test, type Page } from '@playwright/test'
import { NEW_PASSWORD, TEMPORARY_PASSWORD, memberFor, resetToTemporaryPassword } from './support/members'
import { emptyAlbum } from './support/album'
import { snap } from './support/screenshots'
import { signIn } from './support/session'

async function logIn(page: Page, email: string, password: string) {
  await page.getByLabel('Tu correo').fill(email)
  await page.getByLabel('Tu contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

// Other specs may leave Trips behind: empty the Album, then log out so each journey starts logged out.
test.beforeEach(async ({ page }, testInfo) => {
  await signIn(page, testInfo.project.name)
  await emptyAlbum(page)
  await page.getByRole('button', { name: 'Salir' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

async function firstLoginJourney(page: Page, project: string, shot: (name: string) => Promise<void>) {
  const member = memberFor(project)
  await resetToTemporaryPassword(member.email)

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Hola de nuevo, amor' })).toBeVisible()
  await shot('login')

  // A wrong password is refused with a friendly message.
  await logIn(page, member.email, 'NoEsEsta#123')
  await expect(page.getByRole('alert')).toHaveText(/no nos suenan/)
  await shot('login-error')

  // The temporary password leads to choosing a new one.
  await logIn(page, member.email, TEMPORARY_PASSWORD)
  await expect(page.getByRole('heading', { level: 1, name: 'Elige tu contraseña' })).toBeVisible()
  await shot('new-password')

  await page.getByLabel('Nueva contraseña').fill(NEW_PASSWORD)
  await page.getByLabel('Repítela').fill('Otra#Distinta2026')
  await page.getByRole('button', { name: 'Guardar y entrar' }).click()
  await expect(page.getByRole('alert')).toHaveText('Las dos contraseñas no coinciden.')

  await page.getByLabel('Repítela').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Guardar y entrar' }).click()

  // The empty Album invites the Member to create the first Trip.
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Nuestro álbum' })).toBeVisible()
  await expect(page.getByText(`Hola, ${member.displayName}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Aquí empezará nuestra historia' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Crear nuestro primer viaje' })).toBeVisible()
  await shot('album-empty')

  // Reloading keeps the Member logged in.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Nuestro álbum' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)

  // Logging out goes back to the login page, and the Album is closed again.
  await page.getByRole('button', { name: 'Salir' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Hasta pronto')).toBeVisible()
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)

  // The new password now works straight away (no challenge).
  await logIn(page, member.email, NEW_PASSWORD)
  await expect(page.getByRole('heading', { level: 1, name: 'Nuestro álbum' })).toBeVisible()
}

test('a Member logs in with a temporary password, sets a new one, sees the empty Album, reloads and logs out', async ({
  page,
}, testInfo) => {
  await firstLoginJourney(page, testInfo.project.name, (name) => snap(page, testInfo, name))
})

test('if the API fails right after login, the Member sees a friendly error and can log in again', async ({
  page,
}, testInfo) => {
  const member = memberFor(testInfo.project.name)
  await resetToTemporaryPassword(member.email)
  let failNext = true
  await page.route('**/api/me', (route) => {
    if (!failNext) return route.continue()
    failNext = false
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":{"code":"unavailable","message":"x"}}',
    })
  })

  await page.goto('/login')
  await logIn(page, member.email, TEMPORARY_PASSWORD)
  await page.getByLabel('Nueva contraseña').fill(NEW_PASSWORD)
  await page.getByLabel('Repítela').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Guardar y entrar' }).click()

  await expect(page.getByRole('alert')).toHaveText('Algo ha fallado por el camino. Prueba otra vez.')
  await expect(page.getByRole('heading', { level: 1, name: 'Hola de nuevo, amor' })).toBeVisible()

  await logIn(page, member.email, NEW_PASSWORD)
  await expect(page.getByRole('heading', { level: 1, name: 'Nuestro álbum' })).toBeVisible()
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the same journey works and content shows without entrance animations', async ({ page }, testInfo) => {
    await page.goto('/login')
    // Nothing waits on an entrance tween: the card is fully visible on first paint.
    const card = page.getByTestId('login-card')
    await expect(card).toBeVisible()
    expect(await card.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

    await firstLoginJourney(page, testInfo.project.name, (name) => snap(page, testInfo, `${name}-reduced-motion`))
  })
})
