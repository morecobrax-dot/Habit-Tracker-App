/**
 * Service worker registration and the policy for when to take an update.
 *
 * ## Why this is hand-rolled rather than `virtual:pwa-register`
 *
 * `vite-plugin-pwa` can inject its own registration, and its `registerSW`
 * helper exposes exactly the `onRegisteredSW` hook we want. But in
 * `autoUpdate` mode that helper also does this, unconditionally and with no
 * way to opt out (`dist/client/build/register.js`):
 *
 *     wb.addEventListener('activated', (event) => {
 *       if (event.isUpdate || event.isExternal) window.location.reload()
 *     })
 *
 * That is an instant reload the moment the new worker activates — which, with
 * `skipWaiting`, is the moment it finishes downloading. Mid-tap, the screen
 * blanks and comes back. Owning the registration is the only way to keep
 * `autoUpdate`'s "never sit in waiting" behaviour *and* choose when the page
 * actually swaps.
 *
 * The `skipWaiting()` / `clientsClaim()` calls come from `registerType:
 * 'autoUpdate'` in the Vite config and are compiled into `sw.js` itself, so
 * they are unaffected by registering by hand.
 *
 * ## The problem this solves
 *
 * The browser only looks for a new worker on a navigation within scope, and on
 * a roughly-daily staleness check. An installed PWA resumed from the home
 * screen does neither: iOS freezes the page and thaws it, which is not a
 * navigation. So the app could sit on an old build indefinitely — nothing was
 * ever asking.
 */

/** Deliberately not shorter. Each check is a conditional GET for `sw.js`. */
const UPDATE_INTERVAL_MS = 30 * 60 * 1000

export function registerServiceWorker(): void {
  // The worker only exists in a production build, and registering a
  // non-existent script logs a console error on every dev reload.
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  const swUrl = `${import.meta.env.BASE_URL}sw.js`
  const scope = import.meta.env.BASE_URL

  /*
   * Was this page already controlled when it loaded?
   *
   * `clientsClaim()` fires `controllerchange` for the *first* worker taking
   * control too. Reloading on that would bounce every user once on their very
   * first launch, for an update that never happened.
   */
  const hadControllerAtLoad = navigator.serviceWorker.controller !== null

  let reloading = false
  let updatePending = false
  /*
   * Whether the user has touched anything since the page became visible.
   *
   * This is what makes a one-cycle update possible on iOS. The sequence there
   * is: resume -> we check -> new worker downloads and activates ->
   * `controllerchange`. That all happens in the first moment after the app is
   * opened, before a finger has landed on anything, so reloading right then is
   * indistinguishable from a slightly slow launch. Waiting for the *next*
   * foreground event in that case would cost a whole extra background/resume
   * cycle for no benefit.
   */
  let interactedSinceVisible = false

  const reload = () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  }

  const markInteraction = () => {
    interactedSinceVisible = true
  }
  // `capture` so this sees the event even if a handler stops propagation.
  window.addEventListener('pointerdown', markInteraction, { capture: true, passive: true })
  window.addEventListener('keydown', markInteraction, { capture: true, passive: true })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad) return

    // Nothing is being interacted with, so swap now. Reloading a hidden page
    // is the ideal case: the app is simply already up to date when reopened.
    if (document.visibilityState !== 'visible' || !interactedSinceVisible) {
      reload()
      return
    }

    // Mid-use. Nothing is lost by waiting — habits and logs live in IndexedDB,
    // not in the page — and a screen that blanks under the thumb reads as a
    // crash. The swap happens on the next return to the foreground.
    updatePending = true
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl, {
        scope,
        /*
         * GitHub Pages serves *everything* with `Cache-Control: max-age=600`,
         * `sw.js` included. The default `updateViaCache: 'imports'` already
         * exempts the top-level worker script, but 'none' also forces its
         * `importScripts()` (the Workbox runtime) to revalidate. This is the
         * setting that stops the app pinning itself to a stale worker, and
         * therefore to a stale precache manifest.
         */
        updateViaCache: 'none',
      })
      .then((registration) => onRegisteredSW(registration))
      .catch(() => {
        // A failed registration is not worth surfacing: the app is fully
        // functional without a service worker, just not offline-capable.
      })
  })

  function onRegisteredSW(registration: ServiceWorkerRegistration): void {
    const checkForUpdate = () => {
      // Rejects when offline, which is expected and uninteresting.
      void registration.update().catch(() => {})
    }

    // Timer: covers a session left open for hours on a desktop or an Android
    // PWA that keeps running in the background.
    window.setInterval(checkForUpdate, UPDATE_INTERVAL_MS)

    // Foreground: the one that matters on a phone, where the timer is frozen
    // along with the rest of the page while the app is in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return

      interactedSinceVisible = false

      // An update that landed while the user was mid-tap gets applied here,
      // at the safest possible moment: they have just reopened the app.
      if (updatePending) {
        reload()
        return
      }

      checkForUpdate()
    })
  }
}
