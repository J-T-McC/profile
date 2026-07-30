import { ref, reactive, computed, watch, onUnmounted } from 'vue'
import useLocalStore from '@/hooks/useLocalStore'
import shipPhaserUrl from '@/assets/sounds/shipphaser.wav'

const UFO_MAX_SIZE = 75
const UFO_MIN_SIZE = 38 // ~50% of max - floor so the depth illusion doesn't shrink it to a speck
const SHIP_FOLLOW_RATE = 12         // 1/s - how fast the ship closes the gap to its target (higher = snappier)
const ARRIVE_THRESHOLD = 0.5        // px - snap to target once this close, instead of easing forever

// Arrow-key flight: thrust builds velocity, which decays (glide) when the keys release.
const SHIP_ACCEL = 2600             // px/s^2 - thrust acceleration
const SHIP_MAX_SPEED = 620          // px/s - top fly speed
const SHIP_THRUST_FRICTION = 1.5    // 1/s - light velocity decay while thrusting
const SHIP_COAST_FRICTION = 4       // 1/s - stronger decay when coasting, for a short glide to a stop
const SHIP_COAST_STOP = 8           // px/s - below this the ship counts as stopped (click-warp can resume)
const ARROW_DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
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
const WARP_SETTLE_RATE = 10         // exp-decay rate for the warp stretch to settle back (~300ms)
const WARP_FLASH_FADE_DURATION = 380 // ms for the departure-point light burst to fade out

const UFO_MAX_HEALTH = 10           // hits to destroy the UFO and advance a level
const UFO_DESTROYED_FLASH_DURATION = 1200 // ms - bigger flash played on a kill (vs. a regular hit)
const UFO_RESPAWN_DELAY = 2500      // ms the UFO stays gone after being destroyed, before it respawns
const KILL_BONUS_SCORE = 5          // extra points awarded on top of the +1 for the killing hit
const LEVEL_DIFFICULTY_CAP = 10     // level at which reaction-time difficulty maxes out
const ENEMY_WANDER_INTERVAL = 10000 // ms - max idle interval before an enemy drifts to a new spot
const ENEMY_WANDER_STEP = 200       // px - idle wander drifts to a spot within this of the current one
const ENEMY_WANDER_FOLLOW_RATE = 1.1 // 1/s - gentle glide for idle drift (before the level multiplier)
const ENEMY_DODGE_DISTANCE = 150    // px - how far the cube slips when dodging the cursor
const ENEMY_DODGE_SIDESTEP = 0.55   // 0..1 - blend toward a perpendicular sidestep so dodges curve
const ENEMY_DODGE_FOLLOW_RATE = 2.4 // 1/s - quicker but still smooth evasive glide (before the multiplier)
const LEVELS_PER_NEW_ENEMY = 10     // an additional enemy UFO joins the field every this many levels

// "Reaction time" difficulty knobs - how alert/agile the UFO is, scaled by level from an
// easy starting point up toward (and eventually past) a much more alert ceiling. Level 1
// is intentionally quite forgiving - slow to notice you, and lazy once it does - so the
// ramp up to the harder ceiling is more noticeable.
const FLEE_COOLDOWN_START = 1800    // ms - level 1: very slow to react again after fleeing
const FLEE_COOLDOWN_MIN = 250       // ms - reaction time floor at high levels
const FLEE_RADIUS_START = 35        // px - level 1: cursor has to get quite close to spook it
const FLEE_RADIUS_MAX = 130         // px - detection range ceiling at high levels
const UFO_SPEED_MULTIPLIER_START = 0.35 // level 1: dodges away sluggishly
const UFO_SPEED_MULTIPLIER_MAX = 1.2    // dodge speed ceiling at high levels

// The UFO's return fire - unlocked at ALIEN_FIRE_MIN_LEVEL. There's no player health, so
// getting hit instead heals the UFO by 1 - fires rarely right when it unlocks, and more
// often at higher levels, same "reaction time" ramp as the evasion knobs above. Kept
// deliberately modest at both ends - once multiple UFOs are in play at once, the combined
// fire rate will climb on its own without any single one needing to be this aggressive.
const ALIEN_FIRE_MIN_LEVEL = 3
const ALIEN_FIRE_LEVEL_CAP = 25         // level at which a single enemy's fire rate maxes out - much
                                        // higher than LEVEL_DIFFICULTY_CAP so per-enemy fire ramps up
                                        // slowly (extra enemies every 10 levels already add pressure)
const ALIEN_FIRE_COOLDOWN_START = 12000 // ms - quite infrequent right when it unlocks
const ALIEN_FIRE_COOLDOWN_MIN = 4500    // ms - still only every several seconds even at max difficulty
const ALIEN_PROJECTILE_SPEED = 650      // px/s - a bit slower than the player's shots, so it's dodgeable
const ALIEN_HEAL_AMOUNT = 1             // HP restored to the UFO per successful hit
const SHIP_HIT_FLASH_DURATION = 400     // ms - brief flash on the ship when an alien shot connects

// Floating weapon power-ups, starting at level 4 - fly the ship into one to pick it up.
// Weaker/simpler ones are available first, stronger ones only unlock at higher levels, so
// what's on offer ramps up gradually rather than throwing everything in at once.
const POWERUP_MIN_LEVEL = 4
const POWERUP_BUFF_DURATION = 10000  // ms a weapon buff lasts at its base (before the level bonus)
const BUFF_DURATION_PER_LEVEL = 1000 // ms added to a buff/shield's duration per level
const BUFF_DURATION_MAX = 30000      // ms cap on any single buff/shield's total duration
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

// Player health - the UFO's return fire now costs the player a point per unblocked hit
// (and still heals the UFO one). No passive regen; only health pickups restore it.
const PLAYER_MAX_HEALTH = 10
const PLAYER_MAX_LIVES = 3           // lives before it's game over; each death spends one
const SHIP_EXPLOSION_DURATION = 900  // ms the ship's death explosion plays before the prompt
const PLAYER_HIT_DAMAGE = 1          // health lost per unblocked alien hit
const HEALTH_ITEM_RESTORE = 4        // health restored by a health pickup
const SHIELD_BUFF_DURATION = 8000    // ms a shield pickup blocks all incoming hits for
// Defensive pickups (health/shield) get their spawn weight boosted as the player's health
// drops, so they show up more often exactly when you need them. At full health the base
// weight is unchanged; at zero health it's multiplied by (1 + this bonus).
const LOW_HEALTH_DEFENSIVE_WEIGHT_BONUS = 8

// Temporary AI ally (a Star Trek-style starship) - warps in on pickup, patrols the field
// and auto-fires homing phasers at the nearest enemy for its duration, then warps out.
const ALLY_MIN_LEVEL = 5
const ALLY_DURATION = 12000         // base ms the ally fights before warping out (level-scaled)
const ALLY_WARP_IN_DURATION = 700   // ms - must match the ally-warp-in CSS animation
const ALLY_WARP_OUT_DURATION = 700  // ms - must match the ally-warp-out CSS animation
const ALLY_SIZE = 64                // px width of the starship sprite (height is 1.2x)
const SHIP_SIZE = 40                // px width/height of the player ship (Tailwind w-10 h-10)
const ALLY_FOLLOW_RATE = 3          // 1/s - eased-follow rate as it chases its target
const ALLY_ENGAGE_RANGE = 340       // px - the ally must be within this of an enemy to fire
const ALLY_STANDOFF = 150           // px - preferred distance it holds from the enemy it's chasing
const ALLY_FIRE_COOLDOWN = 700      // ms between phaser beams
const ALLY_BEAM_DURATION = 220      // ms a fired phaser beam stays drawn (must match the CSS fade)
const ALLY_PHASER_DAMAGE = 2        // each phaser beam hits hard, like the laser buff
const PHASER_VOLUME = 0.2           // playback gain for the ship-phaser sample

// Power-up categories - weapon buffs are mutually exclusive with each other, but stack
// alongside a shield, health pickups and an ally (you can hold a laser AND a shield AND
// have an ally on the field all at once).
const POWERUP_CATEGORY = {
  WEAPON: 'weapon',
  SHIELD: 'shield',
  HEALTH: 'health',
  ALLY: 'ally',
}

// Floating power-ups. minLevel gates when each first appears; weight biases how often it's
// picked relative to the others (defensive pickups are weighted down so they're rarer).
const POWERUP_TYPES = {
  rapid2: { minLevel: 4, category: POWERUP_CATEGORY.WEAPON, label: '2×', color: '#38bdf8', fireRateMultiplier: 2 },
  rapid3: { minLevel: 5, category: POWERUP_CATEGORY.WEAPON, label: '3×', color: '#818cf8', fireRateMultiplier: 3 },
  double: { minLevel: 5, category: POWERUP_CATEGORY.WEAPON, label: '2•', color: '#facc15', doubleShot: true },
  rapid4: { minLevel: 7, category: POWERUP_CATEGORY.WEAPON, label: '4×', color: '#f472b6', fireRateMultiplier: 4 },
  laser: { minLevel: 10, category: POWERUP_CATEGORY.WEAPON, label: 'L', color: '#34d399', laser: true },
  health: { minLevel: 4, category: POWERUP_CATEGORY.HEALTH, label: '♥', color: '#f87171', weight: 0.5, restore: HEALTH_ITEM_RESTORE },
  shield: { minLevel: 5, category: POWERUP_CATEGORY.SHIELD, label: '⛊', color: '#22d3ee', weight: 0.5, duration: SHIELD_BUFF_DURATION },
  ally: { minLevel: ALLY_MIN_LEVEL, category: POWERUP_CATEGORY.ALLY, label: 'NCC', color: '#a5b4fc', weight: 0.5, duration: ALLY_DURATION },
}


// localStorage keys (via useLocalStore).
const STORE = {
  NAMESPACE: 'spaceGame',
  BEST_SCORE: 'bestScore',
  MUTED: 'muted',
}

// Projectile owner + lifecycle-state values, and power-up lifecycle-state values. Exported
// because SpaceGame.vue's template compares against them too (and SvgWeapon derives its CSS
// class names from owner/state), so both sides share one definition.
export const OWNER = {
  PLAYER: 'player',
  ALIEN: 'alien',
}

export const PROJECTILE_STATE = {
  FLYING: 'flying',
  HIT: 'hit',
  MISS: 'miss',
  INTERCEPTED: 'intercepted',
}

export const POWERUP_STATE = {
  FLOATING: 'floating',
  COLLECTED: 'collected',
}

// Overall run state: PLAYING, PROMPT (ship destroyed with lives left - continue/restart)
// and GAME_OVER (all lives spent). Exported so SpaceGame.vue's overlays can compare against it.
export const GAME_STATE = {
  PLAYING: 'playing',
  PROMPT: 'prompt',
  GAME_OVER: 'gameOver',
}

export default function useSpaceGame (isActive) {
  const container = ref(null)

  const score = ref(0)
  const bestScore = ref(0)
  const scorePulse = ref(false)
  const hintVisible = ref(true)

  const level = ref(1)

  // All active enemy UFOs. Starts at one and grows by one every LEVELS_PER_NEW_ENEMY
  // levels (see enemyCountForLevel / syncEnemyCount). Each enemy owns its full state -
  // position/target/size/health plus its own flee, wander and return-fire timers - and
  // respawns individually on death.
  const enemies = reactive([])
  let nextEnemyId = 0

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
    shield: 'shield',
    health: 'health',
    hp: 'health',
    ally: 'ally',
    enterprise: 'ally',
  }

  // Shared green/amber/red mapping for any 0..1 health ratio (the player and each enemy).
  const healthColor = (ratio) => {
    if (ratio > 0.6) return '#34d399' // green
    if (ratio > 0.3) return '#fbbf24' // amber
    return '#f87171' // red
  }
  const enemyHealthRatio = (enemy) => enemy.health / UFO_MAX_HEALTH

  const highScoreStore = useLocalStore(STORE.NAMESPACE)
  bestScore.value = highScoreStore.get(STORE.BEST_SCORE, 0)

  const muted = ref(highScoreStore.get(STORE.MUTED, false))
  const toggleMute = () => {
    muted.value = !muted.value
    highScoreStore.set(STORE.MUTED, muted.value)
  }

  const projectiles = reactive([])
  let nextProjectileId = 0

  const warpFlashes = reactive([])
  let nextWarpFlashId = 0

  const powerUps = reactive([])
  let nextPowerUpId = 0
  let powerUpSpawnTimeoutId = null

  // Weapon buff (mutually exclusive among weapon types) and shield (stacks with it) each
  // run on their own countdown; health pickups are instant, so they have no active state.
  const activeWeaponBuff = ref(null)
  let weaponBuffExpiresAt = 0
  const weaponBuffRemainingMs = ref(0)

  const shieldActive = ref(false)
  let shieldExpiresAt = 0
  const shieldRemainingMs = ref(0)

  const playerHealth = ref(PLAYER_MAX_HEALTH)
  const playerHealthRatio = computed(() => playerHealth.value / PLAYER_MAX_HEALTH)
  const playerHealthColor = computed(() => healthColor(playerHealthRatio.value))

  // Lives + overall run state. When health hits 0 the ship explodes (shipExplosion), a life
  // is spent, and the run either offers a continue/restart prompt or ends (see killPlayer).
  const lives = ref(PLAYER_MAX_LIVES)
  const gameState = ref(GAME_STATE.PLAYING)
  const shipExplosion = reactive({ active: false, x: 0, y: 0 })

  // The temporary AI ally. Position/angle are JS-driven each frame (like the enemies);
  // `active` gates rendering and `phase` ('in' | 'active' | 'out') drives the warp
  // animation. Only one is ever on the field; picking up another just refreshes its timer.
  const ally = reactive({
    active: false,
    phase: 'idle',
    x: 0, y: 0,
    targetX: 0, targetY: 0,
    angle: 180,
    nextFireAt: 0,
    radarX: 0.5, radarY: 0.5,
    // Phaser beam: a straight line drawn from the ally to the enemy it just struck,
    // held for ALLY_BEAM_DURATION. Endpoints are snapshotted (container coords) at fire time.
    beamActive: false,
    beamUntil: 0,
    beamX1: 0, beamY1: 0, beamX2: 0, beamY2: 0,
  })
  let allyExpiresAt = 0
  const allyRemainingMs = ref(0)
  let allyPhaseTimeoutId = null

  // The timed buffs currently showing in the HUD, each as its own countdown badge.
  const activeBuffs = computed(() => {
    const list = []
    if (activeWeaponBuff.value) {
      const type = POWERUP_TYPES[activeWeaponBuff.value]
      list.push({ id: 'weapon', label: type.label, color: type.color, seconds: Math.ceil(weaponBuffRemainingMs.value / 1000) })
    }
    if (shieldActive.value) {
      const type = POWERUP_TYPES.shield
      list.push({ id: 'shield', label: type.label, color: type.color, seconds: Math.ceil(shieldRemainingMs.value / 1000) })
    }
    if (ally.active) {
      const type = POWERUP_TYPES.ally
      list.push({ id: 'ally', label: type.label, color: type.color, seconds: Math.ceil(allyRemainingMs.value / 1000) })
    }
    return list
  })

  // Radar minimap - the ship's field position, normalised to 0..1 of the container each
  // frame in tick() (the raw shipX/Y vars aren't reactive), so the radar can plot it as a
  // fraction of its diameter regardless of pixel size. Each enemy carries its own
  // normalised radarX/radarY on the enemy object.
  const radarShip = reactive({ x: 0.5, y: 0.5 })

  const shipAngle = ref(0)
  let hasFacing = false
  let shipStretch = 1 // 1 = normal; briefly pushed higher for the warp squash-and-stretch pop

  const shipHit = ref(false) // brief flash when the alien's return fire connects
  let shipHitTimeoutId = null


  // Numeric ship position/target driving the per-frame movement loop. World space:
  // container pixels, origin at the container's top-left, +x right, +y down (see
  // pointerToWorld). shipX/shipY is the ship's CENTRE - so it moves to, fires from, and
  // aims around the middle. Everything - ship, enemies, projectiles, pointer - lives here.
  let shipX = 0
  let shipY = 0
  let shipTargetX = 0
  let shipTargetY = 0

  // Arrow-key flight velocity + which direction keys are currently held.
  let shipVX = 0
  let shipVY = 0
  const heldKeys = { up: false, down: false, left: false, right: false }

  // Last known cursor position (same coordinate space as the ship/enemies), used so
  // enemies can continuously evade a lingering cursor rather than only reacting once.
  let lastPointerX = null
  let lastPointerY = null

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
  // ALIEN_FIRE_LEVEL_CAP - its own, much slower curve (separate from getLevelProgress) so a
  // single enemy's fire rate creeps up gradually rather than maxing out by level 10.
  const getAlienFireProgress = () => clamp((level.value - ALIEN_FIRE_MIN_LEVEL) / (ALIEN_FIRE_LEVEL_CAP - ALIEN_FIRE_MIN_LEVEL), 0, 1)
  const getAlienFireCooldown = () => ALIEN_FIRE_COOLDOWN_START - getAlienFireProgress() * (ALIEN_FIRE_COOLDOWN_START - ALIEN_FIRE_COOLDOWN_MIN)

  // Which power-up types are allowed to spawn at the current level - grows as level
  // increases, so stronger buffs only start showing up once you've levelled up enough.
  const getAvailablePowerUpTypeIds = () => Object.keys(POWERUP_TYPES).filter(id => level.value >= POWERUP_TYPES[id].minLevel)
  const getActiveWeaponBuff = () => activeWeaponBuff.value ? POWERUP_TYPES[activeWeaponBuff.value] : null

  // Buffs and shields last longer the higher your level, from their base duration up to a
  // capped maximum, so pickups stay relevant as fights get longer.
  const scaledBuffDuration = (base) => Math.min(base + (level.value - 1) * BUFF_DURATION_PER_LEVEL, BUFF_DURATION_MAX)

  // A type's spawn weight, with defensive pickups (health/shield) boosted as the player's
  // health drops - at full health it's the base weight, at zero health it's scaled up by
  // (1 + LOW_HEALTH_DEFENSIVE_WEIGHT_BONUS) so they show up more often when you're hurt.
  const getPowerUpWeight = (id) => {
    const type = POWERUP_TYPES[id]
    const base = type.weight ?? 1
    const isDefensive = type.category === POWERUP_CATEGORY.HEALTH || type.category === POWERUP_CATEGORY.SHIELD
    if (!isDefensive) return base
    return base * (1 + (1 - playerHealthRatio.value) * LOW_HEALTH_DEFENSIVE_WEIGHT_BONUS)
  }

  // Weighted random pick from the given power-up type ids - lets defensive pickups
  // (health/shield, given a lower weight) show up less often than weapon buffs, except
  // when the player is low on health (see getPowerUpWeight).
  const pickWeightedPowerUpType = (ids) => {
    const total = ids.reduce((sum, id) => sum + getPowerUpWeight(id), 0)
    let roll = Math.random() * total
    for (const id of ids) {
      roll -= getPowerUpWeight(id)
      if (roll <= 0) return id
    }
    return ids[ids.length - 1]
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

  // The ally phaser is a real sample (the rest are synthesized). A plain HTMLAudioElement
  // plays it with directly-controllable volume; a fresh clone per shot lets rapid fire
  // overlap. The file is fetched once, then served from cache.
  const phaserAudio = typeof Audio !== 'undefined' ? new Audio(shipPhaserUrl) : null
  if (phaserAudio) phaserAudio.preload = 'auto'

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

  // The ally's phaser - a bright, hard-edged descending zap, distinct from the player's
  // own softer laser and the enemy's coarse sawtooth.
  const playPhaserSound = () => {
    if (muted.value || !phaserAudio) return
    const a = phaserAudio.cloneNode() // fresh instance so rapid shots can overlap
    a.volume = PHASER_VOLUME
    a.play().catch(() => {})
  }

  // A rising, shimmering whoosh for the ally warping in or out.
  const playWarpSound = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(180, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(1600, ctx.currentTime + 0.35)
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.1)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.42)
  }

  // How many enemies should be on the field at a given level - one to start, plus one more
  // every LEVELS_PER_NEW_ENEMY levels (so a new bad guy joins at that level, 2x it, 3x it, ...).
  const enemyCountForLevel = (lvl) => 1 + Math.floor(lvl / LEVELS_PER_NEW_ENEMY)

  const createEnemy = () => ({
    id: nextEnemyId++,
    x: -1000, y: -1000,          // top/left in container coords, JS-driven each frame
    targetX: -1000, targetY: -1000,
    followRate: 3,               // 1/s - eased-follow rate toward the target
    size: 40,                    // px (also drives the depth-illusion brightness/z-index)
    brightness: 100,
    zIndex: 1,
    transitionDuration: '1s',    // CSS morph time for the size/depth change
    health: UFO_MAX_HEALTH,
    visible: true,
    destroyed: false,            // brief kill-flash
    hit: false,                  // brief red hit-flash
    placed: false,               // false until first positioned (so it snaps, not glides, in)
    lastFleeTime: 0,
    nextWanderAt: 0,
    nextFireAt: 0,
    radarX: 0.5, radarY: 0.5,
    hitTimeoutId: null,
    destroyedTimeoutId: null,
    respawnTimeoutId: null,
  })

  // Re-rolls an enemy's size (depth illusion), speed and next drift target. On the very
  // first placement it snaps straight there rather than gliding in from off-screen.
  // Re-rolls only the depth-illusion look (size/brightness/z) + the base follow pace, without
  // moving the enemy. Used both by randomizeEnemy and by the occasional idle "breathing".
  const rerollEnemyDepth = (enemy) => {
    const durationSeconds = Math.ceil(Math.random() * 3)
    const size = Math.round(UFO_MIN_SIZE + Math.random() * (UFO_MAX_SIZE - UFO_MIN_SIZE))
    enemy.size = size
    enemy.brightness = Math.max(40, (size / UFO_MAX_SIZE) * 100)
    enemy.zIndex = size >= (UFO_MAX_SIZE * 0.8) ? 12 : 1
    enemy.transitionDuration = durationSeconds + 's'
    enemy.followRate = (3 / durationSeconds) * getUfoSpeedMultiplier()
  }

  const randomizeEnemy = (enemy) => {
    if (!container.value) return
    rerollEnemyDepth(enemy)

    const offset = Math.random() < 0.5 ? -100 : 100
    const containerWidth = container.value.offsetWidth
    const containerHeight = container.value.offsetHeight
    enemy.targetY = clamp(Math.random() * containerHeight + offset, 0, Math.max(containerHeight - enemy.size, 0))
    enemy.targetX = clamp(Math.random() * containerWidth + offset, 0, Math.max(containerWidth - enemy.size, 0))

    if (!enemy.placed) {
      enemy.x = enemy.targetX
      enemy.y = enemy.targetY
      enemy.placed = true
    }
  }

  // Idle drift: ease toward a spot near the current one (gentle, not a screen-wide hop).
  const wanderNearby = (enemy, w, h) => {
    enemy.targetX = clamp(enemy.x + (Math.random() * 2 - 1) * ENEMY_WANDER_STEP, 0, Math.max(w - enemy.size, 0))
    enemy.targetY = clamp(enemy.y + (Math.random() * 2 - 1) * ENEMY_WANDER_STEP, 0, Math.max(h - enemy.size, 0))
    enemy.followRate = ENEMY_WANDER_FOLLOW_RATE * getUfoSpeedMultiplier()
  }

  // Evade: slide a bounded distance away from the cursor, blended with a perpendicular
  // sidestep (alternating sides) so the dodge curves rather than darting in a straight line.
  const dodgeCursor = (enemy, w, h) => {
    const cx = enemy.x + enemy.size / 2
    const cy = enemy.y + enemy.size / 2
    let ax = cx - lastPointerX
    let ay = cy - lastPointerY
    const len = Math.hypot(ax, ay) || 1
    ax /= len; ay /= len
    const side = Math.random() < 0.5 ? 1 : -1
    let dx = ax * (1 - ENEMY_DODGE_SIDESTEP) + (-ay * side) * ENEMY_DODGE_SIDESTEP
    let dy = ay * (1 - ENEMY_DODGE_SIDESTEP) + (ax * side) * ENEMY_DODGE_SIDESTEP
    const dl = Math.hypot(dx, dy) || 1
    dx /= dl; dy /= dl
    const dist = ENEMY_DODGE_DISTANCE * (0.7 + Math.random() * 0.6)
    enemy.targetX = clamp(enemy.x + dx * dist, 0, Math.max(w - enemy.size, 0))
    enemy.targetY = clamp(enemy.y + dy * dist, 0, Math.max(h - enemy.size, 0))
    enemy.followRate = ENEMY_DODGE_FOLLOW_RATE * getUfoSpeedMultiplier()
  }

  // Grows the live enemy list to match the current level (never shrinks - enemies persist
  // and respawn individually; only the count going up matters here).
  const syncEnemyCount = () => {
    const target = enemyCountForLevel(level.value)
    while (enemies.length < target) {
      const enemy = createEnemy()
      enemies.push(enemy)
      randomizeEnemy(enemy)
    }
  }

  // The enemy's live on-screen hit circle, computed straight from its JS-tracked position
  // and size (no DOM read needed, since tick() drives its top/left every frame).
  const getEnemyHitCircle = (enemy) => ({
    x: enemy.x + enemy.size / 2,
    y: enemy.y + enemy.size / 2,
    radius: enemy.size / 2 + PROJECTILE_HIT_PADDING,
  })

  // --- Coordinate bridge -----------------------------------------------------
  // Single source of truth for turning a pointer event into world coordinates.
  // World space = container pixels: origin at the container's top-left, +x right,
  // +y down. Every input handler (and, from Phase 2 on, the Three.js renderer)
  // shares this one space, so nothing needs to measure the DOM to reason about
  // where things are. Both axes are container-relative here; the original code
  // leaned on #about spanning the full page width to treat x as viewport-relative,
  // which was fragile off the left edge / in other layouts.
  const pointerToWorld = (event) => {
    const rect = container.value.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  const rotateShip = (event) => {
    if (!container.value) return
    dismissHint()

    const pointer = pointerToWorld(event)
    lastPointerX = pointer.x
    lastPointerY = pointer.y

    // Aim from the ship's centre (shipX/shipY) - no DOM measurement.
    const radians = Math.atan2(pointer.x - shipX, pointer.y - shipY)
    const degree = (radians * (180 / Math.PI) * -1) + 180

    shipAngle.value = degree
    hasFacing = true
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

  // Purely a visual flourish for a "fly here" click - snaps the ship into a stretched pose
  // that the render loop then eases back to neutral (see the shipStretch settle in tick),
  // plus a light burst at the departure point. Doesn't touch shipX/Y/target, so it can't
  // affect actual movement.
  const triggerWarpEffect = () => {
    spawnWarpFlash(shipX, shipY)
    shipStretch = WARP_STRETCH
  }

  // The player's own ship hit circle, straight from its JS-tracked centre and fixed size -
  // no DOM read. A constant radius gives a steadier hitbox than the old transformed-
  // bounding-box read, which grew and shrank as the ship rotated.
  const getShipHitCircle = () => ({
    x: shipX,
    y: shipY,
    radius: SHIP_SIZE / 2 + PROJECTILE_HIT_PADDING,
  })

  // Snapshot of the ship's render state for the Three.js renderer, which polls it
  // once per frame. A plain getter (rather than exposing refs) keeps the hot-path
  // shipX/shipY/shipStretch as module-local lets. Position is the ship's centre;
  // angle is degrees, stretch is the warp factor.
  const getShipRenderState = () => ({
    x: shipX,
    y: shipY,
    angle: shipAngle.value,
    stretch: shipStretch,
    visible: gameState.value === GAME_STATE.PLAYING && !shipExplosion.active,
    hit: shipHit.value,
    shielded: shieldActive.value,
  })

  // The core of a hit landing on an enemy - scoring, health/kill/respawn handling and the
  // hit/kill feedback - independent of what dealt it, so both a player projectile
  // (damageEnemy) and the ally's instantaneous phaser beam can share it.
  const applyDamageToEnemy = (enemy, amount) => {
    score.value++
    scorePulse.value = true

    enemy.health = Math.max(0, enemy.health - amount)

    if (enemy.health === 0) {
      // Destroyed - bigger flash/sound, level up (harder reaction time from here on), then
      // this enemy stays gone for a beat before respawning at full health. A new level may
      // also unlock an additional enemy (every LEVELS_PER_NEW_ENEMY levels).
      score.value += KILL_BONUS_SCORE
      playDestroyedSound()

      enemy.destroyed = true
      clearTimeout(enemy.destroyedTimeoutId)
      enemy.destroyedTimeoutId = setTimeout(() => {
        enemy.destroyed = false
      }, UFO_DESTROYED_FLASH_DURATION)

      level.value++
      enemy.visible = false

      clearTimeout(enemy.respawnTimeoutId)
      enemy.respawnTimeoutId = setTimeout(() => {
        enemy.health = UFO_MAX_HEALTH
        enemy.placed = false // snap to the fresh spot rather than gliding from the kill site
        randomizeEnemy(enemy)
        enemy.visible = true
      }, UFO_RESPAWN_DELAY)

      syncEnemyCount()
    } else {
      playExplosionSound()
      enemy.hit = true
      clearTimeout(enemy.hitTimeoutId)
      enemy.hitTimeoutId = setTimeout(() => {
        enemy.hit = false
      }, UFO_HIT_FLASH_DURATION)

      // Getting shot (but not destroyed) spooks it into an immediate dodge to a new spot.
      randomizeEnemy(enemy)
    }

    if (score.value > bestScore.value) {
      bestScore.value = score.value
      highScoreStore.set(STORE.BEST_SCORE, bestScore.value)
    }

    clearTimeout(scorePulseTimeoutId)
    scorePulseTimeoutId = setTimeout(() => {
      scorePulse.value = false
    }, SCORE_PULSE_DURATION)
  }

  // A player projectile landing: mark it hit, apply the damage, then clear it after the
  // hit-burst animation.
  const damageEnemy = (enemy, projectile) => {
    projectile.state = PROJECTILE_STATE.HIT
    applyDamageToEnemy(enemy, projectile.damage || 1)

    setTimeout(() => {
      const index = projectiles.indexOf(projectile)
      if (index !== -1) projectiles.splice(index, 1)
    }, HIT_ANIM_DURATION)
  }

  const registerMiss = (projectile) => {
    projectile.state = PROJECTILE_STATE.MISS
    setTimeout(() => {
      const index = projectiles.indexOf(projectile)
      if (index !== -1) projectiles.splice(index, 1)
    }, MISS_ANIM_DURATION)
  }

  // Health hit zero: blow the ship up, spend a life, and after the explosion plays either
  // offer a continue/restart prompt (lives remaining) or end the run (game over). Freezes
  // the sim immediately via shipExplosion so nothing can pile on during the blast.
  const killPlayer = () => {
    if (gameState.value !== GAME_STATE.PLAYING || shipExplosion.active) return

    playDestroyedSound()
    shipExplosion.x = shipX // shipX/shipY is already the ship's centre
    shipExplosion.y = shipY
    shipExplosion.active = true
    lives.value = Math.max(0, lives.value - 1)

    setTimeout(() => {
      shipExplosion.active = false
      gameState.value = lives.value > 0 ? GAME_STATE.PROMPT : GAME_STATE.GAME_OVER
    }, SHIP_EXPLOSION_DURATION)
  }

  // The UFO's return fire connecting - the player loses a health point (and the shooter
  // heals one). If that empties the health bar, the ship is destroyed (killPlayer).
  const registerAlienHit = (projectile) => {
    projectile.state = PROJECTILE_STATE.HIT

    if (shieldActive.value) {
      // Shield up: the shot is deflected entirely - no player damage, no enemy heal.
      playInterceptSound()
    } else {
      // Otherwise the player loses a point and the enemy that fired it heals one.
      playerHealth.value = Math.max(0, playerHealth.value - PLAYER_HIT_DAMAGE)
      const shooter = enemies.find(e => e.id === projectile.shooterId)
      if (shooter) shooter.health = Math.min(UFO_MAX_HEALTH, shooter.health + ALIEN_HEAL_AMOUNT)
      playHealSound()

      shipHit.value = true
      clearTimeout(shipHitTimeoutId)
      shipHitTimeoutId = setTimeout(() => {
        shipHit.value = false
      }, SHIP_HIT_FLASH_DURATION)

      if (playerHealth.value === 0) killPlayer()
    }

    setTimeout(() => {
      const index = projectiles.indexOf(projectile)
      if (index !== -1) projectiles.splice(index, 1)
    }, HIT_ANIM_DURATION)
  }

  // A player shot getting close enough to an in-flight alien shot destroys both -
  // lets the player shoot down incoming fire before it reaches (and heals) the UFO.
  const registerIntercept = (alienShot, playerShot) => {
    alienShot.state = PROJECTILE_STATE.INTERCEPTED
    playerShot.state = PROJECTILE_STATE.INTERCEPTED
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
    const multiplier = getActiveWeaponBuff()?.fireRateMultiplier ?? 1
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

    const buff = getActiveWeaponBuff()
    const isLaser = !!buff?.laser
    const speed = isLaser ? PROJECTILE_SPEED * LASER_SPEED_MULTIPLIER : PROJECTILE_SPEED
    const hitPaddingBonus = isLaser ? LASER_HIT_PADDING_BONUS : 0

    const spawnShot = (angleOffset) => {
      const radians = directionRadians + angleOffset
      projectiles.push({
        id: nextProjectileId++,
        owner: OWNER.PLAYER,
        x: originX,
        y: originY,
        vx: Math.sin(radians) * speed,
        vy: Math.cos(radians) * speed,
        travelled: 0,
        state: PROJECTILE_STATE.FLYING,
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

  // Remove a projectile by id - e.g. it was used up striking a background asteroid. Owned
  // by the renderer (which handles asteroid collision), so it's exposed for that.
  const consumeProjectile = (id) => {
    const index = projectiles.findIndex(p => p.id === id)
    if (index !== -1) projectiles.splice(index, 1)
  }

  // An enemy's own return shot, aimed at the ship's current position (no lead/prediction,
  // same simple aim model as the player's shots) and a bit slower, so it's dodgeable. Tagged
  // with shooterId so a landed hit heals the specific enemy that fired it. Scheduling is
  // driven per-enemy from tick() via each enemy's nextFireAt, so overall fire rate scales
  // naturally with the number of enemies on the field.
  const fireEnemyShot = (enemy) => {
    const cx = enemy.x + enemy.size / 2
    const cy = enemy.y + enemy.size / 2
    const radians = Math.atan2(shipX - cx, shipY - cy)
    playAlienLaserSound()

    projectiles.push({
      id: nextProjectileId++,
      owner: OWNER.ALIEN,
      shooterId: enemy.id,
      x: cx,
      y: cy,
      vx: Math.sin(radians) * ALIEN_PROJECTILE_SPEED,
      vy: Math.cos(radians) * ALIEN_PROJECTILE_SPEED,
      travelled: 0,
      state: PROJECTILE_STATE.FLYING,
    })
  }

  // --- Temporary AI ally (starship) --------------------------------------------------

  const allyCenterX = () => ally.x + ALLY_SIZE / 2
  const allyCenterY = () => ally.y + (ALLY_SIZE * 1.2) / 2

  // The live enemy nearest a point, used by the ally to pick a phaser target.
  const nearestVisibleEnemy = (x, y) => {
    let best = null
    let bestDist = Infinity
    for (const enemy of enemies) {
      if (!enemy.visible || enemy.health <= 0) continue
      const d = Math.hypot((enemy.x + enemy.size / 2) - x, (enemy.y + enemy.size / 2) - y)
      if (d < bestDist) { bestDist = d; best = enemy }
    }
    return best
  }

  // The ally's phaser - an instantaneous beam (like the show) rather than a travelling
  // bolt. It connects immediately, so damage is applied at once and a straight line is
  // drawn from the ally to the point of impact, held briefly (ALLY_BEAM_DURATION). The
  // endpoints are snapshotted here so the beam doesn't whip around as both ships keep moving.
  const fireAllyBeam = (enemy, now) => {
    const ex = enemy.x + enemy.size / 2
    const ey = enemy.y + enemy.size / 2

    ally.beamX1 = allyCenterX()
    ally.beamY1 = allyCenterY()
    ally.beamX2 = ex
    ally.beamY2 = ey
    ally.beamActive = true
    ally.beamUntil = now + ALLY_BEAM_DURATION
    ally.angle = (Math.atan2(ex - ally.beamX1, ey - ally.beamY1) * (180 / Math.PI) * -1) + 180

    playPhaserSound()
    applyDamageToEnemy(enemy, ALLY_PHASER_DAMAGE)
  }

  // Warps the ally in near the ship, or - if one's already on the field - just refreshes
  // its timer instead of re-warping (avoids a jarring re-entry flicker on a repeat pickup).
  const summonAlly = (now = performance.now()) => {
    if (!container.value) return
    const duration = scaledBuffDuration(ALLY_DURATION)
    allyExpiresAt = now + duration
    allyRemainingMs.value = duration

    if (ally.active) return

    const w = container.value.offsetWidth
    const h = container.value.offsetHeight
    ally.x = clamp(shipX + 90, 0, Math.max(w - ALLY_SIZE, 0))
    ally.y = clamp(shipY - 90, 0, Math.max(h - ALLY_SIZE * 1.2, 0))
    ally.targetX = ally.x
    ally.targetY = ally.y
    ally.angle = 180
    ally.active = true
    ally.phase = 'in'
    ally.beamActive = false
    ally.nextFireAt = now + ALLY_WARP_IN_DURATION + 200 // hold fire until it's finished warping in

    spawnWarpFlash(allyCenterX(), allyCenterY())
    playWarpSound()

    clearTimeout(allyPhaseTimeoutId)
    allyPhaseTimeoutId = setTimeout(() => {
      if (ally.active) ally.phase = 'active'
    }, ALLY_WARP_IN_DURATION)
  }

  // Plays the warp-out animation, then removes the ally once it's finished.
  const beginAllyWarpOut = () => {
    ally.phase = 'out'
    spawnWarpFlash(allyCenterX(), allyCenterY())
    playWarpSound()

    clearTimeout(allyPhaseTimeoutId)
    allyPhaseTimeoutId = setTimeout(() => {
      ally.active = false
      ally.phase = 'idle'
    }, ALLY_WARP_OUT_DURATION)
  }

  // Drifts a weapon power-up in from one side of the screen - removed automatically
  // after POWERUP_LIFESPAN if the player never flies into it.
  const spawnPowerUp = () => {
    if (!container.value) return
    const availableIds = getAvailablePowerUpTypeIds()
    if (!availableIds.length) return

    const type = pickWeightedPowerUpType(availableIds)
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
      state: POWERUP_STATE.FLOATING,
      radarX: 0.5,
      radarY: 0.5,
    })

    setTimeout(() => {
      const index = powerUps.findIndex(p => p.id === id)
      if (index !== -1 && powerUps[index].state === POWERUP_STATE.FLOATING) {
        powerUps.splice(index, 1)
      }
    }, POWERUP_LIFESPAN)
  }

  // Keeps rescheduling regardless of level - only actually spawns once level reaches
  // POWERUP_MIN_LEVEL, so pickups kick in immediately once the player gets there.
  const schedulePowerUpSpawn = () => {
    const delay = POWERUP_SPAWN_INTERVAL_MIN + Math.random() * (POWERUP_SPAWN_INTERVAL_MAX - POWERUP_SPAWN_INTERVAL_MIN)
    powerUpSpawnTimeoutId = setTimeout(() => {
      if (gameState.value === GAME_STATE.PLAYING && level.value >= POWERUP_MIN_LEVEL) {
        spawnPowerUp()
      }
      schedulePowerUpSpawn()
    }, delay)
  }

  // Applies a power-up by type id, dispatching on its category (weapon buff / shield /
  // instant heal). The expiry timestamps live on the same clock as the tick loop's `time`
  // (both DOMHighResTimeStamp), so performance.now() is interchangeable whether this is
  // triggered from a pickup mid-frame or a keydown cheat.
  const applyPowerUp = (typeId, now = performance.now()) => {
    const type = POWERUP_TYPES[typeId]
    if (!type) return

    if (type.category === POWERUP_CATEGORY.WEAPON) {
      // Weapon buffs are mutually exclusive - a new one replaces/refreshes the last.
      const duration = scaledBuffDuration(POWERUP_BUFF_DURATION)
      activeWeaponBuff.value = typeId
      weaponBuffExpiresAt = now + duration
      weaponBuffRemainingMs.value = duration
      playPowerUpSound()
    } else if (type.category === POWERUP_CATEGORY.SHIELD) {
      // Shield stacks alongside any weapon buff; a new one just refreshes the timer.
      const duration = scaledBuffDuration(type.duration)
      shieldActive.value = true
      shieldExpiresAt = now + duration
      shieldRemainingMs.value = duration
      playPowerUpSound()
    } else if (type.category === POWERUP_CATEGORY.HEALTH) {
      // Instant restore, capped at full health.
      playerHealth.value = Math.min(PLAYER_MAX_HEALTH, playerHealth.value + type.restore)
      playHealSound()
    } else if (type.category === POWERUP_CATEGORY.ALLY) {
      // Warps in a temporary AI ally (or refreshes the current one's timer).
      summonAlly(now)
    }
  }

  // Flying into a power-up immediately applies its effect - weapon buffs replace each
  // other, while a shield or a heal stacks alongside whatever weapon buff is active.
  const collectPowerUp = (powerUp) => {
    powerUp.state = POWERUP_STATE.COLLECTED
    applyPowerUp(powerUp.type)

    setTimeout(() => {
      const index = powerUps.indexOf(powerUp)
      if (index !== -1) powerUps.splice(index, 1)
    }, POWERUP_COLLECT_ANIM_DURATION)
  }

  // Fires along the direction the ship is currently facing - used for keyboard shooting,
  // since a KeyboardEvent has no x/y to fire at like a mouse click does.
  const fireForward = () => {
    // Nothing sensible to fire at until the ship has faced a direction at least once
    // (e.g. Space pressed before any mouse movement), and not while paused/dead.
    if (!hasFacing || gameState.value !== GAME_STATE.PLAYING) return

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
    playerHealth.value = PLAYER_MAX_HEALTH

    // Reset every current enemy to full health at the new difficulty, then top the count up
    // to match the target level's expected number of bad guys.
    enemies.forEach((enemy) => {
      clearTimeout(enemy.respawnTimeoutId)
      clearTimeout(enemy.destroyedTimeoutId)
      clearTimeout(enemy.hitTimeoutId)
      enemy.health = UFO_MAX_HEALTH
      enemy.destroyed = false
      enemy.visible = true
      enemy.hit = false
      randomizeEnemy(enemy)
    })
    syncEnemyCount()
  }

  const onKeyDown = (event) => {
    const dir = ARROW_DIRS[event.key]
    if (dir) {
      event.preventDefault() // don't scroll the page
      dismissHint()
      heldKeys[dir] = true
      return
    }

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
        if (buffCode) applyPowerUp(BUFF_CHEAT_CODES[buffCode])
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

  const onKeyUp = (event) => {
    const dir = ARROW_DIRS[event.key]
    if (dir) {
      event.preventDefault()
      heldKeys[dir] = false
    }
  }

  const ufoClicked = (event) => {
    if (gameState.value !== GAME_STATE.PLAYING) return
    dismissHint()
    const pointer = pointerToWorld(event)
    const radians = Math.atan2(pointer.x - shipX, pointer.y - shipY)
    fireAt(shipX, shipY, radians)
  }

  const moveShip = (event) => {
    if (gameState.value !== GAME_STATE.PLAYING) return
    dismissHint()

    const pointer = pointerToWorld(event)
    shipTargetX = pointer.x
    shipTargetY = pointer.y
    triggerWarpEffect()
  }

  // Single click entry point for the game overlay. With the UFOs rendered in-canvas
  // there are no per-UFO DOM click targets anymore, so we hit-test here: a click on a
  // live enemy fires at it, otherwise it's a "fly here" move. This replaces the old
  // split of @click.stop on each UFO (fire) vs @click on the overlay (move).
  const handleClick = (event) => {
    if (gameState.value !== GAME_STATE.PLAYING) return
    const p = pointerToWorld(event)
    const onEnemy = enemies.some((enemy) => {
      if (!enemy.visible || enemy.health <= 0) return false
      const c = getEnemyHitCircle(enemy)
      return Math.hypot(p.x - c.x, p.y - c.y) <= c.radius
    })
    if (onEnemy) ufoClicked(event)
    else moveShip(event)
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

    // Frozen while the ship is exploding or a prompt/game-over overlay is up: keep the loop
    // alive (so we can resume) but run no simulation. lastFrameTime is still advanced above,
    // so dt stays small when play resumes.
    if (gameState.value !== GAME_STATE.PLAYING || shipExplosion.active) {
      rafId = requestAnimationFrame(tick)
      return
    }

    const radarW = container.value.offsetWidth
    const radarH = container.value.offsetHeight

    // Arrow-key flight. Held keys thrust the ship (building velocity), it faces its travel
    // direction, and it coasts to a stop when released. Thrusting pins the click-warp target
    // to the current spot so the two control schemes don't fight.
    let ix = (heldKeys.right ? 1 : 0) - (heldKeys.left ? 1 : 0)
    let iy = (heldKeys.down ? 1 : 0) - (heldKeys.up ? 1 : 0)
    const thrusting = ix !== 0 || iy !== 0
    if (thrusting) {
      const il = Math.hypot(ix, iy)
      ix /= il; iy /= il
      shipVX += ix * SHIP_ACCEL * dt
      shipVY += iy * SHIP_ACCEL * dt
      // Face the travel direction. The rendered nose points (sin a, cos a) in screen space
      // (y up), while world +y is down, so the vertical input is negated to line the nose
      // (and Space fire, which follows it) up with the way we're actually moving.
      shipAngle.value = Math.atan2(ix, -iy) * (180 / Math.PI)
      hasFacing = true
    }
    // Clamp speed, then decay (lightly while thrusting, harder while coasting).
    const speed = Math.hypot(shipVX, shipVY)
    if (speed > SHIP_MAX_SPEED) {
      const s = SHIP_MAX_SPEED / speed
      shipVX *= s; shipVY *= s
    }
    const decay = Math.exp(-(thrusting ? SHIP_THRUST_FRICTION : SHIP_COAST_FRICTION) * dt)
    shipVX *= decay; shipVY *= decay
    shipX += shipVX * dt
    shipY += shipVY * dt

    // While the ship is under velocity control, keep the target pinned so the warp-ease stays
    // idle; only when stopped does a click-warp target take over and ease the ship in.
    if (thrusting || Math.hypot(shipVX, shipVY) > SHIP_COAST_STOP) {
      shipTargetX = shipX
      shipTargetY = shipY
    } else {
      // Ease the ship toward its (click-warp) target - starts fast, decelerates into place.
      const dx = shipTargetX - shipX
      const dy = shipTargetY - shipY
      if (Math.hypot(dx, dy) > ARRIVE_THRESHOLD) {
        const followT = 1 - Math.exp(-SHIP_FOLLOW_RATE * dt)
        shipX += dx * followT
        shipY += dy * followT
      } else {
        shipX = shipTargetX
        shipY = shipTargetY
      }
    }

    // Keep the ship on the field (shipX/shipY is the centre, so inset by half its size),
    // killing only the into-wall velocity so it slides along edges instead of sticking.
    const minX = SHIP_SIZE / 2
    const maxX = Math.max(minX, radarW - SHIP_SIZE / 2)
    const minY = SHIP_SIZE / 2
    const maxY = Math.max(minY, radarH - SHIP_SIZE / 2)
    if (shipX < minX) { shipX = minX; if (shipVX < 0) shipVX = 0 } else if (shipX > maxX) { shipX = maxX; if (shipVX > 0) shipVX = 0 }
    if (shipY < minY) { shipY = minY; if (shipVY < 0) shipVY = 0 } else if (shipY > maxY) { shipY = maxY; if (shipVY > 0) shipVY = 0 }

    // Warp squash-and-stretch eases back to neutral here (the renderer reads shipStretch
    // directly each frame), replacing the old CSS-transition-driven settle.
    if (shipStretch !== 1) {
      shipStretch = 1 + (shipStretch - 1) * Math.exp(-WARP_SETTLE_RATE * dt)
      if (Math.abs(shipStretch - 1) < 0.01) shipStretch = 1
    }

    radarShip.x = clamp(shipX / radarW, 0, 1)
    radarShip.y = clamp(shipY / radarH, 0, 1)

    // Move, retarget (wander/flee), radar-plot and return-fire each enemy. Same smoothing
    // as the ship: continuous convergence each frame so repeated retargeting blends smoothly.
    for (const enemy of enemies) {
      const edx = enemy.targetX - enemy.x
      const edy = enemy.targetY - enemy.y
      if (Math.hypot(edx, edy) > ARRIVE_THRESHOLD) {
        const t = 1 - Math.exp(-enemy.followRate * dt)
        enemy.x += edx * t
        enemy.y += edy * t
      } else {
        enemy.x = enemy.targetX
        enemy.y = enemy.targetY
      }

      enemy.radarX = clamp((enemy.x + enemy.size / 2) / radarW, 0, 1)
      enemy.radarY = clamp((enemy.y + enemy.size / 2) / radarH, 0, 1)

      if (!enemy.visible) continue

      const hitCircle = getEnemyHitCircle(enemy)

      // Idle wander on its own timer: a gentle drift nearby, with the odd depth change so it
      // still "breathes" in size without a screen-wide hop.
      if (time >= enemy.nextWanderAt) {
        enemy.nextWanderAt = time + ENEMY_WANDER_INTERVAL * (0.4 + Math.random() * 0.6)
        if (Math.random() < 0.5) rerollEnemyDepth(enemy)
        wanderNearby(enemy, radarW, radarH)
      }

      // Flee if the cursor lingers nearby (rate-limited; cooldown/radius scale with level).
      // A smooth, curving slip away rather than a teleport to a random spot.
      if (lastPointerX !== null && (time - enemy.lastFleeTime) >= getFleeCooldown()) {
        const pointerDistance = Math.hypot(lastPointerX - hitCircle.x, lastPointerY - hitCircle.y)
        if (pointerDistance <= getFleeRadius() + hitCircle.radius) {
          enemy.lastFleeTime = time
          dodgeCursor(enemy, radarW, radarH)
        }
      }

      // Return fire on its own timer, once return fire is unlocked - so overall fire rate
      // scales with the number of enemies on the field.
      if (level.value >= ALIEN_FIRE_MIN_LEVEL) {
        if (enemy.nextFireAt === 0 || time >= enemy.nextFireAt) {
          if (enemy.nextFireAt !== 0) fireEnemyShot(enemy)
          enemy.nextFireAt = time + getAlienFireCooldown() * (0.75 + Math.random() * 0.5)
        }
      }
    }

    // Update the AI ally: chase the nearest enemy (holding at a standoff distance), face it,
    // plot it on the radar, and - while fully warped in - fire a phaser beam whenever a target
    // is in range, then count down to warp-out.
    if (ally.active) {
      const acx = allyCenterX()
      const acy = allyCenterY()
      const chaseTarget = ally.phase === 'active' ? nearestVisibleEnemy(acx, acy) : null

      if (chaseTarget) {
        // Aim for a point ALLY_STANDOFF away from the enemy, on the ally's current side of
        // it, so the ally closes in but holds its distance rather than piling on top.
        const ex = chaseTarget.x + chaseTarget.size / 2
        const ey = chaseTarget.y + chaseTarget.size / 2
        const dx = acx - ex
        const dy = acy - ey
        const dist = Math.hypot(dx, dy) || 1
        ally.targetX = clamp(ex + (dx / dist) * ALLY_STANDOFF - ALLY_SIZE / 2, 0, Math.max(radarW - ALLY_SIZE, 0))
        ally.targetY = clamp(ey + (dy / dist) * ALLY_STANDOFF - (ALLY_SIZE * 1.2) / 2, 0, Math.max(radarH - ALLY_SIZE * 1.2, 0))
        // Face the enemy it's engaging (rather than its travel direction).
        ally.angle = (Math.atan2(ex - acx, ey - acy) * (180 / Math.PI) * -1) + 180
      }

      const adx = ally.targetX - ally.x
      const ady = ally.targetY - ally.y
      const moving = Math.hypot(adx, ady) > ARRIVE_THRESHOLD
      if (moving) {
        const t = 1 - Math.exp(-ALLY_FOLLOW_RATE * dt)
        ally.x += adx * t
        ally.y += ady * t
        if (!chaseTarget) ally.angle = (Math.atan2(adx, ady) * (180 / Math.PI) * -1) + 180
      }

      ally.radarX = clamp(allyCenterX() / radarW, 0, 1)
      ally.radarY = clamp(allyCenterY() / radarH, 0, 1)

      if (ally.beamActive && time >= ally.beamUntil) ally.beamActive = false

      if (ally.phase === 'active') {
        // Fire a phaser beam at the nearest enemy, but only once it's within range; otherwise
        // keep closing the distance and recheck shortly.
        if (time >= ally.nextFireAt && chaseTarget) {
          const inRange = Math.hypot((chaseTarget.x + chaseTarget.size / 2) - acx, (chaseTarget.y + chaseTarget.size / 2) - acy) <= ALLY_ENGAGE_RANGE
          if (inRange) {
            fireAllyBeam(chaseTarget, time)
            ally.nextFireAt = time + ALLY_FIRE_COOLDOWN
          } else {
            ally.nextFireAt = time + 150
          }
        }

        // Count down and warp out once its time is up.
        allyRemainingMs.value = Math.max(0, allyExpiresAt - time)
        if (time >= allyExpiresAt) beginAllyWarpOut()
      }
    }

    // Advance in-flight projectiles. Player shots home-in on / collide with the nearest live
    // enemy; enemy return fire aims at (and collides with) the ship.
    const enemyCircles = enemies
      .filter(e => e.visible && e.health > 0)
      .map(e => ({ enemy: e, circle: getEnemyHitCircle(e) }))
    const shipHitCircle = getShipHitCircle()

    for (const projectile of projectiles) {
      if (projectile.state !== PROJECTILE_STATE.FLYING) continue

      // Player shots nudge their heading toward the nearest live enemy each frame (turn
      // rate capped so they curve rather than snap), keeping speed constant. Lasers
      // heat-seek from anywhere; ordinary shots get a weaker nudge, and only once they're
      // already near their target - a forgiving aim-assist rather than full tracking.
      if (projectile.owner === OWNER.PLAYER && enemyCircles.length) {
        let nearest = null
        let nearestDist = Infinity
        for (const { circle } of enemyCircles) {
          const d = Math.hypot(circle.x - projectile.x, circle.y - projectile.y)
          if (d < nearestDist) { nearestDist = d; nearest = circle }
        }
        if (nearest) {
          let turnRate = 0
          if (projectile.laser) {
            turnRate = LASER_HOMING_TURN_RATE
          } else if (nearestDist <= REGULAR_HOMING_RADIUS) {
            turnRate = REGULAR_HOMING_TURN_RATE
          }
          if (turnRate > 0) {
            const speed = Math.hypot(projectile.vx, projectile.vy)
            const heading = Math.atan2(projectile.vx, projectile.vy)
            const desired = Math.atan2(nearest.x - projectile.x, nearest.y - projectile.y)
            // Shortest signed angle from heading to desired, wrapped to [-PI, PI].
            const diff = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading))
            const newHeading = heading + clamp(diff, -turnRate * dt, turnRate * dt)
            projectile.vx = Math.sin(newHeading) * speed
            projectile.vy = Math.cos(newHeading) * speed
          }
        }
      }

      const stepX = projectile.vx * dt
      const stepY = projectile.vy * dt
      projectile.x += stepX
      projectile.y += stepY
      projectile.travelled += Math.hypot(stepX, stepY)

      if (projectile.owner === OWNER.ALIEN) {
        if (shipHitCircle) {
          const effectiveRadius = shipHitCircle.radius + (projectile.hitPaddingBonus || 0)
          if (Math.hypot(projectile.x - shipHitCircle.x, projectile.y - shipHitCircle.y) <= effectiveRadius) {
            registerAlienHit(projectile)
            continue
          }
        }
      } else {
        let struck = false
        for (const { enemy, circle } of enemyCircles) {
          if (!enemy.visible || enemy.health <= 0) continue // already killed earlier this frame
          const effectiveRadius = circle.radius + (projectile.hitPaddingBonus || 0)
          if (Math.hypot(projectile.x - circle.x, projectile.y - circle.y) <= effectiveRadius) {
            damageEnemy(enemy, projectile)
            struck = true
            break
          }
        }
        if (struck) continue
      }

      if (projectile.travelled >= PROJECTILE_MAX_DISTANCE) {
        registerMiss(projectile)
      }
    }

    // Let the player shoot down incoming alien fire before it connects - any shot that
    // resolved above (hit/miss) is already excluded by the state check, so only
    // still-in-flight shots on both sides are candidates.
    const flyingAlienShots = projectiles.filter(p => p.owner === OWNER.ALIEN && p.state === PROJECTILE_STATE.FLYING)
    if (flyingAlienShots.length) {
      const flyingPlayerShots = projectiles.filter(p => p.owner !== OWNER.ALIEN && p.state === PROJECTILE_STATE.FLYING)
      for (const alienShot of flyingAlienShots) {
        const playerShot = flyingPlayerShots.find(p =>
          p.state === PROJECTILE_STATE.FLYING &&
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
        if (powerUp.state !== POWERUP_STATE.FLOATING) continue

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

    // Expire the timed buffs (weapon + shield) once each one's time is up.
    if (activeWeaponBuff.value) {
      weaponBuffRemainingMs.value = Math.max(0, weaponBuffExpiresAt - time)
      if (weaponBuffRemainingMs.value <= 0) activeWeaponBuff.value = null
    }
    if (shieldActive.value) {
      shieldRemainingMs.value = Math.max(0, shieldExpiresAt - time)
      if (shieldRemainingMs.value <= 0) shieldActive.value = false
    }

    rafId = requestAnimationFrame(tick)
  }

  // --- Lifecycle: the game only runs while alien mode is active --------------------------

  const clearAllTimers = () => {
    clearTimeout(scorePulseTimeoutId)
    clearTimeout(shipHitTimeoutId)
    clearTimeout(powerUpSpawnTimeoutId)
    clearTimeout(allyPhaseTimeoutId)
    enemies.forEach((enemy) => {
      clearTimeout(enemy.hitTimeoutId)
      clearTimeout(enemy.destroyedTimeoutId)
      clearTimeout(enemy.respawnTimeoutId)
    })
  }

  // Wipes all in-play state back to a fresh game (the best score is kept - it's persisted).
  const resetGame = () => {
    clearAllTimers()

    projectiles.splice(0)
    warpFlashes.splice(0)
    powerUps.splice(0)
    enemies.splice(0)

    score.value = 0
    level.value = 1
    playerHealth.value = PLAYER_MAX_HEALTH
    scorePulse.value = false
    shipHit.value = false
    hintVisible.value = true

    activeWeaponBuff.value = null
    weaponBuffRemainingMs.value = 0
    shieldActive.value = false
    shieldRemainingMs.value = 0

    ally.active = false
    ally.phase = 'idle'
    ally.beamActive = false
    allyRemainingMs.value = 0

    lives.value = PLAYER_MAX_LIVES
    gameState.value = GAME_STATE.PLAYING
    shipExplosion.active = false

    shipX = SHIP_SIZE / 2
    shipY = SHIP_SIZE / 2
    shipTargetX = SHIP_SIZE / 2
    shipTargetY = SHIP_SIZE / 2
    shipVX = 0
    shipVY = 0
    heldKeys.up = heldKeys.down = heldKeys.left = heldKeys.right = false
    shipStretch = 1
    shipAngle.value = 0
    hasFacing = false
    lastPointerX = null
    lastPointerY = null
    lastFireTime = 0
    lastFrameTime = null
  }

  // Sets up a fresh game (state + enemies + spawn timer) WITHOUT touching the rAF loop, so
  // it's safe to call while the loop is already running (e.g. Restart from the prompt).
  const beginGame = () => {
    resetGame()
    syncEnemyCount()
    schedulePowerUpSpawn()
  }

  // Mounts a fresh game and starts its loop (used when alien mode is first entered).
  const startGame = () => {
    beginGame()
    rafId = requestAnimationFrame(tick)
  }

  // Continue after a death: resume the same run (score/level kept) with health restored and
  // the immediate threat cleared, plus a short firing grace so you aren't instantly re-killed.
  const continueGame = () => {
    projectiles.splice(0)
    playerHealth.value = PLAYER_MAX_HEALTH
    shipHit.value = false
    clearTimeout(shipHitTimeoutId)

    const grace = performance.now() + 1500
    enemies.forEach((enemy) => { enemy.nextFireAt = grace })

    lastFrameTime = null
    gameState.value = GAME_STATE.PLAYING
  }

  // Restart from the prompt or game-over screen - a brand new run (loop already running).
  const restartGame = () => {
    beginGame()
  }

  // Tears everything down - cancels the loop, clears every timer and parks the audio.
  const stopGame = () => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = null
    clearAllTimers()
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend()
  }

  // Drive the loop off alien mode: a fresh game mounts on entry, and it fully tears down on
  // exit (so it isn't burning frames/timers/sound while the game isn't even visible). Falls
  // back to always-on if no active flag was supplied.
  if (isActive) {
    watch(isActive, (active) => {
      if (active) startGame()
      else stopGame()
    }, { immediate: true })
  } else {
    startGame()
  }

  onUnmounted(stopGame)

  return {
    container,
    score,
    bestScore,
    shipHit,
    scorePulse,
    hintVisible,
    muted,
    toggleMute,
    level,
    enemies,
    enemyHealthRatio,
    healthColor,
    projectiles,
    consumeProjectile,
    warpFlashes,
    powerUps,
    activeBuffs,
    shieldActive,
    ally,
    ALLY_SIZE,
    playerHealth,
    playerHealthRatio,
    playerHealthColor,
    lives,
    maxLives: PLAYER_MAX_LIVES,
    gameState,
    shipExplosion,
    continueGame,
    restartGame,
    radarShip,
    rotateShip,
    moveShip,
    handleClick,
    onKeyDown,
    onKeyUp,
    ufoClicked,
    getShipRenderState,
  }
}
