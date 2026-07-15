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

function orientation(a, b, c) {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(cross) <= 1e-9) return 0;
  return cross > 0 ? 1 : -1;
}

function onSegment(a, b, point) {
  return point[0] >= Math.min(a[0], b[0]) - 1e-9
    && point[0] <= Math.max(a[0], b[0]) + 1e-9
    && point[1] >= Math.min(a[1], b[1]) - 1e-9
    && point[1] <= Math.max(a[1], b[1]) + 1e-9;
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB) return true;
  return (abC === 0 && onSegment(a, b, c))
    || (abD === 0 && onSegment(a, b, d))
    || (cdA === 0 && onSegment(c, d, a))
    || (cdB === 0 && onSegment(c, d, b));
}

function polygonsIntersect(left, right) {
  if (left.some((point) => pointInPolygon(point, right)) || right.some((point) => pointInPolygon(point, left))) return true;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftNext = (leftIndex + 1) % left.length;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const rightNext = (rightIndex + 1) % right.length;
      if (segmentsIntersect(left[leftIndex], left[leftNext], right[rightIndex], right[rightNext])) return true;
    }
  }
  return false;
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

const finiteNumber = (value) => Number.isFinite(Number(value));
const sameNumber = (left, right, tolerance = 0.001) => finiteNumber(left) && finiteNumber(right) && Math.abs(Number(left) - Number(right)) <= tolerance;

/**
 * Exposed-slope inputs are especially vulnerable to cross-registering a room
 * boundary, roof arrow, and section datum that belong to different features.
 * Require one feature identity plus a real PDF-to-local transform before the
 * production policy may place any target on the plane.
 */
export function auditExposedSlopeSourceRegistration(packet) {
  const volumes = packet.exposedSlopedCeilingVolumes || [];
  if (!volumes.length) return { status: 'not-applicable', issues: [], registeredVolumeIds: [] };
  const issues = [];
  const registeredVolumeIds = [];
  for (const volume of volumes) {
    const registration = volume.sourceRegistration;
    if (!registration) {
      issues.push({ code: 'SOURCE_EXPOSED_SLOPE_REGISTRATION_MISSING', sourceVolumeId: volume.id });
      continue;
    }
    const evidence = [registration.plan, registration.roof, registration.rcp, registration.section];
    const sameFeature = registration.featureId === volume.id
      && evidence.every((entry) => entry?.sourceFeatureId === registration.featureId && typeof entry?.page === 'string' && volume.sourcePages?.includes(entry.page));
    if (!sameFeature) {
      issues.push({ code: 'SOURCE_EXPOSED_SLOPE_FEATURE_BINDING_INVALID', sourceVolumeId: volume.id });
      continue;
    }
    const bounds = boundingBox(polygonVertices(volume));
    const widthFt = bounds.maxX - bounds.minX;
    const heightFt = bounds.maxY - bounds.minY;
    const plan = registration.plan;
    const transformValid = Array.isArray(plan.pdfToLocalFtTransform)
      && plan.pdfToLocalFtTransform.length === 6
      && plan.pdfToLocalFtTransform.every(finiteNumber)
      && plan.pdfBoundsPt
      && ['x', 'y', 'width', 'height'].every((key) => finiteNumber(plan.pdfBoundsPt[key]))
      && Number(plan.pdfBoundsPt.width) > 0
      && Number(plan.pdfBoundsPt.height) > 0;
    if (!transformValid || !sameNumber(plan.widthFt, widthFt) || !sameNumber(plan.heightFt, heightFt)) {
      issues.push({ code: 'SOURCE_EXPOSED_SLOPE_PLAN_TRANSFORM_INVALID', sourceVolumeId: volume.id });
      continue;
    }
    const slopeMatches = sameNumber(registration.roof.slopeRise, volume.slopeRise)
      && sameNumber(registration.roof.slopeRun, volume.slopeRun)
      && sameNumber(registration.section.slopeRise, volume.slopeRise)
      && sameNumber(registration.section.slopeRun, volume.slopeRun);
    if (!slopeMatches) {
      issues.push({ code: 'SOURCE_EXPOSED_SLOPE_SLOPE_EVIDENCE_CONFLICT', sourceVolumeId: volume.id });
      continue;
    }
    if (!sameNumber(registration.section.lowEdgeDatumZFt, volume.lowEdgeDatumZFt) || typeof registration.rcp.ceilingRegime !== 'string' || !registration.rcp.ceilingRegime.trim()) {
      issues.push({ code: 'SOURCE_EXPOSED_SLOPE_VERTICAL_EVIDENCE_CONFLICT', sourceVolumeId: volume.id });
      continue;
    }
    registeredVolumeIds.push(volume.id);
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, registeredVolumeIds };
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

/**
 * A roof, RCP, or section feature proves geometry, not that the projected area
 * is occupied or sprinkler protected. When enabled, every roof-derived volume
 * must bind to a source-declared floor footprint and geometrically intersect it
 * before the placement policy may emit targets.
 */
export function auditSourceProtectionEligibility(packet) {
  const enforcement = packet.protectionEligibilityPolicy?.enforceSourceDeclaredFootprintIntersection === true;
  if (!enforcement) return { status: 'not-enforced', issues: [], eligibleVolumeIds: [], matchedFootprintIds: [] };
  const sourceFootprints = packet.sourceOccupiedOrProtectedFloorFootprints ?? packet.sourceProtectedFloorFootprints ?? [];
  const footprints = new Map(sourceFootprints.map((footprint) => [footprint.id, footprint]));
  const volumes = [
    ...(packet.pitchedConcealedVolumes || []),
    ...(packet.exposedSlopedCeilingVolumes || []),
    ...(packet.curvedCeilingVolumes || []),
  ];
  const issues = [];
  const eligibleVolumeIds = [];
  const matchedFootprintIds = new Set();
  for (const volume of volumes) {
    const binding = volume.protectionEligibility;
    if (binding?.status !== 'source-declared-protected' || !Array.isArray(binding?.sourceFootprintIds) || !binding.sourceFootprintIds.length) {
      issues.push({ code: 'SOURCE_PROTECTION_ELIGIBILITY_DECLARATION_MISSING', sourceVolumeId: volume.id });
      continue;
    }
    const volumePolygon = Array.isArray(volume.verticesFt) && volume.verticesFt.length >= 3 ? polygonVertices(volume) : null;
    const matched = [];
    for (const footprintId of binding.sourceFootprintIds) {
      const footprint = footprints.get(footprintId);
      const validFootprint = footprint
        && typeof footprint.sourcePage === 'string'
        && footprint.sourcePage.trim()
        && typeof footprint.sourceDeclaration === 'string'
        && footprint.sourceDeclaration.trim()
        && Array.isArray(footprint.verticesFt)
        && footprint.verticesFt.length >= 3;
      if (!validFootprint) {
        issues.push({ code: 'SOURCE_PROTECTION_FOOTPRINT_INVALID', sourceVolumeId: volume.id, sourceFootprintId: footprintId });
        continue;
      }
      const sourcePagesBound = Array.isArray(binding.sourcePages)
        && binding.sourcePages.includes(footprint.sourcePage)
        && volume.sourcePages?.includes(footprint.sourcePage);
      if (!sourcePagesBound) {
        issues.push({ code: 'SOURCE_PROTECTION_FOOTPRINT_SOURCE_BINDING_INVALID', sourceVolumeId: volume.id, sourceFootprintId: footprintId });
        continue;
      }
      if (volumePolygon && polygonsIntersect(volumePolygon, polygonVertices(footprint))) matched.push(footprintId);
    }
    if (!volumePolygon || !matched.length) {
      issues.push({ code: 'SOURCE_PROTECTION_FOOTPRINT_INTERSECTION_MISSING', sourceVolumeId: volume.id });
      continue;
    }
    eligibleVolumeIds.push(volume.id);
    matched.forEach((id) => matchedFootprintIds.add(id));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, eligibleVolumeIds, matchedFootprintIds: [...matchedFootprintIds] };
}

/** Apply a frozen spacing/area policy to a normalized protected-source packet. */
export async function buildSourceTopologyPlacementCandidate(packet, options = {}) {
  const topologyCompletenessAudit = auditSourceTopologyCompleteness(packet);
  if (topologyCompletenessAudit.status === 'blocked') throw new Error('SOURCE_TOPOLOGY_COMPLETENESS_BLOCKED');
  const exposedSlopeRegistrationAudit = auditExposedSlopeSourceRegistration(packet);
  if (exposedSlopeRegistrationAudit.status === 'blocked' && options.allowLegacyUnregisteredExposedSlope !== true) throw new Error('SOURCE_EXPOSED_SLOPE_REGISTRATION_BLOCKED');
  const protectionEligibilityAudit = auditSourceProtectionEligibility(packet);
  if (protectionEligibilityAudit.status === 'blocked') throw new Error('SOURCE_PROTECTION_ELIGIBILITY_BLOCKED');
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
      const sourceRoofSurfaceZFt = exposedSlopeTargetZ(volume, point);
      const protectionPlaneUnresolved = volume.protectionPlaneOffsetStatus && volume.protectionPlaneOffsetStatus !== 'resolved';
      const target = {
        id,
        kind: volume.targetKind || 'orientation-unresolved',
        localFt: { x: point.x, y: point.y },
        sourceProtectionRegime: 'exposed-sloped-source-protection-target',
        sourceProtectionPlaneId: volume.id,
        sourceProtectionPlaneZFt: protectionPlaneUnresolved ? null : sourceRoofSurfaceZFt,
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
      };
      if (protectionPlaneUnresolved) Object.assign(target, {
        sourceRoofSurfaceZFt,
        sourceVerticalDatumStatus: volume.protectionPlaneOffsetStatus,
      });
      heads.push(target);
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
  if (protectionEligibilityAudit.status !== 'not-enforced') result.protectionEligibilityAudit = protectionEligibilityAudit;
  if ((packet.exposedSlopedCeilingVolumes || []).length) {
    result.exposedSlopedAudit = exposedSlopedAudit;
    result.counts.unresolved = heads.filter((head) => head.kind === 'orientation-unresolved').length;
    if (options.allowLegacyUnregisteredExposedSlope !== true) result.exposedSlopeRegistrationAudit = exposedSlopeRegistrationAudit;
  }
  return result;
}
