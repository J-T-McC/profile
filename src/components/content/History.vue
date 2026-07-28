<template>
  <section-break
      gradient-from="from-purple-400"
      gradient-via="via-pink-400"
      gradient-to="to-blue-500"
      animation="animate-gradient-xy">
  </section-break>
  <div id="about" class="relative" ref="container" :class="{'select-none': mode.isAlienMode.value && !isMobileOnly}">
    <div
        class="hidden lg:block h-full w-full absolute top-0 left-0"
        v-if="mode.isAlienMode.value && !isMobileOnly"
        tabindex="0"
        @mousemove="rotateShip" @click="moveShip">
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
      <div class="stars z-0 absolute top-0 left-0 w-full h-full"></div>
      <div class="twinkling z-0 absolute top-0 left-0 w-full h-full"></div>
      <!-- Phase 0 Three.js spike: WebGL stage layered above the starfield (z1) and
           below the gameplay sprites (ship z20). pointer-events-none so it never
           steals the overlay's click/mousemove game input. -->
      <canvas ref="stageCanvas" class="three-stage block absolute top-0 left-0 w-full h-full pointer-events-none" style="z-index: 2;"></canvas>
      <div v-for="flash in warpFlashes" :key="flash.id" class="warp-flash" :class="{'warp-flash--active': flash.active}" :style="{top: flash.y + 'px', left: flash.x + 'px'}"></div>
      <img v-show="gameState === GAME_STATE.PLAYING && !shipExplosion.active" src="https://res.cloudinary.com/ddaji66m6/image/upload/v1612058700/portfolio/spaceship_tlg2od.png" alt="ship" ref="ship" :style="shipPos" :class="{'ship-hit': shipHit, 'ship-shielded': shieldActive}" class="block ship absolute w-10 h-10 z-20 bg-white select-none"/>

      <div v-if="shipExplosion.active" class="ship-explosion" :style="{top: shipExplosion.y + 'px', left: shipExplosion.x + 'px'}"></div>
      <SvgWeapon v-for="projectile in projectiles" :key="projectile.id" :x="projectile.x" :y="projectile.y" :state="projectile.state" :owner="projectile.owner" :laser="projectile.laser"/>

      <!-- Ally phaser beam: a straight line from the ally to the enemy it struck. The SVG has
           no viewBox, so its user units are CSS pixels (= container coords), letting us plot
           the snapshotted endpoints directly. -->
      <svg v-if="ally.beamActive" class="phaser-beam" width="100%" height="100%" preserveAspectRatio="none">
        <line :x1="ally.beamX1" :y1="ally.beamY1" :x2="ally.beamX2" :y2="ally.beamY2" class="phaser-beam-line"/>
      </svg>

      <div
          v-if="ally.active"
          class="ally"
          :class="{'ally--warp-in': ally.phase === 'in', 'ally--warp-out': ally.phase === 'out'}"
          :style="{top: ally.y + 'px', left: ally.x + 'px', width: allySize + 'px', height: (allySize * 1.2) + 'px'}">
        <div class="ally-body" :style="{transform: 'rotate(' + ally.angle + 'deg)'}">
          <svg-enterprise/>
        </div>
      </div>

      <div
          v-for="powerUp in powerUps"
          :key="powerUp.id"
          class="power-up gamify"
          :class="{'power-up--collected': powerUp.state === POWERUP_STATE.COLLECTED}"
          :style="{top: powerUp.y + 'px', left: powerUp.x + 'px', color: powerUp.color, borderColor: powerUp.color, boxShadow: '0 0 10px 2px ' + powerUp.color}">
        {{ powerUp.label }}
      </div>

      <template v-for="enemy in enemies" :key="enemy.id">
        <SvgUFO
            v-show="enemy.visible"
            @click.stop="ufoClicked"
            :style="{top: enemy.y + 'px', left: enemy.x + 'px', width: enemy.size + 'px', height: enemy.size + 'px', filter: 'brightness(' + enemy.brightness + '%)', zIndex: enemy.zIndex, transitionProperty: 'width, height, filter', transitionDuration: enemy.transitionDuration}"
            :class="{'bg-red-600 rounded-full': enemy.hit, 'ufo-destroyed': enemy.destroyed}"
            class="absolute select-none hidden lg:block wobble cursor-crosshair"
        />
        <div v-show="enemy.visible" class="ufo-health-track" :style="{top: enemy.y + 'px', left: enemy.x + 'px', width: (enemy.size * 0.8) + 'px', filter: 'brightness(' + enemy.brightness + '%)', 'transition-duration': enemy.transitionDuration}">
          <div class="ufo-health-fill" :style="{width: (enemyHealthRatio(enemy) * 100) + '%', backgroundColor: healthColor(enemyHealthRatio(enemy))}"></div>
        </div>
      </template>

      <!-- 8-bit continue/restart + game-over screens. Teleported to #about (the element that
           goes fullscreen) rather than <body>: they're position:fixed so they still centre in
           the viewport, but staying inside the fullscreen subtree means they also show while
           fullscreen (the fullscreen top layer hides anything outside that element). -->
      <teleport to="#about">
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
      </teleport>

    </div>
    <div class="lg:bg-gradient-to-r from-white via-white to-gray-200 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 pt-6 lg:pt-0 dark:bg-gray-900 z-50 pb-5 lg:pb-0 transition-colors duration-500" :class="{'cards-hidden': isFullscreen}">
      <card-row
          v-for="(card, i) in cards"
          v-bind:key="card"
          :card="card"
          :reverse="i % 2 === 0"
          :delay="i">
      </card-row>
    </div>
  </div>
  <section-break
      gradient-from="from-purple-500 dark:from-blue-900"
      gradient-via="via-pink-200"
      gradient-to="to-blue-500"
      animation="animate-gradient-xy">
  </section-break>
</template>

<script>

import CardRow from '@/components/reusable/CardRow'
import SectionBreak from '@/components/reusable/SectionBreak'
import useDarkMode from '@/hooks/useDarkMode'
import useSpaceGame, { POWERUP_STATE, GAME_STATE } from '@/hooks/useSpaceGame'
import useThreeStage from '@/hooks/useThreeStage'
import SvgUFO from '@/components/icons/SvgUFO'
import { isMobileOnly } from 'mobile-device-detect'
import SvgWeapon from '@/components/icons/SvgWeapon'
import SvgEnterprise from '@/components/icons/SvgEnterprise'
import { onMounted, onUnmounted, ref } from 'vue'

export default {
  name: 'History',
  components: {
    SvgWeapon,
    SvgEnterprise,
    SvgUFO,
    CardRow,
    SectionBreak
  },
  setup () {
    const mode = useDarkMode()

    const {
      container,
      ship,
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
      warpFlashes,
      powerUps,
      activeBuffs,
      shieldActive,
      ally,
      ALLY_SIZE,
      playerHealthRatio,
      playerHealthColor,
      lives,
      maxLives,
      gameState,
      shipExplosion,
      continueGame,
      restartGame,
      radarShip,
      shipPos,
      rotateShip,
      moveShip,
      onKeyDown,
      ufoClicked,
    } = useSpaceGame(mode.isAlienMode)

    // Phase 0: Three.js rendering spike, gated to alien mode like the game itself.
    const { stageCanvas } = useThreeStage(mode.isAlienMode)

    // Bound on window (rather than just the small game overlay) so a Space press still
    // reaches the game - and gets its default page-scroll prevented - no matter what
    // currently has focus. Clicking a plain card-row div (not a link/button) doesn't
    // focus anything in particular, so a listener relying on event bubbling from a
    // focused descendant never saw those keydowns at all. No-ops entirely when the game
    // isn't active, or when a real text field is focused elsewhere on the page.
    const onWindowKeyDown = (event) => {
      if (!mode.isAlienMode.value || isMobileOnly) return

      const targetTag = event.target?.tagName
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || event.target?.isContentEditable) return

      onKeyDown(event)
    }

    // Full-screen mode for the game section only. We put the game's own container
    // (#about) into the Fullscreen API rather than a wrapper so all of the game's
    // coordinate math - which assumes container.left/top ~= 0 - stays correct: a
    // fullscreen element sits at the screen origin. The resume cards are hidden while
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
    // fullscreen also updates our state and re-shows the cards.
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
      isFullscreen,
      toggleFullscreen,
      stageCanvas,
      ufoClicked,
      rotateShip,
      moveShip,
      shipPos,
      ship,
      score,
      bestScore,
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
      shieldActive,
      ally,
      allySize: ALLY_SIZE,
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
      shipHit,
      scorePulse,
      hintVisible,
      container,
      mode,
      isMobileOnly,
      POWERUP_STATE,
      cards: [
        {
          header: 'Atmosphere TV - Staff Software Engineer',
          date: 'June 2022-Current',
          body: `(☞ຈل͜ຈ)☞ Role & Title Bump.`,
        },
        {
          header: 'Atmosphere TV - Senior Developer',
          date: 'January 2022-June 2022',
          body: `An opportunity arose to join an amazing group of people at Atmosphere TV. Atmosphere TV is headquartered in Austin Texas but has offices around the world.`,
          callToAction: {
            label: 'Check them out!',
            url: 'https://www.atmosphere.tv/'
          }
        },
        {
          header: 'RocketPlan - Senior Backend Developer',
          date: 'April 2021-December 2021',
          body: `Got the opportunity to join a great team at RocketPlan Technologies as a Senior Backend Developer.`,
          callToAction: {
            label: 'More about RocketPlan',
            url: 'https://rocketplantech.com/'
          }
        },
        {
          header: 'Open to New Opportunities',
          date: 'January 2021-March 2021',
          body: `Made the difficult decision to part ways with Sentis. As much as I love the team and culture,
          I felt this was a necessary step to focus my career on development and to put away some of the roles I have been performing.
          Taking some time to learn and create a public github presence, hopefully contributing to the open source community in the process.`,
          callToAction: {
            label: 'View recent activity on GitHub!',
            url: 'https://github.com/J-T-McC'
          }
        },
        {
          header: 'Sentis - Head of Systems & Solutions',
          date: 'April 2018-January 2021',
          body: `Promoted to Head of Systems & Solutions and charged with overseeing the Development team and IT footprint.
          Completion of migration to AWS and company to AzureAD & O365.
          Improving upon & implementation of policies and procedures, automating repetitive company process and reduction
          of technical debt. Laravel and VueJS focused.`,
        },
        {
          header: 'Sentis - Developer',
          date: 'April 2015-2018',
          body: `Pivoting away from the survey platform and into custom client portals. Throughout this period I was
          introduced to my first frameworks & web servers. Working on a small team sometimes means wearing many hats.
          Taking on additional responsibilities to help spread the load. Introduced to Active Directory, Exchange and
          Asterisk. Personal focus remains on development.`
        },
        {
          header: 'Sentis - Survey Programmer',
          date: 'April 2013-2016',
          body: `Tasked with developing our ever evolving survey themes and question designs. Primarily a front-end roll
          focusing on product visuals, user experience and browser compatibility.
          Introduced to (┛ಠ_ಠ)┛彡Internet Explorer 8 ┻━┻.`
        },
        {
          header: 'Sentis - Call Centre Manager',
          date: 'April 2012-2014',
          body: `Overseeing the call centre operations.`
        }
      ]
    }
  },

}
</script>

<style scoped>
.ship {
  background: transparent;
  /* Declared on the base class (not just .ship-hit) so the filter transitions smoothly
     both into and back out of the hit flash, rather than just snapping back instantly. */
  transition: filter 0.15s ease-out;
}

.ship-hit {
  filter: brightness(1.8) drop-shadow(0 0 10px #4ade80) drop-shadow(0 0 20px #22c55e);
}

@keyframes move-twink-back {
  from {
    background-position: 0 0;
  }
  to {
    background-position: -10000px 5000px;
  }
}

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

/* Temporary AI ally. The outer .ally element owns the screen position and the warp
   animation (scale/opacity), while the inner .ally-body owns the heading rotation - kept
   on separate elements so the CSS warp animation and the JS-driven rotate transform never
   fight over a single transform. Durations here must match ALLY_WARP_*_DURATION. */
.ally {
  position: absolute;
  z-index: 17;
  pointer-events: none;
  filter: drop-shadow(0 0 5px rgba(165, 180, 252, 0.65));
}

.ally-body {
  width: 100%;
  height: 100%;
}

/* Ally phaser beam overlay - covers the whole play area; the line coords are container
   pixels. A quick zap-in then fade, matching ALLY_BEAM_DURATION (0.22s). */
.phaser-beam {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 18;
  pointer-events: none;
  overflow: visible;
}

.phaser-beam-line {
  stroke: #fdba74;
  stroke-width: 3.5;
  stroke-linecap: round;
  filter: drop-shadow(0 0 4px #fb923c) drop-shadow(0 0 8px rgba(249, 115, 22, 0.8));
  animation: phaser-beam-zap 0.22s ease-out forwards;
}

@keyframes phaser-beam-zap {
  0% {
    opacity: 0.2;
    stroke-width: 6;
  }
  25% {
    opacity: 1;
    stroke-width: 4;
  }
  100% {
    opacity: 0;
    stroke-width: 2;
  }
}

.ally--warp-in {
  animation: ally-warp-in 0.7s ease-out;
}

.ally--warp-out {
  animation: ally-warp-out 0.7s ease-in forwards;
}

@keyframes ally-warp-in {
  0% {
    transform: scaleX(0.08) scaleY(2.6);
    opacity: 0;
    filter: brightness(3) drop-shadow(0 0 14px #a5b4fc);
  }
  55% {
    opacity: 1;
  }
  100% {
    transform: scaleX(1) scaleY(1);
    opacity: 1;
  }
}

@keyframes ally-warp-out {
  0% {
    transform: scaleX(1) scaleY(1);
    opacity: 1;
  }
  100% {
    transform: scaleX(0.08) scaleY(2.6);
    opacity: 0;
    filter: brightness(3) drop-shadow(0 0 14px #a5b4fc);
  }
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

/* --- 8-bit continue / game-over screens (teleported to <body>) --------------------- */
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

.ufo-health-track {
  position: absolute;
  height: 5px;
  z-index: 11;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 3px;
  overflow: hidden;
  transform: translate(-2px, -10px);
  pointer-events: none;
  transition-property: width, filter;
}

.ufo-health-fill {
  height: 100%;
  transition: width 0.2s ease-out, background-color 0.2s ease-out;
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

/* Cyan aura while a shield buff is active, layered on top of the ship's own transition. */
.ship-shielded {
  filter: drop-shadow(0 0 6px #22d3ee) drop-shadow(0 0 12px #06b6d4);
}

.ufo-destroyed {
  background: #fde047 !important;
  border-radius: 9999px;
  box-shadow: 0 0 24px 10px rgba(250, 204, 21, 0.85);
  animation: ufo-destroyed-pulse 1.2s ease-out;
}

@keyframes ufo-destroyed-pulse {
  0% {
    transform: scale(1);
  }
  15% {
    transform: scale(1.7);
  }
  35% {
    transform: scale(1.1);
  }
  55% {
    transform: scale(1.5);
  }
  100% {
    transform: scale(1);
  }
}

.power-up {
  position: absolute;
  z-index: 19;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  border: 2px solid currentColor;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.55);
  font-size: 15px;
  line-height: 1;
  transform: translate(-50%, -50%);
  pointer-events: none;
  animation: power-up-idle 1.6s ease-in-out infinite;
}

@keyframes power-up-idle {
  0%, 100% {
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.12);
  }
}

.power-up--collected {
  animation: none;
  transition: transform 0.3s ease-out, opacity 0.3s ease-out;
  transform: translate(-50%, -50%) scale(2.2);
  opacity: 0;
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

.stars {
  background: black url(https://res.cloudinary.com/ddaji66m6/image/upload/v1611800904/portfolio/stars_vcimcd.png) repeat top center;
  z-index: 0;
}

.twinkling {
  background: transparent url(https://res.cloudinary.com/ddaji66m6/image/upload/v1611800910/portfolio/twinkling_qmxcrl.png) repeat top center;
  opacity: 0.6;
  z-index: 1;

  -moz-animation: move-twink-back 300s linear infinite;
  -ms-animation: move-twink-back 300s linear infinite;
  -o-animation: move-twink-back 300s linear infinite;
  -webkit-animation: move-twink-back 300s linear infinite;
  animation: move-twink-back 300s linear infinite;
}
</style>
