# Validation report

- Round: 3 of 3 (last allowed round)
- Verdict: **PASS** (0 blocking findings; 3 improvements)

## Deterministic checks
- `npm run build`: pass.
- `npm run lint`: pass, no errors.

## Round 3 method
Fresh pages, 15 dodges each, checked with `getBoundingClientRect()` after every dodge.
- Normal motion: 6 pages per config (90 dodges), 800 ms wait per dodge.
- Reduced motion: 8 pages per config (120 dodges), 220 ms wait. The first reduced-motion run used an 80 ms wait. It was below the 150 ms dodge debounce, so some taps were ignored. That was a test artifact, so I re-ran it.
- Touch configs used real CDP `Input.dispatchTouchEvent` touchStart/touchEnd sequences. The mouse config used `page.mouse` move, down and up. I did not use Playwright `click()` for "No".
- After the 15 dodges, one more real tap or click went to "No" at its final spot. Throughout, I checked that the screen stayed on the invitation and that the inner screen never appeared.

| Config | Motion | "No" off screen | "Sí" off screen | H-scroll | Question jump | Max "Sí" scale | Scale at 7th dodge | "No" clicked / inner screen reached | Console errors | "Sí" leads inside |
|---|---|---|---|---|---|---|---|---|---|---|
| 390x844 touch | normal | 0 | 0 | 0 | 0 px | 2.60 | 2.60 | 0 | 0 | 2/2 |
| 390x844 touch | reduced | 0 | 0 | 0 | 0 px | 2.60 | 2.60 | 0 | 0 | 2/2 |
| 360x640 touch | normal | 0 | 0 | 0 | 0 px | 2.58 | 2.58 | 0 | 0 | 2/2 |
| 360x640 touch | reduced | 0 | 0 | 0 | 0 px | 2.58 | 2.58 | 0 | 0 | 2/2 |
| 640x360 touch | normal | 0 | 0 | 0 | 0 px | 2.10 | 2.10 | 0 | 0 | 2/2 |
| 640x360 touch | reduced | 0 | 0 | 0 | 0 px | 2.10 | 2.10 | 0 | 0 | 2/2 |
| 1440x900 mouse | normal | 0 | 0 | 0 | 0 px | 2.60 | 2.60 | 0 | 0 | 2/2 |
| 1440x900 mouse | reduced | 0 | 0 | 0 | 0 px | 2.60 | 2.60 | 0 | 0 | 2/2 |

"Question jump" is the largest change in the `h1` top across all dodges. The label cycled through all 6 Spanish phrases and wrapped around, which shows "No" never gives up. No taps or clicks on "No" ever caused a state change.

### Overlap measurements ("No" vs "Sí" vs question)

| Config | Motion | "No"/"Sí" overlaps | Worst area | "No"/question overlaps |
|---|---|---|---|---|
| 390x844, 360x640 | both | 0 of 420 dodges | 0 | 0 |
| 1440x900 | normal | 0 of 90 | 0 | 0 |
| 1440x900 | reduced | 0 of 120 | 0 | 1 of 120 (about 350 px², a few percent of the button) |
| 640x360 | normal | 14 of 90 | about 1,950 px² | 0 |
| 640x360 | reduced | 16 of 120 | about 1,430 px² | 0 |

In the 80 ms reduced-motion run I also saw one "No"/"Sí" overlap on desktop (about 1,650 px²). The 220 ms re-run showed a single "No"/question overlap instead. Both are one-offs. See I1 and I2.

## Acceptance criteria
| Criterion | Result |
|---|---|
| "No" can never be clicked and never ends up off screen | **Pass.** 0 off-screen readings in 960 dodge checks. There were no activations from real touch or mouse sequences. |
| "Sí" grows with each dodge, never breaks the layout | **Pass.** The cap of about 2.6 is reached by the 7th dodge on 390 and desktop. It is limited to 2.58 at 360x640 and 2.10 at 640x360 by the viewport-height cap. "Sí" never left the viewport. The question does not move. |
| "Sí" leads to the inner screen | Pass in all 8 configs. The screen shows the destination and there is no horizontal scroll. |
| Reduced motion | Pass. "No" still dodges and "Sí" still grows, instantly. |
| Works on 390x844 and desktop | Pass. |
| All copy in Spanish | Pass. The labels are "¿Seguro?", "Uy…", "Casi lo pillas", "Piénsatelo bien…", "Ese botón está roto", "Vale, ya me rindo 😄". |
| Build and lint | Pass. |

## `web-design-guidelines` skill
The skill was applied in round 2 and the UI code is unchanged in the areas reviewed. The results still hold: semantic buttons, `aria-live` label, `focus-visible`, `touch-action`, reduced motion, safe areas and `lang="es"`. The minor round 2 items remain open (see I3).

## Findings

### I1 (improvement): in a low landscape viewport "No" can still overlap "Sí"
- Reproduce:
  1. Open at 640x360 with touch.
  2. Tap "No" about 15 times.
  3. In about 15 percent of dodges, "No" lands partly on top of the large "Sí" (up to about 1,900 px², a minor part of the button). There is no free spot in that space.
- Impact: low. "No" is still fully on screen and still not clickable. "Sí" is mostly visible. The fallback does limit overlap compared to round 2.
- Suggestion: if a pure fallback is acceptable, cap "Sí" a bit lower in landscape, or let "No" sit in the corners.

### I2 (improvement): rare "No"/question overlap on desktop
- Seen once in 120 dodges at 1440x900 with reduced motion (about 350 px²). I could not reproduce it deterministically. It is probably a label-width change followed by a clamp, which moves "No" after the position was chosen. It is cosmetic.

### I3 (improvement, carried from round 2)
- `src/components/Countdown.tsx`: add `tabular-nums` to the animated number.
- `src/components/Inside.tsx`: use non-breaking spaces in the date range ("28 abr – 7 may").

## For the user to review by eye
Animations cannot be judged from screenshots. Please check the dodge feel (the squash and rotation, and the back-ease), the growth of "Sí", the heart glow, the screen transition, and the reduced-motion cross-fade on a real phone. Screenshots are in `/tmp/val3/`.

## History
- Round 1: FAIL. Blocking: "No" partly off screen after the label widened (4 of 60 dodges). Several overlap issues.
- Round 2: PASS. The off-screen finding was fixed (0 of 2,520 dodges). Improvements: landscape overlap (I1), minor guideline items.
- Round 3: PASS. Requirements updated ("No" never gives up, "Sí" cap about 2.6, reserved row height). All hard criteria verified with real input. Only cosmetic improvements remain.

## Environment
Preview server was started on port 4173 and killed by PID. `lsof -ti:4173` returned nothing.
