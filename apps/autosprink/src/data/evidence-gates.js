export const HOME_DEPOT_PROJECT_NAME = 'Home Depot - Rexburg ID';

export const REQUIRED_HOME_DEPOT_CLAIM_GATE_CODES = Object.freeze([
  'AUTOSPRINK_EVIDENCE_MISSING',
  'AHJ_APPROVAL_MISSING',
  'PROFESSIONAL_REVIEW_MISSING',
  'MANUFACTURER_MODEL_APPROVAL_MISSING',
  'BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL',
]);

const HOME_DEPOT_EVIDENCE_ROWS = Object.freeze([
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    evidenceType: 'proposal_workbook',
    sourceFile: 'Proposal- Home Depot - Rexburg ID.xlsx',
    sourceRef: 'Proposal workbook',
    status: 'present',
    notes: 'Source workbook for proposal totals, water facts, head count, and proposal square footage.',
  },
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    evidenceType: 'bid_log_row',
    sourceFile: '01-Bid Log.xlsx',
    sourceRef: 'Bid Log row 238',
    status: 'present',
    notes: 'Source bid-log row for submitted amount, due date, submitted date, contractor, and bid-log square footage.',
  },
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    evidenceType: 'argco_pricebook_workbook',
    sourceFile: 'Halo FIre Pricebook ARGCO 2026.xlsx',
    sourceRef: 'ARGCO pricebook workbook',
    status: 'present',
    notes: 'Vendor pricebook source exists; item import and validation are owned by the pricebook task.',
  },
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    evidenceType: 'fff_pricebook_workbook',
    sourceFile: 'Halo Fire Pricebook FFF 2026.xlsx',
    sourceRef: 'FFF pricebook workbook',
    status: 'present',
    notes: 'Vendor pricebook source exists; item import and validation are owned by the pricebook task.',
  },
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    evidenceType: 'victaulic_pricebook_workbook',
    sourceFile: 'Halo Fire Pricebook Victaulic 2026.xlsx',
    sourceRef: 'Victaulic pricebook workbook',
    status: 'present',
    notes: 'Vendor pricebook source exists; item import and validation are owned by the pricebook task.',
  },
]);

const HOME_DEPOT_CLAIM_GATES = Object.freeze([
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    code: 'AUTOSPRINK_EVIDENCE_MISSING',
    severity: 'blocking',
    missingArtifact: 'AutoSprink model/export evidence',
    acceptableEvidence: 'An AutoSprink file, export, report, or signed comparison packet tied to this Home Depot Rexburg bid.',
    blockedClaims: [
      'AutoSprink parity',
      'design export ready',
      'fabrication-ready layout',
    ],
    nextAction: 'Attach the actual AutoSprink evidence packet or keep AutoSprink parity and fabrication-ready claims blocked.',
    status: 'blocked',
  },
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    code: 'AHJ_APPROVAL_MISSING',
    severity: 'blocking',
    missingArtifact: 'AHJ approval record',
    acceptableEvidence: 'Rexburg Fire Marshal or other AHJ approval document, email, stamp, or review record for this bid.',
    blockedClaims: [
      'AHJ-approved',
      'permit-ready',
      'approved for submission',
    ],
    nextAction: 'Record the AHJ approval artifact before showing any AHJ-approved or permit-ready status.',
    status: 'blocked',
  },
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    code: 'PROFESSIONAL_REVIEW_MISSING',
    severity: 'blocking',
    missingArtifact: 'Licensed professional review/signoff',
    acceptableEvidence: 'Named licensed professional review, PE signoff, or employee approval record for this bid package.',
    blockedClaims: [
      'professionally reviewed',
      'engineering-grade',
      'PE-approved',
    ],
    nextAction: 'Attach a named professional review/signoff before claiming the package is professionally reviewed or engineering-grade.',
    status: 'blocked',
  },
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    code: 'MANUFACTURER_MODEL_APPROVAL_MISSING',
    severity: 'blocking',
    missingArtifact: 'Manufacturer model approval evidence',
    acceptableEvidence: 'Manufacturer submittal, compatibility approval, or model approval artifact tied to selected materials.',
    blockedClaims: [
      'manufacturer-approved model',
      'manufacturer-approved materials',
      'submittal-ready selections',
    ],
    nextAction: 'Attach manufacturer approval evidence before claiming selected models or materials are manufacturer-approved.',
    status: 'blocked',
  },
  {
    projectName: HOME_DEPOT_PROJECT_NAME,
    code: 'BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL',
    severity: 'warning',
    missingArtifact: 'Resolved square-footage source-of-truth decision',
    acceptableEvidence: 'A documented decision choosing bid-log square footage, proposal square footage, or a corrected third value.',
    blockedClaims: [
      'final sqft-based pricing',
      'fully reconciled bid package',
      'final project quantity basis',
    ],
    nextAction: 'Resolve the square-footage discrepancy: bid log shows 135000 sqft while proposal shows 121500 sqft.',
    status: 'blocked',
    bidLogSqft: 135000,
    proposalSqft: 121500,
  },
]);

function cloneRows(rows) {
  return rows.map((row) => {
    const clone = { ...row };
    if (row.blockedClaims) {
      clone.blockedClaims = [...row.blockedClaims];
    }
    return clone;
  });
}

export function buildHomeDepotEvidenceRows() {
  return cloneRows(HOME_DEPOT_EVIDENCE_ROWS);
}

export function buildHomeDepotClaimGates() {
  return cloneRows(HOME_DEPOT_CLAIM_GATES);
}

export function getBlockedClaimCodes(gates) {
  return gates
    .filter((gate) => gate.status === 'blocked')
    .map((gate) => gate.code);
}
