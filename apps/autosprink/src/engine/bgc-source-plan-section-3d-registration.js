import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'boys-girls-club-community-center-brigham-city-ut';
const SOURCES = Object.freeze({
  architectural: ['f220c7841dfd1ca7fc0b8eaf8f440d0b63a1541b8228c7c006e4c44a88180b20', 18178437, 'A301', 15],
  ahjApproved: ['799fba69311eb3aa285d6b96cb346aed184b3093d73777737597d23df60a0a18', 5313661, 'FP 1.0', 3],
  asBuilt: ['6f20b0ad824aaae6a8a71fac46e5faf89e5904eef0ad762cf98b8d0ed186b252', 14918460, 'FP 1.0', 3],
});
const SHA = /^[0-9a-f]{64}$/;
const near = (actual, expected, tolerance = 1e-6) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const issue = (code, message) => ({ severity: 'blocking', code, message });

export async function validateBgcSourcePlanSection3dRegistration(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.bgc-source-plan-section-3d-registration.v1' || packet?.projectId !== PROJECT_ID) {
    return { status: 'blocked', issues: [issue('BGC_SOURCE_3D_IDENTITY_INVALID', 'BGC source registration identity is invalid.')], sourcePlanCoordinatesVerified: false, complianceReady: false };
  }
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('BGC_SOURCE_3D_RECEIPT_MISMATCH', 'Registration receipt changed.'));
  for (const [role, [sha256, bytes, sheet, physicalPage]] of Object.entries(SOURCES)) {
    const source = packet.sourceBindings?.[role];
    if (!source || source.sha256 !== sha256 || source.bytes !== bytes || source.sheet !== sheet || source.physicalPage !== physicalPage) issues.push(issue('BGC_SOURCE_3D_SOURCE_DRIFT', `${role} source binding changed.`));
  }

  const asBuilt = packet.detectors?.asBuilt;
  if (asBuilt?.pageDrawingCount !== 21076 || asBuilt?.guardedUprightCount !== 64 || asBuilt?.signature?.rectWidthPt !== 9 || asBuilt?.signature?.rectHeightPt !== 8.875 || asBuilt?.signature?.itemCount !== 25 || asBuilt?.signature?.itemKinds !== 'l'.repeat(25) || asBuilt?.signature?.strokeWidthPt !== 0.4 || JSON.stringify(asBuilt?.signature?.color) !== '[0,0,0]') issues.push(issue('BGC_SOURCE_3D_ASBUILT_SIGNATURE_DRIFT', 'As-built native guarded-upright signature or 64-count changed.'));
  const approved = packet.detectors?.ahjApproved;
  if (approved?.pageDrawingCount !== 87907 || approved?.guardedUprightCount !== 64 || approved?.signature?.itemCount !== 8 || approved?.signature?.itemKinds !== 'llcllcll' || JSON.stringify(approved?.signature?.regionPdf) !== '[1100,1300,1900,2250]') issues.push(issue('BGC_SOURCE_3D_APPROVED_SIGNATURE_DRIFT', 'Approved-plan independent signature or 64-count changed.'));
  if (packet.detectors?.approvedToAsBuiltParity?.status !== 'passed' || packet.detectors?.approvedToAsBuiltParity?.headCountMatched !== true || packet.detectors?.approvedToAsBuiltParity?.topologyFamilyMatched !== true || packet.detectors?.approvedToAsBuiltParity?.coordinateParityClaimed !== false) issues.push(issue('BGC_SOURCE_3D_CROSS_SOURCE_PARITY_DRIFT', 'Approved-to-as-built topology parity changed or coordinate parity was falsely promoted.'));

  const plan = packet.registration?.plan;
  const envelope = packet.registration?.envelope;
  const section = packet.registration?.section;
  const expectedGrids = { 2: 744.5359497070312, 3: 978.5359497070312, 4: 1212.5359497070312, 5: 1446.5359497070312, 6: 1680.5359497070312 };
  if (JSON.stringify(plan?.gridXPdfPt) !== JSON.stringify(expectedGrids) || plan?.grid2To6SpanPt !== 936 || plan?.grid2To6SpanFt !== 104 || plan?.pdfPointsPerFt !== 9 || !near(plan?.ridgeYPdfPt, 1488.861328125)) issues.push(issue('BGC_SOURCE_3D_PLAN_REGISTRATION_DRIFT', 'Grid 2-6, scale, or ridge registration changed.'));
  if (envelope?.lengthFt !== 104 || envelope?.widthFt !== 89.5 || envelope?.floorElevationFt !== 100 || envelope?.eaveElevationFt !== 25 || envelope?.ridgeElevationFt !== 32.458333 || envelope?.pitchRiseInPer12 !== 2) issues.push(issue('BGC_SOURCE_3D_ENVELOPE_DRIFT', 'BGC architectural envelope or elevation datum changed.'));
  if (JSON.stringify(section?.leftEavePdfPoint) !== '[82.08,332.16]' || JSON.stringify(section?.ridgePdfPoint) !== '[202.32,312.12]' || JSON.stringify(section?.rightEavePdfPoint) !== '[322.56,332.16]' || !near(section?.leftSlopeRisePerRun, 1 / 6, 1e-6) || !near(section?.rightSlopeRisePerRun, 1 / 6, 1e-6) || section?.nativeVectorPitchVerified !== true) issues.push(issue('BGC_SOURCE_3D_SECTION_VECTOR_DRIFT', 'Native A301 2:12 roof vectors changed.'));
  const offset = plan?.branchHalfOffset;
  if (!Array.isArray(offset?.upperHalfXPt) || offset.upperHalfXPt.length !== 8 || !Array.isArray(offset?.lowerHalfXPt) || offset.lowerHalfXPt.length !== 8 || !Array.isArray(offset?.lowerMinusUpperOffsetsPt) || offset.lowerMinusUpperOffsetsPt.length !== 8 || !near(offset?.meanOffsetPt, 4.162476) || offset?.maxOffsetResidualPt > 0.001) issues.push(issue('BGC_SOURCE_3D_BRANCH_OFFSET_DRIFT', 'Source-observed branch-half shift changed or was normalized away.'));

  const graph = packet.geometryGraph;
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  if (graph?.nodeCount !== 64 || nodes.length !== 64 || graph?.edgeCount !== 48 || edges.length !== 48 || !SHA.test(graph?.digestSha256 || '') || await sha256Hex({ nodes, edges }) !== graph?.digestSha256) issues.push(issue('BGC_SOURCE_3D_GRAPH_DIGEST_DRIFT', 'Canonical 64-node/48-edge graph changed.'));
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== 64) issues.push(issue('BGC_SOURCE_3D_NODE_ID_DUPLICATE', 'Canonical head identities are not unique.'));
  for (const node of nodes) {
    const [pdfX, pdfY] = node.planPdfPoint || [];
    const expectedAlong = (pdfX - 744.5359497070312) / 9;
    const expectedAcross = (pdfY - 1488.861328125) / 9;
    const expectedZ = 32.458333 - Math.abs(expectedAcross) * 2 / 12;
    if (!near(node.planPointFt?.[0], expectedAlong, 1e-6) || !near(node.planPointFt?.[1], expectedAcross, 1e-6) || !near(node.roofSurfaceTargetElevationFt, expectedZ, 1e-6) || node.targetOnly !== true || node.exactInstalledElevationVerified !== false) issues.push(issue('BGC_SOURCE_3D_NODE_COORDINATE_DRIFT', `${node.id || 'unknown'} no longer closes to source plan/roof target geometry.`));
  }
  for (let branch = 1; branch <= 8; branch += 1) {
    const branchNodes = nodes.filter((node) => node.branchIndex === branch).sort((a, b) => a.acrossSlopePosition - b.acrossSlopePosition);
    if (branchNodes.length !== 8 || branchNodes.some((node, index) => node.acrossSlopePosition !== index + 1)) issues.push(issue('BGC_SOURCE_3D_BRANCH_MEMBERSHIP_DRIFT', `Branch ${branch} is not an eight-head source family.`));
    for (const start of [1, 2, 3, 5, 6, 7]) {
      const from = `BGC-H-${String(branch).padStart(2, '0')}-${String(start).padStart(2, '0')}`;
      const to = `BGC-H-${String(branch).padStart(2, '0')}-${String(start + 1).padStart(2, '0')}`;
      const edge = edges.find((candidate) => candidate.from === from && candidate.to === to);
      if (!edge || edge.kind !== 'source-proven-branch-half' || edge.sourceVectorCoverageVerified !== true || edge.pipeSizeVerified !== false || edge.pipeGradeVerified !== false || edge.exactInstalledElevationVerified !== false) issues.push(issue('BGC_SOURCE_3D_EDGE_TOPOLOGY_DRIFT', `${from} to ${to} is not a source-covered fail-closed branch-half edge.`));
    }
  }
  const viewDigests = Object.values(packet.viewBindings || {}).map((view) => view.geometryGraphSha256);
  if (viewDigests.length !== 3 || viewDigests.some((digest) => digest !== graph?.digestSha256) || packet.viewBindings?.topPlan?.source !== 'asBuilt' || packet.viewBindings?.elevation?.source !== 'architectural' || !packet.viewBindings?.model3d?.sourceTexture?.endsWith('bgc-plan-source.png')) issues.push(issue('BGC_SOURCE_3D_VIEW_BINDING_DRIFT', 'Top, elevation, and 3D views no longer share the canonical graph and real source underlays.'));
  if (packet.internalVerification?.primary?.status !== 'passed' || packet.internalVerification?.crossSource?.status !== 'passed' || packet.internalVerification?.adversarial?.status !== 'passed') issues.push(issue('BGC_SOURCE_3D_LOOPS_INCOMPLETE', 'Primary, cross-source, and adversarial loops must pass.'));
  if (packet.sourcePlanCoordinatesVerified !== true || packet.sourceBranchHalfAdjacencyVerified !== true || packet.roofSurfaceTargetProjectionVerified !== true || packet.exactInstalledSprinklerElevationVerified !== false || packet.exactInstalledPipeElevationVerified !== false || packet.pipeDirectionVerified !== false || packet.pipeGradeVerified !== false || packet.hydraulicCalculationReady !== false || packet.complianceReady !== false || packet.fabricationReady !== false || packet.fieldReleaseReady !== false || packet.vpsReleaseReady !== false) issues.push(issue('BGC_SOURCE_3D_FALSE_PROMOTION', 'Unproven installed Z, direction, grade, hydraulic, compliance, fabrication, field, or VPS claims must remain false.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourcePlanCoordinatesVerified: issues.length === 0, sourceBranchHalfAdjacencyVerified: issues.length === 0, roofSurfaceTargetProjectionVerified: issues.length === 0, exactInstalledPipeElevationVerified: false, pipeGradeVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false, vpsReleaseReady: false };
}

export async function verifyBgcSourcePlanSection3dAdversarialLoop(packet) {
  const cases = [
    ['asbuilt-hash', (value) => { value.sourceBindings.asBuilt.sha256 = '0'.repeat(64); }],
    ['approved-page', (value) => { value.sourceBindings.ahjApproved.physicalPage = 2; }],
    ['asbuilt-signature', (value) => { value.detectors.asBuilt.signature.itemCount = 24; }],
    ['approved-count', (value) => { value.detectors.ahjApproved.guardedUprightCount = 63; }],
    ['coordinate-parity-promotion', (value) => { value.detectors.approvedToAsBuiltParity.coordinateParityClaimed = true; }],
    ['scale', (value) => { value.registration.plan.pdfPointsPerFt = 8; }],
    ['ridge', (value) => { value.registration.plan.ridgeYPdfPt += 1; }],
    ['branch-offset', (value) => { value.registration.plan.branchHalfOffset.meanOffsetPt = 0; }],
    ['pitch', (value) => { value.registration.envelope.pitchRiseInPer12 = 3; }],
    ['node-coordinate', (value) => { value.geometryGraph.nodes[0].planPointFt[0] += 1; }],
    ['edge-removal', (value) => { value.geometryGraph.edges.pop(); value.geometryGraph.edgeCount -= 1; }],
    ['view-graph', (value) => { value.viewBindings.model3d.geometryGraphSha256 = '1'.repeat(64); }],
    ['installed-z-promotion', (value) => { value.exactInstalledPipeElevationVerified = true; }],
    ['grade-promotion', (value) => { value.pipeGradeVerified = true; }],
    ['release-promotion', (value) => { value.vpsReleaseReady = true; }],
    ['receipt', (value) => { value.receiptSha256 = 'f'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validateBgcSourcePlanSection3dRegistration(value)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, sourcePlanCoordinatesVerified: rejectedCases.length === cases.length, exactInstalledPipeElevationVerified: false, pipeGradeVerified: false, complianceReady: false, vpsReleaseReady: false };
}
