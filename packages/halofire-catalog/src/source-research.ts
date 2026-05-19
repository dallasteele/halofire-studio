/**
 * Typed source-research and correction workflow contracts for the
 * Halo Forge Stream F catalog owner lane.
 *
 * Purpose:
 * - capture internet-backed source research with explicit URLs and
 *   file refs
 * - preserve open-source STEP provenance as a source candidate, not
 *   manufacturer approval
 * - record correction decisions that explain why a family stayed in a
 *   lower tier or promoted to a verified tier
 *
 * Limitation:
 * - this module defines the contract and validation only; it does not
 *   fetch sources or generate geometry
 */
import { z } from 'zod'
import type { CatalogModelStatus, CatalogSourceKind } from './types.js'
import {
  CatalogSourceCollectionCoverageSchema,
  type CatalogSourceCollectionCoverage,
} from './source-coverage.js'

export type CatalogSourceResearchDisposition =
  | 'candidate'
  | 'blocked'
  | 'reviewed'
  | 'rejected'
  | 'promoted'

export type CatalogCorrectionAction =
  | 'promote_proxy'
  | 'request_source_capture'
  | 'capture_product_page'
  | 'capture_cut_sheet'
  | 'capture_image'
  | 'capture_step'
  | 'mark_missing_download'
  | 'mark_rejected_candidate'
  | 'request_human_correction'
  | 'promote_dimensioned_parametric'
  | 'promote_manufacturer_verified'
  | 'promote_sealed_approved'

export interface CatalogSourceResearchRecord {
  part_ref: string
  source_id: string
  source_kind: CatalogSourceKind | 'open_source_step_directory'
  manufacturer: string
  model: string
  public_url: string
  source_url: string
  source_file_ref: string | null
  source_license_ref: string
  source_license_spdx: string
  third_party_notice_ref: string | null
  capture_date: string
  license_summary: string
  redistribution_blocked: boolean
  model_status: CatalogModelStatus
  disposition: CatalogSourceResearchDisposition
  evidence_refs: string[]
  notes: string
}

export interface CatalogCorrectionRecord {
  part_ref: string
  source_kind: CatalogSourceKind | 'open_source_step_directory'
  from_status: CatalogModelStatus
  to_status: CatalogModelStatus
  action: CatalogCorrectionAction
  reason: string
  evidence_refs: string[]
  reviewer: string
  captured_at_utc: string
  notes: string
}

export interface CatalogSourceResearchLedger {
  generated_at_utc: string
  scope: string
  source_collections: CatalogSourceCollectionCoverage[]
  research_records: CatalogSourceResearchRecord[]
  correction_records: CatalogCorrectionRecord[]
  summary: {
    total_records: number
    candidate_count: number
    blocked_count: number
    rejected_count: number
    promoted_count: number
    correction_count: number
  }
}

const hasText = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0

export const CatalogSourceResearchDispositionSchema = z.enum([
  'candidate',
  'blocked',
  'reviewed',
  'rejected',
  'promoted',
])

export const CatalogCorrectionActionSchema = z.enum([
  'request_source_capture',
  'capture_product_page',
  'capture_cut_sheet',
  'capture_image',
  'capture_step',
  'mark_missing_download',
  'mark_rejected_candidate',
  'request_human_correction',
  'promote_proxy',
  'promote_dimensioned_parametric',
  'promote_manufacturer_verified',
  'promote_sealed_approved',
])

export const CatalogSourceResearchRecordSchema: z.ZodType<CatalogSourceResearchRecord> =
  z.object({
    part_ref: z.string().min(1),
    source_id: z.string().min(1),
    source_kind: z.union([
      z.enum(['procedural', 'manufacturer', 'distributor']),
      z.literal('open_source_step_directory'),
    ]),
    manufacturer: z.string().min(1),
    model: z.string().min(1),
    public_url: z.string().min(1),
    source_url: z.string().min(1),
    source_file_ref: z.string().nullable(),
    source_license_ref: z.string().min(1),
    source_license_spdx: z.string().min(1),
    third_party_notice_ref: z.string().nullable(),
    capture_date: z.string().min(1),
    license_summary: z.string().min(1),
    redistribution_blocked: z.boolean(),
    model_status: z.enum([
      'visual_reference',
      'proxy',
      'dimensioned_parametric',
      'manufacturer_verified',
      'sealed_approved',
    ]),
    disposition: CatalogSourceResearchDispositionSchema,
    evidence_refs: z.array(z.string()),
    notes: z.string().min(1),
  }).superRefine((value, ctx) => {
    if (!hasText(value.public_url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['public_url'],
        message: 'source research records require public_url',
      })
    }
    if (!hasText(value.source_url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_url'],
        message: 'source research records require source_url',
      })
    }
    if (!hasText(value.source_license_ref)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_license_ref'],
        message: 'source research records require source_license_ref',
      })
    }
    if (
      value.source_kind === 'procedural' &&
      value.model_status !== 'visual_reference'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model_status'],
        message: 'procedural research records must stay visual_reference',
      })
    }
    if (
      value.source_kind === 'distributor' &&
      (value.model_status === 'manufacturer_verified' ||
        value.model_status === 'sealed_approved')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model_status'],
        message:
          'distributor research records cannot self-promote to manufacturer_verified or sealed_approved',
      })
    }
    if (
      value.source_kind === 'open_source_step_directory' &&
      (value.model_status === 'manufacturer_verified' ||
        value.model_status === 'sealed_approved')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model_status'],
        message:
          'open-source STEP research records cannot claim manufacturer_verified or sealed_approved',
      })
    }
    if (
      (value.model_status === 'proxy' ||
        value.model_status === 'dimensioned_parametric' ||
        value.model_status === 'manufacturer_verified' ||
        value.model_status === 'sealed_approved') &&
      !hasText(value.source_file_ref)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_file_ref'],
        message:
          'promoted research records require a source_file_ref or captured source asset',
      })
    }
    if (
      value.source_kind === 'open_source_step_directory' &&
      !hasText(value.third_party_notice_ref)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['third_party_notice_ref'],
        message:
          'open-source STEP research records require third_party_notice_ref',
      })
    }
  })

export const CatalogCorrectionRecordSchema: z.ZodType<CatalogCorrectionRecord> =
  z.object({
    part_ref: z.string().min(1),
    source_kind: z.union([
      z.enum(['procedural', 'manufacturer', 'distributor']),
      z.literal('open_source_step_directory'),
    ]),
    from_status: z.enum([
      'visual_reference',
      'proxy',
      'dimensioned_parametric',
      'manufacturer_verified',
      'sealed_approved',
    ]),
    to_status: z.enum([
      'visual_reference',
      'proxy',
      'dimensioned_parametric',
      'manufacturer_verified',
      'sealed_approved',
    ]),
    action: CatalogCorrectionActionSchema,
    reason: z.string().min(1),
    evidence_refs: z.array(z.string()),
    reviewer: z.string().min(1),
    captured_at_utc: z.string().min(1),
    notes: z.string().min(1),
  }).superRefine((value, ctx) => {
    if (
      value.from_status === 'visual_reference' &&
      value.to_status === 'manufacturer_verified'
    ) {
      if (
        value.source_kind === 'procedural' ||
        value.source_kind === 'distributor' ||
        value.source_kind === 'open_source_step_directory'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['to_status'],
          message:
            'non-manufacturer correction records cannot jump from visual_reference to manufacturer_verified',
        })
      }
    }
    if (
      value.from_status === 'visual_reference' &&
      value.to_status === 'sealed_approved'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to_status'],
        message: 'visual_reference cannot jump directly to sealed_approved',
      })
    }
    if (value.action === 'promote_proxy' && value.to_status !== 'proxy') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['action'],
        message: 'promote_proxy corrections must end at proxy',
      })
    }
    if (
      value.from_status === 'dimensioned_parametric' &&
      value.to_status === 'manufacturer_verified' &&
      value.source_kind !== 'manufacturer'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to_status'],
        message:
          'only manufacturer-backed corrections can promote dimensioned_parametric to manufacturer_verified',
      })
    }
    if (
      value.source_kind !== 'manufacturer' &&
      value.to_status === 'sealed_approved'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to_status'],
        message: 'only manufacturer-backed correction records can reach sealed_approved',
      })
    }
    if (
      value.action === 'promote_manufacturer_verified' &&
      value.to_status !== 'manufacturer_verified'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['action'],
        message:
          'promote_manufacturer_verified corrections must end at manufacturer_verified',
      })
    }
    if (
      value.action === 'promote_sealed_approved' &&
      value.to_status !== 'sealed_approved'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['action'],
        message: 'promote_sealed_approved corrections must end at sealed_approved',
      })
    }
    if (
      value.action === 'promote_manufacturer_verified' &&
      value.source_kind !== 'manufacturer'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_kind'],
        message:
          'only manufacturer-backed corrections can promote to manufacturer_verified',
      })
    }
    if (
      value.action === 'promote_sealed_approved' &&
      value.source_kind !== 'manufacturer'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_kind'],
        message: 'only manufacturer-backed corrections can promote to sealed_approved',
      })
    }
    if (
      value.from_status === 'dimensioned_parametric' &&
      value.to_status === 'sealed_approved'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to_status'],
        message: 'dimensioned_parametric cannot jump directly to sealed_approved',
      })
    }
    if (value.evidence_refs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence_refs'],
        message: 'correction records require at least one evidence ref',
      })
    }
  })

export const CatalogSourceResearchLedgerSchema: z.ZodType<CatalogSourceResearchLedger> =
  z.object({
    generated_at_utc: z.string().min(1),
    scope: z.string().min(1),
    source_collections: z.array(CatalogSourceCollectionCoverageSchema),
    research_records: z.array(CatalogSourceResearchRecordSchema),
    correction_records: z.array(CatalogCorrectionRecordSchema),
    summary: z.object({
      total_records: z.number().int().nonnegative(),
      candidate_count: z.number().int().nonnegative(),
      blocked_count: z.number().int().nonnegative(),
      rejected_count: z.number().int().nonnegative(),
      promoted_count: z.number().int().nonnegative(),
      correction_count: z.number().int().nonnegative(),
    }),
  })

export type CatalogSourceResearchSeed = Omit<
  CatalogSourceResearchLedger,
  'summary'
>

export const CatalogSourceResearchSeedSchema: z.ZodType<CatalogSourceResearchSeed> = (
  CatalogSourceResearchLedgerSchema as unknown as z.AnyZodObject
).omit({ summary: true }) as unknown as z.ZodType<CatalogSourceResearchSeed>

export function summarizeSourceResearchLedger(
  ledger: Pick<CatalogSourceResearchLedger, 'research_records' | 'correction_records'>,
): CatalogSourceResearchLedger['summary'] {
  return {
    total_records: ledger.research_records.length,
    candidate_count: ledger.research_records.filter(
      (record) => record.disposition === 'candidate',
    ).length,
    blocked_count: ledger.research_records.filter(
      (record) => record.disposition === 'blocked',
    ).length,
    rejected_count: ledger.research_records.filter(
      (record) => record.disposition === 'rejected',
    ).length,
    promoted_count: ledger.research_records.filter(
      (record) => record.disposition === 'promoted',
    ).length,
    correction_count: ledger.correction_records.length,
  }
}

export function parseSourceResearchLedger(raw: unknown): CatalogSourceResearchLedger {
  return CatalogSourceResearchLedgerSchema.parse(raw)
}
