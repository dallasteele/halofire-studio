import { createHash } from 'node:crypto';

const round = (value, precision = 9) => Number(value.toFixed(precision));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pointAt = (pipe, t) => ({
  x: pipe.startFt.x + (pipe.endFt.x - pipe.startFt.x) * t,
  y: pipe.startFt.y + (pipe.endFt.y - pipe.startFt.y) * t,
  z: pipe.startFt.z + (pipe.endFt.z - pipe.startFt.z) * t,
});

function projectPointToPipe(value, pipe) {
  const vector = {
    x: pipe.endFt.x - pipe.startFt.x,
    y: pipe.endFt.y - pipe.startFt.y,
    z: pipe.endFt.z - pipe.startFt.z,
  };
  const lengthSquared = vector.x ** 2 + vector.y ** 2 + vector.z ** 2;
  if (lengthSquared === 0) return { t: 0, point: pipe.startFt, distanceFt: distance(value, pipe.startFt) };
  const rawT = ((value.x - pipe.startFt.x) * vector.x
    + (value.y - pipe.startFt.y) * vector.y
    + (value.z - pipe.startFt.z) * vector.z) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = pointAt(pipe, t);
  return { t, point: projected, distanceFt: distance(value, projected) };
}

function unionFind(size) {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  return { find, union };
}

export function buildPhysicalPipeGraph(pipes, toleranceFt = 0.04) {
  const splits = pipes.map((pipe) => [
    { pipeId: pipe.id, t: 0, point: pipe.startFt },
    { pipeId: pipe.id, t: 1, point: pipe.endFt },
  ]);
  const endpoints = pipes.flatMap((pipe) => [pipe.startFt, pipe.endFt]);
  for (let pipeIndex = 0; pipeIndex < pipes.length; pipeIndex += 1) {
    const pipe = pipes[pipeIndex];
    for (const endpoint of endpoints) {
      const projection = projectPointToPipe(endpoint, pipe);
      if (projection.distanceFt <= toleranceFt) {
        splits[pipeIndex].push({ pipeId: pipe.id, t: projection.t, point: projection.point });
      }
    }
  }

  const splitRecords = [];
  for (const pipeSplits of splits) {
    pipeSplits.sort((a, b) => a.t - b.t);
    for (const split of pipeSplits) {
      if (!splitRecords.some((candidate) => candidate.pipeId === split.pipeId
        && Math.abs(candidate.t - split.t) <= 1e-7)) splitRecords.push(split);
    }
  }
  const sets = unionFind(splitRecords.length);
  for (let left = 0; left < splitRecords.length; left += 1) {
    for (let right = left + 1; right < splitRecords.length; right += 1) {
      if (splitRecords[left].pipeId !== splitRecords[right].pipeId
        && distance(splitRecords[left].point, splitRecords[right].point) <= toleranceFt) sets.union(left, right);
    }
  }
  const nodeByRoot = new Map();
  const nodeIdBySplit = new Map();
  for (let index = 0; index < splitRecords.length; index += 1) {
    const root = sets.find(index);
    if (!nodeByRoot.has(root)) nodeByRoot.set(root, []);
    nodeByRoot.get(root).push(splitRecords[index].point);
  }
  const nodes = [...nodeByRoot.entries()].map(([root, points], index) => {
    const value = {
      id: `physical-node-${index + 1}`,
      pointFt: {
        x: round(points.reduce((sum, point) => sum + point.x, 0) / points.length),
        y: round(points.reduce((sum, point) => sum + point.y, 0) / points.length),
        z: round(points.reduce((sum, point) => sum + point.z, 0) / points.length),
      },
    };
    nodeIdBySplit.set(root, value.id);
    return value;
  });
  const splitIndexByPipe = new Map();
  splitRecords.forEach((split, index) => {
    if (!splitIndexByPipe.has(split.pipeId)) splitIndexByPipe.set(split.pipeId, []);
    splitIndexByPipe.get(split.pipeId).push({ ...split, nodeId: nodeIdBySplit.get(sets.find(index)) });
  });
  const edges = [];
  for (const pipe of pipes) {
    const pipeSplits = splitIndexByPipe.get(pipe.id).sort((a, b) => a.t - b.t);
    for (let index = 0; index < pipeSplits.length - 1; index += 1) {
      const from = pipeSplits[index];
      const to = pipeSplits[index + 1];
      if (from.nodeId === to.nodeId || to.t - from.t <= 1e-7) continue;
      edges.push({
        id: `${pipe.id}:span-${index + 1}`,
        pipeId: pipe.id,
        fromNodeId: from.nodeId,
        toNodeId: to.nodeId,
        fromT: round(from.t),
        toT: round(to.t),
        lengthFt: round(pipe.length3dFt * (to.t - from.t)),
      });
    }
  }
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId).push({ nodeId: edge.toNodeId, edge });
    adjacency.get(edge.toNodeId).push({ nodeId: edge.fromNodeId, edge });
  }
  const components = [];
  const visited = new Set();
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const queue = [node.id];
    const nodeIds = [];
    const edgeIds = new Set();
    const pipeIds = new Set();
    visited.add(node.id);
    while (queue.length) {
      const nodeId = queue.shift();
      nodeIds.push(nodeId);
      for (const link of adjacency.get(nodeId)) {
        edgeIds.add(link.edge.id);
        pipeIds.add(link.edge.pipeId);
        if (!visited.has(link.nodeId)) {
          visited.add(link.nodeId);
          queue.push(link.nodeId);
        }
      }
    }
    components.push({ nodeIds, edgeIds: [...edgeIds], pipeIds: [...pipeIds] });
  }
  components.sort((a, b) => b.pipeIds.length - a.pipeIds.length);
  return { toleranceFt, nodes, edges, adjacency, components };
}

function rootGraph(graph, rootPointFt, allowedNodeIds = null) {
  const allowed = allowedNodeIds ? new Set(allowedNodeIds) : null;
  const rootNode = graph.nodes.filter((node) => !allowed || allowed.has(node.id)).reduce((best, node) => {
    const distanceFt = distance(rootPointFt, node.pointFt);
    return !best || distanceFt < best.distanceFt ? { node, distanceFt } : best;
  }, null);
  const distances = new Map(graph.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  distances.set(rootNode.node.id, 0);
  const pending = new Set(graph.nodes.map((node) => node.id));
  while (pending.size) {
    let current = null;
    for (const nodeId of pending) {
      if (current === null || distances.get(nodeId) < distances.get(current)) current = nodeId;
    }
    if (!Number.isFinite(distances.get(current))) break;
    pending.delete(current);
    for (const link of graph.adjacency.get(current)) {
      const candidate = distances.get(current) + link.edge.lengthFt;
      if (candidate < distances.get(link.nodeId)) distances.set(link.nodeId, candidate);
    }
  }
  const directedEdges = graph.edges.map((edge) => {
    const fromDistanceFt = distances.get(edge.fromNodeId);
    const toDistanceFt = distances.get(edge.toNodeId);
    if (!Number.isFinite(fromDistanceFt) || !Number.isFinite(toDistanceFt)) {
      return { ...edge, sourceRootDirection: 'outside-root-component' };
    }
    if (Math.abs(fromDistanceFt - toDistanceFt) <= 1e-7) {
      return { ...edge, sourceRootDirection: 'ambiguous-equal-root-distance' };
    }
    return {
      ...edge,
      sourceRootDirection: fromDistanceFt < toDistanceFt ? 'from-to' : 'to-from',
      supplyFromNodeId: fromDistanceFt < toDistanceFt ? edge.fromNodeId : edge.toNodeId,
      supplyToNodeId: fromDistanceFt < toDistanceFt ? edge.toNodeId : edge.fromNodeId,
    };
  });
  return { rootNodeId: rootNode.node.id, rootResidualFt: round(rootNode.distanceFt), distances, directedEdges };
}

const countBy = (items, getter) => Object.fromEntries([...items.reduce((counts, item) => {
  const key = getter(item);
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}, new Map())].sort(([left], [right]) => String(left).localeCompare(String(right))));

export function buildPolarisPitchedHydraulicNetwork({ pipeCalibration, atticReport, belowCeilingReport, fireLineEvidence }) {
  const graph = buildPhysicalPipeGraph(pipeCalibration.pipes);
  const semanticFittings = pipeCalibration.fittings.filter((fitting) => fitting.sourceAttributes?.['Sub Category']);
  const testDrain = semanticFittings.find((fitting) => fitting.sourceAttributes['Sub Category'] === 'Inspectors Test & Drain');
  if (!testDrain) throw new Error('POLARIS_INSPECTORS_TEST_DRAIN_MISSING');
  const mainDrainNote = pipeCalibration.sourceNotes.find((note) => note.text === 'MAIN DRAIN');
  if (!mainDrainNote?.leaderTipFt || mainDrainNote.leaderSegmentCount !== 2) {
    throw new Error('POLARIS_MAIN_DRAIN_LEADER_MISSING');
  }
  const tees = semanticFittings.filter((fitting) => fitting.sourceAttributes['Sub Category'] === 'Tee');
  const supplyTee = tees.reduce((best, fitting) => {
    const target = { x: 174.208333333, y: 39.666666667, z: 11 };
    const distanceFt = distance(fitting.pointFt, target);
    return !best || distanceFt < best.distanceFt ? { fitting, distanceFt } : best;
  }, null)?.fitting;
  if (!supplyTee) throw new Error('POLARIS_SUPPLY_TEE_MISSING');
  const rootComponent = graph.components[0];
  const rooted = rootGraph(graph, supplyTee.pointFt, rootComponent.nodeIds);
  const rootEdges = rooted.directedEdges.filter((edge) => rootComponent.edgeIds.includes(edge.id));
  const ambiguousRootEdges = rootEdges.filter((edge) => edge.sourceRootDirection.startsWith('ambiguous'));
  const rootCycleRank = rootComponent.edgeIds.length - rootComponent.nodeIds.length + 1;
  const reports = [atticReport, belowCeilingReport];
  const reportNodeIds = [...new Set(reports.flatMap((report) => report.nodes.map((node) => node.nodeId)))].sort((a, b) => Number(a) - Number(b));
  const labelNodeIds = [...new Set(pipeCalibration.hydraulicNodeLabels.map((label) => label.nodeId))].sort((a, b) => Number(a) - Number(b));
  const missingCadLabels = reportNodeIds.filter((nodeId) => !labelNodeIds.includes(nodeId));
  const geometricGrades = pipeCalibration.pipes
    .filter((pipe) => pipe.geometryKind === 'sloped-plan-run')
    .map((pipe) => ({
      pipeId: pipe.id,
      gradeInPer10Ft: pipe.gradeInPer10Ft,
      geometricDownhillDirection: pipe.downhillDirection,
      drainageIntentStatus: 'held-no-explicit-drainage-intent-or-continuous-drain-path-proof',
    }));
  const pipeEndpoints = pipeCalibration.pipes.flatMap((pipe) => [
    { pipeId: pipe.id, endpoint: 'start', pointFt: pipe.startFt },
    { pipeId: pipe.id, endpoint: 'end', pointFt: pipe.endFt },
  ]);
  const fittingBridgeAudit = semanticFittings
    .map((fitting) => ({
      fittingId: fitting.id,
      subCategory: fitting.sourceAttributes['Sub Category'],
      description: fitting.sourceAttributes.Description,
      connectedPipeEndpoints: pipeEndpoints
        .map((endpoint) => ({ ...endpoint, residualFt: round(distance(endpoint.pointFt, fitting.pointFt)) }))
        .filter((endpoint) => endpoint.residualFt <= 0.5)
        .sort((left, right) => left.residualFt - right.residualFt),
    }))
    .filter((fitting) => fitting.connectedPipeEndpoints.length > 0);
  const supplyTeeBridge = fittingBridgeAudit.find((fitting) => fitting.fittingId === supplyTee.id);
  const testDrainBridge = fittingBridgeAudit.find((fitting) => fitting.fittingId === testDrain.id);
  const physicalNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nearestPhysicalNode = (value) => graph.nodes.reduce((best, node) => {
    const distanceFt = distance(value, node.pointFt);
    return !best || distanceFt < best.distanceFt ? { node, distanceFt } : best;
  }, null);
  const rootComponentPipeIds = new Set(rootComponent.pipeIds);
  const mainDrainEntryNodeIds = [...new Set(supplyTeeBridge.connectedPipeEndpoints
    .filter((endpoint) => rootComponentPipeIds.has(endpoint.pipeId))
    .map((endpoint) => nearestPhysicalNode(endpoint.pointFt).node.id))];
  for (const grade of geometricGrades) {
    const pipe = pipeCalibration.pipes.find((candidate) => candidate.id === grade.pipeId);
    const downhillPoint = pipe.downhillDirection === 'start-to-end' ? pipe.endFt : pipe.startFt;
    const downhillNode = nearestPhysicalNode(downhillPoint).node;
    const pending = [downhillNode.id];
    const visited = new Set(pending);
    let reachesMainDrainEntry = false;
    while (pending.length && !reachesMainDrainEntry) {
      const nodeId = pending.shift();
      if (mainDrainEntryNodeIds.includes(nodeId)) {
        reachesMainDrainEntry = true;
        break;
      }
      const currentZ = physicalNodeById.get(nodeId).pointFt.z;
      for (const link of graph.adjacency.get(nodeId)) {
        const nextZ = physicalNodeById.get(link.nodeId).pointFt.z;
        if (nextZ <= currentZ + 0.01 && !visited.has(link.nodeId)) {
          visited.add(link.nodeId);
          pending.push(link.nodeId);
        }
      }
    }
    grade.downhillEndpointFt = downhillPoint;
    grade.continuousNonRisingPathToMainDrainEntry = reachesMainDrainEntry;
    grade.drainageIntentStatus = reachesMainDrainEntry
      ? 'geometrically-drainable-to-source-main-drain-entry-intent-not-inferred'
      : 'geometric-low-point-does-not-reach-source-main-drain-entry-without-rise';
  }
  const geometricallyDrainableCount = geometricGrades.filter((grade) => grade.continuousNonRisingPathToMainDrainEntry).length;
  const packet = {
    schema: 'halofire.polaris-pitched-hydraulic-network.v1',
    projectId: pipeCalibration.projectId,
    sourceBoundary: {
      pipeCalibrationReceiptSha256: pipeCalibration.receiptSha256,
      atticHydraulicReportSha256: atticReport.source.sha256,
      belowCeilingHydraulicReportSha256: belowCeilingReport.source.sha256,
      fireLineCad: fireLineEvidence,
      directionRule: 'Hydraulic flow uses report upstream-to-downstream columns. Source-root topology and geometric downhill are separately named and never substituted for report flow or drainage intent.',
    },
    hydraulicReports: reports.map((report) => ({
      description: report.identity.reportDescription,
      sourceSha256: report.source.sha256,
      routeCount: report.summary.routeCount,
      segmentCount: report.summary.segmentCount,
      nodeCount: report.summary.nodeCount,
      sourceNode: report.summary.sourceNode,
      sourceClosureReady: report.summary.sourceClosureReady,
      pipeRoleCounts: report.summary.pipeRoleCounts,
      segments: report.segments,
    })),
    nodeRegistration: {
      reportNodeCount: reportNodeIds.length,
      cadLabelCount: labelNodeIds.length,
      exactCadLabelCoverageCount: reportNodeIds.length - missingCadLabels.length,
      missingCadLabels,
      missingCadLabelMeaning: missingCadLabels.every((nodeId) => ['1', '2'].includes(nodeId))
        ? 'Only the off-building source and underground calculation nodes are absent from the sprinkler-plan CAD labels.'
        : 'Unexpected calculation nodes are absent from the sprinkler-plan CAD labels.',
      geometryBindingStatus: 'held-annotation-offsets-require-topology-length-elevation-binding',
    },
    physicalNetwork: {
      toleranceFt: graph.toleranceFt,
      pipeCount: pipeCalibration.pipes.length,
      componentCount: graph.components.length,
      componentPipeCounts: graph.components.map((component) => component.pipeIds.length),
      rootFittingId: supplyTee.id,
      rootFittingDescription: supplyTee.sourceAttributes.Description,
      rootNodeId: rooted.rootNodeId,
      rootResidualFt: rooted.rootResidualFt,
      rootComponentPipeCount: rootComponent.pipeIds.length,
      rootComponentNodeCount: rootComponent.nodeIds.length,
      rootComponentEdgeCount: rootComponent.edgeIds.length,
      rootComponentCycleRank: rootCycleRank,
      sourceRootDirectedEdgeCount: rootEdges.length - ambiguousRootEdges.length,
      ambiguousSourceRootEdgeCount: ambiguousRootEdges.length,
      sourceRootDirectionStatus: rootCycleRank > 0
        ? 'root-distance-orientation-only-cycles-require-calculation-node-binding'
        : ambiguousRootEdges.length === 0
          ? 'all-root-component-spans-directed-away-from-riser-tee'
          : 'held-ambiguous-root-distance-spans',
    },
    fittingSemantics: {
      attributedFittingCount: semanticFittings.length,
      subCategoryCounts: countBy(semanticFittings, (fitting) => fitting.sourceAttributes['Sub Category']),
      inspectorTestDrain: {
        fittingId: testDrain.id,
        pointFt: testDrain.pointFt,
        manufacturer: testDrain.sourceAttributes.Manufacturer,
        description: testDrain.sourceAttributes.Description,
        size: testDrain.sourceAttributes.Size,
        elevation: testDrain.sourceAttributes.Elevation,
      },
      mainDrainCallout: mainDrainNote,
      sourceEndpointBridgeAudit: fittingBridgeAudit,
      supplyTeeConnectedPipeIds: [...new Set(supplyTeeBridge.connectedPipeEndpoints.map((endpoint) => endpoint.pipeId))],
      inspectorTestDrainConnectedPipeIds: [...new Set(testDrainBridge.connectedPipeEndpoints.map((endpoint) => endpoint.pipeId))],
    },
    gradeAndDrainage: {
      slopedPlanRunCount: geometricGrades.length,
      geometricGrades,
      explicitDrainDeviceCount: semanticFittings.filter((fitting) => /drain/i.test(fitting.sourceAttributes['Sub Category'])).length,
      explicitMainDrainCalloutCount: pipeCalibration.sourceNotes.filter((note) => note.text === 'MAIN DRAIN').length,
      mainDrainEntryNodeIds,
      geometricallyDrainableSlopedRunCount: geometricallyDrainableCount,
      slopedRunLowPointAwayFromMainDrainCount: geometricGrades.length - geometricallyDrainableCount,
      drainageAcceptanceRule: 'A lower endpoint is geometric evidence only. Drainage requires an explicit drain destination and a continuous non-rising path with no trapped low point.',
      drainageIntentStatus: 'held',
    },
    claims: {
      exactHydraulicReportGraphReady: reports.every((report) => report.claims.hydraulicDirectionReady === true
        && report.claims.sourceNodeClosureReady === true),
      reportSourceClosureReady: reports.every((report) => report.summary.sourceClosureReady === true),
      reportHydraulicFlowDirectionReady: reports.every((report) => report.directionSemantics.hydraulicFlowDirection === 'upstream-to-downstream'),
      sourceFireLineContextReady: fireLineEvidence?.claims?.sourceFireLineContextReady === true,
      exactPhysicalPipeGraphReady: rootComponent.pipeIds.length === 177,
      sourceRootedTopologicalDirectionReady: rootCycleRank === 0 && ambiguousRootEdges.length === 0,
      fullFittingIdentityReady: semanticFittings.length === pipeCalibration.fittings.length,
      inspectorTestDrainDeviceReady: Boolean(testDrain),
      supplyTeePipeBridgeReady: supplyTeeBridge.connectedPipeEndpoints.length === 3,
      inspectorTestDrainPipeBridgeReady: testDrainBridge.connectedPipeEndpoints.length === 2,
      mainDrainCalloutReady: mainDrainNote.leaderSegmentCount === 2,
      roofRelativePipeGradeGeometryReady: geometricGrades.length === 14,
      calculationNodeToDwgGeometryBindingReady: false,
      wholeNetworkHydraulicFlowDirectionReady: false,
      drainageGradeSemanticsReady: false,
      continuousDrainPathReady: false,
      drainDestinationReady: mainDrainNote.leaderSegmentCount === 2,
      newHopeTransferReady: false,
      properPipeLayoutReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
    },
  };
  packet.receiptSha256 = createHash('sha256').update(JSON.stringify(packet)).digest('hex').toUpperCase();
  return packet;
}
