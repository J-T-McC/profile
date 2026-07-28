import { onBeforeUnmount, ref, watch } from 'vue'
import * as THREE from 'three'
import ufoUrl from '@/assets/ufo.svg'

// Phase 2 Three.js renderer. Draws the gameplay-critical entities - the player
// ship, the UFOs, and the projectiles - as textured quads in a WebGL canvas,
// reading the game's reactive state (useSpaceGame) once per frame. The DOM/CSS
// versions of these three are removed from History.vue; everything else (HUD,
// radar, ally, power-ups, effects, starfield) stays DOM for now.
//
// World space matches the game logic: container pixels, origin top-left, +y down.
// The orthographic camera is 1 unit = 1 px; toScene() flips only Y so world
// coordinates map straight onto the scene. Layering is controlled purely by
// renderOrder (depth test off), mirroring the old CSS z-index stack.

const SHIP_SIZE = 40 // matches SHIP_SIZE in useSpaceGame (Tailwind w-10 h-10)
const SHIP_TEXTURE_URL =
  'https://res.cloudinary.com/ddaji66m6/image/upload/v1612058700/portfolio/spaceship_tlg2od.png'

// Projectile look, derived from SvgWeapon.vue's CSS. core = visible dot size;
// the quad is drawn larger so the baked-in radial glow has room to fall off.
const BOLT_STYLES = {
  player: { core: 12, rgb: '252,165,165', glow: '248,113,113' },
  alien: { core: 12, rgb: '134,239,172', glow: '74,222,128' },
  laser: { core: 16, rgb: '236,254,255', glow: '34,211,238' },
}

const RENDER_ORDER = { bolt: 20, shipBack: 24, ship: 25 } // enemies use their zIndex (1 or 12)

export default function useThreeStage (active, game) {
  const stageCanvas = ref(null)

  let renderer = null
  let scene = null
  let camera = null
  let unitGeometry = null
  let resizeObserver = null
  let rafId = null
  let viewWidth = 1
  let viewHeight = 1

  // Shared textures.
  let shipTexture = null
  let ufoTexture = null
  const boltTextures = {} // player | alien | laser -> CanvasTexture

  // Entities.
  let shipGroup = null
  const enemyMeshes = new Map() // enemy.id -> Mesh
  const boltMeshes = new Map() // projectile.id -> Mesh

  // World (container px, +y down) -> scene (same units, +y up).
  const toScene = (x, y) => [x, viewHeight - y]

  // A soft radial gradient (hot-white core -> colour -> transparent) baked to a
  // texture, so an additively-blended quad reads as a glowing bolt.
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
  }

  const buildShip = () => {
    const group = new THREE.Group()
    // White backing quad to match the ship <img>'s bg-white.
    const back = new THREE.Mesh(
      unitGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false })
    )
    back.renderOrder = RENDER_ORDER.shipBack
    const body = new THREE.Mesh(
      unitGeometry,
      new THREE.MeshBasicMaterial({ map: shipTexture, transparent: true, depthTest: false, depthWrite: false })
    )
    body.renderOrder = RENDER_ORDER.ship
    group.add(back, body)
    group.visible = false
    scene.add(group)
    return group
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

  const makeEnemyMesh = () => {
    const mesh = new THREE.Mesh(
      unitGeometry,
      new THREE.MeshBasicMaterial({ map: ufoTexture, transparent: true, depthTest: false, depthWrite: false })
    )
    scene.add(mesh)
    return mesh
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
      mesh.renderOrder = enemy.zIndex // 1 or 12, closer UFOs (>=60px) in front
      // brightness 40..100% -> greyscale tint, cheaply reproducing the depth cue.
      mesh.material.color.setScalar(Math.min(enemy.brightness / 100, 1))
    }
    // Drop meshes for enemies no longer in the pool.
    for (const [id, mesh] of enemyMeshes) {
      if (!enemies.some((e) => e.id === id)) {
        scene.remove(mesh)
        mesh.material.dispose()
        enemyMeshes.delete(id)
      }
    }
  }

  const boltKind = (p) => (p.laser ? 'laser' : p.owner === 'alien' ? 'alien' : 'player')

  const makeBoltMesh = (kind) => {
    const mesh = new THREE.Mesh(
      unitGeometry,
      new THREE.MeshBasicMaterial({
        map: boltTextures[kind],
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    mesh.renderOrder = RENDER_ORDER.bolt
    mesh.userData.kind = kind
    scene.add(mesh)
    return mesh
  }

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
      const footprint = core * 2 // room for the glow
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

  const tick = () => {
    if (!renderer) return
    if (game) {
      updateShip()
      reconcileEnemies()
      reconcileBolts()
    }
    renderer.render(scene, camera)
    rafId = requestAnimationFrame(tick)
  }

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
    shipTexture = loader.load(SHIP_TEXTURE_URL)
    shipTexture.colorSpace = THREE.SRGBColorSpace
    ufoTexture = loader.load(ufoUrl)
    ufoTexture.colorSpace = THREE.SRGBColorSpace

    boltTextures.player = makeBoltTexture(BOLT_STYLES.player.rgb, BOLT_STYLES.player.glow)
    boltTextures.alien = makeBoltTexture(BOLT_STYLES.alien.rgb, BOLT_STYLES.alien.glow)
    boltTextures.laser = makeBoltTexture(BOLT_STYLES.laser.rgb, BOLT_STYLES.laser.glow)

    shipGroup = buildShip()

    sizeToContainer()
    resizeObserver = new ResizeObserver(sizeToContainer)
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)

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
    enemyMeshes.clear()
    boltMeshes.clear()
    if (shipGroup) shipGroup.children.forEach((c) => c.material.dispose())
    shipGroup = null
    if (unitGeometry) unitGeometry.dispose()
    if (shipTexture) shipTexture.dispose()
    if (ufoTexture) ufoTexture.dispose()
    Object.values(boltTextures).forEach((t) => t.dispose())
    for (const k of Object.keys(boltTextures)) delete boltTextures[k]
    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss?.()
    }
    renderer = scene = camera = unitGeometry = shipTexture = ufoTexture = null
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
