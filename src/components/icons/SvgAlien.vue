<template>
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <!-- Classic little green alien head -->
    <path
        d="M12 2C7.6 2 4.5 5.2 4.5 10c0 5 4 9.5 7.5 12 3.5-2.5 7.5-7 7.5-12 0-4.8-3.1-8-7.5-8z"
        fill="#4ade80"/>
    <ellipse cx="9" cy="11" rx="1.8" ry="3.1" fill="#0f172a" transform="rotate(22 9 11)"/>
    <ellipse cx="15" cy="11" rx="1.8" ry="3.1" fill="#0f172a" transform="rotate(-22 15 11)"/>
    <circle cx="12" cy="16.5" r="0.7" fill="#0f172a"/>
  </svg>
</template>

<script>
export default {
  name: 'SvgAlien'
}
</script>
