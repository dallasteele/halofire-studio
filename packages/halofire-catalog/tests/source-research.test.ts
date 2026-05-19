/**
 * Stream F source research and correction contract regression.
 *
 * The catalog owner lane needs a typed place to record internet-backed
 * source research, source-file provenance, and correction decisions.
 * This test keeps the contract honest without promoting open-source STEP
 * candidates or distributor salvage past their evidence.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CatalogCorrectionRecordSchema,
  CatalogSourceResearchLedgerSchema,
  CatalogSourceResearchSeedSchema,
  CatalogSourceResearchRecordSchema,
  summarizeSourceResearchLedger,
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

const SEED_PATH = resolve(COMPONENT_DIR, 'source_research_seed.json')
const LEDGER_PATH = resolve(COMPONENT_DIR, 'source_research_ledger.json')

describe('source research ledger contract', () => {
  test('checked-in research seed validates and carries the step.parts candidate', () => {
    const seed = CatalogSourceResearchSeedSchema.parse(
      JSON.parse(readFileSync(SEED_PATH, 'utf-8')),
    )

    expect(seed.source_collections).toHaveLength(16)
    expect(seed.source_collections.map((collection) => collection.source_id)).toEqual([
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
    expect(seed.source_collections[0]?.source_kind).toBe('open_source_step_directory')
    expect(seed.source_collections[0]?.source_file_ref).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(seed.source_collections[0]?.asset_kinds).toEqual([
      'product_page',
      'image',
      'step',
      'third_party_notice',
    ])
    expect(
      seed.source_collections.find((collection) => collection.source_id === 'victaulic_firelock_fittings')
        ?.asset_kinds,
    ).toEqual(['product_page', 'image', 'cut_sheet', 'revit', 'dwg'])
    expect(
      seed.source_collections.find((collection) => collection.source_id === 'victaulic_firelock_fittings')
        ?.image_url,
    ).toBe('https://www.victaulic.com/wp-content/uploads/2018/01/installation-ready-system-300x300-square.jpg')
    expect(
      seed.source_collections.find((collection) => collection.source_id === 'wheatland_schedule40')
        ?.image_url,
    ).toBe('https://www.wheatland.com/wp-content/uploads/2018/02/header-schedule40.jpg')
    expect(
      seed.source_collections.find((collection) => collection.source_id === 'tyco_av1_300')
        ?.image_url,
    ).toBe(
      'https://tyco.widen.net/content/fe6teog93x/jpeg/FIS_residentialproductdetail_product_AV-1-300_1.jpeg?color=ffffffff&position=c&quality=80&u=ncoxvb',
    )
    expect(
      seed.source_collections.find((collection) => collection.source_id === 'viking_vk100')
        ?.image_url,
    ).toBe(
      'https://www.vikinggroupinc.com/sites/default/files/styles/extra_large/public/2024-06/12986AB_VK100_K5_6_SR_UP_BR_155.png?itok=4w4zcTjK',
    )
    expect(
      seed.source_collections.find((collection) => collection.source_id === 'viking_vk3021_qr_pendent')
        ?.image_url,
    ).toBe('https://www.vikinggroupinc.com/sites/default/files/2023-12/viking-share-image-default.png')
    expect(seed.source_collections[0]?.image_url).toBe(
      'https://www.step.parts/step-parts-social-preview.png',
    )
    expect(seed.research_records.some((record) => record.source_id === 'step.parts')).toBe(true)
    expect(
      seed.research_records.find((record) => record.source_id === 'step.parts')
        ?.source_file_ref,
    ).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(
      seed.research_records.find((record) => record.source_id === 'step.parts')
        ?.source_license_ref,
    ).toBe('license:step.parts:hebi_r25_actuator')
    expect(
      seed.research_records.find((record) => record.source_id === 'step.parts')
        ?.source_license_spdx,
    ).toBe('MIT')
    expect(
      seed.research_records.find((record) => record.source_id === 'step.parts')
        ?.model_status,
    ).toBe('proxy')
    expect(
      seed.research_records.find((record) => record.part_ref === 'pipe_steel_sch40_2p0in')
        ?.source_license_ref,
    ).toBe('license:pipe_steel_sch40_2p0in')
    expect(
      seed.research_records.find((record) => record.part_ref === 'valve_check_2p5in')
        ?.source_license_ref,
    ).toBe('license:valve_check_2p5in')
    expect(
      seed.research_records.find((record) => record.part_ref === 'reliable_f156_upright_155f')
        ?.source_license_ref,
    ).toBe('license:reliable_f156_upright_155f')
    expect(seed.research_records.some((record) => record.source_id === 'ferguson_tyco_ty3251_spec')).toBe(true)
    expect(seed.research_records.some((record) => record.source_id === 'tyco_ty3251_tyb')).toBe(true)
    expect(seed.research_records.some((record) => record.source_id === 'tyco_ty4251_series_ty_b')).toBe(true)
    expect(seed.research_records.some((record) => record.part_ref === 'tyco_ty4251_pendent_k80_135f')).toBe(true)
    expect(seed.research_records.some((record) => record.part_ref === 'reliable_f156_upright_155f')).toBe(true)
    expect(seed.research_records.some((record) => record.source_id === 'viking_vk100')).toBe(true)
    expect(seed.research_records.some((record) => record.part_ref === 'viking_vk100_upright_286f')).toBe(true)
    expect(seed.research_records.some((record) => record.source_id === 'viking_vk3021_qr_pendent')).toBe(true)
    expect(seed.research_records.some((record) => record.part_ref === 'viking_vk300_qr_pendent_155f')).toBe(true)
    expect(seed.research_records.some((record) => record.source_id === 'tyco_lfii_hsw_tfp417')).toBe(true)
    expect(seed.research_records.some((record) => record.part_ref === 'sidewall_horizontal')).toBe(true)
    expect(seed.research_records.some((record) => record.source_id === 'reliable_dh56_bulletin_016')).toBe(true)
    expect(seed.research_records.some((record) => record.part_ref === 'sidewall_dry')).toBe(true)
    expect(seed.correction_records).toHaveLength(22)
    expect(
      seed.correction_records.some(
        (record) =>
          record.part_ref === 'sidewall_horizontal' &&
          record.action === 'request_source_capture',
      ),
    ).toBe(true)
    expect(
      seed.correction_records.some(
        (record) =>
          record.part_ref === 'sidewall_dry' &&
          record.action === 'request_source_capture',
      ),
    ).toBe(true)
    expect(
      seed.correction_records.some(
        (record) =>
          record.part_ref === 'pendent_standard_ferguson' &&
          record.action === 'request_human_correction',
      ),
    ).toBe(true)
    expect(
      seed.correction_records.some(
        (record) =>
          record.part_ref === 'step.parts:hebi_r25_actuator' &&
          record.action === 'request_source_capture',
      ),
    ).toBe(true)
  })

  test('checked-in research ledger validates and carries the step.parts candidate', () => {
    const ledger = CatalogSourceResearchLedgerSchema.parse(
      JSON.parse(readFileSync(LEDGER_PATH, 'utf-8')),
    )

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
    expect(ledger.source_collections[0]?.license_spdx).toBe('MIT')
    expect(ledger.source_collections[0]?.source_file_ref).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(ledger.source_collections[0]?.asset_kinds).toEqual([
      'product_page',
      'image',
      'step',
      'third_party_notice',
    ])
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'victaulic_firelock_fittings')
        ?.asset_kinds,
    ).toEqual(['product_page', 'image', 'cut_sheet', 'revit', 'dwg'])
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'victaulic_firelock_fittings')
        ?.image_url,
    ).toBe('https://www.victaulic.com/wp-content/uploads/2018/01/installation-ready-system-300x300-square.jpg')
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'wheatland_schedule40')
        ?.image_url,
    ).toBe('https://www.wheatland.com/wp-content/uploads/2018/02/header-schedule40.jpg')
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'tyco_av1_300')
        ?.image_url,
    ).toBe(
      'https://tyco.widen.net/content/fe6teog93x/jpeg/FIS_residentialproductdetail_product_AV-1-300_1.jpeg?color=ffffffff&position=c&quality=80&u=ncoxvb',
    )
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'viking_vk100')
        ?.image_url,
    ).toBe(
      'https://www.vikinggroupinc.com/sites/default/files/styles/extra_large/public/2024-06/12986AB_VK100_K5_6_SR_UP_BR_155.png?itok=4w4zcTjK',
    )
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'viking_vk3021_qr_pendent')
        ?.image_url,
    ).toBe('https://www.vikinggroupinc.com/sites/default/files/2023-12/viking-share-image-default.png')
    expect(ledger.source_collections[0]?.image_url).toBe(
      'https://www.step.parts/step-parts-social-preview.png',
    )
    expect(ledger.research_records.some((record) => record.source_id === 'step.parts')).toBe(true)
    expect(
      ledger.research_records.find((record) => record.source_id === 'step.parts')
        ?.source_file_ref,
    ).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(
      ledger.research_records.find((record) => record.source_id === 'step.parts')
        ?.source_license_ref,
    ).toBe('license:step.parts:hebi_r25_actuator')
    expect(
      ledger.research_records.find((record) => record.source_id === 'step.parts')
        ?.source_license_spdx,
    ).toBe('MIT')
    expect(
      ledger.research_records.find((record) => record.source_id === 'step.parts')
        ?.model_status,
    ).toBe('proxy')
    expect(ledger.research_records.some((record) => record.source_id === 'ferguson_tyco_ty3251_spec')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'pendent_standard')).toBe(true)
    expect(ledger.research_records.some((record) => record.source_id === 'tyco_ty4251_series_ty_b')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'tyco_ty4251_pendent_k80_135f')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'reliable_f156_upright_155f')).toBe(true)
    expect(ledger.research_records.some((record) => record.source_id === 'viking_vk100')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'viking_vk100_upright_135f')).toBe(true)
    expect(ledger.research_records.some((record) => record.source_id === 'viking_vk3021_qr_pendent')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'viking_vk300_qr_pendent_200f')).toBe(true)
    expect(ledger.research_records.some((record) => record.source_id === 'tyco_lfii_hsw_tfp417')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'sidewall_horizontal')).toBe(true)
    expect(ledger.research_records.some((record) => record.source_id === 'reliable_dh56_bulletin_016')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'sidewall_dry')).toBe(true)
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'victaulic_fl_qr_sw')
        ?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'revit', 'dwg'])
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'viking_vk100_revit2017')
        ?.source_file_ref,
    ).toContain('assets/revit/viking_vk100_revit2017.zip')
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'viking_vk100_revit2017')
        ?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'revit'])
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'victaulic_fl_qr_sw_revit41_02')
        ?.source_file_ref,
    ).toContain('assets/revit/victaulic_fl_qr_sw_revit41_02.zip')
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'victaulic_fl_qr_sw_revit41_02')
        ?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'revit'])
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'victaulic_fl_qr_sw_autocad3d_41_02')
        ?.source_file_ref,
    ).toContain('assets/dwg/victaulic_fl_qr_sw_autocad3d_41_02.zip')
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'victaulic_fl_qr_sw_autocad3d_41_02')
        ?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'dwg'])
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'victaulic_fl_qr_sw_autocad2d_41_02')
        ?.source_file_ref,
    ).toContain('assets/dwg/victaulic_fl_qr_sw_autocad2d_41_02.zip')
    expect(
      ledger.source_collections.find((collection) => collection.source_id === 'victaulic_fl_qr_sw_autocad2d_41_02')
        ?.asset_kinds,
    ).toEqual(['product_page', 'cut_sheet', 'dwg'])
    expect(ledger.correction_records).toHaveLength(22)
    expect(ledger.summary.total_records).toBe(23)
    expect(ledger.summary.promoted_count).toBe(22)
    expect(ledger.summary.correction_count).toBe(22)
    expect(ledger.summary).toEqual(summarizeSourceResearchLedger(ledger))
  })

  test('parses a mixed research ledger with the step.parts candidate, distributor salvage, and a manufacturer-backed record', () => {
    const ledger = CatalogSourceResearchLedgerSchema.parse({
      generated_at_utc: '2026-05-15T21:20:27Z',
      scope: 'Halo Forge Stream F catalog source research and correction workflow',
      source_collections: [
        {
          source_id: 'step.parts',
          source_kind: 'open_source_step_directory',
          public_url: 'https://www.step.parts',
          repo_url: 'https://github.com/earthtojake/step.parts',
          source_file_ref: 'E:/ClaudeBot/data/halofire/brand/components/source_step_parts/hebi_r25_actuator.step',
          license_spdx: 'MIT',
          third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
          capture_date: '2026-05-15T21:20:27Z',
          redistribution_blocked: true,
          notes: 'Open-source STEP directory candidate only; not manufacturer approval.',
        },
        {
          source_id: 'wheatland_schedule40',
          source_kind: 'manufacturer',
          public_url: 'https://www.wheatland.com/products/fire-sprinkler-pipe/schedule-40',
          image_url: 'https://www.wheatland.com/wp-content/uploads/2018/02/header-schedule40.jpg',
          source_url: 'https://www.wheatland.com/wp-content/uploads/2017/12/Schedule-40-Submittal-Sheet.pdf',
          source_file_ref: 'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/wheatland_schedule40_sprinkler_pipe.pdf',
          license_spdx: 'proprietary',
          third_party_notice_ref: null,
          capture_date: '2026-05-15T05:03:05.031677Z',
          redistribution_blocked: true,
          notes: 'Wheatland Tube manufacturer source for schedule 40 sprinkler pipe research and dimension checks.',
        },
        {
          source_id: 'victaulic_firelock_fittings',
          source_kind: 'manufacturer',
          public_url: 'https://www.victaulic.com/products/firelock-grooved-fittings/',
          image_url: 'https://www.victaulic.com/wp-content/uploads/2018/01/installation-ready-system-300x300-square.jpg',
          source_url: 'https://assets.victaulic.com/assets/uploads/literature/10.03.pdf',
          source_file_ref: 'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/victaulic_009n.pdf',
          license_spdx: 'proprietary',
          third_party_notice_ref: null,
          capture_date: '2026-05-15T05:03:05.031677Z',
          redistribution_blocked: true,
          notes: 'Victaulic FireLock grooved fittings source collection for tee and related grooved fitting research.',
        },
        {
          source_id: 'tyco_av1_300',
          source_kind: 'manufacturer',
          public_url: 'https://www.tyco-fire.com/products-and-solutions/valves-devices-and-components/wet-system-valves-and-components/av-1-300_fis/av-1-300-alarm-check-valve',
          image_url: 'https://tyco.widen.net/content/fe6teog93x/jpeg/FIS_residentialproductdetail_product_AV-1-300_1.jpeg?color=ffffffff&position=c&quality=80&u=ncoxvb',
          source_url: 'https://docs.johnsoncontrols.com/tycofire/api/khub/documents/1BlAbiphbAgwMOTfSiHCug/content',
          source_file_ref: 'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/tyco_av1_300.pdf',
          license_spdx: 'proprietary',
          third_party_notice_ref: null,
          capture_date: '2026-05-15T05:03:05.031677Z',
          redistribution_blocked: true,
          notes: 'Tyco AV-1-300 manufacturer source collection for alarm check valve research and dimensions.',
        },
      ],
      research_records: [
        {
          part_ref: 'step.parts:hebi_r25_actuator',
          source_id: 'step.parts',
          source_kind: 'open_source_step_directory',
          manufacturer: 'HEBI Robotics',
          model: 'R25 actuator',
          public_url: 'https://www.step.parts/parts/hebi_r25_actuator',
          source_url:
            'https://media.githubusercontent.com/media/HebiRobotics/hebi-cad/main/A-2700-25-XX_R25_Actuator/R25_Export.STEP',
          source_file_ref: 'E:/ClaudeBot/data/halofire/brand/components/source_step_parts/hebi_r25_actuator.step',
          source_license_ref: 'license:step.parts:hebi_r25_actuator',
          source_license_spdx: 'MIT',
          third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
          capture_date: '2026-05-15T21:20:27Z',
          license_summary: 'MIT upstream directory entry; locally ingested STEP sample remains upstream-governed.',
          redistribution_blocked: true,
          model_status: 'proxy',
          disposition: 'candidate',
          evidence_refs: ['https://www.step.parts', 'https://github.com/earthtojake/step.parts'],
          notes: 'Source candidate only; useful for open-source STEP ingestion, not sprinkler approval.',
        },
        {
          part_ref: 'pendent_standard_ferguson',
          source_id: 'ferguson_tyco_ty3251_spec',
          source_kind: 'distributor',
          manufacturer: 'Tyco Fire Protection',
          model: 'TY3251',
          public_url: 'https://api.ferguson.com/dar-step-service/Query?ASSET_ID=4685770&PRODUCT_ID=1959635&USE_TYPE=SPECIFICATION',
          source_url:
            'https://api.ferguson.com/dar-step-service/Query?ASSET_ID=4685770&PRODUCT_ID=1959635&USE_TYPE=SPECIFICATION',
          source_file_ref: 'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/ferguson_tyco_ty3251_spec.pdf',
          source_license_ref: 'license:pendent_standard_ferguson',
          source_license_spdx: 'proprietary',
          third_party_notice_ref: null,
          capture_date: '2026-05-15T05:03:05.031677Z',
          license_summary: 'Ferguson-hosted Tyco TY3251 specification page used to derive a dimensioned parametric proxy; redistribution blocked until manufacturer verification is completed.',
          redistribution_blocked: true,
          model_status: 'dimensioned_parametric',
          disposition: 'promoted',
          evidence_refs: [
            'https://api.ferguson.com/dar-step-service/Query?ASSET_ID=4685770&PRODUCT_ID=1959635&USE_TYPE=SPECIFICATION',
            'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/ferguson_tyco_ty3251_spec.pdf',
          ],
          notes: 'Distributor-backed salvage remains a dimensioned parametric proxy until a manufacturer-backed evidence path exists.',
        },
        {
          part_ref: 'pendent_standard',
          source_id: 'tyco_ty3251_tyb',
          source_kind: 'manufacturer',
          manufacturer: 'Tyco Fire Protection',
          model: 'TY3251',
          public_url:
            'https://docs.johnsoncontrols.com/tycofire/api/khub/documents/Y5s5g2HZNr6Um_t5iOK7dw/content',
          source_url:
            'https://docs.johnsoncontrols.com/tycofire/api/khub/documents/Y5s5g2HZNr6Um_t5iOK7dw/content',
          source_file_ref: 'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/tyco_ty3251_tyb.pdf',
          source_license_ref: 'license:pendent_standard',
          source_license_spdx: 'proprietary',
          third_party_notice_ref: null,
          capture_date: '2026-05-15T05:03:05.031677Z',
          license_summary: 'Public manufacturer cut sheet used for an internal parametric proxy; redistribution blocked.',
          redistribution_blocked: true,
          model_status: 'manufacturer_verified',
          disposition: 'promoted',
          evidence_refs: [
            'https://docs.johnsoncontrols.com/tycofire/api/khub/documents/Y5s5g2HZNr6Um_t5iOK7dw/content',
            'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/tyco_ty3251_tyb.pdf',
          ],
          notes: 'Manufacturer-backed source research row for the official TY3251 family.',
        },
        {
          part_ref: 'tyco_ty4251_pendent_k80_135f',
          source_id: 'tyco_ty4251_series_ty_b',
          source_kind: 'manufacturer',
          manufacturer: 'Tyco Fire Protection',
          model: 'TY4251',
          public_url:
            'https://docs.johnsoncontrols.com/tycofire/api/khub/documents/MbMoAJm4beEEsSDSyfV87g/content',
          source_url:
            'https://docs.johnsoncontrols.com/tycofire/api/khub/documents/MbMoAJm4beEEsSDSyfV87g/content',
          source_file_ref: 'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/tyco_ty4251_k80.pdf',
          source_license_ref: 'license:tyco_ty4251_pendent_k80_135f',
          source_license_spdx: 'proprietary',
          third_party_notice_ref: null,
          capture_date: '2026-05-15T22:18:37Z',
          license_summary: 'Tyco Series TY-B manufacturer page used with the TY4251 cut sheet to confirm the family identity and dimensions; redistribution remains blocked.',
          redistribution_blocked: true,
          model_status: 'manufacturer_verified',
          disposition: 'promoted',
          evidence_refs: [
            'https://docs.johnsoncontrols.com/tycofire/api/khub/documents/MbMoAJm4beEEsSDSyfV87g/content',
            'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/tyco_ty4251_k80.pdf',
          ],
          notes: 'Manufacturer-backed source research row for the TY4251 family variant tied to the official Series TY-B page.',
        },
      ],
      correction_records: [
        {
          part_ref: 'pendent_standard_ferguson',
          source_kind: 'distributor',
          from_status: 'visual_reference',
          to_status: 'dimensioned_parametric',
          action: 'promote_dimensioned_parametric',
          reason: 'Distributor specification and captured dimensions are both verified.',
          evidence_refs: [
            'https://api.ferguson.com/dar-step-service/Query?ASSET_ID=4685770&PRODUCT_ID=1959635&USE_TYPE=SPECIFICATION',
            'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/ferguson_tyco_ty3251_spec.pdf',
          ],
          reviewer: 'stream-f-owner',
          captured_at_utc: '2026-05-15T19:30:00Z',
          notes: 'Distributor-backed correction stays below manufacturer verification.',
        },
        {
          part_ref: 'pendent_standard',
          source_kind: 'manufacturer',
          from_status: 'dimensioned_parametric',
          to_status: 'manufacturer_verified',
          action: 'promote_manufacturer_verified',
          reason: 'Manufacturer cut sheet and dimensions are both verified.',
          evidence_refs: [
            'https://docs.johnsoncontrols.com/tycofire/api/khub/documents/Y5s5g2HZNr6Um_t5iOK7dw/content',
            'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/tyco_ty3251_tyb.pdf',
          ],
          reviewer: 'stream-f-owner',
          captured_at_utc: '2026-05-15T19:30:00Z',
          notes: 'Valid manufacturer-backed promotion path.',
        },
        {
          part_ref: 'tyco_ty4251_pendent_k80_135f',
          source_kind: 'manufacturer',
          from_status: 'visual_reference',
          to_status: 'manufacturer_verified',
          action: 'promote_manufacturer_verified',
          reason: 'Official Tyco Series TY-B page and TY4251 cut sheet both confirm the family identity and dimensions.',
          evidence_refs: [
            'https://docs.johnsoncontrols.com/tycofire/api/khub/documents/MbMoAJm4beEEsSDSyfV87g/content',
            'E:/ClaudeBot/halofire-studio/packages/halofire-catalog/cut_sheets/tyco_ty4251_k80.pdf',
          ],
          reviewer: 'stream-f-owner',
          captured_at_utc: '2026-05-15T22:18:37Z',
          notes: 'Manufacturer-backed correction path for the TY4251 family variant.',
        },
      ],
      summary: {
        total_records: 4,
        candidate_count: 1,
        blocked_count: 0,
        rejected_count: 0,
        promoted_count: 3,
        correction_count: 3,
      },
    })

    expect(ledger.source_collections).toHaveLength(4)
    expect(ledger.research_records).toHaveLength(4)
    expect(ledger.research_records[0]?.source_id).toBe('step.parts')
    expect(ledger.research_records[0]?.redistribution_blocked).toBe(true)
    expect(ledger.research_records[0]?.model_status).toBe('proxy')
    expect(ledger.research_records[1]?.source_kind).toBe('distributor')
    expect(ledger.research_records[1]?.model_status).toBe('dimensioned_parametric')
    expect(ledger.research_records[2]?.model_status).toBe('manufacturer_verified')
    expect(ledger.research_records[3]?.source_id).toBe('tyco_ty4251_series_ty_b')
    expect(ledger.research_records[3]?.model_status).toBe('manufacturer_verified')
    expect(ledger.correction_records).toHaveLength(3)
    expect(ledger.summary.promoted_count).toBe(3)
  })

  test('step.parts candidates cannot self-promote to manufacturer verified', () => {
    const result = CatalogSourceResearchRecordSchema.safeParse({
      part_ref: 'step.parts:hebi_r25_actuator',
      source_id: 'step.parts',
      source_kind: 'open_source_step_directory',
      manufacturer: 'HEBI Robotics',
      model: 'R25 actuator',
          public_url: 'https://www.step.parts/parts/hebi_r25_actuator',
          source_url:
            'https://media.githubusercontent.com/media/HebiRobotics/hebi-cad/main/A-2700-25-XX_R25_Actuator/R25_Export.STEP',
          source_file_ref: 'E:/ClaudeBot/data/halofire/brand/components/source_step_parts/hebi_r25_actuator.step',
          source_license_ref: 'license:step.parts:hebi_r25_actuator',
          third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
      capture_date: '2026-05-15T21:20:27Z',
      license_summary: 'MIT upstream directory entry; locally ingested STEP sample remains upstream-governed.',
      redistribution_blocked: true,
      source_license_spdx: 'MIT',
      model_status: 'manufacturer_verified',
      disposition: 'candidate',
      evidence_refs: ['https://www.step.parts'],
      notes: 'Should fail because open-source STEP cannot self-promote.',
    })

    expect(result.success).toBe(false)
  })

  test('step.parts candidates can remain proxy without becoming manufacturer verified', () => {
    const result = CatalogSourceResearchRecordSchema.safeParse({
      part_ref: 'step.parts:hebi_r25_actuator',
      source_id: 'step.parts',
      source_kind: 'open_source_step_directory',
      manufacturer: 'HEBI Robotics',
      model: 'R25 actuator',
      public_url: 'https://www.step.parts/parts/hebi_r25_actuator',
      source_url:
        'https://media.githubusercontent.com/media/HebiRobotics/hebi-cad/main/A-2700-25-XX_R25_Actuator/R25_Export.STEP',
      source_file_ref: 'E:/ClaudeBot/data/halofire/brand/components/source_step_parts/hebi_r25_actuator.step',
      source_license_ref: 'license:step.parts:hebi_r25_actuator',
      third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
      capture_date: '2026-05-15T21:20:27Z',
      license_summary: 'MIT upstream directory entry; locally ingested STEP sample remains upstream-governed.',
      redistribution_blocked: true,
      source_license_spdx: 'MIT',
      model_status: 'proxy',
      disposition: 'candidate',
      evidence_refs: ['https://www.step.parts'],
      notes: 'Open-source STEP candidate stays proxy until provenance proves the exact product.',
    })

    expect(result.success).toBe(true)
  })

  test('source research records reject missing source_license_ref', () => {
    const record = {
      ...JSON.parse(readFileSync(SEED_PATH, 'utf-8')).research_records.find(
        (entry: { part_ref: string }) => entry.part_ref === 'pipe_steel_sch40_2p0in',
      ),
    }
    delete record.source_license_ref

    const result = CatalogSourceResearchRecordSchema.safeParse(record)

    expect(result.success).toBe(false)
  })

  test('correction records block open-source STEP self-promotion', () => {
    const result = CatalogCorrectionRecordSchema.safeParse({
      part_ref: 'step.parts:hebi_r25_actuator',
      source_kind: 'open_source_step_directory',
      from_status: 'visual_reference',
      to_status: 'manufacturer_verified',
      action: 'promote_manufacturer_verified',
      reason: 'Not allowed for source candidate records.',
      evidence_refs: ['https://www.step.parts'],
      reviewer: 'stream-f-owner',
      captured_at_utc: '2026-05-15T19:30:00Z',
      notes: 'Blocked correction path for the open-source STEP candidate.',
    })

    expect(result.success).toBe(false)
  })
})
