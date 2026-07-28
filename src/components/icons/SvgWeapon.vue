<template>
  <div class="weapon-bolt" :class="[`weapon-bolt--${state}`, `weapon-bolt--${owner}`, {'weapon-bolt--laser': laser, 'weapon-bolt--phaser': phaser}]" :style="style"></div>
</template>

<script>
import { computed } from 'vue'

export default {
  name: 'SvgWeapon',
  props: {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    state: { type: String, default: 'flying' },
    owner: { type: String, default: 'player' },
    laser: { type: Boolean, default: false },
    phaser: { type: Boolean, default: false },
  },
  setup (props) {
    const style = computed(() => ({
      top: props.y + 'px',
      left: props.x + 'px',
    }))

    return {
      style,
    }
  }
}
</script>

<style scoped>
.weapon-bolt {
  position: absolute;
  width: 12px;
  height: 12px;
  z-index: 20;
  border-radius: 9999px;
  background: #fca5a5;
  box-shadow: 0 0 6px 2px rgba(252, 165, 165, 0.9), 0 0 12px 4px rgba(248, 113, 113, 0.6);
  transition: transform 0.25s ease-out, opacity 0.25s ease-out, background 0.25s ease-out, box-shadow 0.25s ease-out;
}

.weapon-bolt--hit {
  background: #fde68a;
  box-shadow: 0 0 10px 4px rgba(253, 224, 71, 0.9), 0 0 20px 8px rgba(251, 191, 36, 0.6);
  transform: scale(2.4);
  opacity: 0;
}

.weapon-bolt--miss {
  opacity: 0;
  transition-duration: 0.15s;
}

.weapon-bolt--alien {
  background: #86efac;
  box-shadow: 0 0 6px 2px rgba(134, 239, 172, 0.9), 0 0 12px 4px rgba(74, 222, 128, 0.6);
}

.weapon-bolt--alien.weapon-bolt--hit {
  background: #4ade80;
  box-shadow: 0 0 10px 4px rgba(74, 222, 128, 0.9), 0 0 20px 8px rgba(34, 197, 94, 0.6);
}

/* Laser buff: a bigger, brighter, cyan-white bolt so charged shots read as
   noticeably stronger than the default red ones. Combined selector so the hit/miss
   state variants above still override it regardless of source order. */
.weapon-bolt--laser {
  width: 16px;
  height: 16px;
  background: #ecfeff;
  box-shadow: 0 0 8px 3px rgba(103, 232, 249, 0.95), 0 0 16px 6px rgba(34, 211, 238, 0.7);
}

/* Ally phaser: a hot orange-white bolt, distinct from the player's red shots and the
   laser buff's cyan. Combined selector so hit/miss state variants still override it. */
.weapon-bolt--phaser {
  width: 15px;
  height: 15px;
  background: #fff7ed;
  box-shadow: 0 0 8px 3px rgba(251, 146, 60, 0.95), 0 0 16px 6px rgba(249, 115, 22, 0.7);
}

.weapon-bolt--intercepted {
  background: #e5e7eb;
  box-shadow: 0 0 10px 4px rgba(229, 231, 235, 0.9), 0 0 18px 8px rgba(156, 163, 175, 0.6);
  transform: scale(1.8);
  opacity: 0;
}
</style>
