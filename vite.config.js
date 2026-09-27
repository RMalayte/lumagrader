import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works on GitHub Pages project sites
// (username.github.io/repo-name/) without hardcoding the repo name.
export default defineConfig({
  plugins: [react()],
  base: './',
})
