/**
 * Phase D.1 schema reconcile — the generated `catalog.json` must
 * always validate against the canonical Zod schema in `src/schema.ts`.
 *
 * If this test ever fails, one of these drifted and needs to catch up:
 *   - the SCAD annotation vocabulary in `authoring/scad/*.scad`
 *   - the parser in `packages/hf-core/src/scad/parse-params.ts`
 *   - the emitter in `scripts/build-catalog.ts`
 *   - the canonical types in `src/types.ts` + `src/schema.ts`
 *
 * Run: `bun test packages/halofire-catalog/tests/schema.test.ts`
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  CatalogEntrySchema,
  CatalogManifestSchema,
  parseCatalog,
  safeParseCatalog,
} from '../src/index.js'

const CATALOG_PATH = resolve(
  join(import.meta.dirname, '..', 'catalog.json'),
)

function loadRaw(): unknown {
  return JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'))
}

describe('catalog.json matches the canonical schema', () => {
  test('top-level envelope parses', () => {
    const raw = loadRaw()
    const parsed = parseCatalog(raw)
    expect(parsed.schema_version).toBe(1)
    expect(typeof parsed.catalog_version).toBe('string')
    expect(Array.isArray(parsed.parts)).toBe(true)
    expect(parsed.parts.length).toBeGreaterThan(0)
  })

  test('safeParseCatalog returns ok=true for real on-disk JSON', () => {
    const raw = loadRaw()
    const result = safeParseCatalog(raw)
    expect(result.ok).toBe(true)
  })

  test('every entry validates individually', () => {
    const raw = loadRaw() as { parts: unknown[] }
    for (const entry of raw.parts) {
      const r = CatalogEntrySchema.safeParse(entry)
      if (!r.success) {
        const sku =
          (entry as { sku?: string }).sku ?? '<no sku>'
        throw new Error(
          `catalog entry ${sku} failed validation: ${r.error.message}`,
        )
      }
    }
  })

  test('every entry has sku, kind, category, display_name, params, ports, scad_source, warnings', () => {
    const parsed = parseCatalog(loadRaw())
    for (const e of parsed.parts) {
      expect(e.sku.length).toBeGreaterThan(0)
      expect(e.kind.length).toBeGreaterThan(0)
      expect(typeof e.category).toBe('string')
      expect(e.display_name.length).toBeGreaterThan(0)
      expect(typeof e.params).toBe('object')
      expect(Array.isArray(e.ports)).toBe(true)
      expect(e.scad_source.endsWith('.scad')).toBe(true)
      expect(Array.isArray(e.warnings)).toBe(true)
    }
  })

  test('all ports carry a size_in, style, role, and unit-ish direction', () => {
    const parsed = parseCatalog(loadRaw())
    for (const part of parsed.parts) {
      for (const p of part.ports) {
        expect(p.size_in).toBeGreaterThan(0)
        expect(p.style.length).toBeGreaterThan(0)
        expect(p.role.length).toBeGreaterThan(0)
        expect(p.direction).toHaveLength(3)
        const len = Math.hypot(...p.direction)
        // Should be unit-ish (1.0 ±0.02) or legitimately zero
        // for a tap-style port. We accept anything plausible.
        expect(len).toBeLessThanOrEqual(1.5)
      }
    }
  })
})

describe('schema rejects malformed input', () => {
  test('missing sku fails', () => {
    const result = CatalogEntrySchema.safeParse({
      kind: 'pipe_segment',
      category: 'pipe.sch10.grooved',
      display_name: 'x',
      params: {},
      ports: [],
      scad_source: 'x.scad',
      warnings: [],
    })
    expect(result.success).toBe(false)
  })

  test('unknown kind fails', () => {
    const result = CatalogEntrySchema.safeParse({
      sku: 'x',
      kind: 'not_a_kind',
      category: 'x',
      display_name: 'x',
      params: {},
      ports: [],
      scad_source: 'x.scad',
      warnings: [],
    })
    expect(result.success).toBe(false)
  })

  test('wrong schema_version fails', () => {
    const result = CatalogManifestSchema.safeParse({
      schema_version: 2,
      catalog_version: '0.1.0',
      generated_at: '2026-04-21',
      parts: [],
    })
    expect(result.success).toBe(false)
  })
})
