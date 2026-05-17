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

    expect(seed.source_collections).toHaveLength(5)
    expect(seed.source_collections.map((collection) => collection.source_id)).toEqual([
      'step.parts',
      'wheatland_schedule40',
      'victaulic_firelock_fittings',
      'tyco_av1_300',
      'reliable_f156_bulletin_031',
    ])
    expect(seed.source_collections[0]?.source_kind).toBe('open_source_step_directory')
    expect(seed.source_collections[0]?.source_file_ref).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(seed.research_records.some((record) => record.source_id === 'step.parts')).toBe(true)
    expect(
      seed.research_records.find((record) => record.source_id === 'step.parts')
        ?.source_file_ref,
    ).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(seed.research_records.some((record) => record.source_id === 'ferguson_tyco_ty3251_spec')).toBe(true)
    expect(seed.research_records.some((record) => record.source_id === 'tyco_ty3251_tyb')).toBe(true)
    expect(seed.research_records.some((record) => record.source_id === 'tyco_ty4251_series_ty_b')).toBe(true)
    expect(seed.research_records.some((record) => record.part_ref === 'tyco_ty4251_pendent_k80_135f')).toBe(true)
    expect(seed.research_records.some((record) => record.part_ref === 'reliable_f156_upright_155f')).toBe(true)
    expect(seed.correction_records).toHaveLength(6)
  })

  test('checked-in research ledger validates and carries the step.parts candidate', () => {
    const ledger = CatalogSourceResearchLedgerSchema.parse(
      JSON.parse(readFileSync(LEDGER_PATH, 'utf-8')),
    )

    expect(ledger.source_collections).toHaveLength(5)
    expect(ledger.source_collections.map((collection) => collection.source_id)).toEqual([
      'step.parts',
      'wheatland_schedule40',
      'victaulic_firelock_fittings',
      'tyco_av1_300',
      'reliable_f156_bulletin_031',
    ])
    expect(ledger.source_collections[0]?.license_spdx).toBe('MIT')
    expect(ledger.source_collections[0]?.source_file_ref).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(ledger.research_records.some((record) => record.source_id === 'step.parts')).toBe(true)
    expect(
      ledger.research_records.find((record) => record.source_id === 'step.parts')
        ?.source_file_ref,
    ).toContain('source_step_parts/hebi_r25_actuator.step')
    expect(ledger.research_records.some((record) => record.source_id === 'ferguson_tyco_ty3251_spec')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'pendent_standard')).toBe(true)
    expect(ledger.research_records.some((record) => record.source_id === 'tyco_ty4251_series_ty_b')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'tyco_ty4251_pendent_k80_135f')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'reliable_f156_upright_155f')).toBe(true)
    expect(ledger.correction_records).toHaveLength(6)
    expect(ledger.summary.total_records).toBe(8)
    expect(ledger.summary.promoted_count).toBe(7)
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
          third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
          capture_date: '2026-05-15T21:20:27Z',
          license_summary: 'MIT upstream directory entry; locally ingested STEP sample remains upstream-governed.',
          redistribution_blocked: true,
          model_status: 'visual_reference',
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
    expect(ledger.research_records[0]?.model_status).toBe('visual_reference')
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
      third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
      capture_date: '2026-05-15T21:20:27Z',
      license_summary: 'MIT upstream directory entry; locally ingested STEP sample remains upstream-governed.',
      redistribution_blocked: true,
      model_status: 'manufacturer_verified',
      disposition: 'candidate',
      evidence_refs: ['https://www.step.parts'],
      notes: 'Should fail because open-source STEP cannot self-promote.',
    })

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
