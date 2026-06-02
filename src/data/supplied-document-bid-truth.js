import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '../..');

export const SUPPLIED_DOCUMENT_BID_TRUTH_ARTIFACT_TYPE = 'halofire.supplied_document_bid_truth_status.v1';

const BLOCKED_CLAIMS = [
  'permit_ready',
  'AHJ_approval',
  'AHJ_ready',
  'PE_review',
  'professional_approval',
  'engineering_grade',
  'fabrication_ready',
  'AutoSprink_parity',
  'manufacturer_exact',
];

const PROJECT_WORKBOOKS = [
  {
    project_name: 'The Cooperative 1881 - Salt Lake City UT',
    source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
    building_sheet: 'Building (1)',
    field_summary_sheet: 'Field Summary Report',
    job_information_sheet: 'Job Information',
    proposal_sheet: 'Proposal Template - New',
  },
  {
    project_name: 'Home Depot - Rexburg ID',
    source_file: 'Proposal- Home Depot - Rexburg ID.xlsx',
    building_sheet: 'Building 1',
    field_summary_sheet: 'Field Summary Report',
    job_information_sheet: 'Job Information',
    proposal_sheet: 'Proposal Template - New',
  },
];

const PRICEBOOK_WORKBOOKS = [
  {
    supplier: 'ARGCO',
    source_file: 'Halo FIre Pricebook ARGCO 2026.xlsx',
    primary_sheet: 'ARGCOPricebookTravisResults',
  },
  {
    supplier: 'FFF',
    source_file: 'Halo Fire Pricebook FFF 2026.xlsx',
    primary_sheet: 'Index',
  },
  {
    supplier: 'Victaulic',
    source_file: 'Halo Fire Pricebook Victaulic 2026.xlsx',
    primary_sheet: 'Data',
  },
];

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString().slice(0, 10);
  }
  return cleanText(value) || null;
}

function readWorkbookIfPresent(rootDir, sourceFile) {
  const filePath = path.join(rootDir, sourceFile);
  if (!fs.existsSync(filePath)) return null;
  return XLSX.readFile(filePath, {
    cellDates: true,
    cellNF: false,
    cellText: false,
  });
}

function cell(sheet, address) {
  return sheet?.[address]?.v ?? null;
}

function sheetRowCount(sheet) {
  if (!sheet?.['!ref']) return 0;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  return Math.max(0, range.e.r - range.s.r + 1);
}

function projectTruthRow(rootDir, spec) {
  const workbook = readWorkbookIfPresent(rootDir, spec.source_file);
  if (!workbook) {
    return {
      artifact_type: 'halofire.supplied_document_bid_truth_project_row.v1',
      project_name: spec.project_name,
      source_file: spec.source_file,
      source_runtime: 'xlsx',
      source_status: 'missing_on_disk',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      blocked_claims: [...BLOCKED_CLAIMS],
      limitations: [
        'Source workbook is not present on disk, so this row cannot provide bid-truth defaults.',
        'Missing source documents do not stop internal-alpha AI review, but every regulated claim remains blocked.',
      ],
    };
  }

  const building = workbook.Sheets[spec.building_sheet];
  const fieldSummary = workbook.Sheets[spec.field_summary_sheet];
  const jobInfo = workbook.Sheets[spec.job_information_sheet];
  const proposal = workbook.Sheets[spec.proposal_sheet];
  const staticPsi = numberOrNull(cell(jobInfo, 'B3'));
  const residualPsi = numberOrNull(cell(jobInfo, 'B4'));
  const flowingGpm = numberOrNull(cell(jobInfo, 'B5'));
  const flowDataAvailable = !!(staticPsi && residualPsi && flowingGpm);
  const sourceRefs = [
    `${spec.source_file}#${spec.building_sheet}!B3:B5`,
    `${spec.source_file}#${spec.building_sheet}!G5:H6`,
    `${spec.source_file}#${spec.building_sheet}!B9`,
    `${spec.source_file}#${spec.building_sheet}!H3:H4`,
    `${spec.source_file}#${spec.field_summary_sheet}!B6:B7`,
    `${spec.source_file}#${spec.job_information_sheet}!B3:B7`,
  ];

  return {
    artifact_type: 'halofire.supplied_document_bid_truth_project_row.v1',
    project_name: spec.project_name,
    source_file: spec.source_file,
    source_runtime: 'xlsx',
    source_status: 'available_on_disk',
    source_sheets: workbook.SheetNames,
    customer: cleanText(cell(building, 'B3')),
    project_name_raw: cleanText(cell(building, 'B4')),
    project_address: cleanText(cell(building, 'B5')),
    city: cleanText(cell(building, 'G5')),
    state: cleanText(cell(building, 'H5')),
    proposal_date: toIsoDate(cell(proposal, 'D3')),
    recipient: cleanText(cell(proposal, 'D4')),
    square_feet: numberOrNull(cell(building, 'G6')),
    head_count: numberOrNull(cell(building, 'B9')),
    head_density_sqft_per_head: round2(cell(building, 'D11')),
    price_per_head: round2(cell(building, 'I9')),
    bid_total: round2(cell(building, 'G11')),
    markup_pct: round2(Number(cell(building, 'I11')) * 100),
    total_man_hours: round2(cell(building, 'H3')),
    construction_days: numberOrNull(cell(building, 'H4')),
    hours_per_day: numberOrNull(cell(fieldSummary, 'B7')),
    days_per_week: numberOrNull(cell(fieldSummary, 'B6')),
    static_psi: staticPsi,
    residual_psi: residualPsi,
    flowing_gpm: flowingGpm,
    flow_data_available: flowDataAvailable,
    flow_data_source_status: flowDataAvailable ? 'documented_bid_package_values' : 'missing_official_flow_values',
    source_refs: sourceRefs,
    temporary_value_policy: 'best_guess_until_employee_replaced',
    employee_replaceable_fields: [
      'customer',
      'project_name_raw',
      'project_address',
      'city',
      'state',
      'square_feet',
      'head_count',
      'total_man_hours',
      'construction_days',
      'hours_per_day',
      'days_per_week',
      'static_psi',
      'residual_psi',
      'flowing_gpm',
    ],
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: [...BLOCKED_CLAIMS],
    limitations: [
      'These are source-linked workbook defaults for internal-alpha estimating and SAM31/LLM review only.',
      'HaloFire employees may replace or approve these values, but this row by itself clears no professional, AHJ, manufacturer, engineering, AutoSprink, permit, or fabrication claim.',
    ],
  };
}

function pricebookSourceRow(rootDir, spec) {
  const workbook = readWorkbookIfPresent(rootDir, spec.source_file);
  if (!workbook) {
    return {
      artifact_type: 'halofire.supplied_document_bid_truth_pricebook_row.v1',
      supplier: spec.supplier,
      source_file: spec.source_file,
      source_runtime: 'xlsx',
      source_status: 'missing_on_disk',
      temporary_value_policy: 'best_guess_until_employee_replaced',
      use_for_claims: false,
      claim_gate_effect: 'no_claims_cleared',
      blocked_claims: [...BLOCKED_CLAIMS],
    };
  }
  const primarySheet = workbook.Sheets[spec.primary_sheet] || workbook.Sheets[workbook.SheetNames[0]];
  return {
    artifact_type: 'halofire.supplied_document_bid_truth_pricebook_row.v1',
    supplier: spec.supplier,
    source_file: spec.source_file,
    source_runtime: 'xlsx',
    source_status: 'available_on_disk',
    primary_sheet: spec.primary_sheet,
    sheet_count: workbook.SheetNames.length,
    source_sheets: workbook.SheetNames.slice(0, 24),
    primary_sheet_row_count: sheetRowCount(primarySheet),
    temporary_value_policy: 'best_guess_until_employee_replaced',
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    blocked_claims: [...BLOCKED_CLAIMS],
    limitations: [
      'Pricebook source availability supports estimate defaults and catalog acquisition review only.',
      'Vendor pricebook presence does not prove manufacturer-exact CAD/BIM geometry, approval, fabrication readiness, or AutoSprink parity.',
    ],
  };
}

export function buildSuppliedDocumentBidTruthStatus(rootDir = DEFAULT_ROOT, activeProjectName = null) {
  const project_truth_rows = PROJECT_WORKBOOKS.map((spec) => projectTruthRow(rootDir, spec));
  const pricebook_sources = PRICEBOOK_WORKBOOKS.map((spec) => pricebookSourceRow(rootDir, spec));
  const activeProjectTruth = project_truth_rows.find((row) => row.project_name === activeProjectName) || null;
  const availableProjectSources = project_truth_rows.filter((row) => row.source_status === 'available_on_disk').length;
  const availablePricebookSources = pricebook_sources.filter((row) => row.source_status === 'available_on_disk').length;
  const status = availableProjectSources || availablePricebookSources
    ? 'employee_review_needed'
    : 'source_documents_missing';
  return {
    artifact_type: SUPPLIED_DOCUMENT_BID_TRUTH_ARTIFACT_TYPE,
    status,
    generated_at: new Date().toISOString(),
    active_project_name: activeProjectName || null,
    project_truth: activeProjectTruth,
    project_truth_rows,
    cross_project_truth: project_truth_rows.filter((row) => row.project_name !== activeProjectName),
    pricebook_sources,
    source_document_counts: {
      project_workbooks_available: availableProjectSources,
      project_workbooks_expected: PROJECT_WORKBOOKS.length,
      pricebooks_available: availablePricebookSources,
      pricebooks_expected: PRICEBOOK_WORKBOOKS.length,
    },
    temporary_value_policy: 'best_guess_until_employee_replaced',
    use_for_claims: false,
    claim_gate_effect: 'no_claims_cleared',
    acceptable_evidence: [
      'HaloFire employee reviewed supplied workbook values',
      'source workbook cell references for every accepted temporary value',
      'updated official flow test report or water supply data sheet when workbook flow values are missing',
      'updated vendor/manufacturer pricebook page or approved catalog/STEP/BIM artifact',
      'licensed professional, AHJ, manufacturer, and AutoSprink/equivalent evidence before regulated claims',
    ],
    employee_next_actions: [
      'Review the active project row values in the workbench.',
      'Replace any best-guess defaults with employee-confirmed values and source refs.',
      'Attach official/professional/AHJ/manufacturer/AutoSprink evidence through claim-gate resolvers before making regulated claims.',
    ],
    blocked_claims: [...BLOCKED_CLAIMS],
    limitations: [
      'This status packet makes the supplied HaloFire workbooks visible to SAM31/LLM and resolver workflows.',
      'It is not a claim gate resolver and does not clear permit-ready, AHJ-ready, professional, engineering-grade, fabrication-ready, manufacturer-exact, or AutoSprink parity claims.',
    ],
  };
}
