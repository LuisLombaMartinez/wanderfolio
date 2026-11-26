# Viajecito — Product

## What it is
A single-page web app (SPA) inviting one partner on a trip, with its destination and dates. The invitee will view it, mostly on their phone.

## Language and tone
All user-facing copy is in **Spanish**, romantic and playful. (Everything else in the project is in English.)

## Screens
1. **Invitation**: the text "¿Quieres venirte conmigo de viaje?" with two buttons, **Sí** and **No**.
   - When the cursor gets close to (or a touch lands on) the **No** button, it moves to another visible position on the screen; it cannot be clicked.
   - Each time it dodges, **Sí** gets bigger, up to a size cap. **No** never stops dodging.
   - Pressing **Sí** goes to the inner screen with an animated transition.
2. **Inside**: a welcome to the trip (destination and dates, maybe a countdown) and a gallery of photos of the places we will visit. More sections will be decided later.

## Acceptance criteria
- [ ] "No" can never be clicked and never ends up off screen (mobile and desktop).
- [ ] "Sí" grows with each dodge and never breaks the layout (size cap).
- [ ] "Sí" leads to the inner screen.
- [ ] With `prefers-reduced-motion`, "No" still dodges, but without long animations.
- [ ] Works well on mobile (390x844) and desktop.
- [ ] All page copy is in Spanish.
- [ ] `npm run build` and `npm run lint` (run inside `frontend/`) pass without errors.

## Out of scope (for now)
Backend, hosting, detailed itinerary, budget. Real photos: placeholders until we have our own.
