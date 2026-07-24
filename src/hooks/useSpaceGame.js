import { ref, reactive, computed, onUnmounted } from 'vue'
import useLocalStore from '@/hooks/useLocalStore'

const UFO_MAX_SIZE = 75
const SHIP_FOLLOW_RATE = 12         // 1/s - how fast the ship closes the gap to its target (higher = snappier)
const ARRIVE_THRESHOLD = 0.5        // px - snap to target once this close, instead of easing forever
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

const UFO_MAX_HEALTH = 10           // hits to destroy the UFO and advance a level
const UFO_DESTROYED_FLASH_DURATION = 500 // ms - bigger flash played on a kill (vs. a regular hit)
const KILL_BONUS_SCORE = 5          // extra points awarded on top of the +1 for the killing hit
const LEVEL_DIFFICULTY_CAP = 10     // level at which reaction-time difficulty maxes out

// "Reaction time" difficulty knobs - how alert/agile the UFO is, scaled by level from an
// easy starting point up toward (and eventually past) a much more alert ceiling.
const FLEE_COOLDOWN_START = 900     // ms - level 1: slow to react again after fleeing
const FLEE_COOLDOWN_MIN = 250       // ms - reaction time floor at high levels
const FLEE_RADIUS_START = 60        // px - level 1: cursor has to get quite close to spook it
const FLEE_RADIUS_MAX = 130         // px - detection range ceiling at high levels
const UFO_SPEED_MULTIPLIER_START = 0.7 // level 1: dodges away sluggishly
const UFO_SPEED_MULTIPLIER_MAX = 1.6   // dodge speed ceiling at high levels

export default function useSpaceGame () {
  const container = ref(null)
  const ship = ref(null)
  const ufo = ref(null)

  const score = ref(0)
  const bestScore = ref(0)
  const hit = ref(false)
  const scorePulse = ref(false)
  const hintVisible = ref(true)

  const level = ref(1)
  const ufoHealth = ref(UFO_MAX_HEALTH)
  const ufoDestroyed = ref(false)
  let ufoDestroyedTimeoutId = null

  const ufoHealthRatio = computed(() => ufoHealth.value / UFO_MAX_HEALTH)
  const ufoHealthColor = computed(() => {
    if (ufoHealthRatio.value > 0.6) return '#34d399' // green
    if (ufoHealthRatio.value > 0.3) return '#fbbf24' // amber
    return '#f87171' // red
  })

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

  // Rendered UFO style - top/left are driven every animation frame (see tick()) just
  // like the ship, so repeated retargeting (continuous flee) blends smoothly instead of
  // restarting a fresh CSS transition mid-flight. width/height/filter still CSS-transition
  // on their own timer for the size/depth-illusion morph between hops.
  const ufoPos = reactive({
    top: '-1000px',
    left: '-1000px',
    'transition-property': 'width, height, filter',
  })

  // Numeric UFO position/target/speed driving the per-frame movement loop, same
  // coordinate space as everything else (both container-relative here).
  let ufoX = -1000
  let ufoY = -1000
  let ufoTargetX = -1000
  let ufoTargetY = -1000
  let ufoFollowRate = 3 // 1/s - recomputed per hop in randomizePosition() to roughly match its duration

  // Last known cursor position (same coordinate space as the ship/UFO), used so the
  // UFO can continuously evade a lingering cursor rather than only reacting once.
  let lastPointerX = null
  let lastPointerY = null
  let lastFleeTime = 0

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

  // 0 at level 1, ramping to 1 by LEVEL_DIFFICULTY_CAP (and staying there beyond it) -
  // drives all three "reaction time" difficulty knobs below off of a single curve.
  const getLevelProgress = () => clamp((level.value - 1) / (LEVEL_DIFFICULTY_CAP - 1), 0, 1)

  const getFleeCooldown = () => FLEE_COOLDOWN_START - getLevelProgress() * (FLEE_COOLDOWN_START - FLEE_COOLDOWN_MIN)
  const getFleeRadius = () => FLEE_RADIUS_START + getLevelProgress() * (FLEE_RADIUS_MAX - FLEE_RADIUS_START)
  const getUfoSpeedMultiplier = () => UFO_SPEED_MULTIPLIER_START + getLevelProgress() * (UFO_SPEED_MULTIPLIER_MAX - UFO_SPEED_MULTIPLIER_START)

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

  // A bigger, deeper boom for when the UFO's health finally runs out, distinct from the
  // regular per-hit explosion.
  const playDestroyedSound = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    const duration = 0.45
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(500, ctx.currentTime)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    noise.connect(filter).connect(gain).connect(ctx.destination)
    noise.start()
  }

  const randomizePosition = () => {
    if (!container.value) return
    const durationSeconds = Math.ceil(Math.random() * 3)
    const duration = durationSeconds + 's'
    const offset = Math.random() < 0.5 ? -100 : 100

    const size = Math.ceil(Math.random() * UFO_MAX_SIZE)
    let brightness = (size / UFO_MAX_SIZE) * 100
    brightness = brightness < 40 ? 40 : brightness

    const zIndexThreshold = 0.8

    // Position now glides continuously in tick() (see ufoFollowRate) rather than via a
    // fresh CSS transition per hop - only the size/depth-illusion morph still uses one.
    ufoPos['animation-duration'] = duration
    ufoPos['transition-duration'] = duration
    ufoPos.height = `${size}px`
    ufoPos.width = `${size}px`
    ufoPos['z-index'] = size >= (UFO_MAX_SIZE * zIndexThreshold) ? 12 : 1
    ufoPos.filter = `brightness(${brightness}%)`

    // Roughly match the pace of the old CSS-transition hops (which fully arrived in
    // `durationSeconds`) so the continuous glide still feels like a "hop" of similar speed,
    // then scale by the current level's "reaction time" - sluggish early on, brisker later.
    ufoFollowRate = (3 / durationSeconds) * getUfoSpeedMultiplier()

    // Clamp to the container's bounds so the UFO can't spawn (partially) off-screen.
    const containerWidth = container.value.offsetWidth
    const containerHeight = container.value.offsetHeight
    ufoTargetY = clamp(Math.random() * containerHeight + offset, 0, Math.max(containerHeight - size, 0))
    ufoTargetX = clamp(Math.random() * containerWidth + offset, 0, Math.max(containerWidth - size, 0))
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

    lastPointerX = event.x
    lastPointerY = event.y - containerOffset.top

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
    scorePulse.value = true

    ufoHealth.value = Math.max(0, ufoHealth.value - 1)

    if (ufoHealth.value === 0) {
      // Destroyed - bigger flash/sound, level up (harder reaction time from here on),
      // and a fresh full health bar for the next spawn.
      score.value += KILL_BONUS_SCORE
      playDestroyedSound()

      ufoDestroyed.value = true
      clearTimeout(ufoDestroyedTimeoutId)
      ufoDestroyedTimeoutId = setTimeout(() => {
        ufoDestroyed.value = false
      }, UFO_DESTROYED_FLASH_DURATION)

      level.value++
      ufoHealth.value = UFO_MAX_HEALTH
    } else {
      playExplosionSound()
      hit.value = true
      clearTimeout(hitTimeoutId)
      hitTimeoutId = setTimeout(() => {
        hit.value = false
      }, UFO_HIT_FLASH_DURATION)
    }

    // Either way, getting shot spooks it into an immediate dodge to a new spot.
    randomizePosition()

    if (score.value > bestScore.value) {
      bestScore.value = score.value
      highScoreStore.set('bestScore', bestScore.value)
    }

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
    if (distance > ARRIVE_THRESHOLD) {
      const followT = 1 - Math.exp(-SHIP_FOLLOW_RATE * dt)
      shipX += dx * followT
      shipY += dy * followT
    } else {
      shipX = shipTargetX
      shipY = shipTargetY
    }
    shipPos.left = shipX + 'px'
    shipPos.top = shipY + 'px'

    // Ease the UFO toward its latest randomized target the same way - continuously
    // converging every frame means repeated retargeting (continuous flee) blends
    // smoothly, instead of interrupting a fresh CSS transition mid-flight and causing
    // a visible velocity jump each time a new hop starts.
    const ufoDx = ufoTargetX - ufoX
    const ufoDy = ufoTargetY - ufoY
    const ufoDistance = Math.hypot(ufoDx, ufoDy)
    if (ufoDistance > ARRIVE_THRESHOLD) {
      const ufoFollowT = 1 - Math.exp(-ufoFollowRate * dt)
      ufoX += ufoDx * ufoFollowT
      ufoY += ufoDy * ufoFollowT
    } else {
      ufoX = ufoTargetX
      ufoY = ufoTargetY
    }
    ufoPos.left = ufoX + 'px'
    ufoPos.top = ufoY + 'px'

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

    // Smarter UFO AI: keep evading for as long as the cursor lingers nearby, instead of
    // only reacting once on mouseenter. Rate-limited so it doesn't teleport every frame -
    // both the cooldown and detection radius scale with level (its "reaction time").
    if (ufoHitCircle && lastPointerX !== null && (time - lastFleeTime) >= getFleeCooldown()) {
      const pointerDistance = Math.hypot(lastPointerX - ufoHitCircle.x, lastPointerY - ufoHitCircle.y)
      if (pointerDistance <= getFleeRadius() + ufoHitCircle.radius) {
        lastFleeTime = time
        randomizePosition()
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
    clearTimeout(ufoDestroyedTimeoutId)
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
    level,
    ufoHealth,
    ufoHealthRatio,
    ufoHealthColor,
    ufoDestroyed,
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
