import { sha256Hex } from './elevation-datums.js';
import { generateSlopedCeilingLayout } from './sloped-ceiling-layout.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function sealRegerFloresBoxBeamCalibration(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export function replayRegerFloresBoxBeamCalibration(value) {
  const geometry = value.geometry;
  const beamLines = geometry.beamStationsFt.map((stationSubmittedPt, index) => ({ id: `reger-box-beam-${index + 1}`, kind: 'box-beam', axis: 'x', stationSubmittedPt, widthIn: geometry.beamWidthIn, spansRegion: true, partitionProtectionRegion: true }));
  const regions = [
    { id: 'vault-west-plane', polygonSubmittedPt: [[0, 0], [geometry.halfRunFt, 0], [geometry.halfRunFt, geometry.lengthFt], [0, geometry.lengthFt]], slopeAxis: 'x', downhillDirection: 'negative-x', riseIn: geometry.pitch.riseIn, runIn: geometry.pitch.runIn, shouldProtect: true, obstructions: [], linearObstructions: beamLines },
    { id: 'vault-east-plane', polygonSubmittedPt: [[geometry.halfRunFt, 0], [geometry.widthFt, 0], [geometry.widthFt, geometry.lengthFt], [geometry.halfRunFt, geometry.lengthFt]], slopeAxis: 'x', downhillDirection: 'positive-x', riseIn: geometry.pitch.riseIn, runIn: geometry.pitch.runIn, shouldProtect: true, obstructions: [], linearObstructions: beamLines },
  ];
  return generateSlopedCeilingLayout({ artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 1, regions, maxAcrossSlopeSpanFt: value.layoutControls.maxAcrossSlopeSpanFt, maxAlongSlopeSpanFt: value.layoutControls.maxAlongSlopeSpanFt });
}

export async function validateRegerFloresBoxBeamCalibration(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.reger-flores-box-beam-calibration.v1') return { status: 'blocked', issues: [issue('REGER_BEAM_CALIBRATION_SCHEMA_INVALID', 'Reger-Flores beam calibration identity is invalid.')] };
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('REGER_BEAM_CALIBRATION_RECEIPT_MISMATCH', 'The beam calibration no longer matches its receipt.'));
  const source = value.sourceEvidence;
  if (source?.ceilingCadSha256 !== '62156c099f062a4bef85edcab4dbf4e262586655b1c462003e2cdeed99dea279' || source?.completedPdfSha256 !== 'af45158d0e52a87faa78973b171245d6c772d46d5edccfad0e8410e88c8ffce9'
    || source?.correctedVaultLengthFt !== 24 || source?.rejectedPriorVaultLengthFt !== 16 || source?.dimensionEntities?.length !== 3 || source.dimensionEntities.some((entry) => entry.text !== "8'-0\"") || source?.beamLabels?.length !== 3) issues.push(issue('REGER_BEAM_SOURCE_EVIDENCE_DRIFT', 'The three source-proven eight-foot beam bays changed.'));
  const geometry = value.geometry;
  if (geometry?.widthFt !== 18.5 || geometry?.lengthFt !== 24 || geometry?.halfRunFt !== 9.25 || geometry?.pitch?.riseIn !== 4 || geometry?.pitch?.runIn !== 12 || geometry?.beamWidthIn !== 8 || JSON.stringify(geometry?.beamStationsFt) !== '[8,16]') issues.push(issue('REGER_BEAM_GEOMETRY_DRIFT', 'The corrected 18.5 by 24 foot, two-plane, beam-partitioned vault changed.'));
  const replay = replayRegerFloresBoxBeamCalibration(value);
  const yStations = replay.status === 'passed' ? replay.heads.map((head) => head.pointPt[1]) : [];
  if (replay.status !== 'passed' || replay.heads.length !== 6 || JSON.stringify(yStations) !== '[4,12,20,4,12,20]' || replay.regions.some((region) => region.partitionCells?.length !== 3)) issues.push(issue('REGER_BEAM_REPLAY_MISMATCH', 'Beam-aware replay must produce three protected cells per plane and six heads.'));
  const answer = value.answerEvidence; const result = value.calibrationResult;
  if (answer?.roomLabel !== 'LOUNGE VAULTED' || answer?.headCount !== 6 || answer?.slopeColumnCount !== 2 || answer?.ridgeDirectionRowsPerColumn !== 3
    || result?.status !== 'passed' || result?.generatedHeadCount !== 6 || result?.generatedSlopeColumnCount !== 2 || result?.generatedRidgeDirectionRowsPerColumn !== 3 || result?.topologyParityPassed !== true || result?.exactPlanPlacementClaimed !== false) issues.push(issue('REGER_BEAM_CALIBRATION_RESULT_DRIFT', 'Answer-exposed topology calibration must remain six heads in two columns by three rows without exact-placement promotion.'));
  if (value.sequence?.failedFreshComparisonReceiptSha256 !== '51a8afef5cf735d73a031bc66af86063f385960ecf816932488bfabe99b2cfd7' || value.sequence?.answerExposedBeforeThisCorrection !== true || value.sequence?.eligibleAsFreshHoldout !== false
    || value.unseenProjectPlacementVerified !== false || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('REGER_BEAM_FALSE_PROMOTION', 'Answer-exposed calibration cannot become fresh acceptance or downstream readiness.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed' || value.internalVerification?.adversarial?.status !== 'passed' || value.internalVerification?.adversarial?.rejectedCases?.length !== 7) issues.push(issue('REGER_BEAM_LOOPS_INCOMPLETE', 'Primary, independent, and seven-case adversarial loops are required.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, calibrationReady: issues.length === 0, freshHoldoutRequired: true, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyRegerFloresBoxBeamCalibrationAdversarialLoop(packet) {
  const cases = [
    ['length', (v) => { v.geometry.lengthFt = 16; }], ['beam-remove', (v) => { v.geometry.beamStationsFt.pop(); }], ['beam-shift', (v) => { v.geometry.beamStationsFt[0] = 7; }],
    ['answer-count', (v) => { v.answerEvidence.headCount = 4; }], ['sequence', (v) => { v.sequence.answerExposedBeforeThisCorrection = false; }],
    ['fresh-pass', (v) => { v.unseenProjectPlacementVerified = true; }], ['compliance-pass', (v) => { v.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [name, mutate] of cases) { const changed = structuredClone(packet); mutate(changed); if ((await validateRegerFloresBoxBeamCalibration(await sealRegerFloresBoxBeamCalibration(changed))).status === 'blocked') rejectedCases.push(name); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, totalCases: cases.length };
}
