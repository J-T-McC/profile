<template>
  <div class="relative overflow-hidden bg-blue-500 dark:bg-blue-900 z-20 transition-colors" id="me">
    <div class="lg:w-1/2 max-w-screen-xl h-screen">
      <div class="relative pb-8 bg-blue-500 dark:bg-blue-900 sm:pb-16 md:pb-20 lg:w-full lg:pb-28 xl:pb-32 transition-colors duration-500">
        <svg class="hidden z-10 lg:block absolute right-0 inset-y-0 h-full w-64 text-blue-500 dark:text-blue-900 transform angle-split transition-colors duration-500"
             fill="currentColor" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="50,0 100,0 50,100 0,100"/>
        </svg>
        <main class="mx-auto max-w-screen-xl xl:py-30 lg:py-20 py-5 px-10 h-screen flex items-center justify-center">
          <div class="sm:text-center lg:text-left z-20 text-white">
            <h1 class="text-4xl tracking-tight leading-10 font-extrabold sm:text-5xl sm:leading-none md:text-5xl">
              Web Developer
            </h1>
            <p class="mt-3 text-base sm:mt-5 sm:text-lg sm:max-w-xl sm:mx-auto md:mt-5 md:text-xl lg:mx-0">
              Welcome to my personal developer profile. Below you will find a brief summary of my most recent
              professional experience. Please reach out if you have any questions or comments.
            </p>
            <div class="mt-5 sm:mt-8 sm:flex sm:justify-center lg:justify-start">
              <div class="rounded-md shadow" v-scroll-to="'#about'">
                <a href="#"
                   class="
                      flex
                      justify-center
                      py-3
                      px-8
                      leading-6
                      border
                      border-transparent
                      rounded-md
                      font-medium
                      text-base
                      text-white
                      bg-blue-600
                      ease-in-out
                      transition
                      duration-100
                      hover:bg-blue-400
                      focus:outline-none
                      focus:border-indigo-700
                      focus:shadow-outline-indigo
                      md:py-4
                      md:text-lg
                      md:px-10">
                  About
                </a>
              </div>
              <div class="mt-3 sm:mt-0 sm:ml-3" v-scroll-to="'#contact'">
                <a href="#"
                   class="
                      flex
                      justify-center
                      px-8
                      py-3
                      leading-6
                      border
                      border-transparent
                      rounded-md
                      font-medium
                      text-base
                      text-blue-700
                      bg-indigo-100
                      ease-in-out
                      transition
                      duration-150
                      hover:text-indigo-600
                      focus:outline-none
                      focus:shadow-outline-indigo
                      focus:border-indigo-300
                      md:py-4
                      md:text-lg
                      md:px-10">
                  Contact Me
                </a>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
    <div class="block absolute inset-y-0 right-0 w-full lg:w-1/2">
      <img class="w-full object-cover w-full h-full opacity-25 lg:opacity-100"
           :src="`https://res.cloudinary.com/ddaji66m6/image/upload/f_auto,c_scale,${bannerWidth}/portfolio/banner_dzxfbj.jpg`"
           alt="">
    </div>
  </div>
</template>

<script>

import {isMobileOnly, isMobile, isTablet} from 'mobile-device-detect';
import { computed } from 'vue';
import useDarkMode from '@/hooks/useDarkMode';

export default {
  name: "Me",
  setup() {
    const bannerWidth = computed(() => {
        if(isMobileOnly) {
          return 'w_800';
        }

        if(isMobile || isTablet) {
          return 'w_1500';
        }

        return 'w_auto';
    });

    return {
      bannerWidth,
      mode: useDarkMode()
    }
  },
}
</script>

<style scoped>
.angle-split {
  transform: translateX(44%);
}
</style>