import { onBeforeUnmount, ref, watch } from 'vue'
import * as THREE from 'three'

// Phase 0-1 Three.js stage. Proves the rendering stack coexists with the DOM
// game (Phase 0) and shares its coordinate space (Phase 1).
//
// World space (matching the game logic in useSpaceGame): container pixels, origin
// at the top-left, +x right, +y down. The orthographic camera is sized so one
// scene unit == one CSS pixel, and toScene() flips only the Y axis so world
// coordinates map straight onto the scene with no per-entity conversion. That's
// the coordinate bridge the rest of the port builds on.
//
// Verification hook: the debug sprite tracks the cursor (in world coords), so you
// can confirm the screen -> world -> scene round-trip lines up exactly - including
// in fullscreen, where the container's screen origin moves.
export default function useThreeStage (active) {
  const stageCanvas = ref(null)

  let renderer = null
  let scene = null
  let camera = null
  let sprite = null
  let texture = null
  let material = null
  let resizeObserver = null
  let pointerTarget = null
  let rafId = null
  let startTime = 0
  let viewWidth = 1
  let viewHeight = 1

  // Latest cursor position in world coords, or null before the first move.
  let pointerWorld = null

  // World (container px, +y down) -> scene (same units, +y up). The camera places
  // the origin at the bottom-left, so we flip Y; X passes straight through.
  const toScene = (x, y) => [x, viewHeight - y]

  const sizeToContainer = () => {
    const canvas = stageCanvas.value
    if (!canvas || !renderer || !camera) return
    const parent = canvas.parentElement
    viewWidth = parent?.clientWidth || canvas.clientWidth || 1
    viewHeight = parent?.clientHeight || canvas.clientHeight || 1

    // Cap DPR so retina/4K fullscreen doesn't tank the fill rate.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(viewWidth, viewHeight, false)

    // 1 unit == 1 px, origin bottom-left (+y up); toScene() maps the game's
    // top-left / +y-down world coords into this.
    camera.left = 0
    camera.right = viewWidth
    camera.top = viewHeight
    camera.bottom = 0
    camera.updateProjectionMatrix()
  }

  const onPointerMove = (event) => {
    const canvas = stageCanvas.value
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    pointerWorld = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const tick = (time) => {
    if (!renderer) return
    if (!startTime) startTime = time
    const t = (time - startTime) / 1000

    // Track the cursor once it has moved (proving the coordinate bridge); until
    // then, orbit the centre so there's obvious life on screen.
    if (pointerWorld) {
      sprite.position.set(...toScene(pointerWorld.x, pointerWorld.y), 0)
    } else {
      const r = Math.min(viewWidth, viewHeight) * 0.25
      sprite.position.set(
        ...toScene(viewWidth / 2 + Math.cos(t) * r, viewHeight / 2 + Math.sin(t * 0.9) * r),
        0
      )
    }

    renderer.render(scene, camera)
    rafId = requestAnimationFrame(tick)
  }

  const start = () => {
    const canvas = stageCanvas.value
    if (!canvas || renderer) return

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    scene = new THREE.Scene()

    // Placeholder frustum; real extents get set by sizeToContainer() below.
    camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 10)
    camera.position.z = 5

    // Reuse the real ship art to prove the texture pipeline end to end.
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    texture = loader.load(
      'https://res.cloudinary.com/ddaji66m6/image/upload/v1612058700/portfolio/spaceship_tlg2od.png'
    )
    texture.colorSpace = THREE.SRGBColorSpace

    // Tinted + translucent so it reads as a debug marker, not a second ship.
    material = new THREE.SpriteMaterial({ map: texture, color: 0x66ccff, transparent: true, opacity: 0.85 })
    sprite = new THREE.Sprite(material)
    sprite.scale.set(48, 48, 1)
    scene.add(sprite)

    sizeToContainer()

    resizeObserver = new ResizeObserver(sizeToContainer)
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)

    // Listen on the overlay (the canvas is pointer-events-none, so events pass
    // through to it). Keep the exact target so teardown can detach cleanly.
    pointerTarget = canvas.parentElement
    pointerTarget?.addEventListener('pointermove', onPointerMove)

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
    if (pointerTarget) {
      pointerTarget.removeEventListener('pointermove', onPointerMove)
      pointerTarget = null
    }
    if (material) material.dispose()
    if (texture) texture.dispose()
    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss?.()
    }
    renderer = scene = camera = sprite = texture = material = null
    pointerWorld = null
    startTime = 0
  }

  // The canvas is behind a v-if (alien mode, desktop only), so it only exists in
  // the DOM some of the time. Wait for BOTH the ref to populate and active to be
  // true before starting; flip either off and we tear the stage down.
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
