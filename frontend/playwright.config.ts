import { defineConfig, devices } from '@playwright/test'

// e2e runs against the CDK app on Floci: run infra/scripts/local-up.sh first
// (it writes .env.local, which the build and the preview proxy read).
const port = Number(process.env.SPA_PORT ?? 5173)

export default defineConfig({
  testDir: './e2e',
  // The journeys share two Cognito users, and `emptyAlbum` wipes the one shared Trips table,
  // so run them one at a time: parallel specs would delete each other's Trips.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    locale: 'es-ES',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
