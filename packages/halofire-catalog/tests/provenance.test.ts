/**
 * Provenance guard for the on-disk Stream F catalog truth surface.
 *
 * This test exercises the files that package consumers actually rely on:
 * `data/halofire/brand/components/SOURCES.json` and
 * `data/halofire/brand/components/component_map.json`.
 *
 * The goal is not to re-derive the catalog from code. The goal is to
 * ensure the emitted provenance stays honest:
 * - the shared ingestion policy matches the checked-in policy object
 * - procedural salvage stays `visual_reference`
 * - promoted families keep their IFC/DXF and verification flags aligned
 * - the component map and source manifest remain in lockstep
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CATALOG_SOURCE_INGESTION_POLICY,
  CatalogFamilyContractSchema,
  CatalogSourceIngestionPolicySchema,
  CatalogSourceLicenseSchema,
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
const COMPONENT_MAP_PATH = resolve(COMPONENT_DIR, 'component_map.json')

type SourceEntry = {
  key: string
  source_license_ref: string
  family_contract_ref: string
  source_kind: 'procedural' | 'manufacturer' | 'distributor'
  model_status: 'visual_reference' | 'dimensioned_parametric' | 'manufacturer_verified' | 'halo_fire_approved'
  source_license: unknown
  family_contract: unknown
}

type SourcesManifest = {
  ingestion_policy: unknown
  components: SourceEntry[]
}

type ComponentMapEntry = {
  glb: string
  model_status: SourceEntry['model_status']
  source: string
  source_kind: SourceEntry['source_kind']
  source_license_ref: string
  source_license: {
    model_status: SourceEntry['model_status']
    source_kind?: SourceEntry['source_kind']
  }
  manufacturer_verified: boolean
  dimensions_verified: boolean
  family_contract_ref: string
  family_contract: {
    model_status: SourceEntry['model_status']
    manufacturer_verified: boolean
    dimensions_verified: boolean
    ifc_path?: string | null
    dxf_path?: string | null
    source_license_ref?: string | null
  }
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

describe('provenance artifacts', () => {
  test('the checked-in ingestion policy matches the package policy', () => {
    const raw = loadJson<SourcesManifest>(SOURCES_PATH)
    const parsedPolicy = CatalogSourceIngestionPolicySchema.parse(
      raw.ingestion_policy,
    )

    expect(parsedPolicy).toEqual(CATALOG_SOURCE_INGESTION_POLICY)
    expect(parsedPolicy.default_model_status).toBe('visual_reference')
  })

  test('SOURCES.json and component_map.json stay aligned', () => {
    const sources = loadJson<SourcesManifest>(SOURCES_PATH)
    const componentMap = loadJson<Record<string, ComponentMapEntry>>(
      COMPONENT_MAP_PATH,
    )

    expect(Object.keys(componentMap).length).toBe(sources.components.length)

    for (const component of sources.components) {
      const mapped = componentMap[component.key]
      expect(mapped).toBeDefined()
      expect(mapped.source_license_ref).toBe(component.source_license_ref)
      expect(mapped.family_contract_ref).toBe(component.family_contract_ref)
      expect(mapped.source_kind).toBe(component.source_kind)
      expect(mapped.model_status).toBe(component.model_status)

      const license = CatalogSourceLicenseSchema.parse(component.source_license)
      const family = CatalogFamilyContractSchema.parse(component.family_contract)

      expect(license.part_ref).toBe(component.key)
      expect(family.part_ref).toBe(component.key)
      expect(license.model_status).toBe(component.model_status)
      expect(family.model_status).toBe(component.model_status)
      expect(family.manufacturer_verified).toBe(mapped.manufacturer_verified)
      expect(family.dimensions_verified).toBe(mapped.dimensions_verified)

      if (component.source_kind === 'procedural') {
        expect(license.model_status).toBe('visual_reference')
        expect(license.allowed_download).toBe(false)
        expect(license.redistribution_blocked).toBe(true)
        expect(family.model_status).toBe('visual_reference')
        expect(family.manufacturer_verified).toBe(false)
        expect(family.dimensions_verified).toBe(false)
        expect(family.ifc_path).toBeNull()
        expect(family.dxf_path).toBeNull()
      }

      if (
        component.model_status === 'dimensioned_parametric' ||
        component.model_status === 'manufacturer_verified' ||
        component.model_status === 'halo_fire_approved'
      ) {
        expect(family.source_license_ref).toBe(component.source_license_ref)
        expect(family.evidence_refs.length).toBeGreaterThan(0)
        expect(family.ifc_path).not.toBeNull()
        expect(family.dxf_path).not.toBeNull()
      }
    }
  })

  test('the current verified pipe and alarm-check families are promoted while known upgrade candidates stay dimensioned', () => {
    const sources = loadJson<SourcesManifest>(SOURCES_PATH)
    const byKey = new Map(sources.components.map((component) => [component.key, component]))

    const promotedKeys = [
      'pipe_steel_sch40_1p0in',
      'pipe_steel_sch40_1p25in',
      'pipe_steel_sch40_1p5in',
      'pipe_steel_sch40_2p5in',
      'pipe_steel_sch40_3p0in',
      'pipe_steel_sch40_4p0in',
      'pipe_steel_sch40_6p0in',
      'valve_alarm_check_4p0in',
      'valve_alarm_check_6p0in',
      'valve_alarm_check_8p0in',
    ]

    for (const key of promotedKeys) {
      const component = byKey.get(key)
      expect(component).toBeDefined()
      expect(component?.model_status).toBe('manufacturer_verified')
      expect(component?.manufacturer_verified).toBe(true)
      expect(component?.dimensions_verified).toBe(true)
      expect(component?.source_license.model_status).toBe('manufacturer_verified')
      expect(component?.family_contract.model_status).toBe('manufacturer_verified')
      expect(component?.family_contract.manufacturer_verified).toBe(true)
      expect(component?.family_contract.dimensions_verified).toBe(true)
    }

    for (const key of ['pipe_steel_sch40_2p0in', 'fitting_tee_2p0in', 'valve_check_2p5in']) {
      const component = byKey.get(key)
      expect(component).toBeDefined()
      expect(component?.model_status).toBe('dimensioned_parametric')
      expect(component?.manufacturer_verified).toBe(false)
      expect(component?.dimensions_verified).toBe(true)
      expect(component?.source_license.model_status).toBe('dimensioned_parametric')
      expect(component?.family_contract.model_status).toBe('dimensioned_parametric')
      expect(component?.family_contract.manufacturer_verified).toBe(false)
      expect(component?.family_contract.dimensions_verified).toBe(true)
    }
  })
})
