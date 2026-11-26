import { expect, test, type Locator, type Page } from '@playwright/test'
import { emptyAlbum, fillTrip } from './support/album'
import { MEMBERS } from './support/members'
import { snap } from './support/screenshots'
import { entranceDone, invitation, member, settled } from './support/invitations'
import { isoDay } from './support/session'

// Two browser contexts, one per Member: A (Leo) invites, B (Ana) is the Invitee. Both use the
// project's device, so the journey runs at 390x844 (touch) and on desktop (mouse).
const INVITER = MEMBERS.mobile.email
const INVITEE = MEMBERS.desktop.email

/** A creates a Trip with an Invitation from the form and returns the Trip's id. */
async function invite(page: Page, title: string, destination: string, question?: string, shot?: () => Promise<void>) {
  await page.goto('/trips/new')
  await expect(page.getByRole('heading', { level: 1, name: 'Un viaje nuevo' })).toBeVisible()
  await fillTrip(page, { title, destination, start: isoDay(40), end: isoDay(44) })
  const toggle = page.getByRole('switch', { name: 'Añadir invitación' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  const field = page.getByLabel('La pregunta')
  // Pre-filled with the suggestion, which follows the destination.
  await expect(field).toHaveValue(`¿Te vienes conmigo a ${destination}?`)
  if (question !== undefined) await field.fill(question)
  await expect(page.getByText(`${Array.from(await field.inputValue()).length}/120`, { exact: true })).toBeVisible()
  // Past 120 code points the field keeps the text and says why it will not save.
  const kept = await field.inputValue()
  await field.fill('a'.repeat(125))
  await expect(page.getByText('125/120', { exact: true })).toBeVisible()
  await expect(page.getByText('Que quepa en un suspiro: máximo 120 caracteres.')).toBeVisible()
  await field.fill(kept)
  await expect(page.getByText('Que quepa en un suspiro: máximo 120 caracteres.')).toBeHidden()
  if (shot) await shot()
  await page.getByRole('button', { name: 'Guardar viaje' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  const id = /\/trips\/([^/]+)$/.exec(new URL(page.url()).pathname)?.[1]
  expect(id).toBeTruthy()
  return id!
}

async function expectInViewport(page: Page, el: Locator) {
  const box = await el.boundingBox()
  const vp = page.viewportSize()!
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height)
  return box!
}

/** The current scale of "Sí", read from its transform matrix. */
const yesScale = (yes: Locator) =>
  yes.evaluate((el) => {
    const t = getComputedStyle(el).transform
    return t === 'none' ? 1 : new DOMMatrix(t).a
  })

/** Tries to press "No" the way the device would: tap on touch, move the mouse onto it otherwise. */
async function chaseNo(page: Page, touch: boolean, times: number) {
  const dialog = invitation(page)
  const yes = dialog.getByRole('button', { name: 'Sí' })
  const no = dialog.getByRole('button', { name: /^No/ })
  let scale = await yesScale(yes)
  for (let i = 0; i < times; i++) {
    const before = await expectInViewport(page, no)
    const x = before.x + before.width / 2
    const y = before.y + before.height / 2
    if (touch) await page.touchscreen.tap(x, y)
    else await page.mouse.move(x, y, { steps: 4 })
    // It moved away, stays fully on screen, and "Sí" grew (up to its cap).
    await expect
      .poll(async () => {
        const b = await no.boundingBox()
        return b ? Math.hypot(b.x - before.x, b.y - before.y) : 0
      })
      .toBeGreaterThan(20)
    await settled(no) // the dodge tween
    await expectInViewport(page, no)
    const next = await yesScale(yes)
    expect(next).toBeGreaterThanOrEqual(scale)
    expect(next).toBeLessThanOrEqual(2.6 + 1e-6)
    scale = next
  }
  expect(scale).toBeGreaterThan(1)
  // "No" never navigated anywhere.
  await expect(dialog).toBeVisible()
}

/** A deletes what it invited to (so later specs start without a Pending Invitation), then both close. */
async function cleanUp(a: Page | undefined, ...others: (Page | undefined)[]) {
  if (a) await emptyAlbum(a).catch(() => undefined)
  for (const p of [a, ...others]) await p?.context().close()
}

// Both projects use the same two Members, so this only works with `workers: 1` (playwright.config.ts).
test.describe('an Invitation hides its Trip until "Sí"', () => {
  test('A invites, B lands on the Invitation, "No" dodges, "Sí" leads to the Trip', async ({ browser }, testInfo) => {
    const touch = testInfo.project.name === 'mobile'
    let a: Page | undefined
    let b: Page | undefined
    try {
      a = await member(browser, testInfo, INVITER, 'no-preference')
      await emptyAlbum(a) // A sees (and deletes) every Trip it invited to, Pending or not
      b = await member(browser, testInfo, INVITEE, 'no-preference')

      const id = await invite(a, 'Escapada a Roma', 'Roma', undefined, () => snap(a!, testInfo, 'form-with-invitation'))
      await snap(a, testInfo, 'invitation-trip-for-inviter')

      // B's Album doesn't show it (the Go API tests cover the direct read). B moves inside the app,
      // so the Album asks for the Trips again without the app being opened anew.
      await b.getByRole('link', { name: /Crear nuestro primer viaje|Nuevo viaje/ }).first().click()
      await b.getByRole('link', { name: 'Volver al álbum' }).click()
      await expect(b.getByRole('heading', { level: 1, name: 'Nuestro álbum' })).toBeVisible()
      await expect(b.getByRole('heading', { name: 'Aquí empezará nuestra historia' })).toBeVisible()
      await expect(b.locator('a[data-card]').filter({ hasText: 'Escapada a Roma' })).toHaveCount(0)
      await snap(b, testInfo, 'invitee-album-without-the-trip')

      // B opens the app again and the Invitation comes first.
      await b.reload()
      const dialog = invitation(b)
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: '¿Te vienes conmigo a Roma?' })).toBeVisible()
      await expect(dialog).toContainText('Roma')
      await expect(b).toHaveTitle('Una invitación para ti · Viajecito')
      await entranceDone(b) // "No" holds still during the entrance
      await snap(b, testInfo, 'invitation')

      await chaseNo(b, touch, 4)
      await snap(b, testInfo, 'invitation-after-dodges')

      await dialog.getByRole('button', { name: 'Sí' }).click()
      await expect(b).toHaveURL(new RegExp(`/trips/${id}$`))
      await expect(b.getByRole('heading', { level: 1, name: 'Escapada a Roma' })).toBeVisible()
      await expect(invitation(b)).toHaveCount(0)
      await snap(b, testInfo, 'invitation-accepted-trip')

      // Now it is in B's Album, and opening the app again shows no Invitation.
      await b.goto('/')
      await expect(b.locator('a[data-card]').filter({ hasText: 'Escapada a Roma' })).toHaveCount(1)
      await b.reload()
      await expect(b.getByRole('heading', { level: 1, name: 'Nuestro álbum' })).toBeVisible()
      await expect(invitation(b)).toHaveCount(0)
    } finally {
      await cleanUp(a, b)
    }
  })

  test.describe('with reduced motion', () => {
    test('two Pending Invitations show one at a time, oldest first', async ({ browser }, testInfo) => {
      const touch = testInfo.project.name === 'mobile'
      let a: Page | undefined
      let b: Page | undefined
      try {
        a = await member(browser, testInfo, INVITER, 'reduce')
        await emptyAlbum(a)
        b = await member(browser, testInfo, INVITEE, 'reduce')

        await invite(a, 'Primero Lisboa', 'Lisboa')
        const second = await invite(a, 'Luego Oporto', 'Oporto', '  ¿Y si nos escapamos a Oporto en tren?  ')

        // A deep link to the hidden Trip: the Invitation comes first, the oldest one.
        await b.goto(`/trips/${second}`)
        const firstDialog = invitation(b)
        await expect(firstDialog.getByRole('heading', { name: '¿Te vienes conmigo a Lisboa?' })).toBeVisible()

        // "No" still dodges, instantly.
        await chaseNo(b, touch, 2)
        await snap(b, testInfo, 'invitation-reduced-motion')
        await firstDialog.getByRole('button', { name: 'Sí' }).click()
        await expect(b.getByRole('heading', { level: 1, name: 'Primero Lisboa' })).toBeVisible()

        // Then the next one, fresh: "Sí" back at its normal size.
        const next = invitation(b)
        await expect(next.getByRole('heading', { name: '¿Y si nos escapamos a Oporto en tren?' })).toBeVisible()
        expect(await yesScale(next.getByRole('button', { name: 'Sí' }))).toBeCloseTo(1)
        await next.getByRole('button', { name: 'Sí' }).click()
        await expect(b).toHaveURL(new RegExp(`/trips/${second}$`))
        await expect(b.getByRole('heading', { level: 1, name: 'Luego Oporto' })).toBeVisible()
        await expect(invitation(b)).toHaveCount(0)
      } finally {
        await cleanUp(a, b)
      }
    })
  })
})
