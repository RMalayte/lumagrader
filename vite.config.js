import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Relative base so the build works on GitHub Pages project sites
// (username.github.io/repo-name/) without hardcoding the repo name.
export default defineConfig({
  plugins: [react()],
  base: './',
  // App version + build date for the About dialog and the "What's new" popup.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
})
