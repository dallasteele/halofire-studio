const issue = (code, message, entityId = null) => ({ severity: 'blocking', code, message, entityId });
const round = (value, digits = 6) => Number(value.toFixed(digits));

function countComponents(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)?.add(edge.fromNodeId);
  }
  const unseen = new Set(adjacency.keys());
  let count = 0;
  while (unseen.size) {
    count += 1;
    const queue = [unseen.values().next().value];
    unseen.delete(queue[0]);
    while (queue.length) {
      const current = queue.shift();
      for (const next of adjacency.get(current) || []) if (unseen.delete(next)) queue.push(next);
    }
  }
  return count;
}

export function canonicalizeApprovedFp20Topology(planGraph) {
  const issues = [];
  const nodes = Array.isArray(planGraph?.nodes) ? planGraph.nodes : [];
  const edges = Array.isArray(planGraph?.edges) ? planGraph.edges : [];
  const connectorEdges = edges.filter((edge) => edge.kind !== 'visible-source-pipe');
  const visibleEdges = edges.filter((edge) => edge.kind === 'visible-source-pipe');
  if (planGraph?.artifactType !== 'halofire.approved-fp20-source-plan-graph.v1' || !planGraph?.sourcePlanGraphReady) {
    issues.push(issue('FP20_CANONICAL_INPUT_INVALID', 'Canonical topology requires the accepted approved FP2.0 source plan graph.'));
  }
  if (nodes.length !== 210 || visibleEdges.length !== 143 || connectorEdges.length !== 70) {
    issues.push(issue('FP20_CANONICAL_INPUT_COUNT_INVALID', 'Canonical topology requires 210 source nodes, 143 visible edges, and 70 source-contact connectors.'));
  }

  const parent = new Map(nodes.map((node) => [node.id, node.id]));
  const find = (id) => {
    let root = parent.get(id);
    while (root !== parent.get(root)) root = parent.get(root);
    let current = id;
    while (parent.get(current) !== root) { const next = parent.get(current); parent.set(current, root); current = next; }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const [keep, merge] = [rootA, rootB].sort();
    parent.set(merge, keep);
  };

  for (const edge of connectorEdges) {
    if (!['source-contact-gap', 'explicit-masked-turn'].includes(edge.kind) || !parent.has(edge.fromNodeId) || !parent.has(edge.toNodeId) || !Number.isFinite(edge.lengthPdfPt) || edge.lengthPdfPt < 0 || edge.lengthPdfPt > 9) {
      issues.push(issue('FP20_CANONICAL_CONNECTOR_INVALID', 'Only source-proved contact gaps of nine PDF points or less may contract into a canonical junction.', edge.id));
      continue;
    }
    union(edge.fromNodeId, edge.toNodeId);
  }

  const groups = new Map();
  for (const node of nodes) {
    const root = find(node.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  }
  const orderedGroups = [...groups.values()].map((group) => group.sort((a, b) => a.id.localeCompare(b.id))).sort((a, b) => a[0].id.localeCompare(b[0].id));
  const canonicalNodes = [];
  const canonicalIdBySourceNode = new Map();
  for (let index = 0; index < orderedGroups.length; index += 1) {
    const group = orderedGroups[index];
    const id = `canonical-node-${String(index + 1).padStart(3, '0')}`;
    for (const node of group) canonicalIdBySourceNode.set(node.id, id);
    canonicalNodes.push({
      id,
      kind: group.length > 1 ? 'canonical-junction' : group[0].kind,
      memberNodeIds: group.map((node) => node.id),
      sourceSegmentIds: [...new Set(group.map((node) => node.sourceSegmentId))].sort(),
      sprinklerIds: [...new Set(group.flatMap((node) => node.sprinklerIds))].sort(),
      pdfPt: {
        x: round(group.reduce((sum, node) => sum + node.pdfPt.x, 0) / group.length, 3),
        y: round(group.reduce((sum, node) => sum + node.pdfPt.y, 0) / group.length, 3),
      },
      plan: {
        xFt: round(group.reduce((sum, node) => sum + node.plan.xFt, 0) / group.length),
        yFt: round(group.reduce((sum, node) => sum + node.plan.yFt, 0) / group.length),
      },
    });
  }

  const canonicalEdges = [];
  const pairKeys = new Set();
  for (const edge of visibleEdges) {
    const fromNodeId = canonicalIdBySourceNode.get(edge.fromNodeId);
    const toNodeId = canonicalIdBySourceNode.get(edge.toNodeId);
    if (fromNodeId === toNodeId) {
      issues.push(issue('FP20_CANONICAL_VISIBLE_EDGE_COLLAPSED', 'A visible source pipe cannot collapse inside a connector junction.', edge.id));
      continue;
    }
    const pairKey = [fromNodeId, toNodeId].sort().join('|');
    if (pairKeys.has(pairKey)) issues.push(issue('FP20_CANONICAL_PARALLEL_EDGE_CREATED', 'Connector contraction cannot create duplicate primary pipe edges.', edge.id));
    pairKeys.add(pairKey);
    canonicalEdges.push({ ...edge, fromNodeId, toNodeId, sourceFromNodeId: edge.fromNodeId, sourceToNodeId: edge.toNodeId });
  }

  const inputComponentCount = countComponents(nodes, edges);
  const canonicalComponentCount = countComponents(canonicalNodes, canonicalEdges);
  const inputCycleRank = edges.length - nodes.length + inputComponentCount;
  const canonicalCycleRank = canonicalEdges.length - canonicalNodes.length + canonicalComponentCount;
  const artificialConnectorCycleCount = inputCycleRank - canonicalCycleRank;
  if (canonicalNodes.length !== 142 || canonicalEdges.length !== 143 || canonicalComponentCount !== 1 || canonicalCycleRank !== 2 || artificialConnectorCycleCount !== 2) {
    issues.push(issue('FP20_CANONICAL_METRICS_MISMATCH', 'Expected contraction is 142 nodes, 143 primary edges, one component, two source loops, and two removed connector-only cycles.'));
  }

  return {
    artifactType: 'halofire.approved-fp20-canonical-topology.v1',
    projectId: planGraph?.projectId,
    issues,
    blockerCodes: [...new Set(issues.map((entry) => entry.code))],
    nodes: canonicalNodes,
    edges: canonicalEdges,
    metrics: {
      inputNodeCount: nodes.length,
      inputEdgeCount: edges.length,
      contractedConnectorEdgeCount: connectorEdges.length,
      canonicalNodeCount: canonicalNodes.length,
      canonicalEdgeCount: canonicalEdges.length,
      canonicalJunctionCount: canonicalNodes.filter((node) => node.memberNodeIds.length > 1).length,
      connectedComponentCount: canonicalComponentCount,
      connectedNodeCount: canonicalComponentCount === 1 ? canonicalNodes.length : 0,
      inputCycleRank,
      canonicalCycleRank,
      artificialConnectorCycleCount,
    },
    canonicalTopologyReady: issues.length === 0,
    sourceLoopsRequireCalculationBinding: canonicalCycleRank > 0,
    hydraulicFlowReady: false,
    remainingTopologyBlockers: [{
      code: 'FP20_SOURCE_LOOPS_REQUIRE_CALCULATION_BINDING',
      message: 'Two source-proved loops remain after connector cleanup; actual hydraulic calculation routes must bind them before directed flow is promoted.',
    }],
  };
}
