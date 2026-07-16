/**
 * Source-bound fabrication schedule for New Hope CMI.01-CMI.04 and
 * CMI.14-CMI.18.
 *
 * Fabrication piece direction, hydraulic flow, and drainage grade are
 * intentionally independent. This closes only the listed piece/outlet facts;
 * unresolved far-end Z, installed grade, piece-end fittings, and vertical
 * offsets remain fail-closed.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_FIELD_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5'
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'

const PIECES = Object.freeze({
  'CMI.01': { chainId: 'lower-west-cross-main', role: 'cross-main', diameterIn: 3, segmentId: 'pipe-002', drawingIndex: 3594, cutLengthIn: 12, listingPage: 14, edgeIds: ['source-edge-003'], startNodeId: 'canonical-node-002', farNodeId: 'canonical-node-004' },
  'CMI.02': { chainId: 'lower-west-cross-main', role: 'cross-main', diameterIn: 3, segmentId: 'pipe-003', drawingIndex: 3624, cutLengthIn: 33.5, listingPage: 14, edgeIds: ['source-edge-004'], startNodeId: 'canonical-node-004', farNodeId: 'canonical-node-005' },
  'CMI.03': { chainId: 'lower-west-cross-main', role: 'cross-main', diameterIn: 3, segmentId: 'pipe-058', drawingIndex: 6467, cutLengthIn: 252, listingPage: 14, edgeIds: ['source-edge-113', 'source-edge-112'], startNodeId: 'canonical-node-005', farNodeId: 'canonical-node-125' },
  'CMI.04': { chainId: 'lower-west-cross-main', role: 'cross-main', diameterIn: 3, segmentId: 'pipe-061', drawingIndex: 6592, cutLengthIn: 57, listingPage: 14, edgeIds: ['source-edge-120', 'source-edge-121'], startNodeId: 'canonical-node-125', farNodeId: 'canonical-node-133' },
  'CMI.14': { chainId: 'upper-west-cross-main', role: 'cross-main', diameterIn: 3, segmentId: 'pipe-059', drawingIndex: 6536, cutLengthIn: 5, listingPage: 16, edgeIds: ['source-edge-114'], startNodeId: 'canonical-node-125', farNodeId: 'canonical-node-126' },
  'CMI.15': { chainId: 'upper-west-cross-main', role: 'cross-main', diameterIn: 3, segmentId: 'pipe-060', drawingIndex: 6544, cutLengthIn: 252, listingPage: 17, edgeIds: ['source-edge-115', 'source-edge-116', 'source-edge-117', 'source-edge-118', 'source-edge-119'], startNodeId: 'canonical-node-126', farNodeId: 'canonical-node-131' },
  'CMI.16': { chainId: 'upper-west-cross-main', role: 'cross-main', diameterIn: 3, segmentId: 'pipe-064', drawingIndex: 6637, cutLengthIn: 120.5, listingPage: 17, edgeIds: ['source-edge-130', 'source-edge-131', 'source-edge-132'], startNodeId: 'canonical-node-131', farNodeId: 'canonical-node-055' },
  'CMI.17': { chainId: 'upper-west-cross-main', role: 'cross-main', diameterIn: 3, segmentId: 'pipe-031', drawingIndex: 4944, cutLengthIn: 97.5, listingPage: 17, edgeIds: ['source-edge-051'], startNodeId: 'canonical-node-055', farNodeId: 'canonical-node-056' },
  'CMI.18': { chainId: 'upper-west-cross-main', role: 'branch-line', diameterIn: 2.5, segmentId: 'pipe-033', drawingIndex: 5042, cutLengthIn: 64.5, listingPage: 17, edgeIds: ['source-edge-057', 'source-edge-056', 'source-edge-055'], startNodeId: 'canonical-node-056', farNodeId: 'canonical-node-060' },
})

const OUTLETS = Object.freeze({
  'CMI.01': [],
  'CMI.02': [],
  'CMI.03': [
    { nodeId: 'canonical-node-007', stationIn: 24, fitting: '3 x 2-1/2 grooved outlet', orientation: 'toward-90-degrees', downstreamSegmentId: 'pipe-004', downstreamRole: 'cross-main', downstreamDiameterIn: 2.5 },
  ],
  'CMI.04': [
    { nodeId: 'canonical-node-132', stationIn: 36, fitting: '3 x 1 threaded outlet', orientation: 'up-0-degrees', sprinklerId: 'head-060' },
  ],
  'CMI.14': [],
  'CMI.15': [
    { nodeId: 'canonical-node-127', stationIn: 23.5, fitting: '3 x 1 threaded outlet', orientation: 'up-0-degrees', sprinklerId: 'head-067' },
    { nodeId: 'canonical-node-128', stationIn: 95.5, fitting: '3 x 1 threaded outlet', orientation: 'up-0-degrees', sprinklerId: 'head-061' },
    { nodeId: 'canonical-node-129', stationIn: 167.5, fitting: '3 x 1 threaded outlet', orientation: 'up-0-degrees', sprinklerId: 'head-062' },
    { nodeId: 'canonical-node-130', stationIn: 239.5, fitting: '3 x 1 threaded outlet', orientation: 'up-0-degrees', sprinklerId: 'head-068' },
    { nodeId: 'canonical-node-131', stationIn: 246, fitting: '3 x 2-1/2 grooved outlet', orientation: 'away-270-degrees', downstreamSegmentId: 'pipe-066', downstreamRole: 'branch-line', downstreamDiameterIn: 2.5 },
  ],
  'CMI.16': [
    { nodeId: 'canonical-node-119', stationIn: 31, fitting: '3 x 1 threaded outlet', orientation: 'away-270-degrees', downstreamSegmentId: 'pipe-055', downstreamRole: 'arm-over', downstreamDiameterIn: 1, sprinklerId: 'head-056' },
    { nodeId: 'canonical-node-091', stationIn: 92.5, fitting: '3 x 1 threaded outlet', orientation: 'away-270-degrees', downstreamSegmentId: 'pipe-045', downstreamRole: 'arm-over', downstreamDiameterIn: 1, sprinklerId: 'head-036' },
  ],
  'CMI.17': [],
  'CMI.18': [
    { nodeId: 'canonical-node-062', stationIn: 7, fitting: '2-1/2 x 2 grooved outlet', orientation: 'away-273-degrees', downstreamSegmentId: 'pipe-034', downstreamRole: 'branch-line', downstreamDiameterIn: 2 },
    { nodeId: 'canonical-node-061', stationIn: 34, fitting: '2-1/2 x 3/4 threaded outlet', orientation: 'up-0-degrees', sprinklerId: 'head-018' },
  ],
})

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId })
const round = (value, digits = 6) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null

function traversePiece(expected, edgeById) {
  let currentNodeId = expected.startNodeId
  let cumulativeIn = 0
  const stationByNode = new Map()
  const traversedEdges = []
  for (const edgeId of expected.edgeIds) {
    const edge = edgeById.get(edgeId)
    let nextNodeId = null
    let traversal = null
    if (edge?.fromNodeId === currentNodeId) {
      nextNodeId = edge.toNodeId
      traversal = 'canonical-forward'
    } else if (edge?.toNodeId === currentNodeId) {
      nextNodeId = edge.fromNodeId
      traversal = 'canonical-reverse'
    }
    cumulativeIn += (edge?.planLengthFt || 0) * 12
    if (nextNodeId) stationByNode.set(nextNodeId, cumulativeIn)
    traversedEdges.push({ edgeId, edge, fromNodeId: currentNodeId, toNodeId: nextNodeId, traversal })
    currentNodeId = nextNodeId
  }
  return { traversedEdges, stationByNode, farNodeId: currentNodeId, planLengthIn: round(cumulativeIn) }
}

function terminalSprinklerForSegment(segmentId, outletNodeId, edgeById, nodeById) {
  const edges = [...edgeById.values()].filter((edge) => edge.sourceSegmentId === segmentId)
  const visited = new Set([outletNodeId])
  const queue = [outletNodeId]
  while (queue.length) {
    const current = queue.shift()
    const sprinklerIds = nodeById.get(current)?.sprinklerIds || []
    if (sprinklerIds.length) return sprinklerIds
    for (const edge of edges) {
      const next = edge.fromNodeId === current ? edge.toNodeId : edge.toNodeId === current ? edge.fromNodeId : null
      if (next && !visited.has(next)) {
        visited.add(next)
        queue.push(next)
      }
    }
  }
  return []
}

/**
 * @param {object} inputs
 * @param {object} inputs.pipeVectors
 * @param {object} inputs.canonicalTopology
 * @param {object} inputs.governedSkeleton
 * @param {object} inputs.operationalAnnotations
 * @param {object} inputs.sourceFeedFabrication
 * @returns {object} Nine-piece, eleven-outlet bounded fabrication result.
 */
export function evaluateNewHopeRemainingCmiFabrication(inputs = {}) {
  const issues = []
  const { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations, sourceFeedFabrication } = inputs
  const bindings = operationalAnnotations?.fabricationLineEvidence?.remainingCmiPieceBindings || []
  const fieldSet = operationalAnnotations?.fabricationLineEvidence?.fieldSet
  const listing = operationalAnnotations?.fabricationLineEvidence?.fabricationListing
  const edgeById = new Map((canonicalTopology?.edges || []).map((edge) => [edge.id, edge]))
  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]))
  const segmentById = new Map((pipeVectors?.pipeSegments || []).map((segment) => [segment.id, segment]))
  const roleBySegmentId = new Map((governedSkeleton?.primaryAssignments || []).map((entry) => [entry.sourceSegmentId, entry]))

  if ([pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations].some((entry) => entry?.projectId !== EXPECTED_PROJECT_ID)) {
    issues.push(issue('NH_REMAINING_CMI_PROJECT_IDENTITY_INVALID', 'Every input must identify New Hope.'))
  }
  if (fieldSet?.sha256 !== EXPECTED_FIELD_SHA || fieldSet?.sheet !== 'FP2.0' || fieldSet?.physicalPage !== 4 || listing?.sha256 !== EXPECTED_LISTING_SHA || listing?.fileName !== '24-052_NHCC_LIST.PDF') {
    issues.push(issue('NH_REMAINING_CMI_FABRICATION_SOURCE_INVALID', 'The schedule must remain bound to the exact field set and AutoSPRINK listing.'))
  }
  if (bindings.length !== 9) {
    issues.push(issue('NH_REMAINING_CMI_BINDING_INVENTORY_INVALID', 'Exactly nine remaining CMI piece bindings are required.'))
  }

  const results = {}
  for (const [pieceId, expected] of Object.entries(PIECES)) {
    const evidence = bindings.find((entry) => entry.pieceId === pieceId)
    const segment = segmentById.get(expected.segmentId)
    const role = roleBySegmentId.get(expected.segmentId)
    const traversal = traversePiece(expected, edgeById)
    if (evidence?.chainId !== expected.chainId || evidence?.systemRole !== expected.role || evidence?.nominalDiameterIn !== expected.diameterIn || evidence?.cutLengthIn !== expected.cutLengthIn || evidence?.fabricationListingPage !== expected.listingPage || evidence?.sourceSegmentId !== expected.segmentId || evidence?.sourceDrawingIndex !== expected.drawingIndex || JSON.stringify(evidence?.sourceEdgeIds) !== JSON.stringify(expected.edgeIds)) {
      issues.push(issue('NH_REMAINING_CMI_PIECE_IDENTITY_INVALID', `${pieceId} must retain its exact chain, role, size, cut length, listing page, segment, drawing index, and edge order.`, pieceId))
    }
    if (governedSkeleton?.status !== 'passed' || role?.systemRole !== expected.role || role?.nominalDiameterIn !== expected.diameterIn || segment?.drawingIndex !== expected.drawingIndex || segment?.strokeClass !== 'red-pipe') {
      issues.push(issue('NH_REMAINING_CMI_GOVERNED_ROLE_INVALID', `${pieceId} must retain its governed red-pipe role and diameter.`, expected.segmentId))
    }
    if (evidence?.pieceStartCanonicalNodeId !== expected.startNodeId || evidence?.pieceFarEndCanonicalNodeId !== expected.farNodeId || traversal.farNodeId !== expected.farNodeId || traversal.traversedEdges.some(({ edge, toNodeId }) => !edge || edge.sourceSegmentId !== expected.segmentId || !toNodeId)) {
      issues.push(issue('NH_REMAINING_CMI_PLAN_TOPOLOGY_INVALID', `${pieceId} must retain its ordered canonical traversal from listed piece start to far end.`, pieceId))
    }
    const pieceLengthResidualIn = round(Math.abs(expected.cutLengthIn - traversal.planLengthIn))
    if (!Number.isFinite(evidence?.maximumPieceLengthResidualIn) || evidence.maximumPieceLengthResidualIn <= 0 || pieceLengthResidualIn > evidence.maximumPieceLengthResidualIn) {
      issues.push(issue('NH_REMAINING_CMI_PIECE_RESIDUAL_EXCEEDED', `${pieceId} plan length exceeds its explicit PDF-to-listing tolerance.`, pieceId))
    }
    results[pieceId] = { evidence, expected, traversal, pieceLengthResidualIn }
  }

  const outletRegistrations = []
  for (const [pieceId, expectedOutlets] of Object.entries(OUTLETS)) {
    const result = results[pieceId]
    if ((result?.evidence?.outlets || []).length !== expectedOutlets.length) {
      issues.push(issue('NH_REMAINING_CMI_OUTLET_COUNT_INVALID', `${pieceId} must retain its exact listed outlet count.`, pieceId))
    }
    for (const expectedOutlet of expectedOutlets) {
      const outlet = result?.evidence?.outlets?.find((entry) => entry.canonicalNodeId === expectedOutlet.nodeId)
      if (!outlet || outlet.fromPieceStartIn !== expectedOutlet.stationIn || outlet.fitting !== expectedOutlet.fitting || outlet.orientation !== expectedOutlet.orientation) {
        issues.push(issue('NH_REMAINING_CMI_OUTLET_SEQUENCE_INVALID', `${pieceId} outlets must retain their exact stations, fittings, and orientations.`, expectedOutlet.nodeId))
        continue
      }
      const planStationIn = result.traversal.stationByNode.get(expectedOutlet.nodeId)
      const residualIn = round(Math.abs(expectedOutlet.stationIn - (planStationIn || 0)))
      const maximumResidualIn = expectedOutlet.nodeId === 'canonical-node-131'
        ? result.evidence.maximumBranchJunctionResidualIn
        : result.evidence.maximumOutletStationResidualIn
      if (!Number.isFinite(maximumResidualIn) || residualIn > maximumResidualIn) {
        issues.push(issue('NH_REMAINING_CMI_OUTLET_RESIDUAL_EXCEEDED', `${pieceId} outlet station exceeds its explicit PDF-to-listing tolerance.`, expectedOutlet.nodeId))
      }
      if (expectedOutlet.downstreamSegmentId) {
        const downstreamRole = roleBySegmentId.get(expectedOutlet.downstreamSegmentId)
        const nodeSegments = nodeById.get(expectedOutlet.nodeId)?.sourceSegmentIds || []
        if (outlet.downstreamSourceSegmentId !== expectedOutlet.downstreamSegmentId || outlet.downstreamSystemRole !== expectedOutlet.downstreamRole || outlet.downstreamNominalDiameterIn !== expectedOutlet.downstreamDiameterIn || downstreamRole?.systemRole !== expectedOutlet.downstreamRole || downstreamRole?.nominalDiameterIn !== expectedOutlet.downstreamDiameterIn || !nodeSegments.includes(expectedOutlet.downstreamSegmentId)) {
          issues.push(issue('NH_REMAINING_CMI_DOWNSTREAM_CONNECTION_INVALID', `${pieceId} outlet must retain its exact downstream segment, role, and diameter.`, expectedOutlet.nodeId))
        }
        if (expectedOutlet.sprinklerId && (outlet.sprinklerId !== expectedOutlet.sprinklerId || JSON.stringify(terminalSprinklerForSegment(expectedOutlet.downstreamSegmentId, expectedOutlet.nodeId, edgeById, nodeById)) !== JSON.stringify([expectedOutlet.sprinklerId]))) {
          issues.push(issue('NH_REMAINING_CMI_ARMOVER_TERMINAL_INVALID', `${pieceId} arm-over must terminate at its exact sprinkler.`, expectedOutlet.nodeId))
        }
      } else if (outlet.sprinklerId !== expectedOutlet.sprinklerId || JSON.stringify(nodeById.get(expectedOutlet.nodeId)?.sprinklerIds) !== JSON.stringify([expectedOutlet.sprinklerId])) {
        issues.push(issue('NH_REMAINING_CMI_SPRINKLER_IDENTITY_INVALID', `${pieceId} direct sprinkler outlet must retain its canonical head identity.`, expectedOutlet.nodeId))
      }
      outletRegistrations.push({ pieceId, canonicalNodeId: expectedOutlet.nodeId, listedStationIn: expectedOutlet.stationIn, planStationIn: round(planStationIn), residualIn, fitting: expectedOutlet.fitting, orientation: expectedOutlet.orientation, sprinklerId: expectedOutlet.sprinklerId || null, downstreamSourceSegmentId: expectedOutlet.downstreamSegmentId || null })
    }
  }

  for (const chain of [
    ['CMI.01', 'CMI.02', 'CMI.03', 'CMI.04'],
    ['CMI.14', 'CMI.15', 'CMI.16', 'CMI.17', 'CMI.18'],
  ]) {
    for (let index = 0; index < chain.length - 1; index += 1) {
      if (PIECES[chain[index]].farNodeId !== PIECES[chain[index + 1]].startNodeId) {
        issues.push(issue('NH_REMAINING_CMI_CHAIN_JUNCTION_INVALID', 'Consecutive pieces must share one canonical junction.', `${chain[index]}:${chain[index + 1]}`))
      }
    }
  }
  const cmi15Node = nodeById.get('canonical-node-131')
  if (results['CMI.15']?.evidence?.farEndContinuationSourceSegmentId !== 'pipe-064' || !cmi15Node?.sourceSegmentIds?.includes('pipe-060') || !cmi15Node?.sourceSegmentIds?.includes('pipe-064') || !cmi15Node?.sourceSegmentIds?.includes('pipe-066') || results['CMI.15']?.evidence?.outlets?.find((entry) => entry.canonicalNodeId === 'canonical-node-131')?.downstreamSourceSegmentId === results['CMI.15']?.evidence?.farEndContinuationSourceSegmentId) {
    issues.push(issue('NH_CMI15_BRANCH_CONTINUATION_CONFLATED', 'CMI.15 must keep its 2-1/2-inch branch outlet distinct from the continuing 3-inch CMI.16 piece.', 'canonical-node-131'))
  }
  if (results['CMI.04']?.evidence?.farEndContinuationSourceSegmentId !== 'pipe-062' || !nodeById.get('canonical-node-133')?.sourceSegmentIds?.includes('pipe-062') || results['CMI.18']?.evidence?.farEndContinuationSourceSegmentId !== 'pipe-039' || !nodeById.get('canonical-node-060')?.sourceSegmentIds?.includes('pipe-039')) {
    issues.push(issue('NH_REMAINING_CMI_ADJACENT_CHAIN_JUNCTION_INVALID', 'CMI.04 must continue to CMI.05 and CMI.18 must continue to CMI.19 at their exact canonical nodes.'))
  }
  if (results['CMI.01']?.evidence?.upstreamPieceId !== 'CML.01' || sourceFeedFabrication?.status !== 'passed' || sourceFeedFabrication?.outlet?.canonicalNodeId !== 'canonical-node-002' || sourceFeedFabrication?.outlet?.downstreamNominalDiameterIn !== 3 || sourceFeedFabrication?.outlet?.localElevationFt !== 11.5 || results['CMI.01']?.evidence?.pieceStartCanonicalNodeId !== sourceFeedFabrication?.outlet?.canonicalNodeId) {
    issues.push(issue('NH_CMI01_SOURCE_OUTLET_Z_INVALID', 'CMI.01 must start at the source-bound CML.01 outlet registered to calculation node 118 at local elevation 11.5 feet.', 'canonical-node-002'))
  }

  const ready = issues.length === 0
  return {
    artifactType: 'halofire.new-hope-remaining-cmi-fabrication-result.v1',
    projectId: operationalAnnotations?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    pieces: ready ? Object.fromEntries(Object.entries(results).map(([pieceId, result]) => [pieceId, {
      pieceId,
      chainId: result.expected.chainId,
      systemRole: result.expected.role,
      nominalDiameterIn: result.expected.diameterIn,
      cutLengthIn: result.expected.cutLengthIn,
      sourceSegmentId: result.expected.segmentId,
      sourceEdgeIds: result.expected.edgeIds,
      pieceStartCanonicalNodeId: result.expected.startNodeId,
      pieceFarEndCanonicalNodeId: result.expected.farNodeId,
      planLengthIn: result.traversal.planLengthIn,
      pieceLengthResidualIn: result.pieceLengthResidualIn,
      outlets: result.evidence.outlets,
    }])) : {},
    outletRegistrations: ready ? outletRegistrations : [],
    sourceOutletRegistration: ready ? {
      upstreamPieceId: 'CML.01',
      downstreamPieceId: 'CMI.01',
      canonicalNodeId: 'canonical-node-002',
      calculationNodeId: '118',
      localElevationFt: 11.5,
      exactPieceStartZReady: true,
      farEndZReady: false,
      installedGradeReady: false,
    } : null,
    metrics: {
      boundedPieceCount: ready ? 9 : 0,
      boundedCanonicalEdgeCount: ready ? 19 : 0,
      boundedOutletCount: ready ? 11 : 0,
      directSprinklerOutletCount: ready ? 6 : 0,
      branchOrArmOverOutletCount: ready ? 5 : 0,
      noOutletPieceCount: ready ? 4 : 0,
      chainCount: ready ? 2 : 0,
    },
    fabricationPieceDirectionSemantics: 'listed-piece-start-to-far-end',
    hydraulicFlowDirectionSemantics: 'independent-approved-calculation-route',
    drainageDirectionSemantics: 'independent-high-to-low-grade-schedule',
    ninePieceFabricationReady: ready,
    elevenOutletScheduleReady: ready,
    sixDirectSprinklerOutletIdentityReady: ready,
    fiveBranchOrArmOverOutletScheduleReady: ready,
    fourNoOutletPieceScheduleReady: ready,
    transitionScheduleReady: ready,
    cmi01SourceOutletZReady: ready,
    boundedRemainingCmiFittingScheduleReady: ready,
    completeFittingScheduleReady: false,
    exactWholeSystemZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}
