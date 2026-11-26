import { expect, type Page } from '@playwright/test'

/** Removes any Trip left in the Album through the UI, so each journey starts from the empty Album. */
export async function emptyAlbum(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Nuestro álbum' })).toBeVisible()
  for (;;) {
    const cards = page.locator('a[data-card]')
    await expect(cards.first().or(page.getByRole('heading', { name: 'Aquí empezará nuestra historia' }))).toBeVisible()
    if ((await cards.count()) === 0) return
    await cards.first().click()
    await page.getByRole('button', { name: 'Borrar' }).click()
    await page.getByRole('button', { name: 'Sí, borrarlo' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Hemos borrado' })).toBeVisible()
  }
}

export async function fillTrip(page: Page, v: { title: string; destination: string; start: string; end: string; description?: string }) {
  await page.getByLabel('Título').fill(v.title)
  await page.getByLabel('Destino').fill(v.destination)
  await page.getByLabel('Empieza el').fill(v.start)
  await page.getByLabel('Termina el').fill(v.end)
  if (v.description !== undefined) await page.getByLabel('Descripción (opcional)').fill(v.description)
}

