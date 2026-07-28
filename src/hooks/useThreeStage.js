import { onBeforeUnmount, ref, watch } from 'vue'
import * as THREE from 'three'

// Phase 0 spike: prove the Three.js rendering stack can live alongside the
// existing DOM/CSS game before we start porting real entities.
//
// What it validates:
//   - three bundles/resolves under the Vue-CLI (webpack) build
//   - a WebGL canvas mounts inside #about and sizes to the container
//   - an orthographic camera + ResizeObserver keep the scene correct on
//     resize and fullscreen (where the container origin moves)
//   - the existing Cloudinary ship PNG loads as a texture (CORS pipeline)
//   - a rAF render loop drives a sprite's position
//   - it only runs in alien mode and fully tears down (dispose + cancel rAF
//     + disconnect observer) when alien mode turns off or the view unmounts
//
// Coordinate mapping (screen <-> scene) is intentionally NOT solved here - it's
// the whole job of Phase 1. This spike uses a centred ortho camera so there are
// no flip/handedness surprises to muddy the "does the stack work?" question.
export default function useThreeStage (active) {
  const stageCanvas = ref(null)

  let renderer = null
  let scene = null
  let camera = null
  let sprite = null
  let texture = null
  let material = null
  let resizeObserver = null
  let rafId = null
  let startTime = 0

  const sizeToContainer = () => {
    const canvas = stageCanvas.value
    if (!canvas || !renderer || !camera) return
    const parent = canvas.parentElement
    const width = parent?.clientWidth || canvas.clientWidth || 1
    const height = parent?.clientHeight || canvas.clientHeight || 1

    // Cap DPR so retina/4K fullscreen doesn't tank the fill rate.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)

    camera.left = -width / 2
    camera.right = width / 2
    camera.top = height / 2
    camera.bottom = -height / 2
    camera.updateProjectionMatrix()
  }

  const tick = (time) => {
    if (!renderer) return
    if (!startTime) startTime = time
    const t = (time - startTime) / 1000

    // Obvious, framerate-independent orbit so "is it alive?" is unambiguous.
    const radius = Math.min(camera.right, camera.top) * 0.5
    sprite.position.set(Math.cos(t) * radius, Math.sin(t * 0.9) * radius, 0)

    renderer.render(scene, camera)
    rafId = requestAnimationFrame(tick)
  }

  const start = () => {
    const canvas = stageCanvas.value
    if (!canvas || renderer) return

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    scene = new THREE.Scene()

    // Placeholder frustum; real extents get set by sizeToContainer() below.
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 5

    // Reuse the real ship art to prove the texture pipeline end to end.
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    texture = loader.load(
      'https://res.cloudinary.com/ddaji66m6/image/upload/v1612058700/portfolio/spaceship_tlg2od.png'
    )
    texture.colorSpace = THREE.SRGBColorSpace

    material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.85 })
    sprite = new THREE.Sprite(material)
    sprite.scale.set(48, 48, 1)
    scene.add(sprite)

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
    if (material) material.dispose()
    if (texture) texture.dispose()
    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss?.()
    }
    renderer = scene = camera = sprite = texture = material = null
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
