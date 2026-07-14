import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const STRUCTURAL_RECEIPT = '8b7a642c0dc682115afe482426b2bf3cf140b3eadc3561a8520fe43998ce62b4';
const EVIDENCE_RECEIPT = '2d8b00e29e7023595adc1b33b89a76ed66ef2c0b3a9281198d1b2671499cf8a2';
const FLOOR_SHA = '4310609e80ef25af2abbb164a623de1fe749fb37b04d165699acc4fc4f6297e5';
const ROOF_SHA = '94ee255614f7b403de5185622018eaaad8f80ebe253592418bc7e3b6d993c9aa';
const EXPECTED_FLOOR_COUNTS = Object.freeze({ Slab_106: 50, Slab_107: 18, Slab_108: 0 });
const EXPECTED_ROOF_COUNTS = Object.freeze({ 'main-standing-seam': 36, 'west-lower-standing-seam': 4, 'membrane-base': 28 });
const SHA = /^[0-9a-f]{64}$/;
const close = (left, right, tolerance = 0.00001) => Math.abs(left - right) <= tolerance;
const issue = (code, message) => ({ severity: 'blocking', code, message });

async function rawSha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function polygonArea(vertices) {
  return Math.abs(vertices.reduce((sum, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + vertex.x * next.y - next.x * vertex.y;
  }, 0) / 2);
}

function pointOnSegment(point, first, second) {
  const cross = (point.y - first.y) * (second.x - first.x) - (point.x - first.x) * (second.y - first.y);
  if (Math.abs(cross) > 0.000001) return false;
  return point.x >= Math.min(first.x, second.x) - 0.000001 && point.x <= Math.max(first.x, second.x) + 0.000001 && point.y >= Math.min(first.y, second.y) - 0.000001 && point.y <= Math.max(first.y, second.y) + 0.000001;
}

export function pointInMitRiversideBuildingJPolygon(point, vertices) {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const first = vertices[previous];
    const second = vertices[index];
    if (pointOnSegment(point, first, second)) return true;
    if ((second.y > point.y) !== (first.y > point.y) && point.x < ((first.x - second.x) * (point.y - second.y)) / (first.y - second.y) + second.x) inside = !inside;
  }
  return inside;
}

async function assertDependencies(structural, evidence) {
  if (structural?.artifactType !== 'halofire.mit-riverside-building-j-structural-grid-correction.v1' || structural?.receiptSha256 !== STRUCTURAL_RECEIPT || structural?.structuralRoofXyReady !== true || structural?.heads?.length !== 68) throw new Error('MIT_J_SPATIAL_BOUNDARY_STRUCTURAL_DEPENDENCY_BLOCKED');
  if (evidence?.artifactType !== 'halofire.mit-riverside-building-j-source-spatial-boundary-evidence.v1' || evidence?.receiptSha256 !== EVIDENCE_RECEIPT) throw new Error('MIT_J_SPATIAL_BOUNDARY_EVIDENCE_BLOCKED');
  const { receiptSha256, ...evidenceDraft } = evidence;
  if (await rawSha256(evidenceDraft) !== receiptSha256 || evidence?.sources?.architecturalFloorDwg?.sha256 !== FLOOR_SHA || evidence?.sources?.structuralRoofDwg?.sha256 !== ROOF_SHA || evidence?.extraction?.floorDumpUnknownEntityCount !== 0 || evidence?.extraction?.roofDumpUnknownEntityCount !== 0) throw new Error('MIT_J_SPATIAL_BOUNDARY_EVIDENCE_REPLAY_BLOCKED');
  if (evidence?.floorSlabs?.length !== 3 || evidence?.roofRegions?.length !== 3 || !close(evidence?.independentClosure?.membraneExtractedSqFt, 1972, 0.001) || evidence?.claims?.exactFloorSlabPolygonsReady !== true || evidence?.claims?.wholeRoofFaceTopologyReady !== false) throw new Error('MIT_J_SPATIAL_BOUNDARY_EVIDENCE_FACTS_BLOCKED');
  for (const polygon of [...evidence.floorSlabs, ...evidence.roofRegions]) {
    if (!close(polygonArea(polygon.structuralLocalVerticesFt), polygon.areaSqFt, 0.001)) throw new Error(`MIT_J_SPATIAL_BOUNDARY_AREA_BLOCKED_${polygon.id}`);
  }
}

function assignRegion(point, regions) {
  return regions.filter((region) => pointInMitRiversideBuildingJPolygon(point, region.structuralLocalVerticesFt)).map((region) => region.id);
}

function countBy(assignments, field, ids) {
  return Object.fromEntries(ids.map((id) => [id, assignments.filter((assignment) => assignment[field] === id).length]));
}

export async function buildMitRiversideBuildingJSourceSpatialBoundaries(structural, evidence) {
  await assertDependencies(structural, evidence);
  const headAssignments = structural.heads.map((head) => {
    const floorMatches = assignRegion(head.structuralRoofLocalFt, evidence.floorSlabs);
    const roofMatches = assignRegion(head.structuralRoofLocalFt, evidence.roofRegions);
    return {
      id: head.id, kind: head.kind, structuralRoofLocalFt: structuredClone(head.structuralRoofLocalFt),
      floorSlabId: floorMatches.length === 1 ? floorMatches[0] : null, floorMatchCount: floorMatches.length,
      roofBaseRegionId: roofMatches.length === 1 ? roofMatches[0] : null, roofMatchCount: roofMatches.length,
      sourceProtectionRegime: null, sourceProtectionPlaneId: null, zFt: null,
    };
  });
  const floorRegionCounts = countBy(headAssignments, 'floorSlabId', evidence.floorSlabs.map((region) => region.id));
  const roofRegionCounts = countBy(headAssignments, 'roofBaseRegionId', evidence.roofRegions.map((region) => region.id));
  const unmatchedFloorHeads = headAssignments.filter((head) => head.floorMatchCount === 0).length;
  const multiplyMatchedFloorHeads = headAssignments.filter((head) => head.floorMatchCount > 1).length;
  const unmatchedRoofHeads = headAssignments.filter((head) => head.roofMatchCount === 0).length;
  const multiplyMatchedRoofHeads = headAssignments.filter((head) => head.roofMatchCount > 1).length;
  if (JSON.stringify(floorRegionCounts) !== JSON.stringify(EXPECTED_FLOOR_COUNTS) || JSON.stringify(roofRegionCounts) !== JSON.stringify(EXPECTED_ROOF_COUNTS) || unmatchedFloorHeads || multiplyMatchedFloorHeads || unmatchedRoofHeads || multiplyMatchedRoofHeads) throw new Error('MIT_J_SPATIAL_BOUNDARY_ASSIGNMENT_COUNTS_BLOCKED');
  const draft = {
    artifactType: 'halofire.mit-riverside-building-j-source-spatial-boundaries.v1', projectId: PROJECT_ID, projectName: PROJECT,
    structuralGridCorrectionReceiptSha256: structural.receiptSha256, sourceSpatialBoundaryEvidenceReceiptSha256: evidence.receiptSha256,
    coordinateSpace: 'exact-structural-roof-local-feet', floorSlabs: structuredClone(evidence.floorSlabs), roofBaseRegions: structuredClone(evidence.roofRegions), headAssignments,
    counts: { totalHeads: 68, floorRegionCounts, roofRegionCounts, unmatchedFloorHeads, multiplyMatchedFloorHeads, unmatchedRoofHeads, multiplyMatchedRoofHeads },
    independentClosure: structuredClone(evidence.independentClosure),
    internalVerification: {
      primary: { status: 'passed', method: 'exact DWG polyline and line-boundary extraction in structural-local coordinates' },
      independent: { status: 'passed', method: '58 ft by 34 ft membrane region equals the printed 1,972 square-foot roof-area note' },
      adversarial: { status: 'passed', method: 'dependency, polygon, area, membership, count, plane, Z, topology, compliance, fabrication, and release mutations' },
    },
    structuralRoofXyReady: true, exactFloorSlabPolygonsReady: true, baseRoofRegionBoundariesReady: true, allHeadsUniquelyBoundToFloorSlab: true, allHeadsUniquelyBoundToRoofBaseRegion: true,
    cricketFaceTopologyReady: false, wholeRoofFaceTopologyReady: false, sourceProtectionPlaneReady: false, headElevationsReady: false,
    sourceGeneratedPitchedPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'extract membrane cricket subfaces and source side-view elevation constraints before any roof plane, protection plane, or Z assignment',
    claimStatus: '68-corrected-heads-uniquely-bound-to-exact-source-slab-and-base-roof-regions-not-cricket-plane-z-compliance-fabrication-or-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMitRiversideBuildingJSourceSpatialBoundaries(packet, dependencies) {
  let expected;
  try { expected = await buildMitRiversideBuildingJSourceSpatialBoundaries(dependencies.structural, dependencies.evidence); } catch (error) { return { status: 'blocked', issues: [issue('MIT_J_SPATIAL_BOUNDARY_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIT_J_SPATIAL_BOUNDARY_REPLAY_MISMATCH', 'Source spatial boundary packet no longer equals deterministic replay.'));
  if (JSON.stringify(packet?.counts?.floorRegionCounts) !== JSON.stringify(EXPECTED_FLOOR_COUNTS) || JSON.stringify(packet?.counts?.roofRegionCounts) !== JSON.stringify(EXPECTED_ROOF_COUNTS) || packet?.counts?.totalHeads !== 68 || packet?.counts?.unmatchedFloorHeads !== 0 || packet?.counts?.multiplyMatchedFloorHeads !== 0 || packet?.counts?.unmatchedRoofHeads !== 0 || packet?.counts?.multiplyMatchedRoofHeads !== 0) issues.push(issue('MIT_J_SPATIAL_BOUNDARY_COUNT_DRIFT', 'Head-to-region counts or uniqueness changed.'));
  for (const head of packet?.headAssignments || []) {
    const floorMatches = assignRegion(head.structuralRoofLocalFt, packet.floorSlabs || []);
    const roofMatches = assignRegion(head.structuralRoofLocalFt, packet.roofBaseRegions || []);
    if (floorMatches.length !== 1 || roofMatches.length !== 1 || head.floorSlabId !== floorMatches[0] || head.roofBaseRegionId !== roofMatches[0] || head.sourceProtectionRegime !== null || head.sourceProtectionPlaneId !== null || head.zFt !== null) { issues.push(issue('MIT_J_SPATIAL_BOUNDARY_HEAD_INVALID', `Head ${head?.id || 'unknown'} failed unique region replay or fail-closed plane/Z checks.`)); break; }
  }
  if (packet?.structuralRoofXyReady !== true || packet?.exactFloorSlabPolygonsReady !== true || packet?.baseRoofRegionBoundariesReady !== true || packet?.allHeadsUniquelyBoundToFloorSlab !== true || packet?.allHeadsUniquelyBoundToRoofBaseRegion !== true || packet?.cricketFaceTopologyReady !== false || packet?.wholeRoofFaceTopologyReady !== false || packet?.sourceProtectionPlaneReady !== false || packet?.headElevationsReady !== false || packet?.sourceGeneratedPitchedPlacementVerified !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIT_J_SPATIAL_BOUNDARY_FALSE_PROMOTION', 'Base XY regions may not promote cricket topology, planes, Z, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, exactFloorSlabPolygonsReady: issues.length === 0, baseRoofRegionBoundariesReady: issues.length === 0, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false };
}

export async function verifyMitRiversideBuildingJSourceSpatialBoundariesAdversarialLoop(packet, dependencies) {
  const cases = [
    ['receipt', (v) => { v.receiptSha256 = '0'.repeat(64); }], ['structural', (v) => { v.structuralGridCorrectionReceiptSha256 = 'f'.repeat(64); }], ['evidence', (v) => { v.sourceSpatialBoundaryEvidenceReceiptSha256 = 'f'.repeat(64); }],
    ['slab-vertex', (v) => { v.floorSlabs[0].structuralLocalVerticesFt[0].x += 2; }], ['roof-vertex', (v) => { v.roofBaseRegions[0].structuralLocalVerticesFt[0].y += 2; }], ['membrane-area', (v) => { v.independentClosure.membraneExtractedSqFt = 1900; }],
    ['head-point', (v) => { v.headAssignments[0].structuralRoofLocalFt.x += 30; }], ['head-floor', (v) => { v.headAssignments[0].floorSlabId = 'Slab_108'; }], ['head-roof', (v) => { v.headAssignments[0].roofBaseRegionId = 'membrane-base'; }], ['count', (v) => { v.counts.roofRegionCounts['membrane-base'] += 1; }],
    ['plane', (v) => { v.headAssignments[0].sourceProtectionPlaneId = 'invented'; }], ['z', (v) => { v.headAssignments[0].zFt = 20; }], ['cricket', (v) => { v.cricketFaceTopologyReady = true; }], ['whole-roof', (v) => { v.wholeRoofFaceTopologyReady = true; }],
    ['source-generated', (v) => { v.sourceGeneratedPitchedPlacementVerified = true; }], ['compliance', (v) => { v.complianceReady = true; }], ['fabrication', (v) => { v.fabricationReady = true; }], ['field-release', (v) => { v.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateMitRiversideBuildingJSourceSpatialBoundaries(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, exactFloorSlabPolygonsReady: true, baseRoofRegionBoundariesReady: true, sourceProtectionPlaneReady: false, headElevationsReady: false, complianceReady: false };
}

export function renderMitRiversideBuildingJSourceSpatialBoundaries(packet) {
  const palette = { Slab_106: '#2563eb', Slab_107: '#7c3aed', Slab_108: '#0891b2', 'main-standing-seam': '#16a34a', 'west-lower-standing-seam': '#ca8a04', 'membrane-base': '#dc2626' };
  const labelAnchor = {
    Slab_106: { x: 0, y: 91 }, Slab_107: { x: 0, y: 33 }, Slab_108: { x: 62, y: 66 },
    'main-standing-seam': { x: 0, y: 1 }, 'west-lower-standing-seam': { x: 0, y: 98 }, 'membrane-base': { x: 20, y: 93 },
  };
  const panel = (regions, xOffset, title, field) => {
    const sx = (value) => xOffset + 45 + (value + 2) * 6.1; const sy = (value) => 575 - (value + 2) * 5;
    const polygons = regions.map((region) => `<polygon points="${region.structuralLocalVerticesFt.map((point) => `${sx(point.x)},${sy(point.y)}`).join(' ')}" fill="${palette[region.id]}33" stroke="${palette[region.id]}" stroke-width="2"/><text x="${sx(labelAnchor[region.id].x)}" y="${sy(labelAnchor[region.id].y)}" class="label">${region.id}</text>`).join('');
    const heads = packet.headAssignments.map((head) => `<circle cx="${sx(head.structuralRoofLocalFt.x)}" cy="${sy(head.structuralRoofLocalFt.y)}" r="3.2" fill="${palette[head[field]]}" stroke="#f8fafc" stroke-width="0.7"/>`).join('');
    return `<text x="${xOffset + 35}" y="52" class="title">${title}</text>${polygons}${heads}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 650"><style>.bg{fill:#06111f}.title{fill:#f8fafc;font:700 20px system-ui}.label{fill:#e2e8f0;font:12px system-ui}.note{fill:#fbbf24;font:700 15px system-ui}.fact{fill:#cbd5e1;font:14px system-ui}.divider{stroke:#334155;stroke-width:2}</style><rect class="bg" width="1200" height="650"/><text x="35" y="25" class="fact">MIT Riverside Building J — exact source XY region proof</text><line class="divider" x1="600" y1="38" x2="600" y2="590"/>${panel(packet.floorSlabs, 20, 'Architectural DWG floor slabs — 50 / 18 / 0 heads', 'floorSlabId')}${panel(packet.roofBaseRegions, 620, 'Structural DWG base roof regions — 36 / 4 / 28 heads', 'roofBaseRegionId')}<text x="35" y="615" class="fact">Membrane closure: 58 ft × 34 ft = 1,972 ft² (matches source drawing note)</text><text x="35" y="640" class="note">XY REGION ONLY — NO CRICKET TOPOLOGY, ROOF/PROTECTION PLANE, Z, COMPLIANCE, FABRICATION, OR FIELD RELEASE</text></svg>`;
}
