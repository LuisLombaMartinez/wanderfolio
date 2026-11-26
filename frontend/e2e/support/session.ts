import { expect, type Page } from '@playwright/test'
import { NEW_PASSWORD, TEMPORARY_PASSWORD, memberFor, resetToTemporaryPassword } from './members'

/**
 * Logs the project's test Member in from a fresh first-login state and lands on the Album.
 *
 * Two assumptions made this flaky: the form was filled before the page had settled, and a single
 * Floci Cognito hiccup right after the password reset failed the whole test. So it waits for the
 * login screen first and, if the Album does not appear, resets the Member and goes through once more.
 */
export async function signIn(page: Page, project: string) {
  const member = memberFor(project)
  const album = page.getByRole('heading', { level: 1, name: 'Nuestro álbum' })
  for (let attempt = 1; ; attempt++) {
    try {
      await resetToTemporaryPassword(member.email)
      await page.goto('/login')
      await expect(page.getByRole('heading', { level: 1, name: 'Hola de nuevo, amor' })).toBeVisible()
      await page.getByLabel('Tu correo').fill(member.email)
      await page.getByLabel('Tu contraseña', { exact: true }).fill(TEMPORARY_PASSWORD)
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByLabel('Nueva contraseña').fill(NEW_PASSWORD)
      await page.getByLabel('Repítela').fill(NEW_PASSWORD)
      await page.getByRole('button', { name: 'Guardar y entrar' }).click()
      await expect(album).toBeVisible()
      return
    } catch (err) {
      if (attempt >= 2) throw err
    }
  }
}

/** A local calendar date `offset` days from today, as YYYY-MM-DD. */
export function isoDay(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
