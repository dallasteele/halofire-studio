/**
 * Reconstruct source-embedded pipe/fitting adjacency from exact 3D CAD points.
 *
 * This is deliberately narrower than a manufacturer port/takeout model. It
 * proves that source fitting centers and pipe endpoints form an unambiguous
 * component chain when every fitting has the expected number of distinct rays,
 * fitting-to-fitting links are mutual, and each pipe endpoint has one owner.
 * Flexible drops are inventoried but never promoted to a rigid centerline.
 */

const DEFAULT_MAX_GAP_FT = 0.5;
const DEFAULT_RAY_ANGLE_DEG = 8;
const POINT_EPSILON_FT = 1e-6;

const EXPECTED_SYSTEM_PORTS = Object.freeze({
  Check: 2,
  Elbow: 2,
  Flange: 2,
  'Flexible Coupling': 2,
  'Inspectors Test & Drain': 2,
  'Reducer/Adapter': 2,
  'Rigid Coupling': 2,
  'Switch/Sensor': 2,
  Tee: 3,
  'Two-Way Inlet': 1,
});

const STRAIGHT_THROUGH_CATEGORIES = new Set([
  'Check',
  'Flange',
  'Flexible Coupling',
  'Reducer/Adapter',
  'Rigid Coupling',
]);

const round = (value, digits = 9) => Number(value.toFixed(digits));

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function finitePoint(point) {
  return point && ['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis]));
}

function direction(from, to, residualFt) {
  return {
    x: (to.x - from.x) / residualFt,
    y: (to.y - from.y) / residualFt,
    z: (to.z - from.z) / residualFt,
  };
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function angleDegrees(left, right) {
  return Math.acos(Math.max(-1, Math.min(1, dot(left, right)))) * 180 / Math.PI;
}

function combinations(values, count, start = 0, prefix = []) {
  if (count === 0) return [prefix];
  const result = [];
  for (let index = start; index <= values.length - count; index += 1) {
    result.push(...combinations(values, count - 1, index + 1, [...prefix, values[index]]));
  }
  return result;
}

function angleNear(value, target, tolerance) {
  return Math.abs(value - target) <= tolerance;
}

function exactSourcePortsMatch(sourcePortDirections, candidates, rayCosine) {
  if (sourcePortDirections.length !== candidates.length) return false;
  const assign = (portIndex, used) => {
    if (portIndex === sourcePortDirections.length) return true;
    return candidates.some((candidate, candidateIndex) => !used.has(candidateIndex)
      && dot(sourcePortDirections[portIndex], candidate.direction) >= rayCosine
      && assign(portIndex + 1, new Set([...used, candidateIndex])));
  };
  return assign(0, new Set());
}

function fittingPortTopologyReady(fitting, candidates, rayAngleDeg, rayCosine) {
  const subCategory = fittingCategory(fitting);
  const sourcePortDirections = Array.isArray(fitting.sourcePortDirections)
    ? fitting.sourcePortDirections.filter(finitePoint)
    : [];
  if (sourcePortDirections.length === candidates.length) {
    return exactSourcePortsMatch(sourcePortDirections, candidates, rayCosine);
  }
  const pairAngles = combinations(candidates, 2)
    .map(([left, right]) => angleDegrees(left.direction, right.direction));
  if (STRAIGHT_THROUGH_CATEGORIES.has(subCategory)) {
    return pairAngles.length === 1 && angleNear(pairAngles[0], 180, rayAngleDeg);
  }
  if (subCategory === 'Tee') {
    return pairAngles.filter((value) => angleNear(value, 180, rayAngleDeg)).length === 1
      && pairAngles.filter((value) => angleNear(value, 90, rayAngleDeg)).length === 2;
  }
  if (subCategory === 'Elbow') {
    const nominalAngle = fitting.sourceAttributes?.Description?.includes('45°') ? 45 : 90;
    return pairAngles.length === 1
      && (angleNear(pairAngles[0], nominalAngle, rayAngleDeg)
        || (nominalAngle === 45 && angleNear(pairAngles[0], 135, rayAngleDeg)));
  }
  return true;
}

function closestPointOnSegment(pointValue, start, end) {
  const vector = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const lengthSquared = dot(vector, vector);
  if (lengthSquared <= POINT_EPSILON_FT ** 2) return null;
  const offset = { x: pointValue.x - start.x, y: pointValue.y - start.y, z: pointValue.z - start.z };
  const fraction = dot(offset, vector) / lengthSquared;
  const projected = {
    x: start.x + fraction * vector.x,
    y: start.y + fraction * vector.y,
    z: start.z + fraction * vector.z,
  };
  return {
    fraction,
    residualFt: distance(pointValue, projected),
    stationFt: Math.sqrt(lengthSquared) * fraction,
  };
}

function serializeConnection(candidate) {
  return {
    kind: candidate.kind,
    ...(candidate.kind === 'pipe-endpoint'
      ? { pipeId: candidate.pipeId, endpoint: candidate.endpoint }
      : { fittingId: candidate.fittingId }),
    residualFt: candidate.residualFt,
    direction: Object.fromEntries(Object.entries(candidate.direction)
      .map(([axis, value]) => [axis, round(value, 6)])),
  };
}

function issue(code, message, entityId = null) {
  return { severity: 'blocking', code, message, entityId };
}

function fittingCategory(fitting) {
  return fitting?.sourceAttributes?.['Sub Category'] ?? null;
}

function candidateKey(candidate) {
  return candidate.kind === 'pipe-endpoint'
    ? `${candidate.pipeId}:${candidate.endpoint}`
    : candidate.fittingId;
}

function uniqueIds(values, code, label) {
  const seen = new Set();
  for (const value of values) {
    if (typeof value?.id !== 'string' || value.id.length === 0) {
      throw new Error(`${code}_ID_INVALID`);
    }
    if (seen.has(value.id)) throw new Error(`${code}_ID_DUPLICATE:${value.id}`);
    seen.add(value.id);
  }
  if (seen.size !== values.length) throw new Error(`${code}_${label}_COUNT_INVALID`);
}

/**
 * @param {object} input
 * @param {object[]} input.pipes Exact source pipe segments with startFt/endFt.
 * @param {object[]} input.fittings Exact source fitting centers and attributes.
 * @param {number} [input.maxGapFt=0.5] Largest source centerline gap considered.
 * @param {number} [input.rayAngleDeg=8] Same-ray angular tolerance.
 */
export function buildSourceFittingJunctionGraph({
  pipes = [],
  fittings = [],
  maxGapFt = DEFAULT_MAX_GAP_FT,
  rayAngleDeg = DEFAULT_RAY_ANGLE_DEG,
} = {}) {
  if (!Array.isArray(pipes) || !Array.isArray(fittings)) {
    throw new Error('SOURCE_FITTING_JUNCTION_INPUT_INVALID');
  }
  if (!Number.isFinite(maxGapFt) || maxGapFt <= 0 || maxGapFt > 0.5) {
    throw new Error('SOURCE_FITTING_JUNCTION_GAP_INVALID');
  }
  if (!Number.isFinite(rayAngleDeg) || rayAngleDeg <= 0 || rayAngleDeg > 15) {
    throw new Error('SOURCE_FITTING_JUNCTION_ANGLE_INVALID');
  }
  uniqueIds(pipes, 'SOURCE_FITTING_JUNCTION_PIPE', 'PIPE');
  uniqueIds(fittings, 'SOURCE_FITTING_JUNCTION_FITTING', 'FITTING');

  for (const pipe of pipes) {
    if (!finitePoint(pipe.startFt) || !finitePoint(pipe.endFt)) {
      throw new Error(`SOURCE_FITTING_JUNCTION_PIPE_POINT_INVALID:${pipe.id}`);
    }
  }
  for (const fitting of fittings) {
    if (!finitePoint(fitting.pointFt)) {
      throw new Error(`SOURCE_FITTING_JUNCTION_FITTING_POINT_INVALID:${fitting.id}`);
    }
  }

  const pipeEndpoints = pipes.flatMap((pipe) => [
    { kind: 'pipe-endpoint', pipeId: pipe.id, endpoint: 'start', pointFt: pipe.startFt },
    { kind: 'pipe-endpoint', pipeId: pipe.id, endpoint: 'end', pointFt: pipe.endFt },
  ]);
  const fittingCenters = fittings.map((fitting) => ({
    kind: 'fitting-center',
    fittingId: fitting.id,
    pointFt: fitting.pointFt,
  }));
  const rayCosine = Math.cos((rayAngleDeg * Math.PI) / 180);

  let junctions = fittings.map((fitting) => {
    const subCategory = fittingCategory(fitting);
    if (subCategory === 'Flex Drop') {
      return {
        fittingId: fitting.id,
        subCategory,
        pointFt: fitting.pointFt,
        expectedSystemPortCount: 2,
        selectedConnections: [],
        status: 'held-flexible-centerline-not-exported',
        sourceCenterlineAdjacencyReady: false,
      };
    }
    if (subCategory === 'Switch/Sensor') {
      const spanAttachments = pipes.map((pipe) => {
        const projection = closestPointOnSegment(fitting.pointFt, pipe.startFt, pipe.endFt);
        return projection ? { pipe, ...projection } : null;
      }).filter((entry) => entry
        && entry.residualFt <= POINT_EPSILON_FT
        && entry.fraction > POINT_EPSILON_FT
        && entry.fraction < 1 - POINT_EPSILON_FT);
      const ready = spanAttachments.length === 1;
      return {
        fittingId: fitting.id,
        subCategory,
        pointFt: fitting.pointFt,
        expectedSystemPortCount: 0,
        topologyRole: 'inline-device-attachment',
        selectedConnections: ready ? [{
          kind: 'pipe-span',
          pipeId: spanAttachments[0].pipe.id,
          stationFt: round(spanAttachments[0].stationFt),
          spanFraction: round(spanAttachments[0].fraction),
          residualFt: round(spanAttachments[0].residualFt),
        }] : [],
        status: ready
          ? 'source-inline-device-attachment-resolved'
          : spanAttachments.length === 0
            ? 'held-inline-device-pipe-span-missing'
            : 'held-inline-device-pipe-span-ambiguous',
        sourceCenterlineAdjacencyReady: ready,
      };
    }
    const expectedSystemPortCount = EXPECTED_SYSTEM_PORTS[subCategory] ?? null;
    if (expectedSystemPortCount === null) {
      return {
        fittingId: fitting.id,
        subCategory,
        pointFt: fitting.pointFt,
        expectedSystemPortCount,
        selectedConnections: [],
        status: 'held-unsupported-fitting-category',
        sourceCenterlineAdjacencyReady: false,
      };
    }

    const rawCandidates = [...pipeEndpoints, ...fittingCenters]
      .filter((candidate) => candidate.fittingId !== fitting.id)
      .map((candidate) => {
        const residualFt = distance(fitting.pointFt, candidate.pointFt);
        return {
          ...candidate,
          residualFt: round(residualFt),
          direction: residualFt > POINT_EPSILON_FT
            ? direction(fitting.pointFt, candidate.pointFt, residualFt)
            : null,
        };
      })
      .filter((candidate) => candidate.residualFt <= maxGapFt)
      .sort((left, right) => left.residualFt - right.residualFt
        || candidateKey(left).localeCompare(candidateKey(right)));
    const coincidentCandidates = rawCandidates.filter((candidate) => candidate.direction === null);
    if (coincidentCandidates.length > 0) {
      return {
        fittingId: fitting.id,
        subCategory,
        pointFt: fitting.pointFt,
        expectedSystemPortCount,
        candidateCount: rawCandidates.length,
        rawCandidateCount: rawCandidates.length,
        coincidentCandidateIds: coincidentCandidates.map(candidateKey),
        selectedConnections: [],
        status: 'held-coincident-source-entities',
        sourceCenterlineAdjacencyReady: false,
      };
    }

    const rays = [];
    for (const candidate of rawCandidates) {
      const ray = rays.find((entry) => dot(entry.direction, candidate.direction) >= rayCosine);
      if (ray) {
        ray.candidates.push(candidate);
      } else {
        rays.push({ direction: candidate.direction, candidates: [candidate] });
      }
    }
    const nearestByRay = rays.map((ray) => ray.candidates[0]);
    const validCandidateSets = combinations(nearestByRay, expectedSystemPortCount)
      .filter((candidates) => fittingPortTopologyReady(fitting, candidates, rayAngleDeg, rayCosine));
    const ready = validCandidateSets.length === 1;
    const sourcePortDirections = Array.isArray(fitting.sourcePortDirections)
      ? fitting.sourcePortDirections.filter(finitePoint)
      : [];
    const matchedSourcePortConnections = [];
    const usedCandidateKeys = new Set();
    sourcePortDirections.forEach((portDirection, sourcePortIndex) => {
      const matches = nearestByRay.filter((candidate) => !usedCandidateKeys.has(candidateKey(candidate))
        && dot(portDirection, candidate.direction) >= rayCosine);
      if (matches.length !== 1) return;
      usedCandidateKeys.add(candidateKey(matches[0]));
      matchedSourcePortConnections.push({
        ...serializeConnection(matches[0]),
        sourcePortIndex,
        sourcePortDirection: portDirection,
      });
    });
    const selectedConnections = ready
      ? validCandidateSets[0].map(serializeConnection).sort((left, right) => {
        const leftId = left.kind === 'pipe-endpoint' ? `${left.pipeId}:${left.endpoint}` : left.fittingId;
        const rightId = right.kind === 'pipe-endpoint' ? `${right.pipeId}:${right.endpoint}` : right.fittingId;
        return leftId.localeCompare(rightId);
      })
      : [];
    return {
      fittingId: fitting.id,
      subCategory,
      pointFt: fitting.pointFt,
      expectedSystemPortCount,
      candidateCount: nearestByRay.length,
      rawCandidateCount: rawCandidates.length,
      distinctRayCount: nearestByRay.length,
      validPortTopologyCount: validCandidateSets.length,
      sourcePortDirections,
      matchedSourcePortConnections,
      selectedConnections,
      status: ready
        ? 'source-centerline-rays-resolved'
        : sourcePortDirections.length === expectedSystemPortCount
          && matchedSourcePortConnections.length > 0
          ? 'held-unconnected-exact-source-port'
          : nearestByRay.length < expectedSystemPortCount
          ? 'held-insufficient-source-rays'
          : validCandidateSets.length > 1
            ? 'held-ambiguous-fitting-port-topology'
            : 'held-invalid-fitting-port-topology',
      sourceCenterlineAdjacencyReady: ready,
    };
  });

  const preliminaryAdjacency = new Map();
  const addPreliminaryEdge = (left, right) => {
    if (!preliminaryAdjacency.has(left)) preliminaryAdjacency.set(left, new Set());
    if (!preliminaryAdjacency.has(right)) preliminaryAdjacency.set(right, new Set());
    preliminaryAdjacency.get(left).add(right);
    preliminaryAdjacency.get(right).add(left);
  };
  for (const junction of junctions) {
    const connections = junction.sourceCenterlineAdjacencyReady
      ? junction.selectedConnections
      : junction.matchedSourcePortConnections ?? [];
    for (const connection of connections) {
      if (connection.kind === 'fitting-center') {
        addPreliminaryEdge(`fitting:${junction.fittingId}`, `fitting:${connection.fittingId}`);
      } else if (connection.kind === 'pipe-endpoint' || connection.kind === 'pipe-span') {
        addPreliminaryEdge(`fitting:${junction.fittingId}`, `pipe:${connection.pipeId}`);
      }
    }
  }
  const testDrainNodes = new Set(junctions
    .filter((junction) => junction.subCategory === 'Inspectors Test & Drain')
    .map((junction) => `fitting:${junction.fittingId}`));
  const reachesTestDrain = (fittingId) => {
    const pending = [`fitting:${fittingId}`];
    const visited = new Set(pending);
    while (pending.length > 0) {
      const current = pending.shift();
      if (testDrainNodes.has(current)) return true;
      for (const adjacent of preliminaryAdjacency.get(current) ?? []) {
        if (visited.has(adjacent)) continue;
        visited.add(adjacent);
        pending.push(adjacent);
      }
    }
    return false;
  };
  junctions = junctions.map((junction) => {
    const matchedPortIndices = new Set((junction.matchedSourcePortConnections ?? [])
      .map((connection) => connection.sourcePortIndex));
    const unmatchedSourcePorts = (junction.sourcePortDirections ?? [])
      .map((directionValue, sourcePortIndex) => ({ direction: directionValue, sourcePortIndex }))
      .filter((port) => !matchedPortIndices.has(port.sourcePortIndex));
    const inspectorDischargeTerminalReady = junction.subCategory === 'Elbow'
      && junction.status === 'held-unconnected-exact-source-port'
      && junction.matchedSourcePortConnections?.length === 1
      && unmatchedSourcePorts.length === 1
      && reachesTestDrain(junction.fittingId);
    if (!inspectorDischargeTerminalReady) return junction;
    return {
      ...junction,
      topologyRole: 'inspectors-test-drain-open-discharge-terminal',
      selectedConnections: [
        ...junction.matchedSourcePortConnections,
        {
          kind: 'open-terminal',
          semantic: 'inspectors-test-drain-discharge',
          sourcePortIndex: unmatchedSourcePorts[0].sourcePortIndex,
          direction: unmatchedSourcePorts[0].direction,
        },
      ],
      status: 'source-oriented-open-terminal-resolved',
      sourceCenterlineAdjacencyReady: true,
    };
  });

  const junctionById = new Map(junctions.map((junction) => [junction.fittingId, junction]));
  const issues = [];
  const fittingLinks = new Map();
  const pipeEndpointOwners = new Map();
  const pipeSpanAttachments = [];
  const openTerminals = [];
  for (const junction of junctions.filter((entry) => entry.sourceCenterlineAdjacencyReady)) {
    for (const connection of junction.selectedConnections) {
      if (connection.kind === 'fitting-center') {
        const other = junctionById.get(connection.fittingId);
        const reciprocal = other?.sourceCenterlineAdjacencyReady
          && other.selectedConnections.some((candidate) => candidate.kind === 'fitting-center'
            && candidate.fittingId === junction.fittingId);
        if (!reciprocal) {
          issues.push(issue(
            'SOURCE_FITTING_JUNCTION_NONRECIPROCAL_LINK',
            'A fitting-to-fitting source adjacency must be selected from both fitting centers.',
            `${junction.fittingId}|${connection.fittingId}`,
          ));
          continue;
        }
        const edgeId = [junction.fittingId, connection.fittingId].sort().join('|');
        if (!fittingLinks.has(edgeId)) fittingLinks.set(edgeId, {
          edgeId,
          fittingIds: [junction.fittingId, connection.fittingId].sort(),
          sourceCenterDistanceFt: connection.residualFt,
        });
      } else if (connection.kind === 'pipe-endpoint') {
        const endpointId = `${connection.pipeId}:${connection.endpoint}`;
        if (!pipeEndpointOwners.has(endpointId)) pipeEndpointOwners.set(endpointId, []);
        pipeEndpointOwners.get(endpointId).push({ fittingId: junction.fittingId, residualFt: connection.residualFt });
      } else if (connection.kind === 'pipe-span') {
        pipeSpanAttachments.push({ fittingId: junction.fittingId, ...connection });
      } else if (connection.kind === 'open-terminal') {
        openTerminals.push({ fittingId: junction.fittingId, ...connection });
      }
    }
  }
  for (const [endpointId, owners] of pipeEndpointOwners) {
    if (owners.length > 1) {
      issues.push(issue(
        'SOURCE_FITTING_JUNCTION_PIPE_ENDPOINT_CONFLICT',
        'One exact pipe endpoint was selected by multiple fitting centers.',
        `${endpointId}|${owners.map((owner) => owner.fittingId).sort().join('|')}`,
      ));
    }
  }

  const invalidFittingIds = new Set(issues.flatMap((entry) => entry.entityId?.split('|') ?? []));
  const normalizedJunctions = junctions.map((junction) => invalidFittingIds.has(junction.fittingId)
    ? {
      ...junction,
      status: 'held-cross-junction-conflict',
      sourceCenterlineAdjacencyReady: false,
    }
    : junction);
  const rigidJunctions = normalizedJunctions.filter((junction) => junction.subCategory !== 'Flex Drop');
  const resolvedRigidJunctions = rigidJunctions.filter((junction) => junction.sourceCenterlineAdjacencyReady);

  return {
    schema: 'halofire.source-fitting-junction-graph.v1',
    settings: { maxGapFt, rayAngleDeg },
    junctions: normalizedJunctions,
    fittingLinks: [...fittingLinks.values()].sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
    pipeEndpointLinks: [...pipeEndpointOwners.entries()]
      .filter(([, owners]) => owners.length === 1)
      .map(([endpointId, [owner]]) => ({ endpointId, ...owner }))
      .sort((left, right) => left.endpointId.localeCompare(right.endpointId)),
    pipeSpanAttachments: pipeSpanAttachments.sort((left, right) => left.fittingId.localeCompare(right.fittingId)),
    openTerminals: openTerminals.sort((left, right) => left.fittingId.localeCompare(right.fittingId)),
    issues,
    metrics: {
      fittingCount: fittings.length,
      rigidFittingCount: rigidJunctions.length,
      flexibleDropCount: normalizedJunctions.filter((junction) => junction.subCategory === 'Flex Drop').length,
      resolvedRigidFittingCount: resolvedRigidJunctions.length,
      unresolvedRigidFittingCount: rigidJunctions.length - resolvedRigidJunctions.length,
      fittingToFittingEdgeCount: fittingLinks.size,
      fittingToPipeEndpointEdgeCount: [...pipeEndpointOwners.values()].filter((owners) => owners.length === 1).length,
      inlineDeviceAttachmentCount: pipeSpanAttachments.length,
      sourceOrientedOpenTerminalCount: openTerminals.length,
    },
    claims: {
      sourceCenterlineAdjacencyCompleteReady: rigidJunctions.length > 0
        && resolvedRigidJunctions.length === rigidJunctions.length
        && issues.length === 0,
      manufacturerExactTakeoutReady: false,
      flexibleHoseCenterlineReady: false,
      properPipeLayoutReady: false,
    },
  };
}

export function evaluateBoundedSourceFittingJunction(graph, {
  fittingIds = [],
  pipeEndpointIds = [],
} = {}) {
  const issues = [];
  const junctionById = new Map((graph?.junctions || []).map((junction) => [junction.fittingId, junction]));
  const boundedFittingIds = [...new Set(fittingIds)].sort();
  const boundedPipeEndpointIds = [...new Set(pipeEndpointIds)].sort();
  for (const fittingId of boundedFittingIds) {
    const junction = junctionById.get(fittingId);
    if (!junction?.sourceCenterlineAdjacencyReady) {
      issues.push(issue(
        'SOURCE_FITTING_BOUNDED_JUNCTION_UNRESOLVED',
        'Every bounded fitting must have an unambiguous source-centerline junction.',
        fittingId,
      ));
    }
  }
  const boundedFittingSet = new Set(boundedFittingIds);
  const fittingLinks = (graph?.fittingLinks || []).filter((link) => link.fittingIds
    .every((fittingId) => boundedFittingSet.has(fittingId)));
  const pipeEndpointLinks = (graph?.pipeEndpointLinks || []).filter((link) => {
    const junction = junctionById.get(link.fittingId);
    return boundedFittingSet.has(link.fittingId)
      && junction?.sourceCenterlineAdjacencyReady
      && boundedPipeEndpointIds.includes(link.endpointId);
  });
  const resolvedPipeEndpointIds = pipeEndpointLinks.map((link) => link.endpointId).sort();
  if (JSON.stringify(resolvedPipeEndpointIds) !== JSON.stringify(boundedPipeEndpointIds)) {
    issues.push(issue(
      'SOURCE_FITTING_BOUNDED_PIPE_ENDPOINTS_INCOMPLETE',
      'The bounded junction must own every expected pipe endpoint exactly once.',
    ));
  }
  if (graph?.claims?.manufacturerExactTakeoutReady !== false
    || graph?.claims?.flexibleHoseCenterlineReady !== false
    || graph?.claims?.properPipeLayoutReady !== false) {
    issues.push(issue(
      'SOURCE_FITTING_BOUNDED_FALSE_PROMOTION',
      'A source-centerline junction cannot promote manufacturer takeout, hose centerlines, or proper layout.',
    ));
  }
  return {
    status: issues.length === 0 ? 'passed' : 'blocked',
    issues,
    fittingIds: boundedFittingIds,
    pipeEndpointIds: boundedPipeEndpointIds,
    fittingLinks,
    pipeEndpointLinks,
    sourceCenterlineAdjacencyReady: issues.length === 0,
    manufacturerExactTakeoutReady: false,
    properPipeLayoutReady: false,
  };
}
