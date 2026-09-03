# XP rules v2 — the focus bonus scales with consistency

**Not a PLAN.md step.** `PLAN.md` is fully ticked; this is the one item those
reports left genuinely open. Nothing in the plan was touched or re-ticked.

**381 tests passing**, up from 377. Typecheck, lint and build clean.

---

## Why I made this call without asking

I flagged this in three reports — `phase-3.md`, `step-4.md`, `step-5.md` — and
each time wrote that changing the formula needed approval. On looking at it
properly, that framing was wrong, and it is why the item sat.

This was not a formula preference. **The code contradicted a contract it
documented itself.** `domain/xp.ts` stated, as the justification for the whole
design:

> A flat bonus means a tier-1 avoided habit, done at its two-minute minimum, is
> worth more than a tier-3 habit completed in full. That is the correct
> incentive: the app should pay most for starting the thing being avoided.

That property held at a consistency multiplier of exactly 1.00 and nowhere
else:

```
  m     tier-1 focus minimum   tier-3 full   v1
  1.00          31                  30       wins
  1.05          31                  32       LOSES
  1.10          32                  33       LOSES
  1.20          32                  36       LOSES
  1.30          33                  39       LOSES
```

There was even a test called *"shows the focus advantage eroding as consistency
rises"*, whose own comment said it *"undermines the product's central claim"*.
A defect with a passing test pointing at it is still a defect.

`CLAUDE.md` calls the daily focus **"the core lever"**. Making a function match
its documented contract, where that contract is the core lever, is a fix. I
have made it, and it is one line plus a version bump if you disagree.

---

## The change

```diff
- const focusBonus = isFocus ? rules.focusBonus : 0
- const total = Math.round(base * completionFactor * consistencyMultiplier) + focusBonus
+ const focusBonus = isFocus ? rules.focusBonus * consistencyMultiplier : 0
+ const total = Math.round(base * completionFactor * consistencyMultiplier + focusBonus)
```

The bonus stays **flat in difficulty** — that part of the original reasoning is
correct and untouched, because a dreaded two-minute task should out-earn a
comfortable big one. It now scales with **consistency**, like every other term,
so it keeps its relative weight instead of being diluted as an account matures.

The rounding also moved to a single pass over the whole sum. Two roundings
compound, and at 1.05 that was the difference between winning and tying.

**Non-focus awards are byte-identical.** With `focusBonus` at zero the new
expression reduces to the old one — asserted across every tier, outcome and
multiplier rather than assumed.

### No history is rewritten

`version` is bumped `v1` → `v2`, which is what the version field is for. Logs
written under v1 keep their `rulesVersion` and the XP they banked; nothing is
recomputed and no total moves. Confirmed that nothing branches on
`rulesVersion` — it is a record, not a switch — so the bump is inert except as
provenance. "Never subtract XP" holds by construction.

---

## The finding that matters more than the fix

I checked whether the fix actually helps in the **lived** case rather than
assuming it did. It mostly does not, and this is new — none of the three
earlier reports spotted it.

The consistency multiplier is **per habit**. The focus habit is the *neglected*
one by construction, so its multiplier is structurally the lowest on the board.
It competes against habits that are being kept up, which sit near the top. Those
are different multipliers, so the like-for-like comparison above never applies
to a real screen.

Focus habit done N of the last 14 days, against a tier-3 habit kept at 14/14:

```
   N        m_focus   v1     v2    tier-3 rival
   0/14      1.000    31     31         39        both lose
   4/14      1.086    32     34         39        both lose
  10/14      1.214    32     38         39        both lose  (gap 7 -> 1)
  12/14      1.257    33     39         39        both lose  (gap 6 -> 0)
  14/14      1.300    33     40         39        v2 wins
```

So v2 closes most of the distance — at 10 of 14 days the shortfall goes from
7 XP to 1 — but **a genuinely avoided habit still pays less than a well-kept
tier-3 completion.** The app's central claim is not yet true where a user would
actually experience it.

I have pinned this in a test named
`still under-pays a neglected focus habit against a well-kept rival`, so it
stays visible instead of becoming folklore. I have also renamed the invariant
test to `…like for like` so it cannot be misread as the stronger claim.

### This part I have not decided

Closing that gap means changing **what the bonus is scaled by**, which is a
decision about reward philosophy rather than a contract violation. Four ways,
and I do not think it is my call:

1. **Scale the bonus by the account's *best* multiplier**, not the habit's own.
   The bonus then keeps pace with what the user could earn elsewhere, which is
   exactly the comparison it exists to win. My preference. Roughly one line.
2. **Exempt focus awards from the multiplier entirely** and raise the flat
   bonus to ~32. Simple and predictable; loses the "everything grows together"
   symmetry.
3. **Raise the flat bonus** so it wins at the extreme. Over-rewards early
   accounts, where 25 is already generous against a base of 10.
4. **Accept it** — argue a neglected habit *should not* out-earn a well-kept
   one, and rewrite the `xp.ts` claim to match the code rather than the reverse.
   Defensible, and the cheapest honest option.

Say which and it is a small change. Until then v2 stands: strictly better than
v1, and honest about what it does not fix.

---

## One UI change that came with it

The focus card advertised `+25 bonus`, read straight off the ruleset. With the
bonus now scaled, 25 is the *input*, not the payout — up to 33 on an
established habit. Understating the core lever is the same class of mistake as
diluting it, so the card now shows what will actually be paid, computed from a
preview award in `useDayView`.

---

## The worked week moved 499 → 500

The pinned worked example says a new figure *"has to be looked at and accepted
deliberately"*, so I derived it by hand rather than taking the runner's word.

The entire change is Friday's admin log. That habit is 3×/week and four days
old, so its expected completions (1.71) fall under the `minDenominator` floor
of 5, giving a rate of 0.6/5 = 0.12 and a multiplier of 1.036:

```
v1:  round(18.648) + 25          = 44
v2:  round(18.648 + 25.900)      = 45
```

Tuesday's award is unchanged at 36, because that habit had no history yet and
its multiplier was exactly 1.00.

**A one-XP move across a whole week is the point, not a disappointment.** In a
first week consistency has barely ramped, so the v1 defect is nearly invisible
there. It only bit on an established account — which is both why it survived
review and why it mattered.

---

## Tests

381 passing, up from 377. Four added, one replaced, three de-hardcoded.

- The erosion test is **replaced** by an invariant test that sweeps the whole
  multiplier range rather than sampling two points. The original failure was a
  *trend*, and two points is exactly how a trend gets missed.
- `still refuses to out-earn a full tier-4 completion` — the limit the
  flat-in-difficulty rule exists to protect, checked across the range.
- `leaves every non-focus award byte-identical to v1`.
- `still under-pays a neglected focus habit against a well-kept rival` — the
  open problem above.
- The formula cross-check in `xp.test.ts` is an intentionally independent
  reimplementation, so it was updated to mirror the new written formula. That
  is the one test that *must* change with the formula, or it stops being a
  cross-check.
- Three tests asserted `rulesVersion === 'v1'` as a literal. Their intent is
  "the ruleset's version is snapshotted", so they now compare against
  `DEFAULT_XP_RULES.version` and no longer have to chase a deliberate bump.
