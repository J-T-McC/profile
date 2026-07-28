import { onBeforeUnmount, ref, watch } from 'vue'
import * as THREE from 'three'
import { POWERUP_STATE } from '@/hooks/useSpaceGame'
import ufoUrl from '@/assets/ufo.svg'
import enterpriseUrl from '@/assets/enterprise.svg'

// Phase 2-3 Three.js renderer. Draws every world entity - ship, UFOs, projectiles
// (Phase 2), plus the ally starship, its phaser beam, power-up badges and the
// scrolling starfield (Phase 3) - as textured quads in a WebGL canvas, reading the
// game's reactive state (useSpaceGame) each frame. Only DOM overlays remain in
// History.vue (HUD, radar, UFO health bars, warp/explosion effects, arcade modals).
//
// World space matches the game logic: container pixels, origin top-left, +y down.
// The orthographic camera is 1 unit = 1 px; toScene() flips only Y. Layering is by
// renderOrder (depth test off), mirroring the old CSS z-index stack.

const SHIP_SIZE = 40 // matches SHIP_SIZE in useSpaceGame (Tailwind w-10 h-10)
const SHIP_TEXTURE_URL =
  'https://res.cloudinary.com/ddaji66m6/image/upload/v1612058700/portfolio/spaceship_tlg2od.png'
const STARS_URL =
  'https://res.cloudinary.com/ddaji66m6/image/upload/v1611800904/portfolio/stars_vcimcd.png'
const TWINKLING_URL =
  'https://res.cloudinary.com/ddaji66m6/image/upload/v1611800910/portfolio/twinkling_qmxcrl.png'

const ALLY_SIZE = 64 // matches ALLY_SIZE in useSpaceGame
const ALLY_HEIGHT = ALLY_SIZE * 1.2

const BEAM_COLOR = 0xfdba74 // phaser-beam-line stroke
const BEAM_THICKNESS = 12 // quad height; the baked gradient keeps the visible core thin

// Projectile look, derived from SvgWeapon.vue's CSS. core = visible dot size;
// the quad is drawn larger so the baked-in radial glow has room to fall off.
const BOLT_STYLES = {
  player: { core: 12, rgb: '252,165,165', glow: '248,113,113' },
  alien: { core: 12, rgb: '134,239,172', glow: '74,222,128' },
  laser: { core: 16, rgb: '236,254,255', glow: '34,211,238' },
}

// Mirrors the old CSS z-index stack.
const RENDER_ORDER = {
  bg: -11,
  stars: -10,
  twinkle: -9,
  ally: 17,
  beam: 18,
  powerUp: 19,
  bolt: 20,
  shipBack: 24,
  ship: 25,
} // enemies use their own zIndex (1 or 12)

// Twinkling drift, matching @keyframes move-twink-back (-10000px, 5000px over 300s).
const TWINKLE_VX = -10000 / 300 // px/s
const TWINKLE_VY = 5000 / 300 // px/s

export default function useThreeStage (active, game) {
  const stageCanvas = ref(null)

  let renderer = null
  let scene = null
  let camera = null
  let unitGeometry = null
  let resizeObserver = null
  let rafId = null
  let startTime = 0
  let viewWidth = 1
  let viewHeight = 1

  // Shared textures.
  let shipTexture = null
  let ufoTexture = null
  let enterpriseTexture = null
  let starsTexture = null
  let twinkleTexture = null
  let beamTexture = null
  const boltTextures = {} // player | alien | laser -> CanvasTexture
  const powerUpTextures = new Map() // `${label}|${color}` -> { tex, w, h }

  // Entities / layers.
  let bgMesh = null
  let starsMesh = null
  let twinkleMesh = null
  let shipGroup = null
  let allyMesh = null
  let beamMesh = null
  const enemyMeshes = new Map() // enemy.id -> Mesh
  const boltMeshes = new Map() // projectile.id -> Mesh
  const powerUpMeshes = new Map() // powerUp.id -> Mesh

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
    const fontPx = 15
    const font = `${fontPx}px "VT323", monospace`

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

  const fitBackgroundQuad = (mesh, texture) => {
    if (!mesh) return
    mesh.position.set(viewWidth / 2, viewHeight / 2, 0)
    mesh.scale.set(viewWidth, viewHeight, 1)
    // Tile at the image's native pixel size, like CSS `repeat`.
    const img = texture?.image
    if (img && img.width) {
      texture.repeat.set(viewWidth / img.width, viewHeight / img.height)
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

    if (bgMesh) {
      bgMesh.position.set(viewWidth / 2, viewHeight / 2, 0)
      bgMesh.scale.set(viewWidth, viewHeight, 1)
    }
    fitBackgroundQuad(starsMesh, starsTexture)
    fitBackgroundQuad(twinkleMesh, twinkleTexture)
  }

  // --- Builders --------------------------------------------------------------

  const basicMat = (opts) =>
    new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, ...opts })

  const buildStarfield = () => {
    bgMesh = new THREE.Mesh(unitGeometry, basicMat({ color: 0x000000 }))
    bgMesh.renderOrder = RENDER_ORDER.bg
    scene.add(bgMesh)

    starsMesh = new THREE.Mesh(unitGeometry, basicMat({ map: starsTexture }))
    starsMesh.renderOrder = RENDER_ORDER.stars
    scene.add(starsMesh)

    twinkleMesh = new THREE.Mesh(unitGeometry, basicMat({ map: twinkleTexture, opacity: 0.6 }))
    twinkleMesh.renderOrder = RENDER_ORDER.twinkle
    scene.add(twinkleMesh)
  }

  const buildShip = () => {
    const group = new THREE.Group()
    const back = new THREE.Mesh(unitGeometry, basicMat({ color: 0xffffff }))
    back.renderOrder = RENDER_ORDER.shipBack
    const body = new THREE.Mesh(unitGeometry, basicMat({ map: shipTexture }))
    body.renderOrder = RENDER_ORDER.ship
    group.add(back, body)
    group.visible = false
    scene.add(group)
    return group
  }

  const buildAlly = () => {
    allyMesh = new THREE.Mesh(unitGeometry, basicMat({ map: enterpriseTexture }))
    allyMesh.renderOrder = RENDER_ORDER.ally
    allyMesh.scale.set(ALLY_SIZE, ALLY_HEIGHT, 1)
    allyMesh.visible = false
    scene.add(allyMesh)

    beamMesh = new THREE.Mesh(unitGeometry, basicMat({ map: beamTexture, color: BEAM_COLOR, blending: THREE.AdditiveBlending }))
    beamMesh.renderOrder = RENDER_ORDER.beam
    beamMesh.visible = false
    scene.add(beamMesh)
  }

  const makeEnemyMesh = () => {
    const mesh = new THREE.Mesh(unitGeometry, basicMat({ map: ufoTexture }))
    scene.add(mesh)
    return mesh
  }

  const makeBoltMesh = (kind) => {
    const mesh = new THREE.Mesh(
      unitGeometry,
      basicMat({ map: boltTextures[kind], blending: THREE.AdditiveBlending })
    )
    mesh.renderOrder = RENDER_ORDER.bolt
    mesh.userData.kind = kind
    scene.add(mesh)
    return mesh
  }

  const makePowerUpMesh = () => {
    const mesh = new THREE.Mesh(unitGeometry, basicMat({}))
    mesh.renderOrder = RENDER_ORDER.powerUp
    scene.add(mesh)
    return mesh
  }

  // --- Per-frame updates -----------------------------------------------------

  const updateStarfield = (t) => {
    if (!twinkleTexture?.image?.width) return
    twinkleTexture.offset.set(
      (t * TWINKLE_VX) / twinkleTexture.image.width,
      (t * TWINKLE_VY) / twinkleTexture.image.height
    )
  }

  const updateShip = () => {
    const s = game.getShipRenderState()
    shipGroup.visible = s.visible
    if (!s.visible) return
    shipGroup.position.set(...toScene(s.x + SHIP_SIZE / 2, s.y + SHIP_SIZE / 2), 0)
    // CSS rotate() is clockwise in screen space; scene +y is up, so negate.
    shipGroup.rotation.z = -THREE.MathUtils.degToRad(s.angle)
    // CSS scale(1/stretch, stretch) - warp squash-and-stretch.
    shipGroup.scale.set(SHIP_SIZE / s.stretch, SHIP_SIZE * s.stretch, 1)
  }

  const updateAlly = () => {
    const a = game.ally
    allyMesh.visible = a.active
    beamMesh.visible = a.active && a.beamActive
    if (!a.active) return
    allyMesh.position.set(...toScene(a.x + ALLY_SIZE / 2, a.y + ALLY_HEIGHT / 2), 0)
    allyMesh.rotation.z = -THREE.MathUtils.degToRad(a.angle)

    if (a.beamActive) {
      const [x1, y1] = toScene(a.beamX1, a.beamY1)
      const [x2, y2] = toScene(a.beamX2, a.beamY2)
      beamMesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0)
      beamMesh.rotation.z = Math.atan2(y2 - y1, x2 - x1)
      beamMesh.scale.set(Math.hypot(x2 - x1, y2 - y1), BEAM_THICKNESS, 1)
    }
  }

  const reconcileEnemies = () => {
    const enemies = game.enemies
    for (const enemy of enemies) {
      let mesh = enemyMeshes.get(enemy.id)
      if (!mesh) {
        mesh = makeEnemyMesh()
        enemyMeshes.set(enemy.id, mesh)
      }
      mesh.visible = enemy.visible
      if (!enemy.visible) continue
      mesh.position.set(...toScene(enemy.x + enemy.size / 2, enemy.y + enemy.size / 2), 0)
      mesh.scale.set(enemy.size, enemy.size, 1)
      mesh.renderOrder = enemy.zIndex // 1 or 12; closer UFOs (>=60px) in front
      mesh.material.color.setScalar(Math.min(enemy.brightness / 100, 1)) // depth dimming
    }
    for (const [id, mesh] of enemyMeshes) {
      if (!enemies.some((e) => e.id === id)) {
        scene.remove(mesh)
        mesh.material.dispose()
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
      const floating = p.state === POWERUP_STATE.FLOATING
      mesh.visible = floating
      if (!floating) continue
      const { tex, w, h } = getPowerUpTexture(p.label, p.color)
      mesh.material.map = tex
      mesh.position.set(...toScene(p.x, p.y), 0) // powerUp x/y is the centre
      mesh.scale.set(w * pulse, h * pulse, 1)
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
    if (!startTime) startTime = time
    const t = (time - startTime) / 1000
    if (game) {
      updateStarfield(t)
      updateShip()
      updateAlly()
      reconcileEnemies()
      reconcileBolts()
      reconcilePowerUps(t)
    }
    renderer.render(scene, camera)
    rafId = requestAnimationFrame(tick)
  }

  // --- Lifecycle -------------------------------------------------------------

  const start = () => {
    const canvas = stageCanvas.value
    if (!canvas || renderer) return

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    scene = new THREE.Scene()
    camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 10)
    camera.position.z = 5

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
    // Tiled backgrounds: repeat wrap + refit once we know the image size.
    starsTexture = load(STARS_URL, () => fitBackgroundQuad(starsMesh, starsTexture))
    starsTexture.wrapS = starsTexture.wrapT = THREE.RepeatWrapping
    twinkleTexture = load(TWINKLING_URL, () => fitBackgroundQuad(twinkleMesh, twinkleTexture))
    twinkleTexture.wrapS = twinkleTexture.wrapT = THREE.RepeatWrapping
    beamTexture = makeBeamTexture()

    boltTextures.player = makeBoltTexture(BOLT_STYLES.player.rgb, BOLT_STYLES.player.glow)
    boltTextures.alien = makeBoltTexture(BOLT_STYLES.alien.rgb, BOLT_STYLES.alien.glow)
    boltTextures.laser = makeBoltTexture(BOLT_STYLES.laser.rgb, BOLT_STYLES.laser.glow)

    buildStarfield()
    shipGroup = buildShip()
    buildAlly()

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

    for (const mesh of enemyMeshes.values()) mesh.material.dispose()
    for (const mesh of boltMeshes.values()) mesh.material.dispose()
    for (const mesh of powerUpMeshes.values()) mesh.material.dispose()
    enemyMeshes.clear()
    boltMeshes.clear()
    powerUpMeshes.clear()

    for (const mesh of [bgMesh, starsMesh, twinkleMesh, allyMesh, beamMesh]) {
      if (mesh) mesh.material.dispose()
    }
    if (shipGroup) shipGroup.children.forEach((c) => c.material.dispose())
    bgMesh = starsMesh = twinkleMesh = allyMesh = beamMesh = shipGroup = null

    if (unitGeometry) unitGeometry.dispose()
    for (const t of [shipTexture, ufoTexture, enterpriseTexture, starsTexture, twinkleTexture, beamTexture]) {
      if (t) t.dispose()
    }
    Object.values(boltTextures).forEach((t) => t.dispose())
    for (const k of Object.keys(boltTextures)) delete boltTextures[k]
    for (const { tex } of powerUpTextures.values()) tex.dispose()
    powerUpTextures.clear()

    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss?.()
    }
    renderer = scene = camera = unitGeometry = null
    shipTexture = ufoTexture = enterpriseTexture = starsTexture = twinkleTexture = beamTexture = null
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
