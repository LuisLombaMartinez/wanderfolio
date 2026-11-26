import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(useGSAP, ScrollTrigger)

export { gsap, useGSAP, ScrollTrigger }

/** True when the Member asked for less motion; for one-off tweens outside `gsap.matchMedia`. */
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
