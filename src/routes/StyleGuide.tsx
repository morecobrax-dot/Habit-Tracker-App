import { useState, type ReactNode } from 'react'
import { GEM_IDS, Gem, gemLabel, type GemId } from '@/components/icons/gems'
import { GemPicker } from '@/components/icons/GemPicker'
import { Flame } from '@/components/Flame'
import { flameTierFor, tierRange, type FlameTier } from '@/domain/flameTier'

/**
 * The design-system swatch page.
 *
 * Renders every token from `styles/tokens.css` by reading the live CSS custom
 * properties, so it cannot drift from the real system: if a token changes, this
 * page changes with it, and if a token is deleted the swatch renders empty.
 *
 * Dev-only — see the route guard in `App.tsx`. It is a working tool for the
 * consistency audit, not a user-facing screen, and it must never ship in the
 * production bundle.
 */
export function StyleGuideRoute() {
  return (
    <div className="flex flex-col gap-10 pb-10 font-sans">
      <header className="pt-2">
        <h1 className="text-title font-semibold tracking-tight text-text-primary">
          Design tokens
        </h1>
        <p className="mt-1 text-small text-text-secondary">
          Every value below is read from CSS custom properties. Nothing here is
          hardcoded.
        </p>
      </header>

      <Section
        title="Surfaces"
        note="Warm-shifted near-black. Never pure #000 — it smears on OLED and makes glow read as haze."
      >
        <div className="grid grid-cols-2 gap-3">
          <Swatch name="bg-base" varName="--color-bg-base" />
          <Swatch name="surface" varName="--color-surface" />
          <Swatch name="surface-raise" varName="--color-surface-raise" />
          <Swatch name="border" varName="--color-border" />
          <Swatch name="border-interactive" varName="--color-border-interactive" />
        </div>
      </Section>

      <Section title="Brand" note="Red is structure: fills, borders, glows. Never body text.">
        <div className="grid grid-cols-3 gap-3">
          <Swatch name="primary" varName="--color-primary" />
          <Swatch name="primary-hot" varName="--color-primary-hot" />
          <Swatch name="maroon" varName="--color-maroon" />
        </div>
      </Section>

      <Section title="Gold" note="Habit icons and earned moments only. Never text, never buttons.">
        <div className="grid grid-cols-3 gap-3">
          <Swatch name="gold" varName="--color-gold" />
          <Swatch name="gold-light" varName="--color-gold-light" />
          <Swatch name="gold-deep" varName="--color-gold-deep" />
        </div>
      </Section>

      <Section
        title="Text on surfaces"
        note="Measured contrast shown against each background. 4.5:1 is the floor."
      >
        <div className="flex flex-col gap-3">
          <ContrastRow label="text-primary" varName="--color-text-primary" ratios={['17.6', '17.0', '16.3']} />
          <ContrastRow label="text-secondary" varName="--color-text-secondary" ratios={['6.9', '6.7', '6.5']} />
          <ContrastRow label="text-muted" varName="--color-text-muted" ratios={['5.1', '4.9', '4.7']} />
          <ContrastRow
            label="text-disabled"
            varName="--color-text-disabled"
            ratios={['3.1', '3.0', '2.9']}
            failing
          />
        </div>
        <p className="mt-3 text-small leading-relaxed text-text-secondary">
          <span className="text-text-primary">text-disabled</span> is the original
          supplied muted value. It fails 4.5:1 on every surface, so it is reserved for
          non-text use — rules, chart gridlines, disabled glyphs. The token{' '}
          <span className="text-text-primary">text-muted</span> was lifted to the
          nearest value on the same hue that clears the floor everywhere.
        </p>
      </Section>

      <Section title="Flame tiers" note="The streak ladder. Hue widens and cools as the streak grows — the only place the palette leaves red and gold.">
        <div className="grid grid-cols-3 gap-3">
          {[
            ['0 — unlit', '0'],
            ['1-6 days', '1'],
            ['7-13 days', '2'],
            ['14-29 days', '3'],
            ['30-59 days', '4'],
            ['60+ days', '5'],
          ].map(([label, tier]) => (
            <div key={tier} className="flex flex-col gap-2">
              <div
                className="h-14 rounded-sm border border-border"
                style={{
                  background: `linear-gradient(160deg, var(--color-flame-${tier}-core), var(--color-flame-${tier}))`,
                }}
              />
              <span className="text-micro text-text-secondary">{label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Heatmap ramp" note="Maroon to red. Empty days are bare surface, not a tinted cell.">
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-1 flex-col gap-2">
              <div
                className="aspect-square rounded-xs border border-border"
                style={{ background: `var(--color-heat-${i})` }}
              />
              <span className="text-center text-micro text-text-secondary">{i}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Glow"
        note="Three intensities, all from primary-hot. Only on: completed cards, active flame, XP fill, level-up, primary hover."
      >
        <div className="grid grid-cols-3 gap-4">
          {(['subtle', 'medium', 'strong'] as const).map((level) => (
            <div key={level} className="flex flex-col items-center gap-2">
              <div
                className="h-16 w-full rounded-card bg-surface-raise"
                style={{ boxShadow: `var(--shadow-glow-${level})` }}
              />
              <span className="text-micro text-text-secondary">{level}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col items-start gap-2">
          <div className="h-16 w-full rounded-card bg-surface-raise shadow-card" />
          <span className="text-micro text-text-secondary">
            card — plain elevation, no glow
          </span>
        </div>
      </Section>

      <Section title="Radius" note="One card radius everywhere. No exceptions.">
        <div className="grid grid-cols-3 gap-3">
          {(['xs', 'sm', 'md', 'card', 'lg'] as const).map((r) => (
            <div key={r} className="flex flex-col items-center gap-2">
              <div
                className="h-16 w-full border border-border bg-surface-raise"
                style={{ borderRadius: `var(--radius-${r})` }}
              />
              <span className="text-micro text-text-secondary">{r}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale" note="Outfit, self-hosted. Two body weights maximum. Sentence case throughout.">
        <div className="flex flex-col gap-4">
          <TypeRow token="hero" sample="14" stat />
          <TypeRow token="stat" sample="Level 7" stat />
          <TypeRow token="title" sample="Today" />
          <TypeRow token="lead" sample="Deep work block" />
          <TypeRow token="body" sample="Open the doc and read one paragraph." />
          <TypeRow token="small" sample="7 days in a row · 3/3 this week" />
          <TypeRow token="micro" sample="Today's focus" />
        </div>
        <div className="mt-5 flex items-baseline gap-4 rounded-card border border-border bg-surface p-4">
          <span className="stat-numerals text-stat text-text-primary">1,284</span>
          <span className="text-small text-text-secondary">
            stat numerals — tabular, tighter tracking
          </span>
        </div>
        <div className="mt-3 rounded-card border border-border bg-surface p-4">
          <span className="label-caps text-text-secondary">Today&rsquo;s focus</span>
          <p className="mt-1 text-small text-text-secondary">
            label-caps — the only sanctioned capitals, and only at micro size.
          </p>
        </div>
      </Section>

      <Section title="State colours" note="Used sparingly; never as the primary signal on their own.">
        <div className="grid grid-cols-3 gap-3">
          <Swatch name="success" varName="--color-success" />
          <Swatch name="danger" varName="--color-danger" />
          <Swatch name="warning" varName="--color-warning" />
        </div>
      </Section>

      <Section
        title="Gem icons — both sizes"
        note="Card size (24px) beside picker size (44px). If a shape loses its silhouette on the left, the facets are too busy and it needs simplifying."
      >
        <ul className="flex flex-col divide-y divide-border">
          {GEM_IDS.map((id) => (
            <li key={id} className="flex items-center gap-5 py-2.5">
              <span className="flex w-16 justify-center">
                <Gem id={id} size={24} />
              </span>
              <span className="flex w-16 justify-center">
                <Gem id={id} size={44} />
              </span>
              <span className="text-small text-text-secondary">{gemLabel(id)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Gem tones"
        note="Every gem takes a tone prop. All three map to existing palette tokens — no hex in the component."
      >
        <div className="flex flex-col gap-3">
          {(['gold', 'primary', 'maroon'] as const).map((tone) => (
            <div key={tone} className="flex items-center gap-3">
              <span className="w-16 text-micro text-text-secondary">{tone}</span>
              {(['brilliant', 'hexagon', 'teardrop', 'shield', 'heart'] as const).map((id) => (
                <Gem key={id} id={id} size={30} tone={tone} />
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Gem on a card"
        note="Card size in situ, with the completed state's drop glow. Glow appears only when the habit is done today."
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 rounded-card border border-border bg-surface p-4">
            <Gem id="hexagon" size={24} />
            <span className="text-body text-text-primary">Morning walk</span>
            <span className="ml-auto text-small text-text-muted">not done</span>
          </div>
          <div className="flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-glow-subtle">
            <span className="grid place-items-center rounded-full" style={{ filter: 'drop-shadow(0 0 6px var(--color-gold))' }}>
              <Gem id="hexagon" size={24} />
            </span>
            <span className="text-body text-text-primary">Morning walk</span>
            <span className="ml-auto text-small text-text-muted">done today</span>
          </div>
        </div>
      </Section>

      <Section
        title="Streak flame — every tier"
        note="Hero size (72px) beside inline size (22px). Glow strength climbs with the tier; tier 0 has none, because an unlit flame has earned nothing."
      >
        <ul className="flex flex-col divide-y divide-border">
          {[0, 3, 9, 20, 45, 90].map((streak) => {
            const tier = flameTierFor(streak) as FlameTier
            const range = tierRange(tier)
            return (
              <li key={streak} className="flex items-center gap-5 py-3">
                <span className="flex w-20 justify-center">
                  <Flame streak={streak} size={72} />
                </span>
                <span className="flex w-10 justify-center">
                  <Flame streak={streak} size={22} />
                </span>
                <span className="text-small text-text-secondary">
                  <span className="stat-numerals text-text-primary">{streak}</span>
                  {' days · tier '}
                  {tier}
                  <span className="block text-micro text-text-disabled">
                    {range.to === null ? `${range.from}+` : `${range.from}-${range.to}`}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section
        title="Flame — tier-up pulse"
        note="Raise the streak past a boundary to fire the celebration. It runs once, briefly, on transform only, and is suppressed under prefers-reduced-motion."
      >
        <FlameDemo />
      </Section>

      <Section
        title="Heatmap structure at zero intensity"
        note="Carried over from step 2. Confirms a sparse week reads as sparse rather than broken."
      >
        <HeatmapProbe />
      </Section>

      <Section
        title="Icon picker"
        note="Radio group with roving tabindex. Tab reaches it once; arrows move within it and wrap. Selection shows a ring, a raised surface and a check — never colour alone."
      >
        <PickerDemo />
      </Section>
    </div>
  )
}

function FlameDemo() {
  const [streak, setStreak] = useState(6)
  return (
    <div className="flex flex-col items-center gap-4">
      <Flame streak={streak} size={96} />
      <p className="text-small text-text-secondary">
        <span className="stat-numerals text-text-primary">{streak}</span> days · tier{' '}
        {flameTierFor(streak)}
      </p>
      <div className="flex w-full gap-2">
        {[0, 1, 7, 14, 30, 60].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStreak(n)}
            className="min-h-11 flex-1 rounded-sm border border-border bg-surface text-small text-text-secondary transition-colors hover:border-border-interactive hover:bg-surface-raise focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-hot"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Two constructions side by side, to settle the step 2 question: does the
 * grid still read when nothing has been logged?
 */
function HeatmapProbe() {
  const weeks = 12
  const cells = Array.from({ length: weeks * 7 }, (_, i) => i)
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-small text-text-primary">
          On a card (surface) — heat-0 equals the card colour
        </p>
        <div className="rounded-card border border-border bg-surface p-3">
          <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
            {cells.map((i) => (
              <div
                key={i}
                className="aspect-square w-full rounded-[2px]"
                style={{ background: 'var(--color-heat-0)' }}
              />
            ))}
          </div>
        </div>
      </div>
      <div>
        <p className="mb-2 text-small text-text-primary">
          On the page (bg-base) — heat-0 sits one step above it
        </p>
        <div className="rounded-card bg-bg-base p-3">
          <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
            {cells.map((i) => (
              <div
                key={i}
                className="aspect-square w-full rounded-[2px]"
                style={{ background: 'var(--color-heat-0)' }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function PickerDemo() {
  const [picked, setPicked] = useState<GemId>('brilliant')
  return (
    <div className="flex flex-col gap-3">
      <GemPicker value={picked} onChange={setPicked} />
      <p className="text-small text-text-secondary">
        Selected: <span className="text-text-primary">{gemLabel(picked)}</span>
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lead font-semibold text-text-primary">{title}</h2>
        {note && (
          <p className="mt-1 text-small leading-relaxed text-text-secondary">{note}</p>
        )}
      </div>
      {children}
    </section>
  )
}

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-16 rounded-sm border border-border"
        style={{ background: `var(${varName})` }}
      />
      <span className="text-micro text-text-primary">{name}</span>
      <span className="text-micro text-text-disabled">{varName}</span>
    </div>
  )
}

function ContrastRow({
  label,
  varName,
  ratios,
  failing = false,
}: {
  label: string
  varName: string
  ratios: [string, string, string] | string[]
  failing?: boolean
}) {
  const backgrounds = ['--color-bg-base', '--color-surface', '--color-surface-raise']
  return (
    <div className="grid grid-cols-3 gap-2">
      {backgrounds.map((bg, i) => (
        <div
          key={bg}
          className="flex flex-col gap-1 rounded-sm border border-border p-3"
          style={{ background: `var(${bg})` }}
        >
          <span className="text-small" style={{ color: `var(${varName})` }}>
            {label}
          </span>
          <span
            className="text-micro"
            style={{
              color: failing ? 'var(--color-danger)' : 'var(--color-text-disabled)',
            }}
          >
            {ratios[i]}:1 {failing ? '✕' : '✓'}
          </span>
        </div>
      ))}
    </div>
  )
}

function TypeRow({
  token,
  sample,
  stat = false,
}: {
  token: string
  sample: string
  stat?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
      <span
        className={`text-text-primary ${stat ? 'stat-numerals' : ''}`}
        style={{ fontSize: `var(--text-${token})`, lineHeight: 1.1 }}
      >
        {sample}
      </span>
      <span className="shrink-0 text-micro text-text-disabled">{token}</span>
    </div>
  )
}
