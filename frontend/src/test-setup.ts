import './test-matchmedia' // first: GSAP needs matchMedia to exist when it loads
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach } from 'vitest'
import { gsap } from '@/lib/gsap'

afterEach(cleanup)

// GSAP's ticker keeps asking for animation frames after jsdom is torn down.
afterAll(() => {
  gsap.ticker.sleep()
})
