/**
 * Transferable protected-source placement policy.
 *
 * This module deliberately knows nothing about a completed sprinkler drawing.
 * It converts source-derived room and pitched-volume polygons into deterministic
 * protection targets while retaining every downstream engineering gate.
 */

import { sha256Hex } from './elevation-datums.js';
import { boundingBox, pointInPolygon } from './sprinkler-layout.js';

const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function polygonVertices(entry) {
  return entry.verticesFt.map(({ x, y }) => [Number(x), Number(y)]);
}

function rectangularGrid(entry, policy) {
  const vertices = polygonVertices(entry);
  const bounds = boundingBox(vertices);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  let columns = Math.max(1, Math.ceil(width / policy.maxSpacingFt));
  let rows = Math.max(1, Math.ceil(height / policy.maxSpacingFt));
  let guard = 0;
  while ((width / columns) * (height / rows) > policy.maxAreaSqFt && guard < 1000) {
    if (width / columns >= height / rows) columns += 1;
    else rows += 1;
    guard += 1;
  }
  const points = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = bounds.minX + (column + 0.5) * width / columns;
      const y = bounds.minY + (row + 0.5) * height / rows;
      if (pointInPolygon([x, y], vertices)) points.push({ x: round(x), y: round(y), row, column });
    }
  }
  return { bounds, width: round(width), height: round(height), columns, rows, points };
}

function roofTargetZ(volume, point) {
  const distance = volume.ridgeAxis === 'x'
    ? Math.abs(point.y - volume.ridgeCoordinateFt)
    : Math.abs(point.x - volume.ridgeCoordinateFt);
  const halfSpan = volume.ridgeAxis === 'x'
    ? (boundingBox(polygonVertices(volume)).maxY - boundingBox(polygonVertices(volume)).minY) / 2
    : (boundingBox(polygonVertices(volume)).maxX - boundingBox(polygonVertices(volume)).minX) / 2;
  const rise = halfSpan * volume.slopeRise / volume.slopeRun;
  return round(volume.eaveDatumZFt + Math.max(0, rise - distance * volume.slopeRise / volume.slopeRun));
}

function exposedSlopeTargetZ(volume, point) {
  const coordinate = volume.slopeAxis === 'x' ? point.x : point.y;
  const direction = volume.slopeDirection === -1 ? -1 : 1;
  const runFromLowEdgeFt = Math.max(0, (coordinate - volume.lowEdgeCoordinateFt) * direction);
  return round(volume.lowEdgeDatumZFt + runFromLowEdgeFt * volume.slopeRise / volume.slopeRun);
}

/**
 * Fail closed when a v2 packet leaves a finished-ceiling component without a
 * declared concealed-volume relationship. This catches connector, vestibule,
 * canopy, and transition volumes that a pair of obvious gables can hide.
 */
export function auditSourceTopologyCompleteness(packet) {
  const enforcement = packet.topologyCompletenessPolicy?.enforceFinishedCeilingToConcealedVolumeMapping === true;
  if (!enforcement) return { status: 'not-enforced', issues: [], mappedRoomIds: [], concealedVolumeIds: [] };
  const volumes = new Map(packet.pitchedConcealedVolumes.map((volume) => [volume.id, volume]));
  const issues = [];
  const mappedRoomIds = [];
  for (const room of packet.finishedCeilingRooms) {
    if (!room.concealedSpaceExpected) continue;
    if (!room.concealedVolumeId || !volumes.has(room.concealedVolumeId)) {
      issues.push({ code: 'SOURCE_TOPOLOGY_CONCEALED_VOLUME_MISSING', sourceRoomId: room.id, concealedVolumeId: room.concealedVolumeId || null });
      continue;
    }
    const volume = volumes.get(room.concealedVolumeId);
    if (!volume.coveredFinishedRoomIds?.includes(room.id)) {
      issues.push({ code: 'SOURCE_TOPOLOGY_CONCEALED_VOLUME_REVERSE_BINDING_MISSING', sourceRoomId: room.id, concealedVolumeId: volume.id });
      continue;
    }
    mappedRoomIds.push(room.id);
  }
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    mappedRoomIds,
    concealedVolumeIds: [...volumes.keys()],
  };
}

/** Apply a frozen spacing/area policy to a normalized protected-source packet. */
export async function buildSourceTopologyPlacementCandidate(packet) {
  const topologyCompletenessAudit = auditSourceTopologyCompleteness(packet);
  if (topologyCompletenessAudit.status === 'blocked') throw new Error('SOURCE_TOPOLOGY_COMPLETENESS_BLOCKED');
  const heads = [];
  const roomAudit = [];
  const roofAudit = [];
  const exposedSlopedAudit = [];
  for (const room of packet.finishedCeilingRooms) {
    const grid = rectangularGrid(room, packet.placementPolicy);
    const candidateIds = [];
    for (const point of grid.points) {
      const id = `${packet.candidateIdPrefix}-P-${String(heads.filter((head) => head.kind === 'pendent').length + 1).padStart(3, '0')}`;
      candidateIds.push(id);
      heads.push({
        id,
        kind: 'pendent',
        localFt: { x: point.x, y: point.y },
        sourceProtectionRegime: 'finished-ceiling-pendent-source-plane',
        sourceProtectionPlaneId: room.ceilingPlaneId,
        sourceProtectionPlaneZFt: room.ceilingDatumZFt,
        headInstallationZFt: null,
        sprinklerModel: null,
        sourceDerivation: { method: 'source-room-polygon-centered-policy-grid', sourceRoomId: room.id, row: point.row, column: point.column },
        obstructionClearanceVerified: false,
        hydraulicNodeAssigned: false,
      });
    }
    roomAudit.push({ sourceRoomId: room.id, sourcePage: room.sourcePage, boundsFt: grid.bounds, widthFt: grid.width, heightFt: grid.height, columns: grid.columns, rows: grid.rows, candidateIds });
  }
  for (const volume of packet.pitchedConcealedVolumes) {
    const concealedPolicy = {
      ...packet.placementPolicy,
      maxAreaSqFt: volume.maxAreaSqFt ?? packet.concealedSpacePlacementPolicy?.maxAreaSqFt ?? packet.placementPolicy.maxAreaSqFt,
      maxSpacingFt: volume.maxSpacingFt ?? packet.concealedSpacePlacementPolicy?.maxSpacingFt ?? packet.placementPolicy.maxSpacingFt,
    };
    const grid = rectangularGrid(volume, concealedPolicy);
    const candidateIds = [];
    for (const point of grid.points) {
      const id = `${packet.candidateIdPrefix}-U-${String(heads.filter((head) => head.kind === 'upright').length + 1).padStart(3, '0')}`;
      candidateIds.push(id);
      heads.push({
        id,
        kind: 'upright',
        localFt: { x: point.x, y: point.y },
        sourceProtectionRegime: 'pitched-concealed-volume-source-protection-target',
        sourceProtectionPlaneId: volume.id,
        sourceProtectionPlaneZFt: roofTargetZ(volume, point),
        headInstallationZFt: null,
        sprinklerModel: null,
        sourceDerivation: { method: 'source-pitched-volume-centered-policy-grid', sourceVolumeId: volume.id, ridgeAxis: volume.ridgeAxis, slope: `${volume.slopeRise}:${volume.slopeRun}`, row: point.row, column: point.column },
        obstructionClearanceVerified: false,
        hydraulicNodeAssigned: false,
      });
    }
    const audit = { sourceVolumeId: volume.id, sourcePages: volume.sourcePages, boundsFt: grid.bounds, widthFt: grid.width, heightFt: grid.height, columns: grid.columns, rows: grid.rows, candidateIds };
    if (topologyCompletenessAudit.status !== 'not-enforced') Object.assign(audit, { coveredFinishedRoomIds: volume.coveredFinishedRoomIds || [], maxAreaSqFt: concealedPolicy.maxAreaSqFt, maxSpacingFt: concealedPolicy.maxSpacingFt });
    roofAudit.push(audit);
  }
  for (const volume of packet.exposedSlopedCeilingVolumes || []) {
    const exposedPolicy = {
      ...packet.placementPolicy,
      maxAreaSqFt: volume.maxAreaSqFt ?? packet.exposedSlopedPlacementPolicy?.maxAreaSqFt ?? packet.placementPolicy.maxAreaSqFt,
      maxSpacingFt: volume.maxSpacingFt ?? packet.exposedSlopedPlacementPolicy?.maxSpacingFt ?? packet.placementPolicy.maxSpacingFt,
    };
    const grid = rectangularGrid(volume, exposedPolicy);
    const candidateIds = [];
    for (const point of grid.points) {
      const id = `${packet.candidateIdPrefix}-S-${String(heads.filter((head) => head.sourceProtectionRegime === 'exposed-sloped-source-protection-target').length + 1).padStart(3, '0')}`;
      candidateIds.push(id);
      heads.push({
        id,
        kind: volume.targetKind || 'orientation-unresolved',
        localFt: { x: point.x, y: point.y },
        sourceProtectionRegime: 'exposed-sloped-source-protection-target',
        sourceProtectionPlaneId: volume.id,
        sourceProtectionPlaneZFt: exposedSlopeTargetZ(volume, point),
        headInstallationZFt: null,
        sprinklerModel: null,
        sourceDerivation: {
          method: 'source-exposed-single-slope-centered-policy-grid',
          sourceVolumeId: volume.id,
          slopeAxis: volume.slopeAxis,
          slopeDirection: volume.slopeDirection === -1 ? -1 : 1,
          slope: `${volume.slopeRise}:${volume.slopeRun}`,
          row: point.row,
          column: point.column,
        },
        obstructionClearanceVerified: false,
        hydraulicNodeAssigned: false,
      });
    }
    exposedSlopedAudit.push({
      sourceVolumeId: volume.id,
      sourcePages: volume.sourcePages,
      boundsFt: grid.bounds,
      widthFt: grid.width,
      heightFt: grid.height,
      columns: grid.columns,
      rows: grid.rows,
      candidateIds,
      targetKind: volume.targetKind || 'orientation-unresolved',
      maxAreaSqFt: exposedPolicy.maxAreaSqFt,
      maxSpacingFt: exposedPolicy.maxSpacingFt,
    });
  }
  const result = {
    heads,
    roomAudit,
    roofAudit,
    counts: {
      total: heads.length,
      pendent: heads.filter((head) => head.kind === 'pendent').length,
      upright: heads.filter((head) => head.kind === 'upright').length,
    },
    topologyCompletenessAudit,
    policyReceiptSha256: await sha256Hex(packet.placementPolicy),
  };
  if ((packet.exposedSlopedCeilingVolumes || []).length) {
    result.exposedSlopedAudit = exposedSlopedAudit;
    result.counts.unresolved = heads.filter((head) => head.kind === 'orientation-unresolved').length;
  }
  return result;
}
