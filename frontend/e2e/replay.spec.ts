import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { emptyAlbum, fillTrip } from './support/album'
import { entranceDone, invitation, member } from './support/invitations'
import { MEMBERS } from './support/members'
import { snap } from './support/screenshots'
import { isoDay } from './support/session'

// A (Leo) invites, B (Ana) accepts; then both can replay the Invitation and nothing changes.
const INVITER = MEMBERS.mobile.email
const INVITEE = MEMBERS.desktop.email

/** A creates a Trip with an Invitation from the form and returns the Trip's id. */
async function invite(page: Page, title: string, destination: string) {
  await page.goto('/trips/new')
  await expect(page.getByRole('heading', { level: 1, name: 'Un viaje nuevo' })).toBeVisible()
  await fillTrip(page, { title, destination, start: isoDay(40), end: isoDay(44) })
  await page.getByRole('switch', { name: 'Añadir invitación' }).click()
  await page.getByRole('button', { name: 'Guardar viaje' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  const id = /\/trips\/([^/]+)$/.exec(new URL(page.url()).pathname)?.[1]
  expect(id).toBeTruthy()
  return id!
}

/** Every request the page makes that is not a plain read, from now on. */
function writes(page: Page) {
  const seen: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/') && r.method() !== 'GET') seen.push(`${r.method()} ${new URL(r.url()).pathname}`)
  })
  return seen
}

/** Opens the Trip page and returns the Invitation's `acceptedAt` the API gave for it. */
async function openTrip(page: Page, id: string, title: string) {
  const answer = page.waitForResponse((r) => r.url().endsWith(`/api/trips/${id}`) && r.request().method() === 'GET')
  await page.goto(`/trips/${id}`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  const body = (await (await answer).json()) as { invitation: { status: string; acceptedAt: string } | null }
  expect(body.invitation?.status).toBe('accepted')
  return body.invitation!.acceptedAt
}

/** Plays one replay on the page: the layer comes up over the Trip page, "Sí" returns to it. */
async function replay(page: Page, testInfo: TestInfo, id: string, who: string, reduced: boolean) {
  const button = page.getByRole('button', { name: 'Ver invitación' })
  const path = new URL(page.url()).pathname
  await button.click()
  const dialog = invitation(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: /¿Te vienes conmigo a/ })).toBeVisible()
  await expect(page).toHaveTitle('Una invitación para ti · Viajecito')
  // The Trip page is still there underneath, out of reach, and the URL did not move.
  await expect(page.locator('#root')).toHaveAttribute('inert', '')
  expect(new URL(page.url()).pathname).toBe(path)
  if (!reduced) await entranceDone(page)
  await snap(page, testInfo, `replay-${who}`)

  await dialog.getByRole('button', { name: 'Sí' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '')
  await expect(button).toBeFocused()
  expect(new URL(page.url()).pathname).toBe(path)
  expect(path).toBe(`/trips/${id}`)
}

async function run(browser: Browser, testInfo: TestInfo, reduced: boolean) {
  const mode = reduced ? 'reduced-motion-' : ''
  const motion = reduced ? 'reduce' : 'no-preference'
  let a: Page | undefined
  let b: Page | undefined
  try {
    a = await member(browser, testInfo, INVITER, motion)
    await emptyAlbum(a)
    b = await member(browser, testInfo, INVITEE, motion)
    const id = await invite(a, 'Escapada a Lisboa', 'Lisboa')
    await expect(a.getByRole('button', { name: 'Ver invitación' })).toHaveCount(0) // still Pending

    // B says "Sí" to it.
    await b.reload()
    await expect(invitation(b)).toBeVisible()
    await invitation(b).getByRole('button', { name: 'Sí' }).click()
    await expect(b).toHaveURL(new RegExp(`/trips/${id}$`))
    await expect(b.getByRole('heading', { level: 1, name: 'Escapada a Lisboa' })).toBeVisible()

    // Both now see the button and the Album marker; the acceptance date is B's, and stays.
    const acceptedAt = await openTrip(b, id, 'Escapada a Lisboa')
    const invitedAt = await openTrip(a, id, 'Escapada a Lisboa')
    expect(invitedAt).toBe(acceptedAt)
    for (const page of [a, b]) await expect(page.getByRole('button', { name: 'Ver invitación' })).toBeVisible()
    await snap(b, testInfo, `${mode}ver-invitacion-button-invitee`)
    await snap(a, testInfo, `${mode}ver-invitacion-button-inviter`)

    for (const page of [a, b]) {
      await page.goto('/')
      const card = page.locator('a[data-card]').filter({ hasText: 'Escapada a Lisboa' })
      await expect(card).toHaveCount(1)
      await expect(card.getByText('Empezó con un sí', { exact: true })).toBeVisible()
      await expect(card.getByText('Empezó con una invitación.')).toHaveCount(1)
    }
    await snap(b, testInfo, `${mode}album-marker`)

    // Replaying changes nothing: no request but reads, and the date is the same one.
    for (const [page, who] of [[b, 'invitee'], [a, 'inviter']] as const) {
      await page.goto(`/trips/${id}`)
      await expect(page.getByRole('heading', { level: 1, name: 'Escapada a Lisboa' })).toBeVisible()
      const sent = writes(page)
      await replay(page, testInfo, id, `${mode}${who}`, reduced)
      expect(sent).toEqual([])
      await snap(page, testInfo, `${mode}after-replay-${who}`)
    }
    expect(await openTrip(a, id, 'Escapada a Lisboa')).toBe(acceptedAt)
    expect(await openTrip(b, id, 'Escapada a Lisboa')).toBe(acceptedAt)
  } finally {
    if (a) await emptyAlbum(a).catch(() => undefined)
    for (const p of [a, b]) await p?.context().close()
  }
}

test.describe('"Ver invitación" and the Album marker', () => {
  // Two sign-ins, an invitation, two replays and the clean-up: more than the default minute.
  test.setTimeout(150_000)

  test('after B says "Sí", both replay the Invitation and see the marker', async ({ browser }, testInfo) => {
    await run(browser, testInfo, false)
  })

  test.describe('with reduced motion', () => {
    test('the same, with no animation', async ({ browser }, testInfo) => {
      await run(browser, testInfo, true)
    })
  })
})
