# Viajecito — Design System (MASTER)

Phase 1 source: `specs/PRODUCT.md`. Phase 2 (the Album, spec #5) extends it from section 14 on (Photos: sections 27-31; viewer, captions and delete: 32-37; Cover photo: 38-41; failed Photos, retry and HEIF: 42-46); sections 1-5 and 10-13 apply to every screen.
Source: `specs/PRODUCT.md` + `ui-ux-pro-max` searches (`--design-system`, `typography`, `ux`; dials: variance 6, motion 7, density 3).
Fixed stack: React + Vite + Tailwind + shadcn/ui + GSAP (`useGSAP`). UI copy in Spanish; everything else in English. Mobile-first (390x844), then desktop.

> Note on the tool: the page pattern it returned (Hero + Testimonials + CTA) doesn't fit (there are no testimonials) and is discarded. From the search we use the style, base palette, font pairing and UX/motion rules. The palette was adjusted by hand (see below).

## 1. Style direction
**"Romantic aurora"**: warm pink background with soft island-sunset gradients (pink, coral, peach, a touch of ocean turquoise), soft cards, very rounded corners, lots of air (low density). Playful through motion and copy, elegant through typography. No emojis as icons (Lucide SVG); emojis are allowed sparingly inside the copy.
Mode: light only (decision #3).

## 2. Palette and tokens
Define as CSS variables (shadcn format, HSL or hex) and map them in `tailwind.config`. Never raw hex in components.

| Token | Hex | Use |
|---|---|---|
| `--background` | `#FFF5F7` | Base background |
| `--foreground` | `#2A1220` | Text (very dark plum, contrast >14:1) |
| `--card` | `#FFFFFF` | Cards |
| `--card-foreground` | `#2A1220` | Text on cards |
| `--primary` | `#BE185D` | "Sí" button, accents (white on top: ~6.5:1) |
| `--primary-foreground` | `#FFFFFF` | |
| `--secondary` | `#FFE1E9` | Soft backgrounds, chips |
| `--secondary-foreground` | `#7A0F3D` | |
| `--accent` | `#FF8A65` | Coral/peach: gradients, details (decorative only, not text) |
| `--ocean` | `#0E9AA7` | Canary turquoise: dates, icons, details (text only at large size or on dark backgrounds) |
| `--muted` | `#FBEAF0` | Muted surfaces |
| `--muted-foreground` | `#6B4A5C` | Secondary text (>5:1 on background) |
| `--border` | `#F3CFDB` | Borders |
| `--ring` | `#BE185D` | Visible focus (2px + 2px offset) |
| `--no-bg` | `#FFFFFF` | "No" button (outline, neutral tone) |
| `--no-fg` | `#6B4A5C` | "No" text |

Background gradient (`--gradient-sunset`): `linear-gradient(160deg, #FFF5F7 0%, #FFE1E9 45%, #FFD9C7 100%)`, with 2-3 blurred radial blobs (pink, coral, turquoise at 15-20%) in pseudo-elements.
Rule: text >= 4.5:1; never convey meaning by color alone.

## 3. Typography
Base pairing from the tool ("Wedding/Romance"): Great Vibes + Cormorant Infant. Adjusted for mobile and the playful tone: script only for short accents (legibility), and body text in a rounded sans.

| Role | Font | Notes |
|---|---|---|
| Script (accents: the destination, countdown, short subtitles) | **Great Vibes** 400 | Never paragraphs; minimum 28px |
| Headings | **Cormorant Infant** 600/700 | Invitation question, section titles |
| Body / UI / buttons | **Nunito** 400/600/700 | Rounded and friendly, readable on mobile (alternative from the "Playful Creative" result) |

Tailwind: `fontFamily: { script: ['Great Vibes','cursive'], serif: ['Cormorant Infant','serif'], sans: ['Nunito','sans-serif'] }`.
Loading: self-hosted via `@fontsource` (decision #9, no external requests), `font-display: swap`. Preload only script + serif.
Mobile scale: body 16px/1.5; invitation question `clamp(2rem, 8vw, 3.5rem)` / 1.1; h2 `clamp(1.75rem, 6vw, 2.5rem)`; buttons 18px/600. `text-balance` on headlines to avoid orphans.

## 4. Spacing, shape and elevation
- 4px scale; section spacing 48-96px (low density). Mobile side padding 20px; desktop container max 1100px.
- Radii: buttons and chips `9999px` (pill); cards and photos `24px`; photo frame `28px`.
- Soft pink-tinted shadows: `0 10px 30px -10px rgb(190 24 93 / .25)`. No hard borders.
- Respect safe areas (`env(safe-area-inset-*)`) and use `100dvh` (not `100vh`) on full-screen views.

## 5. Buttons
- Minimum height 48px, minimum width 120px, touch target >= 44x44, gap >= 12px between buttons.
- **Sí**: `--primary` fill, white text, pill, pink shadow, SVG heart icon. Hover/press: slight lift and `scale` 1.03 (150-200ms). Focus: `--ring` ring.
- **No**: pill with `--border` border, white background, `--no-fg` text; visibly secondary. `cursor: default`/`not-allowed` is not used; it is a button that runs away.
- All clickables have `cursor-pointer`, hover/active/focus-visible states, 150-300ms transitions. Use shadcn's `Button` with custom variants (`yes`, `no`).

## 6. Screen 1 — Invitation
Layout: full screen `100dvh`, centered. Gradient background with blobs. At the top a small script/ornament ("para ti"), in the middle the question **"¿Quieres venirte conmigo de viaje?"** (Cormorant, balanced), below it the **Sí / No** button row. Very subtle decorative SVG hearts/waves floating behind (aria-hidden).

### Dodging "No" button (behaviour rules)
1. **Triggers** (any): mouse `pointermove` within ~90px of the button (desktop); `pointerdown`/`touchstart` on it (mobile, with `preventDefault()` so it never produces a `click`); keyboard `focus` (it also moves, see accessibility).
2. **Never clickable**: besides dodging, `onClick` is always ignored (`preventDefault`, no action). Acceptance criterion: it can't be pressed.
3. **Position**: the first time it becomes `position: fixed` (a gap of the same size is left in its original place so the layout doesn't shift). Each dodge picks a new position **always inside the visual viewport**: 16px safety margin (+ safe areas) using the button's real size: `x ∈ [m, vw − w − m]`, `y ∈ [m, vh − h − m]`. Recompute on `resize`/`orientationchange` and re-fit if it ended up outside.
4. **Valid position**: must be >= 120px away from the current position and from the pointer, **must not overlap the "Sí" button (already enlarged) or the question text** (up to N=10 random attempts; if they fail, use the farthest free corner). Must sit on top (z-index) and be fully visible.
5. **Mobile anti-loop**: ~150ms debounce between dodges so it doesn't jitter; on touch, the tap counts as a dodge even if the pointer never entered the radius.
6. **Motion**: GSAP `to` with `x/y` (transform, not left/top), ~0.35s `back.out(1.6)` + small rotation (±6°) and squash. Button text optionally changes per dodge ("¿Seguro?", "Uy…", "Casi", "Piénsalo"); see decision #5.
7. **Reduced motion**: "No" still dodges but with an instant jump or a fade <= 100ms, no rotation or bounce, no long trajectories.
8. **Accessibility**: "No" is a real `<button>` with a clear `aria-label`; when it receives keyboard focus it jumps anyway; a screen reader/keyboard user can always choose "Sí" (initial focus on Sí, tab order: Sí first). Optional subtle `aria-live="polite"` announcement of the changing text.

### Growing "Sí" button
- Each dodge increments a counter; `scale = min(1 + 0.26 × n, cap)` (reaches the ~2.6 cap at the 7th dodge). Animated with `transform: scale` (GSAP, 0.3s `back.out(1.7)`), origin center, to avoid reflow.
- **Cap**: growth stops when the scaled button would reach `min(86vw, 520px)` wide or `~28dvh` tall (on mobile the practical cap ≈ scale 2.6). The layout reserves that maximum space (button container with reserved height) so the question and the rest don't jump.
- As it grows, slightly increase the pulse/glow (heartbeat 1.5s, subtle; off with reduced motion).
- "No" can't be covered by "Sí" (rule 4 above). If "Sí" reaches the cap, "No" keeps dodging but "Sí" stops growing. "No" never gives up: it keeps dodging indefinitely (decision #5).
- Reduced motion: size change is direct or a transition <= 100ms, no heartbeat.

## 7. Transition Invitation → Inside
When **Sí** is pressed (GSAP `timeline`, ~1.4s total):
1. (0-0.3s) The "Sí" button beats once and releases a short burst of SVG hearts (12-20 particles, transform/opacity).
2. (0.2-0.9s) The "Sí" button expands as a `--primary` circle covering the screen (circular clip-path or an element scaled from the button's position); the question and "No" fade out (exit faster than entrance).
3. (0.9-1.4s) The inside appears over the gradient background: headline enters with stagger.
State: React state (`screen: 'invite' | 'inside'`), no router for now; focus moved to the inside title (`h1`, `tabIndex=-1`) when finished. There is no going back and no back button needed (decision #6).
**Reduced motion**: 200ms cross-fade, no hearts or expansion.

## 8. Screen 2 — Inside (retired in Phase 2)
Removed by the walking skeleton (#7): the Album (section 16) replaces the Phase 1 entry screen. The Invitation screen (section 6) and its transition (section 7) stay in the codebase for the Invitations spec; where "Sí" leads will be designed there.

## 9. Gallery (retired in Phase 2)
The place gallery, its Wikimedia stand-in photos and their credits are removed. Photos now come only from Members' uploads; the Trip page's Photo grid is designed with the Trips tickets.

## 10. Motion level
**Expressive but intentional** (dial 7/10), only in: "No" dodge, "Sí" growth, screen transition, scroll reveals, subtle heartbeat. Everything else is static.
- Durations: micro 150-200ms; dodge/growth 300-400ms; screen transition ~1.4s total; reveals 400-500ms. Exits faster than entrances.
- Only animate `transform` and `opacity` (never width/height/top/left). `will-change` sparingly.
- Easing: `back.out` for playful things, `power2.out` for reveals.
- **`prefers-reduced-motion`**: `gsap.matchMedia()` with a `(prefers-reduced-motion: reduce)` branch: no bounces, rotations, hearts, heartbeat, parallax or stagger; the "No" and "Sí" logic stays (dodges and grows) with instant changes or <= 100ms; screen transition = 200ms fade. Slow decorative background drifts stop.
- Cleanup with `useGSAP` (scope + `contextSafe` in handlers).

## 11. Iconography
Lucide (SVG, `aria-hidden` if decorative): `Heart`, `Plane`, `Waves`, `Sun`, `MapPin`, `Image`, `ChevronLeft/Right`, `X`. Consistent size 20-24px, stroke 1.75-2.

## 12. Copy (romantic and playful tone; page copy stays in Spanish)
- Question: "¿Quieres venirte conmigo de viaje?"
- "No" dodges (examples): "¿Seguro?", "Piénsatelo bien…", "Ese botón está roto 🙈" (no emoji if so decided), "Casi lo pillas".
- Inside: a welcome line, the destination, the dates, "Faltan {n} días para estar juntos".
- Reading text >= 16px, short sentences.

## 13. Responsive and delivery checklist
- Mobile-first: 390x844 is the target; test 360, 390, 768, 1024, 1440; no horizontal scroll; viewport doesn't block zoom.
- Invitation fits one screen (no scroll) at 390x844, also in low landscape (>=360px height) without "No" ending up off screen.
- Contrast >= 4.5:1; visible focus; logical tab order; `lang="es"`.
- No emojis as icons; no raw hex; everything clickable has `cursor-pointer`; reduced motion checked.
- Photo attribution visible; placeholders (if any) clearly labelled.

## 14. Phase 2 app shell and routing
- Routes (React Router): `/login` (login and set-new-password), `/` (Album), `/trips/new` (Trip form, create), `/trips/:id` (Trip page), `/trips/:id/edit` (Trip form, edit), and a catch-all `*` that shows the 404 screen (section 25). The Photo viewer opens over the Trip page as `?foto={photoId}` (section 32). Every route except `/login` needs a Member; a logged-out visitor on any route is sent to `/login`, and after logging in lands where they were going (default `/`).
- The `AuroraBackground` (section 2 gradient + three drifting blobs) sits behind every screen.
- **Boot state** (while the saved session is checked, usually <300ms): a centred `Heart` (32px, `--primary`) with a slow heartbeat (1.5s scale 1→1.08) and the label "Abriendo nuestro álbum…" (`--muted-foreground`, 16px). It appears only after 200ms so a fast boot never flashes it. Reduced motion: no heartbeat.
- Focus moves to each screen's `h1` (`tabIndex=-1`) after a route change, so screen-reader users hear where they are.
- `<title>`: "Entrar · Viajecito" on login, "Nuestro álbum · Viajecito" on the Album, "{title} · Viajecito" on a Trip page, "Nuevo viaje · Viajecito" and "Editar viaje · Viajecito" on the Trip form, "Nos hemos perdido · Viajecito" on the 404 screen.

## 15. Login screens
One centred card on the aurora background; the same layout serves both steps of the first login.

**Layout, mobile (390x844):** full `100dvh`, content vertically centred with 20px side padding and safe areas. Top to bottom: wordmark "Viajecito" in Great Vibes (40px, `--primary`), kicker line "solo para nosotros dos" (Nunito 14px, uppercase, letter-spacing .12em, `--muted-foreground`), then the card: white (`--card`), 24px radius, pink shadow, 24px padding, full width up to 400px. **Desktop:** same card, max-width 420px, centred; the wordmark grows to 56px. No split-screen image: the Album has no Photos yet, and invented imagery is not allowed.

**Card, step 1 — Entrar:**
- `h1` (Cormorant 700, `clamp(1.75rem,6vw,2.25rem)`): "Hola de nuevo, amor"
- Lead (16px, `--muted-foreground`): "Entra para ver nuestros viajes juntos."
- Fields (label above input, never placeholder-only): "Tu correo" (`type=email`, `autocomplete=username`, `inputmode=email`), "Tu contraseña" (`type=password`, `autocomplete=current-password`) with a show/hide icon button inside the input (`Eye`/`EyeOff`, 44x44, `aria-label` "Mostrar contraseña"/"Ocultar contraseña").
- Primary button, full width, `yes` variant: "Entrar" with `Heart` icon. While submitting: label "Entrando…", disabled, spinner-free (the heart pulses once per second; static with reduced motion).

**Card, step 2 — Set new password** (Cognito new-password challenge, first login only):
- `h1`: "Elige tu contraseña"
- Lead: "Es tu primera vez aquí. Cambia la contraseña temporal por una que solo sepas tú."
- Fields: "Nueva contraseña" (`autocomplete=new-password`), "Repítela". Hint under the first field (14px, `--muted-foreground`, linked with `aria-describedby`): "Al menos 12 caracteres, con mayúscula, minúscula, número y símbolo."
- Button: "Guardar y entrar".
- The step change cross-fades the card content (out 150ms, in 250ms, y 8px→0); the card itself stays put. Reduced motion: instant swap.

**Inputs:** 48px tall, 16px text (no iOS zoom), 16px radius, 1px `--border`, white fill; focus: 2px `--ring` outline + 2px offset. Error state: border `--primary`, message below in `--secondary-foreground` 14px with an `AlertCircle` icon, `role="alert"`; never colour alone.

**Errors (Spanish, mapped from Cognito/API codes):**
- Wrong email or password: "Ese correo o esa contraseña no nos suenan. ¿Lo intentas otra vez?"
- Passwords differ: "Las dos contraseñas no coinciden."
- Password too weak: "Esa contraseña es demasiado facilita. Prueba con una más larga, con mayúscula, número y símbolo."
- Too many attempts: "Demasiados intentos seguidos. Respira hondo y prueba en un ratito."
- Session from the temporary password expired: "Se nos ha pasado el tiempo. Vuelve a entrar con tu contraseña temporal."
- A valid login that isn't a Member: "Esta cuenta no forma parte de nuestro álbum."
- Network/unknown: "Algo ha fallado por el camino. Prueba otra vez."

**Motion:** on first paint the wordmark, kicker and card enter once (`data-enter`): opacity 0→1, y 16px→0, 0.5s `power2.out`, stagger 0.08s. Reduced motion: visible from the start.

## 16. Album shell
The Album is the home screen: all Trips, newest first. Section 18 adds the Trip grid.

**Header** (sticky top, 64px, safe-area top padding, background `--background` at 80% with `backdrop-blur`, bottom hairline `--border` once the page scrolls): left the wordmark "Viajecito" (Great Vibes 30px, `--primary`); right a greeting "Hola, {displayName}" (Nunito 600 15px, hidden below 360px wide) and a ghost pill button "Salir" with `LogOut` icon (44px tall). Desktop: content edges at the 1100px container.

**Title row:** `h1` "Nuestro álbum" (Cormorant 700, `clamp(2rem,7vw,3rem)`), with the script kicker "todos nuestros viajes" above it (Great Vibes 28px, `--primary`, `aria-hidden`), centred on every size so it lines up with the centred empty-state card. Once the Album has Trips the title row changes (section 18).

**Empty state** (no Trips): one soft card (white, 28px radius, pink shadow, 32px padding, max-width 560px, centred, text centred):
- An illustration made of Lucide icons (decorative, `aria-hidden`): a `Plane` (40px, `--ocean`) flying along a dashed arc that ends in a `Heart` (28px, `--primary`), on a `--secondary` circle 120px wide.
- `h2` (Cormorant 700, 28px): "Aquí empezará nuestra historia"
- Text (16px, `--muted-foreground`): "Todavía no hay ningún viaje en el álbum. ¿Planeamos el primero juntos?"
- Primary button `yes` variant: "Crear nuestro primer viaje" with `Plus` icon. Leads to `/trips/new`.
- Mobile: the card fills the width (20px side padding), sitting in the upper-middle of the screen (40px below the title). Desktop: centred under the title.

**Loading state** (Trips being fetched): two skeleton cards shaped like future Trip cards (4:3 `--muted` block + two text bars), with a soft shimmer (1.6s, opacity .6→1). Reduced motion: no shimmer. Shown only after 200ms.

**Error state** (the listing failed): the same soft card with a `CloudOff` icon (`--muted-foreground`), `h2` "No hemos podido abrir el álbum", text "Algo ha fallado por el camino. ¿Probamos otra vez?" and a `soft` button "Reintentar".

**Logout:** "Salir" signs out immediately (no confirmation: logging back in is cheap) and lands on `/login` with the line "Hasta pronto 💌" shown above the card for this visit only.

**Motion:** title row and the state card (empty or error) enter once when they mount (opacity, y 24px→0, 0.5s `power2.out`, the card 0.1s later); a state change never replays the title's entrance; the plane drifts gently along its arc (y ±4px, rotate ±3°, 4s `sine.inOut`, yoyo). Button hover: lift 2px; press: scale .98. Reduced motion: everything static and visible at once.

## 17. Phase 2 open decisions (for review in the walking-skeleton PR)
1. Login greeting "Hola de nuevo, amor" also greets a first-time login; alternative "Hola, amor".
2. The logout farewell uses one emoji ("Hasta pronto 💌"); drop it if emojis should stay out of the copy.
3. No confirmation on "Salir". Add one if accidental logouts become a thing on the phone.
4. The empty-state illustration is built from Lucide icons, not a drawing; a custom SVG could replace it later.

## 18. Album with Trips (ticket #9)
Extends section 16 once at least one Trip exists. The header, the loading state and the error state stay as in section 16.

**Title row with Trips:** the kicker and `h1` move to the left. A `yes` pill "Nuevo viaje" with `Plus` icon sits on the right, bottom-aligned with the `h1`. Mobile (390): the row stacks: kicker, `h1`, then the button at full width, 16px below. From 640px: one row, button at its natural width. Under the `h1`, a count line (15px, `--muted-foreground`): "{n} viajes juntos" ("1 viaje juntos" for one).

**Grid:** 1 column on mobile (20px side padding, 20px gap), 2 columns from 640px, 3 from 1024px (24px gap), inside the 1100px container. Order as the API returns it (newest `startDate` first); the client never re-sorts. 48px bottom padding plus the bottom safe area.

**Trip card (`TripCard`):** the whole card is a single link to `/trips/:id` (one `<a>` wrapping everything; no nested buttons). White `--card`, 24px radius, pink shadow, `overflow: hidden`.
- Top: the Cover area, 4:3. From ticket #10 it follows section 27: the first ready Photo fills the box (`object-fit: cover`), else the `CoverPlaceholder` (section 19), so the layout never changes.
- Status chip, top-left over the Cover area (12px inset, pill, 13px Nunito 700, `--card` at 90% with `backdrop-blur`, `--secondary-foreground` text):
  - upcoming: `Plane` icon + "En {n} días"; "Mañana" when n = 1.
  - past: no chip.
- Body (20px padding): title `h2` (Cormorant 700, 24px/1.15, two lines max with `line-clamp-2`); destination line with `MapPin` (18px, `--ocean`) + text (16px, `--foreground`, one line, ellipsis); dates line with `CalendarHeart` (18px, `--ocean`) + date range (15px, `--muted-foreground`).
- Hover (pointer devices): lift `y -4px`, shadow grows to `0 18px 40px -12px rgb(190 24 93 / .35)`, the placeholder icon nudges `y -3px`; 200ms `power2.out`. Press: scale .985. Focus-visible: 2px `--ring` outline, 4px offset, around the whole card (24px radius).
- Accessible name: the link is named by the title; destination and dates are read after it. The placeholder is `aria-hidden`.

**Date ranges (shared helper, unit-tested, `es-ES`):** day + short month without the period, year once at the end.
- Same year: "28 abr – 7 may 2027". Same month: "3 – 7 ago 2027". Same day: "28 abr 2027". Across years: "28 dic 2026 – 3 ene 2027".
- Use an en dash with spaces. Dates are calendar dates: parse `YYYY-MM-DD` as local date parts, never via `new Date("YYYY-MM-DD")` (that is UTC and shifts a day west of Greenwich).
- Trip length (Trip page and form): `end − start + 1` days. "1 día juntos" / "{n} días juntos".

**Upcoming vs past:** upcoming while `daysUntil(startDate) > 0` in the viewer's local time (the existing `lib/dates.ts`); from the start date on, past (`GLOSSARY.md`).

**Delete feedback:** after a Trip is deleted (section 22) the Album shows a status line above the grid (`role="status"`, 15px, `Check` icon, `--secondary` pill): "Hemos borrado «{title}» del álbum." It disappears after 5s or on the next navigation. If that was the last Trip, the empty state from section 16 shows instead, with the status line above it.

**Motion:** on first load the cards enter once after the title row: opacity 0→1, y 24px→0, 0.45s `power2.out`, stagger 0.06s, capped at the first 9 cards (the rest appear at once). Coming back to the Album from a Trip page does not replay it. Reduced motion: no entrance, no hover lift (shadow change only), no icon nudge.

## 19. Cover placeholder (`CoverPlaceholder`)
Where a Trip has no Cover photo (every Trip in this ticket), the Album card and the Trip page show a styled placeholder. It must look intentional, never broken, and must not imitate a real photo.

- **Fill:** one of three sunset gradients picked from the Trip `id` (stable hash mod 3), so a grid of placeholders isn't monotonous:
  1. "rosa": `--secondary` → `--accent` at 55%, 150deg
  2. "atardecer": `--muted` → `#FFD9C7` (the `--gradient-sunset` end stop) → `--accent` at 40%, 160deg
  3. "mar": `--secondary` → `--ocean` at 30%, 140deg
  Add the three as CSS variables (`--cover-rosa`, `--cover-atardecer`, `--cover-mar`), never inline hex. On top: one soft blurred blob (white, 35%) and a faint dashed flight arc (SVG, `--primary` at 25%, 1.5px dash 4 6).
- **Centre:** a white 60% circle (72px on cards, 104px on the Trip page) holding a Lucide icon in `--primary`, stroke 1.75: `Plane` for an upcoming Trip, `Camera` for a past one.
- **Label** (bottom-left, 12px inset, pill, 13px Nunito 600, `--card` at 85%, `--secondary-foreground`): upcoming "Las fotos vendrán con el viaje"; past "Aún sin fotos". The label is the visible "this is a placeholder" marker (section 13). On cards narrower than 300px the label shortens to "Sin fotos".
- The whole placeholder is `aria-hidden`; the status is already in the card text.
- **Motion:** none of its own besides the card hover nudge. Reduced motion: static.

## 20. Trip page (`/trips/:id`)
**Header:** the Album header (section 16) stays. Under it, a back link "Volver al álbum" (ghost pill, `ChevronLeft`, 44px tall), left-aligned at the container edge.

**Layout, mobile (390x844), top to bottom:**
1. Cover area: `CoverPlaceholder` at 4:3, full content width (20px side padding), 28px radius (photo frame), pink shadow.
2. Destination as the script kicker (Great Vibes 32px, `--primary`, one line, ellipsis; `aria-hidden` because it is repeated below).
3. `h1` title (Cormorant 700, `clamp(2rem,8vw,3rem)`, `text-balance`), `tabIndex=-1` for route focus.
4. Meta list (16px): `MapPin` + destination; `CalendarHeart` + date range; `Hourglass` + "{n} días juntos". Icons 20px `--ocean`.
5. Actions row (12px gap): `soft` pill "Editar" with `Pencil` → `/trips/:id/edit`; `ghost` pill "Borrar" with `Trash2` (`--secondary-foreground` text) → delete dialog (section 22). Both 48px tall, side by side at 390.
6. Countdown (upcoming only): the existing `Countdown` card, 32px below the actions. Not shown for past Trips (no "¡Ya estamos de viaje!" card on the page: past Trips are memories, not a live trip).
7. Description (if any): `h2` "Nuestro plan" for upcoming / "Lo que vivimos" for past (Cormorant 700, 28px), then the text (17px/1.65, `--foreground`, `white-space: pre-line`, max 65ch). If empty, the section is omitted (no "no description" filler).
8. Photos section: section 28 (ticket #10 replaced the ticket #9 stub "Pronto podremos subir aquí nuestras fotos.").

**Desktop (>= 1024px):** 12-column grid inside the 1100px container. Left 7 columns: the Cover area (4:3). Right 5 columns, vertically centred on the cover: kicker, `h1`, meta list, actions, then the Countdown card (full column width). Below, full width: description (max 65ch) and the Photos section. Tablet (640-1023): mobile order with the cover capped at 640px wide and centred.

**Countdown:** reuse `components/Countdown.tsx` with the Trip's `startDate`. Required copy fix for the builder: the singular reads "Falta 1 día para estar juntos" (today it renders "Faltan 1 día"). Its number count-up (1s, `power2.out`, once on enter) stays; reduced motion shows the final number at once.

**States:**
- **Loading** (after 200ms): skeleton cover (4:3 `--muted`), a 60%-wide bar for the title, three short bars for the meta list; shimmer as in section 16, none with reduced motion. The back link renders straight away.
- **Not found** (`trip-not-found`, or an id that isn't there): the section 16 state card with a `MapPinOff` icon, `h2` "Este viaje no está en nuestro álbum", text "Puede que lo hayamos borrado, o que el enlace se haya perdido por el camino." and a `yes` button "Volver al álbum". Since ticket #15 the icon is the small static `LostCompass` and the button carries a `Heart` (section 25, "Family").
- **Error** (network, `internal`): the section 16 error card, `h2` "No hemos podido abrir este viaje", "Reintentar" refetches.
- **Cover area:** section 27 (the first ready Photo, else the section 19 placeholder).

**Motion:** on mount, cover then text column then countdown: opacity 0→1, y 24px→0, 0.5s `power2.out`, stagger 0.08s. The cover additionally scales 0.98→1. Reduced motion: all visible at once.

## 21. Trip form (`/trips/new`, `/trips/:id/edit`)
A full page, not a dialog: it is long on a phone, it survives the Android back button naturally, and it can be linked.

**Layout, mobile:** header as section 16, back link (`ChevronLeft`) "Volver al álbum" on create, "Volver al viaje" on edit. Then a script kicker (Great Vibes 28px, `--primary`, `aria-hidden`): "¿a dónde nos escapamos?" on create, "retocando recuerdos" on edit. `h1` (Cormorant 700, `clamp(2rem,7vw,2.75rem)`): "Un viaje nuevo" / "Editar viaje". Then one white card (24px radius, pink shadow, 20px padding on mobile, 32px from 640px), full width; max-width 600px centred on desktop.

**Fields** (label above, 16px text, inputs as section 15: 48px, 16px radius, `--border`, `--ring` focus; never placeholder-only; placeholders are examples in `--muted-foreground`):
1. "Título" — placeholder "Escapada a Gran Canaria". `maxLength` 120. Required.
2. "Destino" — placeholder "Las Palmas de Gran Canaria", `MapPin` leading icon inside the input (20px, `--ocean`, 44px left padding). `maxLength` 120. Required.
3. Dates row: "Empieza el" and "Termina el", native `<input type="date">` (best picker on Android and iOS). Two columns from 360px wide (12px gap), stacked below. `min` on "Termina el" = the start date. When the start date is set and the end is still empty, the end is prefilled with the start date (one-day Trip); a filled end is never changed silently.
   - Under the row, a live hint (`aria-live="polite"`, 15px, `--muted-foreground`, `Hourglass` icon): "{n} días juntos" / "1 día juntos" once both dates are valid.
4. "Descripción (opcional)" — `<textarea>`, 4 rows, grows with content up to 12 rows then scrolls. Placeholder "Lo que soñamos hacer, dónde dormiremos, lo que no nos podemos perder…". `maxLength` 2000.
- Character counters (14px, right-aligned under the field, `aria-live="polite"`) appear only near the limit: from 100/120 on title and destination, from 1800/2000 on the description.
- Values are trimmed before sending (the API trims too). The description is sent as `""` when blank, which clears it on edit.

**Actions:** `yes` primary "Guardar viaje" (create) / "Guardar cambios" (edit) with `Heart` icon; `ghost` "Cancelar". Mobile: stacked full width, primary on top, 12px gap. From 640px: one row, right-aligned, Cancelar left of the primary. "Cancelar" goes back without asking (create → Album; edit → Trip page).
- Submitting: primary label "Guardando…", disabled, the heart pulses once per second (static with reduced motion). The fields stay editable-looking but read-only.
- Success: navigate to the Trip page (`/trips/:id`), with history `replace` so Back from the Trip page doesn't return to a filled-in form. The Trip page's entrance is the confirmation; no toast.

**Validation:** in the browser on submit, then live on each changed field after the first submit (never while typing the first time). Same rules as the API (section 23 messages): required title, required destination, real dates, end not before start, length limits. On a failed submit, focus moves to the first invalid field. Errors from the API land on the matching field by code; codes without a field show in a banner at the top of the card (`role="alert"`, `--secondary` background, 16px radius, `AlertCircle`).

**Edit states:**
- **Loading** the Trip (after 200ms): the card with four skeleton field bars; the `h1` shows straight away.
- **Not found** on load: the section 20 not-found card.
- **Not found** on save (deleted by the other Member meanwhile): banner "Este viaje ya no está en el álbum. Puede que lo hayamos borrado." with a link "Volver al álbum".

**Motion:** kicker, `h1` and card enter once (opacity, y 16px→0, 0.5s `power2.out`, stagger 0.08s), as on login. Field error messages appear with opacity + y 4px→0, 150ms. Reduced motion: no entrance; errors appear at once.

## 22. Delete confirmation
Uses the existing `Dialog` (`components/ui/dialog.tsx`: centred card, 28px radius, overlay `--foreground` at 60%, close button "Cerrar", 200ms CSS fade-in, none with reduced motion). Opened from "Borrar" on the Trip page.

- `role="alertdialog"` semantics (Radix `AlertDialog` or the `Dialog` with `aria-describedby`). Clicking the overlay or Escape cancels.
- Centre icon: `Trash2` 28px `--primary` on a 64px `--secondary` circle.
- Title (Cormorant 700, 26px): "¿Borramos «{title}»?" (title truncated with an ellipsis after 60 characters).
- Text (16px, `--muted-foreground`): "Desaparecerá del álbum para los dos y no hay vuelta atrás." (With Photos, the text changes as in section 35.)
- Buttons, stacked on mobile (cancel on top), one row from 480px (cancel left):
  - "Mejor no" — `soft` variant, **initial focus**.
  - "Sí, borrarlo" — new `destructive` button variant: `--foreground` (plum) fill, white text, pill, 48px, `Trash2` icon, no pink shadow. Plum keeps the palette but reads clearly different from the romantic `yes` pink, so the happy action and the destructive one never look alike. No new colour token.
- Deleting: "Borrando…", both buttons disabled, Escape and overlay disabled until it ends.
- Success (204), or `trip-not-found` (already gone): close, navigate to the Album with the section 18 status line.
- Failure: the dialog stays open with an inline alert above the buttons: "No hemos podido borrarlo. ¿Probamos otra vez?"; buttons re-enable.
- Motion: CSS fade as the existing component (overlay and content 200ms); exit 150ms. Reduced motion: none.

## 23. API errors in Spanish
The API returns `{ "error": { "code", "message" } }`; the SPA maps `code` to Spanish (one map in `lib/`, unit-tested) and never shows the English `message`.

| code | where it shows | Spanish |
|---|---|---|
| `title-required` | Título field | "Ponle un nombre a nuestro viaje." |
| `destination-required` | Destino field | "¿A dónde vamos? Falta el destino." |
| `title-too-long` | Título field | "Un pelín más corto, porfa: máximo 120 caracteres." |
| `destination-too-long` | Destino field | "Un pelín más corto, porfa: máximo 120 caracteres." |
| `description-too-long` | Descripción field | "Qué bonito todo, pero caben 2000 caracteres como mucho." |
| `invalid-date` | the empty/invalid date field (both if unclear) | start: "¿Cuándo empezamos? Elige una fecha." end: "¿Y cuándo volvemos? Elige una fecha." |
| `end-before-start` | Termina el field | "La vuelta no puede ser antes de la ida." |
| `trip-not-found` | page/banner/dialog per sections 20-22 | "Este viaje no está en nuestro álbum." |
| `invalid-body`, `internal`, `not-found`, unknown, network | form banner / state card / dialog alert | "Algo ha fallado por el camino. ¿Probamos otra vez?" |
| `unauthorized` | redirect to `/login`, returning here after | login shows: "Se nos ha cerrado la sesión. Vuelve a entrar, amor." |
| `not-a-member` | redirect to `/login` | login shows section 15: "Esta cuenta no forma parte de nuestro álbum." |

Client-side checks use the same texts, so the user sees one message whether the browser or the API caught it.

## 24. Open decisions (ticket #9, for review in its PR)
1. Card status chip shows days ("En 21 días") for upcoming Trips and nothing for past ones; alternative: a "Pasado" chip, or the year.
2. Placeholder gradient picked from the Trip id (three variants) rather than one fixed gradient.
3. The Trip page hides the Countdown for past Trips instead of showing "¡Ya estamos de viaje!" during the Trip's dates (the glossary makes a Trip past from its start date).
4. The end date is prefilled with the start date when empty; Cancel never asks "discard changes?".
5. Delete uses a plum (`--foreground`) "destructive" button instead of a new red token.
6. No success toast after saving; the Trip page entrance is the feedback.
7. The Photos section stub ("Pronto podremos subir aquí nuestras fotos.") is visible until the Photos tickets replace it.

## 25. 404 screen, "Nos hemos perdido" (ticket #15)
A Member who opens a route the app doesn't know (a mistyped or stale link) sees this screen instead of being bounced to the Album without explanation. It replaces the current catch-all redirect to `/`.

**Routing and access:**
- The catch-all `*` route stays inside `RequireMember`. A logged-out visitor on an unknown route goes to `/login` as today, and nothing about the app shows. After logging in they come back to the same unknown path and see this screen, which is the honest outcome.
- The URL is kept as typed (no redirect to `/404`), so the Member can see what was wrong with the link.
- `<title>`: "Nos hemos perdido · Viajecito". Focus moves to the `h1` (section 14).
- Only unmatched routes get this screen. A well-formed `/trips/:id` whose Trip doesn't exist keeps the Trip page's not-found state (section 20), which now belongs to the same family (see "Family" below).

**Copy (final, Spanish):**
- Script kicker (Great Vibes 32px, `--primary`, `aria-hidden`): "uy, nos hemos perdido"
- `h1` (Cormorant 700, `clamp(2rem,8vw,2.75rem)`, `text-balance`, `tabIndex=-1`): "Este camino no lleva a ningún sitio"
- Text (16px/1.55, `--muted-foreground`, max 36ch, centred): "Aquí no hay ningún viaje, solo un enlace que se ha perdido por el camino. Pero perderse contigo tampoco está tan mal… ¿volvemos a nuestros viajes?"
- Button, `yes` variant with `Heart` icon: "Volver al álbum". Leads to `/` (a normal push, so Back still returns to the broken link if the Member wants to look at it).
- Fine print under the button (13px, `--muted-foreground`, letter-spacing .04em): "Error 404 · página no encontrada". Plain wording for anyone who wonders what happened; it is the only non-playful line.

**Layout, mobile (390x844):**
- The Album header (section 16) stays, so the Member still sees they are logged in and can "Salir". No "Volver al álbum" back link under it: the screen has exactly one way back, the button, to keep the single clear action the ticket asks for.
- Below the header: a `<main>` with `min-height: calc(100dvh - 64px - safe-area-top)`, content centred vertically and horizontally, 20px side padding, 32px bottom padding plus the bottom safe area. At 390x844 the whole screen fits without scrolling.
- Top to bottom, all centred: the `LostCompass` illustration (below), 24px gap, kicker, `h1` (8px below), text (12px below), button (28px below, full width up to 320px), fine print (16px below).
- No card. The 404 is a whole screen, not a state inside one, so the content sits straight on the aurora background, like the Phase 1 Invitation. This is what tells it apart from the in-page state cards while the illustration keeps them related.

**Desktop (>= 1024px):** the same single centred column, max-width 520px, nudged slightly above centre (`padding-bottom: 8dvh`) so it reads as balanced under the header. The illustration grows to 200px, the `h1` caps at 2.75rem, the button takes its natural width (min 220px). Tablet: as mobile with the button at natural width.

**`LostCompass` illustration (new component, decorative, `aria-hidden`):**
- A `--secondary` circle, 160px on mobile, 200px on desktop.
- In its centre a Lucide `Compass` (56px / 68px, `--ocean`, stroke 1.75).
- Around it, a dashed SVG circle (radius = circle radius + 14px, `--primary` at 30%, 1.5px, dash 4 6): the flight path.
- On the path, a Lucide `Plane` (24px, `--primary`, stroke 2) resting at about the 1 o'clock position, rotated to follow the path.
- Two tiny `Heart` icons (12px, `--accent`) floating at 8 o'clock and 5 o'clock just outside the path.
- Built only from Lucide icons and SVG, like the Album empty state (section 16), so the two read as the same family.

**Motion (GSAP, `useGSAP`, `gsap.matchMedia()`):**
1. Entrance (once on mount, ~1.6s): illustration fades and scales in (opacity 0→1, scale .9→1, 0.5s `back.out(1.6)`); kicker, `h1`, text, button and fine print follow (opacity, y 16px→0, 0.45s `power2.out`, stagger 0.07s, starting at 0.2s).
2. In parallel, the plane flies one full lap of the dashed circle and stops back at 1 o'clock (rotate the plane's wrapper 360deg around the circle centre, 1.6s `power2.inOut`). The compass "looks for north": rotate 0 → −25° → 18° → −8° → 0, 1.4s total, `sine.inOut` keyframes, as if it is lost too.
3. Idle (after the entrance, until unmount): the plane bobs gently on its spot (y ±3px, 3s `sine.inOut`, yoyo, infinite); every ~7s the compass does a small wobble (±6°, 0.8s). Only `transform` and `opacity`.
4. Button hover: lift 2px; press: scale .98 (section 5).
- **Reduced motion:** everything visible at once; the plane sits still at 1 o'clock, no lap, no compass wobble, no bob. Same layout and copy.
- Pause the idle loops when the tab is hidden (GSAP does this via `requestAnimationFrame`; no extra work).

**States:**
- **Boot** (session being checked): the section 14 boot state, as on every route; the 404 renders only once the Member is known.
- **Empty / loading / error:** none. The screen fetches nothing.
- **Missing Photo:** none; the screen shows no Photos and never invents one.

**Family with the Trip not-found state (decision: same family, not reuse):**
The full 404 screen doesn't fit inside the Trip page (which has its own back link and sits in the Trip layout) or inside the Trip form, and "this Trip was deleted" is a different message from "this link is wrong". So the two stay separate, but share a visual language:
- The Trip not-found card (section 20, also shown by the Trip form, section 21) keeps its card, `h2` and copy, and swaps its bare `MapPinOff` icon for a small static `LostCompass`: 96px `--secondary` circle, `MapPinOff` (36px, `--primary`) in place of the compass, the same dashed path with the plane at 1 o'clock, no hearts. Motion: only the existing card entrance; the plane and icon are static (an in-page state shouldn't perform).
- Its button gains the `Heart` icon so both "Volver al álbum" buttons look the same.
- Implementation hint: `LostCompass` takes `size: 'page' | 'card'` and an optional `icon`; `animated` is true only on the 404 screen.
- The Album empty state (section 16) is the sibling illustration: plane on a dashed arc. Together they read as one story: the plane flies to new Trips, or gets lost and circles back.

## 26. Open decisions (ticket #15, for review in its PR)
1. Copy: kicker "uy, nos hemos perdido", `h1` "Este camino no lleva a ningún sitio", and the line "perderse contigo tampoco está tan mal". Alternative `h1`: "Por aquí no se va a ningún viaje".
2. The plain "Error 404 · página no encontrada" fine print. Drop it if it breaks the mood.
3. No card on the 404 screen (content on the aurora), while the Trip not-found keeps its card. Alternative: the same white card for both.
4. Same family, not reuse: Trip not-found keeps its own copy and gets the small static `LostCompass`.
5. Unknown routes keep their URL (no redirect to `/404`); after logging in, a visitor returns to the unknown path and sees the 404.
6. The header stays on the 404 screen, with no separate back link above the content.

## 27. Cover area with Photos (`TripCover`, ticket #10)
One component, `TripCover`, draws the Cover area on the Trip card (section 18) and the Trip page (section 20). Its only input is an optional image address plus what `CoverPlaceholder` already needs (Trip `id`, upcoming/past). Ticket #13 (Cover photo) only changed which address is passed in (section 39); nothing else in the layout changed.

- **Which image (since ticket #13, section 39):** the Trip's `coverPhoto` from the API decides it; the client no longer guesses.
  - Album card: `coverPhoto.thumbnailUrl`.
  - Trip page: `coverPhoto.largeUrl`.
  - `coverPhoto` is `null`: the `CoverPlaceholder` from section 19, unchanged, with its labels "Las fotos vendrán con el viaje" / "Aún sin fotos".
- **Drawing:** the placeholder gradient (section 19 fill only: no icon, no label, no arc) sits underneath as the background. The `<img>` sits on top with `object-fit: cover`, `alt=""` (decorative; the card or page text already names the Trip), `decoding="async"`, and `loading="lazy"` on cards after the first row. The image fades in when it has loaded, so there is no flash of a broken or half-painted image.
- **Photo count chip** (replaces the placeholder label once `photoCount > 0`): bottom-left, 12px inset, in the same pill style as the section 19 label (13px Nunito 700, `--card` at 85% with `backdrop-blur`, `--secondary-foreground`), with an `Images` icon (14px): "{n} fotos" / "1 foto". It is shown on cards only. The Trip page shows the count in its Photos header (section 28). The upcoming status chip (top-left) stays as it is.
- **Load failure** (`onError`: an expired media cookie, or the object is gone): renew the media session once (section 30) and retry once. If that fails too, show the full `CoverPlaceholder` with the label "No hemos podido cargar la portada" (cards narrower than 300px: "Sin portada"). It must never show the browser's broken-image icon.
- **Motion:** image fade-in, opacity 0→1, 400ms `power2.out`. The card hover from section 18 also scales the image 1→1.03 (inside `overflow: hidden`), 300ms. Reduced motion: the image appears at once and does not zoom on hover.

## 28. Trip page: Photos section (ticket #10)
This section replaces the ticket #9 stub. It is a `<section aria-labelledby>` under the description, using the full content width on every size. The Photo viewer is a later ticket, so tiles are not interactive yet. Any focus or hover styles they gain come with the viewer.

### Header
- `h2` "Nuestras fotos" (Cormorant 700, 28px), with a count line under it (15px, `--muted-foreground`):
  - "{n} fotos" / "1 foto" (ready Photos only, `photoCount`).
  - While any Photo is unfinished, add " · {m} revelándose".
  - Hidden while the Trip has no Photos at all.
- Upload button: `yes` pill "Subir fotos" with an `ImagePlus` icon, 48px tall. Mobile (390): on the right of the `h2`, aligned with the `h2` baseline row. The two fit side by side at 360px; below 360px the button drops under the header at full width. Desktop: right-aligned in the same row.
- The button opens a hidden `<input type="file" multiple accept="image/jpeg,image/png,image/webp">` (no `capture` attribute, so Android opens the gallery/photo picker rather than the camera). Ticket #11 widens `accept` to HEIF (section 44). The input is reset after every pick, so picking the same file again still fires. The button stays enabled during uploads: a new pick joins the queue.

### Grid
- Square tiles (1:1, `object-fit: cover`), 14px radius, `--muted` background.
  - 3 columns on mobile (8px gap; ~111px tiles at 390).
  - 4 columns from 640px (12px gap).
  - 5 columns from 1024px (12px gap) inside the 1100px container.
- Order: as the API returns `photos` (date taken, oldest first). The client never re-sorts. Tiles for files the API doesn't list yet (still being sent, or refused at link time) go at the end, in pick order.
- A Photo that becomes ready may move to its date-taken place (a Photo without EXIF gets its upload time, so in practice it stays at the end until ticket #11). Superseded by section 44: with real dates taken, moves are animated.
- 48px bottom padding plus the safe area. On mobile it is more, while the upload bar (section 29) is showing, so the bar never covers the last row.

### Tile states (`PhotoTile`)
Every non-ready tile reuses the section 19 placeholder fill (gradient picked from the Photo `id`, same hash), scaled down: no arc. Each has a centred 44px white-60% circle with an icon or a ring, and a label pill at the bottom (11px inset, 12px Nunito 700, `--card` at 85%, `--secondary-foreground`, one line). Labels are visible text, never colour alone (section 13).

| State | Source | Centre | Label | Notes |
|---|---|---|---|---|
| **Queued** | local, waiting for its turn | empty progress ring (`--secondary` track) | "En cola" | |
| **Uploading** | local, POST to S3 in flight | progress ring (3px, `--primary` on `--secondary`), percentage in 12px 700 inside | "Subiendo…" | `role="progressbar"`, `aria-valuenow`, `aria-label` "Subiendo {filename}" |
| **Upload failed** | local: network error, non-204, or link expired | `RotateCcw` icon | "No ha llegado" | the whole tile is a `<button>` with `aria-label` "Reintentar subir {filename}" (section 29) |
| **Revealing** | API `awaiting-upload` or `processing`, sent by this device or not | `Sparkles` icon, `--primary` | "Revelando…" | one state for both API statuses (spec). After 2 minutes on screen the label becomes "Tarda un poquito…" |
| **Failed** | API `failed` | `ImageOff` icon, `--secondary-foreground` | "No hemos podido revelarla" | superseded by section 42 (label "Sin revelar", tile opens `FailedPhotoDialog` with retry) |
| **Ready** | API `ready` | the thumbnail `<img>` | none | see below |

- **Revealing** is the photographic "developing" metaphor: the image is in the darkroom. It replaces a generic "processing" spinner, and it is the copy the user sees for the spec's "processing" placeholder.
- **Uploading and revealing tiles show no local preview** of the picked file. Decoding up to 200 full-size camera photos on an Android phone would stall the page and use too much memory. The placeholder plus the filename, read out to screen readers, is the "it arrived" signal. The first real pixels are the server thumbnail.
- **Ready tile:**
  - `<img src={thumbnailUrl}>` with `loading="lazy"` (eager for the first 9), `decoding="async"` and `width`/`height` attributes set to the tile box, so the layout does not shift.
  - `alt`: "Foto del {d MMM yyyy}" from `takenAt` (the section 18 date helper, a single date), e.g. "Foto del 3 dic 2026". Ticket #12's captions replace it.
  - The revealing placeholder stays underneath until the image's `load` event, then the image fades over it. There is never an empty grey square between the two states.
  - On load error: renew the media session and retry once (section 30). After that, the tile shows `ImageOff` + "No se ha podido cargar".
- **Identity across states:** the same tile (React key = `photoId` once the link is issued; a local id before that) goes from queued to uploading to revealing to ready. It never unmounts and remounts, so the grid doesn't jump.

### Empty state (Trip with no Photos and nothing uploading)
A soft dashed card in the place of the grid: 2px dashed `--border`, 24px radius, 32px padding, centred text, max-width 560px, centred.
- A `--secondary` circle (88px) with `ImagePlus` (36px, `--primary`), decorative.
- `h3` (Cormorant 700, 24px):
  - past Trip: "Aún no hay fotos de este viaje"
  - upcoming: "Aquí vivirán las fotos del viaje"
- Text (16px, `--muted-foreground`):
  - past: "Elige todas las que quieras de tu galería y las vamos colocando solitas."
  - upcoming: "Cuando estemos allí, sube las fotos y aparecerán aquí."
- A `yes` button "Elegir fotos" (`ImagePlus` icon) opening the same input. The header's "Subir fotos" is hidden while the empty card shows, so there is only one call to action.
- A hint under the button (14px, `--muted-foreground`): "JPG, PNG o WebP, hasta 30 MB cada una." (section 44 adds HEIC)
- As soon as the first file is picked, the empty card gives way to the grid (with the tiles) and the header button.

### Loading
The Trip page loading state (section 20) adds the Photos `h2` and 6 skeleton tiles (`--muted`, same shimmer; none with reduced motion).

### Errors that are not per file (inline banner above the grid, `role="alert"`, `--secondary` background, 16px radius, `AlertCircle`)
- Upload links could not be requested (network, `internal`, `invalid-body`): "No hemos podido preparar la subida. ¿Probamos otra vez?" with a `soft` button "Reintentar". It retries that batch's link request. The batch's tiles wait as "En cola" in the meantime.
- `trip-not-found` on the link request (the other Member deleted the Trip): "Este viaje ya no está en el álbum. Puede que lo hayamos borrado." with a link "Volver al álbum". The batch's queued tiles are dropped.
- Polling failures are silent: polling keeps its interval and simply tries again. After 3 failures in a row, show "Se nos ha cortado la conexión. Seguimos intentándolo…" (`role="status"`, not an alert). It disappears on the next success.
- `no-files` and `too-many-files` never reach the user: the client never sends an empty batch, and it chunks picks into batches of at most 50.

### Motion
- New tiles (a fresh pick) enter with opacity 0→1 and scale .96→1, 250ms `power2.out`, stagger 0.03s, capped at the first 12 (the rest appear at once).
- Progress ring: `stroke-dashoffset` follows progress with a 200ms linear tween, so 10% jumps don't snap.
- Revealing tiles: a soft diagonal light sweep, i.e. a white 30% gradient band moving across the tile on `transform: translateX` in a 1.8s loop. It is CSS, not GSAP, since there can be dozens at once. It pauses when the tab is hidden.
- Revealing → ready: the image fades in (opacity 0→1, 450ms) while scaling 1.04→1, a gentle "developed" settle. The ring or icon underneath fades out with it.
- Upload failed: one horizontal shake (x ±4px, 2 cycles, 300ms) when the tile enters that state.
- Reduced motion: no entrance, no sweep (the label "Revelando…" carries the state), the ring updates without tweening, ready images appear at once, no shake.

## 29. Uploads: flow, per-file refusals and the upload bar (ticket #10)

### Flow (what the builder implements; the user sees the result in sections 28 and 29)
1. **Pick.** Check every file in the browser, in pick order:
   - Type: `file.type` must be in JPEG/PNG/WebP. If `file.type` is empty (some Android pickers), infer the type from the extension `.jpg/.jpeg/.png/.webp`. Section 44 adds HEIF.
   - Size: more than 0 bytes, at most 30 MiB (31457280 bytes).
   - Name: not empty, at most 255 characters, no control characters.

   Files that fail are refused at once, with the same codes as the API. They never become tiles.
2. **Ask for links** for the accepted files in batches of at most 50, in pick order. Entries the API refuses join the refused list (by `error.code`).
3. **Send.** POST each file to its presigned form (`fields` first, the file last as `file`), **3 at a time**. That is gentle on mobile data and on a phone's memory, and still quick. Use `XMLHttpRequest` (`upload.onprogress`), since `fetch` has no upload progress. A 204 makes the tile "Revelando…".
4. **Poll** `GET /api/trips/{id}` every 4s while any Photo on screen is unfinished (`awaiting-upload`, `processing`, or local queued/uploading). Pause while `document.hidden`, refetch at once on return, and stop when none are left.
5. **Uploads outlive the Trip page.** The queue lives in one app-level upload store, not in the page component. Going back to the Album keeps uploads running, and the upload bar follows the Member to any screen. While uploads are in flight, `beforeunload` asks the browser to confirm leaving (the browser's own dialog; its text can't be styled).
6. **Retry an upload-failed tile** (tap it): if the link is younger than 14 minutes, re-POST with the same link. Otherwise request a fresh link for that file (a new `photoId`, swapped onto the same tile). The old `awaiting-upload` record cleans itself up after 24 h.

### Per-file refusals (`UploadRefusals`)
A card above the grid (white, 20px radius, pink shadow, 20px padding, `role="alert"`). It collects refusals from one pick: browser checks and API entries together.
- Title row: `AlertCircle` (20px, `--primary`) and text (16px 700):
  - "No hemos podido subir 1 foto" / "No hemos podido subir {n} fotos"
  - a ghost icon button `X` 44x44 on the right, `aria-label` "Entendido".
- One line per file (15px). The filename comes first in `«»`, middle-truncated to 28 characters so the extension stays visible ("«IMG_20261203_…_0042.mov»"). Control characters are shown as "�". The message follows:

| code | Spanish |
|---|---|
| `unsupported-file-type` | "«{name}» no es una foto que sepamos abrir. Por ahora solo JPG, PNG o WebP." (section 44 updates it for HEIC) |
| `file-too-large` | "«{name}» pesa más de 30 MB y no nos cabe. ¿Tienes una versión más ligera?" |
| `empty-file` | "«{name}» está vacía. Puede que no se haya copiado bien." |
| `invalid-filename` | "«{name}» tiene un nombre que no sabemos guardar. Cámbiaselo y prueba otra vez." |
| any other per-file code | "«{name}» no ha podido subirse. ¿Probamos otra vez?" |

- More than 5 refusals: show the first 5 and a disclosure button "Ver las {k} restantes" (expands in place).
- Refusals from a later pick replace the card's content, since it always describes the latest pick. The card stays until dismissed or until the Member leaves the Trip page.
- If every file of a pick is refused, the empty state (if any) stays below the card.
- The section 23 code map gains these four codes plus the two section 28 banners. The client checks use the same texts, so a refusal reads the same whichever side caught it.

### Upload bar (`UploadBar`)
The upload bar answers "is it safe to close the app?" (spec story 20). It appears when the first file of a pick starts sending.
- **Placement, mobile:** fixed to the bottom, 12px from the side edges and `12px + env(safe-area-inset-bottom)` from the bottom. White card, 20px radius, pink shadow, 16px padding, `role="status"` with `aria-live="polite"` (announces only the text lines, never the percentage).
- **Placement, desktop (>= 1024px):** bottom-right, 24px inset, 380px wide.
- **Content while sending:**
  - Line 1 (16px 700): "Subiendo {done} de {total} fotos" (singular: "Subiendo 1 foto").
  - Line 2 (14px, `--muted-foreground`): "No cierres la app hasta que terminen".
  - Under both, a 6px pill progress bar (`--primary` on `--secondary`) for total bytes sent over total bytes, animated with `transform: scaleX` from the left.
  - Off the Trip page, line 2 becomes a link "Ver «{trip title}»" back to the Trip.
- **All sent:** `CheckCircle2` (`--ocean`) + "¡{total} fotos a salvo!" (singular "¡Foto a salvo!"). Line 2: "Ya puedes cerrar la app. Las terminamos de revelar nosotros." The bar hides itself after 6s, or earlier with its `X` (44x44, "Cerrar").
- **Some failed:** `AlertCircle` + "Han llegado {ok} de {total}". Line 2: "Toca las que faltan para reintentarlo." It stays until all are sent or it is dismissed. Dismissing doesn't cancel anything.
- Not shown for refusals (those are in the refusals card) and not for revealing: once a file is sent, the Member's part is done.

### Motion
- The bar slides in from below (y 100%→0 plus opacity, 300ms `power2.out`) and leaves faster (200ms).
- On "all sent" the check icon pops once (scale .6→1, `back.out(2)`, 350ms).
- Text changes swap without animation, so screen readers and eyes don't fight.
- Refusals card: enters like the section 21 field errors (opacity + y 4px→0, 150ms).
- Reduced motion: the bar and card appear and disappear with a ≤100ms fade, no pop, and the progress bar updates without tweening.

## 30. Media session (no screen, visible effects)
- The SPA calls `POST /api/media-session` after login or boot, before rendering any Photo, and again 3 h after each success. Thumbnails must never be requested before the first session exists, or the first paint shows load errors.
- One shared "renew" helper is used by every `onError` on a `/media/` image (sections 27-28). It dedupes concurrent calls, so 30 broken tiles trigger one renewal, and each image retries once.
- No visible UI of its own. If the session can't be created, images fall back to their placeholders (sections 27-28), and the Trip page shows the section 28 banner style with "No podemos enseñar las fotos ahora mismo. ¿Probamos otra vez?" and "Reintentar".

## 31. Open decisions (ticket #10, for review in its PR)
1. No local previews while uploading or revealing: tiles stay as styled placeholders until the server thumbnail exists (memory and speed on the phone). Alternative: small previews from `createImageBitmap` with resizing, at a CPU cost.
2. The "Revelando…" developing metaphor for `processing` (and `awaiting-upload`), instead of a literal "Procesando…".
3. Uploads keep running when the Member leaves the Trip page, and the upload bar follows them across screens. Simpler alternative: uploads tied to the page, with a leave confirmation.
4. 3 files at a time. Higher would be faster on Wi-Fi, but rougher on mobile data while travelling.
5. Album cards show only `thumbnails[0]` plus a "{n} fotos" chip. A 2x2 mosaic of the four `thumbnails` was considered and left out to keep the cards calm. The ~400px thumbnail looks a little soft on a full-width card on a 3x phone; ticket #13 could serve a larger cover version.
6. The Trip page cover uses the first Photo's large version (sharp), the Album card its thumbnail (fast).
7. No drag-and-drop on desktop in this ticket (the button and picker work everywhere). It is cheap to add later if wanted.
8. Tiles are not clickable until the Photo viewer ticket. A failed (`failed`) Photo has no actions until the retry/delete ticket (retry: section 42).

## 32. Photo viewer (`PhotoViewer`, ticket #12)
Opens one Photo full screen, shows its large version, and lets the Members go through the Trip's Photos, caption them, see who uploaded each one, and delete one. This replaces the "tiles are not interactive yet" note in section 28.

### Opening, URL and sequence
- A **ready** tile in the Photos grid (section 28) becomes a `<button>` (the `<img>` inside it). `aria-label`: the caption if any (first 120 characters), else "Abrir la foto del {d MMM yyyy}" (or "Abrir foto" when there is no `takenAt`). Focus: `--ring` 2px + 2px offset on the 14px radius. Hover (pointer devices only): the image scales 1→1.03 inside the tile, 200ms.
- Opening pushes `?foto={photoId}` onto the Trip page URL (history `push`); moving to another Photo inside the viewer uses `replace`; closing goes `back()` when the viewer pushed the entry, else `replace` without the param. So the Android back gesture and the browser Back close the viewer, and a shared or reloaded link opens it again once the Trip loads. An unknown or non-ready `foto` id is dropped silently (`replace`) and the grid shows.
- **Sequence:** only **ready** Photos, in the API's `photos` order (date taken, oldest first). The client never re-sorts. Non-ready Photos are skipped (they have no large version). No wrap-around: the first Photo has no "previous", the last no "next".
- While the viewer is open, the Trip polling from section 29 keeps running. A Photo that becomes ready joins the sequence at its place; the Photo on screen never changes under the Member, only the counter does.

### Layout, mobile (390x844)
A full-screen layer (`position: fixed; inset: 0; height: 100dvh`) above the header and the upload bar (the bar stays in the DOM and returns on close). Body scroll is locked while it is open.
- **Stage background:** `--foreground` (plum `#2A1220`) at 96%, with one soft `--primary` radial glow at 12% behind the bottom panel. It is a dark "darkroom" stage for the Photo, not a dark mode: the app chrome around it stays the section 2 palette. White text on it is >14:1.
- **Top bar** (56px + `env(safe-area-inset-top)`, 12px side padding):
  - left: counter "{i} de {n}" (15px Nunito 700, white at 85%), `aria-hidden` (the live region announces it, below);
  - right: close button, `X` 24px, 44x44 round, white icon on white 12% fill, `aria-label` "Cerrar".
- **Photo area:** fills the space between the top bar and the bottom panel. The `<img src={largeUrl}>` uses `object-fit: contain`, centred, 12px radius on the image itself (not on the box), no shadow. `alt`: the caption, else "Foto del {d MMM yyyy}", else "Foto de {trip title}".
- **Previous / next buttons:** visible on every size (swipe is never the only way, WCAG 2.5.7). 44x44 round, `ChevronLeft` / `ChevronRight` 24px, white icon on plum 55% with `backdrop-blur`, vertically centred on the Photo area, 8px from the edges. `aria-label` "Foto anterior" / "Foto siguiente". At the ends the missing one is not rendered (not just disabled).
- **Bottom panel** (`PhotoInfo`): sits under the Photo, 20px side padding, 16px top padding, `16px + env(safe-area-inset-bottom)` bottom padding. Top to bottom:
  1. **Caption** (Nunito 17px/1.5, white, `white-space: pre-line`). Up to 3 lines with `line-clamp-3`; if longer, a text button "Ver más" / "Ver menos" (14px 700, white at 85%, underline, 44px touch height) expands it in place. Expanded, the panel grows up to 50dvh and scrolls inside; the Photo area shrinks to make room.
     - No caption: a dashed pill button "Añadir una frase" with `PenLine` 18px (white at 85%, 1.5px dashed white 40% border, 44px tall). It opens the caption editor (section 33).
  2. **Meta line** (14px, white at 75%, `·` separators, wraps if needed): `CalendarHeart` 16px + "{d MMM yyyy}" (omitted without `takenAt`); `UserRound` 16px + "Subida por {uploadedBy}" (omitted when `uploadedBy` is absent; never "Subida por undefined").
  3. **Actions row** (12px gap, 8px top margin), both 44px pills on white 12% fill, white text 15px 700:
     - "Editar frase" with `Pencil` (only when a caption exists; the empty state uses "Añadir una frase" above instead).
     - "Borrar" with `Trash2`. Opens the Photo delete dialog (section 34).

### Layout, desktop (>= 1024px)
- Same plum stage. The Photo area is centred on the left part of the screen; on the right, a **side panel** 360px wide (full height, 32px padding, plum lighter step: white 6% fill, left border white 10%). It holds the same `PhotoInfo` content, top-aligned, with the counter moved into it above the caption, and the caption never clamped (it scrolls inside the panel).
- Close button: top-right of the screen, 48x48. Previous / next: 56x56, centred vertically on the Photo area, 24px from its edges (in the gutter, not over the image when the image is narrow).
- Photo area: max `calc(100vw - 360px - 160px)` wide and `calc(100dvh - 96px)` tall.
- Tablet (640-1023): the mobile layout, with the panel capped at 640px wide and centred.

### Input
- **Keyboard:** `ArrowLeft` / `ArrowRight` move; `Escape` closes; `Home` / `End` jump to the first / last Photo. None of these fire while focus is in the caption textarea (section 33) or while a dialog is open on top.
- **Swipe (touch, pointer events, `touch-action: pan-y` on the Photo area):**
  - Horizontal drag: the Photo follows the finger (`transform: translateX`), the neighbour peeks in from the side 16px apart. Release past 25% of the width, or a flick faster than 0.5 px/ms, commits; otherwise it springs back. At the ends the drag resists (moves at 30% of the finger) and springs back.
  - Drag down more than 120px (or a fast downward flick) closes the viewer; the Photo scales down and the stage fades with the drag (stage opacity 1→0.4 over 240px). Up-drag does nothing.
  - Swipe is disabled while the caption editor is open.
- **Pinch zoom:** not in this ticket (open decision). The large version is ~1600px and reads well at `contain`.
- Neighbours: the large versions of the previous and next Photos are preloaded (`new Image()`) as soon as a Photo is shown.

### Focus and screen readers
- The viewer is a Radix `Dialog` (`role="dialog"`, `aria-modal="true"`), `aria-label` "Fotos de «{trip title}»". Focus is trapped inside; the page behind is `inert`.
- On open, focus goes to the close button (predictable, and Escape works from anywhere).
- A visually hidden live region (`aria-live="polite"`) announces each Photo after a move: "Foto {i} de {n}. {d MMM yyyy}. {caption}" (missing parts are left out). It does not announce on open (the dialog label and the focused close button do that), and it debounces 300ms so holding an arrow key doesn't queue a speech per Photo.
- When a previous/next button disappears at an end while focused, focus moves to the other one (or to the close button when there is only one Photo).
- **On close**, focus returns to the grid tile of the Photo that was **last shown** (not necessarily the one that opened it), scrolled into view (`block: "nearest"`). If that Photo is gone (deleted), focus goes to the Photos `h2` (`tabIndex=-1`).

### States
- **Loading the large version:** the Photo's thumbnail (already in the browser cache from the grid) is shown at once at the same `contain` size, blurred 12px, with the section 28 "revealing" light sweep over it. The large image fades over it on `load`. If the large isn't there after 200ms a small 3px ring spinner (white on white 20%) shows in the centre. Never an empty black frame.
- **Load error:** renew the media session once and retry (section 30). If it fails again: the section 19 placeholder fill (gradient from the Photo id) in a 4:3 box, `ImageOff` 32px, "No hemos podido cargar esta foto" (16px 700, `--secondary-foreground` on a white 85% pill) and a white `soft` pill "Reintentar". Caption, meta and actions still work, so a broken Photo can still be deleted.
- **Missing large version** (`largeUrl` absent on a ready Photo, should not happen): treat as the load error state.
- **Photo gone** (a caption save or a delete returns `photo-not-found`, i.e. the other Member deleted it): remove it from the sequence and show the next Photo (else the previous; else close the viewer), with the status line "Esta foto ya no estaba en el álbum." in the live region and as a 3s toast-like pill above the bottom panel (white card, 16px radius, plum text, `role="status"`).
- **Trip gone** (polling or a save returns `trip-not-found`): close the viewer; the Trip page shows its not-found state (section 20).

### Motion
- **Open:** the stage fades in (opacity 0→1, 250ms). The Photo grows from the tapped tile's rectangle to its place (FLIP with GSAP: `x`, `y`, `scale` from the tile's box, 380ms `power3.out`); the top bar, arrows and bottom panel fade in 120ms later (200ms). If the tile isn't on screen (deep link), the Photo just fades and scales .96→1, 300ms.
- **Move to another Photo (buttons, keys):** the current slides out 40px toward the side it leaves and fades (180ms `power2.in`), the next slides in from 40px on the other side and fades in (260ms `power2.out`). Swipe: the drag already moved it; the commit finishes the slide from where the finger left it (240ms `power2.out`); a cancelled swipe springs back with `back.out(1.4)`, 300ms.
- **Close:** reverse FLIP into the tile of the last shown Photo (300ms `power2.inOut`; exits faster than the entrance), chrome fades out first (120ms). Tile off screen: fade out 200ms.
- **Caption "Ver más":** the panel height change is not tweened (no height animation); the new lines fade in, 150ms.
- **Reduced motion:** open and close are a 150ms opacity fade, no FLIP or scale. Moving between Photos swaps them with a 120ms cross-fade, no slide. Swipe still works as input, but the Photo doesn't follow the finger: a horizontal swipe past 50px commits with the cross-fade, a downward swipe past 120px closes with the fade. No light sweep on the loading thumbnail (the spinner after 200ms carries it). No hover zoom on tiles.

## 33. Caption editor (`CaptionEditor`, ticket #12)
Inline in the viewer's `PhotoInfo` panel (mobile bottom panel, desktop side panel), replacing the caption text and the actions row while open. Not a separate dialog: the Member keeps seeing the Photo they are writing about.

- **Open from:** "Añadir una frase" (no caption) or "Editar frase". Focus moves to the textarea with the caret at the end.
- **Field:** visible label "Una frase para esta foto" (14px 700, white at 85%). `<textarea>` on white (`--card`, plum text, 16px Nunito, 16px radius, 12px padding, `--ring` focus), 3 rows, grows with content up to 8 rows then scrolls. Placeholder (`--muted-foreground`): "El atardecer más bonito de todo el viaje…". On mobile the panel rises with the on-screen keyboard (`visualViewport` resize; the Photo area shrinks, the textarea and buttons stay visible).
- **Counter:** from 450 characters, under the field, right-aligned, 13px white at 75%, "{n}/500", `aria-live="polite"`. Count Unicode code points (`[...text].length`), as the API counts runes. No `maxLength` attribute: it counts UTF-16 units and would cut emoji wrongly; the limit is enforced on save.
- **Buttons** (row, right-aligned, 12px gap, 44px): `ghost` "Cancelar" (white text) and `yes` "Guardar" with `Heart` 18px.
  - `Ctrl/Cmd + Enter` saves. `Enter` adds a line break (captions may have several lines). `Escape` cancels the editor only (does not close the viewer), without asking.
- **Clearing:** saving an empty (or whitespace-only) text clears the caption; the panel goes back to "Añadir una frase". No separate "Quitar frase" button.
- **Unchanged text:** "Guardar" just closes the editor, no request.
- **Saving:** `PATCH /api/trips/{id}/photos/{photoId}` with the trimmed text. "Guardar" reads "Guardando…", both buttons disabled, the textarea read-only, the heart pulses (static with reduced motion). Swipe, arrows and Escape stay off until it ends.
- **Success:** the editor closes, the caption shows the response's `caption`, the tile's `aria-label`/`alt` update, and the live region says "Frase guardada" (or "Frase quitada" when cleared). Focus returns to "Editar frase" (or "Añadir una frase").
- **Validation:** in the browser on save (same rules as the API), then live after the first failed save. The error sits under the field (14px 700, on a white 90% pill with `AlertCircle` 16px `--primary`, `--secondary-foreground` text), linked with `aria-describedby`, `role="alert"`; focus stays in the textarea.

| code | Spanish |
|---|---|
| `caption-too-long` | "Qué bonito, pero caben 500 caracteres como mucho. Recorta un poquito." |
| `invalid-characters` | "Se ha colado algún carácter raro que no sabemos guardar. ¿Lo quitas?" |
| `photo-not-found` | viewer "Photo gone" state (section 32): "Esta foto ya no estaba en el álbum." |
| `trip-not-found` | close the viewer, Trip page not-found state |
| `invalid-body`, `internal`, network, unknown | under the field: "No hemos podido guardar la frase. ¿Probamos otra vez?" (text kept, buttons re-enabled) |

- Client check for `invalid-characters`: any control character other than line break, tab and CR (Unicode category Cc), as the API.
- **Motion:** the editor replaces the caption with a 150ms opacity cross-fade; errors enter as the section 21 field errors (opacity + y 4px→0, 150ms). Reduced motion: no fades.

## 34. Deleting a Photo (`DeletePhotoDialog`, ticket #12)
Same component family as the Trip delete confirmation (section 22): `alertdialog`, centred card, "Mejor no" `soft` with **initial focus**, the plum `destructive` button, buttons stacked on mobile and in a row from 480px. When opened from the viewer it stacks above the viewer (its overlay over the plum stage) and returns focus to the viewer's "Borrar" on cancel.

### From the viewer (ready Photo)
- Top: the Photo's thumbnail, 96x96, 20px radius, pink shadow, instead of the `Trash2` circle (the Member sees exactly which Photo goes). If the thumbnail fails, the section 22 `Trash2` circle.
- Title (Cormorant 700, 26px): "¿Borramos esta foto?"
- Text (16px, `--muted-foreground`): "Desaparecerá del viaje para los dos y no hay vuelta atrás."
- Buttons: "Mejor no" / "Sí, borrarla" (`Trash2`).

### From a `failed` tile (grid)
- The section 42 **Failed** tile ("Sin revelar") is a `<button>`, with focus ring as ready tiles. This dialog opens from "Quitarla del viaje" in `FailedPhotoDialog` (section 42), never straight from the tile (section 43). Failed Photos never enter the viewer.
- Top: the section 28 failed tile look at 96x96 (placeholder fill, `ImageOff`).
- Title: "¿Quitamos esta foto?"
- Text: "«{filename}» no se ha podido revelar. La quitamos del viaje para que no estorbe." (filename middle-truncated to 28 characters as section 29).
- Buttons: "Mejor no" / "Sí, quitarla" (`Trash2`).

### Behaviour (both)
- Deleting: `DELETE /api/trips/{id}/photos/{photoId}`. The destructive button reads "Borrando…", both buttons disabled, Escape and overlay disabled until it ends.
- Success (204) or `photo-not-found` (already gone, treat as done): the dialog closes, the Photo leaves the list at once (no refetch needed; the next poll agrees), the count line (section 28) updates, and the live region says "Foto borrada".
  - In the viewer: show the next Photo, else the previous; with none left, close the viewer and focus the Photos `h2` (the grid has then turned into the section 28 empty state, if no unfinished Photos remain).
  - From the grid: focus goes to the next tile in the grid, else the previous one, else the Photos `h2`.
  - If the deleted Photo was the cover, the cover area (section 27) shows the next default cover or the placeholder on the next render.
- `trip-not-found`: close everything; the Trip page shows its not-found state.
- Failure (`internal`, network): stays open with the section 22 inline alert: "No hemos podido borrarla. ¿Probamos otra vez?" Buttons re-enable. A retry is safe.
- **Motion:** the dialog fades as section 22. In the viewer, after success the Photo shrinks and fades (scale 1→.92, opacity 1→0, 200ms `power2.in`), then the next one enters as a normal move (section 32). In the grid, the tile shrinks and fades the same way, then the grid reflows without animation (as section 28). Reduced motion: the Photo or tile disappears at once, the next Photo appears with the 120ms cross-fade.

## 35. Trip delete confirmation with Photos (ticket #12)
Section 22 stays, with its text now saying the Photos go too. The count is the number of Photos the Trip page knows (`photos.length`, every listed state, not only ready ones).
- 0 Photos: "Desaparecerá del álbum para los dos y no hay vuelta atrás." (unchanged)
- 1 Photo: "Desaparecerá del álbum para los dos, con su foto, y no hay vuelta atrás."
- n Photos: "Desaparecerá del álbum para los dos, con sus {n} fotos, y no hay vuelta atrás."
- When there are Photos, the dialog shows up to 3 of the Trip's thumbnails as a small fanned stack (64x64 each, 14px radius, white 3px border, rotated -6°, 0°, 6°, overlapping by 24px, `aria-hidden`) in place of the `Trash2` circle. No Photos (or no ready ones): the `Trash2` circle as before.
- Uploads in flight for this Trip (section 29 upload store): add one line under the text, 15px `--secondary-foreground` with `AlertCircle`: "Aún se están subiendo fotos a este viaje; se cancelarán." Confirming cancels those uploads first, then deletes.
- Deleting may take a second or two with many Photos: "Borrando…" stays as in section 22; after 3s the text under the title changes to "Borrando el viaje y sus fotos…" (`role="status"`), so a long wait reads as progress.
- Error handling and motion: as section 22 (a retry after a failure is safe; the Trip is still there).

## 36. API errors in Spanish (additions, ticket #12)
The section 23 map gains:

| code | where it shows | Spanish |
|---|---|---|
| `caption-too-long` | caption editor | "Qué bonito, pero caben 500 caracteres como mucho. Recorta un poquito." |
| `invalid-characters` | caption editor | "Se ha colado algún carácter raro que no sabemos guardar. ¿Lo quitas?" |
| `photo-not-found` | viewer status / delete dialog (treated as done) | "Esta foto ya no estaba en el álbum." |
| other / network on caption save | caption editor | "No hemos podido guardar la frase. ¿Probamos otra vez?" |
| other / network on Photo delete | delete dialog alert | "No hemos podido borrarla. ¿Probamos otra vez?" |

Live-region and status strings: "Foto {i} de {n}", "Frase guardada", "Frase quitada", "Foto borrada".

## 37. Open decisions (ticket #12, for review in its PR)
1. The viewer stage is dark plum (`--foreground` at 96%), not the pink aurora: Photos read better on a dark frame. This is the only dark surface in the app; decision #3 (light only) still holds for the chrome.
2. The viewer lives in the URL as `?foto={photoId}` so Back / the Android back gesture closes it and a link reopens it, rather than a separate route `/trips/:id/photos/:photoId`.
3. Only ready Photos are in the viewer; a `failed` Photo is deleted straight from its tile; revealing Photos (`awaiting-upload`, `processing`) have no actions in the UI even though the API can delete them.
4. Swipe down closes the viewer (on top of the close button, Escape and Back). No pinch zoom in this ticket.
5. Captions are edited inline in the viewer, not in the grid; the grid shows no caption text (only in tile labels for screen readers).
6. No wrap-around from the last Photo to the first.
7. Trip delete shows a fanned stack of up to 3 thumbnails and the Photo count; Photo delete shows the Photo itself.

## 38. Choosing the Cover photo in the viewer (`CoverControl`, ticket #13)
Either Member picks the Cover photo from the full-screen Photo viewer (section 32): the Member is looking at the Photo at full size, which is the right moment to decide "this one represents the Trip". Only ready Photos are in the viewer (section 32), and only ready Photos can be the Cover photo (API), so the action never shows for a Photo that can't take it. There is no "remove the cover" action: the API has no clear route, and choosing another Photo replaces the choice.

### Three states, from the Trip's `coverPhoto` (compare `coverPhoto.id` with the Photo on screen)
| State | When | What shows |
|---|---|---|
| **Not the cover** | `coverPhoto.id !== photo.id` | the button "Usar como portada" |
| **Cover by default** | `coverPhoto.id === photo.id` and `chosen: false` (the first ready Photo in date-taken order, nobody picked it) | a quiet note "Portada por ser la primera" **and** the button "Usar como portada" (choosing it fixes it, so a Photo with an earlier date added later won't take its place) |
| **Chosen cover** | `coverPhoto.id === photo.id` and `chosen: true` | the badge "Nuestra portada", no button |

### Placement
- In `PhotoInfo` (section 32), on its own line **between the meta line and the actions row**, left-aligned, 8px top margin. It does not join the actions row: three pills ("Usar como portada", "Editar frase", "Borrar") don't fit 350px at 390 and would wrap unevenly. Same slot on the desktop side panel and while the caption is expanded. While the caption editor (section 33) is open, the cover control is hidden with the actions row.
- **Button "Usar como portada"**: 44px pill, white 12% fill, white text 15px 700, `Frame` icon 18px (the same family and look as "Editar frase" / "Borrar", so it reads as one more thing to do with this Photo). `aria-label` is the visible text.
- **Note "Portada por ser la primera"** (cover by default): sits in front of the button on the same line (wraps under it below 360px). 14px, white at 75%, `Frame` 16px, no fill, no border: it is information, not a control.
- **Badge "Nuestra portada"** (chosen): 36px pill, `--primary` fill, white text 14px 700, `Heart` 16px filled with `currentColor`. A `<p>` with `tabIndex=-1` (it receives focus after choosing, below), not a button. White on `--primary` is ~6.5:1. On the plum stage it is the only pink chip, so it reads at a glance.

### Grid tile marker (section 28 ready tiles)
- The Photo whose `id === coverPhoto.id` gets a small marker top-left of its tile (6px inset): a 24px white-85% circle with `Frame` 14px `--primary` (by default) or `Heart` 14px filled `--primary` (chosen). `aria-hidden`; the tile's accessible name (section 32) gains ", portada del viaje" at the end.
- At most one tile has it. It moves when the cover changes; it disappears when the Trip has no cover.

### Choosing
- Tap "Usar como portada": `PUT /api/trips/{id}/cover-photo` with `{ "photoId" }`.
- **Saving:** the button reads "Poniéndola de portada…", disabled (`aria-disabled`, keeps focus), its `Frame` icon replaced by the section 32 3px ring spinner at 16px. Moving to another Photo, swiping, Escape and closing stay **enabled**: the request belongs to that Photo id, not to the screen. If the Member has moved on when it ends, only the live region and the status pill report it.
- **Success (200):** the response is the full Trip; replace the page's Trip with it (cover, `photos`, `photoCount`), the same as a poll result, so the cover area (section 39), the tile marker and the viewer agree at once.
  - The button turns into the badge "Nuestra portada" (the "Portada por ser la primera" note goes too). Focus moves to the badge, so it isn't lost when the button disappears.
  - Live region (section 32): "Ya es la portada del viaje".
  - The section 32 status pill above the bottom panel, 3s: "¡Nueva portada! Así nos verá el álbum."
- **Chosen by the other Member meanwhile:** no conflict handling; the last choice wins (API). A poll that brings a different `coverPhoto` simply moves the badge / button states and the tile marker. No announcement.
- **Errors** (inline under the control, the section 33 error style: white 90% pill, `AlertCircle` 16px `--primary`, `--secondary-foreground` text 14px 700, `role="alert"`; the button re-enables; focus stays on it). Shown only while that Photo is on screen; moving away clears it.

| code | Spanish / behaviour |
|---|---|
| `photo-not-ready` | "Esta foto aún se está revelando. Cuando esté lista, la ponemos de portada." (a race: the viewer only holds ready Photos) |
| `photo-not-found` | the section 32 "Photo gone" state: "Esta foto ya no estaba en el álbum." |
| `trip-not-found` | close the viewer; the Trip page shows its not-found state (section 20) |
| `invalid-body`, `internal`, network, unknown | "No hemos podido cambiar la portada. ¿Probamos otra vez?" |

- A retry is safe (choosing the same Photo again is a no-op for the result).

### Motion
- Button → badge: the button fades out (120ms), the badge enters with opacity 0→1 and scale .8→1 (`back.out(2)`, 320ms), and its heart does one beat (scale 1→1.25→1, 360ms) as it lands. One beat only, never a loop.
- Status pill (section 32 has no motion for it; this defines it for both tickets): enters with opacity 0→1 and y 8px→0, 200ms `power2.out`; leaves with a 200ms fade.
- Tile marker: when it moves, it appears on the new tile with scale .6→1 and a fade, 200ms `power2.out`; the old one disappears at once.
- Spinner while saving: a 0.8s linear rotation.
- **Reduced motion:** the button and badge swap at once, no heartbeat, the status pill and marker appear and disappear without transitions, and the spinner is replaced by a static `Loader` icon with the "Poniéndola de portada…" text carrying the state.

## 39. Cover area and Album card with the Cover photo (ticket #13)
Section 27 is **confirmed**: `TripCover`'s layout, placeholder underlay, fade-in, count chip, load-failure path and hover zoom stay as they are. Ticket #13 changes only which address is passed in, and section 27's "Which image" now reads from `coverPhoto`:
- **Album card:** `coverPhoto.thumbnailUrl`. **Trip page:** `coverPhoto.largeUrl`. The client no longer matches `thumbnails[0]` to a Photo.
- **`coverPhoto: null`** (no ready Photos, including a Trip whose Photos are all still revealing): the section 19 `CoverPlaceholder` with its labels. The Album card's count chip (section 27) still needs `photoCount > 0`, so a Trip with only revealing Photos shows the placeholder label, as before.
- **Fallback is the API's job.** When the chosen Photo is deleted (section 34) or the other Member changes the choice, the next Trip response carries the new `coverPhoto`; the UI only redraws.

### Changing image in place
`TripCover` keys its `<img>` by `coverPhoto.id`. When the id changes (a choice, a delete, a poll), the old image stays visible until the new one has loaded, then the new one fades over it (opacity 0→1, 400ms `power2.out`, the section 27 fade), and the old one is removed. No flash of the placeholder between two Photos. From a Photo to `null`, the placeholder replaces the old image at once.

### No visible "chosen" marker on the cover area
The Trip page and Album card covers look the same whether the Cover photo was chosen or is the default: the cover represents the Trip either way, and a label on the cover would clutter it. The difference shows only in the viewer (section 38) and the grid tile marker.

### States
- Loading and load failure: as section 27 (renew the media session once, retry once, then the placeholder with "No hemos podido cargar la portada" / "Sin portada").
- Reduced motion: the new cover replaces the old at once (as section 27).

## 40. API errors in Spanish (additions, ticket #13)
The section 23 map (and #12's section 36) gains:

| code | where it shows | Spanish |
|---|---|---|
| `photo-not-ready` | under the cover control in the viewer | "Esta foto aún se está revelando. Cuando esté lista, la ponemos de portada." |
| other / network on choosing the cover | under the cover control in the viewer | "No hemos podido cambiar la portada. ¿Probamos otra vez?" |

`photo-not-found` and `trip-not-found` reuse section 36 / section 20. Live-region and status strings: "Ya es la portada del viaje", "¡Nueva portada! Así nos verá el álbum."

## 41. Open decisions (ticket #13, for review in its PR)
1. The Cover photo is chosen only from the viewer (section 38), not from the grid (long-press or a tile menu) and not from the Trip page cover. One place, next to "Editar frase" and "Borrar".
2. A Photo that is the cover only by default still offers "Usar como portada", with the note "Portada por ser la primera", so the Members can fix it before an earlier-dated Photo arrives and takes its place.
3. There is no "Quitar portada" (the API has no clear route); choosing another Photo is the way to change it.
4. The cover area on the Trip page and the Album card shows no "chosen" label; only the viewer badge and a small grid tile marker tell chosen from default.
5. Album cards keep the ~400px thumbnail (ticket text: "the Cover photo's thumbnail"), which looks a little soft on a full-width card on a 3x phone. `coverPhoto.largeUrl` is in the list response, so a `srcset` (thumbnail 400w, large 1600w) is a cheap later change, at a data cost on mobile.
6. The Trip page cover is not tappable. Making it open the viewer on the Cover photo would also help Members find the "Usar como portada" action.

## 42. Failed Photos: tile, note and retry (ticket #11)
Ticket #10 shows a `failed` Photo as a dead tile. Ticket #11 gives it a reason in Spanish and a way back: `POST /api/trips/{id}/photos/{photoId}/retry` starts processing again on the same original. The Member only ever sees "revealing failed, try again"; the API's reason picks the wording but is never shown raw.

### Failed tile (`PhotoTile`, state **Failed**, replaces the section 28 row)
- Look: the section 28 placeholder fill (gradient from the Photo `id`), the 44px white-60% circle with `ImageOff` (`--secondary-foreground`), and the label pill **"Sin revelar"**.
  - Why the label changes: "No hemos podido revelarla" needs ~150px at 12px Nunito 700 and the mobile tile is ~111px, so it wrapped or clipped. The full sentence moves into the dialog and the accessible name.
- The whole tile is a `<button>`, `aria-label` "Sin revelar: «{filename}». Ver opciones" (starts with the visible text, WCAG 2.5.3). Focus: `--ring` 2px + 2px offset on the 14px radius. Press: scale .97 (100ms). Hover (pointer devices): the white circle goes to 80%. Tapping opens the `FailedPhotoDialog` below.
- The header count line (section 28) gains " · {k} sin revelar" while any Photo is `failed` (e.g. "12 fotos · 2 revelándose · 1 sin revelar").

### `FailedPhotosNote` (above the grid while k >= 1 failed Photos)
A quiet summary, so a failed tile among 200 isn't missed and several can be retried at once. Same banner shape as the section 28 non-per-file errors (`--secondary` background, 16px radius, 16px padding), but `role="status"`: it describes a standing state, not a new error. It sits under the refusals card (section 29) when both show.
- `ImageOff` 20px `--primary`, then:
  - line 1 (16px 700): "1 foto no se ha podido revelar" / "{k} fotos no se han podido revelar"
  - line 2 (14px, `--muted-foreground`): "Tócala para ver qué ha pasado." / "Toca una para ver qué ha pasado."
- Button, `soft` pill 44px with `RotateCcw` 18px: "Reintentar" (k = 1) / "Reintentar todas" (k >= 2).
  - Mobile: text on top, button full width under it. From 480px: button on the right, vertically centred.
- Retry all: one `POST …/retry` per failed Photo, 3 at a time (the section 29 pace). The button reads "Reintentando…" and is disabled until every request has answered. Each 200 turns its tile to **Revealing** at once. `photo-not-failed` and `photo-not-found` are silent (refetch the Trip). If some requests fail (`internal`, network), their tiles stay failed and line 2 becomes "No hemos podido reintentar {j}. ¿Probamos otra vez?" (singular "No hemos podido reintentar una. ¿Probamos otra vez?").
- No dismiss button: the note leaves by itself when no Photo is `failed` (retried, or deleted once ticket #12 lands).

### `FailedPhotoDialog`
Uses the section 22 `Dialog` (centred card, 28px radius, overlay `--foreground` at 60%, "Cerrar" button), max width 440px. Plain `role="dialog"`, not `alertdialog`: nothing in it destroys anything.
- **Top:** the failed tile look at 96x96 (placeholder fill, `ImageOff`), 20px radius, pink shadow, `aria-hidden`. Same visual as section 34's failed variant on the #12 branch, so the two dialogs read as one family.
- **Title** (Cormorant 700, 26px): "Esta foto se nos ha resistido"
- **Filename** (15px 700, `--secondary-foreground`): "«{filename}»", middle-truncated to 28 characters as in section 29.
- **Reason** (16px, `--muted-foreground`), chosen by the code before the `:` in `failureReason`:

| `failureReason` code | Spanish |
|---|---|
| `unreadable-image` | "No hemos sabido abrirla. Puede que el archivo esté dañado o que sea enorme (más de 50 megapíxeles)." |
| `processing-error`, missing, or anything else | "Algo se nos ha atascado mientras la revelábamos. Suele ser cosa de un momento." |

- **Hint** (14px, `--muted-foreground`, under the reason), only for `unreadable-image`: "Podemos probar otra vez, pero si vuelve a fallar, mejor la quitamos y la subes de nuevo desde tu galería."
- **Second try** (this device retried this Photo in this session and it came back `failed`): the hint becomes, whatever the reason: "Ya lo hemos intentado otra vez y nada. Mejor la quitamos y la vuelves a subir." The memory is session-local (upload store, section 29); nothing new is stored.
- **Buttons**, stacked on mobile (cancel on top), one row from 480px (cancel left), as section 22 (plus the ghost "Quitarla del viaje" under them, section 43):
  - "Ahora no" — `soft`.
  - "Probar otra vez" — `yes`, `RotateCcw` icon, **initial focus** (the safe, wanted action; contrast with section 22 where cancel takes focus).
- **Retrying:** "Probar otra vez" reads "Probando…", both buttons disabled, Escape and overlay disabled until the answer (it is quick).
- **Outcomes:**
  - 200: the dialog closes, the tile turns **Revealing** (its 2-minute "Tarda un poquito…" timer starts again), polling resumes (section 29), and the live region says "Volvemos a revelarla". Focus returns to the same tile. While revealing it is no longer a button, so it gets `tabIndex={-1}` and `aria-label` "Revelando «{filename}»" to hold focus; it stays out of the tab order.
  - 409 `photo-not-failed` (already retried by the other Member, or it finished meanwhile): close, refetch the Trip, no message. The tile shows whatever the API says.
  - 404 `photo-not-found` (deleted meanwhile): close, the tile leaves the grid, live region "Esta foto ya no estaba en el álbum." (the #12 string). Focus goes to the next tile, else the previous, else the Photos `h2`.
  - 404 `trip-not-found`: close; the Trip page shows its not-found state (section 20).
  - 401 / 403: as section 23.
  - 500 `internal`, network: the dialog stays open with the section 22 inline alert above the buttons (`role="alert"`): "No hemos podido volver a intentarlo. ¿Probamos otra vez?" Buttons re-enable. The Photo is still `failed` (the API put it back), so a new try is safe.
- **Changed under an open dialog:** if a poll shows the Photo is no longer `failed` (the other Member retried it), the dialog closes and the live region says "Ya se está revelando otra vez." If it is gone, as `photo-not-found` above.

### Announcements
- A Photo on screen that turns `failed` during the session: live region (polite) "No hemos podido revelar «{filename}»." Several in one poll: "{n} fotos no se han podido revelar." After a retry from this device: "No hemos podido revelar «{filename}» tampoco esta vez."
- Photos already `failed` when the page loads are not announced; the note and the count line carry them.

### Layout, desktop
Nothing new beyond the sizes above. Desktop tiles are wide enough for longer labels, but the label stays "Sin revelar" on every size so the grid reads the same. The note spans the content width (1100px container); the dialog is centred at 440px.

### Motion
- **Failed tile, entering during the session** (revealing → failed): the sweep stops, the `Sparkles` circle cross-fades to `ImageOff` (200ms), then one horizontal shake (x ±4px, 2 cycles, 300ms), as the section 28 upload-failed tile. No shake for tiles already failed on load.
- **Retry accepted** (failed → revealing): the `ImageOff` circle cross-fades to `Sparkles` (200ms) and the sweep starts. With "Reintentar todas", the tiles flip with a 0.03s stagger capped at 12 (the rest at once), as section 28's entrance.
- **"Probando…" / "Reintentando…":** the `RotateCcw` icon turns -360° in 700ms, looping while the request is in flight (`ease: none`).
- **Note:** enters like the refusals card (opacity + y 4px→0, 150ms) and leaves with a 150ms fade.
- **Dialog:** section 22 fade (200ms in, 150ms out).
- **Reduced motion:** no shake, no stagger, no icon turn (the button text carries the state), no sweep (the label carries it). State swaps are instant, the note and dialog use a ≤100ms fade or none.

## 43. Failed tile with retry and delete (when #11 and #12 are both merged)
On the #12 branch, section 34 makes the failed tile a button that opens the delete dialog ("¿Quitamos esta foto?") directly. On this branch, the same tile opens `FailedPhotoDialog` (section 42). They compose like this. Whichever ticket merges into `feat/album` second applies these edits to both sections; the rest of section 34 stays as written.

- **One tap target per tile.** The failed tile keeps opening `FailedPhotoDialog`, never the delete dialog. No small overlay buttons on the tile (two 44px targets do not fit a 111px tile with its label).
- `FailedPhotoDialog` gains a third action under the button pair: a `ghost` button "Quitarla del viaje" (`Trash2` 18px, `--secondary-foreground` text, 44px tall, centred, 8px above it). It is visibly the least prominent: retrying is the first answer, deleting the second.
- Activating it closes `FailedPhotoDialog` and opens section 34's `DeletePhotoDialog` in its "From a failed tile" form ("¿Quitamos esta foto?", "Mejor no" / "Sí, quitarla"). Close then open: never two dialogs stacked, and each keeps its own role (`dialog`, then `alertdialog`). The 200ms fades meet; no extra motion.
- In `DeletePhotoDialog`, "Mejor no" returns focus to the failed tile (section 34 says so already). The success behaviour stays section 34's.
- Built: section 34 and section 42 now carry the merged wording (tile `aria-label` "Sin revelar: «{filename}». Ver opciones", which starts with the visible text for WCAG 2.5.3, and the hint copy below).
- When "Quitarla del viaje" is activated focus goes to "Mejor no" of the delete dialog (never back to the tile in between).
- Hint copy once deleting exists:
  - `unreadable-image`: "Podemos probar otra vez, pero si vuelve a fallar, mejor la quitamos y la subes de nuevo desde tu galería."
  - second try: "Ya lo hemos intentado otra vez y nada. Mejor la quitamos y la vuelves a subir."
- `FailedPhotosNote` stays retry-only. No "Quitar todas" button; deleting stays one Photo at a time, behind a confirmation.
- The viewer (section 32) still skips failed Photos.

## 44. HEIF and date-taken order (ticket #11)
The rest of ticket #11 (rotation, metadata stripping, retries with backoff) shows no UI of its own: Photos simply come out upright, and there is no location anywhere in the app.

### HEIF in the picker and the copy
- The section 28 file input: `accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"`. The extensions are there because some browsers and pickers report HEIC files with an empty or generic type.
- The section 29 browser check accepts `image/heic` and `image/heif`. When `file.type` is empty or `application/octet-stream`, the extension decides (`.jpg/.jpeg/.png/.webp/.heic/.heif`), and the link request sends `contentType: ""`. The API then picks the type, and the S3 form fields are sent exactly as given (backend handoff).
- Empty-state hint (section 28): "JPG, PNG, WebP o HEIC, hasta 30 MB cada una."
- Refusal for `unsupported-file-type` (section 29): "«{name}» no es una foto que sepamos abrir. Por ahora solo JPG, PNG, WebP o HEIC."
- A HEIF Photo looks like any other in every state. Tiles never preview local files (section 28), so the browser never has to decode HEIF.

### Date-taken order on screen
The grid is still in the API's order (date taken, oldest first, whoever uploaded it). Now that dates are real, a Photo that becomes ready usually lands in the middle of the grid, not at the end. Section 28's "no animation for the move" would make tiles jump without a trace, so this ticket animates the move.
- On each poll whose result changes the order, the grid reflows with **GSAP Flip** (part of GSAP, so still the only animation library): record the tile boxes, render the new order, and animate `x`/`y` from the old boxes, 400ms `power2.inOut`. A tile that just became ready does its section 28 "developed" settle at its new place at the same time.
- Animate only tiles whose old or new box is within one viewport of the screen. Tiles further away jump. If more than 24 tiles would move, skip the Flip entirely (a big batch landing at once reads better as one swap than as a swarm).
- At most one Flip per poll. A poll that arrives mid-Flip finishes the running one (`progress(1)`) before measuring.
- Scroll position: rely on the browser's scroll anchoring. No JS scroll correction, since fighting the Member's own scroll is worse than a small shift.
- Tiles not yet listed by the API (still sending) stay at the end, as section 28 says.
- **Reduced motion:** no Flip; tiles take their new places at once (the section 28 rule).
- Ready tile `alt` (section 28) now carries the real date taken: "Foto del 3 dic 2026". For a Photo with no EXIF date it is the upload date, and the UI does not tell the two apart.

## 45. API errors and strings in Spanish (additions, ticket #11)
The section 23 map gains:

| code | where it shows | Spanish |
|---|---|---|
| `photo-not-failed` | retry (dialog or note) | nothing: refetch the Trip silently |
| `photo-not-found` | retry (dialog or note) | live region: "Esta foto ya no estaba en el álbum." (same string as #12) |
| `internal`, network, unknown on retry | `FailedPhotoDialog` alert | "No hemos podido volver a intentarlo. ¿Probamos otra vez?" |
| same, during "Reintentar todas" | `FailedPhotosNote` line 2 | "No hemos podido reintentar {j}. ¿Probamos otra vez?" |
| `unsupported-file-type` (updated) | refusals card | "«{name}» no es una foto que sepamos abrir. Por ahora solo JPG, PNG, WebP o HEIC." |

`failureReason` is not an error code. It has its own small map, in the same `lib/` module and unit-tested, shown in section 42.

Live-region and status strings: "Volvemos a revelarla", "Volvemos a revelar {n} fotos" (after "Reintentar todas"), "Ya se está revelando otra vez.", "No hemos podido revelar «{filename}».", "{n} fotos no se han podido revelar.", "No hemos podido revelar «{filename}» tampoco esta vez."

## 46. Open decisions (ticket #11, for review in its PR)
1. Retry sits behind a dialog (tap tile → reason → "Probar otra vez") rather than tap-to-retry on the tile. The dialog gives room for the reason, and it is the one place #12's delete can join (section 43). The cost is one more tap than the upload-failed tile, which retries on tap.
2. The failed tile label shortens from "No hemos podido revelarla" to "Sin revelar" so it fits a 111px tile; the full sentence lives in the dialog and the accessible name.
3. `FailedPhotosNote` with "Reintentar todas" is an addition the ticket didn't ask for. It helps when a batch of HEIC files fails together. Without #12, a Photo that can't be read keeps the note on screen for good. Alternative: no note, only the count line and the tiles.
4. For `unreadable-image` (it will fail again on the same file), "Probar otra vez" is still the primary action, with a hint to upload the file again. Alternative: once #12 is merged, make "Quitarla del viaje" the primary action on a second failure.
5. Reordering when a Photo becomes ready is animated with GSAP Flip (skipped beyond 24 moving tiles and with reduced motion). This replaces section 28's "no animation for the move".
6. The grid has no day headers ("3 dic") even though dates taken are now real. It could group by day in a later ticket.
7. A Photo with no EXIF date shows its upload date with no marker. Alternative: a subtle "fecha de subida" hint in the viewer meta line (#12).

## Decisions (confirmed by the user, Phase 1)
1. **Palette**: pink / coral / turquoise as defined above.
2. **Script font**: Great Vibes for short accents only.
3. **Dark mode**: none, light only.
4. **Gallery on mobile**: horizontal scroll-snap carousel (next card peeks in). Places: Playa de Las Canteras, Vegueta, Parque de Santa Catalina, Dunas de Maspalomas, Roque Nublo (can change once real photos exist).
5. **"No" messages**: the text changes on each dodge, cycling through the list of phrases (with a final cheeky one such as "Vale, ya me rindo 😄" kept in the rotation). "No" **never gives up**: it keeps dodging indefinitely and is never clickable.
6. **"Sí" cap**: max scale ~2.6 on mobile, **reached for real**: growth step is 0.26 per dodge, so the cap is hit around the 7th dodge.
7. **Countdown**: included, **days only** (e.g. "Faltan 23 días para estar juntos"); no seconds ticker, no `role="timer"` needed.
8. **Transition**: circular expansion + hearts.
9. **Fonts**: self-hosted via `@fontsource` (no external requests).
10. **Sound / haptics**: none for now.
