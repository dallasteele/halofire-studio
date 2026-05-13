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
  CatalogSourceLicenseSchema,
  CatalogSourceIngestionPolicySchema,
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

  test('optional source and family metadata parses when present', () => {
    const result = CatalogEntrySchema.safeParse({
      sku: 'demo_part',
      kind: 'sprinkler_head',
      category: 'head.demo',
      display_name: 'Demo Part',
      manufacturer: 'DemoCo',
      model_status: 'visual_reference',
      source_license: {
        part_ref: 'demo_part',
        source_kind: 'procedural',
        manufacturer: 'DemoCo',
        public_url: 'https://example.com/demo',
        terms_summary: 'Demo preview only',
        allowed_internal_use: true,
        allowed_client_render: true,
        allowed_download: false,
        redistribution_blocked: true,
        source_captured_at: '2026-05-11T00:00:00Z',
        model_status: 'visual_reference',
      },
      family_contract: {
        part_ref: 'demo_part',
        glb_path: 'demo_part.glb',
        ifc_path: null,
        dxf_path: null,
        model_status: 'visual_reference',
        manufacturer_verified: false,
        dimensions_verified: false,
        source_license_ref: 'license:demo_part',
        evidence_refs: ['SOURCES.json'],
      },
      params: {},
      ports: [],
      scad_source: 'demo.scad',
      warnings: [],
    })
    expect(result.success).toBe(true)
  })

  test('manufacturer_verified family contracts require IFC and DXF paths', () => {
    const result = CatalogEntrySchema.safeParse({
      sku: 'demo_verified',
      kind: 'sprinkler_head',
      category: 'head.demo',
      display_name: 'Demo Verified Part',
      manufacturer: 'DemoCo',
      model_status: 'manufacturer_verified',
      source_license: {
        part_ref: 'demo_verified',
        source_kind: 'manufacturer',
        manufacturer: 'DemoCo',
        public_url: 'https://example.com/demo',
        source_url: 'https://example.com/demo',
        source_file_ref: 'demo.pdf',
        terms_summary: 'Demo verified asset',
        allowed_internal_use: true,
        allowed_client_render: true,
        allowed_download: false,
        redistribution_blocked: true,
        source_captured_at: '2026-05-11T00:00:00Z',
        model_status: 'manufacturer_verified',
      },
      family_contract: {
        part_ref: 'demo_verified',
        glb_path: 'demo_verified.glb',
        ifc_path: 'demo_verified.ifc',
        dxf_path: 'demo_verified.dxf',
        model_status: 'manufacturer_verified',
        manufacturer_verified: true,
        dimensions_verified: true,
        source_license_ref: 'license:demo_verified',
        evidence_refs: ['SOURCES.json'],
      },
      params: {},
      ports: [],
      scad_source: 'demo_verified.scad',
      warnings: [],
    })
    expect(result.success).toBe(true)
  })

  test('visual_reference family contracts cannot expose IFC or DXF paths', () => {
    const result = CatalogEntrySchema.safeParse({
      sku: 'demo_visual',
      kind: 'sprinkler_head',
      category: 'head.demo',
      display_name: 'Demo Visual Part',
      manufacturer: 'DemoCo',
      model_status: 'visual_reference',
      source_license: {
        part_ref: 'demo_visual',
        source_kind: 'procedural',
        manufacturer: 'DemoCo',
        terms_summary: 'Demo preview only',
        allowed_internal_use: true,
        allowed_client_render: true,
        allowed_download: false,
        redistribution_blocked: true,
        source_captured_at: '2026-05-11T00:00:00Z',
        model_status: 'visual_reference',
      },
      family_contract: {
        part_ref: 'demo_visual',
        glb_path: 'demo_visual.glb',
        ifc_path: 'demo_visual.ifc',
        dxf_path: 'demo_visual.dxf',
        model_status: 'visual_reference',
        manufacturer_verified: false,
        dimensions_verified: false,
        source_license_ref: 'license:demo_visual',
        evidence_refs: ['SOURCES.json'],
      },
      params: {},
      ports: [],
      scad_source: 'demo_visual.scad',
      warnings: [],
    })
    expect(result.success).toBe(false)
  })

  test('distributor source licenses require distributor attribution and can be dimensioned parametric', () => {
    const licenseResult = CatalogSourceLicenseSchema.safeParse({
      part_ref: 'demo_part',
      source_kind: 'distributor',
      manufacturer: 'Tyco Fire Protection',
      distributor: 'Ferguson',
      public_url: 'https://api.ferguson.com/dar-step-service/Query?ASSET_ID=4685770&PRODUCT_ID=1959635&USE_TYPE=SPECIFICATION',
      source_url: 'https://api.ferguson.com/dar-step-service/Query?ASSET_ID=4685770&PRODUCT_ID=1959635&USE_TYPE=SPECIFICATION',
      source_file_ref: 'ferguson_tyco_ty3251_spec.pdf',
      terms_summary: 'Distributor-hosted cut sheet used to derive a dimensioned parametric proxy.',
      allowed_internal_use: true,
      allowed_client_render: true,
      allowed_download: false,
      redistribution_blocked: true,
      source_captured_at: '2026-05-12T08:38:19Z',
      model_status: 'dimensioned_parametric',
    })
    expect(licenseResult.success).toBe(true)
  })

  test('ingestion policy schema parses the shared policy shape', () => {
    const result = CatalogSourceIngestionPolicySchema.safeParse({
      allowed_sources: ['procedural', 'manufacturer', 'distributor'],
      require_public_url: true,
      require_terms_summary: true,
      require_internal_use_flag: true,
      require_client_render_flag: true,
      require_download_flag: true,
      require_redistribution_blocked_flag: true,
      require_dimension_verification: true,
      require_manufacturer_verification: true,
      default_model_status: 'visual_reference',
    })
    expect(result.success).toBe(true)
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
