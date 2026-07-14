import { sha256Hex } from './elevation-datums.js';
import { validatePolarisSourceOnlyAtticCandidate } from './polaris-academy-source-only-attic-holdout.js';

const PROJECT_ID = 'polaris-academy-mesa-az';
const SOURCE_COMMIT = 'caa5723d89d6bacad255acb35ddffa71592c3391';
const EVIDENCE_RECEIPT = '363afb88705ad516f1432c8b85a2f47f077154ca977e3f4dc5d31013cb142da9';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function validatePolarisAnswerEvidence(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.polaris-answer-extracted-evidence.v1' || packet?.projectId !== PROJECT_ID || packet?.answerOpenedAfterSourceCommit !== SOURCE_COMMIT) return { status: 'blocked', issues: [issue('POLARIS_ANSWER_IDENTITY_INVALID', 'Answer evidence is not bound to the post-source-commit Polaris comparison.')], answerEvidenceReady: false, complianceReady: false };
  const { receiptSha256, ...draft } = packet;
  if (receiptSha256 !== EVIDENCE_RECEIPT || await sha256Hex(draft) !== receiptSha256) issues.push(issue('POLARIS_ANSWER_RECEIPT_MISMATCH', 'Answer-extracted evidence changed.'));
  const bindings = packet.bindings || {};
  if (bindings.fireSprinklerCadV2?.sha256 !== '3b27b60d74c6058508789929ad0ca20df490c28905828b5ac096183454154c2f' || bindings.approvedFp2?.sha256 !== '06c502687ce21d66aee8d7c5212cb5ff2b5e31e17a7433bd22448de12ca80dd1' || bindings.asBuiltSprinkler?.sha256 !== '1442be77da8d08388084e6f56ee3ddfea9565f08307022449267d065a504e81a' || bindings.approvedAndAsBuiltFp2RasterSha256 !== '9bfc1f1f01299e86ff3335ed865f7bd977504b8bd8535bbac81a5534edc01904') issues.push(issue('POLARIS_ANSWER_BINDING_DRIFT', 'Approved, as-built, CAD, or raster-parity bindings changed.'));
  const registration = packet.coordinateRegistration;
  if (registration?.matchedVertexCount !== 73 || registration?.maxResidualInches !== 1.8e-11 || registration?.libredwgUnknownEntityCount !== 0 || registration?.answerToSourceTranslationInches?.[0] !== 2089.742556327576 || registration?.answerToSourceTranslationInches?.[1] !== 545.357810486682) issues.push(issue('POLARIS_ANSWER_REGISTRATION_DRIFT', 'The answer CAD no longer registers exactly to the sealed architectural outline.'));
  const summary = packet.summary;
  const pendent = packet.sprinklers?.filter((head) => head.kind === 'pendent') || [];
  const upright = packet.sprinklers?.filter((head) => head.kind === 'upright') || [];
  if (packet.sprinklers?.length !== 158 || pendent.length !== 81 || upright.length !== 77 || summary?.totalHeadCount !== 158 || summary?.headCounts?.pendent !== 81 || summary?.headCounts?.upright !== 77 || summary?.insideSourceFootprintCount !== 158 || summary?.outsideSourceFootprintCount !== 0 || summary?.pipeCount !== 186 || summary?.fittingCount !== 98) issues.push(issue('POLARIS_ANSWER_TALLY_DRIFT', 'Head, pipe, fitting, or footprint tally changed.'));
  if (pendent.some((head) => ![10, 12].includes(head.pointFt?.[2]) || head.size !== '½') || upright.some((head) => head.pointFt?.[2] < 10.75 || head.pointFt?.[2] > 17.458333 || head.size !== '1') || packet.sprinklers?.some((head) => head.insideSourceFootprint !== true)) issues.push(issue('POLARIS_ANSWER_GEOMETRY_DRIFT', 'Pendent or upright elevation/type geometry changed.'));
  if (packet.answerUse?.usedToChangeBlindCandidate !== false || packet.answerUse?.usedForAnswerExposedCalibration !== true || packet.answerUse?.codeLimitClaimed !== false || packet.answerUse?.wholeRoofFaceTopologyProven !== false || packet.answerUse?.complianceReady !== false || packet.answerUse?.fabricationReady !== false) issues.push(issue('POLARIS_ANSWER_FALSE_PROMOTION', 'Answer evidence must remain calibration-only and fail closed downstream.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, answerEvidenceReady: issues.length === 0, complianceReady: false };
}

export async function buildPolarisHeldoutComparison(blindCandidate, answerEvidence, sourceDependencies) {
  if ((await validatePolarisSourceOnlyAtticCandidate(blindCandidate, sourceDependencies)).status !== 'passed') throw new Error('POLARIS_BLIND_CANDIDATE_BLOCKED');
  if ((await validatePolarisAnswerEvidence(answerEvidence)).status !== 'passed') throw new Error('POLARIS_ANSWER_EVIDENCE_BLOCKED');
  const pendentElevations = answerEvidence.sprinklers.filter((head) => head.kind === 'pendent').map((head) => head.pointFt[2]);
  const uprightElevations = answerEvidence.sprinklers.filter((head) => head.kind === 'upright').map((head) => head.pointFt[2]);
  const draft = {
    artifactType: 'halofire.polaris-pitched-attic-heldout-comparison.v1', projectId: PROJECT_ID, projectName: blindCandidate.projectName,
    sourceOnlyCommit: SOURCE_COMMIT, blindCandidateReceiptSha256: blindCandidate.receiptSha256, answerEvidenceReceiptSha256: answerEvidence.receiptSha256,
    answerOpenedAfterBlindCommit: true, blindCandidateMutatedAfterAnswerOpen: false,
    sourceBuildingModel: blindCandidate.buildingModel,
    sourceOnlyResult: {
      v5Decision: blindCandidate.selectorGuard,
      generatedHeadCount: blindCandidate.heads3d.length,
      candidatePlacementReady: blindCandidate.candidatePlacementReady,
      claim: blindCandidate.claimStatus,
    },
    approvedAndAsBuilt: {
      rasterParity: true, rasterSha256: answerEvidence.bindings.approvedAndAsBuiltFp2RasterSha256,
      totalHeadCount: 158,
      systems: [
        { id: 'below-flat-ceilings', kind: 'pendent', count: 81, elevationRangeFt: [Math.min(...pendentElevations), Math.max(...pendentElevations)], scheduledElevationsFt: [10, 12], headModel: 'Victaulic V2708 FL-QR', kFactor: 5.6 },
        { id: 'pitched-attic', kind: 'upright', count: 77, elevationRangeFt: [Math.min(...uprightElevations), Math.max(...uprightElevations)], headModel: 'Victaulic V2704 FL-QR IGS', kFactor: 5.6 },
      ],
      registeredHeads3d: answerEvidence.sprinklers,
      pipeCount: answerEvidence.summary.pipeCount, pipeSizeCounts: answerEvidence.summary.pipeSizeCounts,
      fittingCount: answerEvidence.summary.fittingCount, fittingKindCounts: answerEvidence.summary.fittingKindCounts,
      hydraulicRemoteAreasVisible: ['attic', 'below ceiling'],
    },
    result: {
      status: 'passed-domain-guard-failed-placement-coverage',
      wrongDomainGuardWorked: true,
      blindPlacementAttempted: false,
      blindGeneratedVersusAnswerHeadDelta: -158,
      blindGeneratedVersusAtticHeadDelta: -77,
      unseenProjectPlacementVerified: false,
      finding: 'v5 correctly refused to treat a pitched attic as an occupied two-plane vault, but the system has no source-only attic placement regime and therefore generated none of the 77 approved/as-built attic uprights or 81 below-ceiling pendents',
    },
    answerExposedCalibration: {
      ready: true, singleProjectOnly: true,
      exactArchitecturalRegistration: { vertexCount: 73, maxResidualInches: answerEvidence.coordinateRegistration.maxResidualInches },
      observableRegime: 'one-story flat occupied ceilings below multi-mass 4:12 hip/gable attic',
      empiricalCounts: { total: 158, pendent: 81, upright: 77, pipes: 186, fittings: 98 },
      exactCoordinateTransferAllowed: false, normalizedCoordinateTransferAllowed: false, causalRuleClaimed: false, codeLimitClaimed: false,
      requiredBeforeFreshPrediction: ['source-derived whole roof face topology', 'attic compartment and draft-stop boundaries', 'per-face head projection and obstruction inventory', 'source-only attic selector with explicit domain bounds'],
    },
    internalVerification: {
      primary: { status: 'passed', method: 'LibreDWG answer CAD component and 3D attribute extraction' },
      independent: { status: 'passed', method: 'approved FP2 and as-built FP2 byte-render parity plus 81/77 sheet legend' },
      adversarial: { status: 'passed', method: 'commit-order, receipt, raster, registration, system-count, elevation, mutation, failure-erasure, and false-promotion attacks' },
    },
    pitchedAtticCalibrationReady: true, pitchedAtticSelectorReadyForFreshHoldout: false,
    pitchedAtticHeadLayoutReady: false, wholeRoofModelReady: false, hydraulicCalculationReady: false,
    complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'derive the Polaris source roof-face and attic-compartment topology without using head coordinates as geometry, register the 77 answer uprights to those source faces for answer-exposed calibration, then run a second fresh attic holdout',
    claimStatus: 'answer-exposed-polaris-attic-and-below-ceiling-calibration-with-correct-domain-rejection-but-no-fresh-attic-placement-verification-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validatePolarisHeldoutComparison(packet, dependencies) {
  let expected;
  try { expected = await buildPolarisHeldoutComparison(dependencies.blindCandidate, dependencies.answerEvidence, dependencies.sourceDependencies); } catch (error) { return { status: 'blocked', issues: [issue('POLARIS_COMPARISON_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('POLARIS_COMPARISON_REPLAY_MISMATCH', 'Comparison no longer equals the blind-candidate plus sealed-answer replay.'));
  if (packet?.sourceOnlyCommit !== SOURCE_COMMIT || packet?.answerOpenedAfterBlindCommit !== true || packet?.blindCandidateMutatedAfterAnswerOpen !== false || packet?.sourceOnlyResult?.generatedHeadCount !== 0) issues.push(issue('POLARIS_COMPARISON_ORDERING_DRIFT', 'Blind commit ordering or immutable zero-head result changed.'));
  if (packet?.approvedAndAsBuilt?.rasterParity !== true || packet?.approvedAndAsBuilt?.totalHeadCount !== 158 || packet?.approvedAndAsBuilt?.systems?.[0]?.count !== 81 || packet?.approvedAndAsBuilt?.systems?.[1]?.count !== 77 || packet?.approvedAndAsBuilt?.registeredHeads3d?.length !== 158 || packet?.approvedAndAsBuilt?.pipeCount !== 186 || packet?.approvedAndAsBuilt?.fittingCount !== 98) issues.push(issue('POLARIS_COMPARISON_ANSWER_DRIFT', 'Approved/as-built system evidence changed.'));
  if (packet?.result?.status !== 'passed-domain-guard-failed-placement-coverage' || packet?.result?.wrongDomainGuardWorked !== true || packet?.result?.blindPlacementAttempted !== false || packet?.result?.blindGeneratedVersusAtticHeadDelta !== -77 || packet?.result?.unseenProjectPlacementVerified !== false) issues.push(issue('POLARIS_COMPARISON_FAILURE_ERASED', 'Correct guard and unverified placement failure must both remain explicit.'));
  if (packet?.answerExposedCalibration?.singleProjectOnly !== true || packet?.answerExposedCalibration?.exactCoordinateTransferAllowed !== false || packet?.pitchedAtticSelectorReadyForFreshHoldout !== false || packet?.pitchedAtticHeadLayoutReady !== false || packet?.wholeRoofModelReady !== false || packet?.hydraulicCalculationReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('POLARIS_COMPARISON_FALSE_PROMOTION', 'Single-project calibration must not promote a fresh selector, layout, roof, hydraulics, compliance, or fabrication.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, comparisonReady: issues.length === 0, wrongDomainGuardWorked: true, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyPolarisHeldoutComparisonAdversarialLoop(packet, dependencies) {
  const cases = [
    ['commit', (v) => { v.sourceOnlyCommit = '0'.repeat(40); }], ['candidate', (v) => { v.blindCandidateReceiptSha256 = '0'.repeat(64); }], ['answer', (v) => { v.answerEvidenceReceiptSha256 = 'f'.repeat(64); }],
    ['ordering', (v) => { v.answerOpenedAfterBlindCommit = false; }], ['mutation', (v) => { v.blindCandidateMutatedAfterAnswerOpen = true; }], ['blind-count', (v) => { v.sourceOnlyResult.generatedHeadCount = 77; }],
    ['raster', (v) => { v.approvedAndAsBuilt.rasterParity = false; }], ['pendent', (v) => { v.approvedAndAsBuilt.systems[0].count = 80; }], ['upright', (v) => { v.approvedAndAsBuilt.systems[1].count = 76; }],
    ['head', (v) => { v.approvedAndAsBuilt.registeredHeads3d.pop(); }], ['pipe', (v) => { v.approvedAndAsBuilt.pipeCount = 185; }], ['failure', (v) => { v.result.unseenProjectPlacementVerified = true; }],
    ['transfer', (v) => { v.answerExposedCalibration.exactCoordinateTransferAllowed = true; }], ['selector', (v) => { v.pitchedAtticSelectorReadyForFreshHoldout = true; }], ['compliance', (v) => { v.complianceReady = true; }], ['receipt', (v) => { v.receiptSha256 = 'a'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validatePolarisHeldoutComparison(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, unseenProjectPlacementVerified: false, complianceReady: false };
}

export function renderPolarisHeldoutComparisonViews(packet) {
  const polygon = packet.approvedAndAsBuilt.registeredHeads3d.length && packet.sourceBuildingModel?.levels?.[0]?.footprintPolygonFt;
  const sourcePoints = polygon || [];
  const bounds = packet.sourceBuildingModel?.boundsFt || { width: 178.041667, depth: 68.75 };
  const sx = 4.45; const sy = 4.45; const ox = 60; const oy = 55;
  const footprint = sourcePoints.map(([x, y]) => `${round(ox + x * sx)},${round(oy + (bounds.depth - y) * sy)}`).join(' ');
  const heads = packet.approvedAndAsBuilt.registeredHeads3d;
  const circles = heads.map((head) => `<circle class="${head.kind}" cx="${round(ox + head.pointFt[0] * sx)}" cy="${round(oy + (bounds.depth - head.pointFt[1]) * sy)}" r="${head.kind === 'upright' ? 3.4 : 3}"/>`).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 430" role="img" aria-label="Polaris approved and as-built head overlay"><style>rect{fill:#07111f}.footprint{fill:#10233b;stroke:#94a3b8;stroke-width:2}.pendent{fill:#22d3ee}.upright{fill:#f59e0b;stroke:#fff;stroke-width:.5}text{fill:#e2e8f0;font:14px sans-serif}.warn{fill:#fbbf24}</style><rect width="930" height="430"/><polygon class="footprint" points="${footprint}"/>${circles}<text x="22" y="26">ANSWER-EXPOSED approved/as-built overlay: 81 pendents (cyan) + 77 attic uprights (orange) = 158</text><text class="warn" x="22" y="414">Blind source result: 0 - correct wrong-domain guard, failed placement coverage</text></svg>`;
  const ex = (x) => 55 + x * 4.5; const ez = (z) => 380 - z * 18;
  const elevationHeads = heads.map((head) => `<circle class="${head.kind}" cx="${round(ex(head.pointFt[0]))}" cy="${round(ez(head.pointFt[2]))}" r="${head.kind === 'upright' ? 3.5 : 3}"/>`).join('');
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 420" role="img" aria-label="Polaris approved and as-built sprinkler elevations"><style>rect{fill:#07111f}.grid{stroke:#334155;stroke-width:1}.pendent{fill:#22d3ee}.upright{fill:#f59e0b;stroke:#fff;stroke-width:.5}text{fill:#e2e8f0;font:14px sans-serif}.warn{fill:#fbbf24}</style><rect width="930" height="420"/><line class="grid" x1="55" y1="${ez(10)}" x2="856" y2="${ez(10)}"/><line class="grid" x1="55" y1="${ez(12)}" x2="856" y2="${ez(12)}"/>${elevationHeads}<text x="22" y="26">ANSWER-EXPOSED elevation: flat pendents at 10/12 ft; attic uprights 10.75-17.458 ft</text><text class="warn" x="22" y="405">Actual elevations shown; source roof-face assignment still required before transfer</text></svg>`;
  const iso = ([x, y, z]) => [round(80 + x * 3.45 + y * 1.2), round(360 - y * 1.2 - z * 7.5)];
  const modelHeads = heads.map((head) => { const [x, y] = iso(head.pointFt); return `<circle class="${head.kind}" cx="${x}" cy="${y}" r="${head.kind === 'upright' ? 3.2 : 2.7}"/>`; }).join('');
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 430" role="img" aria-label="Polaris answer-exposed 3D head cloud"><style>rect{fill:#07111f}.pendent{fill:#22d3ee}.upright{fill:#f59e0b;stroke:#fff;stroke-width:.5}text{fill:#e2e8f0;font:14px sans-serif}.warn{fill:#fbbf24}</style><rect width="930" height="430"/>${modelHeads}<text x="22" y="26">ANSWER-EXPOSED registered 3D head cloud: 158 heads inside exact architectural footprint</text><text class="warn" x="22" y="414">Calibration evidence only - not a source-generated, code-compliant, or fabrication-ready model</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, unseenProjectPlacementVerified: false, complianceReady: false };
}
