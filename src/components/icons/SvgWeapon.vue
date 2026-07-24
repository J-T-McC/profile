<template>
  <div class="weapon-bolt" :class="`weapon-bolt--${state}`" :style="style"></div>
</template>

<script>
import { computed } from 'vue'

export default {
  name: 'SvgWeapon',
  props: {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    state: { type: String, default: 'flying' },
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
</style>
