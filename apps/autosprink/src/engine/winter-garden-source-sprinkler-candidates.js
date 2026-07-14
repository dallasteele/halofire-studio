import { sha256Hex } from './elevation-datums.js';
import { validateHaloFireOperationalKnowledgeReceipt } from './halofire-operational-knowledge.js';
import { pointInPolygon } from './sprinkler-layout.js';

const PROJECT = 'LDS Meeting House - Winter Garden FL';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

function bounds(polygon) {
  return {
    minX: Math.min(...polygon.map((point) => point[0])),
    minY: Math.min(...polygon.map((point) => point[1])),
    maxX: Math.max(...polygon.map((point) => point[0])),
    maxY: Math.max(...polygon.map((point) => point[1])),
  };
}

function candidatePoint(polygons, anchor) {
  const boxes = polygons.map(bounds);
  const overlap = {
    minX: Math.max(...boxes.map((box) => box.minX)), minY: Math.max(...boxes.map((box) => box.minY)),
    maxX: Math.min(...boxes.map((box) => box.maxX)), maxY: Math.min(...boxes.map((box) => box.maxY)),
  };
  const center = [(overlap.minX + overlap.maxX) / 2, (overlap.minY + overlap.maxY) / 2];
  const insideAll = (point) => point.every(Number.isFinite) && polygons.every((polygon) => pointInPolygon(point, polygon));
  if (overlap.minX <= overlap.maxX && overlap.minY <= overlap.maxY && insideAll(center)) return center.map((value) => round(value));
  const steps = 16;
  for (let row = 0; row < steps; row += 1) for (let column = 0; column < steps; column += 1) {
    const point = [
      overlap.minX + ((column + 0.5) / steps) * (overlap.maxX - overlap.minX),
      overlap.minY + ((row + 0.5) / steps) * (overlap.maxY - overlap.minY),
    ];
    if (insideAll(point)) return point.map((value) => round(value));
  }
  return insideAll(anchor) ? anchor.map((value) => round(value)) : null;
}

/**
 * Join independent source sheets without using a completed sprinkler drawing.
 * Only a single-identity topology envelope, exact source-room name match, unique
 * spatial hazard containment, and a flat source-registered ceiling can emit a
 * preliminary head candidate. Sloped rooms stay blocked until a source ceiling
 * plane (not merely a roof plane or SLOPED label) is sealed.
 */
export function buildWinterGardenSourceSprinklerCandidates({ topology, registry, hazard, building }) {
  const rooms = Array.isArray(building?.model?.rooms) ? building.model.rooms : [];
  const hazardZones = Array.isArray(hazard?.zoning?.zones) ? hazard.zoning.zones : [];
  const floorElevationFt = Number(building?.model?.floorElevationFt);
  const candidates = [];
  const roomsAudit = [];

  for (const space of Array.isArray(registry?.spaces) ? registry.spaces : []) {
    const zone = topology?.zones?.find((entry) => entry.roomNumbers?.includes(space.roomNumber)) || null;
    const spatialHits = rooms.map((room, index) => ({ room, index, hazard: hazardZones[index] }))
      .filter((entry) => Array.isArray(entry.room?.poly) && pointInPolygon(space.sourceAnchorFt, entry.room.poly));
    const exactHits = spatialHits.filter((entry) => normalize(entry.room.label) === normalize(space.roomName));
    const sourceHazard = exactHits.length === 1 ? exactHits[0].hazard : null;
    const reasons = [];
    if (!zone?.topologyReady) reasons.push('source-topology-envelope-not-ready');
    if (zone?.roomNumbers?.length !== 1) reasons.push('multi-identity-protection-envelope-not-partitioned');
    if (space.geometry?.status !== 'source-anchor-component') reasons.push('source-room-component-missing');
    if (space.ceiling?.status !== 'source-registered') reasons.push('source-ceiling-height-not-registered');
    if (space.ceiling?.sloped) reasons.push('sloped-ceiling-plane-not-source-sealed');
    if (spatialHits.length !== 1) reasons.push('source-hazard-spatial-containment-not-unique');
    if (exactHits.length !== 1) reasons.push('source-hazard-room-name-agreement-failed');
    if (sourceHazard?.status !== 'source-classified' || !sourceHazard?.hazardClass) reasons.push('source-hazard-classification-not-ready');
    if (!Number.isFinite(floorElevationFt)) reasons.push('source-floor-elevation-not-ready');

    let pointFt = null;
    if (!reasons.length) {
      pointFt = candidatePoint([zone.geometry.polygon, space.geometry.polygon, exactHits[0].room.poly], space.sourceAnchorFt);
      if (!pointFt) reasons.push('three-sheet-protection-intersection-empty');
    }

    if (!reasons.length) {
      const ceilingHeightFt = Number(space.ceiling.minimumHeightFt);
      const head = {
        candidateId: `wg-source-head-${space.roomNumber}-001`,
        roomNumber: space.roomNumber,
        roomName: space.roomName,
        topologyZoneId: zone.zoneId,
        sourceRoomId: sourceHazard.roomId,
        hazardClass: sourceHazard.hazardClass,
        hazardRuleId: sourceHazard.hazardRuleId,
        maxCoverageSqftPerHead: sourceHazard.maxCoverageSqftPerHead,
        planPointFt: pointFt,
        modelPointFt: [pointFt[0], pointFt[1], round(floorElevationFt + ceilingHeightFt)],
        ceiling: { kind: 'flat-source-registered', heightAboveFloorFt: ceilingHeightFt, sourceSheet: 'A151' },
        sourceSheets: ['A101', 'A103', 'A151', 'WG Specs'],
        coverageVerified: false,
        obstructionClearanceVerified: false,
        hydraulicNodeAssigned: false,
        status: 'source-only-preliminary-candidate',
      };
      candidates.push(head);
    }

    roomsAudit.push({
      roomNumber: space.roomNumber,
      roomName: space.roomName,
      topologyZoneId: zone?.zoneId || null,
      topologyIdentityCount: zone?.roomNumbers?.length || 0,
      spatialHazardHitCount: spatialHits.length,
      exactNameHazardHitCount: exactHits.length,
      sourceHazardRoomId: sourceHazard?.roomId || null,
      ceilingStatus: space.ceiling?.status || 'blocked',
      slopedCeiling: space.ceiling?.sloped ?? null,
      candidateIds: candidates.filter((entry) => entry.roomNumber === space.roomNumber).map((entry) => entry.candidateId),
      status: reasons.length ? 'blocked' : 'source-only-preliminary-candidate',
      blockingReasons: reasons,
    });
  }

  const candidateRooms = roomsAudit.filter((entry) => entry.status === 'source-only-preliminary-candidate');
  const slopedRooms = roomsAudit.filter((entry) => entry.slopedCeiling === true);
  return {
    roomsAudit,
    candidates,
    counts: {
      sourceRoomIdentities: roomsAudit.length,
      candidateRooms: candidateRooms.length,
      candidateHeads: candidates.length,
      blockedRooms: roomsAudit.length - candidateRooms.length,
      slopedCeilingRooms: slopedRooms.length,
      slopedCeilingCandidateRooms: slopedRooms.filter((entry) => entry.status === 'source-only-preliminary-candidate').length,
    },
  };
}

export async function sealWinterGardenSourceSprinklerCandidates(draft) {
  const clean = structuredClone(draft);
  delete clean.receiptSha256;
  return { ...clean, receiptSha256: await sha256Hex(clean) };
}

export async function validateWinterGardenSourceSprinklerCandidates(value, { topology, registry, hazard, building } = {}) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.winter-garden-source-sprinkler-candidates.v1' || value.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('WG_SOURCE_CANDIDATE_SCHEMA_INVALID', 'Winter Garden source-only candidate identity is invalid.')], complianceReady: false };
  }
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_SOURCE_CANDIDATE_RECEIPT_MISMATCH', 'Source-only sprinkler candidates no longer match their immutable receipt.'));
  const expectedReceipts = {
    topology: topology?.receiptSha256, registry: registry?.receiptSha256,
    hazard: hazard?.receiptSha256, building: building?.receiptSha256,
  };
  if (Object.entries(expectedReceipts).some(([key, digest]) => !SHA.test(digest || '') || value.sourceReceipts?.[key] !== digest)) issues.push(issue('WG_SOURCE_CANDIDATE_UPSTREAM_DRIFT', 'All four current sealed source packets must be receipt-bound.'));
  const operational = validateHaloFireOperationalKnowledgeReceipt(value.operationalKnowledge);
  if (operational.status !== 'passed') issues.push(issue('WG_SOURCE_CANDIDATE_OPERATIONAL_KNOWLEDGE_MISSING', 'A passed Halo Fire full-lifecycle brain receipt must govern candidate generation.'));
  if (topology && registry && hazard && building) {
    const expected = buildWinterGardenSourceSprinklerCandidates({ topology, registry, hazard, building });
    if (JSON.stringify(value.roomsAudit) !== JSON.stringify(expected.roomsAudit) || JSON.stringify(value.candidates) !== JSON.stringify(expected.candidates)
      || JSON.stringify(value.counts) !== JSON.stringify(expected.counts)) issues.push(issue('WG_SOURCE_CANDIDATE_REPLAY_FAILED', 'Candidates do not replay deterministically from the four sealed source packets.'));
  }
  const counts = value.counts || {};
  if (counts.sourceRoomIdentities !== 54 || counts.candidateRooms !== 2 || counts.candidateHeads !== 2 || counts.blockedRooms !== 52
    || counts.slopedCeilingRooms !== 3 || counts.slopedCeilingCandidateRooms !== 0) issues.push(issue('WG_SOURCE_CANDIDATE_TALLY_DRIFT', 'Only FONT 120 and BISHOP 143 may currently emit one flat preliminary candidate each; all sloped rooms must remain blocked.'));
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  if (candidates.map((entry) => entry.roomNumber).join(',') !== '120,143'
    || candidates.some((entry) => entry.coverageVerified || entry.obstructionClearanceVerified || entry.hydraulicNodeAssigned || entry.ceiling?.kind !== 'flat-source-registered')) issues.push(issue('WG_SOURCE_CANDIDATE_PREMATURE_PROMOTION', 'Candidate scope or downstream verification flags were promoted without evidence.'));
  if (value.generation?.answerKeyUsed !== false || value.generation?.joinMethod !== 'unique-anchor-containment+exact-source-name+three-sheet-plan-intersection') issues.push(issue('WG_SOURCE_CANDIDATE_ANSWER_KEY_LEAKAGE', 'Generation must stay source-only and use the sealed spatial/name join.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed'
    || value.internalVerification?.adversarial?.status !== 'passed' || value.internalVerification?.adversarial?.rejectedCases?.length < 8) issues.push(issue('WG_SOURCE_CANDIDATE_INTERNAL_LOOPS_INCOMPLETE', 'Primary, independent, and adversarial candidate loops must all pass.'));
  if (value.partialCandidateGeometryGrounded !== true || value.wholeBuildingHeadLayoutReady !== false || value.pitchedRoofHeadLayoutReady !== false
    || value.hydraulicCalculationReady !== false || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('WG_SOURCE_CANDIDATE_FAIL_CLOSED_STATUS_DRIFT', 'Preliminary candidates cannot claim whole-building, pitched-roof, hydraulic, compliance, fabrication, or field readiness.'));
  return {
    status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : value,
    counts: value.counts || null, partialCandidateGeometryGrounded: issues.length === 0,
    wholeBuildingHeadLayoutReady: false, pitchedRoofHeadLayoutReady: false,
    hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
  };
}
