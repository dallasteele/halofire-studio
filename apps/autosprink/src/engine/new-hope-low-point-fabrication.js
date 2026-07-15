/**
 * Source-bound CMI.09 registration for the short low-point-01 connector.
 *
 * The field install set and fabrication listing identify the low-point end,
 * outlet sequence, and piece direction. The approved branch-line note then
 * supplies the installed grade magnitude. Hydraulic calculation nodes 182
 * and 67 independently register both plan nodes, but their equal rounded
 * elevations do not establish the small endpoint-Z differential.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_FIELD_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5'
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'
const EXPECTED_EDGE_IDS = Object.freeze(['source-edge-052', 'source-edge-053', 'source-edge-054'])

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})
const round = (value, digits = 6) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null)

function endpointElevation(leg, calculationNodeId) {
  if (leg?.node1 === calculationNodeId) return leg.elevation1Ft
  if (leg?.node2 === calculationNodeId) return leg.elevation2Ft
  return null
}

export function evaluateNewHopeLowPointFabrication(inputs = {}) {
  const issues = []
  const {
    canonicalTopology,
    governedSkeleton,
    operationalAnnotations,
    hydraulicRoutes = [],
  } = inputs
  const evidence = operationalAnnotations?.fabricationLineEvidence?.lowPointPieceBindings?.find(
    (entry) => entry.id === 'low-point-01-cmi09',
  )
  const fieldSet = operationalAnnotations?.fabricationLineEvidence?.fieldSet
  const listing = operationalAnnotations?.fabricationLineEvidence?.fabricationListing
  const lowPoint = operationalAnnotations?.lowPointAnchors?.find(
    (entry) => entry.id === 'low-point-01',
  )
  const grade = operationalAnnotations?.gradeRequirements?.find(
    (entry) => entry.id === 'grade-branch-lines',
  )
  const edgeById = new Map((canonicalTopology?.edges || []).map((edge) => [edge.id, edge]))
  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]))
  const edges = EXPECTED_EDGE_IDS.map((edgeId) => edgeById.get(edgeId))
  const remoteArea22 = hydraulicRoutes.find((route) => route.remoteAreaId === '2-2')
  const bindingByCalculationNode = new Map(
    (remoteArea22?.planNodeBindings || []).map((binding) => [binding.calculationNodeId, binding]),
  )
  const hydraulicLeg = (remoteArea22?.pipeTableLegs || []).find(
    (leg) =>
      [leg.node1, leg.node2].includes('182') && [leg.node1, leg.node2].includes('67'),
  )
  const planLeg = (remoteArea22?.planLegBindings || []).find(
    (leg) =>
      [leg.calculationFromNodeId, leg.calculationToNodeId].includes('182') &&
      [leg.calculationFromNodeId, leg.calculationToNodeId].includes('67'),
  )

  if (
    canonicalTopology?.projectId !== EXPECTED_PROJECT_ID ||
    governedSkeleton?.projectId !== EXPECTED_PROJECT_ID ||
    operationalAnnotations?.projectId !== EXPECTED_PROJECT_ID
  ) {
    issues.push(issue('NH_LOW_POINT_PROJECT_IDENTITY_INVALID', 'Every input must identify New Hope.'))
  }
  if (
    governedSkeleton?.status !== 'passed' ||
    !governedSkeleton?.primaryPipeRoleAssignmentReady
  ) {
    issues.push(issue('NH_LOW_POINT_GOVERNED_BINDING_BLOCKED', 'The governed plan roles must pass first.'))
  }
  if (
    fieldSet?.sha256 !== EXPECTED_FIELD_SHA ||
    fieldSet?.sheet !== 'FP2.0' ||
    fieldSet?.physicalPage !== 4 ||
    listing?.sha256 !== EXPECTED_LISTING_SHA ||
    listing?.fileName !== '24-052_NHCC_LIST.PDF'
  ) {
    issues.push(issue('NH_LOW_POINT_FABRICATION_SOURCE_INVALID', 'CMI.09 must remain bound to the exact field set and fabrication listing.'))
  }
  if (
    evidence?.lineName !== 'CMI' ||
    evidence?.pieceId !== 'CMI.09' ||
    evidence?.systemRole !== 'branch-line' ||
    evidence?.nominalDiameterIn !== 2.5 ||
    evidence?.cutLengthIn !== 64.5 ||
    evidence?.fabricationListingPage !== 15 ||
    evidence?.sourceSegmentId !== 'pipe-032' ||
    JSON.stringify(evidence?.sourceEdgeIds) !== JSON.stringify(EXPECTED_EDGE_IDS)
  ) {
    issues.push(issue('NH_LOW_POINT_CMI09_PIECE_INVALID', 'CMI.09 must remain the listed 2-1/2-inch, 64.5-inch pipe-032 piece.', 'CMI.09'))
  }
  if (
    edges.some((edge) => !edge || edge.sourceSegmentId !== 'pipe-032') ||
    edges[0]?.fromNodeId !== 'canonical-node-057' ||
    edges[0]?.toNodeId !== 'canonical-node-058' ||
    edges[1]?.fromNodeId !== 'canonical-node-058' ||
    edges[1]?.toNodeId !== 'canonical-node-059' ||
    edges[2]?.fromNodeId !== 'canonical-node-059' ||
    edges[2]?.toNodeId !== 'canonical-node-054'
  ) {
    issues.push(issue('NH_LOW_POINT_PLAN_TOPOLOGY_INVALID', 'The three pipe-032 plan edges must retain the CMI.09 far-end, sprinkler, branch-outlet, low-point sequence.'))
  }
  if (
    evidence?.pieceStartCanonicalNodeId !== 'canonical-node-054' ||
    evidence?.pieceFarEndCanonicalNodeId !== 'canonical-node-057' ||
    evidence?.pieceFarEndConnectedSourceSegmentId !== 'pipe-038' ||
    !nodeById.get('canonical-node-057')?.sourceSegmentIds?.includes('pipe-038')
  ) {
    issues.push(issue('NH_LOW_POINT_PIECE_ENDS_INVALID', 'CMI.09 must start at low-point node 054 and end at the pipe-038 junction node 057.'))
  }
  if (
    evidence?.firstOutletCanonicalNodeId !== 'canonical-node-059' ||
    evidence?.firstOutletFromPieceStartIn !== 7 ||
    evidence?.firstOutletFitting !== '2-1/2 x 2 grooved outlet' ||
    evidence?.firstOutletOrientation !== 'toward-87-degrees' ||
    evidence?.firstOutletDownstreamSourceSegmentId !== 'pipe-035' ||
    !nodeById.get('canonical-node-059')?.sourceSegmentIds?.includes('pipe-035')
  ) {
    issues.push(issue('NH_LOW_POINT_FIRST_OUTLET_INVALID', 'The first CMI.09 outlet must remain the listed 2-1/2 x 2 grooved outlet to pipe-035 at node 059.'))
  }
  if (
    evidence?.secondOutletCanonicalNodeId !== 'canonical-node-058' ||
    evidence?.secondOutletFromPieceStartIn !== 34 ||
    evidence?.secondOutletFitting !== '2-1/2 x 3/4 threaded outlet' ||
    evidence?.secondOutletOrientation !== 'up-0-degrees' ||
    evidence?.secondOutletSprinklerId !== 'head-017' ||
    JSON.stringify(nodeById.get('canonical-node-058')?.sprinklerIds) !== JSON.stringify(['head-017'])
  ) {
    issues.push(issue('NH_LOW_POINT_SECOND_OUTLET_INVALID', 'The second CMI.09 outlet must remain the listed upward 3/4-inch outlet to head-017 at node 058.'))
  }
  const firstStationPlanIn = (edges[2]?.planLengthFt || 0) * 12
  const secondStationPlanIn = ((edges[2]?.planLengthFt || 0) + (edges[1]?.planLengthFt || 0)) * 12
  const piecePlanLengthIn = edges.reduce((sum, edge) => sum + (edge?.planLengthFt || 0) * 12, 0)
  const maximumResidualIn = evidence?.maximumPlanStationResidualIn
  const stationResidualsIn = {
    firstOutlet: round(Math.abs((evidence?.firstOutletFromPieceStartIn || 0) - firstStationPlanIn)),
    secondOutlet: round(Math.abs((evidence?.secondOutletFromPieceStartIn || 0) - secondStationPlanIn)),
    farEnd: round(Math.abs((evidence?.cutLengthIn || 0) - piecePlanLengthIn)),
  }
  if (
    maximumResidualIn !== 3 ||
    Object.values(stationResidualsIn).some((residual) => residual > maximumResidualIn)
  ) {
    issues.push(issue('NH_LOW_POINT_PLAN_STATION_RESIDUAL_EXCEEDED', 'The plan nodes must remain within the bounded PDF-to-fabrication station tolerance.'))
  }
  if (
    lowPoint?.rawText !== 'LOW POINT TIE IN DRAIN' ||
    JSON.stringify(lowPoint?.boundPrimaryNodeIds) !==
      JSON.stringify(['pipe-032-node-04', 'pipe-035-node-01']) ||
    evidence?.lowPointId !== 'low-point-01' ||
    evidence?.lowCanonicalNodeId !== 'canonical-node-054' ||
    evidence?.highCanonicalNodeId !== 'canonical-node-059'
  ) {
    issues.push(issue('NH_LOW_POINT_DIRECTION_BINDING_INVALID', 'The CMI.09 piece start must remain the source-called-out low point, with node 059 high and node 054 low.'))
  }
  if (
    grade?.pipeRole !== 'branch-line' ||
    grade?.riseInPer10Ft !== 0.5 ||
    evidence?.gradeRequirementId !== 'grade-branch-lines'
  ) {
    issues.push(issue('NH_LOW_POINT_GRADE_MAGNITUDE_INVALID', 'CMI.09 must retain the approved one-half inch per ten feet branch-line grade.'))
  }
  if (
    bindingByCalculationNode.get('182')?.canonicalNodeId !== 'canonical-node-059' ||
    bindingByCalculationNode.get('67')?.canonicalNodeId !== 'canonical-node-054' ||
    evidence?.highCalculationNodeId !== '182' ||
    evidence?.lowCalculationNodeId !== '67' ||
    JSON.stringify(planLeg?.canonicalEdgeIds) !== JSON.stringify(['source-edge-054'])
  ) {
    issues.push(issue('NH_LOW_POINT_HYDRAULIC_PLAN_BINDING_INVALID', 'RA2-2 nodes 182 and 67 must remain bound across source-edge-054.'))
  }
  const highReportedElevationFt = endpointElevation(hydraulicLeg, '182')
  const lowReportedElevationFt = endpointElevation(hydraulicLeg, '67')
  if (
    hydraulicLeg?.nominalDiameterIn !== 2.5 ||
    hydraulicLeg?.lengthFt !== 0.833333 ||
    highReportedElevationFt !== 18.375 ||
    lowReportedElevationFt !== 18.375 ||
    evidence?.reportedEndpointElevationFt !== 18.375 ||
    evidence?.reportedEndpointElevationStatus !== 'equal-rounded'
  ) {
    issues.push(issue('NH_LOW_POINT_HYDRAULIC_ENDPOINT_INVALID', 'RA2-2 must retain the equal reported 18.375-foot endpoints on its 2-1/2-inch node 182-to-67 leg.'))
  }
  if (evidence?.exactDifferentialZStatus !== 'unresolved') {
    issues.push(issue('NH_LOW_POINT_FALSE_EXACT_Z_PROMOTION', 'Equal rounded calculation endpoints cannot promote the installed grade to exact differential Z.'))
  }

  const ready = issues.length === 0
  const requiredDropIn = round((edges[2]?.planLengthFt || 0) * (grade?.riseInPer10Ft || 0) / 10)
  return {
    artifactType: 'halofire.new-hope-low-point-fabrication-result.v1',
    projectId: operationalAnnotations?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    piece: ready
      ? {
          lineName: 'CMI',
          pieceId: 'CMI.09',
          nominalDiameterIn: 2.5,
          cutLengthIn: 64.5,
          sourceEdgeIds: EXPECTED_EDGE_IDS,
          stationResidualsIn,
        }
      : null,
    directedEdge: ready
      ? {
          edgeId: 'source-edge-054',
          sourceSegmentId: 'pipe-032',
          highNodeId: 'canonical-node-059',
          lowNodeId: 'canonical-node-054',
          planLengthFt: edges[2].planLengthFt,
          requiredDropIn,
        }
      : null,
    hydraulicEndpointReport: ready
      ? {
          highCalculationNodeId: '182',
          lowCalculationNodeId: '67',
          highReportedElevationFt,
          lowReportedElevationFt,
          exactDifferentialZReady: false,
        }
      : null,
    lowPointPieceFabricationReady: ready,
    lowPointPlanStationRegistrationReady: ready,
    lowPointRelativeGradeDirectionReady: ready,
    lowPointRelativeGradeMagnitudeReady: ready,
    exactDifferentialZReady: false,
    exactEndpointZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}
