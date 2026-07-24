import { ref, reactive, onUnmounted } from 'vue'
import useLocalStore from '@/hooks/useLocalStore'

const UFO_MAX_SIZE = 75
const SHIP_FOLLOW_RATE = 12         // 1/s - how fast the ship closes the gap to its target (higher = snappier)
const SHIP_ARRIVE_THRESHOLD = 0.5   // px - snap to target once this close, instead of easing forever
const PROJECTILE_SPEED = 900        // px/s
const PROJECTILE_MAX_DISTANCE = 1200 // px travelled before a shot is considered a miss
const PROJECTILE_HIT_PADDING = 10   // px of extra forgiveness added to the UFO's on-screen radius
const FIRE_COOLDOWN = 300           // ms between shots, shared by mouse and keyboard fire
const UFO_HIT_FLASH_DURATION = 1000 // red flash on the UFO itself when hit
const SCORE_PULSE_DURATION = 300
const HIT_ANIM_DURATION = 260       // how long a projectile's "hit" burst plays before removal
const MISS_ANIM_DURATION = 160      // how long a projectile's fade-out plays before removal

export default function useSpaceGame () {
  const container = ref(null)
  const ship = ref(null)
  const ufo = ref(null)

  const score = ref(0)
  const bestScore = ref(0)
  const hit = ref(false)
  const scorePulse = ref(false)
  const hintVisible = ref(true)

  const highScoreStore = useLocalStore('spaceGame')
  bestScore.value = highScoreStore.get('bestScore', 0)

  const projectiles = reactive([])
  let nextProjectileId = 0

  const shipAngle = ref(0)
  let hasFacing = false

  // Rendered ship style - top/left are driven every animation frame by the numeric
  // position below; only the rotation transform gets a CSS transition (for smoothing
  // between the discrete mousemove samples that drive rotateShip).
  const shipPos = reactive({
    top: '0px',
    left: '0px',
    'transition-property': 'transform',
    'transition-duration': '0.1s',
  })

  // Numeric ship position/target driving the per-frame movement loop. Coordinate
  // space matches the original code: x is viewport-relative, y is container-relative.
  let shipX = 0
  let shipY = 0
  let shipTargetX = 0
  let shipTargetY = 0

  const ufoPos = ref({
    top: '-1000px',
  })

  let animationTimeoutId = null
  let hitTimeoutId = null
  let scorePulseTimeoutId = null
  let lastFireTime = 0
  let rafId = null
  let lastFrameTime = null

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

  const dismissHint = () => {
    hintVisible.value = false
  }

  const randomizePosition = () => {
    if (!container.value) return
    const duration = Math.ceil(Math.random() * 3) + 's'
    const offset = Math.random() < 0.5 ? -100 : 100

    const size = Math.ceil(Math.random() * UFO_MAX_SIZE)
    let brightness = (size / UFO_MAX_SIZE) * 100
    brightness = brightness < 40 ? 40 : brightness

    const zIndexThreshold = 0.8

    const sizeStyles = {
      height: `${size}px`,
      width: `${size}px`,
      'z-index': size >= (UFO_MAX_SIZE * zIndexThreshold) ? 12 : 1,
      filter: `brightness(${brightness}%)`,
    }

    // Clamp to the container's bounds so the UFO can't spawn (partially) off-screen.
    const containerWidth = container.value.offsetWidth
    const containerHeight = container.value.offsetHeight
    const top = clamp(Math.random() * containerHeight + offset, 0, Math.max(containerHeight - size, 0))
    const left = clamp(Math.random() * containerWidth + offset, 0, Math.max(containerWidth - size, 0))

    ufoPos.value = {
      top: top + 'px',
      left: left + 'px',
      'animation-duration': duration,
      'transition-duration': duration,
      ...sizeStyles
    }
  }

  const rotateShip = (event) => {
    if (!container.value || !ship.value) return
    dismissHint()

    const containerOffset = container.value.getBoundingClientRect()

    const pointerBox = ship.value.getBoundingClientRect(),
        centerY = pointerBox.top + ship.value.offsetHeight - containerOffset.top,
        centerX = pointerBox.left + ship.value.offsetWidth - containerOffset.left

    const radians = Math.atan2(event.x - centerX, (event.y - containerOffset.top) - centerY)
    const degree = (radians * (180 / Math.PI) * -1) + 180

    shipAngle.value = degree
    hasFacing = true
    shipPos.transform = `rotate(${degree}deg)`
  }

  // The UFO glides between spawn points via its own CSS transition, so its live
  // on-screen position/size has to be read from the DOM rather than tracked in JS.
  const getUfoHitCircle = () => {
    if (!ufo.value?.$el || !container.value) return null
    const ufoRect = ufo.value.$el.getBoundingClientRect()
    const containerOffset = container.value.getBoundingClientRect()

    return {
      x: ufoRect.left + ufoRect.width / 2,
      y: (ufoRect.top + ufoRect.height / 2) - containerOffset.top,
      radius: Math.max(ufoRect.width, ufoRect.height) / 2 + PROJECTILE_HIT_PADDING,
    }
  }

  const registerHit = (projectile) => {
    projectile.state = 'hit'
    score.value++
    hit.value = true
    scorePulse.value = true

    if (score.value > bestScore.value) {
      bestScore.value = score.value
      highScoreStore.set('bestScore', bestScore.value)
    }

    clearTimeout(hitTimeoutId)
    hitTimeoutId = setTimeout(() => {
      hit.value = false
    }, UFO_HIT_FLASH_DURATION)

    clearTimeout(scorePulseTimeoutId)
    scorePulseTimeoutId = setTimeout(() => {
      scorePulse.value = false
    }, SCORE_PULSE_DURATION)

    setTimeout(() => {
      const index = projectiles.indexOf(projectile)
      if (index !== -1) projectiles.splice(index, 1)
    }, HIT_ANIM_DURATION)
  }

  const registerMiss = (projectile) => {
    projectile.state = 'miss'
    setTimeout(() => {
      const index = projectiles.indexOf(projectile)
      if (index !== -1) projectiles.splice(index, 1)
    }, MISS_ANIM_DURATION)
  }

  const canFire = () => (performance.now() - lastFireTime) >= FIRE_COOLDOWN

  // Spawns a real projectile travelling in a straight line from (originX, originY) along
  // directionRadians; a hit is only registered once its flight path comes within the
  // UFO's live hit circle (see tick()), rather than instantly on click.
  const fireAt = (originX, originY, directionRadians) => {
    if (!canFire()) return
    lastFireTime = performance.now()

    projectiles.push({
      id: nextProjectileId++,
      x: originX,
      y: originY,
      vx: Math.sin(directionRadians) * PROJECTILE_SPEED,
      vy: Math.cos(directionRadians) * PROJECTILE_SPEED,
      travelled: 0,
      state: 'flying',
    })
  }

  // Fires along the direction the ship is currently facing - used for keyboard shooting,
  // since a KeyboardEvent has no x/y to fire at like a mouse click does.
  const fireForward = () => {
    // Nothing sensible to fire at until the ship has faced a direction at least once
    // (e.g. Space pressed before any mouse movement).
    if (!ship.value || !hasFacing) return

    // Invert rotateShip's degree formula to recover the angle in radians:
    // degree = (radians * (180 / Math.PI) * -1) + 180  =>  radians = (180 - degree) * (Math.PI / 180)
    const radians = (180 - shipAngle.value) * (Math.PI / 180)
    fireAt(shipX, shipY, radians)
  }

  const onKeyDown = (event) => {
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault()
      dismissHint()
      fireForward()
    }
  }

  const ufoClicked = (event) => {
    dismissHint()
    const containerOffset = container.value.getBoundingClientRect()
    const targetX = event.x
    const targetY = event.y - containerOffset.top
    const radians = Math.atan2(targetX - shipX, targetY - shipY)
    fireAt(shipX, shipY, radians)
  }

  const moveShip = (event) => {
    dismissHint()

    // ufoClicked (bound directly on the UFO) already fires for this click,
    // so don't also treat it as a "fly here" click.
    if (ufo.value?.$el === event.target) return

    const containerOffset = container.value.getBoundingClientRect()
    shipTargetX = event.x
    shipTargetY = event.y - containerOffset.top
  }

  const tick = (time) => {
    if (!container.value) {
      rafId = requestAnimationFrame(tick)
      return
    }

    if (lastFrameTime === null) lastFrameTime = time
    // Clamp dt so tabbing away and back doesn't fling the ship/projectiles.
    const dt = Math.min((time - lastFrameTime) / 1000, 0.1)
    lastFrameTime = time

    // Ease the ship toward its target - covers a fraction of the remaining distance
    // each frame (framerate-independent), so it starts fast and decelerates into
    // place instead of sliding at a constant speed and snapping to a dead stop.
    const dx = shipTargetX - shipX
    const dy = shipTargetY - shipY
    const distance = Math.hypot(dx, dy)
    if (distance > SHIP_ARRIVE_THRESHOLD) {
      const followT = 1 - Math.exp(-SHIP_FOLLOW_RATE * dt)
      shipX += dx * followT
      shipY += dy * followT
    } else {
      shipX = shipTargetX
      shipY = shipTargetY
    }
    shipPos.left = shipX + 'px'
    shipPos.top = shipY + 'px'

    // Advance in-flight projectiles and check each against the UFO's live position.
    const ufoHitCircle = getUfoHitCircle()
    for (const projectile of projectiles) {
      if (projectile.state !== 'flying') continue

      const stepX = projectile.vx * dt
      const stepY = projectile.vy * dt
      projectile.x += stepX
      projectile.y += stepY
      projectile.travelled += Math.hypot(stepX, stepY)

      if (ufoHitCircle) {
        const hitDistance = Math.hypot(projectile.x - ufoHitCircle.x, projectile.y - ufoHitCircle.y)
        if (hitDistance <= ufoHitCircle.radius) {
          registerHit(projectile)
          continue
        }
      }

      if (projectile.travelled >= PROJECTILE_MAX_DISTANCE) {
        registerMiss(projectile)
      }
    }

    rafId = requestAnimationFrame(tick)
  }

  rafId = requestAnimationFrame(tick)

  const scheduleUfoMovement = () => {
    animationTimeoutId = setTimeout(() => {
      randomizePosition()
      scheduleUfoMovement()
    }, Math.ceil(Math.random() * 10000))
  }

  onUnmounted(() => {
    clearTimeout(animationTimeoutId)
    clearTimeout(hitTimeoutId)
    clearTimeout(scorePulseTimeoutId)
    if (rafId) cancelAnimationFrame(rafId)
  })

  return {
    container,
    ship,
    ufo,
    score,
    bestScore,
    hit,
    scorePulse,
    hintVisible,
    projectiles,
    shipPos,
    ufoPos,
    randomizePosition,
    rotateShip,
    moveShip,
    onKeyDown,
    ufoClicked,
    scheduleUfoMovement,
  }
}
