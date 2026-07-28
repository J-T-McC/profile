import { ref, computed, watch } from 'vue'
import { isMobileOnly } from 'mobile-device-detect'

// Three themes: 'light', 'dark' (plain dark - no game) and 'alien' (dark + the spaceship
// game). Alien mode is desktop-only, so on mobile the toggle just flips light <-> dark.
export const MODE = {
  LIGHT: 'light',
  DARK: 'dark',
  ALIEN: 'alien',
}

const STORAGE_KEY = 'theme'

const readStored = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch (e) {
    return null
  }
}

const writeStored = (value) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch (e) {
    // Ignore (e.g. storage disabled in private mode) - the choice just won't persist.
  }
}

const prefersDark = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

// Start from the persisted choice, falling back to the browser's colour-scheme preference
// on first visit. Alien mode is desktop-only, so a stored 'alien' on mobile is downgraded.
const initialMode = () => {
  const stored = readStored()
  if (stored === MODE.LIGHT || stored === MODE.DARK || stored === MODE.ALIEN) {
    return stored === MODE.ALIEN && isMobileOnly ? MODE.DARK : stored
  }
  return prefersDark() ? MODE.DARK : MODE.LIGHT
}

const current = ref(initialMode())

// Persist every change once, at module scope (not per hook call).
watch(current, writeStored)

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