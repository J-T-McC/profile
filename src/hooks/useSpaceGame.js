import { ref, reactive, computed, onUnmounted } from 'vue'
import useLocalStore from '@/hooks/useLocalStore'

const UFO_MAX_SIZE = 75
const SHIP_FOLLOW_RATE = 12         // 1/s - how fast the ship closes the gap to its target (higher = snappier)
const ARRIVE_THRESHOLD = 0.5        // px - snap to target once this close, instead of easing forever
const PROJECTILE_SPEED = 900        // px/s
const PROJECTILE_MAX_DISTANCE = 1200 // px travelled before a shot is considered a miss
const PROJECTILE_HIT_PADDING = 10   // px of extra forgiveness added to the UFO's on-screen radius
const PROJECTILE_INTERCEPT_RADIUS = 16 // px - how close a player shot must get to shoot down an alien one
const FIRE_COOLDOWN = 300           // ms between shots, shared by mouse and keyboard fire
const UFO_HIT_FLASH_DURATION = 1000 // red flash on the UFO itself when hit
const SCORE_PULSE_DURATION = 300
const HIT_ANIM_DURATION = 260       // how long a projectile's "hit" burst plays before removal
const MISS_ANIM_DURATION = 160      // how long a projectile's fade-out plays before removal

const WARP_STRETCH = 1.7            // peak squash-and-stretch factor when a "fly here" click lands
const WARP_SETTLE_DURATION = 300    // ms for the stretch to ease back to normal
const WARP_FLASH_FADE_DURATION = 380 // ms for the departure-point light burst to fade out

const UFO_MAX_HEALTH = 10           // hits to destroy the UFO and advance a level
const UFO_DESTROYED_FLASH_DURATION = 1200 // ms - bigger flash played on a kill (vs. a regular hit)
const UFO_RESPAWN_DELAY = 2500      // ms the UFO stays gone after being destroyed, before it respawns
const KILL_BONUS_SCORE = 5          // extra points awarded on top of the +1 for the killing hit
const LEVEL_DIFFICULTY_CAP = 10     // level at which reaction-time difficulty maxes out

// "Reaction time" difficulty knobs - how alert/agile the UFO is, scaled by level from an
// easy starting point up toward (and eventually past) a much more alert ceiling. Level 1
// is intentionally quite forgiving - slow to notice you, and lazy once it does - so the
// ramp up to the harder ceiling is more noticeable.
const FLEE_COOLDOWN_START = 1800    // ms - level 1: very slow to react again after fleeing
const FLEE_COOLDOWN_MIN = 250       // ms - reaction time floor at high levels
const FLEE_RADIUS_START = 35        // px - level 1: cursor has to get quite close to spook it
const FLEE_RADIUS_MAX = 130         // px - detection range ceiling at high levels
const UFO_SPEED_MULTIPLIER_START = 0.35 // level 1: dodges away sluggishly
const UFO_SPEED_MULTIPLIER_MAX = 1.6    // dodge speed ceiling at high levels

// The UFO's return fire - unlocked at ALIEN_FIRE_MIN_LEVEL. There's no player health, so
// getting hit instead heals the UFO by 1 - fires rarely right when it unlocks, and more
// often at higher levels, same "reaction time" ramp as the evasion knobs above. Kept
// deliberately modest at both ends - once multiple UFOs are in play at once, the combined
// fire rate will climb on its own without any single one needing to be this aggressive.
const ALIEN_FIRE_MIN_LEVEL = 3
const ALIEN_FIRE_COOLDOWN_START = 10000 // ms - quite infrequent right when it unlocks
const ALIEN_FIRE_COOLDOWN_MIN = 3000    // ms - still just once every few seconds at max difficulty
const ALIEN_PROJECTILE_SPEED = 650      // px/s - a bit slower than the player's shots, so it's dodgeable
const ALIEN_HEAL_AMOUNT = 1             // HP restored to the UFO per successful hit
const SHIP_HIT_FLASH_DURATION = 400     // ms - brief flash on the ship when an alien shot connects

// Floating weapon power-ups, starting at level 4 - fly the ship into one to pick it up.
// Weaker/simpler ones are available first, stronger ones only unlock at higher levels, so
// what's on offer ramps up gradually rather than throwing everything in at once.
const POWERUP_MIN_LEVEL = 4
const POWERUP_BUFF_DURATION = 10000  // ms the collected buff stays active - a placeholder for now
const POWERUP_LIFESPAN = 12000       // ms a spawned pickup floats around before vanishing uncollected
const POWERUP_SPAWN_INTERVAL_MIN = 14000
const POWERUP_SPAWN_INTERVAL_MAX = 24000
const POWERUP_DRIFT_SPEED = 70       // px/s, horizontal drift across the screen
const POWERUP_BOB_AMPLITUDE = 10     // px of vertical bobbing while it floats
const POWERUP_BOB_FREQUENCY = 0.6    // bobs per second
const POWERUP_COLLECT_PADDING = 16   // px of extra forgiveness added to the ship's radius for pickup
const POWERUP_COLLECT_ANIM_DURATION = 300 // ms pop animation before a collected pickup disappears
const LASER_SPEED_MULTIPLIER = 1.5   // laser buff: shots fly faster...
const LASER_HIT_PADDING_BONUS = 8    // ...and are a bit more forgiving to land
const LASER_HOMING_TURN_RATE = 4     // rad/s - gently heat-seeks toward the UFO (higher = tighter tracking)
const LASER_DAMAGE = 2               // laser shots deal double the normal 1 damage per hit

// A subtle aim-assist on ordinary shots - they only start nudging toward the UFO once
// they're already within REGULAR_HOMING_RADIUS of it, and much more weakly than the laser,
// so a slightly-off angle at higher levels still connects without every shot auto-hitting.
const REGULAR_HOMING_TURN_RATE = 2   // rad/s - weaker than the laser's tracking
const REGULAR_HOMING_RADIUS = 80     // px from the UFO's centre before the nudge kicks in

const POWERUP_TYPES = {
  rapid2: { minLevel: 4, label: '2×', color: '#38bdf8', fireRateMultiplier: 2 },
  rapid3: { minLevel: 5, label: '3×', color: '#818cf8', fireRateMultiplier: 3 },
  double: { minLevel: 5, label: '2•', color: '#facc15', doubleShot: true },
  rapid4: { minLevel: 7, label: '4×', color: '#f472b6', fireRateMultiplier: 4 },
  laser: { minLevel: 8, label: 'L', color: '#34d399', laser: true },
}

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
  const ufoVisible = ref(true)
  let ufoDestroyedTimeoutId = null
  let respawnTimeoutId = null

  // Dev/testing cheat code - type "level" followed by a number then Enter (e.g.
  // "level5" + Enter) to jump straight to that level instead of grinding up to it.
  let cheatBuffer = ''
  let lastCheatKeyTime = 0
  const CHEAT_BUFFER_TIMEOUT = 3000 // ms - stale buffer resets after a pause
  const CHEAT_LEVEL_PATTERN = /level\s*(\d+)$/i

  // Dev/testing cheat - type one of these then Enter to instantly grant that weapon buff
  // (regardless of level), since some (e.g. laser) only spawn rarely at high levels. The
  // "2x/3x/4x" aliases are just friendlier to type than the internal rapidN ids.
  const BUFF_CHEAT_CODES = {
    laser: 'laser',
    double: 'double',
    rapid2: 'rapid2',
    rapid3: 'rapid3',
    rapid4: 'rapid4',
    '2x': 'rapid2',
    '3x': 'rapid3',
    '4x': 'rapid4',
  }

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

  const powerUps = reactive([])
  let nextPowerUpId = 0
  let powerUpSpawnTimeoutId = null

  const activeBuffType = ref(null)
  const buffRemainingMs = ref(0)
  let buffExpiresAt = 0

  const activeBuffLabel = computed(() => activeBuffType.value ? POWERUP_TYPES[activeBuffType.value].label : null)
  const activeBuffColor = computed(() => activeBuffType.value ? POWERUP_TYPES[activeBuffType.value].color : null)
  const activeBuffSecondsRemaining = computed(() => Math.ceil(buffRemainingMs.value / 1000))

  // Radar minimap - the ship's and UFO's field positions, normalised to 0..1 of the
  // container each frame in tick() (the raw shipX/ufoX vars aren't reactive), so the
  // radar can plot them as a fraction of its diameter regardless of its pixel size.
  const radarShip = reactive({ x: 0.5, y: 0.5 })
  const radarUfo = reactive({ x: 0.5, y: 0.5 })

  const shipAngle = ref(0)
  let hasFacing = false
  let shipStretch = 1 // 1 = normal; briefly pushed higher for the warp squash-and-stretch pop

  const shipHit = ref(false) // brief flash when the alien's return fire connects
  let shipHitTimeoutId = null
  let alienFireTimeoutId = null

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

  // 0 right when return fire unlocks (ALIEN_FIRE_MIN_LEVEL), ramping to 1 by
  // LEVEL_DIFFICULTY_CAP - separate curve from getLevelProgress() since it only starts
  // counting from level 3, not level 1.
  const getAlienFireProgress = () => clamp((level.value - ALIEN_FIRE_MIN_LEVEL) / (LEVEL_DIFFICULTY_CAP - ALIEN_FIRE_MIN_LEVEL), 0, 1)
  const getAlienFireCooldown = () => ALIEN_FIRE_COOLDOWN_START - getAlienFireProgress() * (ALIEN_FIRE_COOLDOWN_START - ALIEN_FIRE_COOLDOWN_MIN)

  // Which power-up types are allowed to spawn at the current level - grows as level
  // increases, so stronger buffs only start showing up once you've levelled up enough.
  const getAvailablePowerUpTypeIds = () => Object.keys(POWERUP_TYPES).filter(id => level.value >= POWERUP_TYPES[id].minLevel)
  const getActiveBuff = () => activeBuffType.value ? POWERUP_TYPES[activeBuffType.value] : null

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
    const duration = 1.1
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    // Descending rumble (500Hz -> 90Hz) rather than a static filter, for a deeper,
    // more drawn-out boom befitting an actual kill rather than a regular hit.
    filter.frequency.setValueAtTime(500, ctx.currentTime)
    filter.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    noise.connect(filter).connect(gain).connect(ctx.destination)
    noise.start()
  }

  // The UFO's own return shot - a lower, coarser sawtooth sweep so it reads as distinct
  // from (and a little more ominous than) the player's own laser.
  const playAlienLaserSound = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(300, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.18)
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.19)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.2)
  }

  // A brighter, rising chime for when the UFO heals off a return-fire hit - distinct
  // from the explosion sounds so a heal doesn't sound like damage.
  const playHealSound = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.1, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.2)
  }

  // A quick, neutral "tink" for a player shot shooting down an alien one mid-air -
  // distinct from the explosion/heal/laser sounds since neither side actually landed.
  const playInterceptSound = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1200, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.1)
  }

  // A bright ascending three-note arpeggio for picking up a weapon power-up.
  const playPowerUpSound = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    const notes = [523.25, 659.25, 783.99] // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      const startTime = ctx.currentTime + i * 0.06
      osc.frequency.setValueAtTime(freq, startTime)
      gain.gain.setValueAtTime(0.001, startTime)
      gain.gain.exponentialRampToValueAtTime(0.09, startTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15)
      osc.connect(gain).connect(ctx.destination)
      osc.start(startTime)
      osc.stop(startTime + 0.16)
    })
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

  // Mirrors getUfoHitCircle() but for the player's own ship, so the UFO's return fire
  // can check for a hit against its actual on-screen position/size.
  const getShipHitCircle = () => {
    if (!ship.value || !container.value) return null
    const shipRect = ship.value.getBoundingClientRect()
    const containerOffset = container.value.getBoundingClientRect()

    return {
      x: shipRect.left + shipRect.width / 2,
      y: (shipRect.top + shipRect.height / 2) - containerOffset.top,
      radius: Math.max(shipRect.width, shipRect.height) / 2 + PROJECTILE_HIT_PADDING,
    }
  }

  const registerHit = (projectile) => {
    projectile.state = 'hit'
    score.value++
    scorePulse.value = true

    ufoHealth.value = Math.max(0, ufoHealth.value - (projectile.damage || 1))

    if (ufoHealth.value === 0) {
      // Destroyed - bigger flash/sound, level up (harder reaction time from here on),
      // then stay gone for a beat before respawning elsewhere at full health.
      score.value += KILL_BONUS_SCORE
      playDestroyedSound()

      ufoDestroyed.value = true
      clearTimeout(ufoDestroyedTimeoutId)
      ufoDestroyedTimeoutId = setTimeout(() => {
        ufoDestroyed.value = false
      }, UFO_DESTROYED_FLASH_DURATION)

      level.value++
      ufoHealth.value = UFO_MAX_HEALTH
      ufoVisible.value = false

      clearTimeout(respawnTimeoutId)
      respawnTimeoutId = setTimeout(() => {
        randomizePosition()
        ufoVisible.value = true
      }, UFO_RESPAWN_DELAY)
    } else {
      playExplosionSound()
      hit.value = true
      clearTimeout(hitTimeoutId)
      hitTimeoutId = setTimeout(() => {
        hit.value = false
      }, UFO_HIT_FLASH_DURATION)

      // Getting shot (but not destroyed) spooks it into an immediate dodge to a new spot.
      randomizePosition()
    }

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

  // The UFO's return fire connecting - instead of costing the player anything (there's
  // no player health), it heals the UFO back up, capped at full health.
  const registerAlienHit = (projectile) => {
    projectile.state = 'hit'
    ufoHealth.value = Math.min(UFO_MAX_HEALTH, ufoHealth.value + ALIEN_HEAL_AMOUNT)
    playHealSound()

    shipHit.value = true
    clearTimeout(shipHitTimeoutId)
    shipHitTimeoutId = setTimeout(() => {
      shipHit.value = false
    }, SHIP_HIT_FLASH_DURATION)

    setTimeout(() => {
      const index = projectiles.indexOf(projectile)
      if (index !== -1) projectiles.splice(index, 1)
    }, HIT_ANIM_DURATION)
  }

  // A player shot getting close enough to an in-flight alien shot destroys both -
  // lets the player shoot down incoming fire before it reaches (and heals) the UFO.
  const registerIntercept = (alienShot, playerShot) => {
    alienShot.state = 'intercepted'
    playerShot.state = 'intercepted'
    playInterceptSound()

    setTimeout(() => {
      const index = projectiles.indexOf(alienShot)
      if (index !== -1) projectiles.splice(index, 1)
    }, HIT_ANIM_DURATION)

    setTimeout(() => {
      const index = projectiles.indexOf(playerShot)
      if (index !== -1) projectiles.splice(index, 1)
    }, HIT_ANIM_DURATION)
  }

  // A "rapid fire" buff shortens the cooldown by its multiplier; no active buff (or a
  // non-rate buff like double/laser) leaves it at the base rate.
  const canFire = () => {
    const multiplier = getActiveBuff()?.fireRateMultiplier ?? 1
    return (performance.now() - lastFireTime) >= (FIRE_COOLDOWN / multiplier)
  }

  // Spawns a real projectile travelling in a straight line from (originX, originY) along
  // directionRadians; a hit is only registered once its flight path comes within the
  // UFO's live hit circle (see tick()), rather than instantly on click. Applies whatever
  // weapon buff is currently active: double-shot fires a pair spread slightly apart, and
  // laser makes the shot(s) faster and a bit more forgiving to land.
  const fireAt = (originX, originY, directionRadians) => {
    if (!canFire()) return
    lastFireTime = performance.now()
    playLaserSound()

    const buff = getActiveBuff()
    const isLaser = !!buff?.laser
    const speed = isLaser ? PROJECTILE_SPEED * LASER_SPEED_MULTIPLIER : PROJECTILE_SPEED
    const hitPaddingBonus = isLaser ? LASER_HIT_PADDING_BONUS : 0

    const spawnShot = (angleOffset) => {
      const radians = directionRadians + angleOffset
      projectiles.push({
        id: nextProjectileId++,
        owner: 'player',
        x: originX,
        y: originY,
        vx: Math.sin(radians) * speed,
        vy: Math.cos(radians) * speed,
        travelled: 0,
        state: 'flying',
        hitPaddingBonus,
        laser: isLaser,
        damage: isLaser ? LASER_DAMAGE : 1,
      })
    }

    if (buff?.doubleShot) {
      const spread = 0.12 // radians, roughly ±3.4 degrees off the aimed direction
      spawnShot(-spread / 2)
      spawnShot(spread / 2)
    } else {
      spawnShot(0)
    }
  }

  // The UFO's own return shot, unlocked at ALIEN_FIRE_MIN_LEVEL - aims directly at the
  // ship's current position (no lead/prediction, same simple aim model as the player's
  // own shots) and travels a bit slower than the player's, so it's dodgeable.
  const fireAlienShot = () => {
    if (!ufo.value?.$el || !container.value || !ufoVisible.value) return

    const radians = Math.atan2(shipX - ufoX, shipY - ufoY)
    playAlienLaserSound()

    projectiles.push({
      id: nextProjectileId++,
      owner: 'alien',
      x: ufoX,
      y: ufoY,
      vx: Math.sin(radians) * ALIEN_PROJECTILE_SPEED,
      vy: Math.cos(radians) * ALIEN_PROJECTILE_SPEED,
      travelled: 0,
      state: 'flying',
    })
  }

  // Keeps rescheduling regardless of level - only actually fires once level reaches
  // ALIEN_FIRE_MIN_LEVEL - so return fire kicks in immediately once the player reaches
  // that level, without needing anything to restart the scheduler.
  const scheduleAlienFire = () => {
    const delay = getAlienFireCooldown() * (0.75 + Math.random() * 0.5)
    alienFireTimeoutId = setTimeout(() => {
      if (level.value >= ALIEN_FIRE_MIN_LEVEL) {
        fireAlienShot()
      }
      scheduleAlienFire()
    }, delay)
  }

  // Drifts a weapon power-up in from one side of the screen - removed automatically
  // after POWERUP_LIFESPAN if the player never flies into it.
  const spawnPowerUp = () => {
    if (!container.value) return
    const availableIds = getAvailablePowerUpTypeIds()
    if (!availableIds.length) return

    const type = availableIds[Math.floor(Math.random() * availableIds.length)]
    const containerWidth = container.value.offsetWidth
    const containerHeight = container.value.offsetHeight
    const fromLeft = Math.random() < 0.5
    const id = nextPowerUpId++

    powerUps.push({
      id,
      type,
      label: POWERUP_TYPES[type].label,
      color: POWERUP_TYPES[type].color,
      x: fromLeft ? -30 : containerWidth + 30,
      baseY: Math.random() * Math.max(containerHeight - 40, 40) + 20,
      y: 0,
      vx: (fromLeft ? 1 : -1) * POWERUP_DRIFT_SPEED,
      spawnTime: null,
      state: 'floating',
      radarX: 0.5,
      radarY: 0.5,
    })

    setTimeout(() => {
      const index = powerUps.findIndex(p => p.id === id)
      if (index !== -1 && powerUps[index].state === 'floating') {
        powerUps.splice(index, 1)
      }
    }, POWERUP_LIFESPAN)
  }

  // Keeps rescheduling regardless of level - only actually spawns once level reaches
  // POWERUP_MIN_LEVEL, same self-starting pattern as scheduleAlienFire().
  const schedulePowerUpSpawn = () => {
    const delay = POWERUP_SPAWN_INTERVAL_MIN + Math.random() * (POWERUP_SPAWN_INTERVAL_MAX - POWERUP_SPAWN_INTERVAL_MIN)
    powerUpSpawnTimeoutId = setTimeout(() => {
      if (level.value >= POWERUP_MIN_LEVEL) {
        spawnPowerUp()
      }
      schedulePowerUpSpawn()
    }, delay)
  }

  // Activates (or refreshes) a weapon buff by type id - only one is ever active at a
  // time, so this replaces whatever was there. buffExpiresAt is on the same clock as the
  // tick loop's `time` (both DOMHighResTimeStamp), so performance.now() is interchangeable
  // whether this is triggered from a pickup mid-frame or a keydown cheat.
  const activateBuff = (typeId) => {
    if (!POWERUP_TYPES[typeId]) return
    activeBuffType.value = typeId
    buffExpiresAt = performance.now() + POWERUP_BUFF_DURATION
    buffRemainingMs.value = POWERUP_BUFF_DURATION
    playPowerUpSound()
  }

  // Flying into a power-up immediately grants its buff, replacing/refreshing whatever
  // (if anything) was already active - only one weapon buff is active at a time.
  const collectPowerUp = (powerUp) => {
    powerUp.state = 'collected'
    activateBuff(powerUp.type)

    setTimeout(() => {
      const index = powerUps.indexOf(powerUp)
      if (index !== -1) powerUps.splice(index, 1)
    }, POWERUP_COLLECT_ANIM_DURATION)
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

  // Jumps straight to the given level for testing, without needing to grind up to it -
  // resets the UFO to full health at the new level's difficulty and relocates it
  // immediately so the change is felt right away.
  const applyCheatLevel = (targetLevel) => {
    level.value = Math.max(1, Math.floor(targetLevel))
    ufoHealth.value = UFO_MAX_HEALTH
    ufoDestroyed.value = false
    ufoVisible.value = true
    clearTimeout(respawnTimeoutId)
    randomizePosition()
  }

  const onKeyDown = (event) => {
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault()
      dismissHint()
      fireForward()
      return
    }

    if (event.key === 'Enter') {
      const levelMatch = cheatBuffer.match(CHEAT_LEVEL_PATTERN)
      if (levelMatch) {
        applyCheatLevel(Number(levelMatch[1]))
      } else {
        const buffCode = Object.keys(BUFF_CHEAT_CODES).find(code => cheatBuffer.toLowerCase().endsWith(code))
        if (buffCode) activateBuff(BUFF_CHEAT_CODES[buffCode])
      }
      cheatBuffer = ''
      return
    }

    // Accumulate single printable characters only (letters/digits/etc.), ignoring
    // named keys like "Shift" or "Backspace" - resets after a pause so stray typing
    // elsewhere on the page can't linger into a later, unintended match.
    if (event.key && event.key.length === 1) {
      const now = performance.now()
      if (now - lastCheatKeyTime > CHEAT_BUFFER_TIMEOUT) cheatBuffer = ''
      lastCheatKeyTime = now
      cheatBuffer = (cheatBuffer + event.key).slice(-24)
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

    // Feed the radar minimap: normalise the ship's and UFO's field positions to 0..1
    // (power-ups get the same treatment in their own loop below, reusing radarW/H).
    const radarW = container.value.offsetWidth
    const radarH = container.value.offsetHeight
    radarShip.x = clamp(shipX / radarW, 0, 1)
    radarShip.y = clamp(shipY / radarH, 0, 1)
    radarUfo.x = clamp(ufoX / radarW, 0, 1)
    radarUfo.y = clamp(ufoY / radarH, 0, 1)

    // Advance in-flight projectiles and check each against the right target's live
    // position - player shots aim at the UFO, the UFO's own return fire aims at the ship.
    const ufoHitCircle = getUfoHitCircle()
    const shipHitCircle = getShipHitCircle()
    for (const projectile of projectiles) {
      if (projectile.state !== 'flying') continue

      // Player shots nudge their heading toward the UFO each frame (turn rate capped so
      // they curve rather than snap), keeping speed constant. Lasers heat-seek from
      // anywhere; ordinary shots get a weaker nudge, and only once they're already near
      // the UFO - a forgiving aim-assist rather than full tracking. Only while a UFO is live.
      if (projectile.owner === 'player' && ufoHitCircle && ufoVisible.value) {
        let turnRate = 0
        if (projectile.laser) {
          turnRate = LASER_HOMING_TURN_RATE
        } else {
          const distToUfo = Math.hypot(ufoHitCircle.x - projectile.x, ufoHitCircle.y - projectile.y)
          if (distToUfo <= REGULAR_HOMING_RADIUS) turnRate = REGULAR_HOMING_TURN_RATE
        }

        if (turnRate > 0) {
          const speed = Math.hypot(projectile.vx, projectile.vy)
          const heading = Math.atan2(projectile.vx, projectile.vy)
          const desired = Math.atan2(ufoHitCircle.x - projectile.x, ufoHitCircle.y - projectile.y)
          // Shortest signed angle from heading to desired, wrapped to [-PI, PI].
          const diff = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading))
          const maxTurn = turnRate * dt
          const newHeading = heading + clamp(diff, -maxTurn, maxTurn)
          projectile.vx = Math.sin(newHeading) * speed
          projectile.vy = Math.cos(newHeading) * speed
        }
      }

      const stepX = projectile.vx * dt
      const stepY = projectile.vy * dt
      projectile.x += stepX
      projectile.y += stepY
      projectile.travelled += Math.hypot(stepX, stepY)

      const targetCircle = projectile.owner === 'alien' ? shipHitCircle : ufoHitCircle
      if (targetCircle) {
        const effectiveRadius = targetCircle.radius + (projectile.hitPaddingBonus || 0)
        const hitDistance = Math.hypot(projectile.x - targetCircle.x, projectile.y - targetCircle.y)
        if (hitDistance <= effectiveRadius) {
          if (projectile.owner === 'alien') {
            registerAlienHit(projectile)
          } else {
            registerHit(projectile)
          }
          continue
        }
      }

      if (projectile.travelled >= PROJECTILE_MAX_DISTANCE) {
        registerMiss(projectile)
      }
    }

    // Let the player shoot down incoming alien fire before it connects - any shot that
    // resolved above (hit/miss) is already excluded by the state check, so only
    // still-in-flight shots on both sides are candidates.
    const flyingAlienShots = projectiles.filter(p => p.owner === 'alien' && p.state === 'flying')
    if (flyingAlienShots.length) {
      const flyingPlayerShots = projectiles.filter(p => p.owner !== 'alien' && p.state === 'flying')
      for (const alienShot of flyingAlienShots) {
        const playerShot = flyingPlayerShots.find(p =>
          p.state === 'flying' &&
          Math.hypot(p.x - alienShot.x, p.y - alienShot.y) <= PROJECTILE_INTERCEPT_RADIUS
        )
        if (playerShot) registerIntercept(alienShot, playerShot)
      }
    }

    // Drift/bob floating power-ups, remove any that exit the screen, and check for the
    // ship flying into one. Iterated backwards so splicing mid-loop is safe.
    if (powerUps.length && container.value) {
      const containerWidth = container.value.offsetWidth
      for (let i = powerUps.length - 1; i >= 0; i--) {
        const powerUp = powerUps[i]
        if (powerUp.state !== 'floating') continue

        if (powerUp.spawnTime === null) powerUp.spawnTime = time
        powerUp.x += powerUp.vx * dt
        powerUp.y = powerUp.baseY + Math.sin((time - powerUp.spawnTime) / 1000 * POWERUP_BOB_FREQUENCY * Math.PI * 2) * POWERUP_BOB_AMPLITUDE

        if (powerUp.x < -60 || powerUp.x > containerWidth + 60) {
          powerUps.splice(i, 1)
          continue
        }

        powerUp.radarX = clamp(powerUp.x / radarW, 0, 1)
        powerUp.radarY = clamp(powerUp.y / radarH, 0, 1)

        if (shipHitCircle) {
          const pickupDistance = Math.hypot(powerUp.x - shipHitCircle.x, powerUp.y - shipHitCircle.y)
          if (pickupDistance <= shipHitCircle.radius + POWERUP_COLLECT_PADDING) {
            collectPowerUp(powerUp)
          }
        }
      }
    }

    // Expire the active weapon buff once its time is up.
    if (activeBuffType.value) {
      buffRemainingMs.value = Math.max(0, buffExpiresAt - time)
      if (buffRemainingMs.value <= 0) {
        activeBuffType.value = null
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
  scheduleAlienFire()
  schedulePowerUpSpawn()

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
    clearTimeout(respawnTimeoutId)
    clearTimeout(shipHitTimeoutId)
    clearTimeout(alienFireTimeoutId)
    clearTimeout(powerUpSpawnTimeoutId)
    if (rafId) cancelAnimationFrame(rafId)
  })

  return {
    container,
    ship,
    ufo,
    score,
    bestScore,
    hit,
    shipHit,
    scorePulse,
    hintVisible,
    muted,
    toggleMute,
    level,
    ufoHealth,
    ufoHealthRatio,
    ufoHealthColor,
    ufoDestroyed,
    ufoVisible,
    projectiles,
    warpFlashes,
    powerUps,
    activeBuffType,
    activeBuffLabel,
    activeBuffColor,
    activeBuffSecondsRemaining,
    buffRemainingMs,
    radarShip,
    radarUfo,
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
