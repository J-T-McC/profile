<template>
  <!-- #about is the page's scroll-anchor (see TheHeader / Me) and the element that goes
       fullscreen, so the game and the page content it overlays must live under it. The
       game is an absolute overlay; the page content (passed via the default slot) sits in
       normal flow and gives #about its height. -->
  <div id="about" class="relative" ref="container" :class="{'select-none': active}">
    <div
        class="hidden lg:block h-full w-full absolute top-0 left-0"
        v-if="active"
        tabindex="0"
        @mousemove="rotateShip" @click="handleClick">
      <!-- Full-width sticky row: score group pinned left, radar pinned right. The row
           itself is pointer-events-none so its transparent middle doesn't swallow game
           clicks/mousemove; only the actual widgets re-enable pointer events. -->
      <div class="game-hud sticky top-20 mt-2 px-2 z-10 flex items-start justify-between pointer-events-none">
        <div class="flex flex-col gap-1 pointer-events-auto">
          <div class="flex items-center gap-2">
            <div v-if="score || bestScore" class="gamify text-white text-xl" :class="{'score-pulse': scorePulse}">SCORE: {{ score }} <span class="text-base opacity-70">BEST: {{ bestScore }} &middot; LVL {{ level }}</span></div>
            <button type="button" class="mute-toggle text-white text-xs bg-black bg-opacity-40 px-2 py-1 rounded-full" @click.stop="toggleMute">{{ muted ? '🔇' : '🔊' }}</button>
            <button type="button" class="mute-toggle text-white text-xs bg-black bg-opacity-40 px-2 py-1 rounded-full" :title="isFullscreen ? 'Exit full screen' : 'Full screen'" @click.stop="toggleFullscreen">{{ isFullscreen ? '✕' : '⛶' }}</button>
            <div v-for="buff in activeBuffs" :key="buff.id" class="buff-badge gamify text-sm" :style="{color: buff.color, borderColor: buff.color}">{{ buff.label }} <span class="opacity-70">{{ buff.seconds }}s</span></div>
          </div>
          <div class="flex items-center gap-2">
            <span class="gamify text-white text-xs">HP</span>
            <div class="player-health-track">
              <div class="player-health-fill" :style="{width: (playerHealthRatio * 100) + '%', backgroundColor: playerHealthColor}"></div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="gamify text-white text-xs">LIVES</span>
            <span class="gamify text-lg leading-none tracking-widest">
              <span v-for="n in maxLives" :key="n" :class="n <= lives ? 'text-green-400' : 'text-gray-600'">▲</span>
            </span>
          </div>
        </div>
        <div class="radar pointer-events-auto">
          <div class="radar-sweep"></div>
          <div class="radar-ring"></div>
          <div class="radar-blip radar-blip--me" :style="{left: (radarShip.x * 100) + '%', top: (radarShip.y * 100) + '%'}"></div>
          <div v-for="enemy in enemies" :key="'radar-e-' + enemy.id" v-show="enemy.visible" class="radar-blip radar-blip--enemy" :style="{left: (enemy.radarX * 100) + '%', top: (enemy.radarY * 100) + '%'}"></div>
          <div v-for="p in powerUps" :key="'radar-' + p.id" v-show="p.state === POWERUP_STATE.FLOATING" class="radar-blip radar-blip--bonus" :style="{left: (p.radarX * 100) + '%', top: (p.radarY * 100) + '%'}"></div>
          <div v-if="ally.active" class="radar-blip radar-blip--ally" :style="{left: (ally.radarX * 100) + '%', top: (ally.radarY * 100) + '%'}"></div>
        </div>
      </div>
      <div v-if="hintVisible" class="hint absolute top-2 right-2 z-10 text-white text-sm bg-black bg-opacity-40 px-3 py-1 rounded-full pointer-events-none">Click to fly &middot; click the UFO to shoot &middot; Space to fire</div>
      <!-- Three.js stage: renders the starfield and every world entity (ship, UFOs,
           projectiles, ally, phaser beam, power-ups). z-index 0 so it sits below the
           DOM overlays (HUD/radar/health bars/effects). pointer-events-none so it
           never steals the overlay's click/mousemove game input. -->
      <canvas ref="stageCanvas" class="three-stage block absolute top-0 left-0 w-full h-full pointer-events-none" style="z-index: 0;"></canvas>
      <div v-for="flash in warpFlashes" :key="flash.id" class="warp-flash" :class="{'warp-flash--active': flash.active}" :style="{top: flash.y + 'px', left: flash.x + 'px'}"></div>

      <div v-if="shipExplosion.active" class="ship-explosion" :style="{top: shipExplosion.y + 'px', left: shipExplosion.x + 'px'}"></div>
    </div>

    <!-- Page content sits in normal flow beneath the game overlay and gives #about its
         height. Hidden while the game is fullscreen so only the game shows. -->
    <div class="game-content" :class="{'cards-hidden': isFullscreen}">
      <slot></slot>
    </div>

    <!-- 8-bit continue/restart + game-over screens. Direct children of #about (the element
         that goes fullscreen) and position:fixed, so they centre on the viewport and still
         show in fullscreen. NOT teleported: teleporting into this same reactive subtree
         crashed Vue's patcher (nextSibling of null) on the death-driven state change. -->
    <template v-if="active">
      <div v-if="gameState === GAME_STATE.PROMPT" class="arcade-modal">
        <div class="arcade-panel">
          <div class="arcade-title">SHIP DESTROYED</div>
          <div class="arcade-line">
            LIVES LEFT
            <span class="tracking-widest ml-1">
              <span v-for="n in maxLives" :key="n" :class="n <= lives ? 'text-green-400' : 'text-gray-600'">▲</span>
            </span>
          </div>
          <div class="arcade-line arcade-blink">CONTINUE?</div>
          <div class="arcade-actions">
            <button type="button" class="arcade-btn" @click="continueGame">CONTINUE</button>
            <button type="button" class="arcade-btn arcade-btn--secondary" @click="restartGame">RESTART</button>
          </div>
        </div>
      </div>

      <div v-if="gameState === GAME_STATE.GAME_OVER" class="arcade-modal">
        <div class="arcade-panel">
          <div class="arcade-title arcade-title--over">GAME OVER</div>
          <div class="arcade-line">SCORE {{ score }}</div>
          <div class="arcade-line">BEST {{ bestScore }}</div>
          <div class="arcade-actions">
            <button type="button" class="arcade-btn arcade-btn--danger" @click="restartGame">PLAY AGAIN</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import useDarkMode from '@/hooks/useDarkMode'
import useSpaceGame, { POWERUP_STATE, GAME_STATE } from '@/hooks/useSpaceGame'
import useThreeStage from '@/hooks/useThreeStage'
import { isMobileOnly } from 'mobile-device-detect'
import { computed, onMounted, onUnmounted, ref } from 'vue'

export default {
  name: 'SpaceGame',
  setup () {
    const mode = useDarkMode()

    // The whole arcade experience is desktop-only and gated behind the "alien" theme.
    const active = computed(() => mode.isAlienMode.value && !isMobileOnly)

    const {
      container,
      score,
      bestScore,
      scorePulse,
      hintVisible,
      muted,
      toggleMute,
      level,
      enemies,
      enemyHealthRatio,
      healthColor,
      projectiles,
      warpFlashes,
      powerUps,
      activeBuffs,
      ally,
      playerHealthRatio,
      playerHealthColor,
      lives,
      maxLives,
      gameState,
      shipExplosion,
      continueGame,
      restartGame,
      radarShip,
      rotateShip,
      onKeyDown,
      handleClick,
      getShipRenderState,
    } = useSpaceGame(mode.isAlienMode)

    // Three.js renderer for the ship, UFOs, projectiles, ally, power-ups and health bars.
    // It polls this game state each frame; gated to alien mode like the game itself.
    const { stageCanvas } = useThreeStage(mode.isAlienMode, { enemies, projectiles, ally, powerUps, getShipRenderState, enemyHealthRatio, healthColor })

    // Bound on window (rather than just the small game overlay) so a Space press still
    // reaches the game - and gets its default page-scroll prevented - no matter what
    // currently has focus. Clicking a plain card-row div (not a link/button) doesn't
    // focus anything in particular, so a listener relying on event bubbling from a
    // focused descendant never saw those keydowns at all. No-ops entirely when the game
    // isn't active, or when a real text field is focused elsewhere on the page.
    const onWindowKeyDown = (event) => {
      if (!active.value) return

      const targetTag = event.target?.tagName
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || event.target?.isContentEditable) return

      onKeyDown(event)
    }

    // Full-screen mode for the game section only. We put the game's own container
    // (#about) into the Fullscreen API rather than a wrapper so all of the game's
    // coordinate math - which assumes container.left/top ~= 0 - stays correct: a
    // fullscreen element sits at the screen origin. The page content is hidden while
    // active (see isFullscreen binding) so only the game shows.
    const isFullscreen = ref(false)

    const toggleFullscreen = () => {
      const el = container.value
      if (!el) return
      if (document.fullscreenElement === el) {
        document.exitFullscreen?.()
      } else {
        el.requestFullscreen?.()
      }
    }

    // Kept in sync via the event (not just the toggle) so pressing Esc to leave
    // fullscreen also updates our state and re-shows the content.
    const onFullscreenChange = () => {
      isFullscreen.value = document.fullscreenElement === container.value
    }

    onMounted(() => {
      window.addEventListener('keydown', onWindowKeyDown)
      document.addEventListener('fullscreenchange', onFullscreenChange)
    })

    onUnmounted(() => {
      window.removeEventListener('keydown', onWindowKeyDown)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    })

    return {
      active,
      isFullscreen,
      toggleFullscreen,
      stageCanvas,
      rotateShip,
      handleClick,
      score,
      bestScore,
      muted,
      toggleMute,
      level,
      enemies,
      warpFlashes,
      powerUps,
      activeBuffs,
      ally,
      playerHealthRatio,
      playerHealthColor,
      lives,
      maxLives,
      gameState,
      shipExplosion,
      continueGame,
      restartGame,
      GAME_STATE,
      radarShip,
      scorePulse,
      hintVisible,
      container,
      POWERUP_STATE,
    }
  },
}
</script>

<style scoped>
@keyframes pulse {
  from {
    transform: scale3d(1, 1, 1);
  }

  50% {
    transform: scale3d(1.05, 1.05, 1.05);
  }

  to {
    transform: scale3d(1, 1, 1);
  }
}

.score-pulse {
  animation: pulse 0.3s ease-in-out;
}

.mute-toggle {
  line-height: 1;
}

.cards-hidden {
  display: none;
}

/* In full-screen the game section fills the screen on its own (the page's fixed nav
   isn't part of the fullscreen top layer), so give it a solid backdrop and pull the
   HUD up out of the top-20 offset that normally clears that nav. */
#about:fullscreen {
  background: #000;
}

#about:fullscreen .game-hud {
  top: 0.75rem;
}

/* 8-bit ship death burst: layered square rings that punch outward in choppy steps. */
.ship-explosion {
  position: absolute;
  width: 16px;
  height: 16px;
  z-index: 22;
  background: #fef08a;
  box-shadow: 0 0 0 6px #f97316, 0 0 0 12px #ef4444, 0 0 0 18px #7f1d1d;
  transform: translate(-50%, -50%);
  image-rendering: pixelated;
  pointer-events: none;
  animation: ship-explode 0.9s steps(5) forwards;
}

@keyframes ship-explode {
  0% {
    transform: translate(-50%, -50%) scale(0.4);
    opacity: 1;
  }
  60% {
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(3.4);
    opacity: 0;
  }
}

/* --- 8-bit continue / game-over screens -------------------------------------------- */
.arcade-modal {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.78);
}

.arcade-panel {
  font-family: 'VT323', monospace;
  color: #e2e8f0;
  background: #0b1020;
  border: 4px solid #e2e8f0;
  /* Blocky layered frame instead of a soft border-radius, for the arcade-cabinet look. */
  box-shadow: 0 0 0 4px #0b1020, 0 0 0 8px #64748b, 0 10px 0 8px rgba(0, 0, 0, 0.35);
  padding: 28px 40px;
  text-align: center;
  image-rendering: pixelated;
}

.arcade-title {
  font-size: 2.4rem;
  line-height: 1;
  letter-spacing: 2px;
  color: #38bdf8;
  text-shadow: 3px 3px 0 #0e7490;
  margin-bottom: 14px;
}

.arcade-title--over {
  color: #f87171;
  text-shadow: 3px 3px 0 #7f1d1d;
}

.arcade-line {
  font-size: 1.5rem;
  line-height: 1.3;
  letter-spacing: 1px;
}

.arcade-blink {
  margin-top: 6px;
  animation: arcade-blink 1s steps(1) infinite;
}

@keyframes arcade-blink {
  50% {
    opacity: 0;
  }
}

.arcade-actions {
  margin-top: 20px;
  display: flex;
  gap: 16px;
  justify-content: center;
}

.arcade-btn {
  font-family: 'VT323', monospace;
  font-size: 1.5rem;
  letter-spacing: 1px;
  padding: 6px 22px;
  color: #0b1020;
  background: #34d399;
  border: none;
  box-shadow: 5px 5px 0 #065f46;
  cursor: pointer;
}

.arcade-btn:hover {
  filter: brightness(1.1);
}

.arcade-btn:active {
  transform: translate(3px, 3px);
  box-shadow: 2px 2px 0 #065f46;
}

.arcade-btn--secondary {
  background: #fbbf24;
  box-shadow: 5px 5px 0 #92400e;
}

.arcade-btn--secondary:active {
  box-shadow: 2px 2px 0 #92400e;
}

.arcade-btn--danger {
  background: #f87171;
  box-shadow: 5px 5px 0 #7f1d1d;
}

.arcade-btn--danger:active {
  box-shadow: 2px 2px 0 #7f1d1d;
}

.warp-flash {
  position: absolute;
  width: 44px;
  height: 44px;
  z-index: 18;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(224, 242, 254, 0.95) 0%, rgba(96, 165, 250, 0.65) 40%, rgba(96, 165, 250, 0) 72%);
  transform: translate(-50%, -50%) scale(0.2);
  opacity: 1;
  pointer-events: none;
  transition: transform 0.38s ease-out, opacity 0.38s ease-out;
}

.warp-flash--active {
  transform: translate(-50%, -50%) scale(2);
  opacity: 0;
}

.player-health-track {
  width: 120px;
  height: 8px;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 4px;
  overflow: hidden;
}

.player-health-fill {
  height: 100%;
  transition: width 0.2s ease-out, background-color 0.2s ease-out;
}

.buff-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid currentColor;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.4);
  line-height: 1;
}

.radar {
  position: relative;
  width: 120px;
  height: 120px;
  border-radius: 9999px;
  border: 2px solid rgba(74, 222, 128, 0.5);
  background: radial-gradient(circle, rgba(8, 24, 12, 0.55) 0%, rgba(2, 10, 4, 0.8) 100%);
  overflow: hidden;
  box-shadow: inset 0 0 12px rgba(74, 222, 128, 0.25), 0 0 8px rgba(0, 0, 0, 0.5);
}

/* Concentric range ring for that classic radar-scope look. */
.radar-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 50%;
  height: 50%;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(74, 222, 128, 0.22);
  border-radius: 9999px;
  pointer-events: none;
}

/* Rotating sonar sweep: a red wedge (bright leading edge fading into a trailing tail)
   spun continuously around the dish. */
.radar-sweep {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  pointer-events: none;
  background: conic-gradient(
      from 0deg,
      rgba(248, 113, 113, 0) 0deg,
      rgba(248, 113, 113, 0) 260deg,
      rgba(248, 113, 113, 0.12) 320deg,
      rgba(248, 113, 113, 0.5) 356deg,
      rgba(248, 113, 113, 0.75) 360deg);
  animation: radar-sweep-spin 2.6s linear infinite;
}

@keyframes radar-sweep-spin {
  to {
    transform: rotate(360deg);
  }
}

.radar-blip {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.radar-blip--me {
  background: #4ade80;
  box-shadow: 0 0 6px 1px rgba(74, 222, 128, 0.9);
}

.radar-blip--enemy {
  background: #f87171;
  box-shadow: 0 0 6px 1px rgba(248, 113, 113, 0.9);
  animation: radar-blip-pulse 1.2s ease-in-out infinite;
}

.radar-blip--bonus {
  background: #60a5fa;
  box-shadow: 0 0 6px 1px rgba(96, 165, 250, 0.9);
}

.radar-blip--ally {
  background: #a5b4fc;
  box-shadow: 0 0 6px 1px rgba(165, 180, 252, 0.9);
}

@keyframes radar-blip-pulse {
  0%, 100% {
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.5);
  }
}
</style>
