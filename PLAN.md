# Build plan

Read `CLAUDE.md` first. Do the next unchecked step only. Write the audit
to `reports/step-N.md`, tick the box here, then stop.

## Ordering constraint

Two tracks are running. **App phase 2 must be finished and tested before
design steps 4 and 5**, because the home page and history screens read
real streak data. Building them first means building them twice.

Design steps 2 and 3 are self-contained and safe to do in any order.

---

## App track

### [x] Phase 1 — foundation
Data model, storage layer, habit CRUD. No game layer.

### [ ] Phase 2 — logging and streaks
No XP, no levels. Logging events, and streaks derived correctly from
them.

Implemented in `cda25fd`. Audited against this checklist in
`reports/phase-2.md`: 20 of 23 items verified, 3 open — all product
rulings, not code. Box stays unticked until those are settled.

**Logging**
- [x] Log entry records: habit id, the date it applies to, completion
      type (complete / partial / skipped), and creation timestamp.
      Applied-date and created-at are stored separately — backdating
      makes them differ and later features need both.
- [x] One log per habit per day; logging again updates rather than
      duplicating.
- [x] Backdating allowed for the previous 2 days only (today is day 0).
      Enforced in the logic layer, not just the UI.
- [ ] "Skipped" is a deliberate user action and is not the same as an
      untouched day. Treat them differently in streak rules.
      **OPEN** — currently identical to untouched, which contradicts an
      earlier explicit decision. Needs a ruling. See `reports/phase-2.md`.

**Streaks — cadence-aware**
- [x] Daily habits: consecutive qualifying days.
- [x] Specific-weekday habits: only scheduled weekdays can break a
      streak; unscheduled days ignored entirely.
- [x] X-per-week habits: evaluated by week, not by day. Streak counts
      satisfied weeks. The current week is never counted as broken while
      still in progress.
- [x] Complete and partial both keep a streak alive. Partial counts at
      full weight toward x-per-week for now — flag it if that's wrong.
- [x] Current streak and longest streak tracked per habit.

**Freeze tokens**
- [x] Earned on a weekly cadence up to a small cap. Propose the exact
      earn rate and cap with reasoning before implementing.
- [x] Consumed automatically to cover a break; the user can see it
      happened.
- [x] Can't go negative, can't be spent retroactively beyond the
      backdating window.

**Edge cases — handle each explicitly, don't leave them implicit**
- [x] Day rollover: when does "today" end? Local time, one configurable
      boundary value.
- [x] Timezone change while travelling: logs must not shift days or
      duplicate.
- [x] Habit created mid-week — how does its first x-per-week window work?
- [ ] Habit archived then reactivated: does the old streak resume or
      start fresh? Propose an answer.
      **OPEN** — today the archived stretch counts as misses, silently
      breaking the streak. Proposal in `reports/phase-2.md`.
- [ ] Cadence changed on a habit with history: how are past streaks
      treated?
      **OPEN** — history is judged by today's cadence, so a cadence change
      retroactively destroys earned streaks. Proposal in
      `reports/phase-2.md`.
- [x] Multiple logs submitted rapidly for the same habit and day.
- [x] A backdated log that retroactively repairs a broken streak.

**Tests — the part that matters most**
- [x] Pure functions for all streak and cadence logic. Current date
      passed in, never read from the clock inside.
- [ ] Tests covering every edge case above, plus: a normal unbroken run,
      a break with no token available, a break covered by a token, a
      week boundary crossing, a longest-streak update.
      All five named cases covered, plus timezone change, rapid
      submission and backdated repair. Stays open only because two edge
      cases above are unresolved.
- [x] Tests passing before any UI work.

**UI**
- [x] Minimal only: log complete / partial / skipped, backdate within
      the window, see current streak. Plain, no polish.

### [x] Phase 3 — XP and levels
Implemented in `28dc52f`, audited in `reports/phase-3.md`.

Ticked with two notes. The multiplier is *consistency*, not streak, per
explicit instruction — a streak multiplier drops 1.30 to 1.00 on one bad
day, which reads as punishment. And the approved worked example was ~3%
optimistic: the real week produces 499 XP, now pinned as a test rather
than living in prose.

**Open, not blocking:** the focus bonus is flat while every other term is
multiplied, so the focus advantage erodes as consistency rises — it wins
by 1 XP at multiplier 1.00 and loses from 1.10 onward. Proposed one-line
fix in `reports/phase-3.md`; changing the formula needs approval.
- [x] XP per log based on difficulty, completion type, streak multiplier
      (capped), and daily-focus bonus.
- [x] Level curve: fast early, progressively slower.
- [x] Propose the formula and curve with a worked example showing what a
      realistic week produces — get approval before implementing.
- [x] Daily focus: surfaces the longest-avoided habit with bonus XP.

---

## Design track

### [x] Step 1 — design system
Tokens file, palette, contrast audit, swatch page at `/#/styleguide`
(DEV-guarded). Committed as `c243d33`.

Findings carried into `CLAUDE.md`: `text-muted` lifted to `#94787E`,
old value retained as `text-disabled` for non-text use;
`border-interactive` added for control outlines.

Legacy palette still in `index.css`, marked for deletion in the final
step.

### [x] Step 2 — gold gem icon library
Committed as `34911a1` and `99a5488`. Audit in `reports/step-3.md`
(the heatmap item was closed out there).
- [x] 12–16 gem/crystal shapes as original inline SVG components.
      Generate from scratch — do not copy or trace any stock asset.
- [x] Style: flat geometric facets, gold base fill with a lighter facet
      highlight and darker facet shadow, one small white sparkle. No
      photorealism, no gradients beyond two flat facet tones.
- [x] Each icon takes a colour prop — gold by default, tintable.
- [x] Every icon must read at both sizes it's used at (small on cards,
      larger in the picker). Render both sizes side by side, show me,
      and simplify any that loses its silhouette when small.
- [x] Icon picker in the habit create/edit form. Semantic radio group,
      arrow-key navigable, accessible names, selected state visible
      without relying on colour alone.
- [x] All icons visible at once at phone width, no scrolling. Cut the
      count rather than adding a scroll area.
- [x] Icons on habit cards at consistent size, with a subtle drop glow
      only when that habit is completed today.
- [x] Sensible default so a habit created without picking one still
      looks right.
- [x] Apply `tabular-nums` to all stat display tokens as part of this
      step.
- [x] Confirm the heatmap grid reads structurally at zero intensity —
      grid defined by gaps between cells, not by cell fill, so a sparse
      week looks sparse rather than broken. Report how it's built.

### [x] Step 3 — the streak flame
The centerpiece of the home page.

Committed with `reports/step-3.md`. Tier mapping is a tested pure
function in `domain/flameTier.ts`; the component owns only appearance.
Not yet placed on a real screen — that is the streak hero in step 4.

- [x] Inline SVG, simple bold flat art style: clean silhouette, soft
      inner core, smooth curves, subtle dark outline so it reads on dark
      backgrounds. No realistic fire texture.
- [x] Colour tier by streak length:

      | Streak | Colour |
      |---|---|
      | 0 days | gray, unlit, low opacity |
      | 1–6 | orange → red |
      | 7–13 | deep red → pink |
      | 14–29 | magenta / hot pink |
      | 30–59 | violet → blue |
      | 60+ | teal / cyan (the rare one) |

- [x] Matching glow per tier; glow intensity scales with tier. Higher
      tiers must feel worth chasing.
- [x] Gentle flicker: scale-and-opacity loop under 2s, transform and
      opacity only, behind a `prefers-reduced-motion` guard.
- [x] Brief celebratory pulse when a tier is reached.

### [ ] Step 4 — home page rebuild
**Blocked on app phase 2.** Reads real streak data.

Top to bottom:
- [ ] Header: current level, XP progress bar with glowing fill and
      subtle sheen, XP remaining to next level.
- [ ] Streak hero: largest flame (longest active streak) with day count,
      sized as the visual anchor of the page.
- [ ] Today's focus: the longest-avoided habit, distinct card with red
      accent border and bonus XP shown. Must read as the most inviting
      thing on screen.
- [ ] Today's habits: gold icon, name, small flame with streak count,
      large tap target to complete.
- [ ] Contribution heatmap, last 12 weeks, maroon-to-red intensity ramp,
      empty days as bare surface cells.
      **Constraint:** must sit directly on `bg-base`, not inside a
      `surface` card — `heat-0` equals `surface`, so on a card an empty
      grid vanishes entirely. Verified in `reports/step-3.md`.
- [ ] Weekly bar chart of completions, red-to-maroon ramp, soft glow on
      the current day.

### [ ] Step 5 — standard habit-tracker features
**Blocked on app phase 2.**

- [ ] Completion interaction: card fills, icon glows, XP number floats
      up. Under 400ms. The single most important animation in the app.
- [ ] Drag to reorder habits.
- [ ] Per-habit detail screen with its own calendar heatmap and stats.
- [ ] Weekly review: completion rate, best streak, most missed habit.
- [ ] Empty states with real copy, not blank space.
- [ ] Skeleton loaders instead of layout jumps.
- [ ] Bottom tab navigation, thumb-reachable, clear active state.

### [ ] Step 6 — cleanup and audit
Audit portion done in `reports/step-6.md`; the deletion waits on step 4.

Headlines: no hardcoded hex anywhere. 75 legacy references, concentrated
in `components/ui/index.tsx` — migrate that first and most of the app
moves at once. Cards render at three different radii (12/16/20px)
because `rounded-xl` and `rounded-2xl` are Tailwind defaults rather than
tokens. 37 contrast failures, every one from a legacy token or a
deliberate demo row; the new palette produces none.

Re-runnable as `audit.mjs` against a dev server.
- [ ] Delete the legacy palette from `index.css`.
      **BLOCKED on step 4.** Still load-bearing for 75 references across
      six files; deleting it now leaves those screens with undefined
      colours. Unblocked once the screens are migrated.
- [x] Flag any component still pointing at legacy tokens.
- [x] Audit every screen against the tokens file; report anything that
      drifted.
- [x] Full contrast re-check across all screens.

---

## Later — not now

An AI layer that reviews logs and adjusts habit difficulty and suggests
focus. Requires a server function to hold the API key — it can never sit
in frontend code. Keep XP and scheduling logic pure and swappable so this
drops in without a rewrite.
