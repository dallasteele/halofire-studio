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
import {
  CatalogCoverageLedgerSchema,
  CatalogSourceCollectionCoverageSchema,
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

const LEDGER_PATH = resolve(COMPONENT_DIR, 'source_coverage_ledger.json')
const THIRD_PARTY_NOTICES_PATH = resolve(COMPONENT_DIR, 'THIRD_PARTY_NOTICES.md')

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

describe('source coverage ledger', () => {
  test('generated ledger validates and carries the step.parts source candidate', () => {
    const ledger = CatalogCoverageLedgerSchema.parse(loadJson(LEDGER_PATH))

    expect(ledger.scope).toContain('Stream F')
    expect(ledger.source_collections).toHaveLength(16)
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
      'viking_vk100_revit2017',
      'victaulic_fl_qr_sw',
      'victaulic_fl_qr_sw_revit41_02',
      'victaulic_fl_qr_sw_autocad3d_41_02',
      'victaulic_fl_qr_sw_autocad2d_41_02',
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
    expect(stepParts.asset_kinds).toEqual([
      'product_page',
      'image',
      'step',
      'third_party_notice',
    ])
    expect(stepParts.image_url).toBe(
      'https://www.step.parts/step-parts-social-preview.png',
    )
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
    expect(viking?.asset_kinds).toEqual(['product_page', 'image', 'revit', 'cut_sheet'])
    expect(viking?.image_url).toBe(
      'https://www.vikinggroupinc.com/sites/default/files/styles/extra_large/public/2024-06/12986AB_VK100_K5_6_SR_UP_BR_155.png?itok=4w4zcTjK',
    )

    const wheatland = ledger.source_collections.find(
      (collection) => collection.source_id === 'wheatland_schedule40',
    )
    expect(wheatland?.image_url).toBe(
      'https://www.wheatland.com/wp-content/uploads/2018/02/header-schedule40.jpg',
    )
    expect(wheatland?.asset_kinds).toEqual([
      'product_page',
      'image',
      'cut_sheet',
      'revit',
      'dwg',
    ])

    const victaulicFittings = ledger.source_collections.find(
      (collection) => collection.source_id === 'victaulic_firelock_fittings',
    )
    expect(victaulicFittings?.asset_kinds).toEqual([
      'product_page',
      'image',
      'cut_sheet',
      'revit',
      'dwg',
    ])
    expect(victaulicFittings?.image_url).toBe(
      'https://www.victaulic.com/wp-content/uploads/2018/01/installation-ready-system-300x300-square.jpg',
    )

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
    expect(viking3021?.asset_kinds).toEqual(['product_page', 'image', 'revit', 'cut_sheet'])
    expect(viking3021?.image_url).toBe(
      'https://www.vikinggroupinc.com/sites/default/files/2023-12/viking-share-image-default.png',
    )

    const tycoTy3251 = ledger.source_collections.find(
      (collection) => collection.source_id === 'tyco_ty3251_tyb',
    )
    expect(tycoTy3251).toBeDefined()
    expect(tycoTy3251?.image_url).toBe(
      'https://tyco.widen.net/content/ftavruk2ll/jpeg/FIS_residentialproductdetail_product_TY-B_1.jpeg?color=ffffffff&position=c&quality=80&u=ncoxvb',
    )
    expect(tycoTy3251?.asset_kinds).toEqual([
      'product_page',
      'image',
      'cut_sheet',
      'revit',
    ])

    const viking3021Revit = ledger.source_collections.find(
      (collection) => collection.source_id === 'viking_vk3021_qr_pendent_revit2017',
    )
    expect(viking3021Revit?.asset_kinds).toEqual(['product_page', 'cut_sheet', 'revit'])

    const viking100Revit = ledger.source_collections.find(
      (collection) => collection.source_id === 'viking_vk100_revit2017',
    )
    expect(viking100Revit).toBeDefined()
    expect(viking100Revit?.source_url).toBe(
      'https://www.vikinggroupinc.com/sites/default/files/migrated/Viking%20-%20Standard%20Spray%20-%20Standard%20Response%20-%20VK100_Revit2017.zip',
    )
    expect(viking100Revit?.asset_kinds).toEqual(['product_page', 'cut_sheet', 'revit'])

    const tycoAv1 = ledger.source_collections.find(
      (collection) => collection.source_id === 'tyco_av1_300',
    )
    expect(tycoAv1?.image_url).toBe(
      'https://tyco.widen.net/content/fe6teog93x/jpeg/FIS_residentialproductdetail_product_AV-1-300_1.jpeg?color=ffffffff&position=c&quality=80&u=ncoxvb',
    )
    expect(tycoAv1?.asset_kinds).toEqual(['product_page', 'image', 'cut_sheet'])

    const victaulicFlQrSw = ledger.source_collections.find(
      (collection) => collection.source_id === 'victaulic_fl_qr_sw',
    )
    expect(victaulicFlQrSw?.asset_kinds).toEqual([
      'product_page',
      'cut_sheet',
      'revit',
      'dwg',
    ])
    expect(victaulicFlQrSw?.image_url).toBe(
      'https://victaulic.widen.net/content/wmhd64rlht/jpeg/Series-FL-QR-SW-Group-1.jpg?crop=false&position=c&q=80&color=ffffffff&u=6weima&w=500&h=500',
    )

    const victaulicFlQrSwRevit = ledger.source_collections.find(
      (collection) => collection.source_id === 'victaulic_fl_qr_sw_revit41_02',
    )
    expect(victaulicFlQrSwRevit).toBeDefined()
    expect(victaulicFlQrSwRevit?.source_url).toBe(
      'https://www.victaulicsoftware.com/vdc/content/zip/41.02%20Revit.zip?guid=%7B5B24A28F-628E-4F28-AE32-4C630A20F815%7D&version=US',
    )
    expect(victaulicFlQrSwRevit?.asset_kinds).toEqual([
      'product_page',
      'cut_sheet',
      'revit',
    ])

    const victaulicFlQrSwCad3d = ledger.source_collections.find(
      (collection) => collection.source_id === 'victaulic_fl_qr_sw_autocad3d_41_02',
    )
    expect(victaulicFlQrSwCad3d).toBeDefined()
    expect(victaulicFlQrSwCad3d?.source_file_ref).toContain(
      'assets/dwg/victaulic_fl_qr_sw_autocad3d_41_02.zip',
    )
    expect(victaulicFlQrSwCad3d?.asset_kinds).toEqual([
      'product_page',
      'cut_sheet',
      'dwg',
    ])

    const victaulicFlQrSwCad2d = ledger.source_collections.find(
      (collection) => collection.source_id === 'victaulic_fl_qr_sw_autocad2d_41_02',
    )
    expect(victaulicFlQrSwCad2d).toBeDefined()
    expect(victaulicFlQrSwCad2d?.source_file_ref).toContain(
      'assets/dwg/victaulic_fl_qr_sw_autocad2d_41_02.zip',
    )
    expect(victaulicFlQrSwCad2d?.asset_kinds).toEqual([
      'product_page',
      'cut_sheet',
      'dwg',
    ])

    const reliableDh56 = ledger.source_collections.find(
      (collection) => collection.source_id === 'reliable_dh56_bulletin_016',
    )
    expect(reliableDh56?.asset_kinds).toEqual(['product_page', 'cut_sheet', 'image', 'revit'])

    expect(ledger.vendor_model_coverage.length).toBeGreaterThan(0)
    expect(ledger.summary.total_rows).toBe(ledger.vendor_model_coverage.length)
    expect(ledger.summary.missing_download_count).toBeGreaterThan(0)
    expect(ledger.summary.rejected_candidate_count).toBeGreaterThan(0)
    expect(ledger.summary.proxy_count).toBe(6)
    expect(ledger.summary.sealed_approved_count).toBe(0)
    expect(ledger.summary.image_missing_count).toBe(73)
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
    expect(stepCandidate?.asset_coverage.find((asset) => asset.kind === 'image')?.status).toBe('available')
    expect(stepCandidate?.asset_coverage.find((asset) => asset.kind === 'image')?.ref).toBe(
      'https://www.step.parts/step-parts-social-preview.png',
    )
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

    const tycoAv1Coverage = ledger.vendor_model_coverage.find(
      (row) => row.part_ref === 'valve_check_2p5in',
    )
    expect(tycoAv1Coverage?.asset_coverage.find((asset) => asset.kind === 'product_page')?.status).toBe('available')
    expect(tycoAv1Coverage?.asset_coverage.find((asset) => asset.kind === 'image')?.status).toBe('available')
    expect(tycoAv1Coverage?.asset_coverage.find((asset) => asset.kind === 'image')?.ref).toBe(
      'https://tyco.widen.net/content/fe6teog93x/jpeg/FIS_residentialproductdetail_product_AV-1-300_1.jpeg?color=ffffffff&position=c&quality=80&u=ncoxvb',
    )

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
    expect(sidewallHorizontal?.asset_coverage.find((asset) => asset.kind === 'image')?.status).toBe('available')
    expect(sidewallHorizontal?.asset_coverage.find((asset) => asset.kind === 'image')?.ref).toBe(
      'https://tyco.widen.net/content/upgo1g6cdj/jpeg/bts_imageleftcontentright_lfii_hsw_sprinklers_Stock%20photo%20ID182218173.jpeg?color=ffffffff&position=c&quality=80&u=ncoxvb',
    )
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
    expect(sidewallDry?.asset_coverage.find((asset) => asset.kind === 'image')?.status).toBe('available')
    expect(sidewallDry?.asset_coverage.find((asset) => asset.kind === 'image')?.ref).toBe(
      'https://www.reliablesprinkler.com/wp-content/uploads/2020/03/DH56-dry-white-crop-1-e1583452746731.png',
    )
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
    expect(notices).toContain('Stream F coverage contract')
    expect(notices).toContain('source_research_ledger.json')
    expect(notices).toContain('source_coverage_ledger.json')
    expect(notices).toContain('manufacturer_verified')
    expect(notices).toContain('sealed_approved')
  })

  test('open-source STEP source collections must carry a local source file ref', () => {
    const result = CatalogSourceCollectionCoverageSchema.safeParse({
      source_id: 'step.parts',
      source_kind: 'open_source_step_directory',
      public_url: 'https://www.step.parts',
      repo_url: 'https://github.com/earthtojake/step.parts',
      image_url: 'https://www.step.parts/step-parts-social-preview.png',
      source_url: 'https://www.step.parts/parts/hebi_r25_actuator',
      license_spdx: 'MIT',
      third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
      capture_date: '2026-05-19T16:54:15Z',
      redistribution_blocked: true,
      notes: 'Open-source STEP directory candidate only; not manufacturer approval.',
    })

    expect(result.success).toBe(false)
  })

  test('open-source STEP source collections must declare STEP and third-party notice asset coverage', () => {
    const result = CatalogSourceCollectionCoverageSchema.safeParse({
      source_id: 'step.parts',
      source_kind: 'open_source_step_directory',
      public_url: 'https://www.step.parts',
      repo_url: 'https://github.com/earthtojake/step.parts',
      image_url: 'https://www.step.parts/step-parts-social-preview.png',
      source_url: 'https://www.step.parts/parts/hebi_r25_actuator',
      source_file_ref: 'E:/ClaudeBot/data/halofire/brand/components/source_step_parts/hebi_r25_actuator.step',
      license_spdx: 'MIT',
      third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
      asset_kinds: ['product_page', 'image'],
      capture_date: '2026-05-19T16:54:15Z',
      redistribution_blocked: true,
      notes: 'Open-source STEP directory candidate only; not manufacturer approval.',
    })

    expect(result.success).toBe(false)
  })

  test('manufacturer source collections must carry a local source file ref', () => {
    const result = CatalogSourceCollectionCoverageSchema.safeParse({
      source_id: 'wheatland_schedule40',
      source_kind: 'manufacturer',
      public_url: 'https://www.wheatland.com/products/fire-sprinkler-pipe/schedule-40',
      image_url: 'https://www.wheatland.com/wp-content/uploads/2018/02/header-schedule40.jpg',
      source_url: 'https://www.wheatland.com/wp-content/uploads/2017/12/Schedule-40-Submittal-Sheet.pdf',
      license_spdx: 'proprietary',
      third_party_notice_ref: null,
      capture_date: '2026-05-19T16:54:15Z',
      redistribution_blocked: true,
      notes: 'Manufacturer source collection without a local file ref should fail.',
    })

    expect(result.success).toBe(false)
  })

  test('manufacturer source collections must declare product-page and cut-sheet asset coverage', () => {
    const result = CatalogSourceCollectionCoverageSchema.safeParse({
      source_id: 'wheatland_schedule40',
      source_kind: 'manufacturer',
      public_url: 'https://www.wheatland.com/products/fire-sprinkler-pipe/schedule-40',
      image_url: 'https://www.wheatland.com/wp-content/uploads/2018/02/header-schedule40.jpg',
      source_url: 'https://www.wheatland.com/wp-content/uploads/2017/12/Schedule-40-Submittal-Sheet.pdf',
      source_file_ref: 'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/wheatland_schedule40_sprinkler_pipe.pdf',
      license_spdx: 'proprietary',
      third_party_notice_ref: null,
      asset_kinds: ['image'],
      capture_date: '2026-05-19T16:54:15Z',
      redistribution_blocked: true,
      notes: 'Manufacturer source collection without product-page/cut-sheet coverage should fail.',
    })

    expect(result.success).toBe(false)
  })
})
