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

## Phase 3 — Secondary entities & starfield
**Goal:** Ally starship + Enterprise sprite, ally phaser beam (line geometry),
power-up badges, and the scrolling starfield/twinkling background (shader or
scrolling textured quads).

- Deliverable: all remaining world entities in-canvas; CSS backgrounds removed.
- **Token estimate: ~80k**

## Phase 4 — Effects & juice
**Goal:** Reproduce the game feel currently done in CSS keyframes: warp
squash-stretch, hit flashes, `ufo-destroyed` pulse, ship-explosion rings, warp
flashes. Implement as material/tween effects or a small particle system.

- Deliverable: visual parity (or better) with today's CSS effects.
- Note: highest scope-creep risk — timebox it; "good enough" parity first.
- **Token estimate: ~90k**

## Phase 5 — Keep-as-DOM overlays & integration cleanup
**Goal:** Confirm HUD, radar minimap, active-buff badges, lives, and the 8-bit
arcade continue/game-over modals still render correctly as DOM *over* the canvas.
Re-verify alien-mode start/stop lifecycle, `onUnmounted` teardown (dispose Three
resources), mute, and best-score persistence.

- Deliverable: overlays layered on canvas; clean lifecycle with no leaks.
- **Token estimate: ~50k**

## Phase 6 — Polish, perf, and cleanup
**Goal:** Remove now-dead scoped CSS and unused SVG components, profile frame
cost, cap devicePixelRatio, dispose geometries/materials/textures on teardown,
cross-browser + fullscreen pass, final visual QA against the current game.

- Deliverable: dead code removed, stable 60fps, clean build/lint.
- **Token estimate: ~55k**

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
