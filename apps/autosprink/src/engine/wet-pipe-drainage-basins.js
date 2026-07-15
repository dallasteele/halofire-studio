const GALLONS_PER_CUBIC_FOOT = 7.48051948;

const round = (value, precision = 9) => Number(value.toFixed(precision));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pipeClassKey = (value) => `${value.nominalSizeInches}|${value.subCategory}`;

function buildInternalDiameterMap(routes) {
  const values = new Map();
  for (const route of routes) {
    if (!route.physicalClass || !Number.isFinite(route.diameterInternalInches)) continue;
    const key = pipeClassKey(route.physicalClass);
    const current = values.get(key);
    if (current !== undefined && Math.abs(current - route.diameterInternalInches) > 1e-9) {
      throw new Error(`WET_DRAINAGE_INTERNAL_DIAMETER_CONFLICT:${key}`);
    }
    values.set(key, route.diameterInternalInches);
  }
  return values;
}

function minimaxSpillElevations(graph, mainDrainEntryNodeIds) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const costs = new Map(graph.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const pending = [];
  for (const nodeId of mainDrainEntryNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`WET_DRAINAGE_MAIN_DRAIN_NODE_MISSING:${nodeId}`);
    costs.set(nodeId, node.pointFt.z);
    pending.push(nodeId);
  }
  while (pending.length) {
    pending.sort((left, right) => costs.get(left) - costs.get(right));
    const nodeId = pending.shift();
    const currentCost = costs.get(nodeId);
    for (const link of graph.adjacency.get(nodeId) ?? []) {
      const candidate = Math.max(currentCost, nodeById.get(link.nodeId).pointFt.z);
      if (candidate + 1e-12 < costs.get(link.nodeId)) {
        costs.set(link.nodeId, candidate);
        if (!pending.includes(link.nodeId)) pending.push(link.nodeId);
      }
    }
  }
  return costs;
}

function collectTrappedPieces({ graph, lowNodeId, spillElevationFt, pipeById, internalDiameterByClass }) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visitedNodes = new Set([lowNodeId]);
  const visitedEdges = new Set();
  const pending = [lowNodeId];
  const pieces = [];
  while (pending.length) {
    const nodeId = pending.shift();
    const node = nodeById.get(nodeId);
    for (const link of graph.adjacency.get(nodeId) ?? []) {
      const edge = link.edge;
      if (visitedEdges.has(edge.id)) continue;
      const other = nodeById.get(link.nodeId);
      const lowZ = node.pointFt.z;
      const highZ = other.pointFt.z;
      if (lowZ >= spillElevationFt - 1e-9 && highZ >= spillElevationFt - 1e-9) continue;
      visitedEdges.add(edge.id);
      const pipe = pipeById.get(edge.pipeId);
      const key = pipeClassKey({
        nominalSizeInches: pipe.nominalSizeInches,
        subCategory: pipe.sourceAttributes['Sub Category'],
      });
      const diameterInternalInches = internalDiameterByClass.get(key);
      if (!Number.isFinite(diameterInternalInches)) {
        throw new Error(`WET_DRAINAGE_INTERNAL_DIAMETER_MISSING:${key}:${edge.pipeId}`);
      }
      let includedFraction = 1;
      if (highZ >= spillElevationFt - 1e-9 && Math.abs(highZ - lowZ) > 1e-12) {
        includedFraction = Math.max(0, Math.min(1, (spillElevationFt - lowZ) / (highZ - lowZ)));
      }
      const lengthFt = edge.lengthFt * includedFraction;
      const endPointFt = includedFraction === 1 ? other.pointFt : {
        x: node.pointFt.x + (other.pointFt.x - node.pointFt.x) * includedFraction,
        y: node.pointFt.y + (other.pointFt.y - node.pointFt.y) * includedFraction,
        z: node.pointFt.z + (other.pointFt.z - node.pointFt.z) * includedFraction,
      };
      const gallons = Math.PI / 4 * (diameterInternalInches / 12) ** 2 * lengthFt * GALLONS_PER_CUBIC_FOOT;
      pieces.push({
        edgeId: edge.id,
        pipeId: edge.pipeId,
        startPointFt: node.pointFt,
        endPointFt: {
          x: round(endPointFt.x),
          y: round(endPointFt.y),
          z: round(endPointFt.z),
        },
        lengthFt: round(lengthFt),
        diameterInternalInches,
        gallons: round(gallons),
      });
      if (other.pointFt.z < spillElevationFt - 1e-9 && !visitedNodes.has(other.id)) {
        visitedNodes.add(other.id);
        pending.push(other.id);
      }
    }
  }
  return pieces.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
}

function classifyTermination({ lowPointFt, sprinklers, fittings, toleranceFt }) {
  const nearbySprinklers = sprinklers
    .map((sprinkler) => ({
      id: sprinkler.id,
      category: sprinkler.sourceAttributes?.['Sub Category'] ?? null,
      residualFt: round(distance(lowPointFt, sprinkler.pointFt)),
    }))
    .filter((value) => value.residualFt <= toleranceFt)
    .sort((left, right) => left.residualFt - right.residualFt);
  const nearbyFittings = fittings
    .map((fitting) => ({
      id: fitting.id,
      category: fitting.sourceAttributes?.['Sub Category'] ?? null,
      residualFt: round(distance(lowPointFt, fitting.pointFt)),
    }))
    .filter((value) => value.residualFt <= toleranceFt)
    .sort((left, right) => left.residualFt - right.residualFt);
  const nearestSprinkler = nearbySprinklers[0] ?? null;
  const drainFitting = nearbyFittings.find((fitting) => /drain/i.test(fitting.category ?? '')) ?? null;
  return {
    type: drainFitting ? 'source-drain-device'
      : nearestSprinkler ? `${nearestSprinkler.category?.toLowerCase() ?? 'unknown'}-sprinkler`
        : nearbyFittings[0] ? 'source-fitting' : 'open-pipe-geometry',
    nearbySprinklers,
    nearbyFittings,
    sourceDrainDeviceReady: Boolean(drainFitting),
    singlePendentRemovalReady: nearestSprinkler?.category === 'Pendent',
  };
}

function wetSystemArrangement({ gallons, termination, codeBasis }) {
  if (gallons < 5) {
    const existingMethodReady = termination.sourceDrainDeviceReady
      || termination.singlePendentRemovalReady
      || termination.nearbyFittings.some((fitting) => codeBasis.flexibleOrEasilySeparatedFittingCategories.includes(fitting.category));
    return {
      tier: 'less-than-5-gallons',
      section: codeBasis.lessThan5Gallons.section,
      minimumArrangement: 'one-half-inch nipple-and-cap-or-plug, or a source-proven allowed alternative',
      codeBasisReady: codeBasis.lessThan5Gallons.primarySourceReady === true,
      existingMethodReady,
      correctionCandidate: existingMethodReady ? null : 'add-one-half-inch-nipple-and-cap-or-plug-at-low-point',
    };
  }
  return {
    tier: gallons < 50 ? '5-to-less-than-50-gallons' : '50-gallons-or-more',
    section: null,
    minimumArrangement: null,
    codeBasisReady: false,
    existingMethodReady: termination.sourceDrainDeviceReady,
    correctionCandidate: 'held-bind-project-edition-primary-source-before-sizing-auxiliary-drain',
  };
}

export function evaluateWetPipeDrainageBasins({
  pipes,
  graph,
  physicalSpanRoutes,
  lowPointCandidates,
  mainDrainEntryNodeIds,
  sprinklers = [],
  fittings = [],
  codeBasis,
  endpointToleranceFt = 0.04,
  terminationToleranceFt = 0.25,
}) {
  if (codeBasis?.systemType !== 'wet') throw new Error('WET_DRAINAGE_SYSTEM_TYPE_NOT_BOUND');
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const pipeById = new Map(pipes.map((pipe) => [pipe.id, pipe]));
  const internalDiameterByClass = buildInternalDiameterMap(physicalSpanRoutes);
  const spillElevations = minimaxSpillElevations(graph, mainDrainEntryNodeIds);
  const candidates = lowPointCandidates.map((candidate) => {
    const nearest = graph.nodes.reduce((best, node) => {
      const residualFt = distance(candidate.pointFt, node.pointFt);
      return !best || residualFt < best.residualFt ? { node, residualFt } : best;
    }, null);
    if (nearest.residualFt > endpointToleranceFt) {
      throw new Error(`WET_DRAINAGE_LOW_POINT_NODE_MISSING:${candidate.id}:${round(nearest.residualFt)}`);
    }
    const spillElevationFt = spillElevations.get(nearest.node.id);
    if (!Number.isFinite(spillElevationFt)) throw new Error(`WET_DRAINAGE_MAIN_DRAIN_UNREACHABLE:${candidate.id}`);
    const pieces = collectTrappedPieces({
      graph,
      lowNodeId: nearest.node.id,
      spillElevationFt,
      pipeById,
      internalDiameterByClass,
    });
    return {
      ...candidate,
      lowNodeId: nearest.node.id,
      nodeResidualFt: round(nearest.residualFt),
      spillElevationFt: round(spillElevationFt),
      pieces,
    };
  });
  const grouped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.spillElevationFt}|${candidate.pieces.map((piece) => `${piece.edgeId}:${piece.lengthFt}`).join('|')}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(candidate);
  }
  const basins = [...grouped.values()].map((members, index) => {
    const pieces = members[0].pieces;
    const gallons = round(pieces.reduce((sum, piece) => sum + piece.gallons, 0), 6);
    const trappedLengthFt = round(pieces.reduce((sum, piece) => sum + piece.lengthFt, 0), 6);
    const lowest = members.reduce((best, member) => nodeById.get(member.lowNodeId).pointFt.z < nodeById.get(best.lowNodeId).pointFt.z
      ? member : best);
    const lowPointFt = nodeById.get(lowest.lowNodeId).pointFt;
    const termination = classifyTermination({
      lowPointFt,
      sprinklers,
      fittings,
      toleranceFt: terminationToleranceFt,
    });
    const arrangement = wetSystemArrangement({ gallons, termination, codeBasis });
    return {
      id: `wet-basin-${String(index + 1).padStart(2, '0')}`,
      lowPointCandidateIds: members.map((member) => member.id).sort(),
      lowNodeIds: [...new Set(members.map((member) => member.lowNodeId))].sort(),
      lowPointFt,
      spillElevationFt: members[0].spillElevationFt,
      trappedLengthFt,
      trappedVolumeGallons: gallons,
      pieces,
      termination,
      arrangement,
      sourceDispositionReady: arrangement.existingMethodReady && arrangement.codeBasisReady,
    };
  }).sort((left, right) => left.lowPointCandidateIds[0].localeCompare(right.lowPointCandidateIds[0]));
  return {
    schema: 'halofire.wet-pipe-drainage-basins.v1',
    systemType: codeBasis.systemType,
    lowPointCandidateCount: lowPointCandidates.length,
    uniqueBasinCount: basins.length,
    totalTrappedVolumeGallons: round(basins.reduce((sum, basin) => sum + basin.trappedVolumeGallons, 0), 6),
    basins,
    exactBasinGeometryReady: basins.length > 0 && basins.every((basin) => basin.pieces.length > 0),
    codeBasisBoundBasinCount: basins.filter((basin) => basin.arrangement.codeBasisReady).length,
    sourceDispositionReadyBasinCount: basins.filter((basin) => basin.sourceDispositionReady).length,
    correctionPlanReady: basins.length > 0 && basins.every((basin) => basin.arrangement.codeBasisReady),
    drainageGradeSemanticsReady: basins.length > 0 && basins.every((basin) => basin.sourceDispositionReady),
  };
}
