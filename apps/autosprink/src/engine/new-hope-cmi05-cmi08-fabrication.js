/**
 * Source-bound CMI.05, CMI.07, and CMI.08 fabrication schedule.
 *
 * This evaluator binds the actual field-plan geometry to the AutoSPRINK piece
 * report. Fabrication piece direction is kept separate from hydraulic flow and
 * drainage direction; exact Z and whole-system release remain fail-closed.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_FIELD_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5'
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'

const PIECES = Object.freeze({
  'CMI.05': {
    sourceSegmentId: 'pipe-062',
    drawingIndex: 6605,
    cutLengthIn: 252,
    edgeIds: ['source-edge-122', 'source-edge-123', 'source-edge-124', 'source-edge-125', 'source-edge-126'],
    startNodeId: 'canonical-node-133',
    farNodeId: 'canonical-node-137',
  },
  'CMI.07': {
    sourceSegmentId: 'pipe-063',
    drawingIndex: 6636,
    cutLengthIn: 120.5,
    edgeIds: ['source-edge-127', 'source-edge-128', 'source-edge-129'],
    startNodeId: 'canonical-node-138',
    farNodeId: 'canonical-node-053',
  },
  'CMI.08': {
    sourceSegmentId: 'pipe-030',
    drawingIndex: 4943,
    cutLengthIn: 97.5,
    edgeIds: ['source-edge-050'],
    startNodeId: 'canonical-node-053',
    farNodeId: 'canonical-node-054',
  },
})

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})
const round = (value, digits = 6) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null

function piecePlanRegistration(pieceId, evidence, edgeById) {
  const expected = PIECES[pieceId]
  const edges = expected.edgeIds.map((edgeId) => edgeById.get(edgeId))
  let cumulativeIn = 0
  const stationByNode = new Map()
  for (const edge of edges) {
    cumulativeIn += (edge?.planLengthFt || 0) * 12
    stationByNode.set(edge?.toNodeId, cumulativeIn)
  }
  return {
    edges,
    planLengthIn: round(cumulativeIn),
    pieceLengthResidualIn: round(Math.abs(expected.cutLengthIn - cumulativeIn)),
    stationResidualsIn: (evidence?.outlets || []).map((outlet) => ({
      canonicalNodeId: outlet.canonicalNodeId,
      listedStationIn: outlet.fromPieceStartIn,
      planStationIn: round(stationByNode.get(outlet.canonicalNodeId)),
      residualIn: round(
        Math.abs(outlet.fromPieceStartIn - (stationByNode.get(outlet.canonicalNodeId) || 0)),
      ),
    })),
  }
}

/**
 * @param {object} inputs
 * @param {object} inputs.pipeVectors - Approved FP2.0 vectors.
 * @param {object} inputs.canonicalTopology - Canonical FP2.0 graph.
 * @param {object} inputs.governedSkeleton - Source role assignments.
 * @param {object} inputs.operationalAnnotations - Field/listing bindings.
 * @returns {object} Bounded fabrication schedule and fail-closed release flags.
 */
export function evaluateNewHopeCmi05Cmi08Fabrication(inputs = {}) {
  const issues = []
  const { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations } = inputs
  const bindings = operationalAnnotations?.fabricationLineEvidence?.crossMainPieceBindings || []
  const fieldSet = operationalAnnotations?.fabricationLineEvidence?.fieldSet
  const listing = operationalAnnotations?.fabricationLineEvidence?.fabricationListing
  const edgeById = new Map((canonicalTopology?.edges || []).map((edge) => [edge.id, edge]))
  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]))
  const segmentById = new Map((pipeVectors?.pipeSegments || []).map((segment) => [segment.id, segment]))
  const roleBySegmentId = new Map(
    (governedSkeleton?.primaryAssignments || []).map((entry) => [entry.sourceSegmentId, entry]),
  )

  if (
    pipeVectors?.projectId !== EXPECTED_PROJECT_ID ||
    canonicalTopology?.projectId !== EXPECTED_PROJECT_ID ||
    governedSkeleton?.projectId !== EXPECTED_PROJECT_ID ||
    operationalAnnotations?.projectId !== EXPECTED_PROJECT_ID
  ) {
    issues.push(issue('NH_CMI0508_PROJECT_IDENTITY_INVALID', 'Every input must identify New Hope.'))
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
        'NH_CMI0508_FABRICATION_SOURCE_INVALID',
        'The piece schedule must remain bound to the exact field set and AutoSPRINK listing.',
      ),
    )
  }

  const results = {}
  for (const [pieceId, expected] of Object.entries(PIECES)) {
    const evidence = bindings.find((entry) => entry.pieceId === pieceId)
    const segment = segmentById.get(expected.sourceSegmentId)
    const role = roleBySegmentId.get(expected.sourceSegmentId)
    const registration = piecePlanRegistration(pieceId, evidence, edgeById)
    if (
      evidence?.lineName !== 'CMI' ||
      evidence?.systemRole !== 'cross-main' ||
      evidence?.nominalDiameterIn !== 3 ||
      evidence?.cutLengthIn !== expected.cutLengthIn ||
      evidence?.fabricationListingPage !== 15 ||
      evidence?.sourceSegmentId !== expected.sourceSegmentId ||
      JSON.stringify(evidence?.sourceEdgeIds) !== JSON.stringify(expected.edgeIds)
    ) {
      issues.push(
        issue(
          'NH_CMI0508_PIECE_IDENTITY_INVALID',
          `${pieceId} must retain its exact listed diameter, cut length, segment, and edge sequence.`,
          pieceId,
        ),
      )
    }
    if (
      governedSkeleton?.status !== 'passed' ||
      role?.systemRole !== 'cross-main' ||
      role?.nominalDiameterIn !== 3 ||
      segment?.drawingIndex !== expected.drawingIndex ||
      segment?.strokeClass !== 'red-pipe'
    ) {
      issues.push(
        issue(
          'NH_CMI0508_GOVERNED_ROLE_INVALID',
          `${pieceId} must remain a governed 3-inch red cross-main segment.`,
          expected.sourceSegmentId,
        ),
      )
    }
    if (
      registration.edges.some(
        (edge) => !edge || edge.sourceSegmentId !== expected.sourceSegmentId,
      ) ||
      registration.edges[0]?.fromNodeId !== expected.startNodeId ||
      registration.edges.at(-1)?.toNodeId !== expected.farNodeId ||
      evidence?.pieceStartCanonicalNodeId !== expected.startNodeId ||
      evidence?.pieceFarEndCanonicalNodeId !== expected.farNodeId
    ) {
      issues.push(
        issue(
          'NH_CMI0508_PLAN_TOPOLOGY_INVALID',
          `${pieceId} must retain its complete ordered source-edge path.`,
          pieceId,
        ),
      )
    }
    results[pieceId] = { evidence, registration }
  }

  const cmi05 = results['CMI.05']
  const expectedCmi05Outlets = [
    ['canonical-node-134', 'head-059', 51],
    ['canonical-node-135', 'head-066', 123],
    ['canonical-node-136', 'head-065', 195],
  ]
  if (
    cmi05.evidence?.maximumPlanResidualIn !== 2 ||
    cmi05.registration.pieceLengthResidualIn > cmi05.evidence?.maximumPlanResidualIn ||
    cmi05.registration.stationResidualsIn.some(
      (entry) => entry.residualIn > cmi05.evidence?.maximumPlanResidualIn,
    )
  ) {
    issues.push(
      issue(
        'NH_CMI05_PLAN_REGISTRATION_RESIDUAL_EXCEEDED',
        'CMI.05 length and outlet stations must stay within the two-inch PDF-to-listing tolerance.',
      ),
    )
  }
  for (const [canonicalNodeId, sprinklerId, stationIn] of expectedCmi05Outlets) {
    const outlet = cmi05.evidence?.outlets?.find(
      (entry) => entry.canonicalNodeId === canonicalNodeId,
    )
    if (
      outlet?.sprinklerId !== sprinklerId ||
      outlet?.fromPieceStartIn !== stationIn ||
      outlet?.fitting !== '3 x 1 threaded outlet' ||
      outlet?.orientation !== 'up-0-degrees' ||
      JSON.stringify(nodeById.get(canonicalNodeId)?.sprinklerIds) !== JSON.stringify([sprinklerId])
    ) {
      issues.push(
        issue(
          'NH_CMI05_OUTLET_SEQUENCE_INVALID',
          'All three CMI.05 outlets must retain their listed stations, upward orientation, and sprinkler identities.',
          canonicalNodeId,
        ),
      )
    }
  }
  const crossing = nodeById.get('canonical-node-022')
  const separatedCrossing = operationalAnnotations?.fabricationLineEvidence?.separatedCrossings?.find(
    (entry) => entry.canonicalNodeId === 'canonical-node-022',
  )
  if (
    cmi05.evidence?.separatedCrossingCanonicalNodeId !== 'canonical-node-022' ||
    cmi05.evidence?.separatedCrossingSourceSegmentId !== 'pipe-013' ||
    JSON.stringify(crossing?.sourceSegmentIds) !== JSON.stringify(['pipe-013', 'pipe-062']) ||
    (crossing?.sprinklerIds || []).length !== 0 ||
    separatedCrossing?.branchPieceId !== 'BL48.02' ||
    separatedCrossing?.branchPieceOutletCount !== 0
  ) {
    issues.push(
      issue(
        'NH_CMI05_SEPARATED_CROSSING_INVALID',
        'The BL48.02 crossing inside CMI.05 must remain a no-fitting, no-outlet plan crossing.',
        'canonical-node-022',
      ),
    )
  }

  const cmi07 = results['CMI.07']
  const expectedCmi07Outlets = [
    ['canonical-node-117', 31, 'pipe-054', 'source-edge-108', 'canonical-node-118', 'head-053'],
    ['canonical-node-089', 92.5, 'pipe-044', 'source-edge-084', 'canonical-node-090', 'head-035'],
  ]
  if (
    cmi07.evidence?.maximumOutletStationResidualIn !== 3 ||
    cmi07.evidence?.maximumPieceLengthResidualIn !== 4.2 ||
    cmi07.registration.pieceLengthResidualIn > cmi07.evidence?.maximumPieceLengthResidualIn ||
    cmi07.registration.stationResidualsIn.some(
      (entry) => entry.residualIn > cmi07.evidence?.maximumOutletStationResidualIn,
    )
  ) {
    issues.push(
      issue(
        'NH_CMI07_PLAN_REGISTRATION_RESIDUAL_EXCEEDED',
        'CMI.07 length and outlet stations must stay within their bounded PDF-to-listing tolerances.',
      ),
    )
  }
  for (const [canonicalNodeId, stationIn, downstreamSegmentId, downstreamEdgeId, terminalNodeId, sprinklerId] of expectedCmi07Outlets) {
    const outlet = cmi07.evidence?.outlets?.find(
      (entry) => entry.canonicalNodeId === canonicalNodeId,
    )
    const downstreamRole = roleBySegmentId.get(downstreamSegmentId)
    const downstreamEdge = edgeById.get(downstreamEdgeId)
    if (
      outlet?.fromPieceStartIn !== stationIn ||
      outlet?.fitting !== '3 x 1 threaded outlet' ||
      outlet?.orientation !== 'toward-90-degrees' ||
      outlet?.downstreamSourceSegmentId !== downstreamSegmentId ||
      outlet?.downstreamSourceEdgeId !== downstreamEdgeId ||
      outlet?.sprinklerId !== sprinklerId ||
      downstreamRole?.systemRole !== 'arm-over' ||
      downstreamRole?.nominalDiameterIn !== 1 ||
      downstreamEdge?.fromNodeId !== canonicalNodeId ||
      downstreamEdge?.toNodeId !== terminalNodeId ||
      JSON.stringify(nodeById.get(terminalNodeId)?.sprinklerIds) !== JSON.stringify([sprinklerId])
    ) {
      issues.push(
        issue(
          'NH_CMI07_OUTLET_SEQUENCE_INVALID',
          'Both CMI.07 outlets must retain their Toward:90 stations and exact one-inch arm-over terminals.',
          canonicalNodeId,
        ),
      )
    }
  }

  const cmi08 = results['CMI.08']
  const cmi07Cmi08Junction = nodeById.get('canonical-node-053')
  const cmi08Cmi09Junction = nodeById.get('canonical-node-054')
  if (
    cmi08.evidence?.maximumPlanResidualIn !== 2 ||
    cmi08.registration.pieceLengthResidualIn > cmi08.evidence?.maximumPlanResidualIn ||
    (cmi08.evidence?.outlets || []).length !== 0
  ) {
    issues.push(
      issue(
        'NH_CMI08_NO_OUTLET_PIECE_INVALID',
        'CMI.08 must retain its 8-foot 1-1/2-inch no-outlet fabrication identity.',
        'CMI.08',
      ),
    )
  }
  if (
    cmi08.evidence?.connectedUpstreamPieceId !== 'CMI.07' ||
    cmi08.evidence?.connectedDownstreamPieceId !== 'CMI.09' ||
    JSON.stringify(cmi07Cmi08Junction?.sourceSegmentIds) !== JSON.stringify(['pipe-030', 'pipe-063']) ||
    JSON.stringify(cmi08Cmi09Junction?.sourceSegmentIds) !== JSON.stringify(['pipe-030', 'pipe-032']) ||
    roleBySegmentId.get('pipe-032')?.systemRole !== 'branch-line' ||
    roleBySegmentId.get('pipe-032')?.nominalDiameterIn !== 2.5
  ) {
    issues.push(
      issue(
        'NH_CMI08_JUNCTION_SEQUENCE_INVALID',
        'CMI.08 must connect CMI.07 at node 053 to the CMI.09 low-point branch at node 054.',
      ),
    )
  }

  const ready = issues.length === 0
  const pieceResults = ready
    ? Object.fromEntries(
        Object.entries(results).map(([pieceId, result]) => [
          pieceId,
          {
            pieceId,
            nominalDiameterIn: 3,
            cutLengthIn: PIECES[pieceId].cutLengthIn,
            sourceSegmentId: PIECES[pieceId].sourceSegmentId,
            sourceEdgeIds: PIECES[pieceId].edgeIds,
            pieceStartCanonicalNodeId: PIECES[pieceId].startNodeId,
            pieceFarEndCanonicalNodeId: PIECES[pieceId].farNodeId,
            planLengthIn: result.registration.planLengthIn,
            pieceLengthResidualIn: result.registration.pieceLengthResidualIn,
            stationResidualsIn: result.registration.stationResidualsIn,
            outlets: result.evidence.outlets,
          },
        ]),
      )
    : {}

  return {
    artifactType: 'halofire.new-hope-cmi05-cmi08-fabrication-result.v1',
    projectId: operationalAnnotations?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    pieces: pieceResults,
    metrics: {
      boundedPieceCount: ready ? 3 : 0,
      boundedOutletCount: ready ? 5 : 0,
      noOutletPieceCount: ready ? 1 : 0,
      separatedCrossingCount: ready ? 1 : 0,
      exactArmOverTerminalCount: ready ? 2 : 0,
    },
    fabricationPieceDirectionSemantics: 'listed-piece-start-to-far-end',
    drainageDirectionSemantics: 'independently-governed-by-drainage-schedules',
    cmi05PieceFabricationReady: ready,
    cmi05OutletScheduleReady: ready,
    cmi05SeparatedCrossingReady: ready,
    cmi07PieceFabricationReady: ready,
    cmi07OutletScheduleReady: ready,
    cmi07ArmOverTerminalBindingReady: ready,
    cmi08PieceFabricationReady: ready,
    cmi08NoOutletScheduleReady: ready,
    cmi07Cmi08JunctionReady: ready,
    cmi05Cmi08BoundedFittingScheduleReady: ready,
    completeFittingScheduleReady: false,
    exactWholeSystemZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}
