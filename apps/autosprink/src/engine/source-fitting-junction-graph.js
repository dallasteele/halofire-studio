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

  const junctions = fittings.map((fitting) => {
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
    const nearestFittingCenterFt = rawCandidates
      .filter((candidate) => candidate.kind === 'fitting-center'
        && candidate.residualFt > POINT_EPSILON_FT)
      .reduce((best, candidate) => Math.min(best, candidate.residualFt), Number.POSITIVE_INFINITY);
    // A nearer fitting center terminates this fitting's direct adjacency horizon.
    // Pipe ends and other fitting centers beyond that component cannot skip over
    // the nearer fitting. Equal-distance tee arms remain visible together.
    const adjacencyHorizonFt = Number.isFinite(nearestFittingCenterFt)
      ? nearestFittingCenterFt + POINT_EPSILON_FT
      : maxGapFt;
    const candidates = rawCandidates.filter((candidate) => candidate.residualFt <= adjacencyHorizonFt);

    const coincidentCandidates = candidates.filter((candidate) => candidate.direction === null);
    if (coincidentCandidates.length > 0) {
      return {
        fittingId: fitting.id,
        subCategory,
        pointFt: fitting.pointFt,
        expectedSystemPortCount,
        candidateCount: candidates.length,
        rawCandidateCount: rawCandidates.length,
        adjacencyHorizonFt: round(adjacencyHorizonFt),
        coincidentCandidateIds: coincidentCandidates.map(candidateKey),
        selectedConnections: [],
        status: 'held-coincident-source-entities',
        sourceCenterlineAdjacencyReady: false,
      };
    }

    const rays = [];
    for (const candidate of candidates) {
      const ray = rays.find((entry) => dot(entry.direction, candidate.direction) >= rayCosine);
      if (ray) {
        ray.candidates.push(candidate);
      } else {
        rays.push({ direction: candidate.direction, candidates: [candidate] });
      }
    }
    const nearestByRay = rays.map((ray) => ray.candidates[0]);
    const ready = nearestByRay.length === expectedSystemPortCount;
    return {
      fittingId: fitting.id,
      subCategory,
      pointFt: fitting.pointFt,
      expectedSystemPortCount,
      candidateCount: candidates.length,
      rawCandidateCount: rawCandidates.length,
      adjacencyHorizonFt: round(adjacencyHorizonFt),
      distinctRayCount: nearestByRay.length,
      selectedConnections: ready
        ? nearestByRay.map((candidate) => ({
          kind: candidate.kind,
          ...(candidate.kind === 'pipe-endpoint'
            ? { pipeId: candidate.pipeId, endpoint: candidate.endpoint }
            : { fittingId: candidate.fittingId }),
          residualFt: candidate.residualFt,
          direction: Object.fromEntries(Object.entries(candidate.direction)
            .map(([axis, value]) => [axis, round(value, 6)])),
        })).sort((left, right) => {
          const leftId = left.kind === 'pipe-endpoint' ? `${left.pipeId}:${left.endpoint}` : left.fittingId;
          const rightId = right.kind === 'pipe-endpoint' ? `${right.pipeId}:${right.endpoint}` : right.fittingId;
          return leftId.localeCompare(rightId);
        })
        : [],
      status: ready
        ? 'source-centerline-rays-resolved'
        : nearestByRay.length < expectedSystemPortCount
          ? 'held-insufficient-source-rays'
          : 'held-excess-source-rays',
      sourceCenterlineAdjacencyReady: ready,
    };
  });

  const junctionById = new Map(junctions.map((junction) => [junction.fittingId, junction]));
  const issues = [];
  const fittingLinks = new Map();
  const pipeEndpointOwners = new Map();
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
      } else {
        const endpointId = `${connection.pipeId}:${connection.endpoint}`;
        if (!pipeEndpointOwners.has(endpointId)) pipeEndpointOwners.set(endpointId, []);
        pipeEndpointOwners.get(endpointId).push({ fittingId: junction.fittingId, residualFt: connection.residualFt });
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
    issues,
    metrics: {
      fittingCount: fittings.length,
      rigidFittingCount: rigidJunctions.length,
      flexibleDropCount: normalizedJunctions.filter((junction) => junction.subCategory === 'Flex Drop').length,
      resolvedRigidFittingCount: resolvedRigidJunctions.length,
      unresolvedRigidFittingCount: rigidJunctions.length - resolvedRigidJunctions.length,
      fittingToFittingEdgeCount: fittingLinks.size,
      fittingToPipeEndpointEdgeCount: [...pipeEndpointOwners.values()].filter((owners) => owners.length === 1).length,
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
