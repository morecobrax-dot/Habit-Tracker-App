import { chromium, devices } from 'playwright'

const BASE = 'http://127.0.0.1:5203'

/** WCAG 2.1 relative luminance + contrast, computed in the page. */
const PAGE_HELPERS = `
function srgb(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
function lum(rgb){return 0.2126*srgb(rgb[0])+0.7152*srgb(rgb[1])+0.0722*srgb(rgb[2])}
function parse(s){const m=s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;
  const p=m[1].split(',').map(x=>parseFloat(x.trim()));return {rgb:[p[0],p[1],p[2]],a:p.length>3?p[3]:1}}
function over(fg,bg){ // composite fg (with alpha) over opaque bg
  return [0,1,2].map(i=>fg.rgb[i]*fg.a+bg[i]*(1-fg.a))}
function effectiveBg(el){
  let node=el, acc=null;
  while(node && node!==document.documentElement){
    const c=parse(getComputedStyle(node).backgroundColor);
    if(c && c.a>0){ acc = acc===null ? (c.a>=1?c.rgb:null) : acc; if(c.a>=1) return c.rgb; }
    node=node.parentElement;
  }
  const root=parse(getComputedStyle(document.documentElement).backgroundColor);
  return root && root.a>0 ? root.rgb : [10,5,9];
}
function ratio(a,b){const L1=lum(a),L2=lum(b);const hi=Math.max(L1,L2),lo=Math.min(L1,L2);
  return (hi+0.05)/(lo+0.05)}
`

const auditPage = `
(() => {
  ${PAGE_HELPERS}
  const results = [];
  const radii = {};
  const els = document.querySelectorAll('*');
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // --- radius census on box-like elements ---
    const r = cs.borderTopLeftRadius;
    if (r && r !== '0px' && rect.width > 40 && rect.height > 24 && !r.includes('9999')) {
      radii[r] = (radii[r] || 0) + 1;
    }

    // --- contrast on elements holding their own visible text ---
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (own.length === 0) continue;
    const text = own.map(n => n.textContent.trim()).join(' ').slice(0, 42);

    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    const fgOn = fg.a < 1 ? over(fg, bg) : fg.rgb;
    const cr = ratio(fgOn, bg);

    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const floor = large ? 3.0 : 4.5;

    if (cr < floor) {
      results.push({
        text, ratio: Math.round(cr * 100) / 100, floor,
        color: cs.color, bg: 'rgb(' + bg.map(Math.round).join(',') + ')',
        size: Math.round(size), weight, large,
      });
    }
  }
  return { failures: results, radii };
})()
`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ ...devices['iPhone 13'], timezoneId: 'Europe/London' })
const page = await ctx.newPage()

// Seed data so screens are populated rather than empty.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Start with one', { timeout: 15000 })
const mk = async (n, m, tier) => {
  await page.click('nav >> text=Habits')
  await page.click('text=New habit')
  await page.fill('input[placeholder="Morning walk"]', n)
  await page.fill('input[placeholder*="shoes on"]', m)
  if (tier) await page.click(`button[role="radio"]:has-text("${tier}")`)
  await page.click('button:has-text("Create habit")')
  await page.waitForSelector(`text=${n}`)
}
await mk('Call the dentist', 'Find the number', 'Trivial')
await mk('Deep work block', 'Read one paragraph', 'Heavy')
await page.click('nav >> text=Today')
await page.waitForSelector("text=Today's focus")
// Complete one so completed states are audited too.
await page.click('li button[aria-label^="Mark"]').catch(() => {})
await page.waitForTimeout(400)

const SCREENS = [
  ['Today', '#/today'],
  ['Habits', '#/habits'],
  ['Habit editor', '#/habits/new'],
  ['Settings', '#/settings'],
  ['Styleguide', '#/styleguide'],
]

const allRadii = {}
let totalFailures = 0

for (const [name, hash] of SCREENS) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const { failures, radii } = await page.evaluate(auditPage)

  for (const [r, n] of Object.entries(radii)) allRadii[r] = (allRadii[r] || 0) + n

  console.log(`\n── ${name} ──`)
  if (failures.length === 0) {
    console.log('  contrast: all text passes')
  } else {
    totalFailures += failures.length
    // Deduplicate by colour pair + size, so a repeated row reports once.
    const seen = new Map()
    for (const f of failures) {
      const k = `${f.color}|${f.bg}|${f.size}`
      if (!seen.has(k)) seen.set(k, { ...f, count: 1 })
      else seen.get(k).count++
    }
    for (const f of seen.values()) {
      console.log(
        `  FAIL ${String(f.ratio).padStart(5)}:1 (needs ${f.floor})  ${f.size}px/${f.weight}  x${f.count}  "${f.text}"`,
      )
      console.log(`         ${f.color} on ${f.bg}`)
    }
  }
}

console.log('\n── radius census (all screens) ──')
for (const [r, n] of Object.entries(allRadii).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${r.padStart(8)}  ${n} elements`)
}
console.log(`\ntotal contrast failures: ${totalFailures}`)

await browser.close()
