import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'

/** Saves a full-page screenshot for the PR (SCREENSHOT_DIR, default the test output dir). */
export async function snap(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env.SCREENSHOT_DIR?.replace(/^~/, homedir()) ?? testInfo.outputDir
  mkdirSync(dir, { recursive: true })
  // Let entrance animations settle so the screenshot shows the resting state.
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(dir, `${testInfo.project.name}-${name}.png`), fullPage: true })
}
