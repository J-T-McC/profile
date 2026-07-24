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

const WARP_STRETCH = 1.7            // peak squash-and-stretch factor when a "fly here" click lands
const WARP_SETTLE_DURATION = 300    // ms for the stretch to ease back to normal
const WARP_FLASH_FADE_DURATION = 380 // ms for the departure-point light burst to fade out

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

  const muted = ref(highScoreStore.get('muted', false))
  const toggleMute = () => {
    muted.value = !muted.value
    highScoreStore.set('muted', muted.value)
  }

  const projectiles = reactive([])
  let nextProjectileId = 0

  const warpFlashes = reactive([])
  let nextWarpFlashId = 0
  let warpSettleTimeoutId = null

  const shipAngle = ref(0)
  let hasFacing = false
  let shipStretch = 1 // 1 = normal; briefly pushed higher for the warp squash-and-stretch pop

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

  // --- Sound (synthesized via Web Audio - no external audio files) -------------------

  let audioCtx = null

  const getAudioContext = () => {
    if (muted.value) return null
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return null
    if (!audioCtx) audioCtx = new AudioContextClass()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    return audioCtx
  }

  const playLaserSound = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.13)
  }

  const playExplosionSound = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    const duration = 0.25
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1200, ctx.currentTime)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    noise.connect(filter).connect(gain).connect(ctx.destination)
    noise.start()
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

  // Combines the ship's current facing angle with its current warp-stretch factor into
  // a single transform - kept in one place so rotateShip and the warp effect (which run
  // independently of each other) never stomp on each other's half of the transform string.
  // The 1/shipStretch on the perpendicular axis keeps the "volume" roughly constant
  // (classic squash-and-stretch), so a taller ship also looks a touch narrower.
  const applyShipTransform = () => {
    shipPos.transform = `rotate(${shipAngle.value}deg) scale(${1 / shipStretch}, ${shipStretch})`
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
    applyShipTransform()
  }

  const spawnWarpFlash = (x, y) => {
    const id = nextWarpFlashId++
    warpFlashes.push({ id, x, y, active: false })

    // Pushed in on the next tick so the CSS transition (rather than the initial state)
    // is what animates it from a small bright dot into a fading burst.
    setTimeout(() => {
      const flash = warpFlashes.find(f => f.id === id)
      if (flash) flash.active = true
    }, 10)

    setTimeout(() => {
      const index = warpFlashes.findIndex(f => f.id === id)
      if (index !== -1) warpFlashes.splice(index, 1)
    }, WARP_FLASH_FADE_DURATION + 20)
  }

  // Purely a visual flourish for a "fly here" click - stretches the ship along its
  // facing axis then eases back to normal, plus a light burst at the departure point.
  // Doesn't touch shipX/Y/target at all, so it can't affect actual movement.
  const triggerWarpEffect = () => {
    spawnWarpFlash(shipX, shipY)

    // Snap to the stretched pose instantly (no transition), then let a transition ease
    // it back to normal - a quick "warp stretch" pop rather than a gradual stretch.
    shipPos['transition-duration'] = '0s'
    shipStretch = WARP_STRETCH
    applyShipTransform()

    requestAnimationFrame(() => {
      shipPos['transition-duration'] = `${WARP_SETTLE_DURATION}ms`
      shipStretch = 1
      applyShipTransform()
    })

    // Rotation normally responds within 0.1s; restore that after the warp settles so
    // the brief slower transition here doesn't linger and make aiming feel sluggish.
    clearTimeout(warpSettleTimeoutId)
    warpSettleTimeoutId = setTimeout(() => {
      shipPos['transition-duration'] = '0.1s'
    }, WARP_SETTLE_DURATION + 20)
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
    playExplosionSound()

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
    playLaserSound()

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
    triggerWarpEffect()
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
    clearTimeout(warpSettleTimeoutId)
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
    muted,
    toggleMute,
    projectiles,
    warpFlashes,
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
