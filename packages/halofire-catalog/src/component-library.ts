/**
 * Typed component-library contracts for the Stream F catalog owner lane.
 *
 * Purpose:
 * - validate the checked-in component library truth surface
 * - keep SOURCES.json, component_map.json, and family_contracts.json
 *   aligned as one replayable provenance bundle
 * - surface source licensing, model status tiers, and verification flags
 *   as typed data instead of ad hoc JSON blobs
 */

import { z } from 'zod'
import {
  CatalogFamilyContractSchema,
  CatalogModelStatusSchema,
  CatalogSourceIngestionPolicySchema,
  CatalogSourceKindSchema,
  CatalogSourceLicenseSchema,
} from './schema.js'

const hasText = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0

export const CatalogComponentSourceRecordSchema = z.object({
  key: z.string().min(1),
  glb: z.string().min(1),
  model_status: CatalogModelStatusSchema,
  source: z.string().min(1),
  source_kind: z.union([
    CatalogSourceKindSchema,
    z.literal('open_source_step_directory'),
  ]),
  source_license_ref: z.string().min(1),
  source_license: CatalogSourceLicenseSchema,
  manufacturer_verified: z.boolean(),
  dimensions_verified: z.boolean(),
  family_contract_ref: z.string().min(1),
  family_contract: CatalogFamilyContractSchema,
  license: z.string().min(1),
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  notes: z.string(),
  size_bytes: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
  if (value.source_license.part_ref !== value.key) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source_license', 'part_ref'],
      message: 'source_license.part_ref must match component key',
    })
  }
  if (value.family_contract.part_ref !== value.key) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['family_contract', 'part_ref'],
      message: 'family_contract.part_ref must match component key',
    })
  }
  if (value.source_license.model_status !== value.family_contract.model_status) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['family_contract', 'model_status'],
      message:
        'source_license.model_status and family_contract.model_status must match',
    })
  }
  if (value.source_license.model_status !== value.family_contract.model_status) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source_license', 'model_status'],
      message:
        'source_license.model_status and family_contract.model_status must stay aligned',
    })
  }
  if (value.model_status !== value.source_license.model_status) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['model_status'],
      message: 'model_status must match the nested source license',
    })
  }
  if (!hasText(value.source)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source'],
      message: 'component records require source',
    })
  }
})

export const CatalogComponentSourceManifestSchema = z.object({
  acquisition_strategy: z.array(z.string().min(1)),
  generated_at_utc: z.string().min(1),
  ingestion_policy: CatalogSourceIngestionPolicySchema,
  components: z.array(CatalogComponentSourceRecordSchema).min(1),
})

export const CatalogComponentMapEntrySchema = z.object({
  glb: z.string().min(1),
  category: z.string().min(1),
  ferguson_sku: z.string().nullable().optional(),
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  k_factor: z.number().positive().nullable().optional(),
  diameter_in: z.number().positive().nullable().optional(),
  dimensions_m: z.object({
    x: z.number().positive(),
    y: z.number().positive(),
    z: z.number().positive(),
  }),
  source: z.string().min(1),
  model_status: CatalogModelStatusSchema,
  manufacturer_verified: z.boolean(),
  dimensions_verified: z.boolean(),
  source_license_ref: z.string().min(1),
  family_contract_ref: z.string().min(1),
  source_kind: z.union([
    CatalogSourceKindSchema,
    z.literal('open_source_step_directory'),
  ]),
  notes: z.string(),
})

export const CatalogComponentMapSchema = z.record(
  z.string().min(1),
  CatalogComponentMapEntrySchema,
)

export const CatalogFamilyContractRecordSchema = z.object({
  ref: z.string().min(1),
  part_ref: z.string().min(1),
  glb_path: z.string().min(1),
  ifc_path: z.string().nullable().optional(),
  dxf_path: z.string().nullable().optional(),
  model_status: CatalogModelStatusSchema,
  manufacturer_verified: z.boolean(),
  dimensions_verified: z.boolean(),
  source_license_ref: z.string().nullable().optional(),
  evidence_refs: z.array(z.string()),
})

export const CatalogFamilyContractsCollectionSchema = z.object({
  generated_at_utc: z.string().min(1),
  contracts: z.array(CatalogFamilyContractRecordSchema).min(1),
})

const CatalogComponentLibraryInputSchemaBase = z.object({
  source_manifest: CatalogComponentSourceManifestSchema,
  component_map: CatalogComponentMapSchema,
  family_contracts: CatalogFamilyContractsCollectionSchema,
})

export const CatalogComponentLibraryInputSchema = CatalogComponentLibraryInputSchemaBase.superRefine(
  (value, ctx) => {
    const components = value.source_manifest.components
    const componentKeys = new Set(components.map((component) => component.key))
    const mapKeys = new Set(Object.keys(value.component_map))
    const contractsByPart = new Map(
      value.family_contracts.contracts.map((contract) => [contract.part_ref, contract]),
    )

    if (componentKeys.size !== components.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_manifest', 'components'],
        message: 'source_manifest must not contain duplicate component keys',
      })
    }
    if (mapKeys.size !== components.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['component_map'],
        message: 'component_map must contain one row per component',
      })
    }
    if (contractsByPart.size !== value.family_contracts.contracts.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['family_contracts', 'contracts'],
        message: 'family_contracts must not contain duplicate part refs',
      })
    }
    if (value.family_contracts.contracts.length !== components.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['family_contracts', 'contracts'],
        message: 'family_contracts must contain one contract per component',
      })
    }

    for (const key of mapKeys) {
      if (!componentKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', key],
          message: 'component_map contains an unexpected component row',
        })
      }
    }
    for (const contract of value.family_contracts.contracts) {
      if (!componentKeys.has(contract.part_ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', contract.part_ref],
          message: 'family_contracts contains an unexpected contract row',
        })
      }
    }

    for (const component of components) {
      const mapEntry = value.component_map[component.key]
      if (!mapEntry) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', component.key],
          message: 'component_map is missing a component row',
        })
        continue
      }
      if (mapEntry.glb !== component.glb) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', component.key, 'glb'],
          message: 'component_map.glb must match the source manifest',
        })
      }
      if (mapEntry.manufacturer !== component.manufacturer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', component.key, 'manufacturer'],
          message: 'component_map.manufacturer must match the source manifest',
        })
      }
      if (mapEntry.model !== component.model) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', component.key, 'model'],
          message: 'component_map.model must match the source manifest',
        })
      }
      if (mapEntry.model_status !== component.model_status) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', component.key, 'model_status'],
          message: 'component_map.model_status must match the source manifest',
        })
      }
      if (mapEntry.manufacturer_verified !== component.manufacturer_verified) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', component.key, 'manufacturer_verified'],
          message:
            'component_map.manufacturer_verified must match the source manifest',
        })
      }
      if (mapEntry.dimensions_verified !== component.dimensions_verified) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', component.key, 'dimensions_verified'],
          message:
            'component_map.dimensions_verified must match the source manifest',
        })
      }
      if (mapEntry.source_license_ref !== component.source_license_ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', component.key, 'source_license_ref'],
          message:
            'component_map.source_license_ref must match the source manifest',
        })
      }
      if (mapEntry.family_contract_ref !== component.family_contract_ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['component_map', component.key, 'family_contract_ref'],
          message:
            'component_map.family_contract_ref must match the source manifest',
        })
      }

      const contract = contractsByPart.get(component.key)
      if (!contract) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', component.key],
          message: 'family_contracts is missing a component contract',
        })
        continue
      }
      if (contract.ref !== component.family_contract_ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', component.key, 'ref'],
          message: 'family_contracts.ref must match the source manifest',
        })
      }
      if (contract.glb_path !== component.family_contract.glb_path) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', component.key, 'glb_path'],
          message: 'family_contracts.glb_path must match the source manifest',
        })
      }
      if (contract.ifc_path !== component.family_contract.ifc_path) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', component.key, 'ifc_path'],
          message: 'family_contracts.ifc_path must match the source manifest',
        })
      }
      if (contract.dxf_path !== component.family_contract.dxf_path) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', component.key, 'dxf_path'],
          message: 'family_contracts.dxf_path must match the source manifest',
        })
      }
      if (contract.model_status !== component.model_status) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', component.key, 'model_status'],
          message: 'family_contracts.model_status must match the source manifest',
        })
      }
      if (contract.manufacturer_verified !== component.manufacturer_verified) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', component.key, 'manufacturer_verified'],
          message:
            'family_contracts.manufacturer_verified must match the source manifest',
        })
      }
      if (contract.dimensions_verified !== component.dimensions_verified) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', component.key, 'dimensions_verified'],
          message:
            'family_contracts.dimensions_verified must match the source manifest',
        })
      }
      if (contract.source_license_ref !== component.source_license_ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['family_contracts', 'contracts', component.key, 'source_license_ref'],
          message:
            'family_contracts.source_license_ref must match the source manifest',
        })
      }
    }
  },
)

export type CatalogComponentSourceRecord = z.infer<
  typeof CatalogComponentSourceRecordSchema
>
export type CatalogComponentSourceManifest = z.infer<
  typeof CatalogComponentSourceManifestSchema
>
export type CatalogComponentMapEntry = z.infer<typeof CatalogComponentMapEntrySchema>
export type CatalogComponentMap = z.infer<typeof CatalogComponentMapSchema>
export type CatalogFamilyContractRecord = z.infer<
  typeof CatalogFamilyContractRecordSchema
>
export type CatalogFamilyContractsCollection = z.infer<
  typeof CatalogFamilyContractsCollectionSchema
>
export type CatalogComponentLibraryInput = z.infer<
  typeof CatalogComponentLibraryInputSchema
>

export interface CatalogComponentLibrarySummary {
  source_manifest_component_count: number
  component_map_entry_count: number
  family_contract_count: number
  procedural_count: number
  manufacturer_count: number
  distributor_count: number
  visual_reference_count: number
  proxy_count: number
  dimensioned_parametric_count: number
  manufacturer_verified_count: number
  sealed_approved_count: number
  family_contract_ifc_count: number
  family_contract_dxf_count: number
  family_contract_manufacturer_verified_count: number
  family_contract_dimensions_verified_count: number
}

export interface CatalogComponentLibrary {
  source_manifest: CatalogComponentSourceManifest
  component_map: CatalogComponentMap
  family_contracts: CatalogFamilyContractsCollection
  summary: CatalogComponentLibrarySummary
}

export const CatalogComponentLibrarySummarySchema: z.ZodType<CatalogComponentLibrarySummary> =
  z.object({
    source_manifest_component_count: z.number().int().nonnegative(),
    component_map_entry_count: z.number().int().nonnegative(),
    family_contract_count: z.number().int().nonnegative(),
    procedural_count: z.number().int().nonnegative(),
    manufacturer_count: z.number().int().nonnegative(),
    distributor_count: z.number().int().nonnegative(),
    visual_reference_count: z.number().int().nonnegative(),
    proxy_count: z.number().int().nonnegative(),
    dimensioned_parametric_count: z.number().int().nonnegative(),
    manufacturer_verified_count: z.number().int().nonnegative(),
    sealed_approved_count: z.number().int().nonnegative(),
    family_contract_ifc_count: z.number().int().nonnegative(),
    family_contract_dxf_count: z.number().int().nonnegative(),
    family_contract_manufacturer_verified_count: z.number().int().nonnegative(),
    family_contract_dimensions_verified_count: z.number().int().nonnegative(),
  })

export const CatalogComponentLibrarySchema: z.ZodType<CatalogComponentLibrary> =
  CatalogComponentLibraryInputSchemaBase.extend({
    summary: CatalogComponentLibrarySummarySchema,
  })

export function summarizeCatalogComponentLibrary(
  library: Pick<
    CatalogComponentLibrary,
    'source_manifest' | 'component_map' | 'family_contracts'
  >,
): CatalogComponentLibrarySummary {
  const components = library.source_manifest.components
  const contracts = library.family_contracts.contracts
  return {
    source_manifest_component_count: components.length,
    component_map_entry_count: Object.keys(library.component_map).length,
    family_contract_count: contracts.length,
    procedural_count: components.filter((component) => component.source_kind === 'procedural').length,
    manufacturer_count: components.filter((component) => component.source_kind === 'manufacturer').length,
    distributor_count: components.filter((component) => component.source_kind === 'distributor').length,
    visual_reference_count: components.filter((component) => component.model_status === 'visual_reference').length,
    proxy_count: components.filter((component) => component.model_status === 'proxy').length,
    dimensioned_parametric_count: components.filter((component) => component.model_status === 'dimensioned_parametric').length,
    manufacturer_verified_count: components.filter((component) => component.model_status === 'manufacturer_verified').length,
    sealed_approved_count: components.filter((component) => component.model_status === 'sealed_approved').length,
    family_contract_ifc_count: contracts.filter((contract) => hasText(contract.ifc_path)).length,
    family_contract_dxf_count: contracts.filter((contract) => hasText(contract.dxf_path)).length,
    family_contract_manufacturer_verified_count: contracts.filter((contract) => contract.manufacturer_verified).length,
    family_contract_dimensions_verified_count: contracts.filter((contract) => contract.dimensions_verified).length,
  }
}

export function buildCatalogComponentLibrary(
  rawInput: unknown,
): CatalogComponentLibrary {
  const input = CatalogComponentLibraryInputSchema.parse(rawInput)
  const output = CatalogComponentLibrarySchema.parse({
    ...input,
    summary: summarizeCatalogComponentLibrary(input),
  })

  if (output.summary.source_manifest_component_count !== output.summary.component_map_entry_count) {
    throw new Error('component library summary drifted from component_map entry count')
  }
  if (output.summary.source_manifest_component_count !== output.summary.family_contract_count) {
    throw new Error('component library summary drifted from family contract count')
  }

  return output
}
