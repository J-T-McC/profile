import { ref, computed } from 'vue'
import { isMobileOnly } from 'mobile-device-detect'

// Three themes: 'light', 'dark' (plain dark - no game) and 'alien' (dark + the spaceship
// game). Alien mode is desktop-only, so on mobile the toggle just flips light <-> dark.
export const MODE = {
  LIGHT: 'light',
  DARK: 'dark',
  ALIEN: 'alien',
}

const current = ref(MODE.LIGHT)

export default function useDarkMode() {

  const toggle = () => {
    if (current.value === MODE.LIGHT) {
      current.value = MODE.DARK
    } else if (current.value === MODE.DARK) {
      current.value = isMobileOnly ? MODE.LIGHT : MODE.ALIEN
    } else {
      current.value = MODE.LIGHT
    }
  }

  // Dark styling (the `.dark` class) applies to both the plain-dark and alien themes.
  const isDarkMode = computed(() => current.value === MODE.DARK || current.value === MODE.ALIEN)
  // The spaceship game only renders in alien mode.
  const isAlienMode = computed(() => current.value === MODE.ALIEN)

  return {
    current,
    toggle,
    isDarkMode,
    isAlienMode,
  }
}