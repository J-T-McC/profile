<template>
  <!-- overflow-x: clip (overriding the overflow-x-hidden fallback) still hides horizontal
       overflow but, unlike `hidden`, does NOT establish a scroll container - which would
       otherwise break `position: sticky` on descendants (e.g. the game's score HUD). -->
  <div class="overflow-x-hidden w-full" style="overflow-x: clip">
    <me></me>
    <history></history>
    <contact></contact>
  </div>
</template>

<script>
import Me from "@/components/content/Me";
import History from "@/components/content/History";
import Contact from "@/components/content/Contact";

export default {
  name: "Body",
  components: {
    Me,
    History,
    Contact
  },
}
</script>