import { createHash } from 'node:crypto';

import { evaluatePipeLayoutSourceContinuity } from './pipe-layout-source-continuity.js';

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

function solveMinimumCostAssignment(matrix) {
  const rowCount = matrix.length;
  const columnCount = matrix[0]?.length ?? 0;
  if (rowCount === 0) return { columnByRow: [], totalCost: 0 };
  if (columnCount < rowCount) return null;
  const blockedCost = 1e9;
  const u = Array(rowCount + 1).fill(0);
  const v = Array(columnCount + 1).fill(0);
  const p = Array(columnCount + 1).fill(0);
  const way = Array(columnCount + 1).fill(0);
  for (let row = 1; row <= rowCount; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minValue = Array(columnCount + 1).fill(blockedCost);
    const used = Array(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = blockedCost;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const sourceCost = matrix[row0 - 1][column - 1];
        const finiteCost = Number.isFinite(sourceCost) ? sourceCost : blockedCost;
        const current = finiteCost - u[row0] - v[column];
        if (current < minValue[column]) {
          minValue[column] = current;
          way[column] = column0;
        }
        if (minValue[column] < delta) {
          delta = minValue[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else {
          minValue[column] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const columnByRow = Array(rowCount).fill(-1);
  for (let column = 1; column <= columnCount; column += 1) {
    if (p[column] > 0) columnByRow[p[column] - 1] = column - 1;
  }
  const costs = columnByRow.map((column, row) => matrix[row][column]);
  if (costs.some((value) => !Number.isFinite(value))) return null;
  return { columnByRow, totalCost: costs.reduce((sum, value) => sum + value, 0) };
}

function assignWithForcedAlternativeMargins(rows, columns, costFor) {
  const matrix = rows.map((row) => columns.map((column) => costFor(row, column)));
  const best = solveMinimumCostAssignment(matrix);
  if (!best) return null;
  const assignments = best.columnByRow.map((columnIndex, rowIndex) => {
    const alternativeMatrix = matrix.map((values) => [...values]);
    alternativeMatrix[rowIndex][columnIndex] = Number.POSITIVE_INFINITY;
    const alternative = solveMinimumCostAssignment(alternativeMatrix);
    return {
      row: rows[rowIndex],
      column: columns[columnIndex],
      cost: matrix[rowIndex][columnIndex],
      forcedAlternativeMargin: alternative
        ? alternative.totalCost - best.totalCost
        : Number.POSITIVE_INFINITY,
    };
  });
  return { assignments, totalCost: best.totalCost };
}

function reportSprinklerNodes(report) {
  const values = new Map();
  for (const segment of report.segments.filter((candidate) => candidate.downstreamKFactor !== null)) {
    const current = values.get(segment.downstreamNode);
    const value = {
      nodeId: segment.downstreamNode,
      elevationFt: segment.downstreamElevationFt,
      kFactor: segment.downstreamKFactor,
    };
    if (current && (current.elevationFt !== value.elevationFt || current.kFactor !== value.kFactor)) {
      throw new Error(`POLARIS_REPORT_SPRINKLER_NODE_CONFLICT:${value.nodeId}`);
    }
    values.set(value.nodeId, value);
  }
  return [...values.values()].sort((left, right) => Number(left.nodeId) - Number(right.nodeId));
}

function nearestPipeProjection(value, pipes) {
  return pipes.reduce((best, pipe) => {
    const projection = projectPointToPipe(value, pipe);
    return !best || projection.distanceFt < best.distanceFt ? { pipe, ...projection } : best;
  }, null);
}

function sprinklerKFactor(sprinkler) {
  const match = sprinkler.sourceAttributes?.Description?.match(/(?:^|,\s*)(\d+(?:\.\d+)?)(?=,|\s|$)/g);
  return match?.map((value) => Number(value.replace(/[^\d.]/g, ''))).find((value) => value === 5.6) ?? null;
}

export function bindCalculationSprinklerLeaves({ report, pipeCalibration }) {
  const leaves = reportSprinklerNodes(report);
  const labelByNode = new Map();
  for (const label of pipeCalibration.hydraulicNodeLabels) {
    if (labelByNode.has(label.nodeId)) throw new Error(`POLARIS_DUPLICATE_CAD_NODE_LABEL:${label.nodeId}`);
    labelByNode.set(label.nodeId, label);
  }
  const leafRows = leaves.map((leaf) => {
    const label = labelByNode.get(leaf.nodeId);
    if (!label) throw new Error(`POLARIS_CALCULATED_SPRINKLER_LABEL_MISSING:${leaf.nodeId}`);
    if (!label.connectionPointFt) throw new Error(`POLARIS_CALCULATED_SPRINKLER_CONNECTION_POINT_MISSING:${leaf.nodeId}`);
    return { ...leaf, label };
  });
  const sourceSprinklers = pipeCalibration.sprinklers
    .filter((sprinkler) => sprinklerKFactor(sprinkler) === 5.6)
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  const assignment = assignWithForcedAlternativeMargins(leafRows, sourceSprinklers, (leaf, sprinkler) => {
    if (Math.abs(sprinkler.pointFt.z - leaf.elevationFt) > 0.6) return Number.POSITIVE_INFINITY;
    return distance(sprinkler.pointFt, leaf.label.connectionPointFt);
  });
  if (!assignment) throw new Error('POLARIS_CALCULATED_SPRINKLER_ASSIGNMENT_INFEASIBLE');

  const pendentAssignments = assignment.assignments.filter(({ column }) => column.sourceAttributes['Sub Category'] === 'Pendent');
  const flexDrops = pipeCalibration.fittings
    .filter((fitting) => fitting.sourceAttributes?.['Sub Category'] === 'Flex Drop')
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  const flexAssignment = assignWithForcedAlternativeMargins(pendentAssignments, flexDrops, (binding, fitting) => {
    const hoseLengthInches = Number(fitting.sourceAttributes.Description?.match(/(\d+)\"/)?.[1] ?? 0);
    const planOffsetFt = Math.hypot(
      binding.column.pointFt.x - fitting.pointFt.x,
      binding.column.pointFt.y - fitting.pointFt.y,
    );
    return hoseLengthInches > 0 && planOffsetFt <= hoseLengthInches / 12 + 1e-7
      ? planOffsetFt
      : Number.POSITIVE_INFINITY;
  });
  if (pendentAssignments.length > 0 && !flexAssignment) throw new Error('POLARIS_FLEX_DROP_ASSIGNMENT_INFEASIBLE');
  const flexBySprinklerId = new Map((flexAssignment?.assignments ?? []).map((value) => [value.row.column.id, value]));

  const bindings = assignment.assignments.map(({ row, column, cost, forcedAlternativeMargin }) => {
    const category = column.sourceAttributes['Sub Category'];
    let terminalConnection;
    if (category === 'Upright') {
      const projection = nearestPipeProjection(column.pointFt, pipeCalibration.pipes);
      terminalConnection = {
        mode: 'upright-source-head-to-exact-pipe-span',
        pipeId: projection.pipe.id,
        pipeNominalSizeInches: projection.pipe.nominalSizeInches,
        pipeT: round(projection.t),
        sourceFittingOffsetResidualFt: round(projection.distanceFt),
        topologyReady: projection.distanceFt <= 0.35,
      };
    } else if (category === 'Pendent') {
      const flex = flexBySprinklerId.get(column.id);
      const projection = nearestPipeProjection(flex.column.pointFt, pipeCalibration.pipes);
      const atPipeEndpoint = projection.t <= 1e-7 || projection.t >= 1 - 1e-7;
      terminalConnection = {
        mode: 'pendent-source-head-via-48in-flex-drop-to-exact-pipe-endpoint',
        flexDropFittingId: flex.column.id,
        flexDropPlanOffsetFt: round(flex.cost),
        flexDropForcedAlternativeMarginFt: round(flex.forcedAlternativeMargin),
        pipeId: projection.pipe.id,
        pipeNominalSizeInches: projection.pipe.nominalSizeInches,
        pipeEndpoint: projection.t <= 0.5 ? 'start' : 'end',
        pipePortResidualFt: round(projection.distanceFt),
        topologyReady: flex.cost <= 4 && atPipeEndpoint && projection.distanceFt <= 0.07,
      };
    } else {
      terminalConnection = { mode: 'unsupported-source-sprinkler-category', topologyReady: false };
    }
    return {
      nodeId: row.nodeId,
      reportElevationFt: row.elevationFt,
      reportKFactor: row.kFactor,
      cadLabelAlignmentPointFt: row.label.alignmentPointFt,
      cadSourceNodeConnectionPointFt: row.label.connectionPointFt,
      sprinklerId: column.id,
      sprinklerCategory: category,
      sprinklerPointFt: column.pointFt,
      sourceNodeToSprinklerResidualFt: round(cost),
      annotationToSprinklerPlanDistanceFt: round(Math.hypot(
        column.pointFt.x - row.label.alignmentPointFt.x,
        column.pointFt.y - row.label.alignmentPointFt.y,
      )),
      forcedAlternativeAssignmentMarginFt: round(forcedAlternativeMargin),
      terminalConnection,
    };
  });
  const minimumAlternativeMarginFt = Math.min(...bindings.map((binding) => binding.forcedAlternativeAssignmentMarginFt));
  return {
    reportDescription: report.identity.reportDescription,
    calculatedSprinklerNodeCount: leaves.length,
    assignedSourceSprinklerCount: bindings.length,
    minimumForcedAlternativeAssignmentMarginFt: round(minimumAlternativeMarginFt),
    uniquenessMarginThresholdFt: 1.5,
    allKFactorsMatch: bindings.every((binding) => binding.reportKFactor === 5.6),
    allTerminalConnectionsReady: bindings.every((binding) => binding.terminalConnection.topologyReady),
    exactLeafBindingReady: bindings.length === leaves.length
      && minimumAlternativeMarginFt >= 1.5
      && bindings.every((binding) => binding.reportKFactor === 5.6 && binding.terminalConnection.topologyReady),
    bindings,
  };
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

const PHYSICAL_PIPE_CLASS_BY_INTERNAL_DIAMETER = new Map([
  [1.049, { nominalSizeInches: 1, subCategory: 'Schedule 40' }],
  [1.53, { nominalSizeInches: 1.25, subCategory: 'Eddy Flow' }],
  [1.728, { nominalSizeInches: 1.5, subCategory: 'Eddy Flow' }],
  [2.705, { nominalSizeInches: 2.5, subCategory: 'Eddy Flow' }],
  [3.26, { nominalSizeInches: 3, subCategory: 'Schedule 10' }],
  [3.334, { nominalSizeInches: 3, subCategory: 'Eddy Flow' }],
  [4.22, { nominalSizeInches: 4, subCategory: 'underground-source-context' }],
  [4.31, { nominalSizeInches: 4, subCategory: 'Eddy Flow' }],
]);

function physicalPipeClassForInternalDiameter(internalDiameterInches) {
  const value = PHYSICAL_PIPE_CLASS_BY_INTERNAL_DIAMETER.get(internalDiameterInches);
  if (!value) throw new Error(`POLARIS_REPORT_INTERNAL_DIAMETER_UNMAPPED:${internalDiameterInches}`);
  return value;
}

function pipeMatchesPhysicalClass(pipe, physicalClass) {
  return pipe.nominalSizeInches === physicalClass.nominalSizeInches
    && (physicalClass.subCategory === 'underground-source-context'
      || pipe.sourceAttributes?.['Sub Category'] === physicalClass.subCategory);
}

function attachmentsForPoint(graph, pipes, value, physicalClass, maximumPortResidualFt = 4.1) {
  const edgesByPipeId = new Map();
  for (const edge of graph.edges) {
    const edges = edgesByPipeId.get(edge.pipeId) ?? [];
    edges.push(edge);
    edgesByPipeId.set(edge.pipeId, edges);
  }
  const attachments = [];
  for (const pipe of pipes.filter((candidate) => pipeMatchesPhysicalClass(candidate, physicalClass))) {
    const projection = projectPointToPipe(value, pipe);
    if (projection.distanceFt > maximumPortResidualFt) continue;
    for (const edge of edgesByPipeId.get(pipe.id) ?? []) {
      if (projection.t < edge.fromT - 1e-7 || projection.t > edge.toT + 1e-7) continue;
      for (const [nodeId, nodeT] of [[edge.fromNodeId, edge.fromT], [edge.toNodeId, edge.toT]]) {
        attachments.push({
          nodeId,
          pipeId: pipe.id,
          pipeT: projection.t,
          projectedPointFt: projection.point,
          portResidualFt: projection.distanceFt,
          pipeTravelToNodeFt: pipe.length3dFt * Math.abs(projection.t - nodeT),
          accessLengthFt: projection.distanceFt + pipe.length3dFt * Math.abs(projection.t - nodeT),
          spanId: edge.id,
        });
      }
    }
  }
  return attachments.sort((left, right) => left.accessLengthFt - right.accessLengthFt);
}

function shortestPhysicalClassPath(graph, pipeById, physicalClass, startAttachments, endAttachments, forbiddenEdgeId = null) {
  const distances = new Map(graph.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map();
  const startByNode = new Map();
  for (const attachment of startAttachments) {
    if (attachment.accessLengthFt < distances.get(attachment.nodeId)) {
      distances.set(attachment.nodeId, attachment.accessLengthFt);
      startByNode.set(attachment.nodeId, attachment);
    }
  }
  const pending = new Set(graph.nodes.map((node) => node.id));
  while (pending.size) {
    let current = null;
    for (const nodeId of pending) {
      if (current === null || distances.get(nodeId) < distances.get(current)) current = nodeId;
    }
    if (!Number.isFinite(distances.get(current))) break;
    pending.delete(current);
    for (const link of graph.adjacency.get(current)) {
      if (link.edge.id === forbiddenEdgeId || !pipeMatchesPhysicalClass(pipeById.get(link.edge.pipeId), physicalClass)) continue;
      const candidate = distances.get(current) + link.edge.lengthFt;
      if (candidate < distances.get(link.nodeId)) {
        distances.set(link.nodeId, candidate);
        previous.set(link.nodeId, { nodeId: current, edge: link.edge });
        startByNode.set(link.nodeId, startByNode.get(current));
      }
    }
  }
  let best = null;
  for (const endAttachment of endAttachments) {
    const graphDistanceFt = distances.get(endAttachment.nodeId);
    if (!Number.isFinite(graphDistanceFt)) continue;
    const lengthFt = graphDistanceFt + endAttachment.accessLengthFt;
    if (!best || lengthFt < best.lengthFt) best = { lengthFt, endAttachment };
  }
  if (!best) return null;
  const steps = [];
  let current = best.endAttachment.nodeId;
  while (previous.has(current)) {
    const entry = previous.get(current);
    steps.push({ edge: entry.edge, fromNodeId: entry.nodeId, toNodeId: current });
    current = entry.nodeId;
  }
  steps.reverse();
  return {
    lengthFt: best.lengthFt,
    startAttachment: startByNode.get(best.endAttachment.nodeId) ?? startByNode.get(current),
    endAttachment: best.endAttachment,
    edges: steps.map((step) => step.edge),
    steps,
  };
}

function directSameSpanRoute(pipeById, startAttachments, endAttachments) {
  let best = null;
  for (const start of startAttachments) {
    for (const end of endAttachments) {
      if (start.spanId !== end.spanId || start.pipeId !== end.pipeId) continue;
      const pipe = pipeById.get(start.pipeId);
      const lengthFt = start.portResidualFt + end.portResidualFt
        + pipe.length3dFt * Math.abs(start.pipeT - end.pipeT);
      if (!best || lengthFt < best.lengthFt) {
        best = {
          lengthFt,
          startAttachment: start,
          endAttachment: end,
          edges: [],
          steps: [],
          directPipeId: pipe.id,
        };
      }
    }
  }
  return best;
}

function fittingSizeIncludesNominal(fitting, nominalSizeInches) {
  const values = String(fitting.sourceAttributes?.Size ?? '').match(/\d+(?:½|¼|¾|\.\d+)?/g) ?? [];
  return values.some((value) => Number(value.replace('½', '.5').replace('¼', '.25').replace('¾', '.75')) === nominalSizeInches);
}

function pointToSegmentDistance(value, start, end) {
  const vector = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const lengthSquared = vector.x ** 2 + vector.y ** 2 + vector.z ** 2;
  if (lengthSquared === 0) return distance(value, start);
  const t = Math.max(0, Math.min(1, ((value.x - start.x) * vector.x
    + (value.y - start.y) * vector.y
    + (value.z - start.z) * vector.z) / lengthSquared));
  return distance(value, {
    x: start.x + vector.x * t,
    y: start.y + vector.y * t,
    z: start.z + vector.z * t,
  });
}

function parseFeetInches(value) {
  const match = String(value ?? '').match(/(-?\d+)'-(\d+)(?:½|¼|¾)?/);
  if (!match) return null;
  const fraction = value.includes('½') ? 0.5 : value.includes('¼') ? 0.25 : value.includes('¾') ? 0.75 : 0;
  return Number(match[1]) + (Number(match[2]) + fraction) / 12;
}

function buildRiserHydraulicSemantics({ reports, physicalSpanBinding, pipeCalibration, fireLineEvidence }) {
  const reportSegments = reports.flatMap((report) => report.segments)
    .filter((segment) => segment.upstreamNode === '116' && segment.downstreamNode === '13');
  const segment = reportSegments[0];
  const route = physicalSpanBinding.routes.find((candidate) => candidate.upstreamNode === '116'
    && candidate.downstreamNode === '13');
  if (!segment || !route?.physicalPathPolylineFt?.length) return { hydraulicSemanticBindingReady: false };
  const fittingText = String(segment.upstreamFittings ?? '');
  const transitionEquivalentFt = Number(fittingText.match(/Tr\((\d+)'/)?.[1] ?? Number.NaN);
  const backflowPressureChangePsi = Number(fittingText.match(/BFP\((-?\d+(?:\.\d+)?)\)/)?.[1] ?? Number.NaN);
  const fireElbowMatch = fittingText.match(/(\d+)fE\((\d+)'-(\d+)\)/);
  const fireElbowCount = Number(fireElbowMatch?.[1] ?? Number.NaN);
  const fireElbowEquivalentEachFt = fireElbowMatch
    ? Number(fireElbowMatch[2]) + Number(fireElbowMatch[3]) / 12
    : Number.NaN;
  const reportEquivalentLengthFt = parseFeetInches(segment.equivalentLengthRaw);
  const computedEquivalentLengthFt = transitionEquivalentFt + fireElbowCount * fireElbowEquivalentEachFt;
  const sourceRiserFittings = pipeCalibration.fittings.filter((fitting) => fittingSizeIncludesNominal(fitting, 3)
    && route.physicalPathPolylineFt.slice(1).some((point, index) => pointToSegmentDistance(
      fitting.pointFt,
      route.physicalPathPolylineFt[index],
      point,
    ) <= 0.5));
  const sourceThreeInchElbowCount = sourceRiserFittings
    .filter((fitting) => fitting.sourceAttributes?.['Sub Category'] === 'Elbow').length;
  const sourcePoint = route.physicalPathPolylineFt[0];
  const targetPoint = route.physicalPathPolylineFt.at(-1);
  const reportElevationRiseFt = Math.abs(targetPoint.z - sourcePoint.z);
  const reportRawLengthToElevationRiseResidualFt = Math.abs(segment.lengthFt - reportElevationRiseFt);
  const reportOccurrencesAgree = reportSegments.every((candidate) => candidate.lengthFt === segment.lengthFt
    && candidate.equivalentLengthRaw === segment.equivalentLengthRaw
    && candidate.upstreamFittings === segment.upstreamFittings);
  const reportFittingSemanticsReady = reportEquivalentLengthFt !== null
    && Math.abs(reportEquivalentLengthFt - computedEquivalentLengthFt) <= 1 / 24
    && sourceThreeInchElbowCount === fireElbowCount
    && fireLineEvidence?.evidence?.backflowNotes?.length > 0
    && backflowPressureChangePsi === -5;
  return {
    upstreamNode: segment.upstreamNode,
    downstreamNode: segment.downstreamNode,
    reportOccurrenceCount: reportSegments.length,
    reportOccurrencesAgree,
    sourceComponentPathLengthFt: route.physicalRouteLengthFt,
    reportRawLengthFt: segment.lengthFt,
    reportElevationRiseFt: round(reportElevationRiseFt),
    reportRawLengthToElevationRiseResidualFt: round(reportRawLengthToElevationRiseResidualFt),
    sourceCenterlineToReportRawLengthResidualFt: route.reportLengthResidualFt,
    reportEquivalentLengthFt,
    transitionEquivalentLengthFt: transitionEquivalentFt,
    backflowPressureChangePsi,
    fireElbowCount,
    fireElbowEquivalentEachFt,
    computedEquivalentLengthFt,
    sourceRiserFittingIds: sourceRiserFittings.map((fitting) => fitting.id),
    sourceThreeInchElbowCount,
    sourceBackflowNoteCount: fireLineEvidence?.evidence?.backflowNotes?.length ?? 0,
    sourceComponentPathReady: (route.fittingBridgeIds?.length ?? 0) > 0,
    reportRawLengthUsesElevationRiseReady: reportRawLengthToElevationRiseResidualFt <= 0.25,
    reportFittingSemanticsReady,
    sourceCenterlineEqualsReportRawLength: route.reportLengthResidualFt <= 0.25,
    interpretation: 'The feed-riser report raw length is governed by the node elevation rise; transition and two fire-elbow losses are carried separately as equivalent length, while the BFP is a fixed pressure change. Exact source centerline length remains separately preserved.',
    hydraulicSemanticBindingReady: reportOccurrencesAgree
      && (route.fittingBridgeIds?.length ?? 0) > 0
      && reportRawLengthToElevationRiseResidualFt <= 0.25
      && reportFittingSemanticsReady,
  };
}

function fittingBridgedRiserRoute({ pipeCalibration, physicalClass, startPointFt, endPointFt, bridgeToleranceFt = 0.5 }) {
  const compatiblePipes = pipeCalibration.pipes.filter((pipe) => pipeMatchesPhysicalClass(pipe, physicalClass));
  const compatibleFittings = pipeCalibration.fittings.filter((fitting) => fittingSizeIncludesNominal(
    fitting,
    physicalClass.nominalSizeInches,
  ));
  const nodes = [
    { id: 'source', pointFt: startPointFt },
    { id: 'target', pointFt: endPointFt },
    ...compatiblePipes.flatMap((pipe) => [
      { id: `${pipe.id}:start`, pointFt: pipe.startFt, pipeId: pipe.id },
      { id: `${pipe.id}:end`, pointFt: pipe.endFt, pipeId: pipe.id },
    ]),
    ...compatibleFittings.map((fitting) => ({
      id: fitting.id,
      pointFt: fitting.pointFt,
      fittingId: fitting.id,
    })),
  ];
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  const addEdge = (from, to, lengthFt, evidence) => {
    adjacency.get(from).push({ nodeId: to, lengthFt, evidence });
    adjacency.get(to).push({ nodeId: from, lengthFt, evidence });
  };
  for (const pipe of compatiblePipes) {
    addEdge(`${pipe.id}:start`, `${pipe.id}:end`, pipe.length3dFt, { kind: 'source-pipe', pipeId: pipe.id });
  }
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (nodes[left].pipeId && nodes[left].pipeId === nodes[right].pipeId) continue;
      const residualFt = distance(nodes[left].pointFt, nodes[right].pointFt);
      if (residualFt <= bridgeToleranceFt) {
        addEdge(nodes[left].id, nodes[right].id, residualFt, { kind: 'source-fitting-port-gap', residualFt });
      }
    }
  }
  const distances = new Map(nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map();
  distances.set('source', 0);
  const pending = new Set(nodes.map((node) => node.id));
  while (pending.size) {
    let current = null;
    for (const nodeId of pending) {
      if (current === null || distances.get(nodeId) < distances.get(current)) current = nodeId;
    }
    if (!Number.isFinite(distances.get(current))) break;
    pending.delete(current);
    if (current === 'target') break;
    for (const edge of adjacency.get(current)) {
      const candidate = distances.get(current) + edge.lengthFt;
      if (candidate < distances.get(edge.nodeId)) {
        distances.set(edge.nodeId, candidate);
        previous.set(edge.nodeId, { nodeId: current, evidence: edge.evidence });
      }
    }
  }
  if (!Number.isFinite(distances.get('target'))) return null;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = ['target'];
  const evidence = [];
  let current = 'target';
  while (current !== 'source') {
    const entry = previous.get(current);
    if (!entry) return null;
    evidence.push(entry.evidence);
    current = entry.nodeId;
    nodeIds.push(current);
  }
  nodeIds.reverse();
  evidence.reverse();
  return {
    fittingBridgeRoute: true,
    lengthFt: distances.get('target'),
    points: nodeIds.map((nodeId) => nodeById.get(nodeId).pointFt)
      .filter((value, index, values) => index === 0 || distance(value, values[index - 1]) > 1e-7),
    pipeIds: [...new Set(evidence.map((edge) => edge.pipeId).filter(Boolean))],
    fittingIds: [...new Set(nodeIds.map((nodeId) => nodeById.get(nodeId).fittingId).filter(Boolean))],
    maximumFittingPortGapFt: Math.max(0, ...evidence
      .filter((edge) => edge.kind === 'source-fitting-port-gap')
      .map((edge) => edge.residualFt)),
  };
}

export function bindHydraulicReportSegmentsToPhysicalSpans({
  pipeCalibration,
  reports,
  calculatedSprinklerLeafBindings = [],
  graph = null,
}) {
  const physicalGraph = graph ?? buildPhysicalPipeGraph(pipeCalibration.pipes);
  const pipeById = new Map(pipeCalibration.pipes.map((pipe) => [pipe.id, pipe]));
  const fittingById = new Map(pipeCalibration.fittings.map((fitting) => [fitting.id, fitting]));
  const sourcePointByNodeId = new Map(pipeCalibration.hydraulicNodeLabels
    .map((label) => [label.nodeId, label.connectionPointFt]));
  const sprinklerBindingByNodeId = new Map(calculatedSprinklerLeafBindings
    .flatMap((bindingSet) => bindingSet.bindings)
    .map((binding) => [binding.nodeId, binding]));
  const segmentOccurrences = new Map();
  for (const segment of reports.flatMap((report) => report.segments)) {
    const key = [segment.upstreamNode, segment.downstreamNode, segment.diameterInternalInches, segment.lengthFt].join('|');
    const value = segmentOccurrences.get(key) ?? { segment, occurrenceCount: 0 };
    value.occurrenceCount += 1;
    segmentOccurrences.set(key, value);
  }
  const routes = [...segmentOccurrences.values()].map(({ segment, occurrenceCount }) => {
    const physicalClass = physicalPipeClassForInternalDiameter(segment.diameterInternalInches);
    const startPointFt = sourcePointByNodeId.get(segment.upstreamNode);
    const endPointFt = sourcePointByNodeId.get(segment.downstreamNode);
    if (!startPointFt || !endPointFt) {
      return {
        upstreamNode: segment.upstreamNode,
        downstreamNode: segment.downstreamNode,
        hydraulicFlowDirection: segment.hydraulicFlowDirection,
        reportLengthFt: segment.lengthFt,
        pipeRole: segment.pipeRole,
        diameterInternalInches: segment.diameterInternalInches,
        physicalClass,
        occurrenceCount,
        bindingStatus: 'off-building-source-node-not-present-in-sprinkler-plan-cad',
        exactPhysicalSpanRouteReady: false,
      };
    }
    const sprinklerBinding = sprinklerBindingByNodeId.get(segment.downstreamNode);
    const flexTerminal = segment.pipeRole === 'arm-over'
      && sprinklerBinding?.sprinklerCategory === 'Pendent'
      && sprinklerBinding.terminalConnection?.topologyReady
      ? sprinklerBinding
      : null;
    const flexTerminalPipe = flexTerminal
      ? pipeById.get(flexTerminal.terminalConnection.pipeId)
      : null;
    const routeEndPointFt = flexTerminalPipe
      ? flexTerminalPipe[`${flexTerminal.terminalConnection.pipeEndpoint}Ft`]
      : endPointFt;
    if (flexTerminal && !routeEndPointFt) {
      throw new Error(`POLARIS_FLEX_TERMINAL_PIPE_ENDPOINT_MISSING:${segment.downstreamNode}`);
    }
    const startAttachments = attachmentsForPoint(physicalGraph, pipeCalibration.pipes, startPointFt, physicalClass);
    const endAttachments = attachmentsForPoint(physicalGraph, pipeCalibration.pipes, routeEndPointFt, physicalClass);
    const graphRoute = shortestPhysicalClassPath(physicalGraph, pipeById, physicalClass, startAttachments, endAttachments);
    const directRoute = directSameSpanRoute(pipeById, startAttachments, endAttachments);
    const fittingBridgeRoute = segment.pipeRole === 'feed-riser'
      ? fittingBridgedRiserRoute({ pipeCalibration, physicalClass, startPointFt, endPointFt: routeEndPointFt })
      : null;
    const candidates = [graphRoute, directRoute, fittingBridgeRoute].filter(Boolean)
      .sort((left, right) => Math.abs(left.lengthFt - segment.lengthFt) - Math.abs(right.lengthFt - segment.lengthFt));
    const route = candidates[0];
    if (!route) {
      return {
        upstreamNode: segment.upstreamNode,
        downstreamNode: segment.downstreamNode,
        hydraulicFlowDirection: segment.hydraulicFlowDirection,
        reportLengthFt: segment.lengthFt,
        pipeRole: segment.pipeRole,
        diameterInternalInches: segment.diameterInternalInches,
        physicalClass,
        occurrenceCount,
        bindingStatus: 'no-compatible-source-pipe-path',
        exactPhysicalSpanRouteReady: false,
      };
    }
    const pipeIds = route.fittingBridgeRoute ? route.pipeIds : [...new Set([
      route.startAttachment.pipeId,
      ...route.edges.map((edge) => edge.pipeId),
      route.endAttachment.pipeId,
      route.directPipeId,
    ].filter(Boolean))];
    const reportLengthResidualFt = Math.abs(route.lengthFt - segment.lengthFt);
    const physicalNodeById = new Map(physicalGraph.nodes.map((node) => [node.id, node]));
    const physicalPathPolylineFt = route.fittingBridgeRoute ? route.points : [
      startPointFt,
      route.startAttachment.projectedPointFt,
      ...route.steps.map((step) => physicalNodeById.get(step.toNodeId).pointFt),
      route.endAttachment.projectedPointFt,
      routeEndPointFt,
    ].filter((value, index, values) => index === 0 || distance(value, values[index - 1]) > 1e-7);
    const flexDropFitting = flexTerminal
      ? fittingById.get(flexTerminal.terminalConnection.flexDropFittingId)
      : null;
    const flexibleTerminalComponent = flexTerminal ? {
      mode: 'source-flex-drop-component-with-exact-rigid-port-and-sprinkler-endpoints',
      fittingId: flexTerminal.terminalConnection.flexDropFittingId,
      description: flexDropFitting?.sourceAttributes?.Description ?? null,
      fittingPointFt: flexDropFitting?.pointFt ?? null,
      rigidPipeId: flexTerminal.terminalConnection.pipeId,
      rigidPipeEndpoint: flexTerminal.terminalConnection.pipeEndpoint,
      rigidPipePortFt: routeEndPointFt,
      rigidPipePortResidualFt: flexTerminal.terminalConnection.pipePortResidualFt,
      sprinklerId: flexTerminal.sprinklerId,
      sprinklerPointFt: flexTerminal.sprinklerPointFt,
      centerlineStatus: 'not-exported-by-source-use-semantic-flex-component-with-exact-endpoints',
      endpointBindingReady: Boolean(flexDropFitting)
        && flexTerminal.terminalConnection.pipePortResidualFt <= 0.07
        && flexTerminal.sourceNodeToSprinklerResidualFt === 0,
    } : null;
    const exactPhysicalSpanRouteReady = reportLengthResidualFt <= 0.25
      && (!flexibleTerminalComponent || flexibleTerminalComponent.endpointBindingReady);
    return {
      upstreamNode: segment.upstreamNode,
      downstreamNode: segment.downstreamNode,
      hydraulicFlowDirection: segment.hydraulicFlowDirection,
      reportLengthFt: segment.lengthFt,
      pipeRole: segment.pipeRole,
      diameterInternalInches: segment.diameterInternalInches,
      physicalRouteLengthFt: round(route.lengthFt),
      reportLengthResidualFt: round(reportLengthResidualFt),
      physicalClass,
      occurrenceCount,
      startPortResidualFt: round(route.startAttachment?.portResidualFt ?? 0),
      endPortResidualFt: round(route.endAttachment?.portResidualFt ?? 0),
      pipeIds,
      physicalSpanIds: (route.edges ?? []).map((edge) => edge.id),
      fittingBridgeIds: route.fittingIds ?? [],
      maximumFittingPortGapFt: route.fittingBridgeRoute ? round(route.maximumFittingPortGapFt) : null,
      physicalPathPolylineFt,
      flexibleTerminalComponent,
      bindingStatus: exactPhysicalSpanRouteReady
        ? route.fittingBridgeRoute
          ? 'exact-source-riser-through-attributed-fitting-bridges-within-quarter-foot'
          : flexibleTerminalComponent
          ? 'exact-source-rigid-arm-over-to-semantic-flex-terminal-within-quarter-foot'
          : 'exact-source-pipe-span-route-within-quarter-foot'
        : 'held-report-length-residual-exceeds-quarter-foot',
      exactPhysicalSpanRouteReady,
    };
  });
  const roleCounts = Object.fromEntries([...routes.reduce((counts, route) => {
    const value = counts.get(route.pipeRole) ?? { total: 0, exactPhysicalSpanRouteReady: 0 };
    value.total += 1;
    if (route.exactPhysicalSpanRouteReady) value.exactPhysicalSpanRouteReady += 1;
    counts.set(route.pipeRole, value);
    return counts;
  }, new Map())].sort(([left], [right]) => left.localeCompare(right)));
  return {
    uniqueReportSegmentCount: routes.length,
    onPlanSegmentCount: routes.filter((route) => !route.bindingStatus.startsWith('off-building')).length,
    exactPhysicalSpanRouteCount: routes.filter((route) => route.exactPhysicalSpanRouteReady).length,
    maximumReadyRouteLengthResidualFt: Math.max(0, ...routes.filter((route) => route.exactPhysicalSpanRouteReady)
      .map((route) => route.reportLengthResidualFt)),
    roleCounts,
    routes,
  };
}

const countBy = (items, getter) => Object.fromEntries([...items.reduce((counts, item) => {
  const key = getter(item);
  counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}, new Map())].sort(([left], [right]) => String(left).localeCompare(String(right))));

export function buildPolarisPitchedHydraulicNetwork({
  pipeCalibration,
  atticReport,
  belowCeilingReport,
  fireLineEvidence,
  fireLineRegistration,
  sourceContinuityEvidence,
}) {
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
  const calculatedSprinklerLeafBindings = reports.map((report) => bindCalculationSprinklerLeaves({
    report,
    pipeCalibration,
  }));
  const physicalSpanBinding = bindHydraulicReportSegmentsToPhysicalSpans({
    pipeCalibration,
    reports,
    calculatedSprinklerLeafBindings,
    graph,
  });
  const loopInteriorRoles = ['branch-line', 'cross-main', 'feed-main'];
  const loopInteriorPipeSpanDirectionReady = loopInteriorRoles.every((role) => {
    const counts = physicalSpanBinding.roleCounts[role];
    return counts && counts.total > 0 && counts.exactPhysicalSpanRouteReady === counts.total;
  });
  const directedBuildingRoles = [...loopInteriorRoles, 'arm-over'];
  const buildingRigidPipeSpanHydraulicDirectionReady = directedBuildingRoles.every((role) => {
    const counts = physicalSpanBinding.roleCounts[role];
    return counts && counts.total > 0 && counts.exactPhysicalSpanRouteReady === counts.total;
  });
  const exactArmOverFlexTerminalBindings = physicalSpanBinding.routes.filter((route) => route.pipeRole === 'arm-over'
    && route.exactPhysicalSpanRouteReady
    && route.flexibleTerminalComponent?.endpointBindingReady);
  const riserFittingBridgeRoute = physicalSpanBinding.routes.find((route) => route.upstreamNode === '116'
    && route.downstreamNode === '13');
  const riserHydraulicSemantics = buildRiserHydraulicSemantics({
    reports,
    physicalSpanBinding,
    pipeCalibration,
    fireLineEvidence,
  });
  const sourceContinuity = evaluatePipeLayoutSourceContinuity(sourceContinuityEvidence);
  const reportNodeIds = [...new Set(reports.flatMap((report) => report.nodes.map((node) => node.nodeId)))].sort((a, b) => Number(a) - Number(b));
  const labelNodeIds = [...new Set(pipeCalibration.hydraulicNodeLabels.map((label) => label.nodeId))].sort((a, b) => Number(a) - Number(b));
  const missingCadLabels = reportNodeIds.filter((nodeId) => !labelNodeIds.includes(nodeId));
  const reportNodeById = new Map();
  for (const node of reports.flatMap((report) => report.nodes)) {
    const current = reportNodeById.get(node.nodeId);
    if (current && current.elevationFt !== node.elevationFt) throw new Error(`POLARIS_REPORT_NODE_ELEVATION_CONFLICT:${node.nodeId}`);
    reportNodeById.set(node.nodeId, node);
  }
  const exactCadNodeConnectionPoints = pipeCalibration.hydraulicNodeLabels.map((label) => {
    const reportNode = reportNodeById.get(label.nodeId);
    if (!reportNode || !label.connectionPointFt) throw new Error(`POLARIS_CAD_NODE_CONNECTION_POINT_MISSING:${label.nodeId}`);
    return {
      nodeId: label.nodeId,
      connectionPointFt: label.connectionPointFt,
      reportElevationFt: reportNode.elevationFt,
      elevationResidualInches: round(Math.abs(label.connectionPointFt.z - reportNode.elevationFt) * 12, 6),
      sourceGlyphLineHandles: label.sourceGlyphLineHandles,
      sourceGlyphTopologyDegreeSignature: label.sourceGlyphTopologyDegreeSignature,
    };
  });
  const maximumCadNodeElevationResidualInches = Math.max(...exactCadNodeConnectionPoints
    .map((binding) => binding.elevationResidualInches));
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
    schema: 'halofire.polaris-pitched-hydraulic-network.v4',
    projectId: pipeCalibration.projectId,
    sourceBoundary: {
      pipeCalibrationReceiptSha256: pipeCalibration.receiptSha256,
      atticHydraulicReportSha256: atticReport.source.sha256,
      belowCeilingHydraulicReportSha256: belowCeilingReport.source.sha256,
      fireLineCad: fireLineEvidence,
      fireLineRegistration,
      sourceContinuity,
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
      exactCadNodeConnectionPointCount: exactCadNodeConnectionPoints.length,
      maximumCadNodeElevationResidualInches,
      sourceGlyphTopologyReady: exactCadNodeConnectionPoints.every((binding) => binding.sourceGlyphLineHandles.length === 7
        && JSON.stringify(binding.sourceGlyphTopologyDegreeSignature) === JSON.stringify([1, 2, 2, 2, 2, 2, 3])),
      exactCadNodeConnectionPoints,
      connectionPointBindingStatus: maximumCadNodeElevationResidualInches <= 0.25
        && exactCadNodeConnectionPoints.length === 59
        ? 'exact-source-glyph-leader-tips-ready-for-all-on-plan-nodes'
        : 'held-source-glyph-or-elevation-residual-invalid',
      geometryBindingStatus: sourceContinuity.sameProjectSemanticSourceContinuityReady
        ? 'exact-node-points-building-routes-and-semantic-source-chain-ready-exact-fire-line-endpoint-and-drainage-held'
        : fireLineRegistration?.claims?.sprinklerCadToFireLineCoordinateRegistrationReady
          ? 'exact-node-points-building-routes-and-cross-drawing-coordinate-frame-ready-hydraulic-source-pipe-and-drainage-held'
        : 'exact-node-points-and-building-rigid-routes-ready-riser-source-and-drainage-held',
      calculatedSprinklerLeafBindings,
      exactCalculatedSprinklerLeafCount: calculatedSprinklerLeafBindings
        .reduce((sum, binding) => sum + binding.assignedSourceSprinklerCount, 0),
      calculatedSprinklerLeafBindingStatus: calculatedSprinklerLeafBindings.every((binding) => binding.exactLeafBindingReady)
        ? 'exact-source-sprinkler-and-terminal-pipe-binding-ready'
        : 'held-nonunique-or-terminal-topology-unresolved',
    },
    physicalSpanRegistration: {
      ...physicalSpanBinding,
      loopInteriorRoles,
      loopInteriorPipeSpanDirectionReady,
      directedBuildingRoles,
      buildingRigidPipeSpanHydraulicDirectionReady,
      exactArmOverFlexTerminalBindingCount: exactArmOverFlexTerminalBindings.length,
      riserFittingBridge: {
        upstreamNode: riserFittingBridgeRoute?.upstreamNode ?? null,
        downstreamNode: riserFittingBridgeRoute?.downstreamNode ?? null,
        sourceComponentPathPresent: (riserFittingBridgeRoute?.fittingBridgeIds?.length ?? 0) > 0,
        fittingBridgeIds: riserFittingBridgeRoute?.fittingBridgeIds ?? [],
        physicalRouteLengthFt: riserFittingBridgeRoute?.physicalRouteLengthFt ?? null,
        reportLengthFt: riserFittingBridgeRoute?.reportLengthFt ?? null,
        reportLengthResidualFt: riserFittingBridgeRoute?.reportLengthResidualFt ?? null,
        reportLengthAgreementReady: riserFittingBridgeRoute?.exactPhysicalSpanRouteReady ?? false,
      },
      riserHydraulicSemantics,
      interpretation: 'Report upstream-to-downstream direction is promoted onto a physical span route only when source pipe material/nominal size, exact 3D node tips, connectivity, and report length agree within 0.25 ft. Flexible terminals use the source fitting identity and exact rigid-port/sprinkler endpoints; an unexported hose centerline is never fabricated.',
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
      sprinklerCadToFireLineCoordinateRegistrationReady:
        fireLineRegistration?.claims?.sprinklerCadToFireLineCoordinateRegistrationReady === true,
      hydraulicNodeToFireLinePipeBindingReady:
        fireLineRegistration?.claims?.hydraulicNodeToFireLinePipeBindingReady === true,
      hydraulicSourceSemanticContinuityReady:
        sourceContinuity.sameProjectSemanticSourceContinuityReady === true,
      exactPhysicalPipeGraphReady: rootComponent.pipeIds.length === 177,
      sourceRootedTopologicalDirectionReady: rootCycleRank === 0 && ambiguousRootEdges.length === 0,
      fullFittingIdentityReady: semanticFittings.length === pipeCalibration.fittings.length,
      inspectorTestDrainDeviceReady: Boolean(testDrain),
      supplyTeePipeBridgeReady: supplyTeeBridge.connectedPipeEndpoints.length === 3,
      inspectorTestDrainPipeBridgeReady: testDrainBridge.connectedPipeEndpoints.length === 2,
      mainDrainCalloutReady: mainDrainNote.leaderSegmentCount === 2,
      roofRelativePipeGradeGeometryReady: geometricGrades.length === 14,
      calculatedSprinklerLeafToDwgPipeBindingReady: calculatedSprinklerLeafBindings
        .every((binding) => binding.exactLeafBindingReady),
      exactHydraulicNodeConnectionPointsReady: exactCadNodeConnectionPoints.length === 59
        && maximumCadNodeElevationResidualInches <= 0.25,
      calculationNodeToDwgConnectionPointBindingReady: missingCadLabels.every((nodeId) => ['1', '2'].includes(nodeId))
        && exactCadNodeConnectionPoints.length === 59
        && maximumCadNodeElevationResidualInches <= 0.25,
      loopInteriorPipeSpanDirectionReady,
      exactArmOverRigidToFlexTerminalDirectionReady: exactArmOverFlexTerminalBindings.length === 15,
      semanticFlexTerminalEndpointBindingReady: exactArmOverFlexTerminalBindings.length === 15,
      flexibleHoseCenterlineReady: false,
      riserFittingBridgeComponentPathReady: Boolean(riserFittingBridgeRoute?.fittingBridgeIds?.length),
      riserReportToSourceLengthAgreementReady: riserFittingBridgeRoute?.exactPhysicalSpanRouteReady === true,
      riserHydraulicSemanticBindingReady: riserHydraulicSemantics.hydraulicSemanticBindingReady === true,
      buildingRigidPipeSpanHydraulicDirectionReady,
      calculationNodeToDwgGeometryBindingReady: false,
      wholeNetworkHydraulicFlowDirectionReady: sourceContinuity.sameProjectSemanticSourceContinuityReady === true
        && reports.every((report) => report.claims.hydraulicDirectionReady === true
          && report.claims.sourceNodeClosureReady === true)
        && buildingRigidPipeSpanHydraulicDirectionReady
        && riserHydraulicSemantics.hydraulicSemanticBindingReady === true,
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
