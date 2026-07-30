import { createApp } from 'vue'
import * as VueScrollTo from 'vue-scrollto';
import Toast from "vue-toastification";

// Import global styles before App.vue so Tailwind's base/components/utilities land
// ahead of the components' scoped styles - matching the pre-Vite cascade order.
import './assets/styles/index.css';
import "vue-toastification/dist/index.css";

import App from './App.vue'

const Vue = createApp(App);

Vue.use(VueScrollTo, {
    container: "body",
    duration: 500,
    easing: "ease",
    offset: -50,
    force: true,
    cancelable: true,
    onStart: false,
    onDone: false,
    onCancel: false,
    x: false,
    y: true
});

Vue.use(Toast, {
    maxToasts: 1
});

Vue.mount('#app')

