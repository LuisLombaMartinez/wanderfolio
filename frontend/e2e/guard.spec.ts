import { expect, test } from '@playwright/test'

for (const route of ['/', '/trips/abc', '/cualquier/cosa']) {
  test(`a logged-out visitor going to ${route} ends up on the login page`, async ({ page }) => {
    await page.goto(route)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Hola de nuevo, amor' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nuestro álbum' })).toHaveCount(0)
  })
}

test('the API refuses a request without a login', async ({ request }) => {
  const res = await request.get('/api/trips')
  expect(res.status()).toBe(401)
})
