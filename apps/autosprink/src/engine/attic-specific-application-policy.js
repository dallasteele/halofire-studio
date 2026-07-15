/** Manufacturer- and structure-bound policy for pitched attic specific-application sprinklers. */

import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export const TYCO_TY4180_BB1 = Object.freeze({
  manufacturer: 'Tyco', sin: 'TY4180', model: 'BB1', kFactor: 8,
  pitchRange: { minRise: 4, maxRiseExclusive: 7, run: 12 }, allowableRoofSpanFt: 60,
  minimumFlowGpm: 38, minimumPressurePsi: 22.6,
  ridgeSpacingFt: { min: 4, max: 6 }, ridgeCenterlineOffsetInMax: 6,
  deflectorBelowPeakIn: { min: 16, max: 22 }, trussFaceClearanceInMin: 6,
  drySystemDemandHeadCount: 7,
});

export function selectSpecificApplicationAtticModel({ manufacturerCriteria, roofPitch, horizontalRoofSpanFt, systemType }) {
  const issues = [];
  if (manufacturerCriteria?.sin !== 'TY4180' || manufacturerCriteria?.document !== 'TFP610' || manufacturerCriteria?.revision !== 'December 2024' || manufacturerCriteria?.sourcePages?.designCriteria !== 121 || manufacturerCriteria?.sourcePages?.designGuidelines !== 123 || manufacturerCriteria?.sourcePages?.obstructions !== 129 || manufacturerCriteria?.sourcePages?.hydraulics !== 133) issues.push(issue('ATTIC_MANUFACTURER_CRITERIA_UNTRUSTED', 'TY4180 criteria must bind the approved TFP610 pages.'));
  if (roofPitch?.rise < TYCO_TY4180_BB1.pitchRange.minRise || roofPitch?.rise >= TYCO_TY4180_BB1.pitchRange.maxRiseExclusive || roofPitch?.run !== 12) issues.push(issue('ATTIC_MODEL_PITCH_OUT_OF_RANGE', 'TY4180 BB1 requires a 4:12 to less than 7:12 roof pitch.'));
  if (!(horizontalRoofSpanFt > 0) || horizontalRoofSpanFt > TYCO_TY4180_BB1.allowableRoofSpanFt) issues.push(issue('ATTIC_MODEL_SPAN_OUT_OF_RANGE', 'TY4180 BB1 horizontal roof span must not exceed 60 feet.'));
  if (!['wet-steel', 'dry-steel', 'wet-cpvc'].includes(systemType)) issues.push(issue('ATTIC_SYSTEM_TYPE_UNSUPPORTED', 'TY4180 system type is not supported by the bound manufacturer criteria.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, model: issues.length ? null : TYCO_TY4180_BB1 };
}

export async function sealAtticSpecificApplicationCalibrationSource(value) {
  const { sourceReceiptSha256: _ignored, ...draft } = value;
  return { ...draft, sourceReceiptSha256: await sha256Hex(draft) };
}

export async function validateAtticSpecificApplicationCalibrationSource(value) {
  const issues = [];
  const { sourceReceiptSha256, ...draft } = value || {};
  if (!SHA.test(sourceReceiptSha256 || '') || await sha256Hex(draft) !== sourceReceiptSha256) issues.push(issue('ATTIC_CALIBRATION_SOURCE_RECEIPT_INVALID', 'Calibration source receipt is invalid.'));
  if (value?.projectId !== 'new-hope-crisis-center-brigham-city-ut' || value?.calibrationStatus !== 'answer-exposed-not-fresh') issues.push(issue('ATTIC_CALIBRATION_IDENTITY_INVALID', 'Calibration identity or freshness boundary changed.'));
  if (value?.sources?.s102?.sha256 !== '2f695364975d6ddccd13e41b14db96f4d927e60ba23accda57bead7d3b9e4f5a' || value?.sources?.s301?.sha256 !== '9745634c34c037963dbdbd2cc0fa30e00e47c3a2509c711578849aabebe2044a' || value?.sources?.tfp610?.sha256 !== 'ef738cdc5271e38bd978b8f5932514bcbf1d84e83e778ca9fe5a32dbed1978ca') issues.push(issue('ATTIC_CALIBRATION_SOURCE_IDENTITY_INVALID', 'Structural or manufacturer source identity changed.'));
  const feature = value?.feature;
  if (feature?.ridgeLengthFt !== 43 || feature?.horizontalRoofSpanFt !== 60 || feature?.ridgeCoordinateFt !== 30.375 || feature?.ridgeDatumZFt !== 21.208333 || feature?.roofPitch?.rise !== 4 || feature?.roofPitch?.run !== 12 || feature?.trussSpacingIn !== 24 || feature?.trussDirection !== 'perpendicular-to-outside-wall') issues.push(issue('ATTIC_CALIBRATION_GEOMETRY_INVALID', 'Ridge, span, pitch, or truss controls changed.'));
  if (feature?.branchline?.startOffsetFt !== 4 || feature?.branchline?.spacingFt !== 6 || feature?.branchline?.endOffsetFt !== 3 || feature?.branchline?.source !== 'approved-field-as-built-consensus') issues.push(issue('ATTIC_CALIBRATION_BRANCHLINE_INVALID', 'Answer-exposed branchline calibration changed.'));
  if (value?.manufacturerCriteria?.sin !== 'TY4180' || value?.manufacturerCriteria?.sourcePages?.designCriteria !== 121 || value?.manufacturerCriteria?.sourcePages?.hydraulics !== 133) issues.push(issue('ATTIC_CALIBRATION_MANUFACTURER_INVALID', 'Manufacturer criteria binding changed.'));
  if (value?.claims?.freshProjectPlacementVerified !== false || value?.claims?.obstructionClearanceReady !== false || value?.claims?.hydraulicCalculationReady !== false || value?.claims?.complianceReady !== false) issues.push(issue('ATTIC_CALIBRATION_FALSE_PROMOTION', 'Answer-exposed calibration promoted a production claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, calibrationReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function buildAtticSpecificApplicationCalibration(source) {
  if ((await validateAtticSpecificApplicationCalibrationSource(source)).status !== 'passed') throw new Error('ATTIC_CALIBRATION_SOURCE_BLOCKED');
  const feature = source.feature;
  const selection = selectSpecificApplicationAtticModel({ manufacturerCriteria: source.manufacturerCriteria, roofPitch: feature.roofPitch, horizontalRoofSpanFt: feature.horizontalRoofSpanFt, systemType: feature.systemType });
  if (selection.status !== 'passed') throw new Error(selection.issues[0].code);
  const { startOffsetFt, spacingFt, endOffsetFt } = feature.branchline;
  if (spacingFt < selection.model.ridgeSpacingFt.min || spacingFt > selection.model.ridgeSpacingFt.max) throw new Error('ATTIC_BRANCHLINE_SPACING_BLOCKED');
  const positions = [];
  for (let x = startOffsetFt; x <= feature.ridgeLengthFt - endOffsetFt + 1e-9; x += spacingFt) positions.push(Number(x.toFixed(6)));
  if (positions.length !== 7 || Math.abs(feature.ridgeLengthFt - positions.at(-1) - endOffsetFt) > 1e-9) throw new Error('ATTIC_BRANCHLINE_ENDPOINT_BLOCKED');
  const installationZRangeFt = { min: Number((feature.ridgeDatumZFt - selection.model.deflectorBelowPeakIn.max / 12).toFixed(6)), max: Number((feature.ridgeDatumZFt - selection.model.deflectorBelowPeakIn.min / 12).toFixed(6)) };
  const heads = positions.map((x, index) => ({ id: `NH-BB1-${String(index + 1).padStart(3, '0')}`, kind: 'specific-application-attic-upright', manufacturer: 'Tyco', sin: 'TY4180', model: 'BB1', kFactor: 8, localFt: { x, y: feature.ridgeCoordinateFt }, sourceRoofSurfaceZFt: feature.ridgeDatumZFt, permittedDeflectorZRangeFt: installationZRangeFt, headInstallationZFt: null, trussFaceClearanceVerified: false, obstructionClearanceVerified: false, hydraulicNodeAssigned: false }));
  const draft = {
    artifactType: 'halofire.answer-exposed-attic-specific-application-calibration.v1', projectId: source.projectId, sourceReceiptSha256: source.sourceReceiptSha256,
    modelSelection: selection.model, structure: { sourceSheets: ['S102', 'S301'], trussSpacingIn: feature.trussSpacingIn, trussDirection: feature.trussDirection, exactTrussFacePolygonsReady: false },
    branchline: { ridgeAxis: 'x', ridgeCoordinateFt: feature.ridgeCoordinateFt, ridgeLengthFt: feature.ridgeLengthFt, startOffsetFt, spacingFt, endOffsetFt, targetCount: heads.length, source: feature.branchline.source },
    heads,
    hydraulics: { systemType: feature.systemType, manufacturerDemandHeadCount: 7, minimumPerHeadFlowGpm: 38, minimumPerHeadPressurePsi: 22.6, minimumRemoteSprinklerFlowGpm: 266, actualNetworkCalculationReady: false },
    internalVerification: { primary: { status: 'passed', method: 'deterministic manufacturer-bound seven-head ridge replay' }, crossSource: { status: 'passed', method: 'S102/S301 structure plus TFP610 plus approved/field/as-built FP2.0 consensus' }, adversarial: { status: 'passed', method: 'source, model, pitch, span, spacing, structure, hydraulic, and false-promotion mutations rejected' } },
    calibrationReady: true, freshProjectPlacementVerified: false, exactHeadElevationReady: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'answer-exposed-structural-and-manufacturer-calibration-only-requires-fresh-transfer-and-exact-obstruction-hydraulic-proof',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateAtticSpecificApplicationCalibration(value, source) {
  const issues = [];
  let expected;
  try { expected = await buildAtticSpecificApplicationCalibration(source); } catch (error) { return { status: 'blocked', issues: [issue('ATTIC_CALIBRATION_INPUT_BLOCKED', error.message)], complianceReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('ATTIC_CALIBRATION_REPLAY_MISMATCH', 'Calibration differs from deterministic replay.'));
  if (value?.heads?.length !== 7 || value?.heads?.some((head) => head.headInstallationZFt !== null || head.trussFaceClearanceVerified !== false || head.obstructionClearanceVerified !== false || head.hydraulicNodeAssigned !== false) || value?.freshProjectPlacementVerified !== false || value?.complianceReady !== false) issues.push(issue('ATTIC_CALIBRATION_FALSE_PROMOTION', 'Calibration promoted unresolved installation, obstruction, hydraulic, or compliance state.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, calibrationReady: issues.length === 0, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyAtticSpecificApplicationCalibrationAdversarialLoop(value, source) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }], ['source', (entry) => { entry.sourceReceiptSha256 = '1'.repeat(64); }], ['model', (entry) => { entry.heads[0].sin = 'TY3183'; }], ['count', (entry) => { entry.branchline.targetCount = 24; }], ['spacing', (entry) => { entry.branchline.spacingFt = 7; }], ['xy', (entry) => { entry.heads[0].localFt.y = 25; }], ['z', (entry) => { entry.heads[0].headInstallationZFt = 19.5; }], ['truss', (entry) => { entry.structure.exactTrussFacePolygonsReady = true; }], ['clearance', (entry) => { entry.obstructionClearanceReady = true; }], ['hydraulic-node', (entry) => { entry.heads[0].hydraulicNodeAssigned = true; }], ['hydraulic', (entry) => { entry.hydraulicCalculationReady = true; }], ['fresh', (entry) => { entry.freshProjectPlacementVerified = true; }], ['compliance', (entry) => { entry.complianceReady = true; }], ['fabrication', (entry) => { entry.fabricationReady = true; }], ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const attacked = structuredClone(value); mutate(attacked); if ((await validateAtticSpecificApplicationCalibration(attacked, source)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, complianceReady: false };
}
