import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * GitHub Pages serves this repo from `/Habit-Tracker-App/`, not the domain
 * root, so production assets need that prefix. Dev stays on `/` — a subpath in
 * development buys nothing and makes every local URL awkward.
 *
 * Everything downstream (PWA manifest, service worker scope, icon paths) is
 * derived from this single value rather than hard-coded, so renaming the repo
 * means changing one line.
 */
const BASE = '/Habit-Tracker-App/'

export default defineConfig(({ mode }) => ({
  /*
   * Keyed on `mode`, not `command`. `vite preview` runs with command 'serve',
   * so a command-based check would serve the production bundle from '/' while
   * its HTML references '/Habit-Tracker-App/' — preview would 404 and, worse,
   * would stop being a faithful rehearsal of the deployed site. Mode is
   * 'development' for `vite dev` and 'production' for both build and preview,
   * which is exactly the split we want.
   */
  base: mode === 'production' ? BASE : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: 'Habit Tracker',
        short_name: 'Habits',
        description: 'A habit tracker built to make starting easier.',
        // Absolute and base-derived. Relative values ('.') resolve against the
        // manifest's own location, which breaks "Add to Home Screen" scope
        // detection on iOS when served from a subpath.
        id: BASE,
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1020',
        theme_color: '#0b1020',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Everything is on-device; there are no API calls to cache.
        // The fallback must carry the base, or a cold navigation on Pages
        // resolves to the domain root and 404s.
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}))
