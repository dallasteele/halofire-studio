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

/** Apply a frozen spacing/area policy to a normalized protected-source packet. */
export async function buildSourceTopologyPlacementCandidate(packet) {
  const heads = [];
  const roomAudit = [];
  const roofAudit = [];
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
    const grid = rectangularGrid(volume, packet.placementPolicy);
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
    roofAudit.push({ sourceVolumeId: volume.id, sourcePages: volume.sourcePages, boundsFt: grid.bounds, widthFt: grid.width, heightFt: grid.height, columns: grid.columns, rows: grid.rows, candidateIds });
  }
  return {
    heads,
    roomAudit,
    roofAudit,
    counts: {
      total: heads.length,
      pendent: heads.filter((head) => head.kind === 'pendent').length,
      upright: heads.filter((head) => head.kind === 'upright').length,
    },
    policyReceiptSha256: await sha256Hex(packet.placementPolicy),
  };
}
