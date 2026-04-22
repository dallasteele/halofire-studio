#!/usr/bin/env node
/**
 * Phase G screenshot harness — captures the editor at three viewport
 * sizes so visual confirmation can go in the design report.
 *
 * Usage:
 *   node apps/editor/scripts/phase-g-screenshots.mjs
 *
 * Outputs:
 *   apps/editor/docs/phase-g-shots/{1280x800,1440x900,1920x1080}.png
 */

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'docs', 'phase-g-shots')
mkdirSync(OUT_DIR, { recursive: true })

const URL = process.env.PHASE_G_URL ?? 'http://localhost:3002'
const SIZES = [
  { w: 1280, h: 800,  label: '1280x800' },
  { w: 1440, h: 900,  label: '1440x900' },
  { w: 1920, h: 1080, label: '1920x1080' },
]

const browser = await chromium.launch()
try {
  for (const s of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h },
      deviceScaleFactor: 1,
    })
    const page = await ctx.newPage()
    console.log(`[phase-g] ${s.label}  → ${URL}`)
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    // Let Pascal's editor mount + Fraunces/Plex/JetBrains hydrate.
    await page.waitForSelector('[data-testid="halofire-ribbon"]', { timeout: 15_000 })
    await page.waitForTimeout(1500)
    const out = resolve(OUT_DIR, `${s.label}.png`)
    await page.screenshot({ path: out, fullPage: false })
    console.log(`[phase-g] wrote ${out}`)

    // Pascal's sidebar tabs live in [role=tablist] or a horizontal
    // bar. We match on the surrounding classname "text-muted-foreground"
    // + exact text to target the sidebar chrome, not ribbon buttons.
    const clickSidebar = async (text) => {
      await page.evaluate((t) => {
        const btns = Array.from(document.querySelectorAll('button'))
        const hit = btns.find(
          (b) =>
            b.textContent?.trim() === t &&
            (b.className.includes('text-muted-foreground') ||
              b.className.includes('text-foreground')),
        )
        hit?.click()
      }, text)
      await page.waitForTimeout(800)
    }

    try {
      await clickSidebar('Auto-Design')
      const out2 = resolve(OUT_DIR, `${s.label}-auto.png`)
      await page.screenshot({ path: out2, fullPage: false })
      console.log(`[phase-g] wrote ${out2}`)
    } catch (e) {
      console.warn(`[phase-g] auto capture skipped: ${e.message}`)
    }

    try {
      await clickSidebar('Report')
      const out3 = resolve(OUT_DIR, `${s.label}-report.png`)
      await page.screenshot({ path: out3, fullPage: false })
      console.log(`[phase-g] wrote ${out3}`)
    } catch (e) {
      console.warn(`[phase-g] report capture skipped: ${e.message}`)
    }

    try {
      await clickSidebar('Catalog')
      const out4 = resolve(OUT_DIR, `${s.label}-catalog.png`)
      await page.screenshot({ path: out4, fullPage: false })
      console.log(`[phase-g] wrote ${out4}`)
    } catch (e) {
      console.warn(`[phase-g] catalog capture skipped: ${e.message}`)
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
