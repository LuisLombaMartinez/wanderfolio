/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tailwind 4 puts its utilities in `@layer utilities`, and unlayered CSS always beats layered CSS,
// whatever the specificity. So a top-level class in index.css that sets a layout property silently
// overrides the utilities on the same element. `.reveal-sweep { position: relative }` did that: it beat
// `absolute inset-0`, collapsed the "Revelando…" overlay to zero height and hid it (prod, 2026-11-23).
const LAYOUT = ['position', 'display', 'inset', 'top', 'right', 'bottom', 'left', 'width', 'height', 'z-index', 'visibility', 'opacity']

/** The top-level (unlayered, outside any at-rule) rules of a stylesheet: [selector, declarations]. */
function topLevelRules(css: string): [string, string][] {
  const rules: [string, string][] = []
  let depth = 0
  let start = 0
  let selector = ''
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) {
        selector = text.slice(start, i).trim()
        start = i + 1
      }
      depth++
    } else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        if (!selector.startsWith('@')) rules.push([selector, text.slice(start, i)])
        start = i + 1
      }
    } else if (text[i] === ';' && depth === 0) {
      start = i + 1 // a top-level statement such as @import
    }
  }
  return rules
}

describe('index.css', () => {
  it('has no unlayered class rule that overrides layout utilities', () => {
    // Read from disk: Vitest blanks CSS imports, even with ?raw.
    const css = readFileSync('src/index.css', 'utf8') // Vitest runs from frontend/
    expect(css).toContain('.reveal-sweep')
    const offending = topLevelRules(css)
      // Pseudo-elements get no utilities from the markup, so they may set anything.
      .filter(([selector]) => selector.split(',').some((s) => s.trim().startsWith('.') && !s.includes('::')))
      .flatMap(([selector, body]) =>
        body
          .split(';')
          .map((d) => d.split(':')[0].trim())
          .filter((prop) => LAYOUT.includes(prop))
          .map((prop) => `${selector} { ${prop} }`),
      )
    expect(offending).toEqual([])
  })
})
