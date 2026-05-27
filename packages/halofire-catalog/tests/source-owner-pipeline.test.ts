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
    expect(pipeline.summary.source_collection_count).toBe(16)
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
      pipeline.source_research_ledger.research_records.find(
        (record) => record.source_id === 'step.parts',
      )?.source_license_ref,
    ).toBe('license:step.parts:hebi_r25_actuator')
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'step.parts',
      )?.source_file_ref,
    ).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'step.parts',
      )?.asset_kinds,
    ).toEqual(['product_page', 'image', 'step', 'third_party_notice'])
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'step.parts',
      )?.image_url,
    ).toBe('https://www.step.parts/step-parts-social-preview.png')
    expect(
      pipeline.source_coverage_ledger.source_collections.find(
        (collection) => collection.source_id === 'reliable_dh56_bulletin_016',
      )?.image_url,
    ).toBe(
      'https://www.reliablesprinkler.com/wp-content/uploads/2020/03/DH56-dry-white-crop-1-e1583452746731.png',
    )
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'viking_vk100',
      )?.image_url,
    ).toBe(
      'https://www.vikinggroupinc.com/sites/default/files/styles/extra_large/public/2024-06/12986AB_VK100_K5_6_SR_UP_BR_155.png?itok=4w4zcTjK',
    )
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'viking_vk3021_qr_pendent',
      )?.image_url,
    ).toBe('https://www.vikinggroupinc.com/sites/default/files/2023-12/viking-share-image-default.png')
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
        (row) => row.part_ref === 'step.parts:hebi_r25_actuator',
      )?.asset_coverage.find((asset) => asset.kind === 'image')?.status,
    ).toBe('available')
    expect(
      pipeline.source_coverage_ledger.vendor_model_coverage.find(
        (row) => row.part_ref === 'sidewall_dry',
      )?.asset_coverage.find((asset) => asset.kind === 'image')?.status,
    ).toBe('available')
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
    expect(
      pipeline.source_coverage_ledger.source_collections.find(
        (collection) => collection.source_id === 'victaulic_firelock_fittings',
      )?.asset_kinds,
    ).toEqual(['product_page', 'image', 'cut_sheet', 'revit', 'dwg'])
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'wheatland_schedule40',
      )?.image_url,
    ).toBe('https://www.wheatland.com/wp-content/uploads/2018/02/header-schedule40.jpg')
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'victaulic_firelock_fittings',
      )?.image_url,
    ).toBe('https://www.victaulic.com/wp-content/uploads/2018/01/installation-ready-system-300x300-square.jpg')
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'tyco_av1_300',
      )?.image_url,
    ).toBe(
      'https://tyco.widen.net/content/fe6teog93x/jpeg/FIS_residentialproductdetail_product_AV-1-300_1.jpeg?color=ffffffff&position=c&quality=80&u=ncoxvb',
    )
    expect(
      pipeline.source_coverage_ledger.source_collections.find(
        (collection) => collection.source_id === 'victaulic_fl_qr_sw',
      )?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'revit', 'dwg'])
    expect(
      pipeline.source_coverage_ledger.source_collections.find(
        (collection) => collection.source_id === 'victaulic_fl_qr_sw',
      )?.image_url,
    ).toBe(
      'https://victaulic.widen.net/content/wmhd64rlht/jpeg/Series-FL-QR-SW-Group-1.jpg?crop=false&position=c&q=80&color=ffffffff&u=6weima&w=500&h=500',
    )
    expect(
      pipeline.source_research_ledger.source_collections.find(
        (collection) => collection.source_id === 'viking_vk100_revit2017',
      )?.source_file_ref,
    ).toContain('assets/revit/viking_vk100_revit2017.zip')
    expect(
      pipeline.source_coverage_ledger.source_collections.find(
        (collection) => collection.source_id === 'viking_vk100_revit2017',
      )?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'revit'])
    expect(
      pipeline.source_coverage_ledger.source_collections.find(
        (collection) => collection.source_id === 'victaulic_fl_qr_sw_revit41_02',
      )?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'revit'])
    expect(
      pipeline.source_coverage_ledger.source_collections.find(
        (collection) => collection.source_id === 'victaulic_fl_qr_sw_autocad3d_41_02',
      )?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'dwg'])
    expect(
      pipeline.source_coverage_ledger.source_collections.find(
        (collection) => collection.source_id === 'victaulic_fl_qr_sw_autocad2d_41_02',
      )?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'dwg'])
    expect(pipeline.summary.image_missing_count).toBe(73)
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
