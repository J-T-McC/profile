<template>
  <!-- Simplified top-down Federation starship (saucer + engineering hull + two nacelles),
       drawn nose-up so the parent can rotate it to face its heading. Purely decorative. -->
  <svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" class="enterprise">
    <!-- Nacelle struts (drawn first so the hull/nacelles sit on top) -->
    <path d="M48 74 L24 88" stroke="#9aa3b2" stroke-width="5" stroke-linecap="round"/>
    <path d="M52 74 L76 88" stroke="#9aa3b2" stroke-width="5" stroke-linecap="round"/>

    <!-- Left nacelle -->
    <rect x="12" y="58" width="13" height="52" rx="6" fill="#d3d8e2" stroke="#8b93a3" stroke-width="1.5"/>
    <circle cx="18.5" cy="62.5" r="5" fill="#f87171"/>
    <rect x="15" y="72" width="7" height="32" rx="3.5" fill="#60a5fa" opacity="0.85"/>

    <!-- Right nacelle -->
    <rect x="75" y="58" width="13" height="52" rx="6" fill="#d3d8e2" stroke="#8b93a3" stroke-width="1.5"/>
    <circle cx="81.5" cy="62.5" r="5" fill="#f87171"/>
    <rect x="78" y="72" width="7" height="32" rx="3.5" fill="#60a5fa" opacity="0.85"/>

    <!-- Engineering (secondary) hull + deflector dish -->
    <rect x="42" y="56" width="16" height="40" rx="8" fill="#c8cedb" stroke="#8b93a3" stroke-width="1.5"/>
    <circle cx="50" cy="93" r="4" fill="#fbbf24"/>

    <!-- Neck connecting saucer to hull -->
    <path d="M44 44 L56 44 L54 58 L46 58 Z" fill="#c8cedb" stroke="#8b93a3" stroke-width="1"/>

    <!-- Saucer section + bridge dome -->
    <ellipse cx="50" cy="30" rx="32" ry="17" fill="#d7dce5" stroke="#8b93a3" stroke-width="1.5"/>
    <ellipse cx="50" cy="30" rx="20" ry="10" fill="none" stroke="#aab2c0" stroke-width="1"/>
    <circle cx="50" cy="30" r="6.5" fill="#eef2f7" stroke="#aab2c0" stroke-width="1"/>
  </svg>
</template>

<script>
export default {
  name: 'SvgEnterprise',
}
</script>

<style scoped>
.enterprise {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
