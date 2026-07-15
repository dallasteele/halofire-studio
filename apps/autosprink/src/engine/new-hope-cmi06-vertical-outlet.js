/**
 * Source-bound CMI.06 fabrication and exact head-057 vertical outlet.
 *
 * The field set and AutoSPRINK listing identify the full 3-inch cross-main
 * piece and all four upward 3 x 1 threaded outlets. Approved RA2-2 then proves
 * only the final outlet's one-foot same-XY vertical leg and endpoint Z values.
 * Other outlet drops and the whole-system fitting/Z schedule remain closed.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_FIELD_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5'
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'
const EXPECTED_EDGE_IDS = Object.freeze([
  'source-edge-139',
  'source-edge-140',
  'source-edge-141',
  'source-edge-142',
  'source-edge-143',
])
const EXPECTED_OUTLETS = Object.freeze([
  ['canonical-node-139', 'head-064', 15],
  ['canonical-node-140', 'head-063', 87],
  ['canonical-node-141', 'head-058', 159],
  ['canonical-node-142', 'head-057', 231],
])

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})
const round = (value, digits = 6) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null

function findRemoteArea22VerticalEvidence(routes) {
  const route = (routes || []).find((entry) => entry.remoteAreaId === '2-2')
  const bindings = new Map(
    (route?.planNodeBindings || []).map((binding) => [binding.calculationNodeId, binding]),
  )
  const leg = (route?.pipeTableLegs || []).find(
    (entry) =>
      [entry.node1, entry.node2].includes('50') &&
      [entry.node1, entry.node2].includes('718'),
  )
  const planLeg = (route?.planLegBindings || []).find(
    (entry) =>
      entry.calculationFromNodeId === '718' && entry.calculationToNodeId === '50',
  )
  return { bindings, leg, planLeg }
}

/**
 * @param {object} inputs
 * @param {object} inputs.pipeVectors - Approved FP2.0 source vectors.
 * @param {object} inputs.canonicalTopology - Canonical FP2.0 topology.
 * @param {object} inputs.governedSkeleton - Source role assignments.
 * @param {object} inputs.operationalAnnotations - Field/listing evidence.
 * @param {object[]} inputs.hydraulicRoutes - Approved RA2 route packets.
 * @returns {object} Bounded CMI.06 fabrication and exact vertical-leg result.
 */
export function evaluateNewHopeCmi06VerticalOutlet(inputs = {}) {
  const issues = []
  const {
    pipeVectors,
    canonicalTopology,
    governedSkeleton,
    operationalAnnotations,
    hydraulicRoutes = [],
  } = inputs
  const evidence =
    operationalAnnotations?.fabricationLineEvidence?.verticalOutletBindings?.find(
      (entry) => entry.id === 'cmi06-head057-vertical',
    )
  const fieldSet = operationalAnnotations?.fabricationLineEvidence?.fieldSet
  const listing = operationalAnnotations?.fabricationLineEvidence?.fabricationListing
  const edgeById = new Map((canonicalTopology?.edges || []).map((edge) => [edge.id, edge]))
  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]))
  const edges = EXPECTED_EDGE_IDS.map((edgeId) => edgeById.get(edgeId))
  const sourceSegment = pipeVectors?.pipeSegments?.find((segment) => segment.id === 'pipe-067')
  const roleAssignment = governedSkeleton?.primaryAssignments?.find(
    (entry) => entry.sourceSegmentId === 'pipe-067',
  )
  const branchRoleAssignment = governedSkeleton?.primaryAssignments?.find(
    (entry) => entry.sourceSegmentId === 'pipe-065',
  )
  const continuationRoleAssignment = governedSkeleton?.primaryAssignments?.find(
    (entry) => entry.sourceSegmentId === 'pipe-063',
  )
  const { bindings, leg, planLeg } = findRemoteArea22VerticalEvidence(hydraulicRoutes)

  if (
    pipeVectors?.projectId !== EXPECTED_PROJECT_ID ||
    canonicalTopology?.projectId !== EXPECTED_PROJECT_ID ||
    governedSkeleton?.projectId !== EXPECTED_PROJECT_ID ||
    operationalAnnotations?.projectId !== EXPECTED_PROJECT_ID
  ) {
    issues.push(issue('NH_CMI06_PROJECT_IDENTITY_INVALID', 'Every input must identify New Hope.'))
  }
  if (
    governedSkeleton?.status !== 'passed' ||
    roleAssignment?.systemRole !== 'cross-main' ||
    roleAssignment?.nominalDiameterIn !== 3
  ) {
    issues.push(
      issue(
        'NH_CMI06_GOVERNED_ROLE_INVALID',
        'Pipe-067 must remain the governed 3-inch cross-main source segment.',
        'pipe-067',
      ),
    )
  }
  if (
    fieldSet?.sha256 !== EXPECTED_FIELD_SHA ||
    fieldSet?.sheet !== 'FP2.0' ||
    fieldSet?.physicalPage !== 4 ||
    listing?.sha256 !== EXPECTED_LISTING_SHA ||
    listing?.fileName !== '24-052_NHCC_LIST.PDF'
  ) {
    issues.push(
      issue(
        'NH_CMI06_FABRICATION_SOURCE_INVALID',
        'CMI.06 must remain bound to the exact field set and fabrication listing.',
      ),
    )
  }
  if (
    evidence?.lineName !== 'CMI' ||
    evidence?.pieceId !== 'CMI.06' ||
    evidence?.systemRole !== 'cross-main' ||
    evidence?.nominalDiameterIn !== 3 ||
    evidence?.cutLengthIn !== 252 ||
    evidence?.fabricationListingPage !== 15 ||
    evidence?.sourceSegmentId !== 'pipe-067' ||
    JSON.stringify(evidence?.sourceEdgeIds) !== JSON.stringify(EXPECTED_EDGE_IDS)
  ) {
    issues.push(
      issue(
        'NH_CMI06_PIECE_IDENTITY_INVALID',
        'CMI.06 must remain the listed 3-inch, 21-foot pipe-067 piece.',
        'CMI.06',
      ),
    )
  }
  if (
    sourceSegment?.drawingIndex !== 6666 ||
    sourceSegment?.strokeClass !== 'red-pipe' ||
    edges.some((edge) => !edge || edge.sourceSegmentId !== 'pipe-067') ||
    edges[0]?.fromNodeId !== 'canonical-node-137' ||
    edges.at(-1)?.toNodeId !== 'canonical-node-138' ||
    evidence?.pieceStartCanonicalNodeId !== 'canonical-node-137' ||
    evidence?.pieceFarEndCanonicalNodeId !== 'canonical-node-138'
  ) {
    issues.push(
      issue(
        'NH_CMI06_PLAN_TOPOLOGY_INVALID',
        'The five source edges must retain the complete CMI.06 plan run from node 137 to node 138.',
      ),
    )
  }

  const stationByNode = new Map()
  let cumulativePlanIn = 0
  for (const edge of edges) {
    cumulativePlanIn += (edge?.planLengthFt || 0) * 12
    stationByNode.set(edge?.toNodeId, cumulativePlanIn)
  }
  const stationResidualsIn = EXPECTED_OUTLETS.map(([canonicalNodeId, sprinklerId, stationIn]) => {
    const outlet = evidence?.outlets?.find(
      (entry) => entry.canonicalNodeId === canonicalNodeId,
    )
    const node = nodeById.get(canonicalNodeId)
    if (
      outlet?.sprinklerId !== sprinklerId ||
      outlet?.fromPieceStartIn !== stationIn ||
      outlet?.fitting !== '3 x 1 threaded outlet' ||
      outlet?.orientation !== 'up-0-degrees' ||
      JSON.stringify(node?.sprinklerIds) !== JSON.stringify([sprinklerId])
    ) {
      issues.push(
        issue(
          'NH_CMI06_OUTLET_SEQUENCE_INVALID',
          'All four CMI.06 outlets must retain their listed station, upward orientation, and plan sprinkler identity.',
          canonicalNodeId,
        ),
      )
    }
    return {
      canonicalNodeId,
      sprinklerId,
      listedStationIn: stationIn,
      planStationIn: round(stationByNode.get(canonicalNodeId)),
      residualIn: round(Math.abs(stationIn - (stationByNode.get(canonicalNodeId) || 0))),
    }
  })
  const piecePlanLengthIn = edges.reduce(
    (sum, edge) => sum + (edge?.planLengthFt || 0) * 12,
    0,
  )
  const pieceLengthResidualIn = round(
    Math.abs((evidence?.cutLengthIn || 0) - piecePlanLengthIn),
  )
  if (
    evidence?.maximumPlanStationResidualIn !== 2.1 ||
    stationResidualsIn.some(
      (entry) => entry.residualIn > evidence.maximumPlanStationResidualIn,
    ) ||
    pieceLengthResidualIn > evidence?.maximumPlanStationResidualIn
  ) {
    issues.push(
      issue(
        'NH_CMI06_PLAN_STATION_RESIDUAL_EXCEEDED',
        'The field-plan outlet stations and full piece length must stay within the bounded PDF-to-listing tolerance.',
      ),
    )
  }
  const branchOutlet = evidence?.branchOutlet
  const junctionNode = nodeById.get('canonical-node-138')
  const branchOutletPlanStationIn = round(piecePlanLengthIn)
  const branchOutletStationResidualIn = round(
    Math.abs((branchOutlet?.fromPieceStartIn || 0) - branchOutletPlanStationIn),
  )
  if (
    branchOutlet?.canonicalNodeId !== 'canonical-node-138' ||
    branchOutlet?.fromPieceStartIn !== 246 ||
    branchOutlet?.fitting !== '3 x 2-1/2 grooved outlet' ||
    branchOutlet?.orientation !== 'toward-90-degrees' ||
    branchOutlet?.downstreamSourceSegmentId !== 'pipe-065' ||
    branchOutlet?.farEndContinuationSourceSegmentId !== 'pipe-063' ||
    branchOutlet?.toPieceFarEndIn !== 6 ||
    branchOutlet?.maximumCanonicalJunctionResidualIn !== 5 ||
    branchOutletStationResidualIn > branchOutlet?.maximumCanonicalJunctionResidualIn ||
    JSON.stringify(junctionNode?.sourceSegmentIds) !==
      JSON.stringify(['pipe-063', 'pipe-065', 'pipe-067']) ||
    branchRoleAssignment?.systemRole !== 'branch-line' ||
    branchRoleAssignment?.nominalDiameterIn !== 2.5 ||
    continuationRoleAssignment?.systemRole !== 'cross-main' ||
    continuationRoleAssignment?.nominalDiameterIn !== 3
  ) {
    issues.push(
      issue(
        'NH_CMI06_BRANCH_OUTLET_INVALID',
        'The CMI.06 3 x 2-1/2 grooved outlet must remain six inches before the far end, feeding pipe-065 while the 3-inch run continues through pipe-063.',
        'canonical-node-138',
      ),
    )
  }

  const vertical = evidence?.exactVerticalLeg
  const carrierElevationFt = leg?.node1 === '50' ? leg.elevation1Ft : leg?.elevation2Ft
  const sprinklerElevationFt = leg?.node1 === '718' ? leg.elevation1Ft : leg?.elevation2Ft
  if (
    bindings.get('50')?.canonicalNodeId !== 'canonical-node-142' ||
    bindings.get('718')?.canonicalNodeId !== 'canonical-node-142' ||
    JSON.stringify(planLeg?.canonicalNodeIds) !== JSON.stringify(['canonical-node-142']) ||
    JSON.stringify(planLeg?.canonicalEdgeIds) !== JSON.stringify([]) ||
    planLeg?.pathKind !== 'vertical-at-canonical-node' ||
    planLeg?.axisEvidence !== 'coincident-plan-node-with-calculation-elevation-delta'
  ) {
    issues.push(
      issue(
        'NH_CMI06_VERTICAL_PLAN_BINDING_INVALID',
        'RA2-2 nodes 718 and 50 must remain one same-XY vertical leg at canonical node 142.',
      ),
    )
  }
  if (
    vertical?.canonicalNodeId !== 'canonical-node-142' ||
    vertical?.sprinklerId !== 'head-057' ||
    vertical?.carrierCalculationNodeId !== '50' ||
    vertical?.sprinklerCalculationNodeId !== '718' ||
    vertical?.carrierLocalElevationFt !== 20.5 ||
    vertical?.sprinklerLocalElevationFt !== 21.5 ||
    vertical?.lengthFt !== 1 ||
    vertical?.nominalDiameterIn !== 1 ||
    vertical?.actualDiameterIn !== 1.049 ||
    vertical?.fittingEquivalentLengthFt !== 3.583333 ||
    leg?.nominalDiameterIn !== 1 ||
    leg?.actualDiameterIn !== 1.049 ||
    leg?.lengthFt !== 1 ||
    leg?.fittingEquivalentLengthFt !== 3.583333 ||
    carrierElevationFt !== 20.5 ||
    sprinklerElevationFt !== 21.5 ||
    !leg?.notes?.includes('Sprinkler') ||
    !leg?.notes?.includes('same plan XY vertical leg')
  ) {
    issues.push(
      issue(
        'NH_CMI06_VERTICAL_CALCULATION_INVALID',
        'RA2-2 must retain the exact one-foot 1-inch vertical leg from the CMI.06 carrier at 20.5 feet to head-057 at 21.5 feet.',
        'head-057',
      ),
    )
  }
  const head = pipeVectors?.sprinklers?.find((entry) => entry.id === 'head-057')
  if (
    head?.symbolType !== 'BB1' ||
    head?.nearestPipeSegmentId !== 'pipe-067' ||
    head?.pipeDistancePdfPt !== 0
  ) {
    issues.push(
      issue(
        'NH_CMI06_SPRINKLER_SOURCE_IDENTITY_INVALID',
        'The exact vertical leg must terminate at source sprinkler head-057 on pipe-067.',
        'head-057',
      ),
    )
  }

  const ready = issues.length === 0
  return {
    artifactType: 'halofire.new-hope-cmi06-vertical-outlet-result.v1',
    projectId: operationalAnnotations?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    piece: ready
      ? {
          lineName: 'CMI',
          pieceId: 'CMI.06',
          nominalDiameterIn: 3,
          cutLengthIn: 252,
          sourceSegmentId: 'pipe-067',
          sourceEdgeIds: EXPECTED_EDGE_IDS,
          pieceLengthResidualIn,
          stationResidualsIn,
        }
      : null,
    outlets: ready
      ? evidence.outlets.map((outlet) => ({ ...outlet }))
      : [],
    branchOutlet: ready
      ? {
          ...branchOutlet,
          planStationIn: branchOutletPlanStationIn,
          stationResidualIn: branchOutletStationResidualIn,
        }
      : null,
    exactVerticalLeg: ready
      ? {
          canonicalNodeId: 'canonical-node-142',
          sprinklerId: 'head-057',
          fitting: '3 x 1 threaded outlet',
          orientation: 'up-0-degrees',
          carrierCalculationNodeId: '50',
          sprinklerCalculationNodeId: '718',
          carrierLocalElevationFt: carrierElevationFt,
          sprinklerLocalElevationFt: sprinklerElevationFt,
          deltaZFt: round(sprinklerElevationFt - carrierElevationFt),
          lengthFt: leg.lengthFt,
          nominalDiameterIn: leg.nominalDiameterIn,
          actualDiameterIn: leg.actualDiameterIn,
          fittingEquivalentLengthFt: leg.fittingEquivalentLengthFt,
        }
      : null,
    cmi06PieceFabricationReady: ready,
    cmi06OutletScheduleReady: ready,
    cmi06BranchOutletReady: ready,
    head057OutletFittingReady: ready,
    head057VerticalLegReady: ready,
    head057ExactCarrierZReady: ready,
    head057ExactSprinklerZReady: ready,
    boundedVerticalOffsetScheduleReady: ready,
    completeFittingScheduleReady: false,
    exactWholeSystemZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}
