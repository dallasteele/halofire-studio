/**
 * Stream F ledger builders regression.
 *
 * The package needs a typed replay surface for the checked-in source
 * research and source coverage artifacts. This test ensures the new
 * builder layer reproduces the current step.parts candidate and the
 * explicit vendor/model ledger contract.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildCoverageLedger,
  buildSourceResearchLedger,
  summarizeCoverageLedger,
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

const SOURCES_PATH = resolve(COMPONENT_DIR, 'SOURCES.json')
const SOURCE_RESEARCH_SEED_PATH = resolve(
  COMPONENT_DIR,
  'source_research_seed.json',
)
const SOURCE_COVERAGE_LEDGER_PATH = resolve(
  COMPONENT_DIR,
  'source_coverage_ledger.json',
)

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

describe('source ledger builders', () => {
  test('source research builder preserves the checked-in step.parts candidate', () => {
    const seed = loadJson<any>(SOURCE_RESEARCH_SEED_PATH)
    const built = buildSourceResearchLedger(seed)

    expect(built.summary).toEqual(summarizeSourceResearchLedger(built))
    expect(built.source_collections).toHaveLength(5)
    expect(built.source_collections.map((collection) => collection.source_id)).toEqual([
      'step.parts',
      'wheatland_schedule40',
      'victaulic_firelock_fittings',
      'tyco_av1_300',
      'reliable_f156_bulletin_031',
    ])
    expect(built.source_collections[0]?.source_url).toBe(
      'https://www.step.parts/parts/hebi_r25_actuator',
    )
    expect(
      built.research_records.find((record: any) => record.source_id === 'step.parts')
        ?.third_party_notice_ref,
    ).toBe('THIRD_PARTY_NOTICES.md')
    expect(
      built.research_records.find((record: any) => record.part_ref === 'reliable_f156_upright_155f')
        ?.model_status,
    ).toBe('manufacturer_verified')
  })

  test('coverage builder reproduces the explicit vendor/model ledger and step.parts candidate', () => {
    const sources = loadJson<{ components: any[] }>(SOURCES_PATH)
    const research = loadJson<any>(SOURCE_RESEARCH_SEED_PATH)
    const checkedInLedger = loadJson<any>(SOURCE_COVERAGE_LEDGER_PATH)

    const built = buildCoverageLedger({
      generated_at_utc: checkedInLedger.generated_at_utc,
      components: sources.components,
      source_research: research,
    })

    expect(built.summary).toEqual(summarizeCoverageLedger(built))
    expect(built.source_collections).toHaveLength(5)
    expect(built.source_collections.map((collection) => collection.source_id)).toEqual([
      'step.parts',
      'wheatland_schedule40',
      'victaulic_firelock_fittings',
      'tyco_av1_300',
      'reliable_f156_bulletin_031',
    ])
    expect(built.source_collections[0]?.source_url).toBe(
      'https://www.step.parts/parts/hebi_r25_actuator',
    )
    expect(built.source_collections[0]?.license_spdx).toBe('MIT')
    expect(built.rejected_candidates).toContain('pendent_standard_ferguson')
    expect(built.missing_downloads).toContain('pendent_standard:step')

    const stepCandidate = built.vendor_model_coverage.find(
      (row) => row.part_ref === 'step.parts:hebi_r25_actuator',
    )
    expect(stepCandidate).toBeDefined()
    expect(stepCandidate?.coverage_status).toBe('salvage_proxy')
    expect(stepCandidate?.source_kind).toBe('open_source_step_directory')
    expect(stepCandidate?.third_party_notice_ref).toBe('THIRD_PARTY_NOTICES.md')
    expect(
      stepCandidate?.asset_coverage.find((asset) => asset.kind === 'step')?.status,
    ).toBe('available')
    expect(
      stepCandidate?.asset_coverage.find((asset) => asset.kind === 'ifc')?.status,
    ).toBe('missing')
  })
})
