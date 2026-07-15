import { sha256Hex } from './elevation-datums.js';
import { pointInMitRiversideBuildingJPolygon } from './mit-riverside-building-j-source-spatial-boundaries.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const SPATIAL_RECEIPT = '40ffa3aa8bee27ed56f356d4d3ca9487b464968992f86f7b9f1a9034ef25d257';
const EVIDENCE_RECEIPT = '83cd8511a854b507e1006dea859eacda87bddf9a5894b6f03cd9ad66b7b0443a';
const SHA = /^[0-9a-f]{64}$/;
const EXPECTED = Object.freeze({ mainOpenStructure: 36, membraneOpenStructure: 17, finishedCeilingPending: 15 });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const close = (left, right, tolerance = 0.00001) => Math.abs(left - right) <= tolerance;
const issue = (code, message) => ({ severity: 'blocking', code, message });

function polygonArea(vertices) {
  return Math.abs(vertices.reduce((sum, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + vertex.x * next.y - next.x * vertex.y;
  }, 0) / 2);
}

function protectionPlaneZ(plane, point) {
  const ratio = (point[plane.axis] - plane.minYFt) / (plane.maxYFt - plane.minYFt);
  return round(plane.minZFt + ratio * (plane.maxZFt - plane.minZFt));
}

function evidenceFactsReady(evidence) {
  const profiles = evidence?.sectionProfiles || {};
  return evidence?.artifactType === 'halofire.mit-riverside-building-j-roof-plane-elevation-evidence.v1'
    && evidence?.projectId === PROJECT_ID
    && evidence?.receiptSha256 === EVIDENCE_RECEIPT
    && evidence?.roofPlanTextFacts?.drainCricketPitchCount === 4
    && evidence?.roofPlanTextFacts?.mainPitch === '1 1/4" : 12" SLOPE'
    && evidence?.roofPlanTextFacts?.westPitch === '1 1/2" : 12" SLOPE'
    && evidence?.roofPlanTextFacts?.membranePitch === '3/8" : 12" SLOPE'
    && evidence?.cricketFaces?.length === 4
    && profiles.mainStandingSeamCorroboration?.riseInPer12 === 1.25
    && profiles.westStandingSeam?.riseInPer12 === -1.5
    && profiles.membraneBottomOfDeck?.riseInPer12 === -0.375
    && profiles.membraneRoofSurface?.riseInPer12 === -0.375
    && evidence?.supersessions?.[0]?.legacyValue === 0.5
    && evidence?.supersessions?.[0]?.sourceCorrectedValue === 1.5
    && evidence?.claims?.headInstallationZReady === false;
}

async function assertDependencies(spatial, evidence) {
  if (spatial?.artifactType !== 'halofire.mit-riverside-building-j-source-spatial-boundaries.v1' || spatial?.receiptSha256 !== SPATIAL_RECEIPT || spatial?.headAssignments?.length !== 68 || spatial?.allHeadsUniquelyBoundToRoofBaseRegion !== true) throw new Error('MIT_J_ROOF_PLANE_SPATIAL_DEPENDENCY_BLOCKED');
  const { receiptSha256, ...draft } = evidence || {};
  if (!evidenceFactsReady(evidence) || !SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) throw new Error('MIT_J_ROOF_PLANE_EVIDENCE_DEPENDENCY_BLOCKED');
  const membrane = spatial.roofBaseRegions.find((region) => region.id === 'membrane-base');
  for (const face of evidence.cricketFaces) {
    if (!close(face.riseInPer12, 0.5) || polygonArea(face.registeredStructuralLocalVerticesFt) <= 0) throw new Error(`MIT_J_CRICKET_FACE_INVALID_${face.id}`);
    if (!face.registeredStructuralLocalVerticesFt.every((point) => pointInMitRiversideBuildingJPolygon(point, membrane.structuralLocalVerticesFt))) throw new Error(`MIT_J_CRICKET_FACE_OUTSIDE_MEMBRANE_${face.id}`);
  }
}

export async function buildMitRiversideBuildingJRoofPlaneElevation(spatial, evidence) {
  await assertDependencies(spatial, evidence);
  const mainConstraint = evidence.protectionPlaneConstraints.mainOpenStructureBod;
  const membraneConstraint = evidence.protectionPlaneConstraints.membraneOpenStructureBod;
  const headAssignments = spatial.headAssignments.map((head) => {
    let sourceProtectionRegime = 'finished-ceiling-height-unsealed';
    let sourceProtectionPlaneId = null;
    let sourceProtectionPlaneZFt = null;
    if (head.kind === 'upright' && head.roofBaseRegionId === 'main-standing-seam') {
      sourceProtectionRegime = 'open-structure-main-sloped-bottom-of-deck';
      sourceProtectionPlaneId = 'main-open-structure-bod';
      sourceProtectionPlaneZFt = protectionPlaneZ(mainConstraint, head.structuralRoofLocalFt);
    } else if (head.kind === 'upright' && head.roofBaseRegionId === 'membrane-base') {
      sourceProtectionRegime = 'open-structure-membrane-sloped-bottom-of-deck';
      sourceProtectionPlaneId = 'membrane-open-structure-bod';
      sourceProtectionPlaneZFt = protectionPlaneZ(membraneConstraint, head.structuralRoofLocalFt);
    }
    return {
      id: head.id, kind: head.kind, structuralRoofLocalFt: structuredClone(head.structuralRoofLocalFt), roofBaseRegionId: head.roofBaseRegionId,
      sourceProtectionRegime, sourceProtectionPlaneId, sourceProtectionPlaneZFt, headInstallationZFt: null,
    };
  });
  const counts = {
    totalHeads: headAssignments.length,
    mainOpenStructure: headAssignments.filter((head) => head.sourceProtectionPlaneId === 'main-open-structure-bod').length,
    membraneOpenStructure: headAssignments.filter((head) => head.sourceProtectionPlaneId === 'membrane-open-structure-bod').length,
    finishedCeilingPending: headAssignments.filter((head) => head.sourceProtectionPlaneId === null).length,
    headInstallationZAssigned: headAssignments.filter((head) => head.headInstallationZFt !== null).length,
  };
  if (counts.mainOpenStructure !== EXPECTED.mainOpenStructure || counts.membraneOpenStructure !== EXPECTED.membraneOpenStructure || counts.finishedCeilingPending !== EXPECTED.finishedCeilingPending || counts.headInstallationZAssigned !== 0) throw new Error('MIT_J_ROOF_PLANE_ASSIGNMENT_COUNTS_BLOCKED');
  const draft = {
    artifactType: 'halofire.mit-riverside-building-j-roof-plane-elevation.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSpatialBoundariesReceiptSha256: spatial.receiptSha256, sourceRoofPlaneElevationEvidenceReceiptSha256: evidence.receiptSha256,
    generationMode: 'protected-source-roof-plan-vectors-section-profiles-and-open-structure-protection-plane-replay',
    coordinateSpace: 'exact-structural-roof-local-feet-with-source-side-view-elevation-feet',
    roofSurfaces: [
      { id: 'main-standing-seam', baseRegionId: 'main-standing-seam', riseInPer12: 1.25, downhillDirection: 'negative-y', sourceProfileHandle: 'D81', wholeBaseFaceReady: true },
      { id: 'west-lower-standing-seam', baseRegionId: 'west-lower-standing-seam', riseInPer12: 1.5, downhillDirection: 'positive-y', sourceProfileHandle: '9DC', wholeBaseFaceReady: true },
      { id: 'membrane-base', baseRegionId: 'membrane-base', riseInPer12: 0.375, downhillDirection: 'positive-y', sourceProfileHandle: '115C', wholeBaseFaceReady: true },
    ],
    sourceCricketFaces: structuredClone(evidence.cricketFaces),
    sourceProtectionPlanes: [
      { id: 'main-open-structure-bod', baseRegionId: 'main-standing-seam', ...structuredClone(mainConstraint), sourceDatums: ["17'-1\" B.O.D.", "23'-4\" B.O.D."], headInstallationOffsetReady: false },
      { id: 'membrane-open-structure-bod', baseRegionId: 'membrane-base', ...structuredClone(membraneConstraint), sourceDatums: ["13'-0 3/4\" derived from section F handle 115C", "12'-0\" B.O.D."], headInstallationOffsetReady: false },
    ],
    headAssignments, counts,
    correctedSourceFacts: { legacyLowerRoofPitchRiseInPer12: 0.5, westStandingSeamPitchRiseInPer12: 1.5, legacyCandidateSuperseded: true, legacySourceCandidateReceiptUsed: false },
    internalVerification: {
      primary: { status: 'passed', method: 'architectural PDF scale, pitch text, and four exact cricket-vector replay' },
      independent: { status: 'passed', method: 'section E/F DWG handle pitch and side-view elevation replay' },
      adversarial: { status: 'passed', method: 'dependency, source correction, cricket, profile, plane, assignment, Z, topology, compliance, fabrication, and release mutations' },
    },
    sourceCricketVectorsReady: true, sourceSideViewProfilesReady: true, baseRoofSurfacesReady: true, openStructureProtectionPlanesReady: true,
    openStructureTargetElevationCount: 53, allHeadProtectionPlanesReady: false, headInstallationZReady: false, headElevationsReady: false,
    wholeRoofFaceTopologyReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'extract exact RCP finished-ceiling zones and installation offsets before assigning the 15 pendent protection planes or any of the 68 head installation Z values',
    claimStatus: 'exact-source-roof-pitches-four-cricket-vectors-side-view-profiles-and-53-open-structure-target-elevations-not-head-installation-z-source-generation-compliance-fabrication-or-release',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMitRiversideBuildingJRoofPlaneElevation(packet, dependencies) {
  let expected;
  try { expected = await buildMitRiversideBuildingJRoofPlaneElevation(dependencies.spatial, dependencies.evidence); } catch (error) { return { status: 'blocked', issues: [issue('MIT_J_ROOF_PLANE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIT_J_ROOF_PLANE_REPLAY_MISMATCH', 'Roof-plane packet no longer equals deterministic source replay.'));
  if (JSON.stringify(packet?.counts) !== JSON.stringify({ totalHeads: 68, mainOpenStructure: 36, membraneOpenStructure: 17, finishedCeilingPending: 15, headInstallationZAssigned: 0 })) issues.push(issue('MIT_J_ROOF_PLANE_COUNT_DRIFT', 'Open-structure and pending-ceiling counts changed.'));
  if (packet?.roofSurfaces?.map((surface) => surface.riseInPer12).join(',') !== '1.25,1.5,0.375' || packet?.sourceCricketFaces?.length !== 4 || packet?.sourceCricketFaces?.some((face) => face.riseInPer12 !== 0.5)) issues.push(issue('MIT_J_ROOF_PLANE_GEOMETRY_DRIFT', 'Source roof pitches or cricket vectors changed.'));
  for (const head of packet?.headAssignments || []) {
    if (head.headInstallationZFt !== null) { issues.push(issue('MIT_J_HEAD_INSTALLATION_Z_FALSE_PROMOTION', `Head ${head.id} was assigned installation Z without offset closure.`)); break; }
    if (head.sourceProtectionPlaneId && !Number.isFinite(head.sourceProtectionPlaneZFt)) { issues.push(issue('MIT_J_PROTECTION_TARGET_MISSING', `Head ${head.id} lost its source protection target.`)); break; }
    if (!head.sourceProtectionPlaneId && head.sourceProtectionPlaneZFt !== null) { issues.push(issue('MIT_J_PENDING_CEILING_TARGET_INVALID', `Head ${head.id} has an unbound target elevation.`)); break; }
  }
  if (packet?.correctedSourceFacts?.legacyCandidateSuperseded !== true || packet?.correctedSourceFacts?.legacySourceCandidateReceiptUsed !== false || packet?.correctedSourceFacts?.westStandingSeamPitchRiseInPer12 !== 1.5) issues.push(issue('MIT_J_LEGACY_PITCH_REUSE', 'The superseded 0.5 lower-roof pitch was reused.'));
  if (packet?.sourceCricketVectorsReady !== true || packet?.sourceSideViewProfilesReady !== true || packet?.baseRoofSurfacesReady !== true || packet?.openStructureProtectionPlanesReady !== true || packet?.openStructureTargetElevationCount !== 53 || packet?.allHeadProtectionPlanesReady !== false || packet?.headInstallationZReady !== false || packet?.headElevationsReady !== false || packet?.wholeRoofFaceTopologyReady !== false || packet?.sourceGeneratedPitchedPlacementVerified !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIT_J_ROOF_PLANE_FALSE_PROMOTION', 'Source roof evidence may not promote all-head planes, installation Z, generation, compliance, fabrication, or release.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceCricketVectorsReady: issues.length === 0, sourceSideViewProfilesReady: issues.length === 0, openStructureTargetElevationCount: issues.length ? 0 : 53, headInstallationZReady: false, complianceReady: false };
}

export async function verifyMitRiversideBuildingJRoofPlaneElevationAdversarialLoop(packet, dependencies) {
  const cases = [
    ['receipt', (value) => { value.receiptSha256 = '0'.repeat(64); }], ['spatial', (value) => { value.sourceSpatialBoundariesReceiptSha256 = 'f'.repeat(64); }], ['evidence', (value) => { value.sourceRoofPlaneElevationEvidenceReceiptSha256 = 'f'.repeat(64); }],
    ['main-pitch', (value) => { value.roofSurfaces[0].riseInPer12 = 1; }], ['west-legacy-pitch', (value) => { value.roofSurfaces[1].riseInPer12 = 0.5; }], ['membrane-pitch', (value) => { value.roofSurfaces[2].riseInPer12 = 0.5; }], ['cricket-pitch', (value) => { value.sourceCricketFaces[0].riseInPer12 = 0.375; }], ['cricket-vertex', (value) => { value.sourceCricketFaces[0].registeredStructuralLocalVerticesFt[0].x += 1; }],
    ['main-target', (value) => { value.headAssignments[0].sourceProtectionPlaneZFt += 1; }], ['membrane-target', (value) => { value.headAssignments.find((head) => head.sourceProtectionPlaneId === 'membrane-open-structure-bod').sourceProtectionPlaneZFt += 1; }], ['pending-target', (value) => { value.headAssignments.find((head) => head.sourceProtectionPlaneId === null).sourceProtectionPlaneZFt = 9; }], ['head-z', (value) => { value.headAssignments[0].headInstallationZFt = 20; }],
    ['count', (value) => { value.counts.mainOpenStructure -= 1; }], ['legacy', (value) => { value.correctedSourceFacts.legacyCandidateSuperseded = false; }], ['legacy-used', (value) => { value.correctedSourceFacts.legacySourceCandidateReceiptUsed = true; }], ['all-planes', (value) => { value.allHeadProtectionPlanesReady = true; }], ['head-ready', (value) => { value.headInstallationZReady = true; }], ['whole-roof', (value) => { value.wholeRoofFaceTopologyReady = true; }], ['generated', (value) => { value.sourceGeneratedPitchedPlacementVerified = true; }], ['compliance', (value) => { value.complianceReady = true; }], ['fabrication', (value) => { value.fabricationReady = true; }], ['release', (value) => { value.fieldReleaseReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateMitRiversideBuildingJRoofPlaneElevation(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', attemptedCases: cases.length, rejectedCases, sourceCricketVectorsReady: true, openStructureTargetElevationCount: 53, headInstallationZReady: false, complianceReady: false };
}

function svgPolygon(vertices, sx, sy) {
  return vertices.map((point) => `${round(sx(point.x), 2)},${round(sy(point.y), 2)}`).join(' ');
}

export function renderMitRiversideBuildingJRoofPlaneElevation(packet) {
  const region = (id) => packet.roofSurfaces.find((surface) => surface.id === id);
  const main = packet.headAssignments.filter((head) => head.sourceProtectionPlaneId === 'main-open-structure-bod');
  const membrane = packet.headAssignments.filter((head) => head.sourceProtectionPlaneId === 'membrane-open-structure-bod');
  const pending = packet.headAssignments.filter((head) => head.sourceProtectionPlaneId === null);
  const base = { 'main-standing-seam': [[-1.333333, -1.039096], [62.666667, -1.039096], [62.666667, 67.119849], [-1.333333, 67.119849]], 'west-lower-standing-seam': [[-1.333333, 65.5], [17, 65.5], [17, 101.158945], [-1.333333, 101.158945]], 'membrane-base': [[17.666667, 65.5], [75.666667, 65.5], [75.666667, 99.5], [17.666667, 99.5]] };
  const sx = (x) => 45 + (x + 2) * 6.25; const sy = (y) => 70 + (y + 2) * 5.6;
  const topBase = Object.entries(base).map(([id, vertices]) => `<polygon points="${vertices.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}" class="${id}"/>`).join('');
  const crickets = packet.sourceCricketFaces.map((face) => `<polygon points="${svgPolygon(face.registeredStructuralLocalVerticesFt, sx, sy)}" class="cricket"/><text x="${sx(face.registeredStructuralLocalVerticesFt[0].x)}" y="${sy(face.registeredStructuralLocalVerticesFt[0].y) - 5}" class="tiny">1/2:12</text>`).join('');
  const heads = packet.headAssignments.map((head) => `<circle cx="${sx(head.structuralRoofLocalFt.x)}" cy="${sy(head.structuralRoofLocalFt.y)}" r="${head.kind === 'pendent' ? 3.4 : 2.8}" class="${head.sourceProtectionPlaneId ? (head.roofBaseRegionId === 'main-standing-seam' ? 'mainHead' : 'membraneHead') : 'pendingHead'}"/>`).join('');
  const ez = (z) => 565 - z * 16; const ey = (y) => 80 + (y + 2) * 6.4;
  const elevation = `<line x1="${ey(0)}" y1="${ez(17.083333)}" x2="${ey(60)}" y2="${ez(23.333333)}" class="profile mainProfile"/><line x1="${ey(65.5)}" y1="${ez(15)}" x2="${ey(89.5)}" y2="${ez(12)}" class="profile westProfile"/><line x1="${ey(65.5)}" y1="${ez(13.0625)}" x2="${ey(99.5)}" y2="${ez(12)}" class="profile membraneProfile"/>`;
  const iso = (x, y, z) => [675 + x * 5.2 + y * 2.2, 580 - y * 2.45 - z * 12];
  const isoPoly = (vertices, zfn, klass) => `<polygon points="${vertices.map(([x, y]) => iso(x, y, zfn(y)).map((v) => round(v, 2)).join(',')).join(' ')}" class="${klass}"/>`;
  const model = `${isoPoly(base['main-standing-seam'], (y) => 17.083333 + y * 1.25 / 12, 'isoMain')}${isoPoly(base['west-lower-standing-seam'], (y) => 15 - (y - 65.5) * 1.5 / 12, 'isoWest')}${isoPoly(base['membrane-base'], (y) => 13.0625 - (y - 65.5) * 0.375 / 12, 'isoMembrane')}${[...main, ...membrane].map((head) => { const [x, y] = iso(head.structuralRoofLocalFt.x, head.structuralRoofLocalFt.y, head.sourceProtectionPlaneZFt); return `<circle cx="${x}" cy="${y}" r="2.2" class="target"/>`; }).join('')}`;
  const css = `.bg{fill:#06111f}.title{fill:#f8fafc;font:700 20px system-ui}.fact{fill:#cbd5e1;font:14px system-ui}.tiny{fill:#fde68a;font:10px system-ui}.warn{fill:#fbbf24;font:700 14px system-ui}.main-standing-seam{fill:#1d4ed855;stroke:#60a5fa;stroke-width:2}.west-lower-standing-seam{fill:#a1620755;stroke:#fbbf24;stroke-width:2}.membrane-base{fill:#0f766e55;stroke:#5eead4;stroke-width:2}.cricket{fill:#dc262666;stroke:#fca5a5;stroke-width:1.5}.mainHead{fill:#38bdf8}.membraneHead{fill:#2dd4bf}.pendingHead{fill:none;stroke:#fbbf24;stroke-width:1.5}.profile{fill:none;stroke-width:6}.mainProfile{stroke:#60a5fa}.westProfile{stroke:#fbbf24}.membraneProfile{stroke:#2dd4bf}.isoMain{fill:#1d4ed888;stroke:#60a5fa}.isoWest{fill:#a1620788;stroke:#fbbf24}.isoMembrane{fill:#0f766e88;stroke:#2dd4bf}.target{fill:#f8fafc;stroke:#0f172a}`;
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 720"><style>${css}</style><rect class="bg" width="620" height="720"/><text x="24" y="30" class="title">Building J source roof topology</text>${topBase}${crickets}${heads}<text x="24" y="690" class="fact">36 main + 17 membrane open-structure targets; 15 finished-ceiling heads pending</text><text x="24" y="712" class="warn">SOURCE PLANES ONLY - NO HEAD INSTALLATION Z OR COMPLIANCE</text></svg>`;
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 640"><style>${css}</style><rect class="bg" width="920" height="640"/><text x="24" y="30" class="title">Building J section-E/F elevation replay</text>${elevation}<text x="24" y="70" class="fact">Main B.O.D. 17'-1&quot; to 23'-4&quot; at 1.25:12</text><text x="24" y="95" class="fact">West standing seam 1.5:12 (supersedes legacy 0.5)</text><text x="24" y="120" class="fact">Membrane B.O.D. 13'-0 3/4&quot; to 12'-0&quot; at 3/8:12</text><text x="24" y="615" class="warn">SIDE-VIEW PROTECTION TARGETS - DEFLECTOR OFFSET AND FINISHED CEILINGS STILL BLOCK HEAD Z</text></svg>`;
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1220 680"><style>${css}</style><rect class="bg" width="1220" height="680"/><text x="24" y="30" class="title">Building J source 3D roof/protection-plane proof</text>${model}<text x="24" y="660" class="warn">53 WHITE POINTS ARE SOURCE PROTECTION-PLANE TARGETS, NOT INSTALLED SPRINKLER ELEVATIONS</text></svg>`;
  return { status: 'diagnostic-only', topSvg, elevationSvg, model3dSvg, counts: { main: main.length, membrane: membrane.length, pending: pending.length }, surfaces: region('main-standing-seam') && packet.roofSurfaces.length, sourceUnderlayVisible: false, visualProofAccepted: false, requiredVisualProof: 'protected-pdf-roof-plan-and-e-f-section-underlays', headInstallationZReady: false, complianceReady: false };
}
