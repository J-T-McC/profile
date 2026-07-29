import { onBeforeUnmount, ref, watch } from 'vue'
import { POWERUP_STATE } from '@/hooks/useSpaceGame'
import ufoUrl from '@/assets/ufo.svg'
import enterpriseUrl from '@/assets/enterprise.svg'

// Phase 2-4 Three.js renderer. Draws every world entity - ship, UFOs, projectiles,
// ally, phaser beam, power-ups - plus the scrolling starfield, and reproduces the
// game-feel effects that used to be CSS keyframes (hit/shield flashes, UFO kill
// pulse, ally warp-in/out, phaser zap fade, power-up collect pop). Reads the game's
// reactive state (useSpaceGame) each frame. Remaining DOM in SpaceGame.vue: HUD,
// radar, UFO health bars, the warp-flash and ship-explosion bursts, arcade modals.
//
// World space matches the game logic: container pixels, origin top-left, +y down.
// The orthographic camera is 1 unit = 1 px; toScene() flips only Y. Layering is by
// renderOrder (depth test off), mirroring the old CSS z-index stack.

const SHIP_SIZE = 40 // matches SHIP_SIZE in useSpaceGame (Tailwind w-10 h-10)
const SHIP_TEXTURE_URL =
  'https://res.cloudinary.com/ddaji66m6/image/upload/v1612058700/portfolio/spaceship_tlg2od.png'

// Perspective background starfield. Its own scene + PerspectiveCamera are rendered to a
// texture each frame and shown on the ortho background quad, so the stars get genuine depth
// (near ones big, far ones tiny) and parallax as the camera drifts with the ship - while
// the gameplay layer stays pixel-accurate orthographic.
const BG_STAR_COUNT = 2200
const BG_NEAR = 8 // nearest star depth (world units in front of the bg camera)
const BG_FAR = 150 // farthest
const BG_PARALLAX = 3.2 // how far the bg camera slides with the ship (world units)
const BG_PARALLAX_RATE = 2.5 // easing toward the parallax target (per second)
const BG_DRIFT = 0.006 // slow galactic spin (rad/s)

const ALLY_SIZE = 64 // matches ALLY_SIZE in useSpaceGame
const ALLY_HEIGHT = ALLY_SIZE * 1.2
const ALLY_WARP_DURATION = 0.7 // s, matches CSS ally-warp-in/out

const BEAM_COLOR = 0xfdba74 // phaser-beam-line stroke
const BEAM_THICKNESS = 12
const BEAM_DURATION = 0.22 // s, matches ALLY_BEAM_DURATION / the zap fade

// Effect tints, from the old CSS.
const SHIP_HIT_COLOR = 0x4ade80 // ship-hit green glow
const SHIP_SHIELD_COLOR = 0x22d3ee // ship-shielded cyan aura
const UFO_HIT_COLOR = 0xdc2626 // bg-red-600 hit flash
const UFO_DESTROYED_COLOR = 0xfde047 // ufo-destroyed yellow

// Projectile look, from SvgWeapon.vue's CSS. core = visible dot; the quad is drawn
// larger so the baked-in radial glow has room to fall off.
const BOLT_STYLES = {
  player: { core: 12, rgb: '252,165,165', glow: '248,113,113' },
  alien: { core: 12, rgb: '134,239,172', glow: '74,222,128' },
  laser: { core: 16, rgb: '236,254,255', glow: '34,211,238' },
}

// Mirrors the old CSS z-index stack.
const RENDER_ORDER = {
  bg: -11, // full-screen quad showing the perspective starfield render target
  asteroid: -8, // drifting 3D rocks, in front of the starfield but behind all gameplay
  healthTrack: 15, // above every UFO (their zIndex is 1 or 12)
  healthFill: 16,
  ally: 17,
  beam: 18,
  powerUp: 19,
  bolt: 20,
  particles: 21, // sparks/debris/thruster - above bolts, below the ship
  shipGlow: 23,
  ship: 25,
} // enemies use their own zIndex (1 or 12)

const HEALTH_BAR_HEIGHT = 5 // px, matches the old .ufo-health-track

// Additive GPU particle pool, recycled ring-buffer style. One Points object drives every
// burst/trail effect; PARTICLE_MAX caps the live count.
const PARTICLE_MAX = 700

// Screen-shake decay (per second) - how fast the camera offset settles back to centre.
const SHAKE_DECAY = 9

// Drifting 3D asteroids - low-poly lit rocks that cross the field behind the gameplay for
// a sense of depth. Nearer (bigger) ones drift faster; all tumble on a random axis.
const ASTEROID_COUNT = 6
const ASTEROID_MIN_SIZE = 16 // px radius
const ASTEROID_MAX_SIZE = 62

// Selective bloom: only objects put on BLOOM_LAYER (the additive energy effects - bolts,
// beam, ship glows, particles) glow. Everything else (ship/UFO/ally sprites, the star
// field, health bars) renders normally, so bright white textures don't wash out. Because
// only bloom objects are drawn in the bloom pass, the threshold can be 0.
const BLOOM_LAYER = 1
const BLOOM_STRENGTH = 0.9
const BLOOM_RADIUS = 0.5
const BLOOM_THRESHOLD = 0

// UFO kill pulse, from @keyframes ufo-destroyed-pulse (scale over 1.2s).
const DESTROY_PULSE = [[0, 1], [0.15, 1.7], [0.35, 1.1], [0.55, 1.5], [1, 1]]
const DESTROY_DURATION = 1.2 // s

// Enemy size/brightness re-roll in discrete steps as they change "depth"; the old DOM
// version smoothed those jumps with a ~1s CSS transition. Ease the rendered size and
// depth-dim toward their targets each frame instead (framerate-independent). ~4 reaches
// ~98% in 1s, matching that transition feel.
const UFO_DEPTH_RATE = 4

const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (v) => Math.min(Math.max(v, 0), 1)
const sampleKeyframes = (frames, p) => {
  for (let i = 1; i < frames.length; i++) {
    if (p <= frames[i][0]) {
      const [p0, v0] = frames[i - 1]
      const [p1, v1] = frames[i]
      return lerp(v0, v1, (p - p0) / (p1 - p0))
    }
  }
  return frames[frames.length - 1][1]
}

export default function useThreeStage (active, game) {
  const stageCanvas = ref(null)

  // three is loaded lazily (dynamic import in start) so its bundle only ships once
  // alien mode is actually entered.
  let THREE = null
  let renderer = null
  let bloomComposer = null // renders only the BLOOM_LAYER objects, offscreen
  let finalComposer = null // renders the full scene, then adds the bloom texture
  let bloomPass = null
  let scene = null
  let camera = null
  let unitGeometry = null
  let resizeObserver = null
  let rafId = null
  let startTime = 0
  let prevTime = 0
  let viewWidth = 1
  let viewHeight = 1

  // Shared textures.
  let shipTexture = null
  let ufoTexture = null
  let enterpriseTexture = null
  let beamTexture = null
  let glowTexture = null
  const boltTextures = {} // player | alien | laser -> CanvasTexture
  const powerUpTextures = new Map() // `${label}|${color}` -> { tex, w, h }

  // Perspective background layer: its own scene/camera rendered into bgRT each frame; bgMesh
  // (a full-screen quad in the ortho scene) shows that texture.
  let bgScene = null
  let bgCamera = null
  let bgRT = null
  let starField = null

  // Entities / layers.
  let bgMesh = null
  let shipGroup = null
  let shipBody = null
  let shipHitGlow = null
  let shipShieldGlow = null
  let allyGroup = null
  let allyBody = null
  let beamMesh = null
  const enemyMeshes = new Map() // enemy.id -> { body, track, fill }
  const boltMeshes = new Map() // projectile.id -> Mesh
  const powerUpMeshes = new Map() // powerUp.id -> Mesh

  // Particle pool. GPU attributes (pPos/pColor/pSize/pAlpha) plus CPU-only sim state
  // (velocity, remaining life, size ramp, drag). Emitters write into a recycled slot.
  let particlePoints = null
  let particleGeom = null
  let particleMat = null
  let pPos, pColor, pSize, pAlpha, pVel, pLife, pMaxLife, pSize0, pSize1, pDrag
  let pCursor = 0
  let scratchColor = null
  let prefersReducedMotion = false
  let lastShipX = null
  let lastShipY = null

  // Screen shake: a decaying random camera offset. Events bump shakeMag; tick applies and
  // decays it. lastShipHit tracks the rising edge of the ship's hit flash.
  let shakeMag = 0
  let lastShipHit = false

  // Drifting 3D asteroids (each { mesh, vx, vy, spin }) plus their lights and the coherent
  // noise used to sculpt their surfaces.
  let asteroids = []
  let asteroidAmbient = null
  let asteroidLight = null
  let noise = null

  // World (container px, +y down) -> scene (same units, +y up).
  const toScene = (x, y) => [x, viewHeight - y]

  // --- Texture factories -----------------------------------------------------

  const makeBoltTexture = (rgb, glow) => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0.0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, `rgba(${rgb},1)`)
    g.addColorStop(0.6, `rgba(${glow},0.5)`)
    g.addColorStop(1.0, `rgba(${glow},0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // Soft white radial glow, tinted per use (ship hit / shield auras).
  const makeGlowTexture = () => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0.0, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)')
    g.addColorStop(1.0, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // Horizontal beam: bright core with a soft vertical falloff so additive blending
  // reads as a glowing phaser line.
  const makeBeamTexture = () => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 0, size)
    g.addColorStop(0.0, 'rgba(251,146,60,0)')
    g.addColorStop(0.5, 'rgba(255,237,213,1)')
    g.addColorStop(1.0, 'rgba(251,146,60,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // A rounded "pill" badge with the buff label, matching the .power-up CSS. Cached
  // per label+colour. Font may fall back if VT323 isn't loaded yet at bake time.
  const getPowerUpTexture = (label, color) => {
    const key = `${label}|${color}`
    let entry = powerUpTextures.get(key)
    if (entry) return entry

    const dpr = 2
    const h = 30
    const padX = 8
    const font = '15px "VT323", monospace'

    const measure = document.createElement('canvas').getContext('2d')
    measure.font = font
    const textW = measure.measureText(label).width
    const w = Math.max(30, Math.ceil(textW) + padX * 2)

    const canvas = document.createElement('canvas')
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const r = h / 2 - 1
    ctx.beginPath()
    ctx.moveTo(1 + r, 1)
    ctx.arcTo(w - 1, 1, w - 1, h - 1, r)
    ctx.arcTo(w - 1, h - 1, 1, h - 1, r)
    ctx.arcTo(1, h - 1, 1, 1, r)
    ctx.arcTo(1, 1, w - 1, 1, r)
    ctx.closePath()
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    ctx.stroke()

    ctx.fillStyle = color
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, w / 2, h / 2 + 1)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    entry = { tex, w, h }
    powerUpTextures.set(key, entry)
    return entry
  }

  // --- Sizing ----------------------------------------------------------------

  // Oversize the background layers a touch so a screen-shake camera offset never exposes a
  // gap at the viewport edge.
  const BG_OVERSCAN = 24
  const fitBackgroundQuad = (mesh, texture) => {
    if (!mesh) return
    const w = viewWidth + BG_OVERSCAN * 2
    const h = viewHeight + BG_OVERSCAN * 2
    mesh.position.set(viewWidth / 2, viewHeight / 2, 0)
    mesh.scale.set(w, h, 1)
    const img = texture?.image
    if (img && img.width) {
      texture.repeat.set(w / img.width, h / img.height)
    }
  }

  const sizeToContainer = () => {
    const canvas = stageCanvas.value
    if (!canvas || !renderer || !camera) return
    const parent = canvas.parentElement
    viewWidth = parent?.clientWidth || canvas.clientWidth || 1
    viewHeight = parent?.clientHeight || canvas.clientHeight || 1

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(viewWidth, viewHeight, false)

    camera.left = 0
    camera.right = viewWidth
    camera.top = viewHeight
    camera.bottom = 0
    camera.updateProjectionMatrix()

    fitBackgroundQuad(bgMesh, null)

    // Background layer: match its render target + camera aspect to the viewport.
    if (bgRT) bgRT.setSize(Math.max(1, viewWidth), Math.max(1, viewHeight))
    if (bgCamera) {
      bgCamera.aspect = viewWidth / viewHeight
      bgCamera.updateProjectionMatrix()
    }

    // gl_PointSize is in framebuffer px, so it must track the renderer pixel ratio.
    if (particleMat) particleMat.uniforms.uPixelRatio.value = renderer.getPixelRatio()

    for (const c of [bloomComposer, finalComposer]) {
      if (c) {
        c.setPixelRatio(renderer.getPixelRatio())
        c.setSize(viewWidth, viewHeight)
      }
    }
  }

  // --- Builders --------------------------------------------------------------

  const basicMat = (opts) =>
    new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, ...opts })

  // Mark an object so it's picked up by the selective-bloom pass (keeps its base layer 0
  // too, so it still renders in the normal pass).
  const enableBloom = (obj) => obj.layers.enable(BLOOM_LAYER)

  const buildBackground = () => {
    // Off-screen perspective scene: a deep cloud of star points. Distributed in a wide cone
    // (spread scales with depth) so the frustum stays filled at any aspect, with a colour +
    // brightness spread for variety.
    bgScene = new THREE.Scene()
    bgCamera = new THREE.PerspectiveCamera(60, viewWidth / viewHeight, 0.1, BG_FAR + 40)
    // Looks down -z by default; parallax slides it in x/y (see updateBackground).

    const positions = new Float32Array(BG_STAR_COUNT * 3)
    const colors = new Float32Array(BG_STAR_COUNT * 3)
    const c = new THREE.Color()
    for (let i = 0; i < BG_STAR_COUNT; i++) {
      const z = -(BG_NEAR + Math.random() * (BG_FAR - BG_NEAR))
      const spread = Math.abs(z) * 1.3
      positions[i * 3] = (Math.random() * 2 - 1) * spread
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * spread
      positions[i * 3 + 2] = z
      // Cool-white to faint gold, with a wide brightness spread.
      c.setHSL(0.55 + (Math.random() - 0.5) * 0.25, Math.random() * 0.35, 0.65 + Math.random() * 0.35)
      const b = 0.35 + Math.random() * 0.65
      colors[i * 3] = c.r * b; colors[i * 3 + 1] = c.g * b; colors[i * 3 + 2] = c.b * b
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    starField = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.1,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true, // near stars big, far ones sub-pixel - the depth cue
      blending: THREE.AdditiveBlending,
    }))
    starField.frustumCulled = false
    bgScene.add(starField)

    // Render target the bg scene draws into, shown on the ortho background quad.
    bgRT = new THREE.WebGLRenderTarget(Math.max(1, viewWidth), Math.max(1, viewHeight))

    // Full-screen quad in the ortho scene that displays the bg render target. Opaque (it's
    // the backdrop) and never bloomed.
    bgMesh = new THREE.Mesh(unitGeometry, new THREE.MeshBasicMaterial({
      map: bgRT.texture, depthTest: false, depthWrite: false,
    }))
    bgMesh.renderOrder = RENDER_ORDER.bg
    scene.add(bgMesh)
  }

  const makeGlowMesh = (color, order, bloom = true) => {
    const mesh = new THREE.Mesh(unitGeometry, basicMat({ map: glowTexture, color, blending: THREE.AdditiveBlending }))
    mesh.renderOrder = order
    mesh.visible = false
    if (bloom) enableBloom(mesh)
    scene.add(mesh)
    return mesh
  }

  const buildShip = () => {
    shipHitGlow = makeGlowMesh(SHIP_HIT_COLOR, RENDER_ORDER.shipGlow)
    // The shield aura is a big, persistent disc - keep it off the bloom layer so it reads as
    // a soft additive glow rather than blowing out into a giant cyan halo.
    shipShieldGlow = makeGlowMesh(SHIP_SHIELD_COLOR, RENDER_ORDER.shipGlow, false)

    shipGroup = new THREE.Group()
    shipBody = new THREE.Mesh(unitGeometry, basicMat({ map: shipTexture }))
    shipBody.renderOrder = RENDER_ORDER.ship
    shipGroup.add(shipBody)
    shipGroup.visible = false
    scene.add(shipGroup)
  }

  const buildAlly = () => {
    // Outer group owns warp scale (screen-axis); inner body owns heading rotation -
    // same split as the old .ally / .ally-body elements.
    allyGroup = new THREE.Group()
    allyBody = new THREE.Mesh(unitGeometry, basicMat({ map: enterpriseTexture }))
    allyBody.scale.set(ALLY_SIZE, ALLY_HEIGHT, 1)
    allyGroup.add(allyBody)
    allyGroup.visible = false
    scene.add(allyGroup)

    beamMesh = new THREE.Mesh(unitGeometry, basicMat({ map: beamTexture, color: BEAM_COLOR, blending: THREE.AdditiveBlending }))
    beamMesh.renderOrder = RENDER_ORDER.beam
    beamMesh.visible = false
    enableBloom(beamMesh)
    scene.add(beamMesh)
  }

  // A believable rock: start from a well-subdivided icosahedron, squash it into a random
  // ellipsoid (so it's not a sphere), then push each vertex in/out by multi-octave
  // coherent noise (fbm) - big lumps from the low octaves, surface roughness from the high
  // ones. Smooth-shaded so it reads as a solid body rather than a bag of triangles.
  const makeAsteroidGeometry = () => {
    const geo = new THREE.IcosahedronGeometry(1, 5)
    const pos = geo.attributes.position
    const v = new THREE.Vector3()

    const ax = 0.7 + Math.random() * 0.6 // ellipsoid axes
    const ay = 0.7 + Math.random() * 0.6
    const az = 0.7 + Math.random() * 0.6
    const ox = Math.random() * 100 // per-rock noise offset
    const oy = Math.random() * 100
    const oz = Math.random() * 100

    // Dirty-rock palette, blended per vertex: near-black brown base, rust, and a mossy
    // grey-green. Crevices (noise dents) get darkened for a grimy, worn look.
    const colors = new Float32Array(pos.count * 3)
    const cBase = new THREE.Color(0x1c1814)
    const cRust = new THREE.Color(0x43301f)
    const cMoss = new THREE.Color(0x2f3327)
    const col = new THREE.Color()

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i) // unit direction
      const nx = v.x; const ny = v.y; const nz = v.z
      let d = 0; let amp = 0.5; let freq = 1.6
      for (let o = 0; o < 5; o++) {
        d += amp * noise.noise(nx * freq + ox, ny * freq + oy, nz * freq + oz)
        amp *= 0.5; freq *= 2.2
      }
      const r = 1 + d * 0.7
      v.set(nx * ax, ny * ay, nz * az).multiplyScalar(r)
      pos.setXYZ(i, v.x, v.y, v.z)

      // Mottled dirt: a low-frequency noise (offset so it doesn't track the shape) blends
      // the palette; then darken by crevice depth for fake ambient occlusion.
      const m = noise.noise(nx * 0.9 + ox + 40, ny * 0.9 + oy + 40, nz * 0.9 + oz + 40) * 0.5 + 0.5
      col.copy(cBase).lerp(cRust, clamp01(m * 1.5))
      col.lerp(cMoss, clamp01((m - 0.55) * 1.6))
      col.multiplyScalar(clamp01(0.5 + d * 0.9)) // dents darker, bumps lighter
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b
    }
    pos.needsUpdate = true
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    return geo
  }

  // (Re)seed one asteroid: pick a size (=> depth), speed, spin and entry position. When
  // initial, spread it anywhere across the field; otherwise start it just off the edge it
  // enters from. Positions are plain scene coords (+y up) - purely decorative, no game math.
  const resetAsteroid = (a, initial) => {
    const dir = Math.random() < 0.5 ? 1 : -1
    const sizePx = ASTEROID_MIN_SIZE + Math.random() * (ASTEROID_MAX_SIZE - ASTEROID_MIN_SIZE)
    const depth = (sizePx - ASTEROID_MIN_SIZE) / (ASTEROID_MAX_SIZE - ASTEROID_MIN_SIZE) // 0 far .. 1 near
    a.mesh.scale.setScalar(sizePx)

    // Depth tint multiplies the (already dark, dirty) vertex colours - far rocks read
    // dimmer for aerial-perspective depth.
    a.mesh.material.color.setScalar(0.55 + depth * 0.45)

    const speed = (12 + Math.random() * 20) * (0.5 + depth) // px/s, nearer = faster
    a.vx = dir * speed
    a.vy = (Math.random() * 2 - 1) * speed * 0.3

    const margin = sizePx + 24
    a.mesh.position.set(
      initial ? Math.random() * viewWidth : (dir > 0 ? -margin : viewWidth + margin),
      Math.random() * viewHeight,
      0
    )
    a.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    a.spinX = (Math.random() * 2 - 1) * 0.6
    a.spinY = (Math.random() * 2 - 1) * 0.6
    a.spinZ = (Math.random() * 2 - 1) * 0.6
  }

  const buildAsteroids = () => {
    // Lights only touch the (lit) asteroid material; every other object uses MeshBasicMaterial
    // and ignores them.
    asteroidAmbient = new THREE.AmbientLight(0x8899bb, 0.5)
    asteroidLight = new THREE.DirectionalLight(0xfff2e0, 2.2)
    asteroidLight.position.set(-0.4, 0.7, 1)
    scene.add(asteroidAmbient, asteroidLight)

    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const mesh = new THREE.Mesh(
        makeAsteroidGeometry(),
        // transparent:true so it sorts with the rest of the scene by renderOrder (the black
        // background quad is itself a transparent mesh); depth test/write on for correct
        // self-occlusion as it tumbles.
        new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, vertexColors: true, transparent: true })
      )
      mesh.renderOrder = RENDER_ORDER.asteroid
      scene.add(mesh)
      const a = { mesh, vx: 0, vy: 0, spinX: 0, spinY: 0, spinZ: 0 }
      resetAsteroid(a, true)
      asteroids.push(a)
    }
  }

  // A UFO plus its health bar (dark track + coloured fill quads).
  const makeEnemy = () => {
    const body = new THREE.Mesh(unitGeometry, basicMat({ map: ufoTexture }))
    const track = new THREE.Mesh(unitGeometry, basicMat({ color: 0x000000, opacity: 0.45 }))
    track.renderOrder = RENDER_ORDER.healthTrack
    const fill = new THREE.Mesh(unitGeometry, basicMat({}))
    fill.renderOrder = RENDER_ORDER.healthFill
    scene.add(body, track, fill)
    return { body, track, fill }
  }

  const makeBoltMesh = (kind) => {
    const mesh = new THREE.Mesh(unitGeometry, basicMat({ map: boltTextures[kind], blending: THREE.AdditiveBlending }))
    mesh.renderOrder = RENDER_ORDER.bolt
    mesh.userData.kind = kind
    enableBloom(mesh)
    scene.add(mesh)
    return mesh
  }

  const makePowerUpMesh = () => {
    const mesh = new THREE.Mesh(unitGeometry, basicMat({}))
    mesh.renderOrder = RENDER_ORDER.powerUp
    scene.add(mesh)
    return mesh
  }

  // --- Particles -------------------------------------------------------------

  const PARTICLE_VERT = `
    attribute vec3 acolor;
    attribute float asize;
    attribute float aalpha;
    uniform float uPixelRatio;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vColor = acolor;
      vAlpha = aalpha;
      gl_PointSize = asize * uPixelRatio;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `
  const PARTICLE_FRAG = `
    uniform sampler2D map;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec4 tex = texture2D(map, gl_PointCoord);
      // Additive blend: contribution is rgb * a, so the alpha both fades the particle
      // and applies the soft-dot texture falloff.
      gl_FragColor = vec4(vColor, tex.a * vAlpha);
    }
  `

  const buildParticles = () => {
    pPos = new Float32Array(PARTICLE_MAX * 3)
    pColor = new Float32Array(PARTICLE_MAX * 3)
    pSize = new Float32Array(PARTICLE_MAX)
    pAlpha = new Float32Array(PARTICLE_MAX)
    pVel = new Float32Array(PARTICLE_MAX * 3)
    pLife = new Float32Array(PARTICLE_MAX)
    pMaxLife = new Float32Array(PARTICLE_MAX)
    pSize0 = new Float32Array(PARTICLE_MAX)
    pSize1 = new Float32Array(PARTICLE_MAX)
    pDrag = new Float32Array(PARTICLE_MAX)

    particleGeom = new THREE.BufferGeometry()
    particleGeom.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
    particleGeom.setAttribute('acolor', new THREE.BufferAttribute(pColor, 3))
    particleGeom.setAttribute('asize', new THREE.BufferAttribute(pSize, 1))
    particleGeom.setAttribute('aalpha', new THREE.BufferAttribute(pAlpha, 1))

    particleMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: glowTexture },
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    particlePoints = new THREE.Points(particleGeom, particleMat)
    particlePoints.renderOrder = RENDER_ORDER.particles
    particlePoints.frustumCulled = false // positions roam; skip the stale-bounds cull
    enableBloom(particlePoints)
    scene.add(particlePoints)
  }

  // Claim the next ring-buffer slot (overwriting the oldest once full). Coords are scene
  // space (+y up); callers convert via toScene.
  const spawnParticle = (x, y, vx, vy, r, g, b, life, size0, size1, drag) => {
    const i = pCursor
    pCursor = (pCursor + 1) % PARTICLE_MAX
    const i3 = i * 3
    pPos[i3] = x; pPos[i3 + 1] = y; pPos[i3 + 2] = 0
    pVel[i3] = vx; pVel[i3 + 1] = vy; pVel[i3 + 2] = 0
    pColor[i3] = r; pColor[i3 + 1] = g; pColor[i3 + 2] = b
    pLife[i] = life; pMaxLife[i] = life
    pSize0[i] = size0; pSize1[i] = size1; pDrag[i] = drag
    pSize[i] = size0; pAlpha[i] = 1
  }

  // Fire a spray of particles from (x, y) in scene space. angle=null -> radial burst.
  const emitBurst = (x, y, opts) => {
    if (!particlePoints || prefersReducedMotion) return
    const {
      count = 12, color = 0xffffff, speed = 120, speedVar = 0.6,
      life = 0.6, lifeVar = 0.4, size0 = 10, size1 = 2, drag = 3,
      angle = null, spread = Math.PI * 2,
    } = opts || {}
    scratchColor.set(color)
    const { r, g, b } = scratchColor
    for (let n = 0; n < count; n++) {
      const a = angle == null
        ? Math.random() * Math.PI * 2
        : angle + (Math.random() - 0.5) * spread
      const sp = speed * (1 - speedVar + Math.random() * 2 * speedVar)
      const ln = life * (1 - lifeVar + Math.random() * 2 * lifeVar)
      spawnParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, r, g, b, ln, size0, size1, drag)
    }
  }

  // Bump the shake to at least `amount` (world px). Kicks don't stack past the strongest.
  const addShake = (amount) => {
    if (prefersReducedMotion) return
    if (amount > shakeMag) shakeMag = amount
  }

  const updateParticles = (dt) => {
    if (!particlePoints) return
    let any = false
    for (let i = 0; i < PARTICLE_MAX; i++) {
      if (pLife[i] <= 0) continue
      pLife[i] -= dt
      const i3 = i * 3
      if (pLife[i] <= 0) { pAlpha[i] = 0; pSize[i] = 0; any = true; continue }
      const frac = pLife[i] / pMaxLife[i] // 1 at birth -> 0 at death
      const d = Math.exp(-pDrag[i] * dt)
      pVel[i3] *= d; pVel[i3 + 1] *= d
      pPos[i3] += pVel[i3] * dt
      pPos[i3 + 1] += pVel[i3 + 1] * dt
      pSize[i] = pSize1[i] + (pSize0[i] - pSize1[i]) * frac
      pAlpha[i] = frac
      any = true
    }
    if (any) {
      particleGeom.attributes.position.needsUpdate = true
      particleGeom.attributes.acolor.needsUpdate = true
      particleGeom.attributes.asize.needsUpdate = true
      particleGeom.attributes.aalpha.needsUpdate = true
    }
  }

  // --- Per-frame updates -----------------------------------------------------

  // Ease the bg camera toward a parallax offset driven by the ship, slowly spin the field,
  // then render the perspective starfield into its target (shown on the ortho bg quad).
  const renderBackground = (dt) => {
    if (!bgScene || !bgCamera || !bgRT) return

    starField.rotation.z += BG_DRIFT * dt

    const s = game.getShipRenderState()
    let tx = 0
    let ty = 0
    if (s.visible) {
      tx = ((s.x / viewWidth) - 0.5) * 2 * BG_PARALLAX
      ty = -((s.y / viewHeight) - 0.5) * 2 * BG_PARALLAX // world +y is down; bg +y is up
    }
    const k = 1 - Math.exp(-BG_PARALLAX_RATE * dt)
    bgCamera.position.x += (tx - bgCamera.position.x) * k
    bgCamera.position.y += (ty - bgCamera.position.y) * k

    renderer.setRenderTarget(bgRT)
    renderer.render(bgScene, bgCamera) // autoClear paints the opaque-black backdrop
    renderer.setRenderTarget(null)
  }

  const updateAsteroids = (dt) => {
    if (prefersReducedMotion) return // leave them as a static field
    for (const a of asteroids) {
      a.mesh.position.x += a.vx * dt
      a.mesh.position.y += a.vy * dt
      a.mesh.rotation.x += a.spinX * dt
      a.mesh.rotation.y += a.spinY * dt
      a.mesh.rotation.z += a.spinZ * dt
      // Recycle once fully off the edge it's heading toward (or drifted well off top/bottom).
      const s = a.mesh.scale.x + 24
      const p = a.mesh.position
      if ((a.vx > 0 && p.x > viewWidth + s) || (a.vx < 0 && p.x < -s) ||
          p.y < -s || p.y > viewHeight + s) {
        resetAsteroid(a, false)
      }
    }
  }

  const updateShip = (t) => {
    const s = game.getShipRenderState()
    shipGroup.visible = s.visible
    shipHitGlow.visible = s.visible && s.hit
    shipShieldGlow.visible = s.visible && s.shielded

    // Jolt on the rising edge of the ship's hit flash.
    if (s.visible && s.hit && !lastShipHit) addShake(10)
    lastShipHit = s.visible && s.hit

    if (!s.visible) {
      lastShipX = lastShipY = null
      return
    }

    const [cx, cy] = toScene(s.x, s.y) // s.x/s.y is the ship centre

    // Thruster trail: emit a couple of particles behind the ship while it's actually
    // moving (compare against last frame's position - the game only tracks position, not
    // velocity). Behind = opposite the movement vector, in scene space (+y up).
    if (lastShipX != null) {
      const mvx = s.x - lastShipX
      const mvy = s.y - lastShipY
      const mvLen = Math.hypot(mvx, mvy)
      if (mvLen > 0.6) {
        const bx = -mvx / mvLen
        const by = mvy / mvLen // world +y is down; scene +y is up, so flip
        emitBurst(cx + bx * SHIP_SIZE * 0.4, cy + by * SHIP_SIZE * 0.4, {
          count: 2,
          color: 0x93c5fd,
          angle: Math.atan2(by, bx),
          spread: 0.7,
          speed: 60, speedVar: 0.5,
          life: 0.45, lifeVar: 0.5,
          size0: 9, size1: 1, drag: 2.5,
        })
      }
    }
    lastShipX = s.x
    lastShipY = s.y
    shipGroup.position.set(cx, cy, 0)
    // CSS rotate() is clockwise in screen space; scene +y is up, so negate.
    shipGroup.rotation.z = -THREE.MathUtils.degToRad(s.angle)
    // CSS scale(1/stretch, stretch) - warp squash-and-stretch.
    shipGroup.scale.set(SHIP_SIZE / s.stretch, SHIP_SIZE * s.stretch, 1)

    // Glows follow the ship centre but ignore the warp stretch.
    if (shipHitGlow.visible) {
      shipHitGlow.position.set(cx, cy, 0)
      shipHitGlow.scale.setScalar(SHIP_SIZE * 2.2)
    }
    if (shipShieldGlow.visible) {
      shipShieldGlow.position.set(cx, cy, 0)
      shipShieldGlow.scale.setScalar(SHIP_SIZE * 2.4 * (1 + 0.06 * Math.sin(t * 5)))
    }
  }

  const updateAlly = (t) => {
    const a = game.ally
    allyGroup.visible = a.active
    beamMesh.visible = a.active && a.beamActive

    if (a.active) {
      allyGroup.position.set(...toScene(a.x + ALLY_SIZE / 2, a.y + ALLY_HEIGHT / 2), 0)
      allyBody.rotation.z = -THREE.MathUtils.degToRad(a.angle)

      // Warp-in/out squash-stretch (screen-axis, on the outer group).
      if (allyGroup.userData.phase !== a.phase) {
        allyGroup.userData.phase = a.phase
        allyGroup.userData.phaseStart = t
      }
      const p = clamp01((t - (allyGroup.userData.phaseStart ?? t)) / ALLY_WARP_DURATION)
      let sx = 1
      let sy = 1
      let op = 1
      if (a.phase === 'in') {
        const e = 1 - (1 - p) * (1 - p)
        sx = lerp(0.08, 1, e)
        sy = lerp(2.6, 1, e)
        op = clamp01(p / 0.55)
      } else if (a.phase === 'out') {
        const e = p * p
        sx = lerp(1, 0.08, e)
        sy = lerp(1, 2.6, e)
        op = 1 - e
      }
      allyGroup.scale.set(sx, sy, 1)
      allyBody.material.opacity = op
    }

    // Phaser zap: quick fade over the beam's life (opacity 0.2 -> 1 -> 0).
    if (beamMesh.visible) {
      if (!beamMesh.userData.active) {
        beamMesh.userData.active = true
        beamMesh.userData.start = t
      }
      const [x1, y1] = toScene(a.beamX1, a.beamY1)
      const [x2, y2] = toScene(a.beamX2, a.beamY2)
      beamMesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0)
      beamMesh.rotation.z = Math.atan2(y2 - y1, x2 - x1)
      beamMesh.scale.set(Math.hypot(x2 - x1, y2 - y1), BEAM_THICKNESS, 1)
      const bp = clamp01((t - beamMesh.userData.start) / BEAM_DURATION)
      beamMesh.material.opacity = bp < 0.25 ? lerp(0.2, 1, bp / 0.25) : lerp(1, 0, (bp - 0.25) / 0.75)
    } else {
      beamMesh.userData.active = false
    }
  }

  const reconcileEnemies = (t, dt) => {
    // Ease factor toward this frame's targets (size/depth-dim), matching the old ~1s morph.
    const k = 1 - Math.exp(-UFO_DEPTH_RATE * dt)
    const enemies = game.enemies
    for (const enemy of enemies) {
      let e = enemyMeshes.get(enemy.id)
      if (!e) {
        e = makeEnemy()
        enemyMeshes.set(enemy.id, e)
      }
      const { body, track, fill } = e

      // Debris fires on the destroyed transition. The game hides the UFO (visible=false)
      // the same frame it's destroyed, so emit here - before the visibility early-out -
      // using the kill-site position/size the game keeps until respawn.
      if (enemy.destroyed) {
        if (!body.userData.debrisDone) {
          body.userData.debrisDone = true
          const dsize = body.userData.renderSize ?? enemy.size
          const [dcx, dcy] = toScene(enemy.x + dsize / 2, enemy.y + dsize / 2)
          emitBurst(dcx, dcy, {
            count: 18,
            color: UFO_DESTROYED_COLOR,
            speed: 140 * (dsize / 40), speedVar: 0.7,
            life: 0.7, lifeVar: 0.5,
            size0: Math.max(6, dsize * 0.25), size1: 1, drag: 3.2,
          })
          addShake(4 + dsize * 0.12) // bigger/closer UFOs hit harder
        }
      } else {
        body.userData.debrisDone = false
      }

      body.visible = track.visible = fill.visible = enemy.visible
      if (!enemy.visible) {
        body.userData.destroyStart = undefined
        // Snap so a respawn (new profile) starts at its real size instead of gliding in.
        body.userData.renderSize = enemy.size
        body.userData.renderDim = Math.min(enemy.brightness / 100, 1)
        continue
      }

      const targetDim = Math.min(enemy.brightness / 100, 1) // depth dimming
      // Lazily seed, then ease the rendered size/dim toward their targets each frame.
      if (body.userData.renderSize === undefined) body.userData.renderSize = enemy.size
      if (body.userData.renderDim === undefined) body.userData.renderDim = targetDim
      const size = (body.userData.renderSize += (enemy.size - body.userData.renderSize) * k)
      const dim = (body.userData.renderDim += (targetDim - body.userData.renderDim) * k)

      // Anchor the top-left (enemy.x/y) like the old element did, so the eased size grows
      // from the corner rather than shifting the centre.
      body.position.set(...toScene(enemy.x + size / 2, enemy.y + size / 2), 0)
      body.renderOrder = enemy.zIndex

      if (enemy.destroyed) {
        if (body.userData.destroyStart === undefined) body.userData.destroyStart = t
        const p = clamp01((t - body.userData.destroyStart) / DESTROY_DURATION)
        body.scale.setScalar(size * sampleKeyframes(DESTROY_PULSE, p))
        body.material.color.set(UFO_DESTROYED_COLOR)
      } else {
        body.userData.destroyStart = undefined
        body.scale.set(size, size, 1)
        if (enemy.hit) body.material.color.set(UFO_HIT_COLOR)
        else body.material.color.setScalar(dim)
      }

      // Health bar just above the UFO (the old CSS anchored it at the enemy's top-left,
      // translated (-2, -10), width = 0.8 * size). Fill is left-aligned; both dim with depth.
      const barW = size * 0.8
      const barLeft = enemy.x - 2
      const barCy = enemy.y - 10 + HEALTH_BAR_HEIGHT / 2
      const ratio = clamp01(game.enemyHealthRatio(enemy))
      track.position.set(...toScene(barLeft + barW / 2, barCy), 0)
      track.scale.set(barW, HEALTH_BAR_HEIGHT, 1)
      const fillW = Math.max(barW * ratio, 0.001)
      fill.position.set(...toScene(barLeft + fillW / 2, barCy), 0)
      fill.scale.set(fillW, HEALTH_BAR_HEIGHT, 1)
      fill.material.color.set(game.healthColor(ratio)).multiplyScalar(dim)
    }
    for (const [id, e] of enemyMeshes) {
      if (!enemies.some((en) => en.id === id)) {
        for (const m of [e.body, e.track, e.fill]) {
          scene.remove(m)
          m.material.dispose()
        }
        enemyMeshes.delete(id)
      }
    }
  }

  const boltKind = (p) => (p.laser ? 'laser' : p.owner === 'alien' ? 'alien' : 'player')

  const reconcileBolts = () => {
    const bolts = game.projectiles
    for (const p of bolts) {
      const kind = boltKind(p)
      let mesh = boltMeshes.get(p.id)
      if (!mesh || mesh.userData.kind !== kind) {
        if (mesh) { scene.remove(mesh); mesh.material.dispose() }
        mesh = makeBoltMesh(kind)
        boltMeshes.set(p.id, mesh)
      }
      const core = BOLT_STYLES[kind].core
      const footprint = core * 2
      mesh.position.set(...toScene(p.x + core / 2, p.y + core / 2), 0)
      mesh.scale.set(footprint, footprint, 1)
    }
    for (const [id, mesh] of boltMeshes) {
      if (!bolts.some((p) => p.id === id)) {
        scene.remove(mesh)
        mesh.material.dispose()
        boltMeshes.delete(id)
      }
    }
  }

  // Player bolts shatter drifting asteroids: on overlap, burst rocky debris, recycle the
  // rock, and consume the shot - the asteroid blocks it, so a shot is "used up" on the rock
  // rather than passing through. Enemy fire ignores the rocks.
  const shatterAsteroids = () => {
    const bolts = game.projectiles
    if (!bolts.length) return
    for (const a of asteroids) {
      const px = a.mesh.position.x
      const py = a.mesh.position.y
      const rad = a.mesh.scale.x * 0.9
      const rad2 = rad * rad
      for (const p of bolts) {
        if (p.owner === 'alien') continue // enemy fire ignores background rocks
        const [bx, by] = toScene(p.x, p.y)
        const dx = bx - px
        const dy = by - py
        if (dx * dx + dy * dy <= rad2) {
          emitBurst(px, py, {
            count: 20,
            color: 0x9c7f5f,
            speed: 90 + a.mesh.scale.x * 1.2, speedVar: 0.7,
            life: 0.6, lifeVar: 0.5,
            size0: Math.max(4, a.mesh.scale.x * 0.16), size1: 1, drag: 3,
          })
          addShake(3)
          resetAsteroid(a, false) // send it back off an edge; the debris sells the break
          game.consumeProjectile?.(p.id) // the shot is spent on the rock
          break // this rock is gone and the bolt consumed; move to the next rock
        }
      }
    }
  }

  const reconcilePowerUps = (t) => {
    const powerUps = game.powerUps
    // Idle bob-scale, matching @keyframes power-up-idle (1 -> 1.12 over 1.6s).
    const pulse = 1 + 0.06 - 0.06 * Math.cos((t / 1.6) * Math.PI * 2)
    for (const p of powerUps) {
      let mesh = powerUpMeshes.get(p.id)
      if (!mesh) {
        mesh = makePowerUpMesh()
        powerUpMeshes.set(p.id, mesh)
      }
      const { tex, w, h } = getPowerUpTexture(p.label, p.color)
      mesh.material.map = tex
      mesh.position.set(...toScene(p.x, p.y), 0) // powerUp x/y is the centre

      if (p.state === POWERUP_STATE.COLLECTED) {
        // Collect pop: scale to 2.2 and fade over 0.3s (@ .power-up--collected).
        if (mesh.userData.collectStart === undefined) {
          mesh.userData.collectStart = t
          const [scx, scy] = toScene(p.x, p.y)
          emitBurst(scx, scy, {
            count: 16,
            color: p.color,
            speed: 130, speedVar: 0.6,
            life: 0.55, lifeVar: 0.5,
            size0: 8, size1: 1, drag: 3,
          })
        }
        const cp = clamp01((t - mesh.userData.collectStart) / 0.3)
        mesh.visible = cp < 1
        mesh.scale.set(w * lerp(1, 2.2, cp), h * lerp(1, 2.2, cp), 1)
        mesh.material.opacity = 1 - cp
      } else {
        mesh.userData.collectStart = undefined
        mesh.visible = true
        mesh.material.opacity = 1
        mesh.scale.set(w * pulse, h * pulse, 1)
      }
    }
    for (const [id, mesh] of powerUpMeshes) {
      if (!powerUps.some((p) => p.id === id)) {
        scene.remove(mesh)
        mesh.material.dispose()
        powerUpMeshes.delete(id)
      }
    }
  }

  const tick = (time) => {
    if (!renderer) return
    if (!startTime) { startTime = time; prevTime = time }
    const t = (time - startTime) / 1000
    // Clamped so a backgrounded tab (huge gap) doesn't make the eased values jump.
    const dt = Math.min((time - prevTime) / 1000, 0.05)
    prevTime = time
    if (game) {
      updateAsteroids(dt)
      updateShip(t)
      updateAlly(t)
      reconcileEnemies(t, dt)
      reconcileBolts()
      shatterAsteroids()
      reconcilePowerUps(t)
      updateParticles(dt)
    }

    // Apply + decay the screen shake as a random camera offset (world px).
    if (shakeMag > 0.05) {
      camera.position.x = (Math.random() * 2 - 1) * shakeMag
      camera.position.y = (Math.random() * 2 - 1) * shakeMag
      shakeMag *= Math.exp(-SHAKE_DECAY * dt)
    } else if (camera.position.x !== 0 || camera.position.y !== 0) {
      shakeMag = 0
      camera.position.x = camera.position.y = 0
    }

    // Draw the perspective starfield into its target before the ortho scene samples it.
    renderBackground(dt)

    if (bloomComposer && finalComposer) {
      camera.layers.set(BLOOM_LAYER) // bloom pass: only the energy objects
      bloomComposer.render()
      camera.layers.set(0) // final pass: the whole scene (everything is on layer 0)
      finalComposer.render()
    } else {
      renderer.render(scene, camera)
    }
    rafId = requestAnimationFrame(tick)
  }

  // Selective bloom via two composers (the standard three.js technique). The postprocessing
  // passes are dynamically imported so they stay out of the default bundle (like three
  // itself). On any failure we leave the composers null and fall back to renderer.render -
  // the scene still draws, just without the glow.
  const buildComposer = async (canvas) => {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }, { OutputPass }] = await Promise.all([
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
        import('three/examples/jsm/postprocessing/ShaderPass.js'),
        import('three/examples/jsm/postprocessing/OutputPass.js'),
      ])
      // Torn down (or the canvas swapped) while importing.
      if (!renderer || stageCanvas.value !== canvas) return

      const renderScene = new RenderPass(scene, camera)

      // Pass 1: draw only the BLOOM_LAYER objects (camera layer is set at render time),
      // blur them, and keep the result offscreen.
      bloomComposer = new EffectComposer(renderer)
      bloomComposer.renderToScreen = false
      bloomComposer.setPixelRatio(renderer.getPixelRatio())
      bloomComposer.addPass(renderScene)
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(viewWidth, viewHeight), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD
      )
      bloomComposer.addPass(bloomPass)

      // Pass 2: draw the full scene, then additively composite the bloom texture over it.
      const mixPass = new ShaderPass(
        new THREE.ShaderMaterial({
          uniforms: {
            baseTexture: { value: null },
            bloomTexture: { value: bloomComposer.renderTarget2.texture },
          },
          vertexShader: `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
          `,
          fragmentShader: `
            uniform sampler2D baseTexture;
            uniform sampler2D bloomTexture;
            varying vec2 vUv;
            void main() { gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }
          `,
        }),
        'baseTexture'
      )
      mixPass.needsSwap = true

      finalComposer = new EffectComposer(renderer)
      finalComposer.setPixelRatio(renderer.getPixelRatio())
      finalComposer.addPass(renderScene)
      finalComposer.addPass(mixPass)
      finalComposer.addPass(new OutputPass())
    } catch (err) {
      bloomComposer = finalComposer = bloomPass = null
      console.warn('[useThreeStage] bloom unavailable, rendering without it', err)
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  const start = async () => {
    const canvas = stageCanvas.value
    if (!canvas || renderer) return

    // Lazy-load three (~205 KB gzip) so it only ships when alien mode is entered.
    THREE = await import('three')
    // Bail if we were torn down - or another start already ran - while importing.
    if (renderer || !active.value || stageCanvas.value !== canvas) return

    // Coherent noise for sculpting the asteroid surfaces (also lazy).
    const { ImprovedNoise } = await import('three/examples/jsm/math/ImprovedNoise.js')
    if (renderer || !active.value || stageCanvas.value !== canvas) return
    noise = new ImprovedNoise()

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    // Opaque black backdrop (deep space) for both the bg render target and the final canvas.
    renderer.setClearColor(0x000000, 1)
    scene = new THREE.Scene()
    // Deep clip range + far camera so the 3D asteroids' z-extent fits. Orthographic scale
    // is set by the frustum box (left/right/top/bottom), not camera distance, so pushing
    // the camera back doesn't change how anything looks - flat sprites at z=0 are unaffected.
    camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 2000)
    camera.position.z = 1000

    unitGeometry = new THREE.PlaneGeometry(1, 1)

    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    const load = (url, onLoad) => {
      const tex = loader.load(url, onLoad)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    }

    shipTexture = load(SHIP_TEXTURE_URL)
    ufoTexture = load(ufoUrl)
    enterpriseTexture = load(enterpriseUrl)
    beamTexture = makeBeamTexture()
    glowTexture = makeGlowTexture()

    boltTextures.player = makeBoltTexture(BOLT_STYLES.player.rgb, BOLT_STYLES.player.glow)
    boltTextures.alien = makeBoltTexture(BOLT_STYLES.alien.rgb, BOLT_STYLES.alien.glow)
    boltTextures.laser = makeBoltTexture(BOLT_STYLES.laser.rgb, BOLT_STYLES.laser.glow)

    scratchColor = new THREE.Color()
    prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    buildBackground()
    buildShip()
    buildAlly()
    buildParticles()
    buildAsteroids()

    await buildComposer(canvas)
    if (!renderer || stageCanvas.value !== canvas) return

    sizeToContainer()
    resizeObserver = new ResizeObserver(sizeToContainer)
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)

    startTime = 0
    rafId = requestAnimationFrame(tick)
  }

  const stop = () => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = null
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }

    for (const e of enemyMeshes.values()) {
      e.body.material.dispose()
      e.track.material.dispose()
      e.fill.material.dispose()
    }
    for (const mesh of boltMeshes.values()) mesh.material.dispose()
    for (const mesh of powerUpMeshes.values()) mesh.material.dispose()
    enemyMeshes.clear()
    boltMeshes.clear()
    powerUpMeshes.clear()

    for (const mesh of [bgMesh, shipHitGlow, shipShieldGlow, allyBody, beamMesh]) {
      if (mesh) mesh.material.dispose()
    }
    if (shipGroup) shipGroup.children.forEach((c) => c.material.dispose())
    bgMesh = shipGroup = shipBody = null
    shipHitGlow = shipShieldGlow = allyGroup = allyBody = beamMesh = null

    // Perspective background layer.
    if (starField) {
      starField.geometry.dispose()
      starField.material.dispose()
    }
    bgRT?.dispose?.()
    bgScene = bgCamera = bgRT = starField = null

    for (const a of asteroids) {
      scene?.remove(a.mesh)
      a.mesh.geometry.dispose()
      a.mesh.material.dispose()
    }
    asteroids = []
    if (asteroidAmbient) scene?.remove(asteroidAmbient)
    if (asteroidLight) scene?.remove(asteroidLight)
    asteroidLight?.dispose?.()
    asteroidAmbient = asteroidLight = null
    noise = null

    if (particleGeom) particleGeom.dispose()
    if (particleMat) particleMat.dispose()
    particlePoints = particleGeom = particleMat = null
    scratchColor = null
    pCursor = 0
    lastShipX = lastShipY = null
    shakeMag = 0
    lastShipHit = false

    if (unitGeometry) unitGeometry.dispose()
    for (const tex of [shipTexture, ufoTexture, enterpriseTexture, beamTexture, glowTexture]) {
      if (tex) tex.dispose()
    }
    Object.values(boltTextures).forEach((t) => t.dispose())
    for (const k of Object.keys(boltTextures)) delete boltTextures[k]
    for (const { tex } of powerUpTextures.values()) tex.dispose()
    powerUpTextures.clear()

    bloomComposer?.dispose?.()
    finalComposer?.dispose?.()
    bloomPass?.dispose?.()
    bloomComposer = finalComposer = bloomPass = null

    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss?.()
    }
    renderer = scene = camera = unitGeometry = null
    shipTexture = ufoTexture = enterpriseTexture = beamTexture = glowTexture = null
  }

  // The canvas is behind a v-if (alien mode, desktop only), so it only exists in
  // the DOM some of the time. Wait for BOTH the ref and active before starting;
  // flip either off and we tear the stage down.
  watch(
    [() => active.value, stageCanvas],
    ([isActive, canvas]) => {
      if (isActive && canvas) start()
      else stop()
    },
    { immediate: true }
  )

  onBeforeUnmount(stop)

  return { stageCanvas }
}
