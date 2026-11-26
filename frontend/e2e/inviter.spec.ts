import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { expect, test, type Browser, type Page, type Request, type TestInfo } from '@playwright/test'
import { emptyAlbum, fillTrip } from './support/album'
import { MEMBERS } from './support/members'
import { isoDay, signInAs } from './support/session'

// The Inviter (A, Leo) looks after a Pending Invitation from the Trip page; B (Ana) is the Invitee.
// Both use the project's device, so everything runs at 390x844 (touch) and on desktop.
const INVITER = MEMBERS.mobile.email
const INVITEE = MEMBERS.desktop.email
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

type Motion = 'reduce' | 'no-preference'

async function member(browser: Browser, testInfo: TestInfo, email: string, reducedMotion: Motion) {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent, locale, baseURL } = testInfo.project.use
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent, locale, baseURL, reducedMotion })
  const page = await ctx.newPage()
  await signInAs(page, email)
  return page
}

/** Waits for the page's entrance (and the Invitation's) to finish, then saves a screenshot for the PR. */
async function shot(page: Page, testInfo: TestInfo, motion: Motion, name: string, fullPage = true) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-enter], [data-rise]')).every((el) => {
          const cs = getComputedStyle(el)
          return cs.opacity === '1' && (cs.transform === 'none' || new DOMMatrix(cs.transform).isIdentity)
        }),
      ),
    )
    .toBe(true)
  const dir = process.env.SCREENSHOT_DIR?.replace(/^~/, homedir()) ?? testInfo.outputDir
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, `${testInfo.project.name}-${motion}-${name}.png`), fullPage })
}

/** A creates a Trip with an Invitation (the suggested question) and lands on its page. */
async function createInvited(page: Page, title: string, destination: string) {
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

const panel = (page: Page) => page.getByRole('region', { name: 'Tu invitación' })

/** The calendar day of today in the browser's (and this machine's) time zone, as the badge writes it. */
function today() {
  const d = new Date()
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** B opens the app: the Invitation comes first, and "Sí" leads to the Trip. */
async function inviteeSaysYes(b: Page, id: string, question: string) {
  await b.reload()
  const dialog = b.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: question })).toBeVisible()
  await dialog.getByRole('button', { name: 'Sí' }).click()
  await expect(b).toHaveURL(new RegExp(`/trips/${id}$`))
}

async function cleanUp(a: Page | undefined, ...others: (Page | undefined)[]) {
  if (a) await emptyAlbum(a).catch(() => undefined)
  for (const p of [a, ...others]) await p?.context().close()
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test.describe(`the Inviter looks after a Pending Invitation (${motion === 'reduce' ? 'reduced motion' : 'full motion'})`, () => {
    test('A edits, previews and deletes it; B then finds the Trip in the Album', async ({ browser }, testInfo) => {
      test.setTimeout(180_000) // two Members, one long journey
      let a: Page | undefined
      let b: Page | undefined
      try {
        a = await member(browser, testInfo, INVITER, motion)
        await emptyAlbum(a)
        b = await member(browser, testInfo, INVITEE, motion)
        // Nothing here may ever record a "Sí": the preview makes no accept call.
        const accepts: Request[] = []
        a.on('request', (r) => r.url().includes('/invitation/accept') && accepts.push(r))

        const id = await createInvited(a, 'Escapada a Lisboa', 'Lisboa')

        // The card: status, the quoted question, the three actions.
        const card = panel(a)
        await expect(card).toBeVisible()
        await expect(card.getByText('pendiente')).toBeVisible()
        await expect(card.getByText('«¿Te vienes conmigo a Lisboa?»')).toBeVisible()
        await expect(card.getByText('Aún no ha dicho que sí. El viaje sigue siendo tu secreto.')).toBeVisible()
        await expect(card.getByRole('button', { name: 'Ver cómo queda' })).toBeVisible()
        await shot(a, testInfo, motion, 'card-pending')

        // Edit in place: the same validation as on creation, in Spanish.
        await card.getByRole('button', { name: 'Editar la pregunta' }).click()
        const field = card.getByLabel('La pregunta', { exact: true })
        await expect(field).toBeFocused()
        await expect(card.getByText('pendiente')).toBeVisible()
        await expect(card.getByRole('button', { name: 'Ver cómo queda' })).toHaveCount(0)
        await field.fill('   ')
        await card.getByRole('button', { name: 'Guardar pregunta' }).click()
        await expect(card.getByText('Escribe la pregunta que quieres hacerle.')).toBeVisible()
        await shot(a, testInfo, motion, 'editor-error')
        await field.fill('a'.repeat(125))
        await expect(card.getByText('125/120', { exact: true })).toBeVisible()
        await expect(card.getByText('Que quepa en un suspiro: máximo 120 caracteres.')).toBeVisible()
        // Escape drops the edit without asking.
        await field.press('Escape')
        await expect(card.getByLabel('La pregunta', { exact: true })).toHaveCount(0)
        await expect(card.getByText('«¿Te vienes conmigo a Lisboa?»')).toBeVisible()
        await expect(card.getByRole('button', { name: 'Editar la pregunta' })).toBeFocused()

        await card.getByRole('button', { name: 'Editar la pregunta' }).click()
        await card.getByLabel('La pregunta', { exact: true }).fill('  ¿Nos escapamos\n a   Lisboa?  ')
        await card.getByRole('button', { name: 'Guardar pregunta' }).click()
        await expect(card.getByText('Pregunta guardada. Así se la encontrará.')).toBeVisible()
        await expect(card.getByText('«¿Nos escapamos a Lisboa?»')).toBeVisible()
        await expect(card.getByText('pendiente')).toBeVisible()
        await shot(a, testInfo, motion, 'card-saved')
        await a.reload() // it was saved, not just shown
        await expect(panel(a).getByText('«¿Nos escapamos a Lisboa?»')).toBeVisible()

        // Preview: the real Invitation with the ribbon; Salir, Escape and Back all leave.
        const open = panel(a).getByRole('button', { name: 'Ver cómo queda' })
        await open.click()
        const dialog = a.getByRole('dialog')
        await expect(a).toHaveURL(/\?vista=previa$/)
        await expect(dialog.getByRole('heading', { name: '¿Nos escapamos a Lisboa?' })).toBeVisible()
        await expect(dialog.getByText('Vista previa')).toBeVisible()
        await expect(dialog).toContainText('Tu sí aquí no cuenta')
        await expect(a).toHaveTitle('Vista previa · Viajecito')
        await expect(dialog.getByRole('button', { name: 'Sí' })).toBeFocused()
        await shot(a, testInfo, motion, 'preview', false)
        // Tab cycles Sí -> No -> Salir -> Sí and never leaves the dialog.
        await a.keyboard.press('Tab')
        await expect(dialog.getByRole('button', { name: /^No/ })).toBeFocused()
        await a.keyboard.press('Tab')
        await expect(dialog.getByRole('button', { name: 'Salir' })).toBeFocused()
        await a.keyboard.press('Tab')
        await expect(dialog.getByRole('button', { name: 'Sí' })).toBeFocused()
        await a.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(a).not.toHaveURL(/vista=/)
        await expect(open).toBeFocused()
        await open.click()
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: 'Salir' }).click()
        await expect(dialog).toHaveCount(0)
        await open.click()
        await expect(dialog).toBeVisible()
        await a.goBack()
        await expect(dialog).toHaveCount(0)
        await expect(a).not.toHaveURL(/vista=/)

        // "Sí" in the preview plays the transition over the same Trip page and records nothing.
        await open.click()
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: 'Sí' }).click()
        await expect(dialog).toHaveCount(0)
        await expect(panel(a).getByRole('status')).toHaveText(
          'Así le llegará tu sorpresa. Tranquilidad: su respuesta de verdad aún está por llegar.',
        )
        await expect(a).toHaveURL(new RegExp(`/trips/${id}$`))
        await expect(panel(a).getByText('pendiente')).toBeVisible()
        await expect(open).toBeFocused()
        await shot(a, testInfo, motion, 'card-after-preview')
        expect(accepts).toHaveLength(0)
        // B was never asked anything: the Trip is still hidden from B.
        await b.reload()
        await expect(b.getByRole('dialog')).toBeVisible()
        await b.goto('/') // B does not say "Sí": a Pending Invitation stays Pending
        await expect(b.getByRole('dialog')).toBeVisible()

        // Delete asks first.
        await panel(a).getByRole('button', { name: 'Borrar la invitación' }).click()
        const confirm = a.getByRole('alertdialog', { name: '¿Cancelamos la sorpresa?' })
        await expect(confirm).toContainText('«Escapada a Lisboa» aparecerá en su álbum como cualquier otro viaje')
        await expect(confirm.getByRole('button', { name: 'Mejor no' })).toBeFocused()
        await shot(a, testInfo, motion, 'delete-confirm')
        await confirm.getByRole('button', { name: 'Mejor no' }).click()
        await expect(confirm).toHaveCount(0)
        await expect(panel(a)).toBeVisible()
        await panel(a).getByRole('button', { name: 'Borrar la invitación' }).click()
        await confirm.getByRole('button', { name: 'Sí, borrarla' }).click()
        await expect(a.getByRole('status').filter({ hasText: 'Sorpresa cancelada. «Escapada a Lisboa» ya está en su álbum.' })).toBeVisible()
        await expect(panel(a)).toHaveCount(0)
        await expect(a.getByRole('heading', { level: 1, name: 'Escapada a Lisboa' })).toBeFocused()
        await shot(a, testInfo, motion, 'after-delete')

        // The Trip is now an ordinary Trip in B's Album, and B is no longer asked anything.
        await b.reload()
        await expect(b.getByRole('heading', { level: 1, name: 'Nuestro álbum' })).toBeVisible()
        await expect(b.getByRole('dialog')).toHaveCount(0)
        await expect(b.locator('a[data-card]').filter({ hasText: 'Escapada a Lisboa' })).toHaveCount(1)
        // A no longer has an Invitation to look after.
        await a.reload()
        await expect(a.getByRole('heading', { level: 1, name: 'Escapada a Lisboa' })).toBeVisible()
        await expect(panel(a)).toHaveCount(0)
      } finally {
        await cleanUp(a, b)
      }
    })

    test('after B says "Sí", A sees "aceptada el …" and can no longer edit or delete', async ({ browser }, testInfo) => {
      let a: Page | undefined
      let b: Page | undefined
      try {
        a = await member(browser, testInfo, INVITER, motion)
        await emptyAlbum(a)
        b = await member(browser, testInfo, INVITEE, motion)
        const id = await createInvited(a, 'Escapada a Oporto', 'Oporto')
        await expect(panel(a).getByText('pendiente')).toBeVisible()

        await inviteeSaysYes(b, id, '¿Te vienes conmigo a Oporto?')

        // A's page still says Pending (no polling). Editing is refused, and the card learns why.
        await panel(a).getByRole('button', { name: 'Editar la pregunta' }).click()
        await panel(a).getByLabel('La pregunta', { exact: true }).fill('¿Y si mejor Madeira?')
        await panel(a).getByRole('button', { name: 'Guardar pregunta' }).click()
        const card = panel(a)
        await expect(card.getByText('Llegas tarde: ya ha dicho que sí, así que la pregunta se queda como estaba.')).toBeVisible()
        await expect(card.getByText(`aceptada el ${today()}`)).toBeVisible()
        await expect(card.getByText('«¿Te vienes conmigo a Oporto?»')).toBeVisible()
        await expect(card.getByRole('heading', { name: 'Tu invitación' })).toBeFocused()
        await expect(card.getByRole('button')).toHaveCount(0)
        await expect(a).not.toHaveURL(/vista=/)

        // The same after a reload: Accepted, frozen, no controls, nothing to preview.
        await a.reload()
        await expect(panel(a).getByText(`aceptada el ${today()}`)).toBeVisible()
        await expect(panel(a).getByText('Este momento se queda así para siempre.')).toBeVisible()
        await expect(panel(a).getByRole('button')).toHaveCount(0)
        await expect(panel(a).getByText('pendiente')).toHaveCount(0)
        await shot(a, testInfo, motion, 'card-accepted')
        // The page's own actions (for the Trip) are still there.
        await expect(a.getByRole('button', { name: 'Borrar', exact: true })).toBeVisible()
      } finally {
        await cleanUp(a, b)
      }
    })
  })
}
