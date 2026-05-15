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
  CatalogSourceResearchRecordSchema,
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

const LEDGER_PATH = resolve(COMPONENT_DIR, 'source_research_ledger.json')

describe('source research ledger contract', () => {
  test('checked-in research ledger validates and carries the step.parts candidate', () => {
    const ledger = CatalogSourceResearchLedgerSchema.parse(
      JSON.parse(readFileSync(LEDGER_PATH, 'utf-8')),
    )

    expect(ledger.source_collections).toHaveLength(1)
    expect(ledger.source_collections[0]?.source_id).toBe('step.parts')
    expect(ledger.source_collections[0]?.license_spdx).toBe('MIT')
    expect(ledger.research_records.some((record) => record.source_id === 'step.parts')).toBe(true)
    expect(ledger.research_records.some((record) => record.part_ref === 'pendent_standard')).toBe(true)
    expect(ledger.correction_records).toHaveLength(1)
  })

  test('parses a mixed research ledger with the step.parts candidate and a manufacturer-backed record', () => {
    const ledger = CatalogSourceResearchLedgerSchema.parse({
      generated_at_utc: '2026-05-15T19:30:00Z',
      scope: 'Halo Forge Stream F catalog source research and correction workflow',
      source_collections: [
        {
          source_id: 'step.parts',
          source_kind: 'open_source_step_directory',
          public_url: 'https://www.step.parts',
          repo_url: 'https://github.com/earthtojake/step.parts',
          license_spdx: 'MIT',
          third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
          capture_date: '2026-05-15T19:15:00Z',
          redistribution_blocked: true,
          notes: 'Open-source STEP directory candidate only; not manufacturer approval.',
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
          source_file_ref: null,
          third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
          capture_date: '2026-05-15T19:15:00Z',
          license_summary: 'MIT upstream directory entry; downstream STEP file remains upstream-governed.',
          redistribution_blocked: true,
          model_status: 'visual_reference',
          disposition: 'candidate',
          evidence_refs: ['https://www.step.parts', 'https://github.com/earthtojake/step.parts'],
          notes: 'Source candidate only; useful for open-source STEP ingestion, not sprinkler approval.',
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
          evidence_refs: ['SOURCES.json', 'component_map.json'],
          notes: 'Manufacturer-backed source research row for the official TY3251 family.',
        },
      ],
      correction_records: [
        {
          part_ref: 'pendent_standard',
          source_kind: 'manufacturer',
          from_status: 'dimensioned_parametric',
          to_status: 'manufacturer_verified',
          action: 'promote_manufacturer_verified',
          reason: 'Manufacturer cut sheet and dimensions are both verified.',
          evidence_refs: ['SOURCES.json', 'component_map.json'],
          reviewer: 'stream-f-owner',
          captured_at_utc: '2026-05-15T19:30:00Z',
          notes: 'Valid manufacturer-backed promotion path.',
        },
      ],
      summary: {
        total_records: 2,
        candidate_count: 1,
        blocked_count: 0,
        rejected_count: 0,
        promoted_count: 1,
        correction_count: 1,
      },
    })

    expect(ledger.source_collections).toHaveLength(1)
    expect(ledger.research_records).toHaveLength(2)
    expect(ledger.research_records[0]?.source_id).toBe('step.parts')
    expect(ledger.research_records[0]?.redistribution_blocked).toBe(true)
    expect(ledger.research_records[0]?.model_status).toBe('visual_reference')
    expect(ledger.research_records[1]?.model_status).toBe('manufacturer_verified')
    expect(ledger.correction_records).toHaveLength(1)
    expect(ledger.summary.promoted_count).toBe(1)
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
      source_file_ref: null,
      third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
      capture_date: '2026-05-15T19:15:00Z',
      license_summary: 'MIT upstream directory entry.',
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
