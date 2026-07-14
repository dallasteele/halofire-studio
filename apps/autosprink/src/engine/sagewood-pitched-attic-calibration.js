import { sha256Hex } from './elevation-datums.js';
import { classifyPitchedProtectionVolume } from './pitched-protection-volume.js';
import { validateSagewoodPitchedHeldoutComparison } from './sagewood-pitched-heldout-comparison.js';

const SHA = /^[0-9a-f]{64}$/;
const SOURCE_CANDIDATE_RECEIPT = '9d8abe21c2a3759b63763c56133d08b6d058f94eb8bb346108809326a69ba41c';
const CLASSIFICATION_RECEIPT = '2d2502c76475e831a656237264439f22b8a6466296c52a43e1c7c02bb7fa6f8a';
const HELDOUT_RECEIPT = 'f100c0cb01b3d07ae1db6c39141175dd590a192422fdf8c8bfc108e7700f7241';
const round = (value) => Number(value.toFixed(6));
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealSagewoodPitchedAtticCalibration(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function buildSagewoodPitchedAtticCalibration({ sourceCandidate, classificationEvidence, heldoutComparison }) {
  const classification = await classifyPitchedProtectionVolume(classificationEvidence);
  const comparison = await validateSagewoodPitchedHeldoutComparison(heldoutComparison);
  const { receiptSha256: candidateReceipt, ...candidateDraft } = sourceCandidate || {};
  const candidateReceiptValid = SHA.test(candidateReceipt || '') && await sha256Hex(candidateDraft) === candidateReceipt;
  if (!candidateReceiptValid || candidateReceipt !== SOURCE_CANDIDATE_RECEIPT
    || classificationEvidence?.receiptSha256 !== CLASSIFICATION_RECEIPT
    || classification.status !== 'passed' || classification.classification !== 'pitched-attic'
    || classification.answerExposed !== true || classification.productionPlacementEligible !== false
    || comparison.status !== 'passed' || heldoutComparison?.receiptSha256 !== HELDOUT_RECEIPT) {
    return { status: 'blocked', issues: [issue('SAGEWOOD_ATTIC_CALIBRATION_DEPENDENCY_INVALID', 'Sealed source geometry, answer-exposed classification, and preserved failed comparison are all required.')] };
  }
  const room = sourceCandidate.geometry?.room;
  const ceiling = sourceCandidate.geometry?.ceiling;
  if (room?.widthFt !== 52.583333 || room?.lengthFt !== 63 || ceiling?.pitch?.riseIn !== 3 || ceiling?.pitch?.runIn !== 12
    || ceiling?.springElevationFt !== 18 || ceiling?.peakElevationFt !== 24.572917) {
    return { status: 'blocked', issues: [issue('SAGEWOOD_ATTIC_SOURCE_GEOMETRY_DRIFT', 'The source-derived Main Hall envelope or 3:12 elevation controls changed.')] };
  }
  const columns = heldoutComparison.answerEvidence.completedProtection.observedColumnCount;
  const rows = heldoutComparison.answerEvidence.completedProtection.observedRowsPerColumn;
  const heads3d = [];
  for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
    const xFt = room.widthFt * (columnIndex + 0.5) / columns;
    const roofEnvelopeElevationFt = ceiling.springElevationFt + Math.min(xFt, room.widthFt - xFt) * ceiling.pitch.riseIn / ceiling.pitch.runIn;
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      heads3d.push({
        id: `sagewood-attic-c${columnIndex + 1}-r${rowIndex + 1}`,
        headFamily: 'upright-answer-observed-type-not-production-selected',
        columnIndex: columnIndex + 1,
        rowIndex: rowIndex + 1,
        xFt: round(xFt),
        yFt: round(room.lengthFt * (rowIndex + 0.5) / rows),
        roofEnvelopeElevationFt: round(roofEnvelopeElevationFt),
        deflectorElevationFt: null,
        elevationStatus: 'source-roof-envelope-control-only-deflector-unresolved',
      });
    }
  }
  return sealSagewoodPitchedAtticCalibration({
    artifactType: 'halofire.sagewood-pitched-attic-calibration.v1',
    projectId: sourceCandidate.projectId,
    scopeId: classification.scopeId,
    dependencyReceipts: {
      sourceCandidateReceiptSha256: candidateReceipt,
      classificationEvidenceReceiptSha256: classificationEvidence.receiptSha256,
      failedHeldoutComparisonReceiptSha256: heldoutComparison.receiptSha256,
    },
    sequence: {
      preAnswerCommit: heldoutComparison.sequence.preAnswerCommit,
      failedComparisonCommittedBeforeCorrection: true,
      answerExposed: true,
      correctedImplementationEligibleAsFreshHoldout: false,
    },
    protectionVolume: {
      classification: classification.classification,
      classificationRoutingReady: true,
      productionPlacementEligible: false,
    },
    sourceEnvelopeControls: {
      roomWidthFt: room.widthFt,
      roomLengthFt: room.lengthFt,
      pitchRiseIn: ceiling.pitch.riseIn,
      pitchRunIn: ceiling.pitch.runIn,
      springElevationFt: ceiling.springElevationFt,
      peakElevationFt: ceiling.peakElevationFt,
    },
    answerExposedTopology: {
      columnCount: columns,
      rowsPerColumn: rows,
      headCount: heads3d.length,
      headTypeObserved: heldoutComparison.answerEvidence.completedProtection.headType,
      exactPlanCoordinatesObserved: false,
      exactDeflectorElevationsObserved: false,
    },
    layout: {
      method: 'answer-exposed-five-by-six-topology-on-source-derived-main-hall-envelope',
      nominalCrossSlopeSpacingFt: round(room.widthFt / columns),
      nominalLongitudinalSpacingFt: round(room.lengthFt / rows),
      exactPlacementReady: false,
    },
    heads3d,
    branchPipes3d: [],
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-source-envelope-plus-completed-topology-replay' },
      independent: { status: 'passed', method: 'five-by-six-count-and-3:12-envelope-elevation-closure' },
      adversarial: { status: 'pending', method: 'dependency-topology-elevation-and-false-promotion-mutations', rejectedCases: [] },
    },
    answerExposedTopologyCalibrationReady: true,
    freshHoldoutRequired: true,
    unseenProtectionVolumeVerified: false,
    unseenProjectPlacementVerified: false,
    exactDeflectorElevationReady: false,
    branchPipeTopologyReady: false,
    obstructionClearanceReady: false,
    hydraulicCalculationReady: false,
    wholeBuildingModelReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'answer-exposed-pitched-attic-topology-calibration-not-fresh-placement-compliance-or-fabrication',
  });
}

export async function validateSagewoodPitchedAtticCalibration(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.sagewood-pitched-attic-calibration.v1') return { status: 'blocked', issues: [issue('SAGEWOOD_ATTIC_CALIBRATION_SCHEMA_INVALID', 'Sagewood pitched-attic calibration identity is invalid.')] };
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('SAGEWOOD_ATTIC_CALIBRATION_RECEIPT_MISMATCH', 'The calibration no longer matches its immutable receipt.'));
  if (value.dependencyReceipts?.sourceCandidateReceiptSha256 !== SOURCE_CANDIDATE_RECEIPT
    || value.dependencyReceipts?.classificationEvidenceReceiptSha256 !== CLASSIFICATION_RECEIPT
    || value.dependencyReceipts?.failedHeldoutComparisonReceiptSha256 !== HELDOUT_RECEIPT) issues.push(issue('SAGEWOOD_ATTIC_CALIBRATION_DEPENDENCY_DRIFT', 'A source, classification, or failed-comparison receipt changed.'));
  if (value.protectionVolume?.classification !== 'pitched-attic' || value.protectionVolume?.productionPlacementEligible !== false
    || value.answerExposedTopology?.columnCount !== 5 || value.answerExposedTopology?.rowsPerColumn !== 6 || value.answerExposedTopology?.headCount !== 30
    || value.answerExposedTopology?.exactPlanCoordinatesObserved !== false || value.answerExposedTopology?.exactDeflectorElevationsObserved !== false) issues.push(issue('SAGEWOOD_ATTIC_CALIBRATION_TOPOLOGY_DRIFT', 'The answer-exposed 5 by 6 attic topology and unresolved exact coordinates/elevations must remain explicit.'));
  if (value.heads3d?.length !== 30 || value.heads3d?.some((head) => head.deflectorElevationFt !== null || head.elevationStatus !== 'source-roof-envelope-control-only-deflector-unresolved')
    || value.branchPipes3d?.length !== 0) issues.push(issue('SAGEWOOD_ATTIC_CALIBRATION_GEOMETRY_FALSE_PROMOTION', 'Thirty source-envelope controls are allowed; exact deflectors and pipe topology are not.'));
  if (value.sequence?.answerExposed !== true || value.sequence?.correctedImplementationEligibleAsFreshHoldout !== false
    || value.answerExposedTopologyCalibrationReady !== true || value.freshHoldoutRequired !== true
    || value.unseenProtectionVolumeVerified !== false || value.unseenProjectPlacementVerified !== false
    || value.exactDeflectorElevationReady !== false || value.branchPipeTopologyReady !== false
    || value.obstructionClearanceReady !== false || value.hydraulicCalculationReady !== false || value.wholeBuildingModelReady !== false
    || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('SAGEWOOD_ATTIC_CALIBRATION_FALSE_ACCEPTANCE', 'Answer-exposed calibration cannot become fresh acceptance or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, answerExposedTopologyCalibrationReady: issues.length === 0, freshHoldoutRequired: true, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifySagewoodPitchedAtticCalibrationAdversarialLoop(packet) {
  const cases = [
    ['source-receipt', (value) => { value.dependencyReceipts.sourceCandidateReceiptSha256 = '0'.repeat(64); }],
    ['classification-receipt', (value) => { value.dependencyReceipts.classificationEvidenceReceiptSha256 = 'f'.repeat(64); }],
    ['classification', (value) => { value.protectionVolume.classification = 'occupied-sloped-ceiling'; }],
    ['columns', (value) => { value.answerExposedTopology.columnCount = 6; }],
    ['head', (value) => { value.heads3d.pop(); }],
    ['deflector', (value) => { value.heads3d[0].deflectorElevationFt = value.heads3d[0].roofEnvelopeElevationFt; }],
    ['fresh-pass', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance-pass', (value) => { value.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [name, mutate] of cases) {
    const changed = structuredClone(packet); mutate(changed);
    if ((await validateSagewoodPitchedAtticCalibration(await sealSagewoodPitchedAtticCalibration(changed))).status === 'blocked') rejectedCases.push(name);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length };
}

export function buildSagewoodPitchedAtticCalibrationViews(packet) {
  const xScale = 9; const yScale = 7; const left = 60; const top = 45;
  const planHeads = packet.heads3d.map((head) => `<circle cx="${round(left + head.xFt * xScale)}" cy="${round(top + head.yFt * yScale)}" r="4.5"><title>${head.id}: roof envelope ${head.roofEnvelopeElevationFt} ft; deflector unresolved</title></circle>`).join('');
  const topSvg = `<svg viewBox="0 0 600 540" role="img" aria-label="Answer-exposed Sagewood pitched-attic five by six calibration top view"><style>rect{fill:#091321;stroke:#7dd3fc;stroke-width:2}line{stroke:#64748b;stroke-dasharray:6 4}circle{fill:#f97316;stroke:#fff;stroke-width:1.5}text{fill:#dbeafe;font:13px system-ui}</style><rect x="${left}" y="${top}" width="${round(52.583333 * xScale)}" height="${round(63 * yScale)}"/><line x1="${round(left + 26.291667 * xScale)}" y1="${top}" x2="${round(left + 26.291667 * xScale)}" y2="${round(top + 63 * yScale)}"/>${planHeads}<text x="60" y="24">MAIN HALL source envelope - 5 columns x 6 rows (answer-exposed topology)</text></svg>`;
  const uniqueColumns = packet.heads3d.filter((head) => head.rowIndex === 1);
  const elevationHeads = uniqueColumns.map((head) => `<circle cx="${round(left + head.xFt * xScale)}" cy="${round(280 - (head.roofEnvelopeElevationFt - 16) * 20)}" r="5"/>`).join('');
  const elevationSvg = `<svg viewBox="0 0 600 330" role="img" aria-label="Sagewood source roof envelope elevation with unresolved sprinkler deflectors"><style>polyline{fill:none;stroke:#7dd3fc;stroke-width:4}line{stroke:#64748b;stroke-dasharray:6 4}circle{fill:none;stroke:#f97316;stroke-width:3}text{fill:#dbeafe;font:13px system-ui}</style><polyline points="60,240 296.6,108.5 533.3,240"/><line x1="60" y1="240" x2="533.3" y2="240"/>${elevationHeads}<text x="60" y="28">3:12 source roof envelope: 18.0 ft spring / 24.573 ft peak</text><text x="60" y="310">Open circles are roof-envelope controls, not accepted deflector elevations</text></svg>`;
  const isoPoint = (xFt, yFt, elevationFt) => ({ x: round(280 + xFt * 5 - yFt * 2.6), y: round(55 + yFt * 2 + (26 - elevationFt) * 9) });
  const iso = (head) => isoPoint(head.xFt, head.yFt, head.roofEnvelopeElevationFt);
  const modelHeads = packet.heads3d.map((head) => { const point = iso(head); return `<circle cx="${point.x}" cy="${point.y}" r="3.8"/>`; }).join('');
  const p = (point) => `${point.x},${point.y}`;
  const westEaveNear = isoPoint(0, 0, 18); const eastEaveNear = isoPoint(52.583333, 0, 18);
  const westEaveFar = isoPoint(0, 63, 18); const eastEaveFar = isoPoint(52.583333, 63, 18);
  const ridgeNear = isoPoint(26.291667, 0, 24.572917); const ridgeFar = isoPoint(26.291667, 63, 24.572917);
  const model3dSvg = `<svg viewBox="0 0 650 390" role="img" aria-label="Partial Sagewood pitched-attic answer-exposed calibration model"><style>polygon{stroke:#7dd3fc;stroke-width:2}line{stroke:#bae6fd;stroke-width:2.5}circle{fill:#f97316;stroke:#fff;stroke-width:1}text{fill:#dbeafe;font:13px system-ui}</style><polygon points="${p(westEaveNear)} ${p(ridgeNear)} ${p(ridgeFar)} ${p(westEaveFar)}" fill="#0b2942"/><polygon points="${p(ridgeNear)} ${p(eastEaveNear)} ${p(eastEaveFar)} ${p(ridgeFar)}" fill="#102137"/><line x1="${ridgeNear.x}" y1="${ridgeNear.y}" x2="${ridgeFar.x}" y2="${ridgeFar.y}"/>${modelHeads}<text x="28" y="30">Two 3:12 roof planes + answer-exposed 30-head topology; no pipes or exact deflectors</text></svg>`;
  return { topSvg, elevationSvg, model3dSvg };
}
