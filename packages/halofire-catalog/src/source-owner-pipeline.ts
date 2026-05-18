/**
 * Typed source-owner pipeline for Stream F.
 *
 * Purpose:
 * - compose the checked-in source research seed and vendor/model
 *   coverage inputs into a replayable owner artifact
 * - validate the assembled research and coverage ledgers at entry and
 *   exit so the catalog/model owner surface stays honest
 * - keep the step.parts candidate explicit as an open-source STEP
 *   source candidate rather than manufacturer approval
 */

import { z } from 'zod'
import {
  buildCatalogComponentLibrary,
  CatalogComponentLibraryInputSchema,
  CatalogComponentLibrarySchema,
} from './component-library.js'
import {
  CatalogFamilyContractSchema,
  CatalogSourceKindSchema,
  CatalogSourceLicenseSchema,
  CatalogModelStatusSchema,
} from './schema.js'
import type {
  CatalogEngineeringApprovalInventory,
  CatalogModelFitProofRun,
} from './model-fit-proof.js'
import {
  buildCatalogEngineeringApprovalInventory,
  CatalogEngineeringApprovalInventorySchema,
  CatalogModelFitProofRunSchema,
} from './model-fit-proof.js'
import type { CatalogCoverageLedger } from './source-coverage.js'
import { CatalogCoverageLedgerSchema } from './source-coverage.js'
import type { CatalogSourceResearchLedger } from './source-research.js'
import { CatalogSourceResearchLedgerSchema, CatalogSourceResearchSeedSchema } from './source-research.js'
import {
  buildCoverageLedger,
  buildSourceResearchLedger,
} from './source-ledger.js'

const CatalogCoverageComponentInputSchema = z.object({
  key: z.string().min(1),
  glb: z.string().min(1),
  model_status: CatalogModelStatusSchema,
  source_kind: z.union([
    CatalogSourceKindSchema,
    z.literal('open_source_step_directory'),
  ]),
  source_license_ref: z.string().min(1),
  source_license: CatalogSourceLicenseSchema,
  family_contract: z
    .union([CatalogFamilyContractSchema, z.null()])
    .optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const CatalogSourcePipelineInputSchema = z.object({
  generated_at_utc: z.string().min(1).optional(),
  components: z.array(CatalogCoverageComponentInputSchema).min(1),
  source_research_seed: CatalogSourceResearchSeedSchema,
  component_library_seed: CatalogComponentLibraryInputSchema.optional(),
  model_fit_proof_run: CatalogModelFitProofRunSchema.optional(),
})

export const CatalogSourcePipelineSummarySchema = z.object({
  source_collection_count: z.number().int().nonnegative(),
  research_record_count: z.number().int().nonnegative(),
  correction_record_count: z.number().int().nonnegative(),
  source_manifest_component_count: z.number().int().nonnegative(),
  component_map_entry_count: z.number().int().nonnegative(),
  family_contract_count: z.number().int().nonnegative(),
  family_contract_ifc_count: z.number().int().nonnegative(),
  family_contract_dxf_count: z.number().int().nonnegative(),
  family_contract_manufacturer_verified_count: z.number().int().nonnegative(),
  family_contract_dimensions_verified_count: z.number().int().nonnegative(),
  coverage_row_count: z.number().int().nonnegative(),
  manufacturer_verified_count: z.number().int().nonnegative(),
  proxy_count: z.number().int().nonnegative(),
  dimensioned_parametric_count: z.number().int().nonnegative(),
  visual_reference_count: z.number().int().nonnegative(),
  sealed_approved_count: z.number().int().nonnegative(),
  missing_download_count: z.number().int().nonnegative(),
  rejected_candidate_count: z.number().int().nonnegative(),
  product_page_missing_count: z.number().int().nonnegative(),
  image_missing_count: z.number().int().nonnegative(),
  cut_sheet_missing_count: z.number().int().nonnegative(),
  glb_missing_count: z.number().int().nonnegative(),
  ifc_missing_count: z.number().int().nonnegative(),
  dxf_missing_count: z.number().int().nonnegative(),
  step_missing_count: z.number().int().nonnegative(),
  revit_missing_count: z.number().int().nonnegative(),
  dwg_missing_count: z.number().int().nonnegative(),
  third_party_notice_missing_count: z.number().int().nonnegative(),
  model_fit_proof_count: z.number().int().nonnegative(),
  review_ready_proof_count: z.number().int().nonnegative(),
  blocked_proof_count: z.number().int().nonnegative(),
  cleared_proof_count: z.number().int().nonnegative(),
  catalog_engineering_ready: z.boolean(),
  engineering_grade_ready: z.boolean(),
})

export const CatalogSourcePipelineOutputSchema = z.object({
  source_research_ledger: CatalogSourceResearchLedgerSchema,
  source_coverage_ledger: CatalogCoverageLedgerSchema,
  component_library: z.union([CatalogComponentLibrarySchema, z.null()]),
  model_fit_inventory: z.union([
    CatalogEngineeringApprovalInventorySchema,
    z.null(),
  ]),
  summary: CatalogSourcePipelineSummarySchema,
})

export type CatalogSourcePipelineInput = z.infer<
  typeof CatalogSourcePipelineInputSchema
>
export type CatalogSourcePipelineOutput = z.infer<
  typeof CatalogSourcePipelineOutputSchema
>

export function summarizeCatalogSourcePipeline(
  output: Pick<
    CatalogSourcePipelineOutput,
    | 'source_research_ledger'
    | 'source_coverage_ledger'
    | 'component_library'
    | 'model_fit_inventory'
  >,
): CatalogSourcePipelineOutput['summary'] {
  const modelFitInventory = output.model_fit_inventory ?? null
  const componentLibrary = output.component_library ?? null
  return {
    source_collection_count: output.source_research_ledger.source_collections.length,
    research_record_count: output.source_research_ledger.research_records.length,
    correction_record_count: output.source_research_ledger.correction_records.length,
    source_manifest_component_count:
      componentLibrary?.summary.source_manifest_component_count ?? 0,
    component_map_entry_count:
      componentLibrary?.summary.component_map_entry_count ?? 0,
    family_contract_count: componentLibrary?.summary.family_contract_count ?? 0,
    family_contract_ifc_count:
      componentLibrary?.summary.family_contract_ifc_count ?? 0,
    family_contract_dxf_count:
      componentLibrary?.summary.family_contract_dxf_count ?? 0,
    family_contract_manufacturer_verified_count:
      componentLibrary?.summary.family_contract_manufacturer_verified_count ?? 0,
    family_contract_dimensions_verified_count:
      componentLibrary?.summary.family_contract_dimensions_verified_count ?? 0,
    coverage_row_count: output.source_coverage_ledger.vendor_model_coverage.length,
    manufacturer_verified_count:
      output.source_coverage_ledger.summary.manufacturer_verified_count,
    proxy_count: output.source_coverage_ledger.summary.proxy_count,
    dimensioned_parametric_count:
      output.source_coverage_ledger.summary.dimensioned_parametric_count,
    visual_reference_count:
      output.source_coverage_ledger.summary.visual_reference_count,
    sealed_approved_count:
      output.source_coverage_ledger.summary.sealed_approved_count,
    missing_download_count:
      output.source_coverage_ledger.summary.missing_download_count,
    rejected_candidate_count:
      output.source_coverage_ledger.summary.rejected_candidate_count,
    product_page_missing_count:
      output.source_coverage_ledger.summary.product_page_missing_count,
    image_missing_count: output.source_coverage_ledger.summary.image_missing_count,
    cut_sheet_missing_count:
      output.source_coverage_ledger.summary.cut_sheet_missing_count,
    glb_missing_count: output.source_coverage_ledger.summary.glb_missing_count,
    ifc_missing_count: output.source_coverage_ledger.summary.ifc_missing_count,
    dxf_missing_count: output.source_coverage_ledger.summary.dxf_missing_count,
    step_missing_count: output.source_coverage_ledger.summary.step_missing_count,
    revit_missing_count: output.source_coverage_ledger.summary.revit_missing_count,
    dwg_missing_count: output.source_coverage_ledger.summary.dwg_missing_count,
    third_party_notice_missing_count:
      output.source_coverage_ledger.summary.third_party_notice_missing_count,
    model_fit_proof_count: modelFitInventory?.proof_count ?? 0,
    review_ready_proof_count: modelFitInventory?.review_ready_proof_count ?? 0,
    blocked_proof_count: modelFitInventory?.blocked_proof_count ?? 0,
    cleared_proof_count: modelFitInventory?.cleared_proof_count ?? 0,
    catalog_engineering_ready: modelFitInventory?.catalog_engineering_ready ?? false,
    engineering_grade_ready: modelFitInventory?.engineering_grade_ready ?? false,
  }
}

/**
 * Build the typed Stream F source-owner pipeline.
 *
 * The function validates the incoming seed, rebuilds the research and
 * coverage ledgers from typed inputs, validates the outputs, and returns
 * both ledgers plus a compact pipeline summary for callers that need a
 * single replayable artifact.
 */
export function buildCatalogSourcePipeline(
  rawInput: unknown,
): CatalogSourcePipelineOutput {
  const input = CatalogSourcePipelineInputSchema.parse(rawInput)
  const componentLibrary = input.component_library_seed
    ? buildCatalogComponentLibrary(input.component_library_seed)
    : null
  const sourceResearchLedger: CatalogSourceResearchLedger = buildSourceResearchLedger(
    input.source_research_seed,
  )
  const sourceCoverageLedger: CatalogCoverageLedger = buildCoverageLedger({
    generated_at_utc:
      input.generated_at_utc ?? input.source_research_seed.generated_at_utc,
    components: input.components,
    source_research: sourceResearchLedger,
  })
  const modelFitInventory: CatalogEngineeringApprovalInventory | null =
    input.model_fit_proof_run
      ? buildCatalogEngineeringApprovalInventory(input.model_fit_proof_run)
      : null

  const output = CatalogSourcePipelineOutputSchema.parse({
    source_research_ledger: sourceResearchLedger,
    source_coverage_ledger: sourceCoverageLedger,
    component_library: componentLibrary,
    model_fit_inventory: modelFitInventory,
    summary: summarizeCatalogSourcePipeline({
      source_research_ledger: sourceResearchLedger,
      source_coverage_ledger: sourceCoverageLedger,
      component_library: componentLibrary,
      model_fit_inventory: modelFitInventory,
    }),
  })

  // Guard the derived summary against drift from the coverage ledger.
  if (output.summary.coverage_row_count !== output.source_coverage_ledger.summary.total_rows) {
    throw new Error('catalog source pipeline summary drifted from coverage ledger totals')
  }
  if (output.summary.source_collection_count !== output.source_research_ledger.source_collections.length) {
    throw new Error('catalog source pipeline summary drifted from source collections')
  }
  if (output.component_library) {
    if (
      output.summary.source_manifest_component_count !==
      output.component_library.summary.source_manifest_component_count
    ) {
      throw new Error('catalog source pipeline summary drifted from component manifest count')
    }
    if (
      output.summary.component_map_entry_count !==
      output.component_library.summary.component_map_entry_count
    ) {
      throw new Error('catalog source pipeline summary drifted from component_map count')
    }
    if (
      output.summary.family_contract_count !==
      output.component_library.summary.family_contract_count
    ) {
      throw new Error('catalog source pipeline summary drifted from family contract count')
    }
  }
  if (output.model_fit_inventory) {
    if (output.summary.model_fit_proof_count !== output.model_fit_inventory.proof_count) {
      throw new Error('catalog source pipeline summary drifted from model-fit proof count')
    }
    if (output.summary.review_ready_proof_count !== output.model_fit_inventory.review_ready_proof_count) {
      throw new Error('catalog source pipeline summary drifted from model-fit review-ready count')
    }
    if (output.summary.blocked_proof_count !== output.model_fit_inventory.blocked_proof_count) {
      throw new Error('catalog source pipeline summary drifted from model-fit blocked count')
    }
    if (output.summary.cleared_proof_count !== output.model_fit_inventory.cleared_proof_count) {
      throw new Error('catalog source pipeline summary drifted from model-fit cleared count')
    }
    if (output.summary.catalog_engineering_ready !== output.model_fit_inventory.catalog_engineering_ready) {
      throw new Error('catalog source pipeline summary drifted from catalog engineering readiness')
    }
    if (output.summary.engineering_grade_ready !== output.model_fit_inventory.engineering_grade_ready) {
      throw new Error('catalog source pipeline summary drifted from engineering grade readiness')
    }
  }

  return output
}
