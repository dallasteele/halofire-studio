/**
 * Source-bound New Hope CMI.10-CMI.13 and CMI.19-CMI.22 ridge chains.
 *
 * The two chains are geometrically paired but not fabrication-identical:
 * CMI.13 carries the remote inspector-test outlet and CMI.22 does not.
 * Piece traversal, hydraulic flow, and drainage grade remain separate facts.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_FIELD_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5'
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'

const PIECES = Object.freeze({
  'CMI.10': { chainId: 'lower-east-ridge-chain', segmentId: 'pipe-038', drawingIndex: 5241, cutLengthIn: 252, listingPage: 16, edgeIds: ['source-edge-069', 'source-edge-068', 'source-edge-067', 'source-edge-066'], startNodeId: 'canonical-node-057', farNodeId: 'canonical-node-071' },
  'CMI.11': { chainId: 'lower-east-ridge-chain', segmentId: 'pipe-048', drawingIndex: 5862, cutLengthIn: 34.5, listingPage: 16, edgeIds: ['source-edge-088'], startNodeId: 'canonical-node-071', farNodeId: 'canonical-node-097' },
  'CMI.12': { chainId: 'lower-east-ridge-chain', segmentId: 'pipe-050', drawingIndex: 6005, cutLengthIn: 197.5, listingPage: 16, edgeIds: ['source-edge-093', 'source-edge-092', 'source-edge-091', 'source-edge-090'], startNodeId: 'canonical-node-097', farNodeId: 'canonical-node-099' },
  'CMI.13': { chainId: 'lower-east-ridge-chain', segmentId: 'pipe-052', drawingIndex: 6106, cutLengthIn: 252, listingPage: 16, edgeIds: ['source-edge-102', 'source-edge-101', 'source-edge-100', 'source-edge-099', 'source-edge-098'], startNodeId: 'canonical-node-099', farNodeId: 'canonical-node-107' },
  'CMI.19': { chainId: 'upper-east-ridge-chain', segmentId: 'pipe-039', drawingIndex: 5242, cutLengthIn: 252, listingPage: 17, edgeIds: ['source-edge-073', 'source-edge-072', 'source-edge-071', 'source-edge-070'], startNodeId: 'canonical-node-060', farNodeId: 'canonical-node-075' },
  'CMI.20': { chainId: 'upper-east-ridge-chain', segmentId: 'pipe-049', drawingIndex: 5863, cutLengthIn: 34.5, listingPage: 18, edgeIds: ['source-edge-089'], startNodeId: 'canonical-node-075', farNodeId: 'canonical-node-098' },
  'CMI.21': { chainId: 'upper-east-ridge-chain', segmentId: 'pipe-051', drawingIndex: 6006, cutLengthIn: 197.5, listingPage: 18, edgeIds: ['source-edge-097', 'source-edge-096', 'source-edge-095', 'source-edge-094'], startNodeId: 'canonical-node-098', farNodeId: 'canonical-node-103' },
  'CMI.22': { chainId: 'upper-east-ridge-chain', segmentId: 'pipe-053', drawingIndex: 6107, cutLengthIn: 252, listingPage: 18, edgeIds: ['source-edge-107', 'source-edge-106', 'source-edge-105', 'source-edge-104', 'source-edge-103'], startNodeId: 'canonical-node-103', farNodeId: 'canonical-node-112' },
})

const EXPECTED_OUTLETS = Object.freeze({
  'CMI.10': [
    ['canonical-node-074', 'head-025', 42, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-073', 'head-029', 114, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-072', 'head-031', 186, '2-1/2 x 3/4 threaded outlet'],
  ],
  'CMI.11': [],
  'CMI.12': [
    ['canonical-node-102', 'head-039', 11.5, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-101', 'head-041', 83.5, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-100', 'head-043', 155.5, '2-1/2 x 3/4 threaded outlet'],
  ],
  'CMI.13': [
    ['canonical-node-111', 'head-045', 30, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-110', 'head-047', 102, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-109', 'head-049', 174, '2-1/2 x 3/4 threaded outlet'],
    [null, null, 238, '2-1/2 x 1 threaded outlet'],
    ['canonical-node-108', 'head-051', 246, '2-1/2 x 3/4 threaded outlet'],
  ],
  'CMI.19': [
    ['canonical-node-078', 'head-026', 42, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-077', 'head-030', 114, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-076', 'head-032', 186, '2-1/2 x 3/4 threaded outlet'],
  ],
  'CMI.20': [],
  'CMI.21': [
    ['canonical-node-106', 'head-040', 11.5, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-105', 'head-042', 83.5, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-104', 'head-044', 155.5, '2-1/2 x 3/4 threaded outlet'],
  ],
  'CMI.22': [
    ['canonical-node-116', 'head-046', 30, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-115', 'head-048', 102, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-114', 'head-050', 174, '2-1/2 x 3/4 threaded outlet'],
    ['canonical-node-113', 'head-052', 246, '2-1/2 x 3/4 threaded outlet'],
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
    traversedEdges.push({ edge, edgeId, fromNodeId: currentNodeId, toNodeId: nextNodeId, traversal })
    currentNodeId = nextNodeId
  }
  return { traversedEdges, stationByNode, farNodeId: currentNodeId, planLengthIn: round(cumulativeIn) }
}

function remoteReferenceRegistration(segment, startNode, farNode, operationalReference) {
  const sourceVector = operationalReference?.sourceVector
  if (
    !segment?.fromPdfPt ||
    !segment?.toPdfPt ||
    !startNode?.pdfPt ||
    !farNode?.plan ||
    !startNode?.plan ||
    !sourceVector?.fromPdfPt
  ) {
    return { planStationIn: null, crossTrackPdfPt: null, projectionFraction: null }
  }
  const endpoints = [segment?.fromPdfPt, segment?.toPdfPt]
  const startPt = endpoints.sort(
    (a, b) => Math.hypot(a.x - startNode.pdfPt.x, a.y - startNode.pdfPt.y) - Math.hypot(b.x - startNode.pdfPt.x, b.y - startNode.pdfPt.y),
  )[0]
  const endPt = endpoints.find((point) => point !== startPt)
  const vx = endPt.x - startPt.x
  const vy = endPt.y - startPt.y
  const lengthSquared = vx * vx + vy * vy
  const rx = sourceVector?.fromPdfPt?.x - startPt.x
  const ry = sourceVector?.fromPdfPt?.y - startPt.y
  const t = lengthSquared ? (rx * vx + ry * vy) / lengthSquared : NaN
  const projection = { x: startPt.x + t * vx, y: startPt.y + t * vy }
  const segmentPlanLengthIn = Math.hypot(
    farNode.plan.xFt - startNode.plan.xFt,
    farNode.plan.yFt - startNode.plan.yFt,
  ) * 12
  return {
    planStationIn: round(t * segmentPlanLengthIn),
    crossTrackPdfPt: round(Math.hypot(sourceVector?.fromPdfPt?.x - projection.x, sourceVector?.fromPdfPt?.y - projection.y)),
    projectionFraction: round(t),
  }
}

/**
 * @param {object} inputs
 * @param {object} inputs.pipeVectors
 * @param {object} inputs.canonicalTopology
 * @param {object} inputs.governedSkeleton
 * @param {object} inputs.operationalAnnotations
 * @returns {object} Eight-piece ridge-chain fabrication result.
 */
export function evaluateNewHopeCmiRidgeChainFabrication(inputs = {}) {
  const issues = []
  const { pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations } = inputs
  const evidenceBindings = operationalAnnotations?.fabricationLineEvidence?.ridgeChainPieceBindings || []
  const fieldSet = operationalAnnotations?.fabricationLineEvidence?.fieldSet
  const listing = operationalAnnotations?.fabricationLineEvidence?.fabricationListing
  const edgeById = new Map((canonicalTopology?.edges || []).map((edge) => [edge.id, edge]))
  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]))
  const segmentById = new Map((pipeVectors?.pipeSegments || []).map((segment) => [segment.id, segment]))
  const roleBySegmentId = new Map((governedSkeleton?.primaryAssignments || []).map((entry) => [entry.sourceSegmentId, entry]))

  if ([pipeVectors, canonicalTopology, governedSkeleton, operationalAnnotations].some((entry) => entry?.projectId !== EXPECTED_PROJECT_ID)) {
    issues.push(issue('NH_CMI_RIDGE_PROJECT_IDENTITY_INVALID', 'Every input must identify New Hope.'))
  }
  if (fieldSet?.sha256 !== EXPECTED_FIELD_SHA || fieldSet?.sheet !== 'FP2.0' || fieldSet?.physicalPage !== 4 || listing?.sha256 !== EXPECTED_LISTING_SHA || listing?.fileName !== '24-052_NHCC_LIST.PDF') {
    issues.push(issue('NH_CMI_RIDGE_FABRICATION_SOURCE_INVALID', 'The ridge-chain schedule must remain bound to the exact field set and AutoSPRINK listing.'))
  }

  const results = {}
  for (const [pieceId, expected] of Object.entries(PIECES)) {
    const evidence = evidenceBindings.find((entry) => entry.pieceId === pieceId)
    const segment = segmentById.get(expected.segmentId)
    const role = roleBySegmentId.get(expected.segmentId)
    const traversal = traversePiece(expected, edgeById)
    if (evidence?.chainId !== expected.chainId || evidence?.systemRole !== 'branch-line' || evidence?.nominalDiameterIn !== 2.5 || evidence?.cutLengthIn !== expected.cutLengthIn || evidence?.fabricationListingPage !== expected.listingPage || evidence?.sourceSegmentId !== expected.segmentId || JSON.stringify(evidence?.sourceEdgeIds) !== JSON.stringify(expected.edgeIds)) {
      issues.push(issue('NH_CMI_RIDGE_PIECE_IDENTITY_INVALID', `${pieceId} must retain its exact chain, size, cut length, listing page, segment, and edge order.`, pieceId))
    }
    if (governedSkeleton?.status !== 'passed' || role?.systemRole !== 'branch-line' || role?.nominalDiameterIn !== 2.5 || segment?.drawingIndex !== expected.drawingIndex || segment?.strokeClass !== 'red-pipe') {
      issues.push(issue('NH_CMI_RIDGE_GOVERNED_ROLE_INVALID', `${pieceId} must remain a governed 2-1/2-inch red branch-line segment.`, expected.segmentId))
    }
    if (evidence?.pieceStartCanonicalNodeId !== expected.startNodeId || evidence?.pieceFarEndCanonicalNodeId !== expected.farNodeId || traversal.farNodeId !== expected.farNodeId || traversal.traversedEdges.some(({ edge, toNodeId }) => !edge || edge.sourceSegmentId !== expected.segmentId || !toNodeId)) {
      issues.push(issue('NH_CMI_RIDGE_PLAN_TOPOLOGY_INVALID', `${pieceId} must retain its ordered canonical traversal.`, pieceId))
    }
    const pieceLengthResidualIn = round(Math.abs(expected.cutLengthIn - traversal.planLengthIn))
    if (evidence?.maximumPlanResidualIn <= 0 || pieceLengthResidualIn > evidence?.maximumPlanResidualIn) {
      issues.push(issue('NH_CMI_RIDGE_PIECE_RESIDUAL_EXCEEDED', `${pieceId} plan length must stay within its declared PDF-to-listing tolerance.`, pieceId))
    }
    results[pieceId] = { evidence, expected, segment, traversal, pieceLengthResidualIn }
  }

  const outletResults = []
  for (const [pieceId, expectedOutlets] of Object.entries(EXPECTED_OUTLETS)) {
    const result = results[pieceId]
    if ((result.evidence?.outlets || []).length !== expectedOutlets.length) {
      issues.push(issue('NH_CMI_RIDGE_OUTLET_COUNT_INVALID', `${pieceId} must retain its exact listed outlet count.`, pieceId))
    }
    for (const [canonicalNodeId, sprinklerId, stationIn, fitting] of expectedOutlets) {
      const outlet = canonicalNodeId
        ? result.evidence?.outlets?.find((entry) => entry.canonicalNodeId === canonicalNodeId)
        : result.evidence?.outlets?.find((entry) => entry.operationalReferenceId === 'remote-inspectors-test')
      if (!outlet || outlet.fromPieceStartIn !== stationIn || outlet.fitting !== fitting || outlet.orientation !== 'up-0-degrees') {
        issues.push(issue('NH_CMI_RIDGE_OUTLET_SEQUENCE_INVALID', `${pieceId} outlets must retain their exact station, fitting, and Up:0 orientation.`, canonicalNodeId || 'remote-inspectors-test'))
        continue
      }
      if (canonicalNodeId) {
        const planStationIn = result.traversal.stationByNode.get(canonicalNodeId)
        const residualIn = round(Math.abs(stationIn - (planStationIn || 0)))
        if (outlet.sprinklerId !== sprinklerId || JSON.stringify(nodeById.get(canonicalNodeId)?.sprinklerIds) !== JSON.stringify([sprinklerId])) {
          issues.push(issue('NH_CMI_RIDGE_SPRINKLER_IDENTITY_INVALID', `${pieceId} sprinkler outlets must retain their canonical head identities.`, canonicalNodeId))
        }
        if (residualIn > result.evidence.maximumPlanResidualIn) {
          issues.push(issue('NH_CMI_RIDGE_OUTLET_RESIDUAL_EXCEEDED', `${pieceId} outlet station exceeds its declared PDF-to-listing tolerance.`, canonicalNodeId))
        }
        outletResults.push({ pieceId, canonicalNodeId, sprinklerId, listedStationIn: stationIn, planStationIn: round(planStationIn), residualIn, fitting })
      }
    }
  }

  const remoteEvidence = results['CMI.13'].evidence?.outlets?.find((entry) => entry.operationalReferenceId === 'remote-inspectors-test')
  const remoteAnnotation = operationalAnnotations?.remoteInspectorsTest
  const remoteSourceVector = operationalAnnotations?.operationalReferenceVectors?.find((entry) => entry.drawingIndex === 6610)
  const remoteRegistration = remoteReferenceRegistration(
    results['CMI.13'].segment,
    nodeById.get('canonical-node-099'),
    nodeById.get('canonical-node-107'),
    { sourceVector: remoteSourceVector },
  )
  const remoteStationResidualIn = round(Math.abs((remoteEvidence?.fromPieceStartIn || 0) - remoteRegistration.planStationIn))
  if (remoteEvidence?.referenceVectorDrawingIndex !== 6610 || remoteAnnotation?.id !== 'remote-inspectors-test' || remoteAnnotation?.nominalDiameterIn !== 1 || !remoteAnnotation?.sourceDrawingIndices?.includes(6729) || remoteSourceVector?.systemRole !== 'remote-inspectors-test' || !Number.isFinite(remoteRegistration.projectionFraction) || remoteRegistration.projectionFraction <= 0 || remoteRegistration.projectionFraction >= 1 || !Number.isFinite(remoteRegistration.crossTrackPdfPt) || remoteRegistration.crossTrackPdfPt > 2 || !Number.isFinite(remoteStationResidualIn) || remoteStationResidualIn > 2) {
    issues.push(issue('NH_CMI13_REMOTE_INSPECTOR_OUTLET_INVALID', 'CMI.13 must retain the listed one-inch outlet registered to the plan remote inspector-test vector.', 'remote-inspectors-test'))
  }
  if (results['CMI.22'].evidence?.outlets?.some((entry) => entry.operationalReferenceId) || results['CMI.13'].evidence?.outlets?.length !== 5 || results['CMI.22'].evidence?.outlets?.length !== 4) {
    issues.push(issue('NH_CMI_RIDGE_ASYMMETRY_INVALID', 'CMI.13 must retain its inspector-test outlet while CMI.22 remains a four-sprinkler-outlet piece.'))
  }

  for (const chain of [
    ['CMI.10', 'CMI.11', 'CMI.12', 'CMI.13'],
    ['CMI.19', 'CMI.20', 'CMI.21', 'CMI.22'],
  ]) {
    for (let index = 0; index < chain.length - 1; index += 1) {
      if (PIECES[chain[index]].farNodeId !== PIECES[chain[index + 1]].startNodeId) {
        issues.push(issue('NH_CMI_RIDGE_CHAIN_JUNCTION_INVALID', 'Consecutive ridge-chain pieces must share one canonical junction.', `${chain[index]}:${chain[index + 1]}`))
      }
    }
  }

  const ready = issues.length === 0
  return {
    artifactType: 'halofire.new-hope-cmi-ridge-chain-fabrication-result.v1',
    projectId: operationalAnnotations?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    pieces: ready ? Object.fromEntries(Object.entries(results).map(([pieceId, result]) => [pieceId, {
      pieceId,
      chainId: result.expected.chainId,
      nominalDiameterIn: 2.5,
      cutLengthIn: result.expected.cutLengthIn,
      sourceSegmentId: result.expected.segmentId,
      sourceEdgeIds: result.expected.edgeIds,
      pieceStartCanonicalNodeId: result.expected.startNodeId,
      pieceFarEndCanonicalNodeId: result.expected.farNodeId,
      planLengthIn: result.traversal.planLengthIn,
      pieceLengthResidualIn: result.pieceLengthResidualIn,
      outlets: result.evidence.outlets,
    }])) : {},
    outletRegistrations: ready ? outletResults : [],
    remoteInspectorTestOutlet: ready ? {
      pieceId: 'CMI.13',
      listedStationIn: remoteEvidence.fromPieceStartIn,
      planStationIn: remoteRegistration.planStationIn,
      stationResidualIn: remoteStationResidualIn,
      crossTrackPdfPt: remoteRegistration.crossTrackPdfPt,
      fitting: remoteEvidence.fitting,
      orientation: remoteEvidence.orientation,
      referenceVectorDrawingIndex: 6610,
    } : null,
    metrics: {
      boundedPieceCount: ready ? 8 : 0,
      boundedCanonicalEdgeCount: ready ? Object.values(PIECES).reduce((sum, piece) => sum + piece.edgeIds.length, 0) : 0,
      boundedOutletCount: ready ? 21 : 0,
      sprinklerOutletCount: ready ? 20 : 0,
      operationalOutletCount: ready ? 1 : 0,
      noOutletPieceCount: ready ? 2 : 0,
      chainCount: ready ? 2 : 0,
    },
    fabricationPieceDirectionSemantics: 'listed-piece-start-to-far-end',
    hydraulicFlowDirectionSemantics: 'independent-approved-calculation-route',
    drainageDirectionSemantics: 'independent-high-to-low-grade-schedule',
    eightPieceFabricationReady: ready,
    twentyOneOutletScheduleReady: ready,
    twentySprinklerOutletIdentityReady: ready,
    remoteInspectorTestOutletReady: ready,
    ridgeChainAsymmetryReady: ready,
    ridgeChainJunctionsReady: ready,
    boundedRidgeChainFittingScheduleReady: ready,
    completeFittingScheduleReady: false,
    exactWholeSystemZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}
