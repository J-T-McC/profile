# History.vue Spaceship Game — Modernization Plan

Notes on how the current mini-game works, what's broken/dead, and a prioritized
plan for jazzing it up. Scoped to `src/components/content/History.vue` and its
two child components (`SvgUFO.vue`, `SvgWeapon.vue`).

## How it currently works

- The game overlay only renders when `mode.isDarkMode` is true **and**
  `!isMobileOnly` (`History.vue:11`) — desktop + dark mode only, no
  instructions anywhere, so most visitors will never find it.
- **Ship**: a raster PNG (`img ref="ship"`) whose rotation is computed from
  `atan2` between the ship's center and the mouse position on every
  `mousemove` (`rotateShip`). Position itself doesn't animate physically — a
  click sets `shipPos.left/top` directly and a CSS `transition-duration`
  fakes the glide (`moveShip`).
- **UFO** (`SvgUFO.vue`): teleports to a random position/size inside the
  container on a recursive `setTimeout` loop between 0–10s
  (`setAnimationTimeout` → `randomizePosition`), and also re-randomizes on
  `mouseenter` — that's the entire "flee" AI. Size drives a fake
  depth illusion (bigger = closer, brightness/z-index scale with size).
- **Shooting**: clicking the UFO's actual DOM element fires
  (`ufoClicked` → score++, red flash via `hit`, then `fire(event)`).
  `fire` pushes `{startX/Y, endX/Y}` into a `fired` array; `SvgWeapon`
  renders a dot and jumps it from start to end via a `setTimeout(0)` +
  CSS `transition-all` hack, then the entry is spliced out after 200ms.
  There's no real projectile travel time or collision math — hitting the
  UFO only ever means "your click landed on its DOM element."
- **Score**: a plain number, not persisted anywhere.

## Bugs / dead code found

1. `@keydown="fire"` on the container (`History.vue:12`) calls `fire(event)`,
   which reads `event.x` / `event.y` — those are `undefined` on a
   `KeyboardEvent`. This handler is effectively broken today (fires a
   projectile from `NaN, NaN`). Likely a leftover stub for a "press space to
   shoot forward" feature that was never finished.
2. `@keyframes pulse` in the `<style>` block is defined but never applied to
   any element — dead CSS.
3. `randomizePosition` computes `top`/`left` as
   `Math.random() * offsetHeight + offset`, which can place the UFO
   partially or fully outside the visible container (no clamping to
   bounds).
4. No `onUnmounted` cleanup for the recursive `setAnimationTimeout` loop —
   harmless on a single-page site today, but a leak trap if this component
   is ever made to mount/unmount repeatedly (e.g. routed navigation).

## Suggestions, grouped by effort

### Quick wins (bug fixes + cheap improvements)
- Fix or remove the broken `keydown` fire handler. If keeping keyboard
  support, make it fire in the direction the ship is currently facing
  (we already compute `degree` in `rotateShip`) instead of using
  event coordinates.
- Clamp `randomizePosition` output to the container's bounds so the UFO
  never spawns off-screen.
- Either wire up `@keyframes pulse` to something (e.g. UFO idle pulse, or
  the score readout on increment) or delete the dead CSS.
- Add a small "click to fly, shoot the UFO" hint that fades in the first
  time the overlay appears — right now the game is an undiscoverable
  easter egg.
- Add `onUnmounted` cleanup for the animation timeout for hygiene.

### Mechanics & game feel (the fun part)
- **Real projectile travel**: instead of jumping the dot from ship to click
  point on a fixed 200ms CSS transition, animate it along the ship's facing
  angle with a constant speed, and detect collision by distance-to-UFO
  rather than "did you click exactly on it." This makes aiming matter and
  decouples hit-detection from the DOM click target.
- **Ship movement**: replace the CSS-transition snap-to-click with a small
  velocity/lerp-based update loop (`requestAnimationFrame`) so the ship
  accelerates/decelerates instead of teleporting with a faked duration.
  Bonus: thruster particle/glow trail while moving.
- **Smarter UFO AI**: currently it only "flees" by teleporting on
  `mouseenter`. Consider continuous steering-away-from-cursor behavior
  while the pointer is near, plus difficulty scaling with score (faster
  flee, shorter idle intervals, occasional multiple UFOs) so the game has
  a sense of progression instead of a flat difficulty forever.
- **Feedback on hit/miss**: replace the single red-flash-and-vanish with a
  small explosion/particle burst, and add a miss indicator (e.g. faint
  fizzle) so shooting feels responsive even when it doesn't score.
- **Cooldown/ammo**: a short fire cooldown adds challenge and stops
  spam-clicking as the dominant strategy.
- Optional: local high score via `localStorage` ("Best: N") — near-zero
  effort, adds replay incentive.

### Polish
- Swap the Cloudinary PNG ship for an inline SVG (matching `SvgUFO`'s
  approach) so it can be recolored/glow-tinted on hit/thrust without extra
  image requests, and scales crisper at all sizes.
- Subtle parallax on the starfield layers tied to ship position for extra
  depth.
- Optional sound effects (laser/explosion) via the Web Audio API with a
  mute toggle, respecting `prefers-reduced-motion`/`prefers-reduced-data`.

### Code structure
- Extract all game state/logic (`shipPos`, `ufoPos`, `fired`, `score`,
  `rotateShip`, `fire`, `moveShip`, `randomizePosition`, the animation
  timer) out of `History.vue` into a composable, e.g.
  `src/hooks/useSpaceGame.js`. `History.vue` currently mixes resume content
  (`cards` array) with an entire arcade game's state machine — splitting
  these makes both easier to reason about and makes the game logic
  unit-testable in isolation.
- Convert `History.vue` to `<script setup>` while touching it, since the
  project is already on Vue 3.5.
- If a composable is extracted, add a few unit tests around pure logic
  (bounds clamping, cooldown gating, score increment) — there are currently
  no tests in the project for this component.

## Suggested phasing

1. **Phase 1 — fix & tidy** ✅ *done* (bugs above, extract composable, add
   hint overlay).
2. **Phase 2 — feel** ✅ *done* (velocity-based ship movement, real
   projectile travel + distance-based hit detection, cooldown, better
   hit/miss feedback, localStorage high score).
3. **Phase 3 — depth & polish** ⛔ *attempted, rolled back* (smarter UFO
   AI/difficulty scaling, SVG ship, particles/sound, parallax starfield).
   See "Phase 3 attempt & rollback" below before trying this again.

Each phase is independently shippable and testable in the browser without
needing the others. The codebase is currently at the end of Phase 2.

## Phase 2 implementation notes

`src/hooks/useSpaceGame.js` now runs a single `requestAnimationFrame` loop
(`tick`) that drives both the ship and all in-flight projectiles, replacing
the old CSS-transition-duration tricks:

- **Ship movement**: `shipX/shipY` ease toward `shipTargetX/shipTargetY` each
  frame (exponential ease-out via `SHIP_FOLLOW_RATE`, framerate-independent),
  instead of snapping to the click point with a faked `transition-duration`.
  (Originally this used a constant-speed linear glide, but that read as the
  ship "sliding on ice" — moving at a fixed speed then stopping dead with no
  deceleration — so it was switched to the ease-out curve.) Rotation (`rotateShip`)
  still gets its own short CSS transition for smoothing between mousemove
  samples — `shipPos` now sets `transition-property: transform` so it only
  applies to rotation, not to the per-frame-driven top/left.
- **Projectiles**: every shot (`fireAt`) is a real object with a velocity
  vector, advanced every frame. A hit is only registered when a projectile's
  live position comes within the UFO's *live* on-screen hit circle
  (`getUfoHitCircle`, read straight from `getBoundingClientRect` since the
  UFO itself still glides via CSS transition) — not by matching the DOM
  click target. Shots that don't connect within `PROJECTILE_MAX_DISTANCE`
  clear themselves out as a miss. `SvgWeapon.vue` was simplified to a dumb
  renderer (`x`, `y`, `state` props) with CSS transitions for a `hit`
  burst (scale + color flash) vs. a quicker `miss` fade — no more internal
  `setTimeout(0)` position-jump hack.
- **Cooldown**: `FIRE_COOLDOWN` (300ms) gates every shot, whether triggered
  by clicking the UFO directly or by the Space-bar forward-fire from
  Phase 1, so rapid clicking/mashing space no longer trivially maxes out
  score.
- **High score**: reuses the project's existing (previously unused)
  `useLocalStore` hook to persist `bestScore` under a `spaceGame` key and
  display it next to the live score.

Clicking the UFO still both fires *and* flies the ship toward the click
point (unchanged combined behavior from the original game), it just now
routes through the same projectile/collision system as the keyboard shot
instead of scoring instantly on click.

## Phase 3 attempt & rollback

Phase 3 was implemented in full (continuous UFO evasion + difficulty
scaling, an inline SVG ship replacing the Cloudinary PNG, a thruster particle
trail, parallax starfield, and synthesized sound/mute) but broke the game in
ways that couldn't be reliably fixed without a live browser to test against,
and was rolled back in full. The codebase is currently back at the verified
end-of-Phase-2 state (`SvgShip.vue` removed, `History.vue` and
`useSpaceGame.js` restored). Notes for a future, more incremental attempt:

- **The SVG ship swap is the prime suspect for the rotation regression.**
  `rotateShip` computes a CSS `rotate(deg)` transform and applies it via
  `shipPos.transform`. This worked fine on the original `<img>` (default
  `transform-origin: 50% 50%`, standard HTML replaced-element box model),
  but swapping the ref target to an inline `<SvgShip>` component introduces
  two compounding risks that are easy to get wrong and hard to verify
  without an actual browser: (1) `ship.value` becomes a component instance,
  not a DOM node, so any code doing `ship.value.getBoundingClientRect()` /
  `.offsetWidth` needs `.$el` instead — a subtle, easy-to-miss find/replace
  that caused a silent exception on every `mousemove`, which in turn meant
  `hasFacing` (gating the Space-bar shot) never got set; (2) the outermost
  `<svg>` element has a long history of inconsistent `transform-origin`/
  `transform-box` behavior across browsers when a CSS `transform` is applied
  directly to it, unlike a plain HTML element. If this is retried, apply the
  rotation to a plain wrapping `<div ref="ship">` containing the `<SvgShip>`
  (sized to 100%) rather than putting the ref/transform on the SVG root
  itself — that keeps `ship.value` a raw DOM node (no `.$el` juggling) and
  sidesteps the SVG transform-origin quirk entirely.
- **The parallax white-bar/gap bug** was real and understood (translating a
  100%-sized `.stars`/`.twinkling` layer exposes the container's background
  at the opposite edge) — the fix (oversizing those layers beyond the
  container by more than the max parallax offset, plus `overflow-hidden` on
  `#about`) was applied but never confirmed working in a live browser before
  the second round of symptoms appeared, so treat it as unverified rather
  than solved.
- **General lesson**: this phase changed too much at once (5 independent
  systems in one pass) for a project with no automated tests and no browser
  in this environment to verify against — a single bug in one system (the
  ship ref) produced confusing, compounding symptoms across seemingly
  unrelated ones (rotation, keyboard fire, projectile movement). A future
  attempt should land one piece at a time (e.g. SVG ship *alone*, verified
  in an actual browser, before adding parallax/thruster/sound on top).

Known pre-existing quirk (not introduced by Phase 3, still true at the
current Phase 2 state): the game's `container` is `#about`, whose height is
driven by the very tall resume cards div below it — the game overlay (and
the ship/UFO's playable bounds) therefore spans the *entire* scrollable
history section, not just one viewport. Worth keeping in mind for any
future pass.
