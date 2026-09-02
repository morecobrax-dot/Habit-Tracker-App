# Habit Tracker

A habit tracker built around one question: **does this make it easier to start a task I'm avoiding?**

Local-first PWA. React + Vite + TypeScript, Tailwind, IndexedDB via Dexie. No backend, no auth, no account — everything stays on the device.

## Running it

```bash
npm install
npm run dev        # dev server
npm test           # domain + storage tests
npm run typecheck  # tsc, no emit
npm run lint       # eslint, including the domain-purity rules
npm run build      # production build + service worker
npm run preview    # serve the build (use this to test PWA install)
npm run icons      # regenerate public/icons from scripts/generate-icons.mjs
```

To install on a phone, run `npm run build && npm run preview -- --host`, open the LAN
address in mobile Safari or Chrome, and use "Add to Home Screen".

## Build status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Data model, storage, habit CRUD, settings, backup | **Done** |
| 2 | Logging, streaks, freeze tokens, backdating | Not started |
| 3 | XP, levels, daily focus | Not started |
| 4 | Dashboard and history UI | Not started |
| 5 | Polish, animation | Not started |

## Architecture

```
src/
├─ domain/      pure functions — no storage, no React, no ambient clock
├─ data/        Dexie. The only code that touches IndexedDB.
├─ services/    orchestration: read repos → call domain → write back
├─ state/       React context and live queries
├─ routes/      screens
└─ components/  UI primitives
tests/          domain and storage tests
```

### The domain layer is pure, and that is enforced

Nothing under `src/domain/` may import storage, services, React or Dexie, or read
the ambient clock. This is an ESLint rule (`eslint.config.js`), not a convention:

```
domain/ must stay pure: no storage, services, or UI imports.
domain/ must not read the ambient clock. Accept an `instant: number` parameter instead.
```

Two reasons. It makes the game maths testable without a browser or a database. And
it is the seam for the planned AI layer: an AI-generated plan is *data* — a ruleset,
difficulty overrides, schedules as JSON — dropped into the same pure functions, with
no rewrite.

### Days, not dates

The load-bearing concept is `DayKey` (`src/domain/time/dayKey.ts`) — a `YYYY-MM-DD`
string representing *your* day, not the calendar's.

- A day runs from `dayStartHour` (default 04:00) to the same hour next morning, so
  logging at 01:30 credits the day you just lived.
- `toDayKey` reads the **wall clock** in your zone and compares the hour. It never
  shifts an instant by a fixed number of hours — on a DST transition day that lands
  on the wrong date, and there is a test proving exactly that case.
- Once a value is a `DayKey`, all arithmetic is civil-date math, which is DST-immune
  because it never involves hours.

Conversion between instants and DayKeys happens in exactly two places: when a log is
written, and when a date is rendered.

### Other decisions worth knowing

- **Streaks and levels are derived, never stored.** The logs are the single source of
  truth. Two sources of truth means drift, and drift in these numbers destroys trust
  in the whole app.
- **XP is snapshotted on each log**, along with a `rulesVersion`. Rules can change
  later without rewriting history.
- **One log per habit per day**, enforced by a unique compound index — a double tap
  fails loudly rather than double-counting XP.
- **`minimumVersion` is required.** A habit with no defined two-minute fallback has no
  bad-day path, which is the failure this app exists to prevent.
- **Export/import ships in phase 1**, not in polish. With no backend, this device is
  the only copy.
