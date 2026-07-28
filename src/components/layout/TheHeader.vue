<template>
  <header>
    <nav class="
           duration-500
           transition-colors
           flex flex-wrap
           fixed top-0
           w-screen
           items-center justify-between
           border-b border-blue-500 dark:border-purple-800 border-solid border-opacity-75
           bg-white dark:bg-gray-800
           dark:text-gray-300
           p-6
           z-50">
      <div class="flex items-center flex-shrink-0 mr-6">
        <svg-logo></svg-logo>
        <span @click="close" class="font-semibold text-xl tracking-tight cursor-pointer" v-scroll-to="'#me'">Tyson McCarney</span>
      </div>

      <div class="block lg:hidden">
        <button @click="toggle"
                class="
                  flex
                  items-center
                  px-3
                  py-2
                  border
                  rounded
                  text-blue-500
                  border-blue-500
                  hover:text-blue-300
                  hover:border-blue-300">
          <svg-menu></svg-menu>
        </button>
      </div>

      <div
          class="
            w-full
            justify-between
            flex-grow
            lg:flex
            sm:items-center
            md:items-center
            lg:w-auto"
          :class="{'hidden': !open, 'block': open }">

        <div class="text-gray-700 dark:text-gray-300 text-md font-light tlg:flex-grow">
          <a v-scroll-to="'#about'"
             @click="close"
             href="#about"
             class="block mt-4 lg:inline-block lg:mt-0 hover:text-blue-400 mr-4">
            About
          </a>
          <a v-scroll-to="'#contact'"
             @click="close"
             href="#contact"
             class="block mt-4 lg:inline-block lg:mt-0 hover:text-blue-400 mr-4">
            Contact
          </a>
        </div>

        <div class="flex flex-row mt-4 lg:mt-0">
          <a href="https://www.linkedin.com/in/tyson-mccarney-7582ba71/" rel="noopener" class="mr-3" target="_blank">
            <SvgLinkedIn class="w-5 inline"/>
          </a>
          <a href="https://github.com/J-T-McC" rel="noopener" target="_blank">
            <SvgGithub class="w-5 inline"/>
          </a>

          <SvgSun @click="mode.toggle()" v-if="mode.current.value === 'light'"
                  class="select-none ml-3 w-7 h-7 inline cursor-pointer"/>
          <SvgMoon @click="mode.toggle()" v-if="mode.current.value === 'dark'"
                   class="select-none ml-3 w-7 h-7 inline cursor-pointer"/>
          <SvgAlien @click="mode.toggle()" v-if="mode.current.value === 'alien'"
                    class="select-none ml-3 w-7 h-7 inline cursor-pointer"/>
        </div>
      </div>

    </nav>
  </header>
</template>

<script>
import SvgMenu from '@/components/icons/SvgMenu'
import SvgLogo from '@/components/icons/SvgLogo'
import { ref } from 'vue'
import SvgGithub from '@/components/icons/SvgGithub'
import SvgLinkedIn from '@/components/icons/SvgLinkedIn'
import SvgSun from '@/components/icons/SvgSun'
import SvgMoon from '@/components/icons/SvgMoon'
import SvgAlien from '@/components/icons/SvgAlien'
import useDarkMode from '@/hooks/useDarkMode'

export default {
  name: 'Header',
  components: { SvgMoon, SvgSun, SvgAlien, SvgLinkedIn, SvgGithub, SvgLogo, SvgMenu },
  setup () {
    const open = ref(false)
    const toggle = () => {
      open.value = !open.value
    }
    const close = () => {
      open.value = false
    }
    const mode = useDarkMode()
    return {
      open,
      toggle,
      close,
      mode
    }
  },
}
</script>