import { z } from 'zod'
import type { CatalogModelStatus, CatalogSourceKind } from './types.js'

export type CatalogCoverageAssetKind =
  | 'product_page'
  | 'image'
  | 'cut_sheet'
  | 'glb'
  | 'ifc'
  | 'dxf'
  | 'step'
  | 'revit'
  | 'dwg'
  | 'third_party_notice'

export type CatalogCoverageAssetStatus =
  | 'available'
  | 'missing'
  | 'blocked'
  | 'candidate'
  | 'rejected'
  | 'derived'

export type CatalogCoverageStatus =
  | 'promoted'
  | 'salvage_proxy'
  | 'visual_reference'
  | 'candidate'
  | 'rejected'

export interface CatalogCoverageAsset {
  kind: CatalogCoverageAssetKind
  status: CatalogCoverageAssetStatus
  ref?: string | null
  notes?: string | null
}

export interface CatalogSourceCollectionCoverage {
  source_id: string
  source_kind: 'open_source_step_directory'
  public_url: string
  repo_url: string
  license_spdx: string
  third_party_notice_ref: string
  capture_date: string
  redistribution_blocked: boolean
  notes: string
}

export interface CatalogCoverageRow {
  part_ref: string
  manufacturer: string
  model: string
  source_kind: CatalogSourceKind | 'open_source_step_directory'
  model_status: CatalogModelStatus
  coverage_status: CatalogCoverageStatus
  product_page_url: string | null
  product_page_capture_at: string
  source_file_ref: string | null
  source_license_ref: string
  license_summary: string
  redistribution_blocked: boolean
  third_party_notice_ref: string | null
  asset_coverage: CatalogCoverageAsset[]
  rejected_candidate_reason: string | null
  notes: string
}

export interface CatalogCoverageLedger {
  generated_at_utc: string
  scope: string
  source_collections: CatalogSourceCollectionCoverage[]
  vendor_model_coverage: CatalogCoverageRow[]
  missing_downloads: string[]
  rejected_candidates: string[]
  summary: {
    total_rows: number
    manufacturer_verified_count: number
    dimensioned_parametric_count: number
    visual_reference_count: number
    missing_download_count: number
    rejected_candidate_count: number
  }
}

const hasText = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0

export const CatalogCoverageAssetKindSchema = z.enum([
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

export const CatalogCoverageAssetStatusSchema = z.enum([
  'available',
  'missing',
  'blocked',
  'candidate',
  'rejected',
  'derived',
])

export const CatalogCoverageStatusSchema = z.enum([
  'promoted',
  'salvage_proxy',
  'visual_reference',
  'candidate',
  'rejected',
])

export const CatalogCoverageAssetSchema: z.ZodType<CatalogCoverageAsset> =
  z.object({
    kind: CatalogCoverageAssetKindSchema,
    status: CatalogCoverageAssetStatusSchema,
    ref: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })

export const CatalogSourceCollectionCoverageSchema: z.ZodType<CatalogSourceCollectionCoverage> =
  z.object({
    source_id: z.string().min(1),
    source_kind: z.literal('open_source_step_directory'),
    public_url: z.string().min(1),
    repo_url: z.string().min(1),
    license_spdx: z.string().min(1),
    third_party_notice_ref: z.string().min(1),
    capture_date: z.string().min(1),
    redistribution_blocked: z.boolean(),
    notes: z.string().min(1),
  }).superRefine((value, ctx) => {
    if (!hasText(value.public_url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['public_url'],
        message: 'step.parts source collection requires public_url',
      })
    }
    if (!hasText(value.repo_url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repo_url'],
        message: 'step.parts source collection requires repo_url',
      })
    }
  })

export const CatalogCoverageRowSchema: z.ZodType<CatalogCoverageRow> =
  z.object({
    part_ref: z.string().min(1),
    manufacturer: z.string().min(1),
    model: z.string().min(1),
    source_kind: z.union([
      z.enum(['procedural', 'manufacturer', 'distributor']),
      z.literal('open_source_step_directory'),
    ]),
    model_status: z.enum([
      'visual_reference',
      'dimensioned_parametric',
      'manufacturer_verified',
      'halo_fire_approved',
    ]),
    coverage_status: CatalogCoverageStatusSchema,
    product_page_url: z.string().nullable(),
    product_page_capture_at: z.string().min(1),
    source_file_ref: z.string().nullable(),
    source_license_ref: z.string().min(1),
    license_summary: z.string().min(1),
    redistribution_blocked: z.boolean(),
    third_party_notice_ref: z.string().nullable(),
    asset_coverage: z.array(CatalogCoverageAssetSchema),
    rejected_candidate_reason: z.string().nullable(),
    notes: z.string().min(1),
  })

export const CatalogCoverageLedgerSchema: z.ZodType<CatalogCoverageLedger> =
  z.object({
    generated_at_utc: z.string().min(1),
    scope: z.string().min(1),
    source_collections: z.array(CatalogSourceCollectionCoverageSchema),
    vendor_model_coverage: z.array(CatalogCoverageRowSchema),
    missing_downloads: z.array(z.string()),
    rejected_candidates: z.array(z.string()),
    summary: z.object({
      total_rows: z.number().int().nonnegative(),
      manufacturer_verified_count: z.number().int().nonnegative(),
      dimensioned_parametric_count: z.number().int().nonnegative(),
      visual_reference_count: z.number().int().nonnegative(),
      missing_download_count: z.number().int().nonnegative(),
      rejected_candidate_count: z.number().int().nonnegative(),
    }),
  })

export function parseCoverageLedger(raw: unknown): CatalogCoverageLedger {
  return CatalogCoverageLedgerSchema.parse(raw)
}
