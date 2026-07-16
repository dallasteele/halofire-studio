/**
 * Validate the native AutoSPRINK FAB attachment graph against its printed
 * fabrication listing. Project.seidb parent IDs prove line-to-pipe,
 * pipe-to-outlet, and pipe-to-fitting attachments. They do not prove which
 * second pipe shares a fitting, so inter-piece adjacency and takeout remain
 * explicitly fail-closed.
 */

const EXPECTED_PROJECT_SHA = 'A449B6C8670CEE52955C3D3D57F8169E3091CFA34C943C6723785724F06DDED9'
const EXPECTED_PROJECT_ID = 'new-hope-crisis-center-brigham-city-ut'
const EXPECTED_MEMBER_SHA = '0B64077B62673459C11D2CBC303258C1DD3F0C75735A07BFFA903BAEE79D6135'
const EXPECTED_LISTING_SHA = '2E01CB3C2C39289846DF0A17A758E6D1DE4F5A682ED139556BD864BF6F8BD734'
const EXPECTED_CONTROL_FAB_SHA = 'E42E13068F5B737E4C9C0D7B2FDA79DC0C49694A7354046526358A9CD15F7B1A'
const EXPECTED_CONTROL_PDF_SHA = '417E8E7916EC822531529E76A5D4C22269868459546BE14B0EA459C61FF16300'
const EXPECTED_COUNTS = Object.freeze({ lines: 66, pipes: 272, outlets: 293, fittings: 97 })
const EXPECTED_FAMILY_COUNTS = Object.freeze({
  'threaded-90-elbow': 57,
  'threaded-90-reducing-elbow': 6,
  'threaded-reducer': 30,
  'threaded-straight-tee': 4,
})
const EXPECTED_CONTROL_IDENTITIES = Object.freeze([
  ['DNA.B', 1099, '2 Threaded Straight Tee, DI'],
  ['DNA.C', 668, '2 Threaded, 90° Elbow, CI'],
  ['DNA.D', 2943, '2 Threaded, 45° Elbow, CI, Galv'],
  ['DNA.E', 668, '2 Threaded, 90° Elbow, CI'],
  ['I..1', 1252, '4 x 11 SOW Slip Redu Flange'],
])

const issue = (code, message, entityId = null) => ({
  severity: 'blocking',
  code,
  message,
  entityId,
})

function countBy(values, key) {
  const counts = {}
  for (const value of values) counts[value[key]] = (counts[value[key]] || 0) + 1
  return counts
}

function exactlyExpectedCounts(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value)
}

export function evaluateNativeFabAttachmentGraph({ graph, fabricationSchedule, parserControl } = {}) {
  const issues = []
  const records = graph?.records || {}
  const lines = Array.isArray(records.lines) ? records.lines : []
  const pipes = Array.isArray(records.pipes) ? records.pipes : []
  const outlets = Array.isArray(records.outlets) ? records.outlets : []
  const fittings = Array.isArray(records.fittings) ? records.fittings : []
  const edges = graph?.edges || {}

  if (
    graph?.artifactType !== 'halofire.autosprink-native-fab-attachment-graph.v1' ||
    graph?.identityNamespace !== 'Project.seidb.uniqueId' ||
    graph?.source?.archiveSha256 !== EXPECTED_PROJECT_SHA ||
    graph?.source?.memberSha256 !== EXPECTED_MEMBER_SHA ||
    graph?.source?.memberBytes !== 102757
  ) {
    issues.push(issue('NATIVE_FAB_GRAPH_SOURCE_INVALID', 'The attachment graph must retain the exact protected FAB and Project.seidb identities.'))
  }
  if (!exactlyExpectedCounts({ lines: lines.length, pipes: pipes.length, outlets: outlets.length, fittings: fittings.length }, EXPECTED_COUNTS)) {
    issues.push(issue('NATIVE_FAB_GRAPH_RECORD_COUNT_DRIFT', 'Native line, pipe, outlet, or fitting record counts changed.'))
  }

  const allRecords = [...lines, ...pipes, ...outlets, ...fittings]
  const uniqueIds = new Set(allRecords.map((record) => record.uniqueId))
  if (uniqueIds.size !== allRecords.length || allRecords.some((record) => !Number.isInteger(record.uniqueId))) {
    issues.push(issue('NATIVE_FAB_GRAPH_IDENTITY_COLLISION', 'Every topology record needs one integer Project.seidb unique ID across all tables.'))
  }
  const lineById = new Map(lines.map((line) => [line.uniqueId, line]))
  const pipeById = new Map(pipes.map((pipe) => [pipe.uniqueId, pipe]))
  const outletById = new Map(outlets.map((outlet) => [outlet.uniqueId, outlet]))
  const fittingById = new Map(fittings.map((fitting) => [fitting.uniqueId, fitting]))
  if (pipes.some((pipe) => !lineById.has(pipe.parentId))) issues.push(issue('NATIVE_FAB_GRAPH_LINE_PIPE_PARENT_UNRESOLVED', 'Every native pipe must resolve to its stored line parent.'))
  if (outlets.some((outlet) => !pipeById.has(outlet.parentId))) issues.push(issue('NATIVE_FAB_GRAPH_PIPE_OUTLET_PARENT_UNRESOLVED', 'Every native outlet must resolve to its stored pipe parent.'))
  if (fittings.some((fitting) => !pipeById.has(fitting.parentId))) issues.push(issue('NATIVE_FAB_GRAPH_PIPE_FITTING_PARENT_UNRESOLVED', 'Every native fitting must resolve to its stored pipe parent.'))

  const lineToPipe = Array.isArray(edges.lineToPipe) ? edges.lineToPipe : []
  const pipeToOutlet = Array.isArray(edges.pipeToOutlet) ? edges.pipeToOutlet : []
  const pipeToFitting = Array.isArray(edges.pipeToFitting) ? edges.pipeToFitting : []
  const lineEdgeKeys = new Set(lineToPipe.map((edge) => `${edge.fromLineUniqueId}|${edge.toPipeUniqueId}`))
  const outletEdgeKeys = new Set(pipeToOutlet.map((edge) => `${edge.fromPipeUniqueId}|${edge.toOutletUniqueId}`))
  const fittingEdgeKeys = new Set(pipeToFitting.map((edge) => `${edge.fromPipeUniqueId}|${edge.toFittingUniqueId}`))
  if (lineEdgeKeys.size !== pipes.length || pipes.some((pipe) => !lineEdgeKeys.has(`${pipe.parentId}|${pipe.uniqueId}`))) {
    issues.push(issue('NATIVE_FAB_GRAPH_LINE_PIPE_EDGE_DRIFT', 'Line-to-pipe edges must exactly replay every stored pipe parent.'))
  }
  if (outletEdgeKeys.size !== outlets.length || outlets.some((outlet) => !outletEdgeKeys.has(`${outlet.parentId}|${outlet.uniqueId}`))) {
    issues.push(issue('NATIVE_FAB_GRAPH_PIPE_OUTLET_EDGE_DRIFT', 'Pipe-to-outlet edges must exactly replay every stored outlet parent.'))
  }
  if (fittingEdgeKeys.size !== fittings.length || fittings.some((fitting) => !fittingEdgeKeys.has(`${fitting.parentId}|${fitting.uniqueId}`))) {
    issues.push(issue('NATIVE_FAB_GRAPH_PIPE_FITTING_EDGE_DRIFT', 'Pipe-to-fitting edges must exactly replay every stored fitting parent.'))
  }

  const schedulePieces = [...(fabricationSchedule?.weldedPieces || []), ...(fabricationSchedule?.threadedPieces || [])]
  const scheduleByPieceId = new Map(schedulePieces.map((piece) => [piece.pieceId, piece]))
  if (fabricationSchedule?.source?.sha256 !== EXPECTED_LISTING_SHA || schedulePieces.length !== 257) {
    issues.push(issue('NATIVE_FAB_GRAPH_LISTING_SOURCE_INVALID', 'Fitting identities must remain bound to the exact 42-page approved fabrication listing.'))
  }
  const attachments = fittings.map((fitting) => {
    const pipe = pipeById.get(fitting.parentId)
    const line = pipe ? lineById.get(pipe.parentId) : null
    const pieceId = line && pipe ? `${line.lineName}${pipe.pieceName}` : null
    const listed = pieceId ? scheduleByPieceId.get(pieceId) : null
    return {
      fittingUniqueId: fitting.uniqueId,
      pipeUniqueId: pipe?.uniqueId ?? null,
      pieceId,
      itemCode: fitting.itemCode,
      sizeCode: fitting.sizeCode,
      connectionId: fitting.connectionId,
      fittingConnectionId: fitting.fittingConnectionId,
      listedFamily: listed?.endFittingFamily ?? null,
      listedText: listed?.endFittingText ?? null,
      listedPortSizesIn: listed?.nominalPortSizesIn ?? null,
    }
  })
  const unlistedAttachments = attachments.filter((attachment) => !attachment.listedFamily || attachment.listedFamily === 'no-fitting')
  if (unlistedAttachments.length) {
    issues.push(issue('NATIVE_FAB_GRAPH_LISTING_IDENTITY_UNRESOLVED', 'Every native fitting attachment must resolve to a non-empty fitting identity on the approved listing.', unlistedAttachments[0].pieceId))
  }
  const familyCounts = countBy(attachments, 'listedFamily')
  if (!exactlyExpectedCounts(familyCounts, EXPECTED_FAMILY_COUNTS) || Object.keys(familyCounts).length !== Object.keys(EXPECTED_FAMILY_COUNTS).length) {
    issues.push(issue('NATIVE_FAB_GRAPH_FITTING_FAMILY_COUNT_DRIFT', 'The 97 native fitting attachments must retain the approved listing family distribution.'))
  }

  const control = parserControl?.crossProjectListingControl
  if (
    parserControl?.crossProjectParserControl?.archiveSha256 !== EXPECTED_CONTROL_FAB_SHA ||
    control?.listingPdfSha256 !== EXPECTED_CONTROL_PDF_SHA ||
    control?.pageCount !== 4 ||
    JSON.stringify((control?.fittingIdentities || []).map((entry) => [entry.pieceId, entry.itemCode, entry.listedText])) !== JSON.stringify(EXPECTED_CONTROL_IDENTITIES) ||
    control?.exactTakeoutPublished !== false
  ) {
    issues.push(issue('NATIVE_FAB_GRAPH_CROSS_PROJECT_CONTROL_INVALID', 'The closed-project native FAB rows must retain their five visually matched printed fitting identities and honest no-takeout boundary.'))
  }

  if (
    graph?.claims?.nativeAttachmentGraphReady !== true ||
    graph?.claims?.interPieceAdjacencyReady !== false ||
    graph?.claims?.exactFittingTakeoutReady !== false
  ) {
    issues.push(issue('NATIVE_FAB_GRAPH_FALSE_READINESS_PROMOTION', 'Attachment evidence cannot promote inter-piece adjacency or exact fitting takeout.'))
  }

  const ready = issues.length === 0
  return {
    projectId: EXPECTED_PROJECT_ID,
    status: ready ? 'passed' : 'blocked',
    issues,
    blockerCodes: issues.map((entry) => entry.code),
    metrics: {
      ...EXPECTED_COUNTS,
      lineToPipeEdges: lineToPipe.length,
      pipeToOutletEdges: pipeToOutlet.length,
      pipeToFittingEdges: pipeToFitting.length,
      listedFittingIdentityCount: attachments.filter((entry) => entry.listedFamily).length,
      familyCounts,
    },
    fittingAttachments: ready ? attachments : [],
    nativeAttachmentGraphReady: ready,
    listedFittingIdentityCoverageReady: ready,
    interPieceAdjacencyReady: false,
    exactFittingTakeoutReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  }
}
