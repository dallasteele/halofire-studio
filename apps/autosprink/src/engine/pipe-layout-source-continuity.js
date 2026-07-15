/**
 * Evaluate a same-project semantic supply chain without pretending that a
 * cross-sheet callout is an exact CAD endpoint match.
 *
 * This is intentionally narrower than geometric registration. Completed plan
 * sheets may prove that a fire-line connection feeds a particular riser and
 * hydraulic source even when the civil and sprinkler exports omit a shared
 * centerline endpoint. The semantic chain and the exact-coordinate result are
 * therefore reported independently.
 */

const NODE_KINDS = new Set([
  'fire-riser-connection',
  'underground-fire-line',
  'riser-assembly',
  'building-feed',
  'hydraulic-source-node',
]);
const EVIDENCE_MODES = new Set([
  'drawn-detail-continuity',
  'explicit-callout-continuity',
  'same-project-sheet-transition',
  'hydraulic-report-continuity',
]);
const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const shaReady = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);

function directedReachable(edges, startId) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.fromNodeId)) adjacency.set(edge.fromNodeId, []);
    adjacency.get(edge.fromNodeId).push(edge.toNodeId);
  }
  const seen = new Set(startId ? [startId] : []);
  const pending = startId ? [startId] : [];
  while (pending.length) {
    const nodeId = pending.shift();
    for (const next of adjacency.get(nodeId) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }
  return seen;
}

export function evaluatePipeLayoutSourceContinuity(evidence) {
  const issues = [];
  const sources = Array.isArray(evidence?.sourceBindings) ? evidence.sourceBindings : [];
  const nodes = Array.isArray(evidence?.nodes) ? evidence.nodes : [];
  const edges = Array.isArray(evidence?.edges) ? evidence.edges : [];

  if (evidence?.schema !== 'halofire.pipe-layout-source-continuity.v1') {
    issues.push(issue('SOURCE_CONTINUITY_IDENTITY_MISSING', 'The source-continuity artifact identity is missing.'));
  }
  if (!evidence?.projectId || sources.length < 3 || sources.some((source) => !source?.role || !shaReady(source.sha256)
    || !Array.isArray(source.physicalPages) || source.physicalPages.length === 0)) {
    issues.push(issue('SOURCE_CONTINUITY_SOURCE_BINDING_INVALID', 'Same-project source roles, hashes, and physical pages are required.'));
  }

  const nodeById = new Map();
  for (const node of nodes) {
    if (!node?.id || nodeById.has(node.id) || !NODE_KINDS.has(node.kind) || !node.sourceRef) {
      issues.push(issue('SOURCE_CONTINUITY_NODE_INVALID', 'Each supply-chain node needs a unique id, governed kind, and source reference.', node?.id));
      continue;
    }
    nodeById.set(node.id, node);
  }

  for (const edge of edges) {
    if (!edge?.id || !nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)
      || !EVIDENCE_MODES.has(edge.evidenceMode) || !edge.sourceRef) {
      issues.push(issue('SOURCE_CONTINUITY_EDGE_INVALID', 'Each directed transition needs existing endpoints, an evidence mode, and a source reference.', edge?.id));
    }
  }

  const connectionNodes = nodes.filter((node) => node.kind === 'fire-riser-connection');
  const hydraulicNodes = nodes.filter((node) => node.kind === 'hydraulic-source-node');
  if (connectionNodes.length !== 1 || hydraulicNodes.length !== 1) {
    issues.push(issue('SOURCE_CONTINUITY_TERMINALS_INVALID', 'Exactly one fire-riser connection and one hydraulic source node are required.'));
  }
  for (const kind of ['underground-fire-line', 'riser-assembly', 'building-feed']) {
    if (!nodes.some((node) => node.kind === kind)) {
      issues.push(issue('SOURCE_CONTINUITY_STAGE_MISSING', `The ${kind} stage is missing from the same-project supply chain.`, kind));
    }
  }

  const reachable = directedReachable(edges.filter((edge) => nodeById.has(edge.fromNodeId) && nodeById.has(edge.toNodeId)), connectionNodes[0]?.id);
  const chainReady = hydraulicNodes.length === 1 && reachable.has(hydraulicNodes[0].id);
  if (!chainReady) {
    issues.push(issue('SOURCE_CONTINUITY_CHAIN_OPEN', 'The fire-line connection does not reach the hydraulic source through the evidence-backed directed chain.'));
  }

  const deviceBindings = evidence?.deviceBindings || {};
  const riserDeviceSemanticsReady = Boolean(deviceBindings.testAndDrain?.sourceRef
    && deviceBindings.mainDrain?.sourceRef
    && deviceBindings.undergroundInlet?.sourceRef
    && deviceBindings.buildingFeed?.sourceRef);
  if (!riserDeviceSemanticsReady) {
    issues.push(issue('SOURCE_CONTINUITY_RISER_DEVICE_BINDING_MISSING', 'Underground inlet, building feed, test-and-drain, and main-drain source references are required.'));
  }

  const semanticReady = issues.length === 0;
  return {
    schema: 'halofire.pipe-layout-source-continuity-result.v1',
    projectId: evidence?.projectId ?? null,
    status: semanticReady ? 'passed' : 'blocked',
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    sourceBindingCount: sources.length,
    chainNodeCount: nodes.length,
    chainEdgeCount: edges.length,
    reachableNodeCount: reachable.size,
    sameProjectSemanticSourceContinuityReady: semanticReady,
    exactCrossDrawingEndpointGeometryReady: evidence?.exactCrossDrawingEndpointGeometryReady === true,
    riserDeviceSemanticsReady,
    interpretation: 'A same-project plan/detail/callout chain can prove supply intent while exact civil-to-sprinkler CAD endpoint geometry remains independently held.',
  };
}
