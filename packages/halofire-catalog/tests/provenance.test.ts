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
const FAMILY_CONTRACTS_PATH = resolve(COMPONENT_DIR, 'family_contracts.json')

type SourceEntry = {
  key: string
  source_license_ref: string
  family_contract_ref: string
  source_kind: 'procedural' | 'manufacturer' | 'distributor'
  model_status: 'visual_reference' | 'dimensioned_parametric' | 'manufacturer_verified' | 'halo_fire_approved'
  source_license: {
    part_ref: string
    model_status: SourceEntry['model_status']
    source_kind?: SourceEntry['source_kind']
  }
  family_contract: {
    part_ref: string
    ref: string
    glb_path: string
    ifc_path: string | null
    dxf_path: string | null
    model_status: SourceEntry['model_status']
    manufacturer_verified: boolean
    dimensions_verified: boolean
    source_license_ref: string | null
    evidence_refs: string[]
  }
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
      expect(license.allowed_internal_use).toBe(true)
      expect(license.allowed_client_render).toBe(true)
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

  test('family_contracts.json stays aligned with the per-component source and family status contract', () => {
    const sources = loadJson<SourcesManifest>(SOURCES_PATH)
    const familyContracts = loadJson<{
      generated_at_utc: string
      contracts: Array<{
        ref: string
        part_ref: string
        glb_path: string
        ifc_path: string | null
        dxf_path: string | null
        model_status: SourceEntry['model_status']
        manufacturer_verified: boolean
        dimensions_verified: boolean
        source_license_ref: string | null
        evidence_refs: string[]
      }>
    }>(FAMILY_CONTRACTS_PATH)

    const sourceByKey = new Map(sources.components.map((component) => [component.key, component]))
    const contractByPart = new Map(
      familyContracts.contracts.map((contract) => [contract.part_ref, contract]),
    )

    expect(familyContracts.contracts.length).toBe(sources.components.length)

    for (const component of sources.components) {
      const contract = contractByPart.get(component.key)
      expect(contract).toBeDefined()
      expect(contract?.part_ref).toBe(component.key)
      expect(contract?.ref).toBe(component.family_contract_ref)
      expect(contract?.glb_path).toBe(component.family_contract.glb_path)
      expect(contract?.ifc_path).toBe(component.family_contract.ifc_path ?? null)
      expect(contract?.dxf_path).toBe(component.family_contract.dxf_path ?? null)
      expect(contract?.model_status).toBe(component.model_status)
      expect(contract?.manufacturer_verified).toBe(
        component.manufacturer_verified,
      )
      expect(contract?.dimensions_verified).toBe(component.dimensions_verified)
      expect(contract?.source_license_ref).toBe(component.source_license_ref)
      expect(contract?.evidence_refs).toEqual(['SOURCES.json', 'component_map.json'])
      expect(sourceByKey.get(component.key)?.source_license.model_status).toBe(
        component.model_status,
      )
      expect(sourceByKey.get(component.key)?.family_contract.model_status).toBe(
        component.model_status,
      )
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
      'pendent_residential',
      'reliable_f156_upright_155f',
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

    for (const key of ['pendent_standard_ferguson']) {
      const component = byKey.get(key)
      expect(component).toBeDefined()
      expect(component?.model_status).toBe('dimensioned_parametric')
      expect(component?.manufacturer_verified).toBe(false)
      expect(component?.dimensions_verified).toBe(true)
      expect(component?.source_license.source_kind).toBe('distributor')
      expect(component?.source_license.distributor).toBe('Ferguson')
      expect(component?.source_license.allowed_download).toBe(false)
      expect(component?.source_license.redistribution_blocked).toBe(true)
      expect(component?.source_license.model_status).toBe('dimensioned_parametric')
      expect(component?.family_contract.model_status).toBe('dimensioned_parametric')
      expect(component?.family_contract.manufacturer_verified).toBe(false)
      expect(component?.family_contract.dimensions_verified).toBe(true)
    }
  })

  test('Tyco TY3251 keeps the manufacturer-backed family separate from the Ferguson salvage proxy', () => {
    const sources = loadJson<SourcesManifest>(SOURCES_PATH)
    const byKey = new Map(sources.components.map((component) => [component.key, component]))

    const official = byKey.get('pendent_standard')
    expect(official).toBeDefined()
    expect(official?.source_kind).toBe('manufacturer')
    expect(official?.model_status).toBe('manufacturer_verified')
    expect(official?.manufacturer_verified).toBe(true)
    expect(official?.dimensions_verified).toBe(true)
    expect(official?.source_license.model_status).toBe('manufacturer_verified')
    expect(official?.source_license.source_kind).toBe('manufacturer')
    expect(official?.source_license.source_file_ref).toContain('tyco_ty3251_tyb.pdf')
    expect(official?.family_contract.model_status).toBe('manufacturer_verified')
    expect(official?.family_contract.manufacturer_verified).toBe(true)
    expect(official?.family_contract.dimensions_verified).toBe(true)
    expect(official?.family_contract.ifc_path).toBe('pendent_standard.ifc')
    expect(official?.family_contract.dxf_path).toBe('pendent_standard.dxf')

    const proxy = byKey.get('pendent_standard_ferguson')
    expect(proxy).toBeDefined()
    expect(proxy?.source_kind).toBe('distributor')
    expect(proxy?.model_status).toBe('dimensioned_parametric')
    expect(proxy?.manufacturer_verified).toBe(false)
    expect(proxy?.dimensions_verified).toBe(true)
    expect(proxy?.source_license.model_status).toBe('dimensioned_parametric')
    expect(proxy?.source_license.source_kind).toBe('distributor')
    expect(proxy?.source_license.source_file_ref).toContain('ferguson_tyco_ty3251_spec.pdf')
    expect(proxy?.family_contract.model_status).toBe('dimensioned_parametric')
    expect(proxy?.family_contract.manufacturer_verified).toBe(false)
    expect(proxy?.family_contract.dimensions_verified).toBe(true)
    expect(proxy?.family_contract.ifc_path).toBe('pendent_standard_ferguson.ifc')
    expect(proxy?.family_contract.dxf_path).toBe('pendent_standard_ferguson.dxf')
  })

  test('catalog source kinds stay inside their allowed status lanes', () => {
    const sources = loadJson<SourcesManifest>(SOURCES_PATH)

    for (const component of sources.components) {
      if (component.source_kind === 'procedural') {
        expect(component.model_status).toBe('visual_reference')
        expect(component.manufacturer_verified).toBe(false)
        expect(component.dimensions_verified).toBe(false)
        expect(component.source_license.model_status).toBe('visual_reference')
        expect(component.family_contract.model_status).toBe('visual_reference')
        expect(component.family_contract.ifc_path).toBeNull()
        expect(component.family_contract.dxf_path).toBeNull()
        continue
      }

      if (component.source_kind === 'distributor') {
        expect(component.model_status).not.toBe('manufacturer_verified')
        expect(component.model_status).not.toBe('halo_fire_approved')
        expect(component.source_license.allowed_download).toBe(false)
        expect(component.source_license.redistribution_blocked).toBe(true)
        expect(component.source_license.model_status).toBe(component.model_status)
        expect(component.family_contract.model_status).toBe(component.model_status)
        expect(component.family_contract.manufacturer_verified).toBe(false)
        expect(component.family_contract.dimensions_verified).toBe(true)
        expect(component.family_contract.ifc_path).not.toBeNull()
        expect(component.family_contract.dxf_path).not.toBeNull()
      }
    }
  })

  test('Victaulic No. 10, No. 11, and No. 20 grooved fittings are manufacturer verified with IFC and DXF deliverables', () => {
    const sources = loadJson<SourcesManifest>(SOURCES_PATH)
    const byKey = new Map(sources.components.map((component) => [component.key, component]))

    for (const key of [
      'victaulic_no10_elbow_90_grooved_2in',
      'victaulic_no10_elbow_90_grooved_4in',
      'victaulic_no10_elbow_90_grooved_6in',
      'victaulic_no11_elbow_45_grooved_2in',
      'victaulic_no11_elbow_45_grooved_4in',
      'victaulic_no20_tee_grooved_2in',
      'victaulic_no20_tee_grooved_4in',
      'victaulic_no20_tee_grooved_6in',
    ]) {
      const component = byKey.get(key)
      expect(component).toBeDefined()
      expect(component?.model_status).toBe('manufacturer_verified')
      expect(component?.manufacturer_verified).toBe(true)
      expect(component?.dimensions_verified).toBe(true)
      expect(component?.source_kind).toBe('manufacturer')
      expect(component?.source_license.model_status).toBe('manufacturer_verified')
      expect(component?.family_contract.model_status).toBe('manufacturer_verified')
      expect(component?.family_contract.manufacturer_verified).toBe(true)
      expect(component?.family_contract.dimensions_verified).toBe(true)
      expect(component?.family_contract.ifc_path).toBe(`${key}.ifc`)
      expect(component?.family_contract.dxf_path).toBe(`${key}.dxf`)
      expect(component?.family_contract.source_license_ref).toBe(component?.source_license_ref)
    }
  })
})
