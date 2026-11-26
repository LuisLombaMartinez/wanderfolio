import path from 'node:path'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // The SPA only uses relative /api URLs (same origin, like CloudFront in prod).
  // Locally, infra/scripts/local-up.sh writes API_PROXY_TARGET to .env.local.
  const env = loadEnv(mode, import.meta.dirname, '')
  // Same for /media: the CloudFront distribution on Floci (dev and preview only).
  const proxy: Record<string, ProxyOptions> = {
    ...(env.API_PROXY_TARGET ? { '/api': { target: env.API_PROXY_TARGET, changeOrigin: true } } : {}),
    ...(env.MEDIA_PROXY_TARGET ? { '/media': { target: env.MEDIA_PROXY_TARGET, changeOrigin: true } } : {}),
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
    server: { proxy },
    preview: { proxy },
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['src/test-setup.ts'],
      coverage: {
        provider: 'v8',
        // Count every source file, tested or not, so a new untested module lowers the total.
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/**/*.d.ts'],
        reporter: ['text-summary', 'json-summary'],
        // ratchet: raise when coverage goes up, never lower without a note in the PR.
        // Measured 2026-11-26: lines 53.18, branches 47.48, functions 49.71 (floors rounded down).
        thresholds: { lines: 53, branches: 47, functions: 49 },
      },
    },
  }
})
