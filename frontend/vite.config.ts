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
    test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['src/test-setup.ts'] },
  }
})
