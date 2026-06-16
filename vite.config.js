import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` must match the GitHub Pages repo name so assets resolve at
// https://<user>.github.io/trinacria/
export default defineConfig({
  base: "/trinacria/",
  plugins: [react()],
})
