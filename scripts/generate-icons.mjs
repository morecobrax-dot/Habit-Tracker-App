/**
 * Renders the PWA icon set from one SVG source.
 *
 * Run with `npm run icons`. Committed output lives in `public/icons/` so a
 * normal build needs no image toolchain.
 *
 * The maskable variant carries much larger padding: Android crops maskable
 * icons to a device-chosen shape, and anything inside the outer ~10% can be
 * cut off.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BG = '#0b1020'
const RING = '#2b3559'
const BRAND = '#6d7cff'
const BRAND_LIGHT = '#8b97ff'

/**
 * A checkmark drawn as an ascending arc — progress, and a completed thing.
 * `inset` is the fraction of the canvas left as margin around the glyph.
 */
function iconSvg({ size, inset, rounded }) {
  const s = size
  const pad = s * inset
  const inner = s - pad * 2
  // Glyph geometry in a 100x100 space, then mapped into the padded box.
  const p = (x, y) => `${pad + (x / 100) * inner},${pad + (y / 100) * inner}`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BRAND_LIGHT}"/>
      <stop offset="100%" stop-color="${BRAND}"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" ${rounded ? `rx="${s * 0.22}"` : ''} fill="${BG}"/>
  <circle cx="${s / 2}" cy="${s / 2}" r="${inner * 0.46}" fill="none" stroke="${RING}" stroke-width="${inner * 0.055}"/>
  <path d="M ${p(28, 52)} L ${p(44, 68)} L ${p(74, 32)}"
        fill="none" stroke="url(#g)" stroke-width="${inner * 0.115}"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
}

const targets = [
  { file: 'icon-192.png', size: 192, inset: 0.14, rounded: true },
  { file: 'icon-512.png', size: 512, inset: 0.14, rounded: true },
  // Maskable: heavy padding so the safe zone survives aggressive cropping.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.26, rounded: false },
  // iOS does not apply a mask and shows the icon square, so it gets its own.
  { file: 'apple-touch-icon.png', size: 180, inset: 0.16, rounded: false },
]

await mkdir(outDir, { recursive: true })

for (const target of targets) {
  const svg = iconSvg(target)
  await sharp(Buffer.from(svg)).png().toFile(join(outDir, target.file))
  console.log(`wrote ${target.file} (${target.size}px)`)
}

await writeFile(join(outDir, 'favicon.svg'), iconSvg({ size: 64, inset: 0.1, rounded: true }))
console.log('wrote favicon.svg')
