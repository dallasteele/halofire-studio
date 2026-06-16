import { totalEquivalentLength } from './fittingLoss.mjs';
import { frictionLossForRun } from './hazenWilliamsNetwork.mjs';

function assertPositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}

function normalizePathSegment(segment) {
  if (!segment || typeof segment !== 'object') {
    throw new Error('Each path segment must be an object');
  }

  const fittings = segment.fittings ?? [];
  const equivalentLength = totalEquivalentLength(fittings);

  return {
    Q: Number(segment.Q),
    d: Number(segment.d),
    len: Number(segment.len) + equivalentLength,
    C: segment.C === undefined ? undefined : Number(segment.C),
    headId: segment.headId,
  };
}

function uniqueHeadIds(pathSegments, remoteHeadId) {
  const ids = [];
  const seen = new Set();

  for (const segment of pathSegments) {
    if (typeof segment.headId !== 'string' || segment.headId.length === 0) {
      continue;
    }
    if (!seen.has(segment.headId)) {
      seen.add(segment.headId);
      ids.push(segment.headId);
    }
  }

  if (!seen.has(remoteHeadId)) {
    ids.push(remoteHeadId);
  }

  return ids;
}

function hydraulicDemandForHead(head) {
  if (!head || typeof head !== 'object') {
    throw new Error('Each head must be an object');
  }
  if (typeof head.id !== 'string' || head.id.length === 0) {
    throw new Error('Each head must have a non-empty id');
  }
  if (!Array.isArray(head.path) || head.path.length === 0) {
    throw new Error(`Head ${head.id} must include a non-empty path`);
  }

  const normalizedSegments = head.path.map(normalizePathSegment);
  const psi = frictionLossForRun(normalizedSegments);
  return {
    headId: head.id,
    psi,
    headsOpen: uniqueHeadIds(normalizedSegments, head.id),
  };
}

export function selectRemoteArea(heads, areaSqFt, densityGpmPerSqFt) {
  if (!Array.isArray(heads) || heads.length === 0) {
    throw new Error('heads must be a non-empty array');
  }

  assertPositiveNumber(areaSqFt, 'areaSqFt');
  assertPositiveNumber(densityGpmPerSqFt, 'densityGpmPerSqFt');

  const gpm = areaSqFt * densityGpmPerSqFt;
  let selected = null;

  for (const head of heads) {
    const candidate = hydraulicDemandForHead(head);
    if (selected === null || candidate.psi > selected.psi) {
      selected = candidate;
    }
  }

  return {
    gpm,
    psi: selected.psi,
    headsOpen: selected.headsOpen,
  };
}
