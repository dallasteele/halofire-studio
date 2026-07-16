/**
 * Same-project welded connection graph for New Hope's source CML.01 piece and
 * every listed CMI.01-CMI.22 piece visible on approved FP2.0.
 *
 * This closes identity and inter-piece adjacency only for the 23-piece welded
 * source/cross-main/ridge subnetwork. The approved listing says every one of
 * these ends is G-G with "No Fitting", while Project.seidb attaches 45 outlets
 * and zero threaded fitting rows to the same native piece identities. Coupling
 * takeout, CMI.23-CMI.42 terminal geometry, the other fabrication lines, and
 * whole-project Z remain deliberately fail-closed.
 */

const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_PLAN_SHA = '5A770222363228C2766605A695FEE9B6CB1F7B49C296204E09B691100253D9D5'
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'
const EXPECTED_FAB_SHA = 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9'
const EXPECTED_MEMBER_SHA = '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135'

const CMI_PIECES = Object.freeze([
  ['CMI.01', 'pipe-002', 'canonical-node-002', 'canonical-node-004', 12, 3, 'cross-main'],
  ['CMI.02', 'pipe-003', 'canonical-node-004', 'canonical-node-005', 33.5, 3, 'cross-main'],
  ['CMI.03', 'pipe-058', 'canonical-node-005', 'canonical-node-125', 252, 3, 'cross-main'],
  ['CMI.04', 'pipe-061', 'canonical-node-125', 'canonical-node-133', 57, 3, 'cross-main'],
  ['CMI.05', 'pipe-062', 'canonical-node-133', 'canonical-node-137', 252, 3, 'cross-main'],
  ['CMI.06', 'pipe-067', 'canonical-node-137', 'canonical-node-138', 252, 3, 'cross-main'],
  ['CMI.07', 'pipe-063', 'canonical-node-138', 'canonical-node-053', 120.5, 3, 'cross-main'],
  ['CMI.08', 'pipe-030', 'canonical-node-053', 'canonical-node-054', 97.5, 3, 'cross-main'],
  ['CMI.09', 'pipe-032', 'canonical-node-054', 'canonical-node-057', 64.5, 2.5, 'branch-line'],
  ['CMI.10', 'pipe-038', 'canonical-node-057', 'canonical-node-071', 252, 2.5, 'branch-line'],
  ['CMI.11', 'pipe-048', 'canonical-node-071', 'canonical-node-097', 34.5, 2.5, 'branch-line'],
  ['CMI.12', 'pipe-050', 'canonical-node-097', 'canonical-node-099', 197.5, 2.5, 'branch-line'],
  ['CMI.13', 'pipe-052', 'canonical-node-099', 'canonical-node-107', 252, 2.5, 'branch-line'],
  ['CMI.14', 'pipe-059', 'canonical-node-125', 'canonical-node-126', 5, 3, 'cross-main'],
  ['CMI.15', 'pipe-060', 'canonical-node-126', 'canonical-node-131', 252, 3, 'cross-main'],
  ['CMI.16', 'pipe-064', 'canonical-node-131', 'canonical-node-055', 120.5, 3, 'cross-main'],
  ['CMI.17', 'pipe-031', 'canonical-node-055', 'canonical-node-056', 97.5, 3, 'cross-main'],
  ['CMI.18', 'pipe-033', 'canonical-node-056', 'canonical-node-060', 64.5, 2.5, 'branch-line'],
  ['CMI.19', 'pipe-039', 'canonical-node-060', 'canonical-node-075', 252, 2.5, 'branch-line'],
  ['CMI.20', 'pipe-049', 'canonical-node-075', 'canonical-node-098', 34.5, 2.5, 'branch-line'],
  ['CMI.21', 'pipe-051', 'canonical-node-098', 'canonical-node-103', 197.5, 2.5, 'branch-line'],
  ['CMI.22', 'pipe-053', 'canonical-node-103', 'canonical-node-112', 252, 2.5, 'branch-line'],
].map(([pieceId, sourceSegmentId, startNodeId, farNodeId, cutLengthIn, nominalDiameterIn, systemRole]) => ({
  pieceId,
  sourceSegmentId,
  startNodeId,
  farNodeId,
  cutLengthIn,
  nominalDiameterIn,
  systemRole,
})))

const CHAIN_PATHS = Object.freeze([
  ['CML.01', 'CMI.01', 'CMI.02', 'CMI.03'],
  ['CMI.03', 'CMI.04', 'CMI.05', 'CMI.06', 'CMI.07', 'CMI.08', 'CMI.09', 'CMI.10', 'CMI.11', 'CMI.12', 'CMI.13'],
  ['CMI.03', 'CMI.14', 'CMI.15', 'CMI.16', 'CMI.17', 'CMI.18', 'CMI.19', 'CMI.20', 'CMI.21', 'CMI.22'],
])

const EXPECTED_ADJACENCIES = Object.freeze(
  CHAIN_PATHS.flatMap((path) => path.slice(0, -1).map((pieceId, index) => [pieceId, path[index + 1]])),
)

const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId })
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function collectCmiBindings(operationalAnnotations) {
  const evidence = operationalAnnotations?.fabricationLineEvidence || {}
  return [
    ...(evidence.remainingCmiPieceBindings || []),
    ...(evidence.crossMainPieceBindings || []),
    ...(evidence.verticalOutletBindings || []),
    ...(evidence.lowPointPieceBindings || []),
    ...(evidence.ridgeChainPieceBindings || []),
  ].filter((entry) => /^CMI\.\d{2}$/.test(entry?.pieceId || ''))
}

function validateUpstream(inputs, issues) {
  const checks = [
    [inputs.sourceFeedFabrication, 'sourceFeedPlanFabricationReady'],
    [inputs.remainingCmiFabrication, 'ninePieceFabricationReady'],
    [inputs.cmi05Cmi08Fabrication, 'cmi05Cmi08BoundedFittingScheduleReady'],
    [inputs.cmi06VerticalOutlet, 'cmi06PieceFabricationReady'],
    [inputs.lowPointFabrication, 'lowPointPieceFabricationReady'],
    [inputs.cmiRidgeChainFabrication, 'eightPieceFabricationReady'],
  ]
  if (checks.some(([entry, flag]) => entry?.status !== 'passed' || entry?.[flag] !== true)) {
    issues.push(issue('NH_CML_CMI_WELDED_UPSTREAM_EVIDENCE_BLOCKED', 'Every bounded CML/CMI piece evaluator must pass before their connection graph can be assembled.'))
  }
}

/**
 * @param {object} inputs
 * @returns {object} Bounded 23-piece, 22-adjacency same-project graph result.
 */
export function evaluateNewHopeCmlCmiWeldedConnectionGraph(inputs = {}) {
  const issues = []
  const {
    canonicalTopology,
    operationalAnnotations,
    fabricationSchedule,
    nativeFabGraph,
    sourceFeedFabrication,
  } = inputs
  validateUpstream(inputs, issues)

  if (
    canonicalTopology?.projectId !== EXPECTED_PROJECT_ID ||
    operationalAnnotations?.projectId !== EXPECTED_PROJECT_ID ||
    fabricationSchedule?.projectId !== EXPECTED_PROJECT_ID
  ) {
    issues.push(issue('NH_CML_CMI_WELDED_PROJECT_IDENTITY_INVALID', 'The plan, operational evidence, and listing must all identify New Hope.'))
  }
  if (
    canonicalTopology?.canonicalTopologyReady !== true ||
    operationalAnnotations?.sources?.find((entry) => entry.role === 'approved-plan')?.sha256 !== EXPECTED_PLAN_SHA ||
    fabricationSchedule?.source?.sha256 !== EXPECTED_LISTING_SHA ||
    nativeFabGraph?.source?.archiveSha256 !== EXPECTED_FAB_SHA ||
    nativeFabGraph?.source?.memberSha256 !== EXPECTED_MEMBER_SHA
  ) {
    issues.push(issue('NH_CML_CMI_WELDED_SOURCE_INVALID', 'The graph must remain bound to the protected approved FP2.0, fabrication listing, FAB archive, and Project.seidb member.'))
  }

  const nodeById = new Map((canonicalTopology?.nodes || []).map((node) => [node.id, node]))
  const bindings = collectCmiBindings(operationalAnnotations)
  const bindingsById = new Map(bindings.map((entry) => [entry.pieceId, entry]))
  if (bindings.length !== 22 || bindingsById.size !== 22) {
    issues.push(issue('NH_CML_CMI_WELDED_BINDING_INVENTORY_INVALID', 'Exactly one source-bound FP2.0 binding is required for every CMI.01-CMI.22 piece.'))
  }

  for (const expected of CMI_PIECES) {
    const binding = bindingsById.get(expected.pieceId)
    if (
      binding?.sourceSegmentId !== expected.sourceSegmentId ||
      binding?.pieceStartCanonicalNodeId !== expected.startNodeId ||
      binding?.pieceFarEndCanonicalNodeId !== expected.farNodeId ||
      binding?.cutLengthIn !== expected.cutLengthIn ||
      binding?.nominalDiameterIn !== expected.nominalDiameterIn ||
      binding?.systemRole !== expected.systemRole ||
      !Array.isArray(binding?.sourceEdgeIds) ||
      binding.sourceEdgeIds.length === 0
    ) {
      issues.push(issue('NH_CML_CMI_WELDED_PIECE_BINDING_INVALID', 'Each CMI piece must retain its exact source segment, endpoints, length, size, role, and source-edge traversal.', expected.pieceId))
      continue
    }
    const start = nodeById.get(expected.startNodeId)
    const far = nodeById.get(expected.farNodeId)
    if (!start?.sourceSegmentIds?.includes(expected.sourceSegmentId) || !far?.sourceSegmentIds?.includes(expected.sourceSegmentId)) {
      issues.push(issue('NH_CML_CMI_WELDED_ENDPOINT_INVALID', 'Both canonical piece endpoints must remain incident to the piece source segment.', expected.pieceId))
    }
  }

  const lineById = new Map((nativeFabGraph?.records?.lines || []).map((line) => [line.uniqueId, line]))
  const nativePipes = (nativeFabGraph?.records?.pipes || []).map((pipe) => ({
    ...pipe,
    pieceId: `${lineById.get(pipe.parentId)?.lineName || ''}${pipe.pieceName || ''}`,
  }))
  const expectedIds = new Set(['CML.01', ...CMI_PIECES.map((entry) => entry.pieceId)])
  const boundedNativePipes = nativePipes.filter((pipe) => expectedIds.has(pipe.pieceId))
  const nativePipeIds = new Set(boundedNativePipes.map((pipe) => pipe.uniqueId))
  const nativeOutlets = (nativeFabGraph?.records?.outlets || []).filter((outlet) => nativePipeIds.has(outlet.parentId))
  const nativeFittings = (nativeFabGraph?.records?.fittings || []).filter((fitting) => nativePipeIds.has(fitting.parentId))
  if (
    boundedNativePipes.length !== 23 ||
    new Set(boundedNativePipes.map((pipe) => pipe.pieceId)).size !== 23 ||
    nativeOutlets.length !== 45 ||
    nativeFittings.length !== 0
  ) {
    issues.push(issue('NH_CML_CMI_WELDED_NATIVE_INVENTORY_INVALID', 'Project.seidb must retain 23 bounded welded pipe identities, 45 attached outlets, and zero attached threaded fitting rows.'))
  }

  const schedulePieces = fabricationSchedule?.weldedPieces || []
  const scheduleById = new Map(schedulePieces.map((piece) => [piece.pieceId, piece]))
  for (const pieceId of expectedIds) {
    const listed = scheduleById.get(pieceId)
    const native = boundedNativePipes.find((pipe) => pipe.pieceId === pieceId)
    const expectedLengthIn = pieceId === 'CML.01'
      ? 35.5
      : CMI_PIECES.find((piece) => piece.pieceId === pieceId)?.cutLengthIn
    if (
      listed?.quantity !== 1 ||
      !same(listed?.endPreparation, ['G', 'G']) ||
      !same(listed?.endFittingFamilies, ['no-fitting', 'no-fitting']) ||
      !native ||
      Math.abs(native.lengthFt * 12 - expectedLengthIn) > 1e-8
    ) {
      issues.push(issue('NH_CML_CMI_WELDED_LISTING_NATIVE_CROSSWALK_INVALID', 'Every bounded piece must reconcile one-to-one between the listing and Project.seidb with exact cut length and G-G/no-fitting ends.', pieceId))
    }
  }

  const pieceEndpoint = new Map(CMI_PIECES.map((piece) => [piece.pieceId, { startNodeId: piece.startNodeId, farNodeId: piece.farNodeId, sourceSegmentId: piece.sourceSegmentId }]))
  pieceEndpoint.set('CML.01', {
    startNodeId: 'canonical-node-001',
    farNodeId: sourceFeedFabrication?.outlet?.canonicalNodeId,
    sourceSegmentId: 'pipe-001',
  })
  const adjacencyKeys = new Set()
  const adjacencies = []
  for (const [fromPieceId, toPieceId] of EXPECTED_ADJACENCIES) {
    const from = pieceEndpoint.get(fromPieceId)
    const to = pieceEndpoint.get(toPieceId)
    const junctionNodeId = from?.farNodeId
    const junction = nodeById.get(junctionNodeId)
    const key = `${fromPieceId}|${toPieceId}`
    if (
      !from ||
      !to ||
      junctionNodeId !== to.startNodeId ||
      !junction?.sourceSegmentIds?.includes(from.sourceSegmentId) ||
      !junction?.sourceSegmentIds?.includes(to.sourceSegmentId) ||
      adjacencyKeys.has(key)
    ) {
      issues.push(issue('NH_CML_CMI_WELDED_ADJACENCY_INVALID', 'Every bounded inter-piece edge must share one exact FP2.0 canonical junction incident to both source segments.', key))
      continue
    }
    adjacencyKeys.add(key)
    adjacencies.push({ fromPieceId, toPieceId, junctionNodeId })
  }
  if (adjacencies.length !== 22 || adjacencyKeys.size !== 22) {
    issues.push(issue('NH_CML_CMI_WELDED_ADJACENCY_COUNT_INVALID', 'The bounded 23-piece tree must retain exactly 22 unique inter-piece adjacencies.'))
  }
  const cmi03Branches = adjacencies.filter((edge) => edge.fromPieceId === 'CMI.03')
  if (!same(cmi03Branches, [
    { fromPieceId: 'CMI.03', toPieceId: 'CMI.04', junctionNodeId: 'canonical-node-125' },
    { fromPieceId: 'CMI.03', toPieceId: 'CMI.14', junctionNodeId: 'canonical-node-125' },
  ])) {
    issues.push(issue('NH_CML_CMI_WELDED_BIFURCATION_INVALID', 'CMI.03 must bifurcate into the lower CMI.04 chain and upper CMI.14 chain at canonical node 125.'))
  }

  const ready = issues.length === 0
  return {
    artifactType: 'halofire.new-hope-cml-cmi-welded-connection-graph-result.v1',
    projectId: canonicalTopology?.projectId,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    pieces: ready
      ? ['CML.01', ...CMI_PIECES.map((entry) => entry.pieceId)].map((pieceId) => {
          const endpoint = pieceEndpoint.get(pieceId)
          const native = boundedNativePipes.find((pipe) => pipe.pieceId === pieceId)
          return {
            pieceId,
            sourceSegmentId: endpoint.sourceSegmentId,
            startNodeId: endpoint.startNodeId,
            farNodeId: endpoint.farNodeId,
            nativePipeUniqueId: native.uniqueId,
            nativeOutletCount: nativeOutlets.filter((outlet) => outlet.parentId === native.uniqueId).length,
          }
        })
      : [],
    adjacencies: ready ? adjacencies : [],
    metrics: {
      weldedPieceCount: ready ? 23 : 0,
      cmiPieceCount: ready ? 22 : 0,
      interPieceAdjacencyCount: ready ? 22 : 0,
      nativeOutletAttachmentCount: ready ? 45 : 0,
      nativeFittingAttachmentCount: ready ? 0 : 0,
      bifurcationCount: ready ? 1 : 0,
      connectedComponentCount: ready ? 1 : 0,
      cycleRank: ready ? 0 : null,
    },
    sameProjectCmlCmiWeldedIdentityReady: ready,
    sameProjectCmlCmiWeldedInterPieceAdjacencyReady: ready,
    sameProjectCmlCmiNativeOutletAttachmentReady: ready,
    exactConnectionTakeoutReady: false,
    threadedTerminalPieceAdjacencyReady: false,
    wholeProjectInterPieceAdjacencyReady: false,
    completeVerticalOffsetScheduleReady: false,
    exactWholeSystemZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}
