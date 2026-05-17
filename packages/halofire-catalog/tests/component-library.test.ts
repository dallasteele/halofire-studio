/**
 * Stream F component-library regression.
 *
 * This keeps the checked-in component library truth surface aligned
 * across SOURCES.json, component_map.json, and family_contracts.json.
 * The goal is typed provenance, not re-deriving the catalog from code.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildCatalogComponentLibrary,
  CatalogComponentLibraryInputSchema,
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

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

describe('component library contract', () => {
  test('checked-in source manifest, component map, and family contracts validate together', () => {
    const library = buildCatalogComponentLibrary(
      CatalogComponentLibraryInputSchema.parse({
        source_manifest: loadJson(SOURCES_PATH),
        component_map: loadJson(COMPONENT_MAP_PATH),
        family_contracts: loadJson(FAMILY_CONTRACTS_PATH),
      }),
    )

    expect(library.summary.source_manifest_component_count).toBe(89)
    expect(library.summary.component_map_entry_count).toBe(89)
    expect(library.summary.family_contract_count).toBe(89)
    expect(library.summary.procedural_count).toBe(52)
    expect(library.summary.manufacturer_count).toBe(36)
    expect(library.summary.distributor_count).toBe(1)
    expect(library.summary.visual_reference_count).toBe(52)
    expect(library.summary.proxy_count).toBe(0)
    expect(library.summary.dimensioned_parametric_count).toBe(1)
    expect(library.summary.manufacturer_verified_count).toBe(36)
    expect(library.summary.sealed_approved_count).toBe(0)
    expect(library.summary.family_contract_ifc_count).toBeGreaterThan(0)
    expect(library.summary.family_contract_dxf_count).toBeGreaterThan(0)
    expect(library.summary.family_contract_manufacturer_verified_count).toBe(36)
    expect(library.summary.family_contract_dimensions_verified_count).toBe(37)

    const stepSource = library.source_manifest.components.find(
      (component) => component.key === 'step.parts:hebi_r25_actuator',
    )
    expect(stepSource).toBeUndefined()

    const pendentStandard = library.component_map['pendent_standard']
    expect(pendentStandard.model_status).toBe('manufacturer_verified')
    expect(pendentStandard.manufacturer_verified).toBe(true)
    expect(pendentStandard.dimensions_verified).toBe(true)
    expect(pendentStandard.source_kind).toBe('manufacturer')

    const salvage = library.component_map['pendent_standard_ferguson']
    expect(salvage.model_status).toBe('dimensioned_parametric')
    expect(salvage.manufacturer_verified).toBe(false)
    expect(salvage.dimensions_verified).toBe(true)
    expect(salvage.source_kind).toBe('distributor')

    const family = library.family_contracts.contracts.find(
      (contract) => contract.part_ref === 'pendent_standard',
    )
    expect(family?.ifc_path).toBe('pendent_standard.ifc')
    expect(family?.dxf_path).toBe('pendent_standard.dxf')
    expect(family?.manufacturer_verified).toBe(true)
    expect(family?.dimensions_verified).toBe(true)
  })
})
