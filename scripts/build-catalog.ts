/**
 * Catalog build — walks packages/halofire-catalog/authoring/scad/*.scad,
 * calls the hf-core parser on each, emits
 * packages/halofire-catalog/catalog.json with the full Part[] array.
 *
 * Blueprint 03 §3 is the spec.
 *
 * Usage:
 *   bun run scripts/build-catalog.ts
 *
 * Exit codes:
 *   0 — success, catalog.json written
 *   1 — one or more .scad files produced fatal warnings (missing @part etc.)
 *   2 — IO error
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseScad } from '../packages/hf-core/dist/scad/parse-params.js'

const ROOT = resolve(import.meta.dirname, '..')
const SCAD_DIR = join(ROOT, 'packages', 'halofire-catalog', 'authoring', 'scad')
const OUT = join(ROOT, 'packages', 'halofire-catalog', 'catalog.json')

interface CatalogEntry {
  sku: string
  kind: string
  category: string
  display_name: string
  manufacturer?: string
  mfg_part_number?: string
  listing?: string
  hazard_classes?: string[]
  price_usd?: number
  install_minutes?: number
  crew?: string
  weight_kg?: number
  k_factor?: number
  orientation?: string
  response?: string
  temperature?: string
  params: Record<string, unknown>
  ports: unknown[]
  scad_source: string   // relative path
  warnings: string[]
}

function main(): number {
  const files = readdirSync(SCAD_DIR)
    .filter((f) => f.endsWith('.scad'))
    .sort()

  const entries: CatalogEntry[] = []
  const buildWarnings: string[] = []
  let hadFatal = false

  for (const f of files) {
    const full = join(SCAD_DIR, f)
    const parsed = parseScad(full)
    const { part, params, ports, warnings } = parsed

    if (!part.slug || part.kind === 'unknown') {
      buildWarnings.push(`${f}: unannotated (missing @part / @kind) — skipping`)
      continue
    }

    if (warnings.length > 0) {
      for (const w of warnings) buildWarnings.push(`${f}: ${w}`)
    }

    entries.push({
      sku: part.slug,
      kind: part.kind,
      category: part.category ?? '',
      display_name: part.displayName ?? part.slug,
      manufacturer: part.manufacturer,
      mfg_part_number: part.mfgPartNumber,
      listing: part.listing,
      hazard_classes: part.hazardClasses,
      price_usd: part.priceUsd,
      install_minutes: part.installMinutes,
      crew: part.crew,
      weight_kg: part.weightKg,
      k_factor: part.kFactor,
      orientation: part.orientation,
      response: part.response,
      temperature: part.temperature,
      params,
      ports: ports as unknown[],
      scad_source: f,
      warnings,
    })
  }

  const catalog = {
    schema_version: 1 as const,
    catalog_version: '0.1.0',
    generated_at: new Date().toISOString(),
    parts: entries,
  }

  try {
    writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n', 'utf-8')
  } catch (e) {
    console.error('write failed:', e)
    return 2
  }

  console.log(`catalog.json: ${entries.length} parts written to ${OUT}`)
  if (buildWarnings.length > 0) {
    console.warn(`\n${buildWarnings.length} warnings:`)
    for (const w of buildWarnings) console.warn('  -', w)
  }
  return hadFatal ? 1 : 0
}

process.exit(main())
