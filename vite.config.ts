import { execSync } from 'node:child_process'
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

/**
 * Which build this is, stamped in at compile time.
 *
 * Shown in Settings so a glance at the phone answers "is this actually the new
 * version?" — the question that is otherwise unanswerable when a service worker
 * is serving something and you cannot tell what.
 *
 * `GITHUB_SHA` first because CI is where deployed builds come from; git second
 * for a local `npm run build`; `dev` when neither is available (a tarball, a
 * container without git) rather than failing the build over a version string.
 */
function buildCommit(): string {
  const fromCi = process.env.GITHUB_SHA
  if (fromCi) return fromCi.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

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
      /*
       * Unchanged, and already correct: the generated `sw.js` calls
       * `skipWaiting()` and `clientsClaim()`, so a new worker never sits in
       * the waiting state.
       */
      registerType: 'autoUpdate',
      /*
       * Registration is ours (`services/swUpdates.ts`).
       *
       * The default 'auto' injects `registerSW.js`, which registers on load
       * and then never checks again — no timer, no foreground check, no way
       * to hook one in. Importing `virtual:pwa-register` instead would hand
       * back an `onRegisteredSW` hook but also, in autoUpdate mode, an
       * unconditional `window.location.reload()` the instant the new worker
       * activates. `null` leaves both the update checks and the reload timing
       * under our control. See `services/swUpdates.ts` for the details.
       */
      injectRegister: null,
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
        /*
         * `index.html` is precached, but never with a TTL of its own — Workbox
         * stores it against a content revision hash and that hash lives inside
         * `sw.js`. So the HTML is replaced exactly when the worker is, and the
         * only thing that could pin the app to a stale asset manifest is a
         * stale `sw.js`. That is handled at registration with
         * `updateViaCache: 'none'` (see `services/swUpdates.ts`), which matters
         * here because GitHub Pages serves every file, `sw.js` included, with
         * `Cache-Control: max-age=600`.
         *
         * Deleting the previous build's precache is what stops an old HTML
         * revision surviving alongside the new one.
         */
        cleanupOutdatedCaches: true,
        /*
         * Never let a navigation be answered from the HTTP cache on the way to
         * the precache — a 10-minute-stale `index.html` served to a cold start
         * would reference asset hashes the new build no longer has.
         */
        navigationPreload: false,
      },
    }),
  ],
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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
