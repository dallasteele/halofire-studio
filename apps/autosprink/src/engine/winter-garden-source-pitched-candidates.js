import { sha256Hex } from './elevation-datums.js';
import { validateHaloFireOperationalKnowledgeReceipt } from './halofire-operational-knowledge.js';
import { pointInPolygon } from './sprinkler-layout.js';
import { sourceSlopedCeilingElevationFt, validateWinterGardenSourceSlopedCeiling } from './winter-garden-source-sloped-ceiling.js';

const PROJECT = 'LDS Meeting House - Winter Garden FL';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

function polygonBounds(polygon) {
  return { minX: Math.min(...polygon.map((point) => point[0])), minY: Math.min(...polygon.map((point) => point[1])), maxX: Math.max(...polygon.map((point) => point[0])), maxY: Math.max(...polygon.map((point) => point[1])) };
}

function intersectionCandidate(polygons, fallback) {
  const boxes = polygons.map(polygonBounds);
  const overlap = { minX: Math.max(...boxes.map((box) => box.minX)), minY: Math.max(...boxes.map((box) => box.minY)), maxX: Math.min(...boxes.map((box) => box.maxX)), maxY: Math.min(...boxes.map((box) => box.maxY)) };
  const inside = (point) => polygons.every((polygon) => pointInPolygon(point, polygon));
  const center = [(overlap.minX + overlap.maxX) / 2, (overlap.minY + overlap.maxY) / 2];
  if (overlap.minX <= overlap.maxX && overlap.minY <= overlap.maxY && inside(center)) return center.map((value) => round(value));
  for (let row = 0; row < 24; row += 1) for (let column = 0; column < 24; column += 1) {
    const point = [overlap.minX + ((column + 0.5) / 24) * (overlap.maxX - overlap.minX), overlap.minY + ((row + 0.5) / 24) * (overlap.maxY - overlap.minY)];
    if (inside(point)) return point.map((value) => round(value));
  }
  return inside(fallback) ? fallback.map((value) => round(value)) : null;
}

function profileBand(profile, yFt) {
  if (yFt < profile.plateauSouthYFt) return 'south-slope';
  if (yFt <= profile.plateauNorthYFt) return 'ridge-flat';
  return 'north-slope';
}

export function buildWinterGardenSourcePitchedCandidates({ topology, registry, hazard, ceiling }) {
  const roomsAudit = []; const candidates = [];
  for (const space of registry.spaces.filter((entry) => entry.ceiling?.sloped === true)) {
    const zone = topology.zones.find((entry) => entry.roomNumbers?.includes(space.roomNumber)) || null;
    const sourceHazards = hazard.zoning.zones.filter((entry) => normalize(entry.sourceLabel) === normalize(space.roomName) && entry.status === 'source-classified');
    const surfaces = ceiling.surfaces.filter((surface) => surface.roomNumber === space.roomNumber);
    const finishTypes = [...new Set(surfaces.map((surface) => surface.finishType))];
    const finish = ceiling.finishes.find((entry) => entry.finishType === finishTypes[0]);
    const reasons = [];
    if (!zone?.topologyReady) reasons.push('source-topology-envelope-not-ready');
    if (zone?.roomNumbers?.length !== 1) reasons.push('multi-identity-protection-envelope-not-partitioned');
    if (space.geometry?.status !== 'source-anchor-component' || !Array.isArray(space.geometry?.polygon)) reasons.push('source-room-component-missing');
    if (!surfaces.length || finishTypes.length !== 1 || !finish) reasons.push('source-sloped-ceiling-surface-not-ready');
    if (sourceHazards.length !== 1) reasons.push('unique-source-hazard-name-join-failed');
    let pointFt = null;
    if (!reasons.length) {
      pointFt = intersectionCandidate([zone.geometry.polygon, space.geometry.polygon], space.sourceAnchorFt);
      if (!pointFt) reasons.push('two-sheet-protection-intersection-empty');
    }
    if (!reasons.length) {
      const ceilingElevationFt = sourceSlopedCeilingElevationFt(ceiling.profile, finish, pointFt[1]);
      if (!Number.isFinite(ceilingElevationFt)) reasons.push('candidate-outside-source-ceiling-profile-domain');
      else {
        const sourceHazard = sourceHazards[0];
        candidates.push({
          candidateId: `wg-source-pitched-head-${space.roomNumber}-001`, roomNumber: space.roomNumber, roomName: space.roomName,
          topologyZoneId: zone.zoneId, sourceHazardRoomId: sourceHazard.roomId,
          hazardClass: sourceHazard.hazardClass, hazardRuleId: sourceHazard.hazardRuleId,
          maxCoverageSqftPerHead: sourceHazard.maxCoverageSqftPerHead,
          planPointFt: pointFt, modelPointFt: [pointFt[0], pointFt[1], ceilingElevationFt],
          ceiling: { kind: 'source-sloped-finish-envelope', finishType: finish.finishType, profileBand: profileBand(ceiling.profile, pointFt[1]), elevationFt: ceilingElevationFt, pitchRiseInPer12: ceiling.profile.pitchRiseIn, sourceReceiptSha256: ceiling.receiptSha256 },
          remoteAreaAdjustmentCandidate: { thresholdRiseInPer12: 2, sourceCeilingExceedsThreshold: ceiling.profile.pitchRiseIn > 2, adjustedRemoteAreaSqft: sourceHazard.ceilingSlopeApplication?.adjustedRemoteAreaCandidateSqft || null, verified: false },
          sourceSheets: ['A101', 'A103', 'A151', 'A301', 'A303', 'WG Specs'],
          sourceBoundaryComplete: false, coverageVerified: false, wallDistanceVerified: false, obstructionClearanceVerified: false,
          hydraulicNodeAssigned: false, complianceReady: false, status: 'source-only-preliminary-pitched-candidate',
        });
      }
    }
    roomsAudit.push({
      roomNumber: space.roomNumber, roomName: space.roomName, topologyZoneId: zone?.zoneId || null, topologyIdentityCount: zone?.roomNumbers?.length || 0,
      uniqueSourceHazardNameHits: sourceHazards.length, finishTypes, surfaceCount: surfaces.length,
      candidateIds: candidates.filter((candidate) => candidate.roomNumber === space.roomNumber).map((candidate) => candidate.candidateId),
      status: reasons.length ? 'blocked' : 'source-only-preliminary-pitched-candidate', blockingReasons: reasons,
    });
  }
  return { roomsAudit, candidates, counts: { slopedCeilingRooms: roomsAudit.length, pitchedCandidateRooms: roomsAudit.filter((room) => room.status === 'source-only-preliminary-pitched-candidate').length, pitchedCandidateHeads: candidates.length, blockedSlopedRooms: roomsAudit.filter((room) => room.status === 'blocked').length } };
}

export async function sealWinterGardenSourcePitchedCandidates(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateWinterGardenSourcePitchedCandidates(value, dependencies = {}) {
  const { topology, registry, hazard, ceiling, building } = dependencies; const issues = [];
  if (!value || value.artifactType !== 'halofire.winter-garden-source-pitched-candidates.v1' || value.projectName !== PROJECT) return { status: 'blocked', issues: [issue('WG_SOURCE_PITCHED_CANDIDATE_SCHEMA_INVALID', 'Source pitched candidate identity is invalid.')], complianceReady: false };
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_RECEIPT_MISMATCH', 'Source pitched candidates no longer match their immutable receipt.'));
  const expectedReceipts = { topology: topology?.receiptSha256, registry: registry?.receiptSha256, hazard: hazard?.receiptSha256, ceiling: ceiling?.receiptSha256, building: building?.receiptSha256 };
  if (Object.entries(expectedReceipts).some(([key, digest]) => !SHA.test(digest || '') || value.sourceReceipts?.[key] !== digest)) issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_UPSTREAM_DRIFT', 'All five current sealed source packets must be receipt-bound.'));
  const ceilingValidation = await validateWinterGardenSourceSlopedCeiling(ceiling, { registry, building });
  if (ceilingValidation.status !== 'passed') issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_CEILING_BLOCKED', 'The source-only sloped ceiling packet must pass before pitched candidates can exist.'));
  if (validateHaloFireOperationalKnowledgeReceipt(value.operationalKnowledge).status !== 'passed') issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_OPERATIONAL_KNOWLEDGE_MISSING', 'A passed Halo Fire operations receipt must govern pitched candidate generation.'));
  if (topology && registry && hazard && ceiling) {
    const expected = buildWinterGardenSourcePitchedCandidates({ topology, registry, hazard, ceiling });
    if (JSON.stringify(value.roomsAudit) !== JSON.stringify(expected.roomsAudit) || JSON.stringify(value.candidates) !== JSON.stringify(expected.candidates) || JSON.stringify(value.counts) !== JSON.stringify(expected.counts)) issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_REPLAY_FAILED', 'Pitched candidates do not replay deterministically from sealed source packets.'));
  }
  if (value.counts?.slopedCeilingRooms !== 3 || value.counts?.pitchedCandidateRooms !== 1 || value.counts?.pitchedCandidateHeads !== 1 || value.counts?.blockedSlopedRooms !== 2 || value.candidates?.[0]?.roomNumber !== '149') issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_TALLY_DRIFT', 'Only single-identity OVERFLOW 149 may emit one preliminary pitched candidate.'));
  const candidate = value.candidates?.[0];
  if (!candidate || candidate.ceiling?.pitchRiseInPer12 < 2.99 || candidate.ceiling?.pitchRiseInPer12 > 3.01 || candidate.ceiling?.finishType !== 'C3' || candidate.remoteAreaAdjustmentCandidate?.sourceCeilingExceedsThreshold !== true || candidate.remoteAreaAdjustmentCandidate?.verified !== false || candidate.coverageVerified || candidate.wallDistanceVerified || candidate.obstructionClearanceVerified || candidate.hydraulicNodeAssigned || candidate.complianceReady) issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_PREMATURE_PROMOTION', 'The one 3:12 C3 candidate must retain all coverage, obstruction, hydraulic, and compliance blockers.'));
  if (value.generation?.answerKeyUsed !== false || value.generation?.completedBidUsedForGeneration !== false || value.generation?.roofPlaneUsedAsCeiling !== false || value.generation?.joinMethod !== 'single-identity-A103-envelope+A101-room-component+unique-source-hazard-name+A151-A301-A303-ceiling') issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_ANSWER_KEY_OR_ROOF_LEAKAGE', 'Generation must remain source-only and must not use the roof plane as the ceiling.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed' || value.internalVerification?.adversarial?.status !== 'passed' || value.internalVerification?.adversarial?.rejectedCases?.length < 8) issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_LOOPS_INCOMPLETE', 'Primary, independent, and adversarial pitched-candidate loops must all pass.'));
  if (value.partialPitchedCandidateGeometryGrounded !== true || value.wholeBuildingHeadLayoutReady !== false || value.pitchedRoofHeadLayoutReady !== false || value.hydraulicCalculationReady !== false || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('WG_SOURCE_PITCHED_CANDIDATE_FAIL_CLOSED_STATUS_DRIFT', 'A preliminary pitched candidate cannot claim whole-building, hydraulic, compliance, fabrication, or field readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : value, counts: value.counts, partialPitchedCandidateGeometryGrounded: !issues.length, pitchedRoofHeadLayoutReady: false, complianceReady: false };
}
