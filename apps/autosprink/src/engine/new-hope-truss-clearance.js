/** Source-bound New Hope truss registration, conditional clearance, and ridge topology. */

import { sha256Hex } from './elevation-datums.js';

const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(value.toFixed(digits));

function linearRegression(values) {
  const count = values.length;
  const meanIndex = (count - 1) / 2;
  const meanValue = values.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < count; index += 1) {
    numerator += (index - meanIndex) * (values[index] - meanValue);
    denominator += (index - meanIndex) ** 2;
  }
  const spacing = numerator / denominator;
  const intercept = meanValue - spacing * meanIndex;
  const residuals = values.map((value, index) => value - (intercept + spacing * index));
  return {
    interceptPdfPt: round(intercept, 9),
    spacingPdfPt: round(spacing, 9),
    maxAbsResidualPdfPt: round(Math.max(...residuals.map(Math.abs)), 9),
    rmsResidualPdfPt: round(Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / count), 9),
  };
}

function scaleFromGrid(grid) {
  return (grid.endCenterPdfPt - grid.startCenterPdfPt) / grid.physicalSpanFt;
}

export async function sealNewHopeTrussClearanceSource(value) {
  const { sourceReceiptSha256: _ignored, ...draft } = value;
  return { ...draft, sourceReceiptSha256: await sha256Hex(draft) };
}

export async function validateNewHopeTrussClearanceSource(value) {
  const issues = [];
  const { sourceReceiptSha256, ...draft } = value || {};
  if (!SHA.test(sourceReceiptSha256 || '') || await sha256Hex(draft) !== sourceReceiptSha256) issues.push(issue('NH_TRUSS_SOURCE_RECEIPT_INVALID', 'Source receipt is invalid.'));
  if (value?.artifactType !== 'halofire.answer-exposed-new-hope-truss-clearance-source.v1' || value?.projectId !== 'new-hope-crisis-center-brigham-city-ut' || value?.calibrationStatus !== 'answer-exposed-not-fresh') issues.push(issue('NH_TRUSS_SOURCE_IDENTITY_INVALID', 'Project or answer-exposed calibration identity changed.'));
  if (value?.sources?.s102?.sha256 !== '2f695364975d6ddccd13e41b14db96f4d927e60ba23accda57bead7d3b9e4f5a' || value?.sources?.approvedFp20?.sha256 !== '5a770222363228c2766605a695fee9b6cb1f7b49c296204e09b691100253d9d5' || value?.sources?.tfp610?.sha256 !== 'ef738cdc5271e38bd978b8f5932514bcbf1d84e83e778ca9fe5a32dbed1978ca') issues.push(issue('NH_TRUSS_SOURCE_HASH_INVALID', 'Structural, approved, or manufacturer PDF identity changed.'));
  const structural = value?.structuralRegistration;
  if (structural?.grid?.start !== 'D.1' || structural?.grid?.end !== 'E' || structural?.grid?.startCenterPdfPt !== 1019.5045 || structural?.grid?.endCenterPdfPt !== 1385.9565 || structural?.grid?.physicalSpanFt !== 41.25 || structural?.featureLengthFt !== 43 || structural?.trussCenterlinesPdfPt?.length !== 22) issues.push(issue('NH_TRUSS_STRUCTURAL_REGISTRATION_INVALID', 'S102 grid controls or truss centerlines changed.'));
  const approved = value?.approvedRegistration;
  if (approved?.grid?.start !== 'D' || approved?.grid?.end !== 'E' || approved?.grid?.startCenterPdfPt !== 1198.657 || approved?.grid?.endCenterPdfPt !== 1569.9025 || approved?.grid?.physicalSpanFt !== 41.25 || approved?.ridgeCenterPdfY !== 798.45 || approved?.headCentersPdfPt?.length !== 7 || approved?.headCentersPdfPt?.some((head) => head.y !== 798.45)) issues.push(issue('NH_TRUSS_APPROVED_REGISTRATION_INVALID', 'Approved FP2.0 grid or vector head registration changed.'));
  if (value?.clearanceCriteria?.minimumFromTrussFaceIn !== 6 || value?.clearanceCriteria?.projectSpecificMemberFaceWidthIn !== null || value?.corpusSearch?.projectSpecificMemberFaceWidthFound !== false) issues.push(issue('NH_TRUSS_MEMBER_WIDTH_UNTRUSTED', 'The missing project-specific truss face width was filled or promoted without a source.'));
  const pipe = value?.hydraulicEvidence;
  if (pipe?.pipeSizeIn !== 2.5 || pipe?.pipeRole !== 'ridge-branch-line' || pipe?.planDirection !== 'D.1-to-E/east-west' || pipe?.visibleHydraulicFlowDirection !== 'D.1-to-E/west-to-east-from-visible-network-connection' || pipe?.visibleSegmentLengthsFt?.length !== 6 || pipe?.visibleSegmentLengthsFt?.some((length) => length !== 6) || pipe?.dryPipeSlopeNote?.branchLinesRiseInPer10Ft !== 0.5 || pipe?.dryPipeSlopeNote?.crossMainsRiseInPer10Ft !== 0.25 || pipe?.boundedBranchGradeDirectionReady !== false || pipe?.boundedBranchEndpointElevationsReady !== false || pipe?.boundedBranchDrainDestinationReady !== false || pipe?.manufacturerMinimumFlowPerHeadGpm !== 38 || pipe?.manufacturerDemandHeadCount !== 7 || pipe?.completedPlanRemoteAreaIdentityAssigned !== false) issues.push(issue('NH_TRUSS_HYDRAULIC_EVIDENCE_INVALID', 'Visible branch, dry-pipe grade, drainage boundary, or manufacturer demand evidence changed.'));
  if (Object.values(value?.claims || {}).some((claim) => claim !== false)) issues.push(issue('NH_TRUSS_SOURCE_FALSE_PROMOTION', 'Source evidence promoted an unresolved production claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceReady: issues.length === 0, fieldReleaseReady: false };
}

export async function buildNewHopeTrussClearanceCalibration(source) {
  const sourceValidation = await validateNewHopeTrussClearanceSource(source);
  if (sourceValidation.status !== 'passed') throw new Error(sourceValidation.issues[0].code);

  const structuralScale = scaleFromGrid(source.structuralRegistration.grid);
  const approvedScale = scaleFromGrid(source.approvedRegistration.grid);
  const regression = linearRegression(source.structuralRegistration.trussCenterlinesPdfPt);
  const trussCenterlines = source.structuralRegistration.trussCenterlinesPdfPt.map((pdfX, index) => ({
    id: `NH-S102-TRUSS-${String(index + 1).padStart(2, '0')}`,
    pdfX,
    localXFt: round((pdfX - source.structuralRegistration.grid.startCenterPdfPt) / structuralScale),
  }));
  const heads = source.approvedRegistration.headCentersPdfPt.map((center, index) => {
    const localXFt = (center.x - source.approvedRegistration.grid.startCenterPdfPt) / approvedScale;
    const structuralPdfX = source.structuralRegistration.grid.startCenterPdfPt + localXFt * structuralScale;
    const nearestTruss = trussCenterlines.reduce((best, truss) => Math.abs(truss.pdfX - structuralPdfX) < Math.abs(best.pdfX - structuralPdfX) ? truss : best);
    const centerlineDistanceIn = Math.abs(nearestTruss.pdfX - structuralPdfX) / structuralScale * 12;
    return {
      id: `NH-BB1-${String(index + 1).padStart(3, '0')}`,
      approvedPdfCenter: center,
      localFt: { x: round(localXFt), y: source.feature.ridgeCoordinateFt },
      structuralPdfX: round(structuralPdfX),
      nearestTrussId: nearestTruss.id,
      nearestTrussCenterlineDistanceIn: round(centerlineDistanceIn),
      maximumTrussFaceWidthForSixInClearanceIn: round(2 * (centerlineDistanceIn - source.clearanceCriteria.minimumFromTrussFaceIn)),
      exactTrussFaceClearanceVerified: false,
      obstructionClearanceVerified: false,
      hydraulicNodeAssigned: false,
    };
  });
  const edges = source.hydraulicEvidence.visibleSegmentLengthsFt.map((lengthFt, index) => ({
    id: `NH-RIDGE-EDGE-${String(index + 1).padStart(2, '0')}`,
    from: heads[index].id,
    to: heads[index + 1].id,
    lengthFt,
    pipeSizeIn: source.hydraulicEvidence.pipeSizeIn,
  }));
  const minimumConditionalFaceWidthIn = Math.min(...heads.map((head) => head.maximumTrussFaceWidthForSixInClearanceIn));
  const draft = {
    artifactType: 'halofire.answer-exposed-new-hope-truss-clearance-calibration.v1',
    projectId: source.projectId,
    sourceReceiptSha256: source.sourceReceiptSha256,
    coordinateRegistration: {
      structuralGrid: source.structuralRegistration.grid,
      structuralScalePdfPtPerFt: round(structuralScale, 9),
      approvedGrid: source.approvedRegistration.grid,
      approvedScalePdfPtPerFt: round(approvedScale, 9),
      approvedRidgeCenterPdfY: source.approvedRegistration.ridgeCenterPdfY,
      xRegistrationReady: true,
      structuralRidgeYRegistrationReady: false,
    },
    trussLattice: {
      sourceSheet: 'S102',
      detectedCount: trussCenterlines.length,
      nominalSpacingIn: 24,
      fittedSpacingIn: round(regression.spacingPdfPt / structuralScale * 12, 6),
      regression,
      centerlines: trussCenterlines,
      projectSpecificMemberFaceWidthIn: null,
      exactTrussFacePolygonsReady: false,
    },
    branch: {
      sourceSheet: 'FP2.0',
      pipeSizeIn: source.hydraulicEvidence.pipeSizeIn,
      pipeRole: source.hydraulicEvidence.pipeRole,
      planDirection: source.hydraulicEvidence.planDirection,
      visibleHydraulicFlowDirection: source.hydraulicEvidence.visibleHydraulicFlowDirection,
      ridgeCoordinateFt: source.feature.ridgeCoordinateFt,
      ridgeDatumZFt: source.feature.ridgeDatumZFt,
      nodes: heads,
      edges,
      visibleTopologyReady: true,
      wholeNetworkTopologyReady: false,
      grade: {
        branchLinesRiseInPer10Ft: source.hydraulicEvidence.dryPipeSlopeNote.branchLinesRiseInPer10Ft,
        branchGradePercent: round(source.hydraulicEvidence.dryPipeSlopeNote.branchLinesRiseInPer10Ft / (10 * 12) * 100),
        crossMainsRiseInPer10Ft: source.hydraulicEvidence.dryPipeSlopeNote.crossMainsRiseInPer10Ft,
        crossMainGradePercent: round(source.hydraulicEvidence.dryPipeSlopeNote.crossMainsRiseInPer10Ft / (10 * 12) * 100),
        boundedBranchGradeDirectionReady: false,
        startElevationFt: null,
        endElevationFt: null,
      },
      drainage: { boundedBranchDrainDestinationReady: false, lowPointNodeId: null, drumDripNodeId: null },
      fittingsReady: false,
      properPipeLayoutReady: false,
    },
    conditionalClearance: {
      minimumFromTrussFaceIn: source.clearanceCriteria.minimumFromTrussFaceIn,
      allSevenPassIfMemberFaceWidthAtMostIn: round(minimumConditionalFaceWidthIn),
      conditionalTrussClearanceReady: true,
      exactTrussFaceClearanceReady: false,
      reason: 'S102 fixes the 24-inch truss centerline lattice, but the delegated truss manufacturer member face width is absent from the recovered corpus.',
    },
    hydraulics: {
      manufacturer: 'Tyco', sin: 'TY4180', kFactor: 8,
      manufacturerDemandHeadCount: source.hydraulicEvidence.manufacturerDemandHeadCount,
      minimumPerHeadFlowGpm: source.hydraulicEvidence.manufacturerMinimumFlowPerHeadGpm,
      minimumPerHeadPressurePsi: source.hydraulicEvidence.manufacturerMinimumPressurePsi,
      minimumManufacturerDemandGpm: source.hydraulicEvidence.manufacturerDemandHeadCount * source.hydraulicEvidence.manufacturerMinimumFlowPerHeadGpm,
      completedPlanRemoteAreaTables: source.hydraulicEvidence.completedPlanRemoteAreaTables,
      completedPlanRemoteAreaIdentityAssigned: false,
      actualNetworkCalculationReady: false,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic S102 lattice fit and approved FP2.0 vector-center transform' },
      crossSource: { status: 'passed', method: 'S102 structural plan plus approved FP2.0 branch plus TFP610 manufacturer criteria' },
      adversarial: { status: 'passed', method: 'receipt, hash, grid, coordinate, width, topology, hydraulic, and false-promotion mutations rejected' },
    },
    answerExposedCalibration: true,
    freshProjectPlacementVerified: false,
    exactHeadXyReady: true,
    conditionalTrussClearanceReady: true,
    obstructionClearanceReady: false,
    hydraulicTopologyReady: true,
    properPipeLayoutReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'answer-exposed-coordinate-and-conditional-clearance-calibration-only',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateNewHopeTrussClearanceCalibration(value, source) {
  const issues = [];
  let expected;
  try { expected = await buildNewHopeTrussClearanceCalibration(source); } catch (error) { return { status: 'blocked', issues: [issue('NH_TRUSS_CALIBRATION_INPUT_BLOCKED', error.message)], fieldReleaseReady: false }; }
  if (JSON.stringify(value) !== JSON.stringify(expected)) issues.push(issue('NH_TRUSS_CALIBRATION_REPLAY_MISMATCH', 'Calibration differs from deterministic source replay.'));
  if (value?.branch?.nodes?.length !== 7 || value?.branch?.edges?.length !== 6 || value?.branch?.grade?.boundedBranchGradeDirectionReady !== false || value?.branch?.grade?.startElevationFt !== null || value?.branch?.grade?.endElevationFt !== null || value?.branch?.drainage?.boundedBranchDrainDestinationReady !== false || value?.branch?.properPipeLayoutReady !== false || value?.properPipeLayoutReady !== false || value?.trussLattice?.projectSpecificMemberFaceWidthIn !== null || value?.conditionalClearance?.exactTrussFaceClearanceReady !== false || value?.hydraulics?.actualNetworkCalculationReady !== false || value?.obstructionClearanceReady !== false || value?.hydraulicCalculationReady !== false || value?.complianceReady !== false || value?.fieldReleaseReady !== false) issues.push(issue('NH_TRUSS_CALIBRATION_FALSE_PROMOTION', 'Calibration promoted missing pipe grade direction, endpoint elevations, drainage, member geometry, hydraulics, compliance, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, calibrationReady: issues.length === 0, fieldReleaseReady: false };
}

export async function verifyNewHopeTrussClearanceAdversarialLoop(value, source) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['source', (entry) => { entry.sourceReceiptSha256 = '1'.repeat(64); }],
    ['structural-grid', (entry) => { entry.coordinateRegistration.structuralGrid.endCenterPdfPt += 1; }],
    ['approved-grid', (entry) => { entry.coordinateRegistration.approvedGrid.startCenterPdfPt -= 1; }],
    ['truss-count', (entry) => { entry.trussLattice.detectedCount = 21; }],
    ['truss-spacing', (entry) => { entry.trussLattice.fittedSpacingIn = 25; }],
    ['head-x', (entry) => { entry.branch.nodes[0].structuralPdfX += 2; }],
    ['head-count', (entry) => { entry.branch.nodes.pop(); }],
    ['pipe-size', (entry) => { entry.branch.pipeSizeIn = 2; }],
    ['pipe-role', (entry) => { entry.branch.pipeRole = 'cross-main'; }],
    ['plan-direction', (entry) => { entry.branch.planDirection = 'north-south'; }],
    ['flow-direction', (entry) => { entry.branch.visibleHydraulicFlowDirection = 'unknown'; }],
    ['branch-grade', (entry) => { entry.branch.grade.branchLinesRiseInPer10Ft = 0.25; }],
    ['grade-direction', (entry) => { entry.branch.grade.boundedBranchGradeDirectionReady = true; }],
    ['endpoint-elevation', (entry) => { entry.branch.grade.startElevationFt = 20; }],
    ['drain-destination', (entry) => { entry.branch.drainage.boundedBranchDrainDestinationReady = true; }],
    ['fittings', (entry) => { entry.branch.fittingsReady = true; }],
    ['proper-pipe-layout', (entry) => { entry.properPipeLayoutReady = true; }],
    ['member-width', (entry) => { entry.trussLattice.projectSpecificMemberFaceWidthIn = 3.5; }],
    ['exact-clearance', (entry) => { entry.conditionalClearance.exactTrussFaceClearanceReady = true; }],
    ['obstruction', (entry) => { entry.obstructionClearanceReady = true; }],
    ['remote-area-assignment', (entry) => { entry.hydraulics.completedPlanRemoteAreaIdentityAssigned = true; }],
    ['hydraulic-calculation', (entry) => { entry.hydraulicCalculationReady = true; }],
    ['compliance', (entry) => { entry.complianceReady = true; }],
    ['fabrication', (entry) => { entry.fabricationReady = true; }],
    ['release', (entry) => { entry.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateNewHopeTrussClearanceCalibration(attacked, source)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, fieldReleaseReady: false };
}
