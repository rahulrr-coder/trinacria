import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// `base` must match the GitHub Pages repo name so assets resolve at
// https://<user>.github.io/trinacria/
export default defineConfig({
  base: "/trinacria/",
  plugins: [
    react(),
    // Installable + offline. Data already lives in localStorage, so once the
    // built assets are precached the app works with no network.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Trinacria — your day in three movements',
        short_name: 'Trinacria',
        description: 'Your day in three movements — study, work, the thing you’re building.',
        lang: 'en',
        theme_color: '#FAF3E4',
        background_color: '#FAF3E4',
        display: 'standalone',
        start_url: '/trinacria/',
        scope: '/trinacria/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg}'] },
    }),
  ],
})
