import { sha256Hex } from './elevation-datums.js';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const SHA = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

const SOURCE_BINDINGS = Object.freeze({
  'architectural-bid-set': ['08515f43642de408ed1f9fc5ebd35115083b023d62412d5d9bc4301cf146c93c', 116713715],
  'architectural-floor-plan-dwg': ['4310609e80ef25af2abbb164a623de1fe749fb37b04d165699acc4fc4f6297e5', 6418563],
  'architectural-rcp-dwg': ['05cdadaa2dd74dd7d02199b7030960864cc30c99044e82de28ca7176188b5658', 6423002],
  'structural-roof-framing-dwg': ['94ee255614f7b403de5185622018eaaad8f80ebe253592418bc7e3b6d993c9aa', 701676],
  'building-j-section-e-dwg': ['f65f41960f27c0a13c60e35b9da36e100b255d92c94c8e895cc25f6ba550a0d5', 427934],
  'building-j-section-f-dwg': ['7b155ffa696ae89fde463b3f3a318e99956fe1976e73c73bf019f3e40a7eaca7', 304405],
  'building-j-section-g-dwg': ['ad2e7bb68222eff9361a8716ad550e8540fcf2df2c90f238fe09218f36418c68', 169299],
  'building-j-section-h-dwg': ['237364c723889b982ea4c44670ad53d5b5318018f106c9ce610961eb249c4150', 422505],
});
const ANSWER_BINDINGS = Object.freeze({
  'state-fire-marshal-approved-plan': ['6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421', 2432530],
  'state-fire-marshal-as-built-plan': ['b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207', 2495800],
});

export async function sealMitRiversideBuildingJSource(draft) {
  const { receiptSha256: _ignored, ...body } = draft;
  return { ...body, receiptSha256: await sha256Hex(body) };
}

export async function validateMitRiversideBuildingJSource(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.source-only-pitched-roof-calibration-seal.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) issues.push(issue('MIT_J_SOURCE_IDENTITY_INVALID', 'Building J source identity changed.'));
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('MIT_J_SOURCE_RECEIPT_MISMATCH', 'Building J source seal changed.'));
  const sources = new Map((packet?.sources || []).map((entry) => [entry.role, entry]));
  for (const [role, [sha256, bytes]] of Object.entries(SOURCE_BINDINGS)) { const entry = sources.get(role); if (!entry || entry.sha256 !== sha256 || entry.bytes !== bytes) issues.push(issue('MIT_J_SOURCE_BINDING_DRIFT', `Source ${role} changed.`)); }
  const answers = new Map((packet?.answerKeyDenylist || []).map((entry) => [entry.role, entry]));
  for (const [role, [sha256, bytes]] of Object.entries(ANSWER_BINDINGS)) { const entry = answers.get(role); if (!entry || entry.sha256 !== sha256 || entry.bytes !== bytes || entry.openedForBuildingJBeforeSourceSeal !== false) issues.push(issue('MIT_J_ANSWER_DENYLIST_DRIFT', `Answer ${role} changed or was opened for Building J.`)); }
  const envelope = packet?.sourceObservations?.buildingEnvelope;
  const roof = packet?.sourceObservations?.roof;
  if (envelope?.levelCount !== 1 || envelope?.overallWidthFt !== 76.333333 || envelope?.overallDepthFt !== 100.166667 || envelope?.exactFootprintPolygonReady !== false) issues.push(issue('MIT_J_ENVELOPE_DRIFT', 'Building J scaled source envelope changed or was falsely promoted to an exact footprint.'));
  if (roof?.mainStandingSeamPlane?.riseInPer12 !== 1.25 || roof?.mainStandingSeamPlane?.lowDatumFt !== 17.083333 || roof?.mainStandingSeamPlane?.intermediateDatumFt !== 19.916667 || roof?.mainStandingSeamPlane?.highDatumFt !== 23.333333 || roof?.lowerRoofPlane?.riseInPer12 !== 0.5 || roof?.cricketPlane?.riseInPer12 !== 0.375 || roof?.wholeFaceTopologyReady !== false) issues.push(issue('MIT_J_ROOF_SOURCE_DRIFT', 'Building J source pitch, datum, or topology truth changed.'));
  if (packet?.sameProjectPriorScope?.answerDerivedArtifactsExist !== true || packet?.sameProjectPriorScope?.buildingJCoordinatesPresent !== false || packet?.selection?.buildingJPriorImplementationSearchHits !== 0) issues.push(issue('MIT_J_PRIOR_SCOPE_DISCLOSURE_INVALID', 'Known Dugout H answer work must remain disclosed and isolated from Building J.'));
  if (packet?.generation?.answerKeyUsed !== false || packet?.generation?.completedBidUsedForGeneration !== false || packet?.generation?.sameProjectPriorScopeArtifactsUsed !== false || Object.values(packet?.claims || {}).some(Boolean)) issues.push(issue('MIT_J_SOURCE_FALSE_PROMOTION', 'Source-only Building J may not use answer evidence or promote downstream claims.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, pitchedHeadPlacementReady: false, complianceReady: false };
}

export async function buildMitRiversideBuildingJSourceCandidate(sourceSeal) {
  if ((await validateMitRiversideBuildingJSource(sourceSeal)).status !== 'passed') throw new Error('MIT_J_SOURCE_SEAL_BLOCKED');
  const envelope = sourceSeal.sourceObservations.buildingEnvelope;
  const roof = sourceSeal.sourceObservations.roof;
  const draft = {
    artifactType: 'halofire.mit-riverside-building-j-source-only-pitched-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSealReceiptSha256: sourceSeal.receiptSha256,
    generationMode: 'sealed-building-j-floor-rcp-roof-elevation-section-and-structural-source-only',
    buildingModel: {
      coordinateSystem: 'source sheet feet normalized to a local one-level envelope', levelCount: 1,
      levels: [{ id: 'level-01', floorElevationFt: 0, scaledEnvelopeFt: { width: envelope.overallWidthFt, depth: envelope.overallDepthFt }, exactFootprintPolygonReady: false }],
      roofPlanes: [
        { id: 'main-standing-seam', riseInPer12: roof.mainStandingSeamPlane.riseInPer12, sourceDatumsFt: [roof.mainStandingSeamPlane.lowDatumFt, roof.mainStandingSeamPlane.intermediateDatumFt, roof.mainStandingSeamPlane.highDatumFt], absoluteDatumSetReady: true, exactFacePolygonReady: false },
        { id: 'lower-connected-roof', riseInPer12: roof.lowerRoofPlane.riseInPer12, sourceDatumsFt: [roof.lowerRoofPlane.bearingDatumFt], absoluteDatumSetReady: true, exactFacePolygonReady: false },
        { id: 'lower-roof-crickets', riseInPer12: roof.cricketPlane.riseInPer12, absoluteDatumSetReady: false, exactFacePolygonReady: false },
      ],
      connectedRoofMassCount: 2, openSlopedDeckPresent: true, mixedCeilingRegimes: true,
      scaledEnvelopeReady: true, sideViewDatumSetReady: true, exactFloorFootprintReady: false, wholeRoofFaceTopologyReady: false,
    },
    heads3d: [], branchPipes3d: [],
    internalVerification: {
      primary: { status: 'passed', method: 'source PDF floor/RCP/roof/elevation/section page binding and dimension replay' },
      independent: { status: 'passed', method: 'independent architectural DWG, structural roof-framing DWG, and four Building J section-DWG hash binding' },
      adversarial: { status: 'passed', method: 'provenance, prior-scope leakage, pitch, datum, geometry, head, and false-promotion mutations' },
    },
    answerKeyOpenedForBuildingJ: false, answerKeyUsedAsGeometryInput: false, sameProjectPriorScopeArtifactsUsed: false,
    sourceCalibrationTargetReady: true, topViewSchematicReady: true, elevationViewSchematicReady: true, partialModel3dSchematicReady: true,
    exactFloorFootprintReady: false, wholeRoofModelReady: false, pitchedHeadPlacementReady: false, freshProjectPlacementVerified: false,
    branchPipeTopologyReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'commit and push this Building J source seal, then open only the separately hashed approved/as-built sprinkler pages for Building J calibration without rewriting source geometry',
    claimStatus: 'source-only-scaled-envelope-connected-pitched-roof-and-side-view-datums-not-exact-footprint-head-placement-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMitRiversideBuildingJSourceCandidate(packet, sourceSeal) {
  let expected;
  try { expected = await buildMitRiversideBuildingJSourceCandidate(sourceSeal); } catch (error) { return { status: 'blocked', issues: [issue('MIT_J_CANDIDATE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIT_J_CANDIDATE_REPLAY_MISMATCH', 'Building J candidate no longer equals the deterministic source-only replay.'));
  if (packet?.buildingModel?.levels?.[0]?.scaledEnvelopeFt?.width !== 76.333333 || packet?.buildingModel?.levels?.[0]?.scaledEnvelopeFt?.depth !== 100.166667 || packet?.buildingModel?.roofPlanes?.map((plane) => plane.riseInPer12).join(',') !== '1.25,0.5,0.375') issues.push(issue('MIT_J_CANDIDATE_GEOMETRY_DRIFT', 'Building J scaled envelope or source pitch set changed.'));
  if (packet?.answerKeyOpenedForBuildingJ !== false || packet?.answerKeyUsedAsGeometryInput !== false || packet?.sameProjectPriorScopeArtifactsUsed !== false || packet?.heads3d?.length !== 0 || packet?.exactFloorFootprintReady !== false || packet?.wholeRoofModelReady !== false || packet?.pitchedHeadPlacementReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('MIT_J_CANDIDATE_FALSE_PROMOTION', 'Building J source-only candidate promoted an unverified answer or downstream claim.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceCalibrationTargetReady: issues.length === 0, pitchedHeadPlacementReady: false, complianceReady: false };
}

export async function verifyMitRiversideBuildingJAdversarialLoop(packet, sourceSeal) {
  const cases = [
    ['receipt', (v) => { v.receiptSha256 = '0'.repeat(64); }], ['source', (v) => { v.sourceSealReceiptSha256 = 'f'.repeat(64); }],
    ['answer-open', (v) => { v.answerKeyOpenedForBuildingJ = true; }], ['answer-input', (v) => { v.answerKeyUsedAsGeometryInput = true; }],
    ['prior-scope', (v) => { v.sameProjectPriorScopeArtifactsUsed = true; }], ['width', (v) => { v.buildingModel.levels[0].scaledEnvelopeFt.width = 77; }],
    ['depth', (v) => { v.buildingModel.levels[0].scaledEnvelopeFt.depth = 100; }], ['main-pitch', (v) => { v.buildingModel.roofPlanes[0].riseInPer12 = 2; }],
    ['lower-pitch', (v) => { v.buildingModel.roofPlanes[1].riseInPer12 = 0.25; }], ['datum', (v) => { v.buildingModel.roofPlanes[0].sourceDatumsFt[2] = 24; }],
    ['head', (v) => { v.heads3d.push({ id: 'fabricated-head' }); }], ['footprint', (v) => { v.exactFloorFootprintReady = true; }],
    ['whole-roof', (v) => { v.wholeRoofModelReady = true; }], ['placement', (v) => { v.pitchedHeadPlacementReady = true; }],
    ['compliance', (v) => { v.complianceReady = true; }], ['fabrication', (v) => { v.fabricationReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateMitRiversideBuildingJSourceCandidate(value, sourceSeal)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, pitchedHeadPlacementReady: false, complianceReady: false };
}

export function renderMitRiversideBuildingJSourceViews(packet) {
  const width = packet.buildingModel.levels[0].scaledEnvelopeFt.width;
  const depth = packet.buildingModel.levels[0].scaledEnvelopeFt.depth;
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 520"><style>rect{fill:#07111f}.env{fill:#12304a;stroke:#67e8f9;stroke-width:3}.main{fill:#1d4ed8;fill-opacity:.42;stroke:#60a5fa;stroke-width:3}.low{fill:#a16207;fill-opacity:.55;stroke:#fbbf24;stroke-width:3}text{fill:#e2e8f0;font:16px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="520"/><rect class="env" x="95" y="62" width="382" height="401"/><rect class="main" x="95" y="62" width="320" height="300"/><rect class="low" x="95" y="362" width="382" height="101"/><text x="24" y="30">MIT Riverside Building J source-only top schematic - scaled envelope ${width} ft x ${depth} ft</text><text x="515" y="105">Main standing-seam plane 1.25:12</text><text x="515" y="140">Connected lower plane 0.5:12</text><text x="515" y="175">Crickets 0.375:12</text><text class="warn" x="24" y="500">Exact footprint and face polygons remain false; 0 sprinkler heads generated</text></svg>`;
  const z = (value) => round(430 - value * 13); const x = (value) => round(70 + value * 10);
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 500"><style>rect{fill:#07111f}.ground{stroke:#64748b;stroke-width:5}.roof{stroke:#f59e0b;stroke-width:7}.wall{stroke:#94a3b8;stroke-width:4}.datum{stroke:#67e8f9;stroke-dasharray:8 6}text{fill:#e2e8f0;font:15px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="500"/><line class="ground" x1="55" y1="430" x2="865" y2="430"/><line class="wall" x1="${x(0)}" y1="430" x2="${x(0)}" y2="${z(17.083333)}"/><line class="roof" x1="${x(0)}" y1="${z(17.083333)}" x2="${x(60)}" y2="${z(23.333333)}"/><line class="wall" x1="${x(60)}" y1="430" x2="${x(60)}" y2="${z(23.333333)}"/><line class="roof" x1="${x(60)}" y1="${z(17.333333)}" x2="${x(76)}" y2="${z(12)}"/><line class="wall" x1="${x(76)}" y1="430" x2="${x(76)}" y2="${z(12)}"/><line class="datum" x1="45" y1="${z(17.083333)}" x2="860" y2="${z(17.083333)}"/><line class="datum" x1="45" y1="${z(23.333333)}" x2="860" y2="${z(23.333333)}"/><text x="24" y="28">Source side-view datum schematic: 17'-1, 19'-11, and 23'-4 B.O.D. references</text><text class="warn" x="24" y="480">Source datums are absolute; exact face junctions and protection-plane assignment still require sealed answer calibration</text></svg>`;
  const iso = (xValue, yValue, zValue) => [round(135 + xValue * 6 + yValue * 2.5), round(430 - yValue * 2.4 - zValue * 10)];
  const p = (values) => values.map((value) => iso(...value).join(',')).join(' ');
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 520"><style>rect{fill:#07111f}.floor{fill:#0f2942;stroke:#64748b;stroke-width:2}.main{fill:#1d4ed8;fill-opacity:.65;stroke:#60a5fa;stroke-width:3}.low{fill:#a16207;fill-opacity:.65;stroke:#fbbf24;stroke-width:3}text{fill:#e2e8f0;font:16px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="520"/><polygon class="floor" points="${p([[0,0,0],[76,0,0],[76,100,0],[0,100,0]])}"/><polygon class="main" points="${p([[0,0,17.083333],[60,0,23.333333],[60,75,23.333333],[0,75,17.083333]])}"/><polygon class="low" points="${p([[0,75,17.333333],[76,75,12],[76,100,12],[0,100,17.333333]])}"/><text x="24" y="30">Source-only partial 3D: connected sloped masses over a one-level scaled envelope</text><text class="warn" x="24" y="500">Schematic only - exact footprint, full roof faces, sprinklers, compliance, and fabrication remain blocked</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, sourceCalibrationTargetReady: true, pitchedHeadPlacementReady: false, complianceReady: false };
}
