import { onBeforeUnmount, ref, watch } from 'vue'
import { POWERUP_STATE } from '@/hooks/useSpaceGame'
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

// The 3D ship banks (rolls) into turns: bank angle tracks the turn rate, clamped and eased.
const SHIP_BANK_PER_DEGPS = 0.004 // rad of roll per deg/s of turn
const SHIP_MAX_BANK = 0.6 // rad (~34 deg)
const SHIP_BANK_RATE = 8 // easing toward the target roll (per second)

// Perspective background starfield. Its own scene + PerspectiveCamera are rendered to a
// texture each frame and shown on the ortho background quad, so the stars get genuine depth
// (near ones big, far ones tiny) and parallax as the camera drifts with the ship - while
// the gameplay layer stays pixel-accurate orthographic.
const BG_STAR_COUNT = 3600
const BG_NEAR = 60 // nearest star depth (world units) - kept far so we're not "flying through"
const BG_FAR = 320 // farthest
const BG_PARALLAX = 0.5 // how far the bg camera slides with the ship (world units) - subtle
const BG_PARALLAX_RATE = 2.5 // easing toward the parallax target (per second)
const BG_DRIFT = 0.005 // slow galactic spin (rad/s)
const NEBULA_INTENSITY = 0.1 // overall opacity of the fbm nebula clouds (0 = off)
const NEBULA_SPEED = 0.015 // how fast the clouds churn

// A planet occasionally drifts across the far background (in the perspective bg scene).
const PLANET_DEPTH = 200 // world units in front of the bg camera
const PLANET_MIN_RADIUS = 18
const PLANET_MAX_RADIUS = 36
const PLANET_SPEED = 7 // world units/s - a very slow crossing
const PLANET_GAP_MIN = 18 // s hidden between crossings
const PLANET_GAP_MAX = 45
const PLANET_SPIN = 0.03 // rad/s axial spin
// Surface palettes: low/high blend by fbm noise; atmo tints the rim glow; banded = gas
// giant latitude stripes; ice = polar cap strength.
const PLANET_PALETTES = [
  { low: 0x1b3a6b, high: 0x2f7a3a, atmo: 0x3aa0ff, banded: false, ice: 0.9 }, // earthy
  { low: 0x6b3a2a, high: 0xb0895a, atmo: 0xff8a4a, banded: false, ice: 0.2 }, // rocky / mars
  { low: 0x7a5a2a, high: 0xd9c08a, atmo: 0xffd98a, banded: true, ice: 0.0 }, // tan gas giant
  { low: 0x2a2a4a, high: 0x6a5aa0, atmo: 0x9a7aff, banded: true, ice: 0.0 }, // violet gas giant
  { low: 0x123a3a, high: 0x2aa0a0, atmo: 0x5affff, banded: false, ice: 0.6 }, // teal ice world
]

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
  player: { core: 7, rgb: '252,165,165', glow: '248,113,113' }, // smaller round bolt
  alien: { core: 12, rgb: '134,239,172', glow: '74,222,128' },
  laser: { core: 16, rgb: '236,254,255', glow: '34,211,238' },
}
const BOLT_STREAK_SCALE = 0.05 // px of tracer length per px/s of bolt speed (capped in reconcileBolts)

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

// 3D Borg-style cube: a dark greebled metal cube that tumbles on all three axes, with a
// handful of glowing green lights.
const UFO_SPIN = 0.7 // rad/s base tumble rate
const UFO_HULL_COLOR = 0x6b7280
const UFO_LIGHT_EMISSIVE = 0.22 // small lit "windows" - a soft glow, not a bright block
const ENEMY_Z = -30 // just behind the gameplay plane so the player ship stays on top

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
  let starMat = null
  let starTexture = null
  let nebula = null
  let nebulaMat = null
  let planetGroup = null
  let planetCore = null
  let planetLight = null
  let planetAmbient = null
  let planetActive = false
  let planetNextAt = 0
  let planetVX = 0
  let planetVY = 0

  // Entities / layers.
  let bgMesh = null
  let shipGroup = null // owns position, heading, warp scale
  let shipModel = null // low-poly 3D ship; owns the bank (roll) into turns
  let lastShipAngle = null
  let shipBank = 0
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
  let mergeGeometries = null

  // World (container px, +y down) -> scene (same units, +y up).
  const toScene = (x, y) => [x, viewHeight - y]

  // --- Texture factories -----------------------------------------------------

  // A comet-shaped tracer: a bright round head at the right (+x = direction of travel) with
  // a tapering, fading tail toward the left. The mesh is oriented + offset in reconcileBolts
  // so the head sits at the projectile's leading point.
  const makeBoltTexture = (rgb, glow) => {
    const w = 128
    const h = 40
    const r = h / 2
    const headX = w - r // head centre near the right edge
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')

    // Tail: a triangle from the head width down to a point at the far (left) tail, filled
    // with a gradient that fades to transparent toward the tail.
    const tail = ctx.createLinearGradient(0, 0, w, 0)
    tail.addColorStop(0.0, `rgba(${glow},0)`)
    tail.addColorStop(0.7, `rgba(${glow},0.3)`)
    tail.addColorStop(1.0, `rgba(${glow},0.75)`)
    ctx.fillStyle = tail
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(headX, 1)
    ctx.lineTo(headX, h - 1)
    ctx.closePath()
    ctx.fill()

    // Head: a bright white-hot core fading through the bolt colour.
    const head = ctx.createRadialGradient(headX, h / 2, 0, headX, h / 2, r)
    head.addColorStop(0.0, 'rgba(255,255,255,1)')
    head.addColorStop(0.35, `rgba(${rgb},1)`)
    head.addColorStop(0.7, `rgba(${glow},0.6)`)
    head.addColorStop(1.0, `rgba(${glow},0)`)
    ctx.fillStyle = head
    ctx.fillRect(headX - r, 0, r * 2, h)

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

  // A crisp star point: bright tight core with a very quick falloff (unlike the soft glow
  // sprite, which turned each star into a giant haze).
  const makeStarTexture = () => {
    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0.0, 'rgba(255,255,255,1)')
    g.addColorStop(0.3, 'rgba(255,255,255,0.85)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.15)')
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

    // Background layer: match its render target (device-res) + camera aspect to the viewport.
    const bgPr = renderer.getPixelRatio()
    if (bgRT) bgRT.setSize(Math.max(1, Math.round(viewWidth * bgPr)), Math.max(1, Math.round(viewHeight * bgPr)))
    if (starMat) starMat.uniforms.uPixelRatio.value = bgPr
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

    // A shader nebula on a big plane behind all the stars: layered fbm noise tinted through
    // a deep-space palette, churning slowly. Rendered first (behind the additive stars) and
    // parallaxes gently with the perspective camera like everything else in this scene.
    nebulaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: NEBULA_INTENSITY },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uIntensity;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
          return v;
        }
        void main() {
          vec2 p = vUv * 3.0;
          float t = uTime;
          float n = fbm(p + vec2(t, t * 0.5));
          float n2 = fbm(p * 1.8 + vec2(-t * 0.7, t * 0.35) + 11.0);
          vec3 deep = vec3(0.05, 0.02, 0.12);
          vec3 magenta = vec3(0.34, 0.07, 0.42);
          vec3 blue = vec3(0.07, 0.14, 0.5);
          vec3 col = mix(deep, magenta, smoothstep(0.3, 0.75, n));
          col = mix(col, blue, smoothstep(0.5, 1.0, n2));
          float density = smoothstep(0.35, 0.95, n * 0.6 + n2 * 0.5);
          gl_FragColor = vec4(col, density * uIntensity);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const nebulaSize = BG_FAR * 3
    nebula = new THREE.Mesh(new THREE.PlaneGeometry(nebulaSize, nebulaSize), nebulaMat)
    nebula.position.z = -(BG_FAR + 5) // just in front of the far clip plane, behind the stars
    nebula.renderOrder = -2 // behind the planet (-1)
    nebula.frustumCulled = false
    bgScene.add(nebula)

    const positions = new Float32Array(BG_STAR_COUNT * 3)
    const colors = new Float32Array(BG_STAR_COUNT * 3)
    const sizes = new Float32Array(BG_STAR_COUNT)
    const c = new THREE.Color()
    for (let i = 0; i < BG_STAR_COUNT; i++) {
      const z = -(BG_NEAR + Math.random() * (BG_FAR - BG_NEAR))
      const spread = Math.abs(z) * 1.3
      positions[i * 3] = (Math.random() * 2 - 1) * spread
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * spread
      positions[i * 3 + 2] = z
      // Cool-white to faint gold, with a wide brightness spread.
      c.setHSL(0.55 + (Math.random() - 0.5) * 0.25, Math.random() * 0.35, 0.65 + Math.random() * 0.35)
      const b = 0.35 + Math.random() * 0.6
      colors[i * 3] = c.r * b; colors[i * 3 + 1] = c.g * b; colors[i * 3 + 2] = c.b * b
      // Screen-space size (px): mostly tiny specks, a small minority a bit brighter/bigger.
      // Decoupled from depth so far stars stay crisp points rather than vanishing.
      sizes[i] = Math.random() < 0.9 ? 0.6 + Math.random() * 0.9 : 1.6 + Math.random() * 1.4
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

    starTexture = makeStarTexture()
    starMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: starTexture },
        uPixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute float aSize;
        attribute vec3 aColor;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          gl_PointSize = aSize * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor;
        void main() { gl_FragColor = vec4(vColor, texture2D(map, gl_PointCoord).a); }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    starField = new THREE.Points(geo, starMat)
    starField.frustumCulled = false
    bgScene.add(starField)

    // Render target the bg scene draws into (device-res for crisp points), shown on the
    // ortho background quad.
    const pr = renderer.getPixelRatio()
    bgRT = new THREE.WebGLRenderTarget(Math.max(1, Math.round(viewWidth * pr)), Math.max(1, Math.round(viewHeight * pr)))

    // Full-screen quad in the ortho scene that displays the bg render target. Opaque (it's
    // the backdrop) and never bloomed.
    bgMesh = new THREE.Mesh(unitGeometry, new THREE.MeshBasicMaterial({
      map: bgRT.texture, depthTest: false, depthWrite: false,
    }))
    bgMesh.renderOrder = RENDER_ORDER.bg
    scene.add(bgMesh)
  }

  // The far horizontal extent of the bg frustum at the planet's depth (for entry/exit).
  const planetHalfWidth = () => Math.tan((60 / 2) * (Math.PI / 180)) * PLANET_DEPTH * bgCamera.aspect

  // Bake a procedural surface into the planet's vertex colours: fbm noise blends the palette
  // (or gas-giant latitude bands), with optional polar ice and a little tonal variation.
  const bakePlanetColors = (geo, pal) => {
    const cLow = new THREE.Color(pal.low)
    const cHigh = new THREE.Color(pal.high)
    const white = new THREE.Color(0xffffff)
    const pos = geo.attributes.position
    const colAttr = geo.attributes.color
    const v = new THREE.Vector3()
    const col = new THREE.Color()
    const ox = Math.random() * 50; const oy = Math.random() * 50; const oz = Math.random() * 50
    const freq = 1.4 + Math.random() * 1.6
    const bands = 4 + Math.floor(Math.random() * 5)
    const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t) }
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize()
      let n = 0; let a = 0.5; let f = freq
      for (let o = 0; o < 4; o++) { n += a * noise.noise(v.x * f + ox, v.y * f + oy, v.z * f + oz); f *= 2; a *= 0.5 }
      n = n * 0.5 + 0.5
      const mixv = pal.banded ? ss(-0.6, 0.6, Math.sin(v.y * bands * Math.PI) + (n - 0.5) * 1.2) : ss(0.45, 0.62, n)
      col.copy(cLow).lerp(cHigh, mixv)
      if (pal.ice > 0) col.lerp(white, ss(0.8, 0.96, Math.abs(v.y)) * pal.ice)
      col.multiplyScalar(0.82 + 0.18 * n)
      colAttr.setXYZ(i, col.r, col.g, col.b)
    }
    colAttr.needsUpdate = true
  }

  const buildPlanet = () => {
    planetGroup = new THREE.Group()

    const coreGeo = new THREE.SphereGeometry(1, 48, 32)
    coreGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(coreGeo.attributes.position.count * 3), 3))
    // transparent:true keeps it in the transparent queue (so it isn't forced to draw before
    // the additive stars); a high renderOrder then draws it LAST, so its solid surface
    // covers the stars behind it instead of them blending through.
    planetCore = new THREE.Mesh(coreGeo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0, transparent: true,
    }))
    planetCore.renderOrder = 1
    planetGroup.add(planetCore)

    planetGroup.visible = false
    bgScene.add(planetGroup)

    // Lights just for the planet (stars/nebula are unlit shaders and ignore them). Fixed
    // direction -> a consistent terminator; a little ambient keeps the night side from black.
    planetLight = new THREE.DirectionalLight(0xfff4e6, 2.6)
    planetLight.position.set(-0.6, 0.35, 0.7)
    planetAmbient = new THREE.AmbientLight(0x223044, 0.25)
    bgScene.add(planetLight, planetAmbient)

    planetNextAt = 4 // first crossing a few seconds in
  }

  const respawnPlanet = () => {
    const radius = PLANET_MIN_RADIUS + Math.random() * (PLANET_MAX_RADIUS - PLANET_MIN_RADIUS)
    planetGroup.scale.setScalar(radius)
    const pal = PLANET_PALETTES[(Math.random() * PLANET_PALETTES.length) | 0]
    bakePlanetColors(planetCore.geometry, pal)
    planetCore.rotation.set(Math.random() * 0.6 - 0.3, Math.random() * Math.PI * 2, Math.random() * 0.4 - 0.2)

    const halfH = Math.tan((60 / 2) * (Math.PI / 180)) * PLANET_DEPTH
    const dir = Math.random() < 0.5 ? 1 : -1
    if (prefersReducedMotion) {
      planetVX = 0; planetVY = 0
      planetGroup.position.set(dir * planetHalfWidth() * 0.35, (Math.random() * 2 - 1) * halfH * 0.35, -PLANET_DEPTH)
    } else {
      planetVX = dir * PLANET_SPEED * (0.7 + Math.random() * 0.6)
      planetVY = (Math.random() * 2 - 1) * PLANET_SPEED * 0.15
      planetGroup.position.set(-dir * (planetHalfWidth() + radius + 12), (Math.random() * 2 - 1) * halfH * 0.5, -PLANET_DEPTH)
    }
    planetGroup.visible = true
    planetActive = true
  }

  const updatePlanet = (t, dt) => {
    if (!planetGroup) return
    if (planetActive) {
      planetGroup.position.x += planetVX * dt
      planetGroup.position.y += planetVY * dt
      if (!prefersReducedMotion) planetCore.rotation.y += PLANET_SPIN * dt
      const edge = planetHalfWidth() + planetGroup.scale.x + 20
      const px = planetGroup.position.x
      if ((planetVX > 0 && px > edge) || (planetVX < 0 && px < -edge)) {
        planetActive = false
        planetGroup.visible = false
        planetNextAt = t + PLANET_GAP_MIN + Math.random() * (PLANET_GAP_MAX - PLANET_GAP_MIN)
      }
    } else if (t >= planetNextAt) {
      respawnPlanet()
    }
  }

  const makeGlowMesh = (color, order, bloom = true) => {
    const mesh = new THREE.Mesh(unitGeometry, basicMat({ map: glowTexture, color, blending: THREE.AdditiveBlending }))
    mesh.renderOrder = order
    mesh.visible = false
    if (bloom) enableBloom(mesh)
    scene.add(mesh)
    return mesh
  }

  // A procedural low-poly fighter, built in ~unit local space with its nose toward +Y and
  // "up" toward +Z (the camera). Lit by the asteroid lights already in the scene. Materials
  // are transparent:true so they sort into the same queue as the sprites (by renderOrder),
  // but keep depthTest/Write so the ship self-occludes correctly as it banks.
  const buildShipModel = () => {
    const group = new THREE.Group()
    const geos = []
    const mats = []
    const shipMat = (opts) => {
      const m = new THREE.MeshStandardMaterial({ transparent: true, ...opts })
      mats.push(m)
      return m
    }
    const hull = shipMat({ color: 0x9aa6bf, metalness: 0.5, roughness: 0.45 })
    const accent = shipMat({ color: 0x35507f, metalness: 0.5, roughness: 0.4 })
    const glass = shipMat({ color: 0x081019, metalness: 0.2, roughness: 0.1, emissive: 0x1e7fa0, emissiveIntensity: 0.7 })
    const engineMat = shipMat({ color: 0x1c2230, metalness: 0.3, roughness: 0.6, emissive: 0x37ccff, emissiveIntensity: 0.9 })

    const add = (geo, mat, pos, rot, scale) => {
      geos.push(geo)
      const mesh = new THREE.Mesh(geo, mat)
      if (pos) mesh.position.set(...pos)
      if (rot) mesh.rotation.set(...rot)
      if (scale) mesh.scale.set(...scale)
      mesh.renderOrder = RENDER_ORDER.ship
      group.add(mesh)
    }

    // Fuselage: a 6-sided tapered body (cone points +Y by default).
    add(new THREE.ConeGeometry(0.16, 0.95, 6), hull, [0, 0, 0.02])
    // Swept delta wings (thin boxes rolled up into a dihedral and angled back).
    add(new THREE.BoxGeometry(0.5, 0.34, 0.045), accent, [-0.26, -0.08, 0], [0, 0.35, 0.5])
    add(new THREE.BoxGeometry(0.5, 0.34, 0.045), accent, [0.26, -0.08, 0], [0, -0.35, -0.5])
    // Cockpit dome, forward and on top.
    add(new THREE.SphereGeometry(0.1, 12, 8), glass, [0, 0.12, 0.11], null, [1, 1.3, 0.7])
    // Twin engine nozzles at the tail.
    add(new THREE.CylinderGeometry(0.055, 0.075, 0.22, 8), engineMat, [-0.12, -0.44, 0.02])
    add(new THREE.CylinderGeometry(0.055, 0.075, 0.22, 8), engineMat, [0.12, -0.44, 0.02])

    group.userData.geos = geos
    group.userData.mats = mats
    return group
  }

  const buildShip = () => {
    shipHitGlow = makeGlowMesh(SHIP_HIT_COLOR, RENDER_ORDER.shipGlow)
    // The shield aura is a big, persistent disc - keep it off the bloom layer so it reads as
    // a soft additive glow rather than blowing out into a giant cyan halo.
    shipShieldGlow = makeGlowMesh(SHIP_SHIELD_COLOR, RENDER_ORDER.shipGlow, false)

    shipGroup = new THREE.Group()
    shipModel = buildShipModel()
    shipGroup.add(shipModel)
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
    // Sit the rocks well behind the gameplay plane (ship is at z~0), with nearer/bigger ones
    // less deep than far/small ones. Ortho scale ignores z, so this only affects occlusion:
    // rocks recede + overlap each other by depth, but always render behind the ship + trail.
    const bgZ = -(160 + (1 - depth) * 260) // -160 (near) .. -420 (far)
    a.mesh.position.set(
      initial ? Math.random() * viewWidth : (dir > 0 ? -margin : viewWidth + margin),
      Math.random() * viewHeight,
      bgZ
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
  // A procedural Borg-style cube (~0.58 across in local space): a dark greebled metal cube
  // with a scatter of small boxes on its faces, plus a few glowing green light blocks. The
  // cube + hull greebles merge into one geometry and the lights into another (2 draw calls),
  // wrapped in a spin group so it tumbles in 3D. Materials are per-enemy for tint/dim.
  const makeEnemyBody = () => {
    const body = new THREE.Group()
    const spin = new THREE.Group()
    body.add(spin)

    const mats = []
    const mkMat = (opts) => {
      const m = new THREE.MeshStandardMaterial({ transparent: true, ...opts })
      mats.push(m)
      return m
    }
    const hullBase = new THREE.Color(UFO_HULL_COLOR)
    // Low metalness (metals go black with no environment map) + a faint emissive lift so the
    // shadowed faces don't read as pure black.
    const hull = mkMat({ metalness: 0.18, roughness: 0.7, emissive: new THREE.Color(0x2a2f37), emissiveIntensity: 0.35 })
    hull.color.copy(hullBase)
    const lightMat = mkMat({ color: 0x061006, metalness: 0.3, roughness: 0.5, emissive: new THREE.Color(0x39ff14), emissiveIntensity: 1.0 })

    const S = 0.58
    const half = S / 2
    const faces = [['x', 1], ['x', -1], ['y', 1], ['y', -1], ['z', 1], ['z', -1]]
    // Thin panels (thin axis = local +z) laid flat on the faces: fine surface detail that
    // keeps the crisp cube silhouette. The lights are small cubes.
    const greebleBases = [
      new THREE.BoxGeometry(0.16, 0.10, 0.06),
      new THREE.BoxGeometry(0.10, 0.18, 0.05),
      new THREE.BoxGeometry(0.07, 0.07, 0.07),
      new THREE.BoxGeometry(0.20, 0.06, 0.05),
      new THREE.BoxGeometry(0.12, 0.12, 0.05),
    ]
    // Small, thin windows flush on the faces (like lit windows on the hull).
    const lightBases = [
      new THREE.BoxGeometry(0.035, 0.025, 0.02),
      new THREE.BoxGeometry(0.022, 0.045, 0.02),
      new THREE.BoxGeometry(0.03, 0.03, 0.02),
    ]

    const _q = new THREE.Quaternion()
    const _spin = new THREE.Quaternion()
    const _pos = new THREE.Vector3()
    const _scl = new THREE.Vector3(1, 1, 1)
    const _m = new THREE.Matrix4()
    const _euler = new THREE.Euler()
    const _zAxis = new THREE.Vector3(0, 0, 1)
    // Clone a base, orient its thin (+z) axis to the chosen face normal (plus a random 90°
    // in-plane turn) and seat it on that face, flush with a little relief.
    const placeGreeble = (bases) => {
      const g = bases[(Math.random() * bases.length) | 0].clone()
      const [axis, sign] = faces[(Math.random() * 6) | 0]
      const u = (Math.random() * 2 - 1) * half * 0.8
      const v = (Math.random() * 2 - 1) * half * 0.8
      if (axis === 'x') { _euler.set(0, sign * Math.PI / 2, 0); _pos.set(sign * half, u, v) } else if (axis === 'y') { _euler.set(-sign * Math.PI / 2, 0, 0); _pos.set(u, sign * half, v) } else { _euler.set(sign < 0 ? Math.PI : 0, 0, 0); _pos.set(u, v, sign * half) }
      _q.setFromEuler(_euler)
      _spin.setFromAxisAngle(_zAxis, Math.random() < 0.5 ? 0 : Math.PI / 2)
      _q.multiply(_spin)
      g.applyMatrix4(_m.compose(_pos, _q, _scl))
      return g
    }

    const hullGeos = [new THREE.BoxGeometry(S, S, S)]
    const lightGeos = []
    for (let i = 0; i < 96; i++) hullGeos.push(placeGreeble(greebleBases))
    for (let i = 0; i < 34; i++) lightGeos.push(placeGreeble(lightBases))

    const hullGeo = mergeGeometries(hullGeos)
    const lightGeo = mergeGeometries(lightGeos)
    hullGeos.forEach((g) => g.dispose())
    lightGeos.forEach((g) => g.dispose())
    greebleBases.forEach((g) => g.dispose())
    lightBases.forEach((g) => g.dispose())

    const hullMesh = new THREE.Mesh(hullGeo, hull)
    const lightMesh = new THREE.Mesh(lightGeo, lightMat)
    enableBloom(lightMesh) // the green lights glow
    spin.add(hullMesh, lightMesh)

    body.userData.meshes = [hullMesh, lightMesh]
    body.userData.spin = spin
    body.userData.hull = hull
    body.userData.lightMat = lightMat
    body.userData.hullBase = hullBase
    body.userData.geos = [hullGeo, lightGeo]
    body.userData.mats = mats
    return body
  }

  const makeEnemy = () => {
    const body = makeEnemyBody()
    const track = new THREE.Mesh(unitGeometry, basicMat({ color: 0x000000, opacity: 0.45 }))
    track.renderOrder = RENDER_ORDER.healthTrack
    const fill = new THREE.Mesh(unitGeometry, basicMat({}))
    fill.renderOrder = RENDER_ORDER.healthFill
    scene.add(body, track, fill)
    return { body, track, fill }
  }

  const disposeEnemyEntry = (e) => {
    scene.remove(e.body, e.track, e.fill)
    e.body.userData.geos?.forEach((g) => g.dispose())
    e.body.userData.mats?.forEach((m) => m.dispose())
    e.track.material.dispose()
    e.fill.material.dispose()
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
  const renderBackground = (t, dt) => {
    if (!bgScene || !bgCamera || !bgRT) return

    starField.rotation.z += BG_DRIFT * dt
    if (nebulaMat && !prefersReducedMotion) nebulaMat.uniforms.uTime.value = t * NEBULA_SPEED
    updatePlanet(t, dt)

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

  const updateShip = (t, dt) => {
    const s = game.getShipRenderState()
    shipGroup.visible = s.visible
    shipHitGlow.visible = s.visible && s.hit
    shipShieldGlow.visible = s.visible && s.shielded

    // Jolt on the rising edge of the ship's hit flash.
    if (s.visible && s.hit && !lastShipHit) addShake(10)
    lastShipHit = s.visible && s.hit

    if (!s.visible) {
      lastShipX = lastShipY = null
      lastShipAngle = null
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
    // CSS scale(1/stretch, stretch) - warp squash-and-stretch. z scales too so the model
    // keeps its proportions (the warp only squashes in the screen plane).
    shipGroup.scale.set(SHIP_SIZE / s.stretch, SHIP_SIZE * s.stretch, SHIP_SIZE)

    // Bank into turns: roll the model around its forward axis, scaled by turn rate.
    let bankTarget = 0
    if (lastShipAngle != null && dt > 0) {
      let d = s.angle - lastShipAngle
      while (d > 180) d -= 360
      while (d < -180) d += 360
      const angVel = d / dt // deg/s
      bankTarget = Math.max(-SHIP_MAX_BANK, Math.min(SHIP_MAX_BANK, -angVel * SHIP_BANK_PER_DEGPS))
    }
    lastShipAngle = s.angle
    shipBank += (bankTarget - shipBank) * (1 - Math.exp(-SHIP_BANK_RATE * dt))
    shipModel.rotation.y = shipBank

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
      const bp = clamp01((t - beamMesh.userData.start) / BEAM_DURATION)
      const env = bp < 0.25 ? lerp(0.2, 1, bp / 0.25) : lerp(1, 0, (bp - 0.25) / 0.75)
      // Energized flicker: fast, slightly chaotic jitter in brightness and thickness so the
      // beam crackles rather than reading as a flat quad.
      const flick = 0.7 + 0.3 * Math.abs(Math.sin(t * 60) * Math.cos(t * 23 + 1))
      beamMesh.scale.set(Math.hypot(x2 - x1, y2 - y1), BEAM_THICKNESS * (0.85 + 0.35 * flick), 1)
      beamMesh.material.opacity = env * flick
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
      const ud = body.userData
      body.position.set(...toScene(enemy.x + size / 2, enemy.y + size / 2), ENEMY_Z)
      // renderOrder is per-mesh (a Group's doesn't propagate); the cube tumbles on all axes.
      for (const m of ud.meshes) m.renderOrder = enemy.zIndex
      ud.spin.rotation.x += UFO_SPIN * 0.55 * dt
      ud.spin.rotation.y += UFO_SPIN * dt
      ud.spin.rotation.z += UFO_SPIN * 0.3 * dt

      if (enemy.destroyed) {
        if (ud.destroyStart === undefined) ud.destroyStart = t
        const p = clamp01((t - ud.destroyStart) / DESTROY_DURATION)
        body.scale.setScalar(size * sampleKeyframes(DESTROY_PULSE, p))
        ud.hull.color.set(UFO_DESTROYED_COLOR)
      } else {
        ud.destroyStart = undefined
        body.scale.setScalar(size)
        if (enemy.hit) ud.hull.color.set(UFO_HIT_COLOR)
        else ud.hull.color.copy(ud.hullBase).multiplyScalar(dim)
      }
      // Fade the emissive lights with depth too (scaled down so they bloom only gently).
      ud.lightMat.emissiveIntensity = dim * UFO_LIGHT_EMISSIVE

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
        disposeEnemyEntry(e)
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
      const width = core * 2
      // Comet tracer: length scales with speed (capped). The head (+x of the texture) sits at
      // the projectile's leading point and the tail trails behind along -velocity.
      const speed = Math.hypot(p.vx, p.vy)
      const len = Math.min(Math.max(speed * BOLT_STREAK_SCALE, width), width * 4)
      const angle = speed > 0.001 ? Math.atan2(-p.vy, p.vx) : 0 // scene +y is up, so flip vy
      const [hx, hy] = toScene(p.x + core / 2, p.y + core / 2)
      mesh.position.set(hx - Math.cos(angle) * len * 0.5, hy - Math.sin(angle) * len * 0.5, 0)
      mesh.rotation.z = angle
      mesh.scale.set(len, width, 1)
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
          // Chance to drop a pickup at the break point (convert scene coords back to world).
          game.maybeDropFromAsteroid?.(px, viewHeight - py)
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
      updateShip(t, dt)
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
    renderBackground(t, dt)

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

    // Coherent noise (asteroids) + geometry merge util (Borg-cube UFOs) - also lazy.
    const [{ ImprovedNoise }, bgu] = await Promise.all([
      import('three/examples/jsm/math/ImprovedNoise.js'),
      import('three/examples/jsm/utils/BufferGeometryUtils.js'),
    ])
    if (renderer || !active.value || stageCanvas.value !== canvas) return
    noise = new ImprovedNoise()
    mergeGeometries = bgu.mergeGeometries

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

    enterpriseTexture = load(enterpriseUrl)
    beamTexture = makeBeamTexture()
    glowTexture = makeGlowTexture()

    boltTextures.player = makeBoltTexture(BOLT_STYLES.player.rgb, BOLT_STYLES.player.glow)
    boltTextures.alien = makeBoltTexture(BOLT_STYLES.alien.rgb, BOLT_STYLES.alien.glow)
    boltTextures.laser = makeBoltTexture(BOLT_STYLES.laser.rgb, BOLT_STYLES.laser.glow)

    scratchColor = new THREE.Color()
    prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    buildBackground()
    buildPlanet()
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
      e.body.userData.geos?.forEach((g) => g.dispose())
      e.body.userData.mats?.forEach((m) => m.dispose())
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
    if (shipModel) {
      shipModel.userData.geos?.forEach((g) => g.dispose())
      shipModel.userData.mats?.forEach((m) => m.dispose())
    }
    bgMesh = shipGroup = shipModel = null
    lastShipAngle = null
    shipBank = 0
    shipHitGlow = shipShieldGlow = allyGroup = allyBody = beamMesh = null

    // Perspective background layer.
    if (starField) {
      starField.geometry.dispose()
      starField.material.dispose()
    }
    if (nebula) {
      nebula.geometry.dispose()
      nebula.material.dispose()
    }
    if (planetGroup) {
      planetGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose() })
    }
    starTexture?.dispose?.()
    bgRT?.dispose?.()
    bgScene = bgCamera = bgRT = starField = starMat = starTexture = nebula = nebulaMat = null
    planetGroup = planetCore = planetLight = planetAmbient = null
    planetActive = false

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
    mergeGeometries = null

    if (particleGeom) particleGeom.dispose()
    if (particleMat) particleMat.dispose()
    particlePoints = particleGeom = particleMat = null
    scratchColor = null
    pCursor = 0
    lastShipX = lastShipY = null
    shakeMag = 0
    lastShipHit = false

    if (unitGeometry) unitGeometry.dispose()
    for (const tex of [enterpriseTexture, beamTexture, glowTexture]) {
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
    enterpriseTexture = beamTexture = glowTexture = null
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
