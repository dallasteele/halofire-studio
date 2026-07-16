/**
 * Validates the bounded New Hope CML.01 source-feed fabrication registration.
 *
 * The field set and AutoSPRINK listing prove one 4-inch fabricated piece and
 * its 4 x 3 upward outlet. Approved hydraulic routes independently register
 * calculation node 118 at that outlet. The source-bound dry cross-main grade
 * rule and the riser-room drain destination are sufficient to produce the
 * as-designed high-to-low direction and endpoint Z values for CML.01. They do
 * not prove a field-measured installed slope or the concealed riser assembly.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_EDGE_IDS = Object.freeze(['source-edge-001', 'source-edge-002'])
const EXPECTED_GRADE_IN_PER_10_FT = 0.25
const OUTLET_FROM_START_IN = 29.5
const OUTLET_TO_FAR_END_IN = 6

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})
const round = (value, digits = 6) => Number(value.toFixed(digits))

function findCalculation118Port(routes) {
  const ports = []
  for (const route of routes || []) {
    const binding = (route.planNodeBindings || []).find(
      (entry) => entry.calculationNodeId === '118',
    )
    for (const leg of route.pipeTableLegs || []) {
      if (leg.node1 === '118') ports.push({ binding, elevationFt: leg.elevation1Ft })
      if (leg.node2 === '118') ports.push({ binding, elevationFt: leg.elevation2Ft })
    }
  }
  return ports
}

/**
 * Evaluates exact plan/listing/hydraulic agreement for CML.01 while preserving
 * fail-closed endpoint-Z, installed-grade, and concealed-riser-path states.
 *
 * @param {object} inputs - Canonical topology and source evidence.
 * @param {object} inputs.canonicalTopology - Canonical FP2.0 graph.
 * @param {object} inputs.governedSkeleton - Evaluated source/fabrication roles.
 * @param {object} inputs.operationalAnnotations - Field/listing annotations.
 * @param {object[]} inputs.hydraulicRoutes - Approved RA2-1/2/3 route packets.
 * @returns {object} Bounded source-feed fabrication validation result.
 */
export function evaluateNewHopeSourceFeedFabrication(inputs = {}) {
  const issues = []
  const { canonicalTopology, governedSkeleton, operationalAnnotations, hydraulicRoutes = [] } =
    inputs
  const binding = operationalAnnotations?.fabricationLineEvidence?.primaryLineBindings?.find(
    (entry) => entry.lineName === 'CML',
  )
  const edges = EXPECTED_EDGE_IDS.map((id) =>
    canonicalTopology?.edges?.find((entry) => entry.id === id),
  )
  const outletNode = canonicalTopology?.nodes?.find(
    (entry) => entry.id === 'canonical-node-002',
  )

  if (
    operationalAnnotations?.projectId !== EXPECTED_PROJECT_ID ||
    governedSkeleton?.projectId !== EXPECTED_PROJECT_ID ||
    canonicalTopology?.projectId !== EXPECTED_PROJECT_ID
  ) {
    issues.push(issue('NH_SOURCE_FEED_PROJECT_IDENTITY_INVALID', 'Every input must identify New Hope.'))
  }
  const crossMainGrade = operationalAnnotations?.gradeRequirements?.find(
    (entry) => entry.id === 'grade-cross-mains',
  )
  if (
    crossMainGrade?.pipeRole !== 'cross-main' ||
    crossMainGrade?.rawText !== 'SLOPE CROSS MAINS 1/4" EVERY 10\'-0"' ||
    crossMainGrade?.riseInPer10Ft !== EXPECTED_GRADE_IN_PER_10_FT ||
    operationalAnnotations?.supplyAnchor?.boundPrimaryNodeId !== 'pipe-001-node-01'
  ) {
    issues.push(issue('NH_SOURCE_FEED_DESIGN_GRADE_SOURCE_INVALID', 'CML.01 must retain the approved dry cross-main grade rule and the riser-room low-end anchor.'))
  }
  if (governedSkeleton?.status !== 'passed' || !governedSkeleton?.sourceFeedFabricationBindingReady) {
    issues.push(issue('NH_SOURCE_FEED_GOVERNED_BINDING_BLOCKED', 'The governed CML source binding must pass first.'))
  }
  if (
    JSON.stringify(binding?.sourceEdgeIds) !== JSON.stringify(EXPECTED_EDGE_IDS) ||
    binding?.sourceSegmentIds?.[0] !== 'pipe-001' ||
    binding?.pieceIds?.[0] !== 'CML.01' ||
    binding?.nominalDiameterIn !== 4 ||
    binding?.cutLengthIn !== 35.5
  ) {
    issues.push(issue('NH_SOURCE_FEED_CML_PIECE_INVALID', 'CML.01 must bind both split pipe-001 plan edges as one 4-inch, 35.5-inch fabricated piece.', 'CML.01'))
  }
  if (
    edges.some((edge) => !edge || edge.sourceSegmentId !== 'pipe-001') ||
    edges[0]?.toNodeId !== 'canonical-node-002' ||
    edges[1]?.fromNodeId !== 'canonical-node-002'
  ) {
    issues.push(issue('NH_SOURCE_FEED_PLAN_SPLIT_INVALID', 'The two CML.01 plan edges must meet at canonical outlet node 002.'))
  }
  if (
    JSON.stringify(outletNode?.memberNodeIds) !==
      JSON.stringify(['pipe-001-node-02', 'pipe-002-node-01']) ||
    binding?.outletCanonicalNodeId !== 'canonical-node-002' ||
    binding?.outletCalculationNodeId !== '118' ||
    binding?.outletFitting !== '4 x 3 grooved outlet' ||
    binding?.outletOrientation !== 'up-0-degrees' ||
    binding?.outletNominalDiameterIn !== 3 ||
    binding?.outletFromPieceStartIn !== 29.5 ||
    binding?.outletToPieceFarEndIn !== 6 ||
    binding?.downstreamSourceSegmentId !== 'pipe-002'
  ) {
    issues.push(issue('NH_SOURCE_FEED_OUTLET_TRANSITION_INVALID', 'The CML.01 outlet must remain the listed 4 x 3 upward transition to pipe-002 at canonical node 002.', 'canonical-node-002'))
  }
  const ports = findCalculation118Port(hydraulicRoutes)
  if (
    ports.length < 3 ||
    ports.some(
      ({ binding: portBinding, elevationFt }) =>
        portBinding?.canonicalNodeId !== 'canonical-node-002' || elevationFt !== 11.5,
    )
  ) {
    issues.push(issue('NH_SOURCE_FEED_OUTLET_Z_PORT_INVALID', 'Approved RA2-1/2/3 must retain calculation node 118 at canonical node 002 and local elevation 11.5 feet.', '118'))
  }
  if (
    binding?.endpointElevationStatus !== 'unresolved' ||
    binding?.installedGradeStatus !== 'unresolved'
  ) {
    issues.push(issue('NH_SOURCE_FEED_FALSE_3D_PROMOTION', 'CML.01 endpoints and installed grade cannot be promoted from plan/listing evidence.'))
  }

  const ready = issues.length === 0
  const outletElevationFt = ready ? ports[0].elevationFt : null
  const dropStartToOutletIn = (OUTLET_FROM_START_IN / 12) * (EXPECTED_GRADE_IN_PER_10_FT / 10)
  const dropOutletToFarEndIn = (OUTLET_TO_FAR_END_IN / 12) * (EXPECTED_GRADE_IN_PER_10_FT / 10)
  const designedNodeElevations = ready
    ? [
        { canonicalNodeId: 'canonical-node-001', role: 'riser-room-low-end', localElevationFt: round(outletElevationFt - dropStartToOutletIn / 12) },
        { canonicalNodeId: 'canonical-node-002', role: 'node-118-outlet', localElevationFt: outletElevationFt },
        { canonicalNodeId: 'canonical-node-003', role: 'cml01-far-high-end', localElevationFt: round(outletElevationFt + dropOutletToFarEndIn / 12) },
      ]
    : []
  const directedEdges = ready
    ? [
        {
          edgeId: 'source-edge-001',
          highNodeId: 'canonical-node-002',
          lowNodeId: 'canonical-node-001',
          requiredDropIn: round(dropStartToOutletIn),
          basis: 'approved-cross-main-grade-to-riser-room-low-end',
        },
        {
          edgeId: 'source-edge-002',
          highNodeId: 'canonical-node-003',
          lowNodeId: 'canonical-node-002',
          requiredDropIn: round(dropOutletToFarEndIn),
          basis: 'approved-cross-main-grade-to-riser-room-low-end',
        },
      ]
    : []
  return {
    artifactType: 'halofire.new-hope-source-feed-fabrication-result.v1',
    projectId: operationalAnnotations?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    piece: ready
      ? {
          lineName: 'CML',
          pieceId: 'CML.01',
          nominalDiameterIn: 4,
          cutLengthIn: 35.5,
          sourceEdgeIds: EXPECTED_EDGE_IDS,
        }
      : null,
    outlet: ready
      ? {
          canonicalNodeId: 'canonical-node-002',
          calculationNodeId: '118',
          localElevationFt: 11.5,
          fitting: '4 x 3 grooved outlet',
          orientation: 'up-0-degrees',
          downstreamNominalDiameterIn: 3,
        }
      : null,
    sourceFeedPlanFabricationReady: ready,
    sourceFeedOutletTransitionReady: ready,
    sourceFeedOutletElevationReady: ready,
    directedEdges,
    designedNodeElevations,
    designedEndpointElevationsReady: ready,
    designedGradeDirectionReady: ready,
    designedGradeMagnitudeReady: ready,
    cml01Plan3dPathReady: ready,
    installedGradeReady: false,
    concealedRiserContinuationReady: false,
    sourceFeed3dPathReady: false,
  }
}
