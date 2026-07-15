/**
 * Validate the Building J sanitized cross-discipline source topology packet.
 *
 * This module has no completed-plan dependency. It proves source identity,
 * receipt immutability, topology counts, registration quality, and fail-closed
 * downstream claims before the packet may influence a placement candidate.
 */

import { sha256Hex } from './elevation-datums.js';

const TYPE = 'halofire.mit-riverside-building-j-source-topology-inputs.v1';
const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT_NAME = 'MIT Riverside - Transportation Building J';
const SHA = /^[0-9a-f]{64}$/;
const SOURCE_BINDINGS = Object.freeze({
  architecturalBidSet: ['08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c', 116713715],
  floorDwg: ['4310609e80ef25af2abbb164a623de1fe749fb37b04d165699acc4fc4f6297e5', 6418563],
  floorDump: ['3213dba9a44b5266e55a019e44923f37301e403dc29bc0ed67773f5f0d6fa05b', 7974588],
  roofFramingDwg: ['94ee255614f7b403de5185622018eaaad8f80ebe253592418bc7e3b6d993c9aa', 701676],
  roofFramingDump: ['d181874ed4b57bbfed2b1daa7b6fde8e100fe8394d2ba3f89931677fb93fddce', 7858995],
});
const COUNTS = Object.freeze({
  rooms: 13,
  openToStructureLabels: 11,
  wallMaterialPolygons: 105,
  doorOpenings: 23,
  structuralBeamLines: 70,
  sourcePlacementAxes: 17,
  mechanicalEquipmentLabels: 12,
  mechanicalDuctSizeLabels: 9,
});
const FALSE_CLAIMS = Object.freeze([
  'exactMechanicalObstructionFootprintsReady',
  'exactStructuralMemberDepthsReady',
  'obstructionClearancesVerified',
  'sourceGeneratedPlacementVerified',
  'freshProjectPlacementVerified',
  'complianceReady',
  'hydraulicCalculationReady',
  'fabricationReady',
  'fieldReleaseReady',
]);
const issue = (code, message) => ({ severity: 'blocking', code, message });

function validPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}
function validPolygon(value) {
  return Array.isArray(value) && value.length >= 3 && value.every(validPoint);
}

/** Validate the immutable source topology and preserve all downstream blocks. */
export async function validateMitRiversideBuildingJSourceTopology(value) {
  const issues = [];
  if (value?.artifactType !== TYPE || value?.projectId !== PROJECT_ID || value?.projectName !== PROJECT_NAME) {
    issues.push(issue('MIT_J_SOURCE_TOPOLOGY_IDENTITY_INVALID', 'Source topology identity changed.'));
  }
  const { receiptSha256, ...draft } = value || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) {
    issues.push(issue('MIT_J_SOURCE_TOPOLOGY_RECEIPT_MISMATCH', 'Source topology no longer matches its canonical receipt.'));
  }
  for (const [role, [sha256, bytes]] of Object.entries(SOURCE_BINDINGS)) {
    if (value?.sources?.[role]?.sha256 !== sha256 || value?.sources?.[role]?.bytes !== bytes) {
      issues.push(issue('MIT_J_SOURCE_TOPOLOGY_SOURCE_BINDING_DRIFT', `${role} changed.`));
    }
  }
  for (const [key, expected] of Object.entries(COUNTS)) {
    if (value?.[key]?.length !== expected) issues.push(issue('MIT_J_SOURCE_TOPOLOGY_COUNT_DRIFT', `${key} changed.`));
  }
  const roomIds = value?.rooms?.map((entry) => entry.id) || [];
  if (new Set(roomIds).size !== COUNTS.rooms || value?.rooms?.some((entry) => !validPolygon(entry.structuralLocalVerticesFt))) {
    issues.push(issue('MIT_J_SOURCE_TOPOLOGY_ROOM_GEOMETRY_INVALID', 'Room identities or polygons are incomplete.'));
  }
  if (value?.openToStructureLabels?.some((entry) => !roomIds.includes(entry.roomId) || entry.roomAssignmentMethod !== 'source-zone-polygon-containment' || !validPoint(entry.structuralLocalFt))) {
    issues.push(issue('MIT_J_SOURCE_TOPOLOGY_OTS_ASSIGNMENT_INVALID', 'An O.T.S. label is not source-zone contained.'));
  }
  if (value?.mechanicalPlanRegistration?.inlierRoomIds?.length !== 10
    || value?.mechanicalPlanRegistration?.outlierRoomIds?.length !== 3
    || value?.mechanicalPlanRegistration?.maximumInlierRoomLabelResidualPt > 0.1) {
    issues.push(issue('MIT_J_SOURCE_TOPOLOGY_MECHANICAL_REGISTRATION_INVALID', 'M-101 registration quality changed.'));
  }
  if (value?.structuralBeamLines?.some((entry) => !validPoint(entry.startStructuralLocalFt) || !validPoint(entry.endStructuralLocalFt) || entry.exactMemberDepthReady !== false)) {
    issues.push(issue('MIT_J_SOURCE_TOPOLOGY_FRAMING_INVALID', 'Structural line geometry or member-depth boundary changed.'));
  }
  if (value?.mechanicalEquipmentLabels?.some((entry) => !validPoint(entry.structuralLocalFt) || entry.exactFootprintReady !== false)
    || value?.mechanicalDuctSizeLabels?.some((entry) => !validPoint(entry.structuralLocalFt) || entry.exactRunGeometryReady !== false)) {
    issues.push(issue('MIT_J_SOURCE_TOPOLOGY_MEP_FALSE_PRECISION', 'MEP label evidence was promoted to exact geometry.'));
  }
  if (value?.sequence?.answerArtifactRead !== false
    || value?.sequence?.completedLayoutRead !== false
    || value?.sequence?.approvedFireSprinklerPlanRead !== false
    || value?.sequence?.asBuiltFireSprinklerPlanRead !== false
    || value?.sequence?.freshProjectHoldoutRequired !== true) {
    issues.push(issue('MIT_J_SOURCE_TOPOLOGY_SEQUENCE_INVALID', 'Source isolation or holdout disclosure changed.'));
  }
  if (FALSE_CLAIMS.some((claim) => value?.claims?.[claim] !== false)) {
    issues.push(issue('MIT_J_SOURCE_TOPOLOGY_FALSE_PROMOTION', 'A source label inventory was promoted to downstream readiness.'));
  }
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    sourceTopologyReady: issues.length === 0,
    exactMechanicalObstructionFootprintsReady: false,
    obstructionClearancesVerified: false,
    complianceReady: false,
  };
}

/** Attack every source, topology, registration, precision, and readiness gate. */
export async function verifyMitRiversideBuildingJSourceTopologyAdversarialLoop(value) {
  const cases = [
    ['receipt', (entry) => { entry.receiptSha256 = '0'.repeat(64); }],
    ['architectural', (entry) => { entry.sources.architecturalBidSet.sha256 = '1'.repeat(64); }],
    ['floor-dwg', (entry) => { entry.sources.floorDwg.bytes -= 1; }],
    ['framing-dwg', (entry) => { entry.sources.roofFramingDwg.sha256 = '2'.repeat(64); }],
    ['room-remove', (entry) => { entry.rooms.pop(); }],
    ['room-polygon', (entry) => { entry.rooms[0].structuralLocalVerticesFt = []; }],
    ['ots-room', (entry) => { entry.openToStructureLabels[0].roomId = 'J999'; }],
    ['ots-method', (entry) => { entry.openToStructureLabels[0].roomAssignmentMethod = 'nearest'; }],
    ['door-remove', (entry) => { entry.doorOpenings.pop(); }],
    ['beam-remove', (entry) => { entry.structuralBeamLines.pop(); }],
    ['beam-depth', (entry) => { entry.structuralBeamLines[0].exactMemberDepthReady = true; }],
    ['mechanical-inliers', (entry) => { entry.mechanicalPlanRegistration.inlierRoomIds.pop(); }],
    ['mechanical-residual', (entry) => { entry.mechanicalPlanRegistration.maximumInlierRoomLabelResidualPt = 1; }],
    ['equipment-footprint', (entry) => { entry.mechanicalEquipmentLabels[0].exactFootprintReady = true; }],
    ['duct-run', (entry) => { entry.mechanicalDuctSizeLabels[0].exactRunGeometryReady = true; }],
    ['answer-open', (entry) => { entry.sequence.answerArtifactRead = true; }],
    ['completed-layout', (entry) => { entry.sequence.completedLayoutRead = true; }],
    ['clearance', (entry) => { entry.claims.obstructionClearancesVerified = true; }],
    ['compliance', (entry) => { entry.claims.complianceReady = true; }],
    ['release', (entry) => { entry.claims.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const attacked = structuredClone(value);
    mutate(attacked);
    if ((await validateMitRiversideBuildingJSourceTopology(attacked)).status === 'blocked') rejectedCases.push(id);
  }
  return {
    status: rejectedCases.length === cases.length ? 'passed' : 'blocked',
    attemptedCases: cases.length,
    rejectedCases,
    obstructionClearancesVerified: false,
    complianceReady: false,
  };
}
