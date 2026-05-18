/**
 * Typed builders for the Stream F source research and coverage ledgers.
 *
 * Purpose:
 * - keep the checked-in `source_research_ledger.json` and
 *   `source_coverage_ledger.json` replayable from typed inputs
 * - preserve step.parts as an open-source STEP candidate only
 * - keep distributor/manufacturer salvage, family contracts, and missing
 *   downloads explicit instead of implied
 *
 * This file mirrors the root Python generators so the catalog package has a
 * first-class, typed contract for the same ledger logic.
 */

import type {
  CatalogFamilyContract,
  CatalogModelStatus,
  CatalogSourceKind,
  CatalogSourceLicense,
} from './types.js'
import {
  summarizeSourceResearchLedger,
  type CatalogSourceResearchLedger,
  type CatalogSourceResearchSeed,
  type CatalogSourceResearchRecord,
} from './source-research.js'
import type {
  CatalogCoverageLedger,
  CatalogCoverageRow,
  CatalogCoverageAsset,
  CatalogSourceCollectionCoverage,
} from './source-coverage.js'

export interface CatalogCoverageComponentInput {
  key: string
  glb: string
  model_status: CatalogModelStatus
  source_kind: CatalogSourceKind | 'open_source_step_directory'
  source_license_ref: string
  source_license: CatalogSourceLicense
  family_contract?: CatalogFamilyContract | null
  manufacturer?: string | null
  model?: string | null
  notes?: string | null
}

export interface CatalogCoverageLedgerInput {
  generated_at_utc?: string
  components: CatalogCoverageComponentInput[]
  source_research: Pick<
    CatalogSourceResearchLedger,
    'source_collections' | 'research_records' | 'correction_records'
  >
}

const hasText = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0

const COVERAGE_DOWNLOAD_KINDS = new Set<CatalogCoverageAsset['kind']>([
  'product_page',
  'image',
  'cut_sheet',
  'ifc',
  'dxf',
  'step',
  'revit',
  'dwg',
  'third_party_notice',
])

type CatalogCoverageMissingSummary = {
  product_page_missing_count: number
  image_missing_count: number
  cut_sheet_missing_count: number
  glb_missing_count: number
  ifc_missing_count: number
  dxf_missing_count: number
  step_missing_count: number
  revit_missing_count: number
  dwg_missing_count: number
  third_party_notice_missing_count: number
}

function countMissingByKind(
  rows: CatalogCoverageRow[],
): CatalogCoverageMissingSummary {
  const counts: CatalogCoverageMissingSummary = {
    product_page_missing_count: 0,
    image_missing_count: 0,
    cut_sheet_missing_count: 0,
    glb_missing_count: 0,
    ifc_missing_count: 0,
    dxf_missing_count: 0,
    step_missing_count: 0,
    revit_missing_count: 0,
    dwg_missing_count: 0,
    third_party_notice_missing_count: 0,
  }

  for (const row of rows) {
    for (const asset of row.asset_coverage) {
      if (asset.status === 'missing') {
        counts[`${asset.kind}_missing_count` as const] += 1
      }
    }
  }

  return counts
}

export function summarizeCoverageLedger(
  ledger: Pick<CatalogCoverageLedger, 'vendor_model_coverage' | 'missing_downloads' | 'rejected_candidates'>,
): CatalogCoverageLedger['summary'] {
  return {
    total_rows: ledger.vendor_model_coverage.length,
    manufacturer_verified_count: ledger.vendor_model_coverage.filter(
      (row) => row.model_status === 'manufacturer_verified',
    ).length,
    proxy_count: ledger.vendor_model_coverage.filter(
      (row) => row.model_status === 'proxy',
    ).length,
    dimensioned_parametric_count: ledger.vendor_model_coverage.filter(
      (row) => row.model_status === 'dimensioned_parametric',
    ).length,
    visual_reference_count: ledger.vendor_model_coverage.filter(
      (row) => row.model_status === 'visual_reference',
    ).length,
    sealed_approved_count: ledger.vendor_model_coverage.filter(
      (row) => row.model_status === 'sealed_approved',
    ).length,
    missing_download_count: ledger.missing_downloads.length,
    rejected_candidate_count: ledger.rejected_candidates.length,
    ...countMissingByKind(ledger.vendor_model_coverage),
  }
}

export function buildSourceResearchLedger(
  seed: CatalogSourceResearchSeed,
): CatalogSourceResearchLedger {
  return {
    ...seed,
    summary: summarizeSourceResearchLedger(seed),
  }
}

export function buildSourceCollectionCoverage(
  sourceCollections: CatalogSourceCollectionCoverage[],
): CatalogSourceCollectionCoverage[] {
  return sourceCollections.map((collection) => ({ ...collection }))
}

function coverageStatusFor(component: CatalogCoverageComponentInput): CatalogCoverageRow['coverage_status'] {
  if (
    component.model_status === 'manufacturer_verified' ||
    component.model_status === 'sealed_approved'
  ) {
    return 'promoted'
  }
  if (
    component.model_status === 'proxy' ||
    component.model_status === 'dimensioned_parametric'
  ) {
    return 'salvage_proxy'
  }
  if (component.source_kind === 'procedural') {
    return 'visual_reference'
  }
  return 'candidate'
}

function rejectedReasonFor(component: CatalogCoverageComponentInput): string | null {
  if (
    component.model_status === 'manufacturer_verified' ||
    component.model_status === 'sealed_approved'
  ) {
    return null
  }
  if (component.source_kind === 'open_source_step_directory') {
    return 'Open-source STEP directory assets remain proxy candidates until provenance proves the exact product or authority.'
  }
  if (component.source_kind === 'distributor') {
    return 'Distributor-backed salvage remains a proxy until a manufacturer evidence path exists.'
  }
  if (component.source_kind === 'procedural') {
    return 'In-house procedural geometry is visual_reference only until manufacturer or distributor provenance is added.'
  }
  return 'Source metadata is incomplete or still candidate-only.'
}

function buildAssetCoverage(
  component: CatalogCoverageComponentInput,
): CatalogCoverageAsset[] {
  const sourceUrl =
    component.source_license.source_url ?? component.source_license.public_url
  const sourceFileRef = component.source_license.source_file_ref
  const familyContract = component.family_contract

  const assetCoverage: CatalogCoverageAsset[] = [
    {
      kind: 'product_page',
      status: sourceUrl ? 'available' : 'missing',
      ref: sourceUrl,
      notes: 'Manufacturer/distributor page or procedural source record',
    },
    {
      kind: 'image',
      status: 'missing',
      ref: null,
      notes: 'No explicit upstream product-image URL was captured',
    },
    {
      kind: 'cut_sheet',
      status:
        component.source_kind !== 'procedural' && hasText(sourceFileRef)
          ? 'available'
          : 'missing',
      ref: sourceFileRef,
      notes: 'Source cut sheet or local source file ref',
    },
    {
      kind: 'glb',
      status: hasText(component.glb) ? 'available' : 'missing',
      ref: component.glb,
      notes: 'Internal preview or authored GLB artifact',
    },
    {
      kind: 'ifc',
      status: hasText(familyContract?.ifc_path) ? 'available' : 'missing',
      ref: familyContract?.ifc_path ?? null,
      notes: 'Downstream BIM deliverable',
    },
    {
      kind: 'dxf',
      status: hasText(familyContract?.dxf_path) ? 'available' : 'missing',
      ref: familyContract?.dxf_path ?? null,
      notes: 'Downstream CAD deliverable',
    },
    {
      kind: 'step',
      status:
        component.source_kind === 'open_source_step_directory'
          ? 'available'
          : 'missing',
      ref: null,
      notes: 'Open-source STEP source candidate coverage',
    },
    {
      kind: 'revit',
      status: 'missing',
      ref: null,
      notes: 'No explicit Revit asset was captured',
    },
    {
      kind: 'dwg',
      status: 'missing',
      ref: null,
      notes: 'No explicit DWG asset was captured',
    },
    {
      kind: 'third_party_notice',
      status:
        component.source_kind === 'open_source_step_directory'
          ? 'available'
          : 'missing',
      ref:
        component.source_kind === 'open_source_step_directory'
          ? 'THIRD_PARTY_NOTICES.md'
          : null,
      notes: 'Explicit third-party notice tracking for open-source STEP sources',
    },
  ]

  if (component.model_status === 'manufacturer_verified') {
    const ifcAsset = assetCoverage[4]
    const dxfAsset = assetCoverage[5]
    assetCoverage[4] = {
      kind: 'ifc',
      status: ifcAsset?.status ?? 'missing',
      ref: ifcAsset?.ref ?? null,
      notes: 'Manufacturer-verified IFC proxy',
    }
    assetCoverage[5] = {
      kind: 'dxf',
      status: dxfAsset?.status ?? 'missing',
      ref: dxfAsset?.ref ?? null,
      notes: 'Manufacturer-verified DXF proxy',
    }
  } else if (component.model_status === 'proxy') {
    const ifcAsset = assetCoverage[4]
    const dxfAsset = assetCoverage[5]
    assetCoverage[4] = {
      kind: 'ifc',
      status: ifcAsset?.status ?? 'missing',
      ref: ifcAsset?.ref ?? null,
      notes: 'Proxy IFC placeholder only; IFC missing until dimensioned parametric review',
    }
    assetCoverage[5] = {
      kind: 'dxf',
      status: dxfAsset?.status ?? 'missing',
      ref: dxfAsset?.ref ?? null,
      notes: 'Proxy DXF placeholder only; DXF missing until dimensioned parametric review',
    }
  } else if (component.model_status === 'dimensioned_parametric') {
    const ifcAsset = assetCoverage[4]
    const dxfAsset = assetCoverage[5]
    assetCoverage[4] = {
      kind: 'ifc',
      status: ifcAsset?.status ?? 'missing',
      ref: ifcAsset?.ref ?? null,
      notes: 'Dimensioned parametric IFC proxy',
    }
    assetCoverage[5] = {
      kind: 'dxf',
      status: dxfAsset?.status ?? 'missing',
      ref: dxfAsset?.ref ?? null,
      notes: 'Dimensioned parametric DXF proxy',
    }
  } else if (component.model_status === 'visual_reference') {
    const ifcAsset = assetCoverage[4]
    const dxfAsset = assetCoverage[5]
    assetCoverage[4] = {
      kind: 'ifc',
      status: ifcAsset?.status ?? 'missing',
      ref: ifcAsset?.ref ?? null,
      notes: 'Visual-reference placeholder only; IFC missing by policy',
    }
    assetCoverage[5] = {
      kind: 'dxf',
      status: dxfAsset?.status ?? 'missing',
      ref: dxfAsset?.ref ?? null,
      notes: 'Visual-reference placeholder only; DXF missing by policy',
    }
  }

  return assetCoverage
}

function buildStepPartsAssetCoverage(
  record: CatalogSourceResearchRecord,
): CatalogCoverageAsset[] {
  return [
    {
      kind: 'product_page',
      status: record.public_url ? 'available' : 'missing',
      ref: record.public_url,
      notes: 'Open-source STEP directory product page',
    },
    {
      kind: 'image',
      status: 'missing',
      ref: null,
      notes: 'No explicit upstream product-image URL was captured',
    },
    {
      kind: 'cut_sheet',
      status: 'missing',
      ref: null,
      notes: 'Open-source STEP candidate does not ship a cut sheet',
    },
    {
      kind: 'glb',
      status: 'missing',
      ref: null,
      notes: 'No checked-in GLB has been generated from the STEP proxy candidate yet',
    },
    {
      kind: 'ifc',
      status: 'missing',
      ref: null,
      notes: 'Open-source STEP candidate has not been promoted to IFC',
    },
    {
      kind: 'dxf',
      status: 'missing',
      ref: null,
      notes: 'Open-source STEP candidate has not been promoted to DXF',
    },
    {
      kind: 'step',
      status: hasText(record.source_file_ref) ? 'available' : 'missing',
      ref: record.source_file_ref,
      notes: 'Locally ingested open-source STEP proxy sample',
    },
    {
      kind: 'revit',
      status: 'missing',
      ref: null,
      notes: 'No explicit Revit asset was captured',
    },
    {
      kind: 'dwg',
      status: 'missing',
      ref: null,
      notes: 'No explicit DWG asset was captured',
    },
    {
      kind: 'third_party_notice',
      status: hasText(record.third_party_notice_ref) ? 'available' : 'missing',
      ref: record.third_party_notice_ref,
      notes: 'Explicit third-party notice tracking for open-source STEP sources',
    },
  ]
}

function buildCoverageRow(component: CatalogCoverageComponentInput): CatalogCoverageRow {
  return {
    part_ref: component.key,
    manufacturer:
      component.source_license.manufacturer ?? component.manufacturer ?? 'unknown',
    model:
      component.model ?? component.source_license.source_file_ref ?? component.key,
    source_kind: component.source_kind,
    model_status: component.model_status,
    coverage_status: coverageStatusFor(component),
    product_page_url:
      component.source_license.source_url ?? component.source_license.public_url ?? null,
    product_page_capture_at: component.source_license.source_captured_at,
    source_file_ref: component.source_license.source_file_ref ?? null,
    source_license_ref: component.source_license_ref,
    license_summary: component.source_license.terms_summary,
    redistribution_blocked: component.source_license.redistribution_blocked,
    third_party_notice_ref: null,
    asset_coverage: buildAssetCoverage(component),
    rejected_candidate_reason: rejectedReasonFor(component),
    notes: hasText(component.notes) ? component.notes : component.key,
  }
}

function buildOpenSourceStepCoverageRow(
  record: CatalogSourceResearchRecord,
): CatalogCoverageRow {
  return {
    part_ref: record.part_ref,
    manufacturer: record.manufacturer,
    model: record.model,
    source_kind: 'open_source_step_directory',
    model_status: record.model_status,
    coverage_status: 'salvage_proxy',
    product_page_url: record.public_url,
    product_page_capture_at: record.capture_date,
    source_file_ref: record.source_file_ref,
    source_license_ref: `license:${record.part_ref}`,
    license_summary: record.license_summary,
    redistribution_blocked: record.redistribution_blocked,
    third_party_notice_ref: record.third_party_notice_ref ?? null,
    asset_coverage: buildStepPartsAssetCoverage(record),
    rejected_candidate_reason:
      'Open-source STEP directory assets remain proxy candidates until provenance proves the exact product or authority.',
    notes: hasText(record.notes) ? record.notes : record.part_ref,
  }
}

export function buildCoverageLedger(
  input: CatalogCoverageLedgerInput,
): CatalogCoverageLedger {
  const vendorModelCoverage = input.components.map((component) =>
    buildCoverageRow(component),
  )
  const missingDownloads = new Set<string>()
  const rejectedCandidates = new Set<string>()

  for (const row of vendorModelCoverage) {
    for (const asset of row.asset_coverage) {
      if (
        asset.status === 'missing' &&
        COVERAGE_DOWNLOAD_KINDS.has(asset.kind)
      ) {
        missingDownloads.add(`${row.part_ref}:${asset.kind}`)
      }
    }
    if (row.coverage_status !== 'promoted') {
      rejectedCandidates.add(row.part_ref)
    }
  }

  const sourceCollections = buildSourceCollectionCoverage(
    input.source_research.source_collections,
  )

  for (const record of input.source_research.research_records) {
    if (record.source_kind !== 'open_source_step_directory') {
      continue
    }
    const row = buildOpenSourceStepCoverageRow(record)
    vendorModelCoverage.push(row)
    rejectedCandidates.add(record.part_ref)
    for (const asset of row.asset_coverage) {
      if (
        asset.status === 'missing' &&
        COVERAGE_DOWNLOAD_KINDS.has(asset.kind)
      ) {
        missingDownloads.add(`${row.part_ref}:${asset.kind}`)
      }
    }
  }

  if (!sourceCollections.some((collection) => collection.source_id === 'step.parts')) {
    sourceCollections.push({
      source_id: 'step.parts',
      source_kind: 'open_source_step_directory',
      public_url: 'https://www.step.parts',
      repo_url: 'https://github.com/earthtojake/step.parts',
      source_url: 'https://www.step.parts/parts/hebi_r25_actuator',
      license_spdx: 'MIT',
      third_party_notice_ref: 'THIRD_PARTY_NOTICES.md',
      capture_date: input.generated_at_utc ?? new Date().toISOString(),
      redistribution_blocked: true,
      notes:
        'Open-source STEP directory candidate for future source-linked parts. Each upstream file keeps its own notice/licensing; step.parts is a source candidate, not manufacturer approval.',
    })
  }

  const ledger: CatalogCoverageLedger = {
    generated_at_utc: input.generated_at_utc ?? new Date().toISOString(),
    scope: 'Halo Forge Stream F sprinkler component catalog coverage and source research ledger',
    source_collections: sourceCollections,
    vendor_model_coverage: vendorModelCoverage,
    missing_downloads: Array.from(missingDownloads).sort(),
    rejected_candidates: Array.from(rejectedCandidates).sort(),
    summary: {
      total_rows: vendorModelCoverage.length,
      manufacturer_verified_count: vendorModelCoverage.filter(
        (row) => row.model_status === 'manufacturer_verified',
      ).length,
      proxy_count: vendorModelCoverage.filter(
        (row) => row.model_status === 'proxy',
      ).length,
      dimensioned_parametric_count: vendorModelCoverage.filter(
        (row) => row.model_status === 'dimensioned_parametric',
      ).length,
      visual_reference_count: vendorModelCoverage.filter(
        (row) => row.model_status === 'visual_reference',
      ).length,
      sealed_approved_count: vendorModelCoverage.filter(
        (row) => row.model_status === 'sealed_approved',
      ).length,
      missing_download_count: missingDownloads.size,
      rejected_candidate_count: rejectedCandidates.size,
      ...countMissingByKind(vendorModelCoverage),
    },
  }

  return ledger
}
