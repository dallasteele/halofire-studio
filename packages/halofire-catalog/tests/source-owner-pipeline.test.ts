/**
 * Stream F source-owner pipeline regression.
 *
 * This test keeps the combined research + coverage pipeline honest:
 * the checked-in source seed should rebuild both ledgers, preserve the
 * step.parts candidate, and keep the coverage summary aligned with the
 * emitted rows.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildCatalogSourcePipeline,
  CatalogSourcePipelineInputSchema,
} from '../src/index.js'

const COMPONENT_DIR = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'data',
  'halofire',
  'brand',
  'components',
)

const SOURCES_PATH = resolve(COMPONENT_DIR, 'SOURCES.json')
const SOURCE_RESEARCH_SEED_PATH = resolve(
  COMPONENT_DIR,
  'source_research_seed.json',
)
const COMPONENT_MAP_PATH = resolve(COMPONENT_DIR, 'component_map.json')
const FAMILY_CONTRACTS_PATH = resolve(COMPONENT_DIR, 'family_contracts.json')
const SOURCE_COVERAGE_LEDGER_PATH = resolve(
  COMPONENT_DIR,
  'source_coverage_ledger.json',
)
const SOURCE_RESEARCH_LEDGER_PATH = resolve(
  COMPONENT_DIR,
  'source_research_ledger.json',
)
const MODEL_FIT_PROOF_RUN_PATH = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'out',
  'halo-forge',
  '2026-05-17-catalog-model-fit-proof',
  'catalog_model_fit_proof',
  'output.json',
)

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

describe('source owner pipeline', () => {
  test('rebuilds the checked-in research and coverage ledgers from typed inputs', () => {
    const input = CatalogSourcePipelineInputSchema.parse({
      generated_at_utc: loadJson<{ generated_at_utc: string }>(
        SOURCE_COVERAGE_LEDGER_PATH,
      ).generated_at_utc,
      components: loadJson<{ components: unknown[] }>(SOURCES_PATH).components,
      source_research_seed: loadJson(SOURCE_RESEARCH_SEED_PATH),
      component_library_seed: {
        source_manifest: loadJson(SOURCES_PATH),
        component_map: loadJson(COMPONENT_MAP_PATH),
        family_contracts: loadJson(FAMILY_CONTRACTS_PATH),
      },
      model_fit_proof_run: loadJson(MODEL_FIT_PROOF_RUN_PATH),
    })

    const pipeline = buildCatalogSourcePipeline(input)
    const checkedInResearch = loadJson(SOURCE_RESEARCH_LEDGER_PATH)
    const checkedInCoverage = loadJson(SOURCE_COVERAGE_LEDGER_PATH)

    expect(pipeline.source_research_ledger.summary).toEqual(
      checkedInResearch.summary,
    )
    expect(pipeline.source_coverage_ledger.summary).toEqual(
      checkedInCoverage.summary,
    )
    expect(pipeline.summary.source_collection_count).toBe(12)
    expect(pipeline.summary.research_record_count).toBe(
      checkedInResearch.research_records.length,
    )
    expect(pipeline.summary.source_manifest_component_count).toBe(92)
    expect(pipeline.summary.component_map_entry_count).toBe(92)
    expect(pipeline.summary.family_contract_count).toBe(92)
    expect(pipeline.summary.family_contract_ifc_count).toBe(42)
    expect(pipeline.summary.family_contract_dxf_count).toBe(42)
    expect(pipeline.summary.family_contract_manufacturer_verified_count).toBe(41)
    expect(pipeline.summary.family_contract_dimensions_verified_count).toBe(42)
    expect(pipeline.component_library).not.toBeNull()
    expect(pipeline.component_library?.summary.source_manifest_component_count).toBe(92)
    expect(pipeline.summary.coverage_row_count).toBe(93)
    expect(
      pipeline.source_research_ledger.research_records.find(
        (record) => record.source_id === 'step.parts',
      )?.third_party_notice_ref,
    ).toBe('THIRD_PARTY_NOTICES.md')
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'step.parts',
      )?.source_file_ref,
    ).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(
      pipeline.source_research_ledger.research_records.find(
        (record) => record.part_ref === 'reliable_f156_upright_155f',
      )?.model_status,
    ).toBe('manufacturer_verified')
    expect(
      pipeline.source_research_ledger.research_records.find(
        (record) => record.part_ref === 'tyco_ty3251_pendent_135f',
      )?.model_status,
    ).toBe('manufacturer_verified')
    expect(
      pipeline.source_research_ledger.research_records.find(
        (record) => record.part_ref === 'viking_vk100_upright_155f',
      )?.model_status,
    ).toBe('manufacturer_verified')
    expect(
      pipeline.source_research_ledger.research_records.find(
        (record) => record.source_id === 'step.parts',
      )?.model_status,
    ).toBe('proxy')
    expect(
      pipeline.source_research_ledger.research_records.find(
        (record) => record.source_id === 'viking_vk3021_qr_pendent',
      )?.model_status,
    ).toBe('proxy')
    expect(
      pipeline.source_coverage_ledger.vendor_model_coverage.find(
        (row) => row.part_ref === 'step.parts:hebi_r25_actuator',
      )?.coverage_status,
    ).toBe('salvage_proxy')
    expect(
      pipeline.source_coverage_ledger.vendor_model_coverage.find(
        (row) => row.part_ref === 'pendent_standard',
      )?.coverage_status,
    ).toBe('promoted')
    expect(
      pipeline.source_coverage_ledger.vendor_model_coverage.find(
        (row) => row.part_ref === 'viking_vk100_upright_155f',
      )?.coverage_status,
    ).toBe('promoted')
    expect(
      pipeline.source_coverage_ledger.vendor_model_coverage.find(
        (row) => row.part_ref === 'viking_vk300_qr_pendent_155f',
      )?.coverage_status,
    ).toBe('salvage_proxy')
    expect(pipeline.summary.proxy_count).toBe(6)
    expect(pipeline.summary.sealed_approved_count).toBe(0)
    expect(pipeline.model_fit_inventory?.proof_count).toBe(3)
    expect(pipeline.model_fit_inventory?.review_ready_proof_count).toBe(3)
    expect(pipeline.model_fit_inventory?.cleared_proof_count).toBe(0)
    expect(pipeline.summary.model_fit_proof_count).toBe(3)
    expect(pipeline.summary.review_ready_proof_count).toBe(3)
    expect(pipeline.summary.blocked_proof_count).toBe(0)
    expect(pipeline.summary.cleared_proof_count).toBe(0)
    expect(pipeline.summary.catalog_engineering_ready).toBe(false)
    expect(pipeline.summary.engineering_grade_ready).toBe(false)
  })
})
