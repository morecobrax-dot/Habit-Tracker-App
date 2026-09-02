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
| 2 | Logging, streaks, freeze tokens, backdating | **Done** |
| 3 | XP, levels, daily focus | **Done** |
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

### Streaks and freeze tokens

Three rules, all of which follow from the app's premise rather than from
convention:

1. **A partial keeps the streak.** If the two-minute version broke your streak,
   it would be a trap rather than an escape hatch. `skip` does not count — it is
   bookkeeping that records "consciously declined" as distinct from "never
   engaged".
2. **The current period is never a break.** An unlogged today does not end
   anything; the day is still open. Same for the current week on an x-per-week
   habit. Only a period that has fully closed can break a streak. Without this
   the app would spend all day telling you your streak is zero.
3. **A freeze preserves, it does not increment.** A frozen day keeps the streak
   intact but adds nothing to it, and the freeze ledger records it, so the UI can
   say "Tuesday was covered" rather than showing an unbroken streak and quietly
   lying.

Cadences differ in unit: daily and set-day habits count consecutive *scheduled
days* (a Mon/Wed/Fri habit does not break on Tuesday), while x-per-week habits
count consecutive *weeks* that met the target — there is deliberately no mid-week
deadline to miss.

Tokens are a global pool, granted weekly and spent automatically at rollover.
Automatic on purpose: a manual "spend a token to save your streak" prompt would
create an obligation to open the app before midnight, which is the exact
loss-pressure the app exists to remove. When tokens are scarce, the longest
streak is protected first.

### Day rollover

`runRollover` settles every day that has closed since the app was last opened. It
is idempotent (an installed PWA gets opened constantly) and replays correctly
after an absence, bounded at 60 days since the outcome beyond that is identical.
It never settles today.

### XP, levels and daily focus

```
xp = round(base × completionFactor × consistencyMultiplier) + focusBonus
```

Every tunable number lives in one `XpRules` object (`domain/rules/xpRules.ts`) as
plain data. That is the AI seam: a future planning layer emits an `XpRules` value
and nothing in the domain engine changes. Each log snapshots both its award and
the `version` that produced it, so changing the numbers cannot rewrite history.

**Consistency, not streak.** A streak multiplier collapses from its maximum to
1.0 the moment a streak breaks — a ~23% pay cut for one bad day, which a
loss-averse brain reads as punishment and which bites hardest exactly when the
user most needs permission to do the two-minute version. The multiplier here
measures completions over a trailing 14 days instead: missing one day moves it
from 1.30 to 1.28, and it recovers within days. Expectations are cadence-aware,
so a Mon/Wed/Fri habit can reach the same cap as a daily one.

**The focus bonus is flat (+25), not multiplicative.** Avoided tasks are usually
trivial-but-dreaded — make the call, open the letter. A flat bonus means a
tier-1 habit done at its two-minute minimum outscores a tier-3 habit completed in
full. The app should pay most for *starting the thing being avoided, at its
smallest size*. There is a test asserting exactly that inequality.

**Total XP is derived**, summed from `log.xpAwarded`. Level is derived from that.
Nothing is stored, so nothing can drift.

**XP never falls.** The award banked for a day ratchets: upgrading a partial to a
complete pays the difference; downgrading to a skip keeps what was earned.
(Deleting a log with Undo does remove its XP — that is the user retracting their
own entry, and without it log/undo/re-log would mint XP indefinitely.)

**Daily focus is designed against becoming a nag.** A habit cannot hold focus
more than two days running, then it is benched for two. The neglect score is
bounded, so a habit ignored for a year cannot dominate forever. And the card
never displays a days-avoided counter — neglect drives *selection*, but showing
it back would turn the mechanic into a daily accusation.

### Deployment

Published to GitHub Pages by `.github/workflows/deploy.yml` on push to `main`, or
manually via workflow_dispatch. The workflow typechecks, lints and tests before
building — publishing a failing build would put a broken app on a phone home
screen, where the service worker then caches it.

`base` is keyed on Vite's `mode`, not `command`, so `vite preview` serves from
the same subpath production does and is a faithful rehearsal. Dev stays on `/`.

One-time repo setup: **Settings → Pages → Source: GitHub Actions**.

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
