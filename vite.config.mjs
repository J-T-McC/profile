import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // Mirror the old vue-cli '@' -> src alias so existing imports keep working.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // vue-cli/webpack resolved extensionless `.vue` imports (e.g. '@/components/X');
    // Vite doesn't include `.vue` by default, so add it to keep those imports working.
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.vue'],
  },
})
