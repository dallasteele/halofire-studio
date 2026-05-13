/**
 * Runtime validator for `catalog.json` (Phase D.1 reconcile — 2026-04-21).
 *
 * The canonical schema is defined in `types.ts`. This file mirrors it as
 * a Zod schema so the build can fail loudly the moment the SCAD author
 * vocabulary + generator + on-disk JSON + consumer TS types drift apart.
 *
 * Usage:
 *
 *   import { CatalogManifestSchema, parseCatalog } from '@halofire/catalog'
 *   const catalog = parseCatalog(rawJson)   // throws with a readable path
 *
 * Consumers (`@halofire/core/catalog/load`) call `parseCatalog` on the
 * freshly-loaded JSON so drift is caught at load, not at first use.
 */

import { z } from 'zod'
import type {
  CatalogEntry,
  CatalogManifest,
  CatalogFamilyContract,
  CatalogParam,
  CatalogPort,
  CatalogSourceIngestionPolicy,
  CatalogSourceLicense,
  CatalogSourceKind,
  PartKind,
} from './types.js'

// ── PartKind ────────────────────────────────────────────────────────────
export const PartKindSchema = z.enum([
  'sprinkler_head',
  'pipe_segment',
  'fitting',
  'valve',
  'hanger',
  'device',
  'fdc',
  'riser_assy',
  'compound',
  'structural',
  'unknown',
]) satisfies z.ZodType<PartKind>

export const CatalogModelStatusSchema = z.enum([
  'visual_reference',
  'dimensioned_parametric',
  'manufacturer_verified',
  'halo_fire_approved',
])

export const CatalogSourceKindSchema = z.enum([
  'procedural',
  'manufacturer',
  'distributor',
]) satisfies z.ZodType<CatalogSourceKind>

// ── CatalogParam ────────────────────────────────────────────────────────
const ParamNumberSchema = z.object({
  kind: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
})
const ParamEnumSchema = z.object({
  kind: z.literal('enum'),
  values: z.array(z.union([z.number(), z.string()])),
})
const ParamStringSchema = z.object({ kind: z.literal('string') })
const ParamBoolSchema = z.object({ kind: z.literal('bool') })

export const CatalogParamTypeSchema = z.union([
  ParamNumberSchema,
  ParamEnumSchema,
  ParamStringSchema,
  ParamBoolSchema,
])

export const CatalogParamSchema: z.ZodType<CatalogParam> = z.object({
  name: z.string().min(1),
  type: CatalogParamTypeSchema,
  default: z
    .union([z.number(), z.string(), z.boolean()])
    .optional(),
  label: z.string().optional(),
  unit: z.string().optional(),
})

// ── CatalogPort ─────────────────────────────────────────────────────────
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export const CatalogPortStyleSchema = z.enum([
  'NPT_threaded',
  'grooved',
  'flanged.150',
  'flanged.300',
  'solvent_welded',
  'soldered',
  'stortz',
  'none',
])

export const CatalogPortRoleSchema = z.enum([
  'run_a',
  'run_b',
  'branch',
  'drop',
])

export const CatalogPortSchema: z.ZodType<CatalogPort> = z.object({
  name: z.string().min(1),
  position_m: Vec3Schema,
  direction: Vec3Schema,
  style: CatalogPortStyleSchema,
  size_in: z.number().positive(),
  role: CatalogPortRoleSchema,
})

export const CatalogSourceLicenseSchema: z.ZodType<CatalogSourceLicense> = z.object({
  part_ref: z.string().min(1),
  source_kind: CatalogSourceKindSchema.optional().default('procedural'),
  manufacturer: z.string().optional(),
  distributor: z.string().nullable().optional(),
  public_url: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  source_file_ref: z.string().nullable().optional(),
  terms_summary: z.string().min(1),
  allowed_internal_use: z.boolean(),
  allowed_client_render: z.boolean(),
  allowed_download: z.boolean(),
  redistribution_blocked: z.boolean(),
  source_captured_at: z.string().min(1),
  model_status: CatalogModelStatusSchema,
  approved_by: z.string().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.source_kind === 'manufacturer' && !value.manufacturer) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['manufacturer'],
      message: 'manufacturer source licenses require manufacturer',
    })
  }
  if (value.source_kind === 'distributor') {
    if (!value.manufacturer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manufacturer'],
        message: 'distributor source licenses require manufacturer',
      })
    }
    if (!value.distributor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['distributor'],
        message: 'distributor source licenses require distributor',
      })
    }
  }
  if (
    (value.source_kind === 'manufacturer' || value.source_kind === 'distributor') &&
    !value.public_url
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['public_url'],
      message: 'manufacturer/distributor source licenses require public_url',
    })
  }
  if (
    (value.source_kind === 'manufacturer' || value.source_kind === 'distributor') &&
    !value.source_url
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source_url'],
      message: 'manufacturer/distributor source licenses require source_url',
    })
  }
  if (
    (value.source_kind === 'manufacturer' || value.source_kind === 'distributor') &&
    !value.source_file_ref
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source_file_ref'],
      message: 'manufacturer/distributor source licenses require source_file_ref',
    })
  }
  if (value.source_kind === 'procedural') {
    if (value.allowed_download) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowed_download'],
        message: 'procedural source licenses cannot allow download',
      })
    }
    if (!value.redistribution_blocked) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['redistribution_blocked'],
        message: 'procedural source licenses must block redistribution',
      })
    }
  }
})

export const CatalogFamilyContractSchema: z.ZodType<CatalogFamilyContract> = z.object({
  part_ref: z.string().min(1),
  glb_path: z.string().min(1),
  ifc_path: z.string().nullable().optional(),
  dxf_path: z.string().nullable().optional(),
  model_status: CatalogModelStatusSchema,
  manufacturer_verified: z.boolean(),
  dimensions_verified: z.boolean(),
  source_license_ref: z.string().nullable().optional(),
  evidence_refs: z.array(z.string()),
}).superRefine((value, ctx) => {
  if (value.model_status === 'visual_reference') {
    if (value.manufacturer_verified || value.dimensions_verified) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'visual_reference family contracts cannot be marked verified',
      })
    }
    if (value.ifc_path || value.dxf_path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'visual_reference family contracts cannot expose IFC/DXF deliverables',
      })
    }
  }
  if (value.model_status === 'dimensioned_parametric') {
    if (value.manufacturer_verified || !value.dimensions_verified) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'dimensioned_parametric family contracts must have dimensions_verified=true and manufacturer_verified=false',
      })
    }
  }
  if (value.model_status === 'manufacturer_verified') {
    if (!value.manufacturer_verified || !value.dimensions_verified) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'manufacturer_verified family contracts must have both verification flags true',
      })
    }
    if (!value.ifc_path || !value.dxf_path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'manufacturer_verified family contracts must expose IFC and DXF deliverables',
      })
    }
  }
  if (value.model_status === 'halo_fire_approved') {
    if (!value.manufacturer_verified || !value.dimensions_verified) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'halo_fire_approved family contracts must have both verification flags true',
      })
    }
    if (!value.ifc_path || !value.dxf_path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'halo_fire_approved family contracts must expose IFC and DXF deliverables',
      })
    }
  }
})

export const CatalogSourceIngestionPolicySchema: z.ZodType<CatalogSourceIngestionPolicy> = z.object({
  allowed_sources: z.array(CatalogSourceKindSchema),
  require_public_url: z.boolean(),
  require_source_url: z.boolean(),
  require_source_file_ref: z.boolean(),
  require_terms_summary: z.boolean(),
  require_internal_use_flag: z.boolean(),
  require_client_render_flag: z.boolean(),
  require_download_flag: z.boolean(),
  require_redistribution_blocked_flag: z.boolean(),
  require_dimension_verification: z.boolean(),
  require_manufacturer_verification: z.boolean(),
  default_model_status: CatalogModelStatusSchema,
}).superRefine((value, ctx) => {
  if (value.allowed_sources.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowed_sources'],
      message: 'allowed_sources must not be empty',
    })
  }
})

// ── CatalogEntry ────────────────────────────────────────────────────────
export const CatalogEntrySchema: z.ZodType<CatalogEntry> = z.object({
  sku: z.string().min(1),
  kind: PartKindSchema,
  category: z.string(), // dotted category — not enum-restricted on purpose
  display_name: z.string().min(1),

  manufacturer: z.string().optional(),
  mfg_part_number: z.string().optional(),
  listing: z.string().optional(),
  hazard_classes: z.array(z.string()).optional(),
  model_status: CatalogModelStatusSchema.optional(),

  source_license: CatalogSourceLicenseSchema.optional(),
  family_contract: CatalogFamilyContractSchema.optional(),

  price_usd: z.number().nonnegative().optional(),
  install_minutes: z.number().nonnegative().optional(),
  crew: z.string().optional(),

  weight_kg: z.number().nonnegative().optional(),

  k_factor: z.number().positive().optional(),
  orientation: z.string().optional(),
  response: z.string().optional(),
  temperature: z.string().optional(),

  params: z.record(z.string(), CatalogParamSchema),
  ports: z.array(CatalogPortSchema),

  scad_source: z.string().min(1),
  warnings: z.array(z.string()),
})

// ── CatalogManifest (top-level envelope of catalog.json) ────────────────
export const CatalogManifestSchema: z.ZodType<CatalogManifest> = z.object({
  schema_version: z.literal(1),
  catalog_version: z.string().min(1),
  generated_at: z.string().min(1),
  parts: z.array(CatalogEntrySchema),
})

/**
 * Strict parse — throws `z.ZodError` with the offending path if the
 * JSON does not match the canonical schema. Use at catalog load time.
 */
export function parseCatalog(raw: unknown): CatalogManifest {
  return CatalogManifestSchema.parse(raw)
}

/**
 * Non-throwing variant — returns either `{ ok: true, data }` or
 * `{ ok: false, error }`. Use when you want to degrade gracefully
 * (e.g. show an on-screen error instead of crashing a viewport).
 */
export function safeParseCatalog(
  raw: unknown,
): { ok: true; data: CatalogManifest } | { ok: false; error: z.ZodError } {
  const result = CatalogManifestSchema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }
  return { ok: false, error: result.error }
}
