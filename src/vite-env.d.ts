/// <reference types="vite/client" />

/**
 * Build stamps, substituted by `define` in `vite.config.ts`.
 *
 * These exist so the version showing in Settings is the *build's* identity, not
 * something read at runtime — the whole point is to confirm which bundle a
 * phone is actually executing.
 */

/** Short commit SHA, or `dev` outside a git checkout / CI. */
declare const __BUILD_COMMIT__: string

/** ISO-8601 instant the bundle was built. */
declare const __BUILD_TIME__: string
