import { sha256Hex } from './elevation-datums.js';
import { validateHaloFireOperationalKnowledgeReceipt } from './halofire-operational-knowledge.js';
import { pointInPolygon } from './sprinkler-layout.js';

const PROJECT = 'LDS Meeting House - Winter Garden FL';
const SHA = /^[0-9a-f]{64}$/;
const EXPECTED_SOURCES = Object.freeze({
  A101: '861626b3a6838ddd340d15e20c88c55d2d7896df7d8ef45276d518e4112040fb',
  A103: 'bca163d23e89b86332f670f6f234f5bc5319b1a1e461de28a3fb3124120c2f89',
  A151: '4a6c4b29eff18a8e964627ba41807f2f8119f8a2c8012d5900acf08e61ee8e43',
  A303: 'dae14221cd3b913d350e53d146c6dd1abfca8a3b6d3ca142916474ba18a66de7',
});
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function pointToSegmentDistance(point, segment) {
  const vx = segment.x2 - segment.x1;
  const vy = segment.y2 - segment.y1;
  const wx = point[0] - segment.x1;
  const wy = point[1] - segment.y1;
  const ratio = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(point[0] - (segment.x1 + ratio * vx), point[1] - (segment.y1 + ratio * vy));
}

/** Build a deterministic spatial index used only to verify boundary samples against source wall ink. */
export function buildSourceWallSupportIndex(segments, opts = {}) {
  const cellSizeFt = Number.isFinite(opts.cellSizeFt) ? Math.max(0.25, Number(opts.cellSizeFt)) : 2;
  const toleranceFt = Number.isFinite(opts.toleranceFt) ? Math.max(0, Number(opts.toleranceFt)) : 0.8;
  const buckets = new Map();
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (![segment?.x1, segment?.y1, segment?.x2, segment?.y2].every(Number.isFinite)) continue;
    const minX = Math.floor((Math.min(segment.x1, segment.x2) - toleranceFt) / cellSizeFt);
    const maxX = Math.floor((Math.max(segment.x1, segment.x2) + toleranceFt) / cellSizeFt);
    const minY = Math.floor((Math.min(segment.y1, segment.y2) - toleranceFt) / cellSizeFt);
    const maxY = Math.floor((Math.max(segment.y1, segment.y2) + toleranceFt) / cellSizeFt);
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      const key = `${x},${y}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(segment);
    }
  }
  return { cellSizeFt, toleranceFt, buckets };
}

/** Measure the fraction of equally spaced boundary samples backed by a source wall segment. */
export function measureSourceBoundarySupport(polygon, index, opts = {}) {
  const sampleStepFt = Number.isFinite(opts.sampleStepFt) ? Math.max(0.25, Number(opts.sampleStepFt)) : 1;
  if (!Array.isArray(polygon) || polygon.length < 4 || !index?.buckets) return { sampleCount: 0, supportedSamples: 0, supportRatio: 0 };
  let sampleCount = 0;
  let supportedSamples = 0;
  for (let edge = 0; edge < polygon.length; edge += 1) {
    const from = polygon[edge];
    const to = polygon[(edge + 1) % polygon.length];
    const lengthFt = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const edgeSamples = Math.max(1, Math.ceil(lengthFt / sampleStepFt));
    for (let sample = 0; sample < edgeSamples; sample += 1) {
      const ratio = (sample + 0.5) / edgeSamples;
      const point = [from[0] + ratio * (to[0] - from[0]), from[1] + ratio * (to[1] - from[1])];
      const key = `${Math.floor(point[0] / index.cellSizeFt)},${Math.floor(point[1] / index.cellSizeFt)}`;
      const candidates = index.buckets.get(key) || [];
      sampleCount += 1;
      if (candidates.some((segment) => pointToSegmentDistance(point, segment) <= index.toleranceFt)) supportedSamples += 1;
    }
  }
  return { sampleCount, supportedSamples, supportRatio: round(supportedSamples / Math.max(1, sampleCount)) };
}

function anchoredComponents(components, identities) {
  return (Array.isArray(components) ? components : []).map((component, componentIndex) => ({
    component,
    componentIndex,
    identities: identities.filter((identity) => pointInPolygon(identity.sourceAnchorFt, component.poly)),
  })).filter((entry) => entry.identities.length > 0);
}

function scoreCandidate(entry, sourceSheet, supportIndexes) {
  const support = Object.fromEntries(Object.entries(supportIndexes)
    .filter(([sheet]) => sheet !== sourceSheet)
    .map(([sheet, index]) => [sheet, measureSourceBoundarySupport(entry.component.poly, index)]));
  const ratios = Object.values(support).map((value) => value.supportRatio);
  return {
    sourceSheet,
    componentIndex: entry.componentIndex,
    polygon: entry.component.poly,
    areaSqft: round(entry.component.areaSqft, 4),
    support,
    maximumIndependentSupport: round(Math.max(0, ...ratios)),
    minimumIndependentSupport: round(Math.min(...ratios)),
  };
}

/**
 * Build source protection envelopes without treating furniture/court fragments as rooms.
 * A103 owns the primary topology. A101/A151 wall ink is verifier-only. Missing anchors may
 * use a source fallback, but section-confirmed fallbacks remain explicitly limited.
 */
export function buildWinterGardenSourceSpaceTopology({ identities, a103Components, a101Components, a151Components, supportIndexes, sectionEvidence }) {
  const sourceIdentities = Array.isArray(identities) ? identities : [];
  const primary = anchoredComponents(a103Components, sourceIdentities);
  const a101 = anchoredComponents(a101Components, sourceIdentities);
  const a151 = anchoredComponents(a151Components, sourceIdentities);
  const zones = [];
  const assigned = new Set();

  for (const entry of primary) {
    const candidate = scoreCandidate(entry, 'A103', supportIndexes);
    if (candidate.maximumIndependentSupport < 2 / 3) continue;
    const roomNumbers = entry.identities.map((identity) => identity.roomNumber).sort((left, right) => Number(left) - Number(right));
    roomNumbers.forEach((number) => assigned.add(number));
    zones.push({
      zoneId: `wg-zone-${String(zones.length + 1).padStart(3, '0')}`,
      roomNumbers,
      roomNames: entry.identities.map((identity) => identity.roomName),
      geometry: candidate,
      consensusTier: 'a103-primary-independent-supermajority',
      boundaryStatus: 'source-consensus-envelope',
      topologyReady: true,
      sprinklerCandidateReady: false,
    });
  }

  for (const identity of sourceIdentities.filter((entry) => !assigned.has(entry.roomNumber))) {
    const candidates = [
      ...a101.filter((entry) => entry.identities.length === 1 && entry.identities[0].roomNumber === identity.roomNumber).map((entry) => scoreCandidate(entry, 'A101', supportIndexes)),
      ...a151.filter((entry) => entry.identities.length === 1 && entry.identities[0].roomNumber === identity.roomNumber).map((entry) => scoreCandidate(entry, 'A151', supportIndexes)),
    ].sort((left, right) => right.maximumIndependentSupport - left.maximumIndependentSupport || right.minimumIndependentSupport - left.minimumIndependentSupport || left.sourceSheet.localeCompare(right.sourceSheet));
    const candidate = candidates[0] || null;
    if (!candidate) continue;
    let consensusTier = null;
    let boundaryStatus = 'blocked';
    let topologyReady = false;
    if (candidate.maximumIndependentSupport >= 2 / 3) {
      consensusTier = 'fallback-independent-supermajority';
      boundaryStatus = 'source-consensus-envelope';
      topologyReady = true;
    } else if (candidate.minimumIndependentSupport >= 0.5) {
      consensusTier = 'fallback-two-sheet-majority';
      boundaryStatus = 'source-consensus-envelope';
      topologyReady = true;
    } else if (sectionEvidence?.roomNumbers?.includes(identity.roomNumber)) {
      consensusTier = 'section-confirmed-plan-boundary-limited';
      boundaryStatus = 'section-confirmed-plan-boundary-limited';
    }
    if (!consensusTier) continue;
    assigned.add(identity.roomNumber);
    zones.push({
      zoneId: `wg-zone-${String(zones.length + 1).padStart(3, '0')}`,
      roomNumbers: [identity.roomNumber],
      roomNames: [identity.roomName],
      geometry: candidate,
      consensusTier,
      boundaryStatus,
      topologyReady,
      sprinklerCandidateReady: false,
      sectionEvidence: topologyReady ? null : sectionEvidence,
    });
  }

  const topologyReadyNumbers = new Set(zones.filter((zone) => zone.topologyReady).flatMap((zone) => zone.roomNumbers));
  return {
    zones,
    counts: {
      sourceRoomIdentities: sourceIdentities.length,
      sourceProtectionZones: zones.length,
      assignedRoomIdentities: assigned.size,
      topologyReadyRoomIdentities: topologyReadyNumbers.size,
      topologyBlockedRoomIdentities: sourceIdentities.length - topologyReadyNumbers.size,
      multiIdentityOpenZones: zones.filter((zone) => zone.roomNumbers.length > 1).length,
      sectionLimitedZones: zones.filter((zone) => zone.consensusTier === 'section-confirmed-plan-boundary-limited').length,
      sprinklerCandidateReadyRooms: 0,
    },
    unresolvedRoomNumbers: sourceIdentities.filter((identity) => !topologyReadyNumbers.has(identity.roomNumber)).map((identity) => identity.roomNumber),
  };
}

export async function sealWinterGardenSourceSpaceTopology(draft) {
  const clean = structuredClone(draft);
  delete clean.receiptSha256;
  return { ...clean, receiptSha256: await sha256Hex(clean) };
}

export async function validateWinterGardenSourceSpaceTopology(value) {
  const issues = [];
  if (!value || value.artifactType !== 'halofire.winter-garden-source-space-topology.v1' || value.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('WG_SOURCE_TOPOLOGY_SCHEMA_INVALID', 'Winter Garden source-space topology identity is invalid.')], wholeBuildingTopologyComplete: false };
  }
  const { receiptSha256, ...draft } = value;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_SOURCE_TOPOLOGY_RECEIPT_MISMATCH', 'Source-space topology no longer matches its immutable receipt.'));
  const bindings = new Map((Array.isArray(value.sourceBindings) ? value.sourceBindings : []).map((entry) => [entry.sheet, entry.sha256]));
  if (Object.entries(EXPECTED_SOURCES).some(([sheet, digest]) => bindings.get(sheet) !== digest)) issues.push(issue('WG_SOURCE_TOPOLOGY_SOURCE_DRIFT', 'A101/A103/A151/A303 source bindings are missing or changed.'));
  if (!SHA.test(value.sourceRegistryReceiptSha256 || '')) issues.push(issue('WG_SOURCE_TOPOLOGY_UPSTREAM_RECEIPT_MISSING', 'The sealed source identity registry receipt is required.'));
  const operational = validateHaloFireOperationalKnowledgeReceipt(value.operationalKnowledge);
  if (operational.status !== 'passed') issues.push(issue('WG_SOURCE_TOPOLOGY_OPERATIONAL_KNOWLEDGE_MISSING', 'A passed Halo Fire full-lifecycle brain receipt must govern topology.'));
  const zones = Array.isArray(value.zones) ? value.zones : [];
  const numbers = zones.flatMap((zone) => zone.roomNumbers || []);
  const unique = new Set(numbers);
  if (zones.length !== 45 || numbers.length !== 54 || unique.size !== 54) issues.push(issue('WG_SOURCE_TOPOLOGY_ASSIGNMENT_DRIFT', 'Exactly 45 source protection envelopes must assign all 54 room identities once.'));
  if (zones.some((zone) => !Array.isArray(zone.geometry?.polygon) || zone.geometry.polygon.length < 4 || zone.geometry.areaSqft <= 0)) issues.push(issue('WG_SOURCE_TOPOLOGY_GEOMETRY_INVALID', 'Every protection envelope requires a non-degenerate source polygon.'));
  const primary = zones.filter((zone) => zone.consensusTier === 'a103-primary-independent-supermajority');
  if (primary.length !== 42 || primary.some((zone) => zone.geometry.sourceSheet !== 'A103' || zone.geometry.maximumIndependentSupport < 2 / 3 || !zone.topologyReady)) issues.push(issue('WG_SOURCE_TOPOLOGY_PRIMARY_CONSENSUS_DRIFT', 'The 42 A103 primary envelopes must retain independent two-thirds wall support.'));
  const limited = zones.filter((zone) => zone.consensusTier === 'section-confirmed-plan-boundary-limited');
  if (limited.length !== 1 || limited[0]?.roomNumbers?.[0] !== '146' || limited[0]?.topologyReady !== false || !limited[0]?.sectionEvidence?.roomNumbers?.includes('146')) issues.push(issue('WG_SOURCE_TOPOLOGY_SECTION_LIMIT_DRIFT', 'Organ speaker chamber 146 must remain the one section-confirmed, plan-boundary-limited residual.'));
  if (value.counts?.sourceRoomIdentities !== 54 || value.counts?.sourceProtectionZones !== 45 || value.counts?.assignedRoomIdentities !== 54
    || value.counts?.topologyReadyRoomIdentities !== 53 || value.counts?.topologyBlockedRoomIdentities !== 1 || value.counts?.sprinklerCandidateReadyRooms !== 0) issues.push(issue('WG_SOURCE_TOPOLOGY_COUNT_DRIFT', 'Topology must retain 54 assigned identities, 53 topology-ready identities, one residual, and zero sprinkler-ready rooms.'));
  if (value.generation?.answerKeyUsed !== false || value.generation?.oldRoomLabelsUsed !== false || value.generation?.registrationMethod !== 'labeled-piecewise-grid') issues.push(issue('WG_SOURCE_TOPOLOGY_ANSWER_KEY_LEAKAGE', 'Topology must be source-only and piecewise-grid registered.'));
  if (value.internalVerification?.primary?.status !== 'passed' || value.internalVerification?.independent?.status !== 'passed' || value.internalVerification?.adversarial?.status !== 'passed') issues.push(issue('WG_SOURCE_TOPOLOGY_INTERNAL_LOOPS_INCOMPLETE', 'Primary, independent, and adversarial topology loops must pass.'));
  if (value.identityZoneAssignmentComplete !== true || value.wholeBuildingTopologyComplete !== false || value.wholeBuildingHeadLayoutReady !== false
    || value.complianceReady !== false || value.fabricationReady !== false || value.fieldReleaseReady !== false) issues.push(issue('WG_SOURCE_TOPOLOGY_FAIL_CLOSED_STATUS_DRIFT', 'One limited plan boundary keeps whole-building layout and downstream claims fail-closed.'));
  return {
    status: issues.length ? 'blocked' : 'passed',
    issues,
    packet: issues.length ? null : value,
    counts: value.counts || null,
    identityZoneAssignmentComplete: issues.length === 0,
    wholeBuildingTopologyComplete: false,
    wholeBuildingHeadLayoutReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
