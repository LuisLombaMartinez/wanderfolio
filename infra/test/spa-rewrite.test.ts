import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SPA_REWRITE_PATH } from '../lib/album-stack.ts'

// The CloudFront Function is plain JS (cloudfront-js-2.0); load and run it as-is.
const source = readFileSync(SPA_REWRITE_PATH, 'utf8')
const handler = new Function(`${source}; return handler;`)() as (event: unknown) => { uri: string }

function rewrite(uri: string) {
  return handler({ request: { uri, method: 'GET', headers: {}, querystring: {}, cookies: {} } }).uri
}

describe('SPA rewrite', () => {
  it.each(['/', '/login', '/trips/abc', '/trips/abc/photos/xyz/'])('serves index.html for client route %s', (uri) => {
    expect(rewrite(uri)).toBe('/index.html')
  })

  it.each(['/assets/index-abc123.js', '/favicon.svg', '/index.html', '/assets/font.woff2'])(
    'leaves the file %s alone',
    (uri) => {
      expect(rewrite(uri)).toBe(uri)
    },
  )
})
