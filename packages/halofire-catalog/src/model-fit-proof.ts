/**
 * Typed model-fit proof and catalog engineering approval inventory.
 *
 * Purpose:
 * - validate the proof rows generated for source-linked catalog families
 * - keep the approval gate explicit until reviewer or comparator decisions exist
 * - expose a workbench-friendly inventory that surfaces missing decisions,
 *   blocked claims, and the exact next action
 *
 * Limitation:
 * - these proofs are review artifacts, not approval by themselves
 */

import { z } from 'zod'
import { CatalogSourceKindSchema } from './schema.js'
import type { CatalogSourceKind } from './types.js'

const REQUIRED_REVIEWER_DECISIONS = [
  'dimension_match',
  'model_geometry_match',
  'source_license_acceptance',
  'approved_for_catalog_engineering',
] as const

export type CatalogModelFitReviewerDecisionKey =
  (typeof REQUIRED_REVIEWER_DECISIONS)[number]

export type CatalogModelFitProofStatus = 'blocked' | 'review_ready' | 'approved'

export type CatalogModelFitCheckStatus = 'pass' | 'fail'

export interface CatalogModelFitReviewerDecision {
  decision: CatalogModelFitReviewerDecisionKey
  reviewer: string
  decided_at_utc: string
  notes: string
}

export interface CatalogModelFitProofIssue {
  code: string
  severity: 'info' | 'warning' | 'error' | 'blocking'
  message: string
  refs: string[]
}

export interface CatalogModelFitProofArtifact {
  ref: string
  path: string
  role: string
  media_type: string
  sha256: string
  source_refs: string[]
  capability: string
}

export interface CatalogModelFitProofManifest {
  artifacts: CatalogModelFitProofArtifact[]
  capabilities: string[]
  warnings: string[]
  issues: CatalogModelFitProofIssue[]
}

export interface CatalogModelFitProof {
  proof_ref: string
  acquisition_record_ref: string
  family_ref: string
  part_ref: string
  proof_status: CatalogModelFitProofStatus
  source_kind: CatalogSourceKind
  manufacturer: string
  model: string
  public_url: string
  source_url: string
  source_file_ref: string
  source_file_sha256: string
  local_artifact_hashes: {
    glb: string
    ifc: string
    dxf: string
  }
  fit_checks: Record<
    | 'public_url_present'
    | 'source_url_present'
    | 'source_file_hash_present'
    | 'manufacturer_source_present'
    | 'local_glb_hash_present'
    | 'local_ifc_hash_present'
    | 'local_dxf_hash_present'
    | 'claim_gate_preserved',
    CatalogModelFitCheckStatus
  >
  required_reviewer_decisions: CatalogModelFitReviewerDecisionKey[]
  reviewer_decisions?: CatalogModelFitReviewerDecision[]
  model_fit_claim: string
  clears_catalog_engineering_claim: boolean
  blocked_claims: string[]
  claim_gate_policy: string
  source_refs: string[]
}

export interface CatalogModelFitProofRun {
  schema_version: string
  bid_id: string
  catalog_source_acquisition_output_ref: string
  catalog_engineering_ready: boolean
  engineering_grade_ready: boolean
  proofs: CatalogModelFitProof[]
  summary: CatalogModelFitProofRunSummary
  issues: CatalogModelFitProofIssue[]
  manifest: CatalogModelFitProofManifest
}

export interface CatalogModelFitProofRunSummary {
  proof_count: number
  review_ready_proof_count: number
  blocked_proof_count: number
  source_hash_ready_count: number
  local_artifact_hash_ready_count: number
  claims_cleared_count: number
  catalog_engineering_ready: boolean
  engineering_grade_ready: boolean
}

export interface CatalogModelFitWorkbenchRow {
  proof_ref: string
  family_ref: string
  part_ref: string
  source_kind: CatalogSourceKind
  manufacturer: string
  model: string
  public_url: string
  source_url: string
  source_file_ref: string
  source_file_sha256: string
  local_artifact_hashes: CatalogModelFitProof['local_artifact_hashes']
  fit_checks: CatalogModelFitProof['fit_checks']
  required_reviewer_decisions: CatalogModelFitReviewerDecisionKey[]
  reviewer_decisions: CatalogModelFitReviewerDecision[]
  missing_reviewer_decisions: CatalogModelFitReviewerDecisionKey[]
  blocked_claims: string[]
  proof_status: CatalogModelFitProofStatus
  clears_catalog_engineering_claim: boolean
  next_action: string
}

export interface CatalogEngineeringApprovalInventory {
  schema_version: string
  bid_id: string
  proof_count: number
  review_ready_proof_count: number
  blocked_proof_count: number
  approved_proof_count: number
  cleared_proof_count: number
  catalog_engineering_ready: boolean
  engineering_grade_ready: boolean
  blocked_claims: string[]
  rows: CatalogModelFitWorkbenchRow[]
  issues: CatalogModelFitProofIssue[]
  next_action: string
}

const hasText = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0

const CatalogModelFitReviewerDecisionKeySchema = z.enum(
  REQUIRED_REVIEWER_DECISIONS,
)

export const CatalogModelFitProofStatusSchema = z.enum([
  'blocked',
  'review_ready',
  'approved',
])

export const CatalogModelFitCheckStatusSchema = z.enum(['pass', 'fail'])

export const CatalogModelFitReviewerDecisionSchema: z.ZodType<CatalogModelFitReviewerDecision> =
  z.object({
    decision: CatalogModelFitReviewerDecisionKeySchema,
    reviewer: z.string().min(1),
    decided_at_utc: z.string().min(1),
    notes: z.string().min(1),
  })

export const CatalogModelFitProofIssueSchema: z.ZodType<CatalogModelFitProofIssue> =
  z.object({
    code: z.string().min(1),
    severity: z.enum(['info', 'warning', 'error', 'blocking']),
    message: z.string().min(1),
    refs: z.array(z.string()),
  })

export const CatalogModelFitProofArtifactSchema: z.ZodType<CatalogModelFitProofArtifact> =
  z.object({
    ref: z.string().min(1),
    path: z.string().min(1),
    role: z.string().min(1),
    media_type: z.string().min(1),
    sha256: z.string().min(1),
    source_refs: z.array(z.string()),
    capability: z.string().min(1),
  })

export const CatalogModelFitProofManifestSchema: z.ZodType<CatalogModelFitProofManifest> =
  z.object({
    artifacts: z.array(CatalogModelFitProofArtifactSchema),
    capabilities: z.array(z.string()),
    warnings: z.array(z.string()),
    issues: z.array(CatalogModelFitProofIssueSchema),
  })

export const CatalogModelFitProofSchema: z.ZodType<CatalogModelFitProof> =
  z.object({
    proof_ref: z.string().min(1),
    acquisition_record_ref: z.string().min(1),
    family_ref: z.string().min(1),
    part_ref: z.string().min(1),
    proof_status: CatalogModelFitProofStatusSchema,
    source_kind: CatalogSourceKindSchema,
    manufacturer: z.string().min(1),
    model: z.string().min(1),
    public_url: z.string().min(1),
    source_url: z.string().min(1),
    source_file_ref: z.string().min(1),
    source_file_sha256: z.string().min(1),
    local_artifact_hashes: z.object({
      glb: z.string().min(1),
      ifc: z.string().min(1),
      dxf: z.string().min(1),
    }),
    fit_checks: z.object({
      public_url_present: CatalogModelFitCheckStatusSchema,
      source_url_present: CatalogModelFitCheckStatusSchema,
      source_file_hash_present: CatalogModelFitCheckStatusSchema,
      manufacturer_source_present: CatalogModelFitCheckStatusSchema,
      local_glb_hash_present: CatalogModelFitCheckStatusSchema,
      local_ifc_hash_present: CatalogModelFitCheckStatusSchema,
      local_dxf_hash_present: CatalogModelFitCheckStatusSchema,
      claim_gate_preserved: CatalogModelFitCheckStatusSchema,
    }),
    required_reviewer_decisions: z.array(
      CatalogModelFitReviewerDecisionKeySchema,
    ),
    reviewer_decisions: z.array(CatalogModelFitReviewerDecisionSchema).optional(),
    model_fit_claim: z.string().min(1),
    clears_catalog_engineering_claim: z.boolean(),
    blocked_claims: z.array(z.string()),
    claim_gate_policy: z.string().min(1),
    source_refs: z.array(z.string()),
  }).superRefine((value, ctx) => {
    if (!hasText(value.public_url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['public_url'],
        message: 'model-fit proofs require public_url',
      })
    }
    if (!hasText(value.source_url)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_url'],
        message: 'model-fit proofs require source_url',
      })
    }
    if (!hasText(value.source_file_ref)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_file_ref'],
        message: 'model-fit proofs require source_file_ref',
      })
    }
    if (!hasText(value.source_file_sha256)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_file_sha256'],
        message: 'model-fit proofs require source_file_sha256',
      })
    }
    if (value.required_reviewer_decisions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['required_reviewer_decisions'],
        message: 'model-fit proofs require at least one reviewer decision',
      })
    }
    if (!hasText(value.model_fit_claim)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model_fit_claim'],
        message: 'model-fit proofs require a claim summary',
      })
    }
    if (!hasText(value.claim_gate_policy)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claim_gate_policy'],
        message: 'model-fit proofs require a claim gate policy',
      })
    }
    if (value.source_refs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_refs'],
        message: 'model-fit proofs require source_refs',
      })
    }
    if (
      value.clears_catalog_engineering_claim &&
      (!value.reviewer_decisions || value.reviewer_decisions.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clears_catalog_engineering_claim'],
        message:
          'catalog engineering claims cannot clear without reviewer_decisions',
      })
    }
  })

export const CatalogModelFitProofRunSummarySchema: z.ZodType<CatalogModelFitProofRunSummary> =
  z.object({
    proof_count: z.number().int().nonnegative(),
    review_ready_proof_count: z.number().int().nonnegative(),
    blocked_proof_count: z.number().int().nonnegative(),
    source_hash_ready_count: z.number().int().nonnegative(),
    local_artifact_hash_ready_count: z.number().int().nonnegative(),
    claims_cleared_count: z.number().int().nonnegative(),
    catalog_engineering_ready: z.boolean(),
    engineering_grade_ready: z.boolean(),
  })

export const CatalogModelFitProofRunSchema: z.ZodType<CatalogModelFitProofRun> =
  z.object({
    schema_version: z.string().min(1),
    bid_id: z.string().min(1),
    catalog_source_acquisition_output_ref: z.string().min(1),
    catalog_engineering_ready: z.boolean(),
    engineering_grade_ready: z.boolean(),
    proofs: z.array(CatalogModelFitProofSchema),
    summary: CatalogModelFitProofRunSummarySchema,
    issues: z.array(CatalogModelFitProofIssueSchema),
    manifest: CatalogModelFitProofManifestSchema,
  })

export const CatalogModelFitWorkbenchRowSchema: z.ZodType<CatalogModelFitWorkbenchRow> =
  z.object({
    proof_ref: z.string().min(1),
    family_ref: z.string().min(1),
    part_ref: z.string().min(1),
    source_kind: CatalogSourceKindSchema,
    manufacturer: z.string().min(1),
    model: z.string().min(1),
    public_url: z.string().min(1),
    source_url: z.string().min(1),
    source_file_ref: z.string().min(1),
    source_file_sha256: z.string().min(1),
    local_artifact_hashes: z.object({
      glb: z.string().min(1),
      ifc: z.string().min(1),
      dxf: z.string().min(1),
    }),
    fit_checks: z.object({
      public_url_present: CatalogModelFitCheckStatusSchema,
      source_url_present: CatalogModelFitCheckStatusSchema,
      source_file_hash_present: CatalogModelFitCheckStatusSchema,
      manufacturer_source_present: CatalogModelFitCheckStatusSchema,
      local_glb_hash_present: CatalogModelFitCheckStatusSchema,
      local_ifc_hash_present: CatalogModelFitCheckStatusSchema,
      local_dxf_hash_present: CatalogModelFitCheckStatusSchema,
      claim_gate_preserved: CatalogModelFitCheckStatusSchema,
    }),
    required_reviewer_decisions: z.array(
      CatalogModelFitReviewerDecisionKeySchema,
    ),
    reviewer_decisions: z.array(CatalogModelFitReviewerDecisionSchema),
    missing_reviewer_decisions: z.array(
      CatalogModelFitReviewerDecisionKeySchema,
    ),
    blocked_claims: z.array(z.string()),
    proof_status: CatalogModelFitProofStatusSchema,
    clears_catalog_engineering_claim: z.boolean(),
    next_action: z.string().min(1),
  })

export const CatalogEngineeringApprovalInventorySchema: z.ZodType<CatalogEngineeringApprovalInventory> =
  z.object({
    schema_version: z.string().min(1),
    bid_id: z.string().min(1),
    proof_count: z.number().int().nonnegative(),
    review_ready_proof_count: z.number().int().nonnegative(),
    blocked_proof_count: z.number().int().nonnegative(),
    approved_proof_count: z.number().int().nonnegative(),
    cleared_proof_count: z.number().int().nonnegative(),
    catalog_engineering_ready: z.boolean(),
    engineering_grade_ready: z.boolean(),
    blocked_claims: z.array(z.string()),
    rows: z.array(CatalogModelFitWorkbenchRowSchema),
    issues: z.array(CatalogModelFitProofIssueSchema),
    next_action: z.string().min(1),
  })

function summarizeProofs(
  proofs: CatalogModelFitProof[],
): CatalogModelFitProofRunSummary {
  const reviewReadyCount = proofs.filter(
    (proof) => proof.proof_status === 'review_ready',
  ).length
  const blockedCount = proofs.filter((proof) => proof.proof_status === 'blocked').length
  const sourceHashReadyCount = proofs.filter(
    (proof) =>
      proof.fit_checks.public_url_present === 'pass' &&
      proof.fit_checks.source_url_present === 'pass' &&
      proof.fit_checks.source_file_hash_present === 'pass' &&
      proof.fit_checks.manufacturer_source_present === 'pass',
  ).length
  const localArtifactHashReadyCount = proofs.filter(
    (proof) =>
      proof.fit_checks.local_glb_hash_present === 'pass' &&
      proof.fit_checks.local_ifc_hash_present === 'pass' &&
      proof.fit_checks.local_dxf_hash_present === 'pass',
  ).length
  const claimsClearedCount = proofs.filter(
    (proof) => proof.clears_catalog_engineering_claim,
  ).length

  return {
    proof_count: proofs.length,
    review_ready_proof_count: reviewReadyCount,
    blocked_proof_count: blockedCount,
    source_hash_ready_count: sourceHashReadyCount,
    local_artifact_hash_ready_count: localArtifactHashReadyCount,
    claims_cleared_count: claimsClearedCount,
    catalog_engineering_ready: claimsClearedCount > 0 && blockedCount === 0,
    engineering_grade_ready: false,
  }
}

function reviewerDecisionMap(
  decisions: CatalogModelFitReviewerDecision[] | undefined,
): Map<CatalogModelFitReviewerDecisionKey, CatalogModelFitReviewerDecision> {
  return new Map((decisions ?? []).map((decision) => [decision.decision, decision]))
}

function nextActionFor(
  proof: CatalogModelFitProof,
  missingReviewerDecisions: CatalogModelFitReviewerDecisionKey[],
): string {
  if (proof.clears_catalog_engineering_claim) {
    return 'No action required; catalog engineering claim already clears.'
  }
  if (missingReviewerDecisions.length > 0) {
    return `Await reviewer decisions: ${missingReviewerDecisions.join(', ')}`
  }
  return 'Route the proof row to the upstream approval inventory for catalog engineering review.'
}

export function summarizeCatalogModelFitProofRun(
  run: Pick<CatalogModelFitProofRun, 'proofs'>,
): CatalogModelFitProofRunSummary {
  return summarizeProofs(run.proofs)
}

export function buildCatalogEngineeringApprovalInventory(
  rawInput: unknown,
): CatalogEngineeringApprovalInventory {
  const run = CatalogModelFitProofRunSchema.parse(rawInput)
  const summary = summarizeProofs(run.proofs)
  const rows = run.proofs.map((proof) => {
    const decisions = reviewerDecisionMap(proof.reviewer_decisions)
    const missingReviewerDecisions = proof.required_reviewer_decisions.filter(
      (decision) => !decisions.has(decision),
    )
    return {
      proof_ref: proof.proof_ref,
      family_ref: proof.family_ref,
      part_ref: proof.part_ref,
      source_kind: proof.source_kind,
      manufacturer: proof.manufacturer,
      model: proof.model,
      public_url: proof.public_url,
      source_url: proof.source_url,
      source_file_ref: proof.source_file_ref,
      source_file_sha256: proof.source_file_sha256,
      local_artifact_hashes: proof.local_artifact_hashes,
      fit_checks: proof.fit_checks,
      required_reviewer_decisions: proof.required_reviewer_decisions,
      reviewer_decisions: proof.reviewer_decisions ?? [],
      missing_reviewer_decisions: missingReviewerDecisions,
      blocked_claims: proof.blocked_claims,
      proof_status: proof.proof_status,
      clears_catalog_engineering_claim:
        proof.clears_catalog_engineering_claim &&
        missingReviewerDecisions.length === 0,
      next_action: nextActionFor(proof, missingReviewerDecisions),
    }
  })

  const blockedClaims = new Set<string>()
  for (const row of rows) {
    for (const claim of row.blocked_claims) {
      blockedClaims.add(claim)
    }
  }

  const inventory: CatalogEngineeringApprovalInventory = {
    schema_version: run.schema_version,
    bid_id: run.bid_id,
    proof_count: run.proofs.length,
    review_ready_proof_count: summary.review_ready_proof_count,
    blocked_proof_count: summary.blocked_proof_count,
    approved_proof_count: run.proofs.filter(
      (proof) => proof.proof_status === 'approved',
    ).length,
    cleared_proof_count: rows.filter(
      (row) => row.clears_catalog_engineering_claim,
    ).length,
    catalog_engineering_ready:
      rows.some((row) => row.clears_catalog_engineering_claim) &&
      rows.every((row) => row.missing_reviewer_decisions.length === 0),
    engineering_grade_ready: run.engineering_grade_ready,
    blocked_claims: Array.from(blockedClaims).sort(),
    rows,
    issues: run.issues,
    next_action:
      rows.find((row) => row.next_action.length > 0)?.next_action ??
      'No model-fit proof rows were found.',
  }

  return CatalogEngineeringApprovalInventorySchema.parse(inventory)
}

export const CATALOG_MODEL_FIT_REQUIRED_REVIEWER_DECISIONS =
  REQUIRED_REVIEWER_DECISIONS

