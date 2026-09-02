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

**Logging**
- [ ] Log entry records: habit id, the date it applies to, completion
      type (complete / partial / skipped), and creation timestamp.
      Applied-date and created-at are stored separately — backdating
      makes them differ and later features need both.
- [ ] One log per habit per day; logging again updates rather than
      duplicating.
- [ ] Backdating allowed for the previous 2 days only (today is day 0).
      Enforced in the logic layer, not just the UI.
- [ ] "Skipped" is a deliberate user action and is not the same as an
      untouched day. Treat them differently in streak rules.

**Streaks — cadence-aware**
- [ ] Daily habits: consecutive qualifying days.
- [ ] Specific-weekday habits: only scheduled weekdays can break a
      streak; unscheduled days ignored entirely.
- [ ] X-per-week habits: evaluated by week, not by day. Streak counts
      satisfied weeks. The current week is never counted as broken while
      still in progress.
- [ ] Complete and partial both keep a streak alive. Partial counts at
      full weight toward x-per-week for now — flag it if that's wrong.
- [ ] Current streak and longest streak tracked per habit.

**Freeze tokens**
- [ ] Earned on a weekly cadence up to a small cap. Propose the exact
      earn rate and cap with reasoning before implementing.
- [ ] Consumed automatically to cover a break; the user can see it
      happened.
- [ ] Can't go negative, can't be spent retroactively beyond the
      backdating window.

**Edge cases — handle each explicitly, don't leave them implicit**
- [ ] Day rollover: when does "today" end? Local time, one configurable
      boundary value.
- [ ] Timezone change while travelling: logs must not shift days or
      duplicate.
- [ ] Habit created mid-week — how does its first x-per-week window work?
- [ ] Habit archived then reactivated: does the old streak resume or
      start fresh? Propose an answer.
- [ ] Cadence changed on a habit with history: how are past streaks
      treated?
- [ ] Multiple logs submitted rapidly for the same habit and day.
- [ ] A backdated log that retroactively repairs a broken streak.

**Tests — the part that matters most**
- [ ] Pure functions for all streak and cadence logic. Current date
      passed in, never read from the clock inside.
- [ ] Tests covering every edge case above, plus: a normal unbroken run,
      a break with no token available, a break covered by a token, a
      week boundary crossing, a longest-streak update.
- [ ] Tests passing before any UI work.

**UI**
- [ ] Minimal only: log complete / partial / skipped, backdate within
      the window, see current streak. Plain, no polish.

### [ ] Phase 3 — XP and levels
- [ ] XP per log based on difficulty, completion type, streak multiplier
      (capped), and daily-focus bonus.
- [ ] Level curve: fast early, progressively slower.
- [ ] Propose the formula and curve with a worked example showing what a
      realistic week produces — get approval before implementing.
- [ ] Daily focus: surfaces the longest-avoided habit with bonus XP.

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

### [ ] Step 2 — gold gem icon library
- [ ] 12–16 gem/crystal shapes as original inline SVG components.
      Generate from scratch — do not copy or trace any stock asset.
- [ ] Style: flat geometric facets, gold base fill with a lighter facet
      highlight and darker facet shadow, one small white sparkle. No
      photorealism, no gradients beyond two flat facet tones.
- [ ] Each icon takes a colour prop — gold by default, tintable.
- [ ] Every icon must read at both sizes it's used at (small on cards,
      larger in the picker). Render both sizes side by side, show me,
      and simplify any that loses its silhouette when small.
- [ ] Icon picker in the habit create/edit form. Semantic radio group,
      arrow-key navigable, accessible names, selected state visible
      without relying on colour alone.
- [ ] All icons visible at once at phone width, no scrolling. Cut the
      count rather than adding a scroll area.
- [ ] Icons on habit cards at consistent size, with a subtle drop glow
      only when that habit is completed today.
- [ ] Sensible default so a habit created without picking one still
      looks right.
- [ ] Apply `tabular-nums` to all stat display tokens as part of this
      step.
- [ ] Confirm the heatmap grid reads structurally at zero intensity —
      grid defined by gaps between cells, not by cell fill, so a sparse
      week looks sparse rather than broken. Report how it's built.

### [ ] Step 3 — the streak flame
The centerpiece of the home page.

- [ ] Inline SVG, simple bold flat art style: clean silhouette, soft
      inner core, smooth curves, subtle dark outline so it reads on dark
      backgrounds. No realistic fire texture.
- [ ] Colour tier by streak length:

      | Streak | Colour |
      |---|---|
      | 0 days | gray, unlit, low opacity |
      | 1–6 | orange → red |
      | 7–13 | deep red → pink |
      | 14–29 | magenta / hot pink |
      | 30–59 | violet → blue |
      | 60+ | teal / cyan (the rare one) |

- [ ] Matching glow per tier; glow intensity scales with tier. Higher
      tiers must feel worth chasing.
- [ ] Gentle flicker: scale-and-opacity loop under 2s, transform and
      opacity only, behind a `prefers-reduced-motion` guard.
- [ ] Brief celebratory pulse when a tier is reached.

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
- [ ] Delete the legacy palette from `index.css`.
- [ ] Flag any component still pointing at legacy tokens.
- [ ] Audit every screen against the tokens file; report anything that
      drifted.
- [ ] Full contrast re-check across all screens.

---

## Later — not now

An AI layer that reviews logs and adjusts habit difficulty and suggests
focus. Requires a server function to hold the API key — it can never sit
in frontend code. Keep XP and scheduling logic pure and swappable so this
drops in without a rewrite.
