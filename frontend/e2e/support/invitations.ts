import type { Browser, Locator, Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import { signInAs } from './session'

export async function member(browser: Browser, testInfo: TestInfo, email: string, reducedMotion: 'reduce' | 'no-preference') {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent, locale, baseURL } = testInfo.project.use
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor, isMobile, hasTouch, userAgent, locale, baseURL, reducedMotion,
  })
  const page = await ctx.newPage()
  await signInAs(page, email)
  return page
}

export function invitation(page: Page) {
  return page.getByRole('dialog')
}

/** Waits until the element stops moving: two reads of its box, a frame apart, are equal. */
export async function settled(el: Locator) {
  let last = ''
  await expect
    .poll(async () => {
      const b = await el.boundingBox()
      const now = b ? [b.x, b.y, b.width, b.height].map((n) => n.toFixed(1)).join(',') : ''
      const same = now !== '' && now === last
      last = now
      return same
    })
    .toBe(true)
}

/** Waits for the entrance to finish: every rising element has its transform and opacity cleared. */
export async function entranceDone(page: Page) {
  const dialog = invitation(page)
  await expect
    .poll(() =>
      dialog.evaluate((el) =>
        Array.from(el.querySelectorAll('[data-rise]')).every((r) => {
          const cs = getComputedStyle(r)
          return cs.opacity === '1' && (cs.transform === 'none' || new DOMMatrix(cs.transform).isIdentity)
        }),
      ),
    )
    .toBe(true)
  await settled(dialog.getByRole('button', { name: /^No/ }))
}

