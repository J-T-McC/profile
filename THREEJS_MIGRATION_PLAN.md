# Three.js Migration Plan — Spaceship Game

Migrating the DOM/CSS spaceship game to a Three.js renderer.

## Guiding principle

This is a **rendering swap, not a rewrite**. The ~1,643 lines of game logic in
`src/hooks/useSpaceGame.js` (physics, AI, collisions, state machine, power-ups,
Web Audio) are largely renderer-agnostic and stay. We replace the *presentation*
layer: how entities appear, the CSS effects, and the coordinate/input math.

**Approach:** orthographic camera (2D sprites, not real 3D), DOM overlays kept for
HUD/radar/arcade screens. Overall size: **Large (~1–2 weeks)**.

### Current-state anchors
- `src/hooks/useSpaceGame.js` (~1,643 lines) — game logic + rAF loop `tick(time)`.
- `src/components/content/History.vue` (~866 lines) — template overlay + ~500 lines scoped CSS.
- Entity sprites: `SvgUFO.vue`, `SvgWeapon.vue`, `SvgEnterprise.vue`; ship is a Cloudinary PNG.
- DOM-coupling to sever: `getShipHitCircle` reads `getBoundingClientRect`; input assumes viewport-relative `event.x/y` with container origin ≈ (0,0).

---

## Phase 0 — Spike & scaffold
**Goal:** Prove the stack. Add Three.js, mount a canvas inside `#about`, render an
orthographic scene sized to the container, draw one textured sprite, and drive its
position from a stubbed loop. Confirm it coexists with the alien-mode gate and
resizes/fullscreens correctly.

- Deliverable: canvas + camera + resize handling + one sprite moving.
- Risk retired: build/bundle integration, camera sizing, fullscreen coord origin.
- **Token estimate: ~40k**

**Status: ✅ DONE.** Implemented as `src/hooks/useThreeStage.js` (WebGL renderer +
orthographic camera + `ResizeObserver` + textured sprite on a self-contained rAF
loop, gated to alien mode with full dispose-on-teardown). Mounted as a
`pointer-events-none` `<canvas>` (z-index 2) inside the game overlay in
`History.vue`, between the starfield (z1) and the ship sprite (z20).

Findings:
- **Build integration (the real Phase-0 risk):** `three` r0.185 ships ES2022
  `static {}` initializer blocks that the original webpack 4 / Vue CLI 4.5 build
  couldn't parse. This was the trigger to migrate the toolchain to **Vite**
  (see below), which handles three's modern syntax natively — no transpile hack
  needed. Build + lint pass.
- **Toolchain migrated to Vite** (from the deprecated Vue CLI). Configs:
  `vite.config.mjs` (`@`→src alias + `.vue` in `resolve.extensions`), root
  `index.html`, standard `tailwindcss@2` + `postcss@8` + `autoprefixer@10`.
- **Bundle cost:** three adds ~207 KiB gzipped to the vendor chunk — flag for
  Phase 6 (consider dynamic `import()` so it only loads in alien mode).
- Reused the real Cloudinary ship PNG as the sprite texture, validating the
  texture/CORS pipeline end-to-end.
- Coordinate mapping (screen ↔ scene) deliberately deferred to Phase 1; the spike
  uses a centred ortho camera to avoid flip/handedness noise.

## Phase 1 — Coordinate & input bridge
**Goal:** Single source of truth mapping screen ↔ scene space. Rewrite
`moveShip`, `rotateShip`, click-to-fire, and collision circles to pure scene-space
math. Remove the `getBoundingClientRect` dependency in `getShipHitCircle`. Verify
input parity in windowed and fullscreen.

- Deliverable: a `toScene(event)` / `toScreen(pos)` util; logic reads scene coords only.
- Risk retired: the biggest tax — the coordinate flip. Do this before any entity work.
- **Token estimate: ~70k**

**Status: ✅ DONE.** Turned out cleaner than expected: the game's world space was
*already* container pixels (top-left origin, +y down), so this was a decoupling
job, not a physics rewrite.

- `useSpaceGame.js`: added a single `pointerToWorld(event)` bridge and routed
  `rotateShip`, `moveShip`, `ufoClicked` through it. Both axes are now
  container-relative (fixed the fragile "x is viewport-relative" assumption that
  relied on `#about` spanning the full page width).
- Removed both DOM-measurement reads: `getShipHitCircle` and `rotateShip`'s pivot
  now derive from the JS-tracked `shipX`/`shipY` + a new `SHIP_SIZE` constant. The
  only remaining DOM reads are legit `container` reads (rect for pointer→world,
  `offsetWidth/Height` for world bounds). One `ship.value` existence guard remains
  in `fireForward`, deliberately left for Phase 2 (when the `<img>` is removed).
- `useThreeStage.js`: camera now maps 1 unit = 1 px with a single `toScene(x,y) =
  [x, viewHeight - y]` Y-flip. The debug sprite tracks the cursor in world coords
  to verify the screen→world→scene round-trip in windowed **and** fullscreen.
- Minor behaviour deltas (accepted): the ship hitbox is now a constant radius
  (was rotation-dependent via the transformed bounding box); aiming pivot is
  computed from the untransformed position (was the live transformed rect).

## Phase 2 — Core entities as sprites
**Goal:** Render the gameplay-critical entities in Three and delete their DOM/CSS
counterparts, wiring positions to existing reactive state each frame:
player ship, UFOs (with depth-scaling), projectiles.

- Deliverable: ship + enemies + bolts render in-canvas; DOM versions removed.
- Note: reuse existing PNG/SVG art as textures where possible.
- **Token estimate: ~90k**

**Status: ✅ DONE (pending visual QA).** All three gameplay-critical entities now
render in the WebGL canvas; their DOM/CSS counterparts are removed.

- `useThreeStage.js` is now a real renderer: shared unit `PlaneGeometry`, per-entity
  textured quads, id-keyed reconciliation (`enemyMeshes`/`boltMeshes` Maps) against
  the reactive state each frame, layering by `renderOrder` (depth test off) to
  mirror the old CSS z-index stack. Full dispose of meshes/materials/geometry/
  textures on teardown.
  - Ship: Cloudinary PNG on a quad + white backing (matches `bg-white`); driven by
    a new `getShipRenderState()` (position, `rotation.z = -angle`, warp
    `scale(1/stretch, stretch)`), shown only while `PLAYING && !shipExplosion`.
  - UFOs: art extracted to `src/assets/ufo.svg` (Vite loads it as a texture);
    `size` → quad scale, `brightness` → greyscale tint, `zIndex` → renderOrder.
  - Bolts: procedural radial-glow `CanvasTexture`s (player/alien/laser colours from
    SvgWeapon's CSS), additively blended.
- `useSpaceGame.js`: added `getShipRenderState()` and a hit-testing `handleClick()`
  (fire on a UFO / fly on empty space) to replace the removed per-UFO DOM click
  targets; dropped the last `ship.value` DOM guard in `fireForward`.
- `History.vue`: removed the ship `<img>`, `SvgUFO`, and `SvgWeapon` (+ their
  imports/registration); overlay `@click` now routes to `handleClick`. UFO health
  bars stay DOM for now.

Needs a browser to confirm: ship facing/rotation direction (`rotation.z` sign),
the white ship backing, bolt glow sizing, and UFO depth tint.

## Phase 3 — Secondary entities & starfield
**Goal:** Ally starship + Enterprise sprite, ally phaser beam (line geometry),
power-up badges, and the scrolling starfield/twinkling background (shader or
scrolling textured quads).

- Deliverable: all remaining world entities in-canvas; CSS backgrounds removed.
- **Token estimate: ~80k**

**Status: ✅ DONE (pending visual QA).** All remaining world entities are in-canvas;
the DOM starfield/ally/beam/power-up are gone.

- `useThreeStage.js`:
  - Ally: `enterprise.svg` extracted as a texture; positioned/rotated from the
    reactive `ally` (`rotation.z = -angle`). Warp-in/out scale animation deferred
    to Phase 4 (ally just shows/hides for now).
  - Phaser beam: additive quad with a baked vertical-gradient `CanvasTexture`,
    stretched/rotated between the snapshotted `beamX1/Y1 → beamX2/Y2` while
    `beamActive`. (The 0.22s zap fade is Phase 4.)
  - Power-ups: rounded-pill badge `CanvasTexture` per label+colour (dark bg + tinted
    border + label), positioned by centre, with the idle bob-scale. Font falls back
    to monospace if VT323 isn't loaded when the texture is baked.
  - Starfield: black backdrop + two tiled `RepeatWrapping` quads (stars static,
    twinkling drifting via `texture.offset`), sized/retiled on load and resize.
- `History.vue`: removed the `.stars`/`.twinkling` divs, phaser-beam SVG, ally and
  power-up DOM (+ `SvgEnterprise` import/registration). **Canvas dropped from
  `z-index: 2` to `0`** so it's the backdrop and the remaining DOM overlays
  (HUD/radar/health bars/effects) paint above it. UFO health bars stay DOM.
- Dead CSS (`.stars`, `.twinkling`, `.ally*`, `.phaser-beam*`, `.power-up*`) is now
  flagged by the linter — left for Phase 6 cleanup.

Needs a browser to confirm: starfield look/scroll, ally facing, beam alignment,
power-up badge text (VT323 vs fallback), and that all DOM overlays sit above the
canvas after the z-index change.

## Phase 4 — Effects & juice
**Goal:** Reproduce the game feel currently done in CSS keyframes: warp
squash-stretch, hit flashes, `ufo-destroyed` pulse, ship-explosion rings, warp
flashes. Implement as material/tween effects or a small particle system.

- Deliverable: visual parity (or better) with today's CSS effects.
- Note: highest scope-creep risk — timebox it; "good enough" parity first.
- **Token estimate: ~90k**

**Status: ✅ DONE (pending visual QA).** Timeboxed to reproducing the effects that
were *lost* when their DOM was removed; effects that already had parity were left
alone.

- Reproduced in-canvas (`useThreeStage.js`):
  - Ship hit flash → green additive glow; ship shield → pulsing cyan aura (both via
    a shared radial glow texture, tinted; driven by new `hit`/`shielded` fields on
    `getShipRenderState`).
  - UFO hit → red tint; UFO destroyed → yellow tint + the `ufo-destroyed-pulse`
    scale keyframes (per-mesh `destroyStart` timing).
  - Ally warp-in/out → screen-axis squash-stretch via a nested group (outer = warp
    scale, inner = heading rotation), matching the old `.ally`/`.ally-body` split.
  - Phaser beam → zap fade (opacity 0.2→1→0 over 0.22s) tracked per beam.
  - Power-up collect → scale-to-2.2 + fade over 0.3s.
- Already had parity, untouched: ship warp squash-stretch (Phase 2), power-up idle
  bob (Phase 3).
- **Deliberately kept as DOM** (they still work and sit above the canvas): the
  `warp-flash` departure burst and the 8-bit `ship-explosion` rings. Re-porting
  them would be pure churn for no visual gain; revisit only if desired.

Needs a browser to confirm all of the above read right (tints, glows, warp,
beam fade, collect pop).

## Phase 5 — Keep-as-DOM overlays & integration cleanup
**Goal:** Confirm HUD, radar minimap, active-buff badges, lives, and the 8-bit
arcade continue/game-over modals still render correctly as DOM *over* the canvas.
Re-verify alien-mode start/stop lifecycle, `onUnmounted` teardown (dispose Three
resources), mute, and best-score persistence.

- Deliverable: overlays layered on canvas; clean lifecycle with no leaks.
- **Token estimate: ~50k**

**Status: ✅ DONE.** Mostly verification; one integration cleanup.

- Overlay layering (re-verified after the canvas → `z-index: 0` change): modals
  (`position: fixed; z-index: 9999`, teleported) sit above everything; HUD/radar/
  hint (`z-10`), warp-flash (z18) and ship-explosion (z22) are positive-z, above the
  canvas; UFO health bars (auto-z, later in DOM) paint above the canvas via tree
  order — actually a fix vs the Phase 2 `z-index: 2` canvas that sat over them.
- Lifecycle/teardown audit (no leaks): `stop()` cancels rAF, disconnects the
  ResizeObserver, disposes every material/geometry/texture, and calls
  `renderer.dispose()` + `forceContextLoss()` so repeated alien-mode toggles don't
  exhaust WebGL contexts. The stage holds no event listeners. Mute and best-score
  persistence live in `useLocalStore`/`useSpaceGame`, untouched by the migration.
- Integration cleanup: removed the wiring the port orphaned in `History.vue`
  (`ship`, `shipPos`, `shipHit`, `shieldActive`, `moveShip`, `ufoClicked`,
  `allySize` no longer bound in the template; `projectiles`/`getShipRenderState`
  kept only as stage args, dropped from the returned object).
- Deferred to Phase 6: `useSpaceGame` still declares a dead `ship` ref and writes
  the now-unread `shipPos` each frame — harmless, cleaned up there with the dead CSS.
- **Bugfix found in QA:** dying crashed the whole section. Root cause was a Vue
  `<teleport to="#about">` for the arcade modals — teleporting *into* the same
  reactive subtree that now holds the WebGL canvas; the death-driven `gameState`
  change re-patched the teleport and threw `Cannot read properties of null
  (reading 'nextSibling')`, tearing down `#about`. Fixed by dropping the teleport
  and rendering the modals as plain `position: fixed` children of `#about` (still
  centred + fullscreen-visible, no teleport patching to crash).

## Phase 6 — Polish, perf, and cleanup
**Goal:** Remove now-dead scoped CSS and unused SVG components, profile frame
cost, cap devicePixelRatio, dispose geometries/materials/textures on teardown,
cross-browser + fullscreen pass, final visual QA against the current game.

- Deliverable: dead code removed, stable 60fps, clean build/lint.
- **Token estimate: ~55k**

**Status: ✅ DONE.**

- Dead scoped CSS removed from `History.vue` (`.ship*`, `.ally*`, `.phaser-beam*`,
  `.ufo-destroyed*`, `.power-up*`, `.stars`, `.twinkling`, and their keyframes).
  CSS bundle 40.56 → 36.11 kB (8.26 → 7.30 kB gzip).
- Deleted the now-unused SVG components: `SvgUFO.vue`, `SvgWeapon.vue`,
  `SvgEnterprise.vue`.
- Removed the dead hook machinery: the `ship` ref, the whole `shipPos` reactive +
  `applyShipTransform` + `CSS` prop-name map + `warpSettleTimeoutId`.
- **Warp squash-stretch parity fix:** it relied on a CSS transition to ease
  `shipStretch` back, so in the canvas it collapsed to a 1-frame blip. Now the game
  tick eases `shipStretch` back to 1 (framerate-independent exp decay), so the
  renderer shows the real pop.
- **Perf — lazy-load three:** `useThreeStage` now `await import('three')` inside
  `start()` (guarded against the alien-mode toggle race), so three's bundle only
  loads when alien mode is entered. **Initial JS 710 → 202 kB (gzip 205 → 77 kB)**;
  three is a separate on-demand chunk; the chunk-size warning is gone. DPR is capped
  and all GPU resources are disposed on teardown (Phases 0/5).
- Remaining (needs a browser): cross-browser + fullscreen final visual pass.

---

## Migration complete

All 7 phases (0–6) are done. The spaceship game renders entirely in Three.js
(orthographic sprite port), the ~1,600-line game logic in `useSpaceGame.js` stayed
renderer-agnostic, DOM overlays (HUD/radar/health bars/arcade modals) sit above the
canvas, and the build is on Vite. Outstanding items are visual QA passes that need a
real browser (listed per phase above).

---

## Summary

| Phase | Scope | Token est. |
|-------|-------|-----------|
| 0 | Spike & scaffold | ~40k |
| 1 | Coordinate & input bridge | ~70k |
| 2 | Core entities (ship/UFO/bolts) | ~90k |
| 3 | Secondary entities & starfield | ~80k |
| 4 | Effects & juice | ~90k |
| 5 | DOM overlays & integration | ~50k |
| 6 | Polish, perf, cleanup | ~55k |
| **Total** | | **~475k** |

**Notes on estimates:** Token figures are for implementation via this CLI
(exploration + edits + build/verify iterations), not wall-clock time. They assume
the straight orthographic-sprite port. Going for real 3D (lighting, depth,
particle-heavy explosions) pushes Phases 2–4 up ~1.5–2x and moves the whole
effort to **XL**. Phases 0–1 are prerequisites for everything else and should not
be parallelized; Phases 2–4 could be split across contributors once the bridge
lands.
