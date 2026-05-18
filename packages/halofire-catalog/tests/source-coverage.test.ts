/**
 * Stream F source coverage regression.
 *
 * The catalog owner pipeline must surface coverage gaps explicitly:
 * source collections, vendor/model rows, missing downloads, and rejected
 * candidates. The generated ledger is the contract.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CatalogCoverageLedgerSchema } from '../src/index.js'

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

const LEDGER_PATH = resolve(COMPONENT_DIR, 'source_coverage_ledger.json')
const THIRD_PARTY_NOTICES_PATH = resolve(COMPONENT_DIR, 'THIRD_PARTY_NOTICES.md')

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

describe('source coverage ledger', () => {
  test('generated ledger validates and carries the step.parts source candidate', () => {
    const ledger = CatalogCoverageLedgerSchema.parse(loadJson(LEDGER_PATH))

    expect(ledger.scope).toContain('Stream F')
    expect(ledger.source_collections).toHaveLength(12)
    expect(ledger.source_collections.map((collection) => collection.source_id)).toEqual([
      'step.parts',
      'wheatland_schedule40',
      'victaulic_firelock_fittings',
      'tyco_av1_300',
      'reliable_f156_bulletin_031',
      'tyco_ty3251_tyb',
      'viking_vk100',
      'viking_vk3021_qr_pendent',
      'viking_vk3021_qr_pendent_revit2017',
      'victaulic_fl_qr_sw',
      'tyco_lfii_hsw_tfp417',
      'reliable_dh56_bulletin_016',
    ])

    const [stepParts] = ledger.source_collections
    expect(stepParts.source_id).toBe('step.parts')
    expect(stepParts.source_kind).toBe('open_source_step_directory')
    expect(stepParts.public_url).toBe('https://www.step.parts')
    expect(stepParts.repo_url).toBe('https://github.com/earthtojake/step.parts')
    expect(stepParts.source_url).toBe('https://www.step.parts/parts/hebi_r25_actuator')
    expect(stepParts.source_file_ref).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(stepParts.license_spdx).toBe('MIT')
    expect(stepParts.third_party_notice_ref).toBe('THIRD_PARTY_NOTICES.md')
    expect(stepParts.redistribution_blocked).toBe(true)

    const viking = ledger.source_collections.find(
      (collection) => collection.source_id === 'viking_vk100',
    )
    expect(viking).toBeDefined()
    expect(viking?.public_url).toBe(
      'https://www.vikinggroupinc.com/products/fire-sprinklers/standard-coverage-sr/upright-conventional/vk100',
    )
    expect(viking?.source_file_ref).toContain('cut_sheets/viking_vk100.pdf')
    expect(viking?.source_url).toBe(
      'https://www.vikinggroupinc.com/databook/current_tds/052014.pdf',
    )
    expect(viking?.license_spdx).toBe('proprietary')

    const viking3021 = ledger.source_collections.find(
      (collection) => collection.source_id === 'viking_vk3021_qr_pendent',
    )
    expect(viking3021).toBeDefined()
    expect(viking3021?.public_url).toBe(
      'https://www.vikinggroupinc.com/products/fire-sprinklers/standard-coverage-qr/pendent/vk3021',
    )
    expect(viking3021?.source_url).toBe(
      'https://www.vikinggroupinc.com/sites/default/files/2025-07/110720.pdf',
    )
    expect(viking3021?.license_spdx).toBe('proprietary')

    expect(ledger.vendor_model_coverage.length).toBeGreaterThan(0)
    expect(ledger.summary.total_rows).toBe(ledger.vendor_model_coverage.length)
    expect(ledger.summary.missing_download_count).toBeGreaterThan(0)
    expect(ledger.summary.rejected_candidate_count).toBeGreaterThan(0)
    expect(ledger.summary.proxy_count).toBe(6)
    expect(ledger.summary.sealed_approved_count).toBe(0)
    expect(ledger.missing_downloads).toContain('pendent_standard:step')
    expect(ledger.missing_downloads).toContain('step.parts:hebi_r25_actuator:glb')
    expect(ledger.rejected_candidates).toContain('pendent_standard_ferguson')
    expect(ledger.rejected_candidates).not.toContain('tyco_ty3251_pendent_135f')

    const stepCandidate = ledger.vendor_model_coverage.find(
      (row) => row.part_ref === 'step.parts:hebi_r25_actuator',
    )
    expect(stepCandidate).toBeDefined()
    expect(stepCandidate?.coverage_status).toBe('salvage_proxy')
    expect(stepCandidate?.source_kind).toBe('open_source_step_directory')
    expect(stepCandidate?.model_status).toBe('proxy')
    expect(stepCandidate?.source_file_ref).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(stepCandidate?.asset_coverage.find((asset) => asset.kind === 'step')?.status).toBe('available')
    expect(stepCandidate?.asset_coverage.find((asset) => asset.kind === 'third_party_notice')?.status).toBe('available')
    expect(stepCandidate?.asset_coverage.find((asset) => asset.kind === 'ifc')?.status).toBe('missing')

    const tyco = ledger.vendor_model_coverage.find(
      (row) => row.part_ref === 'pendent_standard',
    )
    expect(tyco).toBeDefined()
    expect(tyco?.coverage_status).toBe('promoted')
    expect(tyco?.asset_coverage.map((asset) => asset.kind)).toEqual([
      'product_page',
      'image',
      'cut_sheet',
      'glb',
      'ifc',
      'dxf',
      'step',
      'revit',
      'dwg',
      'third_party_notice',
    ])
    expect(tyco?.asset_coverage.find((asset) => asset.kind === 'product_page')?.status).toBe('available')
    expect(tyco?.asset_coverage.find((asset) => asset.kind === 'step')?.status).toBe('missing')
    expect(tyco?.asset_coverage.find((asset) => asset.kind === 'third_party_notice')?.status).toBe('missing')

    const tyco3251 = ledger.vendor_model_coverage.find(
      (row) => row.part_ref === 'tyco_ty3251_pendent_135f',
    )
    expect(tyco3251).toBeDefined()
    expect(tyco3251?.coverage_status).toBe('promoted')
    expect(tyco3251?.model_status).toBe('manufacturer_verified')
    expect(tyco3251?.source_kind).toBe('manufacturer')
    expect(tyco3251?.asset_coverage.find((asset) => asset.kind === 'product_page')?.status).toBe('available')
    expect(tyco3251?.asset_coverage.find((asset) => asset.kind === 'cut_sheet')?.status).toBe('available')
    expect(tyco3251?.asset_coverage.find((asset) => asset.kind === 'ifc')?.status).toBe('available')
    expect(tyco3251?.asset_coverage.find((asset) => asset.kind === 'dxf')?.status).toBe('available')

    const sidewallHorizontal = ledger.vendor_model_coverage.find(
      (row) => row.part_ref === 'sidewall_horizontal',
    )
    expect(sidewallHorizontal).toBeDefined()
    expect(sidewallHorizontal?.coverage_status).toBe('salvage_proxy')
    expect(sidewallHorizontal?.model_status).toBe('proxy')
    expect(sidewallHorizontal?.source_kind).toBe('manufacturer')
    expect(sidewallHorizontal?.asset_coverage.find((asset) => asset.kind === 'product_page')?.status).toBe('available')
    expect(sidewallHorizontal?.asset_coverage.find((asset) => asset.kind === 'cut_sheet')?.status).toBe('available')
    expect(sidewallHorizontal?.asset_coverage.find((asset) => asset.kind === 'ifc')?.status).toBe('missing')

    const sidewallDry = ledger.vendor_model_coverage.find(
      (row) => row.part_ref === 'sidewall_dry',
    )
    expect(sidewallDry).toBeDefined()
    expect(sidewallDry?.coverage_status).toBe('salvage_proxy')
    expect(sidewallDry?.model_status).toBe('proxy')
    expect(sidewallDry?.source_kind).toBe('manufacturer')
    expect(sidewallDry?.asset_coverage.find((asset) => asset.kind === 'product_page')?.status).toBe('available')
    expect(sidewallDry?.asset_coverage.find((asset) => asset.kind === 'cut_sheet')?.status).toBe('available')
    expect(sidewallDry?.asset_coverage.find((asset) => asset.kind === 'ifc')?.status).toBe('missing')

    const vikingRow = ledger.vendor_model_coverage.find(
      (row) => row.part_ref === 'viking_vk100_upright_155f',
    )
    expect(vikingRow).toBeDefined()
    expect(vikingRow?.coverage_status).toBe('promoted')
    expect(vikingRow?.model_status).toBe('manufacturer_verified')
    expect(vikingRow?.asset_coverage.find((asset) => asset.kind === 'product_page')?.status).toBe('available')
    expect(vikingRow?.asset_coverage.find((asset) => asset.kind === 'cut_sheet')?.status).toBe('available')
    expect(vikingRow?.asset_coverage.find((asset) => asset.kind === 'ifc')?.status).toBe('available')
    expect(vikingRow?.asset_coverage.find((asset) => asset.kind === 'dxf')?.status).toBe('available')

    const vikingProxyRow = ledger.vendor_model_coverage.find(
      (row) => row.part_ref === 'viking_vk300_qr_pendent_155f',
    )
    expect(vikingProxyRow).toBeDefined()
    expect(vikingProxyRow?.coverage_status).toBe('salvage_proxy')
    expect(vikingProxyRow?.model_status).toBe('proxy')
    expect(vikingProxyRow?.source_kind).toBe('manufacturer')
    expect(vikingProxyRow?.asset_coverage.find((asset) => asset.kind === 'product_page')?.status).toBe('available')
    expect(vikingProxyRow?.asset_coverage.find((asset) => asset.kind === 'cut_sheet')?.status).toBe('available')
    expect(vikingProxyRow?.asset_coverage.find((asset) => asset.kind === 'revit')?.status).toBe('available')
    expect(vikingProxyRow?.asset_coverage.find((asset) => asset.kind === 'ifc')?.status).toBe('missing')
    expect(vikingProxyRow?.asset_coverage.find((asset) => asset.kind === 'dxf')?.status).toBe('missing')
    expect(vikingProxyRow?.asset_coverage.find((asset) => asset.kind === 'dwg')?.status).toBe('missing')
  })

  test('third-party notice file documents the open-source STEP provenance policy', () => {
    const notices = readFileSync(THIRD_PARTY_NOTICES_PATH, 'utf-8')
    expect(notices).toContain('step.parts source candidate')
    expect(notices).toContain('https://www.step.parts')
    expect(notices).toContain('https://github.com/earthtojake/step.parts')
  })
})
