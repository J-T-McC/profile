# Three.js Enhancement Ideas

Now that the space game renders entirely through `useThreeStage.js`, we have a real
renderer to build on. This is a menu of ways to lean into 3D — pick a few, they're mostly
independent.

## Where we are today

- **Orthographic camera** spanning `(0,0)`–`(viewWidth, viewHeight)`; world units = container
  pixels. Everything is a flat `PlaneGeometry` sprite (`unitGeometry`) with a
  `MeshBasicMaterial`, layered by `renderOrder` instead of real depth.
- **Procedural art** via `CanvasTexture` (bolts, glow, beam) plus loaded PNG/SVG textures.
- **Per-frame reconcile hooks**: `updateShip`, `updateAlly`, `updateStarfield`,
  `reconcileEnemies`, `reconcileBolts`, `reconcilePowerUps`, all driven from `tick(time)`
  with a clamped `dt`.
- **Additive blending** already used for the neon/glow pieces.
- **three is lazy-loaded** (~190 KB gzip) only when alien mode is entered — keep new deps
  behind that same import so the default bundle stays lean.

Two overarching directions:
1. **Stay orthographic, add flair** (particles, shaders, post-processing) — low risk, big
   visual payoff, no gameplay-coordinate changes.
2. **Introduce real depth** (perspective layer, 3D models, parallax) — higher effort,
   needs a coordinate bridge, but the biggest "wow".

---

## 1. Particle effects (highest bang-for-buck)  ← STARTED

A single reusable GPU particle pool (`THREE.Points` + `BufferGeometry`, additive, custom
point sprite) covers most of these. Emit bursts on game events, recycle dead particles.
The pool (`buildParticles` / `emitBurst` / `updateParticles`, ring-buffer, reduced-motion
aware) now lives in `useThreeStage.js`.

- [x] **Thruster trail** — dim particles behind the ship while it moves (`updateShip`).
- [x] **UFO destruction debris** — glowing shards tinted `UFO_DESTROYED_COLOR`, scaled by
  the UFO size, at the destroyed transition (`reconcileEnemies`).
- [x] **Power-up collect sparkle** — radial confetti in the buff's colour on `COLLECTED`.
- [ ] **Weapon muzzle flash + impact sparks** — burst at bolt spawn and at the hit point
  in `reconcileBolts` (we already know `HIT`/`INTERCEPTED` states).
- [ ] **Warp-in/out shimmer** — particle implosion/explosion synced to the existing warp
  flash and the ally warp squash.
- [ ] **Phaser beam motes** — particles streaming along the ally beam vector.

_Effort: M. Impact: high. Pure add-on, no coordinate changes._

## 2. Post-processing / bloom  ← DONE (selective)

**Selective** bloom via the two-composer layer technique: a bloom composer renders only the
`BLOOM_LAYER` objects (bolts, phaser beam, ship glows, particles) offscreen and blurs them;
a final composer draws the full scene and additively composites the bloom texture on top.
So the energy effects glow while the ship/UFO/ally sprites and the star field render clean
(a global bloom washed those bright textures out). Passes are dynamically imported (out of
the default bundle) with a plain `renderer.render` fallback.

Still open:
- [ ] Optional `FilmPass`/scanline or chromatic-aberration pass for the arcade-CRT vibe.
- [ ] Consider skipping/softening bloom on low-DPR / low-power devices.

_Effort: S–M. Impact: high. Cohesive glow across the whole scene._

## 3. Asteroids flying through  ← DONE (cosmetic)

The requested one. A small pool of **real 3D rocks** drifting across the field sells depth
even in the ortho scene. This is the first true 3D geometry + lighting in the renderer.

Shipped:
- Well-subdivided `IcosahedronGeometry` squashed into a random ellipsoid and sculpted with
  multi-octave coherent noise (fbm via `ImprovedNoise`) - big lumps + surface roughness for
  a believable rock silhouette - smooth-shaded. Lit by one `DirectionalLight` + `AmbientLight`
  (only the asteroid `MeshStandardMaterial` is lit; every other object is `MeshBasicMaterial`
  and ignores the lights).
- A pool of individual meshes; each spawns off an edge, drifts across, tumbles on a random
  axis, and recycles. Size drives parallax (nearer = bigger, faster, brighter). Rendered
  behind all gameplay; reduced-motion leaves them static.
- Camera clip range widened + camera pushed back so the rocks' z-extent fits (ortho scale
  is unchanged by distance, so flat sprites are unaffected).

- [x] **Shatter on bolts**: player projectiles overlapping a rock burst rocky debris (via
  the particle pool) + a small shake and recycle it. The shot is consumed on impact (the
  rock blocks it) via a `consumeProjectile(id)` API on the game hook. Enemy fire ignores
  the rocks.

Still open:
- [ ] Instanced version if we ever want dozens.
- [ ] Damage the ship on contact / make them a real gameplay hazard.

_Effort: M (cosmetic) / L (collidable). Impact: high — first true 3D geometry._

## 4. Real depth — perspective background layer  ← DONE

A **second scene + `PerspectiveCamera`** holds a deep cloud of ~2200 star points
(size-attenuated, so near stars are big and far ones sub-pixel — the depth cue). It's
rendered into a `WebGLRenderTarget` each frame, and the ortho scene's full-screen background
quad shows that texture. So the composer/selective-bloom/gameplay path stays exactly as it
was, while the stars get genuine perspective + parallax.

Shipped:
- Perspective starfield: ~3600 points with a crisp star sprite (tight core, no haze) and
  per-star **screen-space pixel sizes** (mostly tiny specks, a few brighter) via a small
  shader points material - sizes are decoupled from depth so far stars stay crisp.
- Field kept far (near depth 60) with only subtle parallax - stars read as distant, not
  something we fly between. The bg camera eases toward a small offset driven by the ship
  position (near stars shift a touch more than far), plus a slow galactic spin.
- Replaced the old flat scrolling `CanvasTexture` starfield (and its two Cloudinary images)
  entirely - the gameplay coordinate math stays untouched (still ortho).

Open follow-ups this unlocks:
- [ ] Nebula (fbm shader) in the same bg scene (overlaps §6).
- [ ] Distant traffic / a passing planet in the bg layer (§9).

_Effort: M–L. Impact: high. Foundation for lots of background richness._

## 5. Swap the ship (and UFOs) for 3D models

Replace the flat ship sprite with a **glTF low-poly model** (`GLTFLoader`), lit, banking on
turns and pitching on warp. UFOs become spinning saucers with a glowing underside.

- Real geometry means bank/roll on `rotateShip`, satisfying tilt into moves.
- Bundle cost: keep models tiny (draco-compressed) and behind the lazy alien-mode import.
- Fallback to the current sprite if a model fails to load.

_Effort: L. Impact: high, but the most art-dependent._

## 6. Shader-driven background

Replace the scrolling `CanvasTexture` starfield with a **full-screen `ShaderMaterial`**:
animated nebula (fbm noise), twinkling stars, a slow galactic drift. Cheap, infinite, no
texture memory, and a knob-per-parameter for theming.

- Could react to game state: redshift/intensify during warp, pulse on boss/level-up.

_Effort: M. Impact: medium-high. Great ambience._

## 7. Camera feel — juice  ← STARTED

Small motions that make hits land harder. All live in `tick`/`updateShip`, no new deps.

- [x] **Screen shake** on ship hit and UFO kill — decaying random camera offset (kill shake
  scales with UFO size; background layers overscanned so the offset can't reveal an edge;
  reduced-motion aware).
- [ ] **Hit-stop** — a couple-frame time scale dip on big impacts.
- [ ] **Zoom punch** — quick ortho-frustum scale on level-up or ship death.
- [ ] **Parallax pan** — nudge the camera a few px toward the pointer/ship.

_Effort: S. Impact: medium-high. Cheap polish._

## 8. Trails & ribbons

- **Bolt tracer ribbons** — a stretched additive quad or `Line` trailing each projectile.
- **Ship motion ribbon** — a fading trail line when moving fast / warping.
- **Ally beam** — upgrade from the current quad to an animated, flickering energy ribbon.

_Effort: S–M. Impact: medium._

## 9. Environmental set pieces

- **Passing planet / moon** that slowly crosses the far background (perspective layer).
- **Wormhole / warp tunnel** transition on level change.
- **Debris field / space station** silhouette drifting by.
- **Comet** with a long particle tail on a rare timer.

_Effort: M. Impact: medium, high on "moments"._

---

## Suggested first slice

If we want one high-impact, low-risk PR to prove the direction:

1. ~~**Bloom pass** (§2)~~ — DONE: EffectComposer + UnrealBloomPass, lazy-imported.
2. ~~**Reusable particle pool** (§1)~~ — DONE: pool built, with thruster trail, UFO debris
   and collect sparkle wired in. Muzzle flash / impact sparks still to add.
3. ~~**Screen shake** (§7)~~ — DONE: decaying camera offset on ship hit / UFO kill.

That trio (all done) is additive, stays orthographic, needs no coordinate-bridge work, and
transforms the feel. Asteroids (§3) and the perspective layer (§4) make a natural second PR
now that the particle/bloom infrastructure exists.

## Guardrails

- Keep every new import behind the lazy alien-mode `import('three')` so the default bundle
  is unaffected.
- Respect `prefers-reduced-motion` and cap particle counts / composer resolution on
  low-power devices.
- Reuse pools (particles, asteroids, bolts) — never allocate per frame; dispose textures and
  geometries in the existing teardown path.
- Prefer additive `MeshBasicMaterial`/`Points` over lit materials unless a feature truly
  needs lighting (models, asteroids), to avoid a lighting-rig rewrite.
