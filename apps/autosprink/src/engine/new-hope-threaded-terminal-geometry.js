/**
 * Reconcile New Hope CMI.23-CMI.42 threaded terminal geometry without
 * inventing the per-piece 3D connections omitted by the plotted PDFs and FAB.
 *
 * The protected listing and Project.seidb close all twenty piece identities,
 * lengths, end preparations, and attached fitting families. Approved FP2.0
 * closes four horizontal arm-over routes and twelve direct carrier/head
 * endpoints. Equal-length pieces remain equivalence classes until a native
 * AutoSPRINK model or another same-project source publishes their exact
 * per-endpoint assignment and fitting takeout.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5'
const EXPECTED_FIELD_SHA = '4A47F9A45256DEBB9E5185396BC15526532A3EF420BCBF40EC0BCC0DC5F902B5'
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'
const EXPECTED_FAB_SHA = 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9'
const EXPECTED_MEMBER_SHA = '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135'

const PIECES = Object.freeze({
  'CMI.23': { cutLengthIn: 20, fittingFamily: 'threaded-90-elbow', nativeFittingItemCode: 1096, classId: 'short-horizontal' },
  'CMI.24': { cutLengthIn: 8.5, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'short-follower' },
  'CMI.25': { cutLengthIn: 80.5, fittingFamily: 'threaded-90-elbow', nativeFittingItemCode: 1096, classId: 'long-horizontal' },
  'CMI.26': { cutLengthIn: 1.5, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'long-follower' },
  'CMI.27': { cutLengthIn: 20, fittingFamily: 'threaded-90-elbow', nativeFittingItemCode: 1096, classId: 'short-horizontal' },
  'CMI.28': { cutLengthIn: 8.5, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'short-follower' },
  'CMI.29': { cutLengthIn: 80.5, fittingFamily: 'threaded-90-elbow', nativeFittingItemCode: 1096, classId: 'long-horizontal' },
  'CMI.30': { cutLengthIn: 1.5, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'long-follower' },
  'CMI.31': { cutLengthIn: 10, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-10' },
  'CMI.32': { cutLengthIn: 10, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-10' },
  'CMI.33': { cutLengthIn: 10, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-10' },
  'CMI.34': { cutLengthIn: 10, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-10' },
  'CMI.35': { cutLengthIn: 10, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-10' },
  'CMI.36': { cutLengthIn: 9.5, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-9.5' },
  'CMI.37': { cutLengthIn: 9.5, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-9.5' },
  'CMI.38': { cutLengthIn: 9, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-9' },
  'CMI.39': { cutLengthIn: 9.5, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-9.5' },
  'CMI.40': { cutLengthIn: 9.5, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-9.5' },
  'CMI.41': { cutLengthIn: 9, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-9' },
  'CMI.42': { cutLengthIn: 9, fittingFamily: 'threaded-reducer', nativeFittingItemCode: 1149, classId: 'direct-9' },
})

const ROUTE_CLASSES = Object.freeze({
  'short-horizontal': {
    pieceIds: ['CMI.23', 'CMI.27'],
    followerPieceIds: ['CMI.24', 'CMI.28'],
    edgeIds: ['source-edge-108', 'source-edge-109'],
    segmentIds: ['pipe-054', 'pipe-055'],
    terminalHeadIds: ['head-053', 'head-056'],
  },
  'long-horizontal': {
    pieceIds: ['CMI.25', 'CMI.29'],
    followerPieceIds: ['CMI.26', 'CMI.30'],
    edgeIds: ['source-edge-084', 'source-edge-085'],
    segmentIds: ['pipe-044', 'pipe-045'],
    terminalHeadIds: ['head-035', 'head-036'],
  },
})

const DIRECT_ENDPOINTS = Object.freeze([
  ['CMI.04', 'canonical-node-132', 'head-060'],
  ['CMI.05', 'canonical-node-134', 'head-059'],
  ['CMI.05', 'canonical-node-135', 'head-066'],
  ['CMI.05', 'canonical-node-136', 'head-065'],
  ['CMI.06', 'canonical-node-139', 'head-064'],
  ['CMI.06', 'canonical-node-140', 'head-063'],
  ['CMI.06', 'canonical-node-141', 'head-058'],
  ['CMI.06', 'canonical-node-142', 'head-057'],
  ['CMI.15', 'canonical-node-127', 'head-067'],
  ['CMI.15', 'canonical-node-128', 'head-061'],
  ['CMI.15', 'canonical-node-129', 'head-062'],
  ['CMI.15', 'canonical-node-130', 'head-068'],
])

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId })
const sorted = (values) => [...values].sort()
const exactSet = (actual, expected) => JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
const endpointKey = ({ carrierPieceId, canonicalNodeId, sprinklerId }) => `${carrierPieceId}|${canonicalNodeId}|${sprinklerId}`

function directEndpointsFromUpstream({ cmi05Cmi08Fabrication, cmi06VerticalOutlet, remainingCmiFabrication }) {
  const endpoints = []
  for (const [pieceId, piece] of Object.entries(cmi05Cmi08Fabrication?.pieces || {})) {
    for (const outlet of piece.outlets || []) {
      if (outlet.fitting === '3 x 1 threaded outlet' && !outlet.downstreamSourceSegmentId && outlet.sprinklerId) {
        endpoints.push({ carrierPieceId: pieceId, canonicalNodeId: outlet.canonicalNodeId, sprinklerId: outlet.sprinklerId })
      }
    }
  }
  for (const outlet of cmi06VerticalOutlet?.outlets || []) {
    if (outlet.fitting === '3 x 1 threaded outlet' && outlet.sprinklerId) {
      endpoints.push({ carrierPieceId: 'CMI.06', canonicalNodeId: outlet.canonicalNodeId, sprinklerId: outlet.sprinklerId })
    }
  }
  for (const outlet of remainingCmiFabrication?.outletRegistrations || []) {
    if (outlet.fitting === '3 x 1 threaded outlet' && !outlet.downstreamSourceSegmentId && outlet.sprinklerId) {
      endpoints.push({ carrierPieceId: outlet.pieceId, canonicalNodeId: outlet.canonicalNodeId, sprinklerId: outlet.sprinklerId })
    }
  }
  return endpoints
}

/**
 * @param {object} inputs
 * @param {object} inputs.canonicalTopology
 * @param {object} inputs.operationalAnnotations
 * @param {object} inputs.fabricationSchedule
 * @param {object} inputs.nativeFabGraph
 * @param {object} inputs.armOverDrainage
 * @param {object} inputs.cmi05Cmi08Fabrication
 * @param {object} inputs.cmi06VerticalOutlet
 * @param {object} inputs.remainingCmiFabrication
 * @returns {object} Bounded threaded terminal inventory and ambiguity result.
 */
export function evaluateNewHopeThreadedTerminalGeometry(inputs = {}) {
  const issues = []
  const {
    canonicalTopology,
    operationalAnnotations,
    fabricationSchedule,
    nativeFabGraph,
    armOverDrainage,
    cmi05Cmi08Fabrication,
    cmi06VerticalOutlet,
    remainingCmiFabrication,
  } = inputs

  if ([canonicalTopology, operationalAnnotations, fabricationSchedule].some((entry) => entry?.projectId !== EXPECTED_PROJECT_ID)) {
    issues.push(issue('NH_THREADED_TERMINAL_PROJECT_IDENTITY_INVALID', 'Every project-bearing input must identify New Hope.'))
  }
  const evidence = operationalAnnotations?.armOverFabricationEvidence
  const approvedPlanSource = operationalAnnotations?.sources?.find((entry) => entry.role === 'approved-plan')
  if (
    approvedPlanSource?.sha256 !== EXPECTED_PLAN_SHA ||
    evidence?.fieldSet?.sha256 !== EXPECTED_FIELD_SHA ||
    evidence?.fabricationListing?.sha256 !== EXPECTED_LISTING_SHA ||
    evidence?.fabricationArchive?.sha256 !== EXPECTED_FAB_SHA ||
    fabricationSchedule?.source?.sha256 !== EXPECTED_LISTING_SHA ||
    nativeFabGraph?.source?.archiveSha256 !== EXPECTED_FAB_SHA ||
    nativeFabGraph?.source?.memberSha256 !== EXPECTED_MEMBER_SHA
  ) {
    issues.push(issue('NH_THREADED_TERMINAL_SOURCE_INVALID', 'The result must remain bound to the protected FP2.0, field set, listing, FAB archive, and Project.seidb member.'))
  }
  if ([armOverDrainage, cmi05Cmi08Fabrication, cmi06VerticalOutlet, remainingCmiFabrication].some((entry) => entry?.status !== 'passed')) {
    issues.push(issue('NH_THREADED_TERMINAL_UPSTREAM_BLOCKED', 'Arm-over drainage and all four carrier fabrication schedules must pass first.'))
  }

  const lineById = new Map((nativeFabGraph?.records?.lines || []).map((line) => [line.uniqueId, line]))
  const nativePipes = (nativeFabGraph?.records?.pipes || []).map((pipe) => ({
    ...pipe,
    pieceId: `${lineById.get(pipe.parentId)?.lineName || ''}${pipe.pieceName || ''}`,
  }))
  const nativePipeByPieceId = new Map(nativePipes.map((pipe) => [pipe.pieceId, pipe]))
  const nativeFittingsByParent = new Map()
  for (const fitting of nativeFabGraph?.records?.fittings || []) {
    const rows = nativeFittingsByParent.get(fitting.parentId) || []
    rows.push(fitting)
    nativeFittingsByParent.set(fitting.parentId, rows)
  }
  const listingByPieceId = new Map((fabricationSchedule?.threadedPieces || []).map((piece) => [piece.pieceId, piece]))

  const pieces = []
  for (const [pieceId, expected] of Object.entries(PIECES)) {
    const listing = listingByPieceId.get(pieceId)
    const nativePipe = nativePipeByPieceId.get(pieceId)
    const nativeFittings = nativeFittingsByParent.get(nativePipe?.uniqueId) || []
    if (
      listing?.lineName !== 'CMI' ||
      listing?.physicalPage !== 42 ||
      listing?.quantity !== 1 ||
      listing?.cutLengthIn !== expected.cutLengthIn ||
      listing?.endFittingFamily !== expected.fittingFamily ||
      listing?.exactFittingSizeReady !== true ||
      listing?.nominalPortSizesIn?.[0] !== 1 ||
      JSON.stringify(listing?.endPreparation) !== JSON.stringify(['T', 'T']) ||
      nativePipe?.lengthFt * 12 !== expected.cutLengthIn ||
      nativePipe?.itemCode !== 140 ||
      nativePipe?.sizeCode !== 13 ||
      nativePipe?.endCode1 !== 18 ||
      nativePipe?.endCode2 !== 18 ||
      nativeFittings.length !== 1 ||
      nativeFittings[0]?.itemCode !== expected.nativeFittingItemCode
    ) {
      issues.push(issue('NH_THREADED_TERMINAL_PIECE_RECONCILIATION_INVALID', `${pieceId} must retain its exact listing/native length, T-T ends, and fitting family.`, pieceId))
      continue
    }
    pieces.push({
      pieceId,
      classId: expected.classId,
      cutLengthIn: expected.cutLengthIn,
      endFittingFamily: expected.fittingFamily,
      nativePipeUniqueId: nativePipe.uniqueId,
      nativeFittingUniqueId: nativeFittings[0].uniqueId,
    })
  }

  const cmiDirectedEdges = (armOverDrainage?.directedEdges || []).filter((entry) => entry.lineName === 'CMI')
  const armOverGroups = evidence?.groups || []
  const routeClasses = []
  for (const [classId, expected] of Object.entries(ROUTE_CLASSES)) {
    const group = armOverGroups.find((entry) => exactSet(entry.pieceIds || [], expected.pieceIds))
    const edges = cmiDirectedEdges.filter((entry) => expected.edgeIds.includes(entry.edgeId))
    if (
      !group ||
      !exactSet(group.sourceEdgeIds || [], expected.edgeIds) ||
      !exactSet(group.sourceSegmentIds || [], expected.segmentIds) ||
      !exactSet(edges.map((entry) => entry.edgeId), expected.edgeIds) ||
      !exactSet(edges.map((entry) => entry.sourceSegmentId), expected.segmentIds) ||
      !exactSet(edges.map((entry) => entry.sprinklerId), expected.terminalHeadIds) ||
      !edges.every((entry) => entry.highNodeId && entry.lowNodeId && entry.absoluteEndpointElevationsReady === false)
    ) {
      issues.push(issue('NH_THREADED_TERMINAL_ROUTE_CLASS_INVALID', `${classId} must retain its exact two-piece equivalence set and approved FP2.0 routes.`, classId))
      continue
    }
    routeClasses.push({
      classId,
      horizontalPieceIds: expected.pieceIds,
      followerPieceIds: expected.followerPieceIds,
      routes: edges.map((entry) => ({
        edgeId: entry.edgeId,
        sourceSegmentId: entry.sourceSegmentId,
        carrierNodeId: entry.lowNodeId,
        terminalNodeId: entry.highNodeId,
        sprinklerId: entry.sprinklerId,
        planLengthFt: entry.planLengthFt,
        requiredDropIn: entry.requiredDropIn,
      })),
      exactWithinClassAssignmentReady: false,
    })
  }

  const directEndpoints = directEndpointsFromUpstream({ cmi05Cmi08Fabrication, cmi06VerticalOutlet, remainingCmiFabrication })
  const expectedDirectKeys = DIRECT_ENDPOINTS.map(([carrierPieceId, canonicalNodeId, sprinklerId]) => `${carrierPieceId}|${canonicalNodeId}|${sprinklerId}`)
  if (directEndpoints.length !== 12 || !exactSet(directEndpoints.map(endpointKey), expectedDirectKeys)) {
    issues.push(issue('NH_THREADED_TERMINAL_DIRECT_ENDPOINT_SET_INVALID', 'The twelve direct CMI carrier outlets must retain their exact carrier piece, canonical node, and sprinkler identities.'))
  }
  for (const endpoint of directEndpoints) {
    const node = canonicalTopology?.nodes?.find((entry) => entry.id === endpoint.canonicalNodeId)
    if (!node || !exactSet(node.sprinklerIds || [], [endpoint.sprinklerId])) {
      issues.push(issue('NH_THREADED_TERMINAL_DIRECT_ENDPOINT_TOPOLOGY_INVALID', 'Every direct endpoint must remain coincident with its exact source sprinkler.', endpoint.canonicalNodeId))
    }
  }

  const ready = issues.length === 0 && pieces.length === 20 && routeClasses.length === 2 && directEndpoints.length === 12
  const classes = ready
    ? Object.entries(PIECES).reduce((result, [pieceId, piece]) => {
        const ids = result[piece.classId] || []
        ids.push(pieceId)
        result[piece.classId] = ids
        return result
      }, {})
    : {}

  return {
    artifactType: 'halofire.new-hope-threaded-terminal-geometry-result.v1',
    projectId: operationalAnnotations?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    pieces: ready ? pieces : [],
    equivalenceClasses: classes,
    routeClasses: ready ? routeClasses : [],
    directEndpoints: ready ? directEndpoints : [],
    ambiguity: ready
      ? {
          horizontalRouteAssignmentCount: 4,
          followerRouteAssignmentCount: 4,
          directPieceToEndpointAssignmentCount: 479001600,
          exactWholeTerminalAssignmentCount: 7664025600,
          reason: 'The protected PDF/listing/FAB publish equivalence classes and endpoint sets but omit the native per-piece 3D connection graph and raw fitting takeout.',
        }
      : null,
    metrics: {
      threadedPieceCount: ready ? 20 : 0,
      horizontalArmOverPieceCount: ready ? 4 : 0,
      followerNipplePieceCount: ready ? 4 : 0,
      directNipplePieceCount: ready ? 12 : 0,
      approvedHorizontalRouteCount: ready ? 4 : 0,
      directCarrierHeadEndpointCount: ready ? 12 : 0,
      equivalenceClassCount: ready ? Object.keys(classes).length : 0,
    },
    threadedTerminalInventoryReady: ready,
    threadedTerminalHorizontalRouteClassesReady: ready,
    threadedTerminalFollowerClassesReady: ready,
    threadedTerminalDirectEndpointSetReady: ready,
    threadedTerminalAmbiguityQuantified: ready,
    exactThreadedTerminalPieceAdjacencyReady: false,
    exactThreadedTerminalTakeoutReady: false,
    exactWholeSystemZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}
