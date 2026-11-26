import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import scriptFont from '@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff2?url'
import serifFont from '@fontsource/cormorant-infant/files/cormorant-infant-latin-700-normal.woff2?url'
import './index.css'
import App from './App'
import { configureAuth } from './lib/auth'

// Preload only the script and serif fonts (self-hosted via @fontsource).
for (const href of [scriptFont, serifFont]) {
  const link = document.createElement('link')
  link.rel = 'preload'
  link.as = 'font'
  link.type = 'font/woff2'
  link.crossOrigin = 'anonymous'
  link.href = href
  document.head.appendChild(link)
}

configureAuth()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
