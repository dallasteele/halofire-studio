/**
 * Source-bound relative drainage schedule for all twelve one-inch terminal
 * arm-overs visible on New Hope FP2.0. The approved plan fixes XY, the field
 * set and threaded-pipeline listing bind line/piece groups and fittings, and
 * the governed topology binds each terminal sprinkler to its carrier. This
 * module only establishes relative high-to-low direction and minimum grade;
 * it never promotes those facts to absolute pipe Z or field-release truth.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut';
const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5';
const EXPECTED_FIELD_SET_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5';
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734';
const EXPECTED_FAB_SHA = 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9';
const EXPECTED_BGC_LISTING_SHA = '7FE066904709725ABD407C786B28B87E2B34DBC3071DCF6462B66D11F7E7D141';
const EXPECTED_BGC_INSTALL_SHA = '6F20B0AD824AAAE6A8A71FAC46E5FAF89E5904EEF0AD762CF98B8D0ED186B252';
const EXPECTED_EDGE_IDS = Object.freeze([
  'source-edge-021', 'source-edge-022', 'source-edge-030', 'source-edge-031',
  'source-edge-084', 'source-edge-085', 'source-edge-086', 'source-edge-087',
  'source-edge-108', 'source-edge-109', 'source-edge-110', 'source-edge-111',
]);

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const sorted = (values) => [...values].sort();
const round = (value, digits = 6) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

function exactSet(actual, expected) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

function validateCutLengthSet(planLengthsIn, listedCutLengthsIn) {
  if (planLengthsIn.length !== listedCutLengthsIn.length) return false;
  const plans = [...planLengthsIn].sort((a, b) => a - b);
  const listed = [...listedCutLengthsIn].sort((a, b) => a - b);
  return plans.every((plan, index) => listed[index] >= plan && listed[index] - plan <= 2);
}

export function evaluateNewHopeArmOverDrainage({
  pipeVectors,
  canonicalTopology,
  governedSkeleton,
  operationalAnnotations,
  longBranchDrainage,
  sideBranchDrainage,
  crossMainDrainage,
  centralBranchDrainage,
}) {
  const issues = [];
  const evidence = operationalAnnotations?.armOverFabricationEvidence;
  const roleBySegmentId = new Map((governedSkeleton?.primaryAssignments || []).map((entry) => [entry.sourceSegmentId, entry.systemRole]));
  const edgeById = new Map((canonicalTopology?.edges || []).map((edge) => [edge.id, edge]));
  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]));
  const sprinklerById = new Map((pipeVectors?.sprinklers || []).map((sprinkler) => [sprinkler.id, sprinkler]));

  if (pipeVectors?.projectId !== EXPECTED_PROJECT_ID
    || canonicalTopology?.projectId !== EXPECTED_PROJECT_ID
    || governedSkeleton?.projectId !== EXPECTED_PROJECT_ID
    || operationalAnnotations?.projectId !== EXPECTED_PROJECT_ID) {
    issues.push(issue('NH_ARM_OVER_PROJECT_IDENTITY_INVALID', 'All arm-over inputs must identify the New Hope project.'));
  }
  if (pipeVectors?.source?.sha256 !== EXPECTED_PLAN_SHA || pipeVectors?.source?.sheet !== 'FP2.0' || pipeVectors?.source?.physicalPage !== 5) {
    issues.push(issue('NH_ARM_OVER_PLAN_SOURCE_INVALID', 'Arm-over drainage must remain bound to the exact approved FP2.0 source page.'));
  }
  if (evidence?.artifactType !== 'halofire.approved-fp20-arm-over-fabrication-evidence.v1'
    || evidence?.fieldSet?.sha256 !== EXPECTED_FIELD_SET_SHA
    || evidence?.fabricationListing?.sha256 !== EXPECTED_LISTING_SHA
    || evidence?.fabricationArchive?.sha256 !== EXPECTED_FAB_SHA
    || JSON.stringify(evidence?.fabricationListing?.threadedPipelinePages) !== JSON.stringify([41, 42])) {
    issues.push(issue('NH_ARM_OVER_FABRICATION_SOURCE_INVALID', 'Field set, threaded-pipeline listing pages, and FAB archive must remain exact.'));
  }
  if (evidence?.crossProjectMethodCalibration?.fieldSetListing?.sha256 !== EXPECTED_BGC_LISTING_SHA
    || evidence?.crossProjectMethodCalibration?.installPlan?.sha256 !== EXPECTED_BGC_INSTALL_SHA
    || !evidence?.crossProjectMethodCalibration?.scope?.includes('does not prove New Hope grade')) {
    issues.push(issue('NH_ARM_OVER_CROSS_PROJECT_CALIBRATION_INVALID', 'The independent BGC extraction-method calibration must remain exact and explicitly non-promotional.'));
  }
  const grade = operationalAnnotations?.gradeRequirements?.find((entry) => entry.id === 'grade-branch-lines');
  if (grade?.pipeRole !== 'branch-line' || grade?.riseInPer10Ft !== 0.5
    || evidence?.generatedDrainageRule?.riseInPer10Ft !== 0.5
    || evidence?.generatedDrainageRule?.highEnd !== 'terminal-sprinkler'
    || evidence?.generatedDrainageRule?.lowEnd !== 'carrier-junction'
    || evidence?.generatedDrainageRule?.absolutePipeCenterlineZReady !== false) {
    issues.push(issue('NH_ARM_OVER_GRADE_RULE_INVALID', 'Arm-overs must inherit the approved one-half-inch-per-ten-foot branch grade without claiming absolute Z.'));
  }

  const groups = evidence?.groups || [];
  const bindings = evidence?.terminalSprinklerBindings || [];
  const groupEdgeIds = groups.flatMap((group) => group.sourceEdgeIds || []);
  const bindingEdgeIds = bindings.map((binding) => binding.sourceEdgeId);
  if (groups.length !== 6 || bindings.length !== 12
    || !exactSet(groupEdgeIds, EXPECTED_EDGE_IDS)
    || !exactSet(bindingEdgeIds, EXPECTED_EDGE_IDS)
    || new Set(groupEdgeIds).size !== 12
    || new Set(bindingEdgeIds).size !== 12) {
    issues.push(issue('NH_ARM_OVER_INVENTORY_INVALID', 'The evidence must bind exactly six fabrication groups and twelve unique source arm-over edges.'));
  }

  for (const group of groups) {
    const edges = (group.sourceEdgeIds || []).map((id) => edgeById.get(id)).filter(Boolean);
    if (edges.length !== group.sourceEdgeIds?.length
      || !exactSet(edges.map((edge) => edge.sourceSegmentId), group.sourceSegmentIds || [])
      || !edges.every((edge) => roleBySegmentId.get(edge.sourceSegmentId) === 'arm-over')
      || !validateCutLengthSet(edges.map((edge) => edge.planLengthFt * 12), group.listedCutLengthsIn || [])
      || !['branch-line', 'cross-main'].includes(group.carrierRole)
      || !['cmk-riser-return', 'riser-return', 'low-point-02', 'low-point-03'].includes(group.drainageCatchmentId)) {
      issues.push(issue('NH_ARM_OVER_FABRICATION_BINDING_INVALID', `${group.id || 'unknown group'} no longer matches its source edges, roles, cut-length set, or catchment.`, group.id));
    }
  }

  const directedEdges = [];
  for (const binding of bindings) {
    const edge = edgeById.get(binding.sourceEdgeId);
    const terminal = nodeById.get(binding.terminalCanonicalNodeId);
    const carrier = nodeById.get(binding.carrierCanonicalNodeId);
    const sprinkler = sprinklerById.get(binding.sprinklerId);
    const group = groups.find((entry) => entry.sourceEdgeIds?.includes(binding.sourceEdgeId));
    const terminalDegree = (canonicalTopology?.edges || []).filter((entry) => entry.fromNodeId === binding.terminalCanonicalNodeId || entry.toNodeId === binding.terminalCanonicalNodeId).length;
    const carrierIncidentNonArmSegments = (canonicalTopology?.edges || [])
      .filter((entry) => entry.fromNodeId === binding.carrierCanonicalNodeId || entry.toNodeId === binding.carrierCanonicalNodeId)
      .filter((entry) => entry.id !== binding.sourceEdgeId)
      .map((entry) => entry.sourceSegmentId);
    const uniqueCarrierSegments = [...new Set(carrierIncidentNonArmSegments)];
    if (!edge || edge.sourceSegmentId !== binding.sourceSegmentId
      || ![edge.fromNodeId, edge.toNodeId].includes(binding.terminalCanonicalNodeId)
      || ![edge.fromNodeId, edge.toNodeId].includes(binding.carrierCanonicalNodeId)
      || terminalDegree !== 1
      || terminal?.kind !== 'sprinkler-junction'
      || !exactSet(terminal?.sprinklerIds || [], [binding.sprinklerId])
      || !carrier
      || uniqueCarrierSegments.length !== 1
      || roleBySegmentId.get(uniqueCarrierSegments[0]) !== group?.carrierRole) {
      issues.push(issue('NH_ARM_OVER_TERMINAL_TOPOLOGY_INVALID', 'Every arm-over must connect one terminal sprinkler node to exactly one source-bound carrier role.', binding.sourceEdgeId));
      continue;
    }
    if (sprinkler?.symbolType !== binding.symbolType
      || sprinkler?.nearestPipeSegmentId !== binding.sourceSegmentId
      || !Number.isFinite(sprinkler?.pipeDistancePdfPt)
      || sprinkler.pipeDistancePdfPt > binding.maximumResidualPdfPt
      || binding.maximumResidualPdfPt > 2) {
      issues.push(issue('NH_ARM_OVER_TERMINAL_SPRINKLER_INVALID', 'The terminal sprinkler symbol and sub-two-point residual must remain bound to the exact arm-over segment.', binding.sourceEdgeId));
    }
    directedEdges.push({
      edgeId: edge.id,
      sourceSegmentId: edge.sourceSegmentId,
      lineName: group?.lineName,
      highNodeId: binding.terminalCanonicalNodeId,
      lowNodeId: binding.carrierCanonicalNodeId,
      highPdfPt: terminal?.pdfPt,
      lowPdfPt: carrier?.pdfPt,
      sprinklerId: binding.sprinklerId,
      symbolType: binding.symbolType,
      carrierRole: group?.carrierRole,
      drainageCatchmentId: group?.drainageCatchmentId,
      planLengthFt: edge.planLengthFt,
      requiredDropIn: round(edge.planLengthFt * grade?.riseInPer10Ft / 10),
      absoluteEndpointElevationsReady: false,
    });
  }

  if (!longBranchDrainage?.longBranchGradeDirectionReady
    || !longBranchDrainage?.longBranchRelativeGradeProfilesReady
    || !sideBranchDrainage?.sideBranchLineGradeDirectionReady
    || !sideBranchDrainage?.sideBranchRelativeGradeProfilesReady
    || !crossMainDrainage?.crossMainGradeDirectionReady
    || !crossMainDrainage?.crossMainRelativeGradeProfilesReady
    || !crossMainDrainage?.crossMainRiserReturnReady
    || !centralBranchDrainage?.centralBranchGeneratedGradeDirectionReady
    || !centralBranchDrainage?.centralBranchRelativeGradeProfilesReady
    || !centralBranchDrainage?.centralLoopDirectionReady) {
    issues.push(issue('NH_ARM_OVER_UPSTREAM_DRAINAGE_NOT_READY', 'All four source-bound carrier drainage schedules must pass before whole-sheet direction can pass.'));
  }

  const ready = issues.length === 0 && directedEdges.length === 12;
  return {
    artifactType: 'halofire.new-hope-arm-over-drainage-result.v1',
    projectId: pipeVectors?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    directedEdges,
    catchmentCounts: Object.fromEntries(['cmk-riser-return', 'riser-return', 'low-point-02', 'low-point-03'].map((id) => [id, directedEdges.filter((edge) => edge.drainageCatchmentId === id).length])),
    metrics: {
      fabricationGroupCount: groups.length,
      sourceEdgeCount: bindingEdgeIds.length,
      terminalSprinklerCount: bindings.length,
      directedEdgeCount: directedEdges.length,
      relativeProfileCount: directedEdges.length,
    },
    armOverSourceTopologyReady: ready,
    armOverTerminalSprinklerBindingReady: ready,
    armOverFabricationBindingReady: ready,
    armOverCrossProjectMethodCalibrationReady: ready,
    armOverGeneratedGradeDirectionReady: ready,
    armOverRelativeGradeProfilesReady: ready,
    allTwelveArmOverDrainageReady: ready,
    sideBranchArmOverDrainageReady: ready,
    centralBranchArmOverDrainageReady: ready,
    wholeFp20GradeDirectionReady: ready,
    exactPipeCenterlineZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
