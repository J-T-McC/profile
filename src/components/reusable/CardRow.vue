<template>
  <div class="lg:flex card-row lg:mt-0 lg:mb-0" :class="{'flex-row-reverse' : reverse, '': mode.isDarkMode.value}">
    <div class="w-full lg:w-1/2 lg:py-12"></div>
    <animated-border class="pointer-events-none" :delay="delay"></animated-border>
    <!-- The half-width column and the decorative border are transparent where there's no
         card, so they let pointer events fall through to the game canvas behind (only the
         card itself stays interactive - it's meant to sit "in front of" the game world). -->
    <div
        class="flex justify-center card-container relative lg:py-12 pointer-events-none"
        :class="{'lg:justify-end': reverse, 'lg:justify-start': !reverse}">
      <card class="pointer-events-auto" v-bind="{...card}"></card>
    </div>
  </div>
</template>

<script>
import Card from "@/components/reusable/Card";
import AnimatedBorder from "@/components/reusable/AnimatedBorder";
import useDarkMode from '@/hooks/useDarkMode'

export default {
  name: "CardRow",
  props: ['reverse', 'header', 'card', 'delay'],
  components: {
    Card,
    AnimatedBorder
  },
  setup() {
    return {
      mode: useDarkMode()
    }
  }
}
</script>