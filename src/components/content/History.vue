<template>
  <section-break
      gradient-from="from-purple-400"
      gradient-via="via-pink-400"
      gradient-to="to-blue-500"
      animation="animate-gradient-xy">
  </section-break>
  <div id="about" class="relative" ref="container" :class="{'select-none': mode.isDarkMode.value && !isMobileOnly}">
    <div
        class="hidden lg:block h-full w-full absolute top-0 left-0"
        v-if="mode.isDarkMode.value && !isMobileOnly"
        tabindex="0"
        @mousemove="rotateShip" @click="moveShip" @keydown="onKeyDown">
      <div class="absolute top-2 left-2 z-10 flex items-center gap-2">
        <div v-if="score || bestScore" class="gamify text-white text-xl" :class="{'score-pulse': scorePulse}">SCORE: {{ score }} <span class="text-base opacity-70">BEST: {{ bestScore }}</span></div>
        <button type="button" class="mute-toggle text-white text-xs bg-black bg-opacity-40 px-2 py-1 rounded-full" @click.stop="toggleMute">{{ muted ? '🔇' : '🔊' }}</button>
      </div>
      <div v-if="hintVisible" class="hint absolute top-2 right-2 z-10 text-white text-sm bg-black bg-opacity-40 px-3 py-1 rounded-full pointer-events-none">Click to fly &middot; click the UFO to shoot &middot; Space to fire</div>
      <div class="stars z-0 absolute top-0 left-0 w-full h-full"></div>
      <div class="twinkling z-0 absolute top-0 left-0 w-full h-full"></div>
      <div v-for="flash in warpFlashes" :key="flash.id" class="warp-flash" :class="{'warp-flash--active': flash.active}" :style="{top: flash.y + 'px', left: flash.x + 'px'}"></div>
      <img src="https://res.cloudinary.com/ddaji66m6/image/upload/v1612058700/portfolio/spaceship_tlg2od.png" alt="ship" ref="ship" :style="shipPos" class="block ship absolute w-10 h-10 z-20 bg-white select-none"/>
      <SvgWeapon v-for="projectile in projectiles" :key="projectile.id" :x="projectile.x" :y="projectile.y" :state="projectile.state"/>

      <SvgUFO
          ref="ufo"
          @click="ufoClicked"
          @mouseenter="randomizePosition"
          :style="ufoPos"
          :class="{'bg-red-600 rounded-full': hit}"
          class="absolute select-none hidden lg:block h-10 w-10 wobble transition-all cursor-crosshair"
      />

    </div>
    <div class="lg:bg-gradient-to-r from-white via-white to-gray-200 pt-6 lg:pt-0 dark:bg-gray-900 z-50 pb-5 lg:pb-0 transition-colors duration-500">
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
import useSpaceGame from '@/hooks/useSpaceGame'
import SvgUFO from '@/components/icons/SvgUFO'
import { isMobileOnly } from 'mobile-device-detect'
import SvgWeapon from '@/components/icons/SvgWeapon'

export default {
  name: 'History',
  components: {
    SvgWeapon,
    SvgUFO,
    CardRow,
    SectionBreak
  },
  setup () {
    const mode = useDarkMode()

    const {
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
    } = useSpaceGame()

    if (!isMobileOnly) {
      scheduleUfoMovement()
    }

    return {
      randomizePosition,
      ufoClicked,
      rotateShip,
      moveShip,
      onKeyDown,
      shipPos,
      ship,
      ufo,
      score,
      bestScore,
      muted,
      toggleMute,
      projectiles,
      warpFlashes,
      hit,
      scorePulse,
      hintVisible,
      container,
      ufoPos,
      mode,
      isMobileOnly,
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
