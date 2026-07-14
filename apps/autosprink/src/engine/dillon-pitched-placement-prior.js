import { sha256Hex } from './elevation-datums.js';
import { validateSubmittedSlopedCeilingCalibration } from './submitted-sloped-ceiling-calibration.js';
import { generateSlopedCeilingLayout, verifySlopedCeilingLayoutParity } from './sloped-ceiling-layout.js';

const round = (value, digits = 6) => Number(value.toFixed(digits));
const distanceFt = (a, b, scale) => Math.hypot(a[0] - b[0], a[1] - b[1]) / scale;
const issue = (code, message) => ({ severity: 'blocking', code, message });

function layoutInput(packet) {
  return {
    artifactType: 'halofire.sloped-ceiling-layout-input.v1',
    printedScalePtPerFt: packet.printedScalePtPerFt,
    regions: packet.slopeRegions.map((region) => ({
      id: region.id,
      polygonSubmittedPt: region.polygonSubmittedPt,
      slopeAxis: region.slopeAxis,
      downhillDirection: region.downhillDirection,
      riseIn: 3,
      runIn: 12,
      shouldProtect: region.protectionBasis === 'completed-bid-protected',
      obstructions: region.obstructions.map(({ id, kind, centerSubmittedPt, clearanceFt, preferredSide }) => ({ id, kind, centerSubmittedPt, clearanceFt, preferredSide })),
    })),
    maxAcrossSlopeSpanFt: 20,
    maxAlongSlopeSpanFt: 12,
  };
}

export async function buildDillonPitchedPlacementPrior({ calibration, winterGardenHeldOut }) {
  const validation = await validateSubmittedSlopedCeilingCalibration(calibration);
  if (validation.status !== 'passed') throw new Error('Dillon calibration must pass before placement priors can be sealed.');
  if (winterGardenHeldOut?.artifactType !== 'halofire.winter-garden-source-pitched-heldout.v1'
    || winterGardenHeldOut.heldOutAcceptanceStatus !== 'failed'
    || winterGardenHeldOut.candidatePlacementVerified !== false) {
    throw new Error('The untouched Winter Garden failed holdout receipt is required as an exclusion control.');
  }
  const input = layoutInput(calibration);
  const layout = generateSlopedCeilingLayout(input);
  const parity = verifySlopedCeilingLayoutParity(layout, calibration);
  if (layout.status !== 'passed' || parity.status !== 'passed') throw new Error('Dillon layout replay must pass before placement priors can be sealed.');
  const region = calibration.slopeRegions.find((entry) => entry.id === 'slope-region-east-covered');
  const generatedRegion = layout.regions.find((entry) => entry.regionId === region.id);
  const submittedById = new Map(calibration.submittedHeads.map((head) => [head.id, head]));
  const completedPoints = region.submittedHeadIds.map((id) => submittedById.get(id).pointPt);
  const generatedPoints = layout.heads.filter((head) => head.regionId === region.id).map((head) => head.pointPt);
  const draft = {
    artifactType: 'halofire.dillon-pitched-placement-prior.v1',
    calibrationProject: 'Dillon Residence',
    trainingMode: 'completed-bid-calibration-only',
    sourceBindings: {
      calibrationReceiptSha256: calibration.evidenceReceiptSha256,
      sourceSha256: Object.fromEntries(calibration.sources.map((source) => [source.id, source.sha256])),
    },
    excludedHoldout: {
      projectName: 'LDS Meeting House - Winter Garden FL',
      receiptSha256: winterGardenHeldOut.receiptSha256,
      acceptanceStatus: 'failed',
      usedForTuning: false,
      mutationAllowed: false,
    },
    sourceEnvelopeGate: {
      required: ['closed-source-registered-ceiling-envelope', 'single-room-identity', 'source-slope-axis', 'source-obstruction-geometry-when-present'],
      reject: ['multi-room-identity-envelope', 'incomplete-semantic-boundary', 'roof-pitch-substituted-for-ceiling-pitch', 'missing-obstruction-evidence-promoted-as-clear'],
    },
    learnedGeometry: {
      ceilingPitchRiseInPer12: 3,
      envelopeWidthFt: round(generatedRegion.widthFt),
      envelopeAlongSlopeFt: round(generatedRegion.heightFt),
      envelopeAreaSqFt: round(generatedRegion.widthFt * generatedRegion.heightFt),
      completedHeadCount: completedPoints.length,
      completedAreaPerHeadSqFt: round(generatedRegion.widthFt * generatedRegion.heightFt / completedPoints.length),
      completedInterHeadDistanceFt: round(distanceFt(completedPoints[0], completedPoints[1], calibration.printedScalePtPerFt)),
      replayAcrossSlopeSpanFt: input.maxAcrossSlopeSpanFt,
      replayAlongSlopeSpanFt: input.maxAlongSlopeSpanFt,
      replayAcrossCount: generatedRegion.acrossCount,
      replayAlongCount: generatedRegion.alongCount,
      replayInterHeadDistanceFt: round(distanceFt(generatedPoints[0], generatedPoints[1], calibration.printedScalePtPerFt)),
      sourceObstructionAdjustment: generatedRegion.obstructionAdjustments[0],
    },
    calibrationResult: {
      precision: parity.metrics.precision,
      recall: parity.metrics.recall,
      maxPlanErrorFt: parity.metrics.maxPlanErrorFt,
      meanPlanErrorFt: parity.metrics.meanPlanErrorFt,
      emptyReferenceRegionFalsePositives: parity.falsePositiveEmptyRegions.length,
    },
    transferPolicy: {
      empiricalPriorOnly: true,
      codeLimit: false,
      obstructionClearanceTransferAllowed: false,
      protectionLabelTransferAllowed: false,
      unseenProjectHoldoutRequired: true,
      sourceBoundaryCompleteRequired: true,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-layout-replay' },
      independent: { status: 'passed', method: 'sealed-source-head-membership-and-registration' },
      adversarial: { status: 'passed', method: 'receipt-drift-and-holdout-mutation-rejection' },
    },
    candidatePlacementPriorReady: true,
    unseenProjectPlacementVerified: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'cross-project-empirical-placement-prior-not-code-compliance-or-design-approval',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateDillonPitchedPlacementPrior(packet, dependencies) {
  try {
    const expected = await buildDillonPitchedPlacementPrior(dependencies);
    const { receiptSha256, ...draft } = packet || {};
    const issues = [];
    if (packet?.artifactType !== expected.artifactType) issues.push(issue('DILLON_PLACEMENT_PRIOR_SCHEMA_INVALID', 'Placement prior artifact type is invalid.'));
    if (receiptSha256 !== await sha256Hex(draft) || receiptSha256 !== expected.receiptSha256) issues.push(issue('DILLON_PLACEMENT_PRIOR_RECEIPT_MISMATCH', 'Placement prior or its dependency bindings drifted.'));
    if (JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('DILLON_PLACEMENT_PRIOR_REPLAY_MISMATCH', 'Placement prior does not equal deterministic calibration replay.'));
    return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : packet, candidatePlacementPriorReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
  } catch (error) {
    return { status: 'blocked', issues: [issue('DILLON_PLACEMENT_PRIOR_DEPENDENCY_INVALID', error.message)], packet: null, candidatePlacementPriorReady: false, unseenProjectPlacementVerified: false, complianceReady: false };
  }
}
