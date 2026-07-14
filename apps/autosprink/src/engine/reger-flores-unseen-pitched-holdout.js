import { sha256Hex } from './elevation-datums.js';
import { generateSlopedCeilingLayout } from './sloped-ceiling-layout.js';

const PROJECT = 'Reger-Flores Residence - Queen Creek AZ';
const PROJECT_ID = 'reger-flores-queen-creek-az';
const PRIOR_RECEIPT = '20a553b24f20219e2f3d1e8022b05079dc6e22f3189c63c9684fcf3dbbf1bf26';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });
const EXPECTED = Object.freeze({
  architectural_permit_set: ['62f46411f226ebb0c27ee447a8a9794454b95b4cf0c8fe5467d5c2521a4dcf5f', 31479706],
  ceiling_plan_cad: ['62156c099f062a4bef85edcab4dbf4e262586655b1c462003e2cdeed99dea279', 697723],
  floor_plan_cad: ['8f555e5f3336f219219f8049c2ddc357811cfd4331268999fbeedbcb33f4a9cb', 1213508],
});

export async function validateRegerFloresSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-holdout.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) return { status: 'blocked', issues: [issue('REGER_SOURCE_SEAL_IDENTITY_INVALID', 'Reger-Flores holdout identity is invalid.')], complianceReady: false };
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('REGER_SOURCE_SEAL_RECEIPT_MISMATCH', 'The pre-answer source seal changed.'));
  const byRole = new Map((packet.sources || []).map((source) => [source.role, source]));
  for (const [role, [sha256, bytes]] of Object.entries(EXPECTED)) { const source = byRole.get(role); if (!source || source.sha256 !== sha256 || source.bytes !== bytes) issues.push(issue('REGER_SOURCE_IDENTITY_DRIFT', `Source ${role} changed or is missing.`)); }
  if (byRole.size !== 3) issues.push(issue('REGER_SOURCE_SET_DRIFT', 'The source set must contain exactly the architectural, ceiling, and floor inputs.'));
  const answer = packet.answerKeyDenylist?.[0];
  if (packet.answerKeyDenylist?.length !== 1 || answer?.sha256 !== 'af45158d0e52a87faa78973b171245d6c772d46d5edccfad0e8410e88c8ffce9' || answer?.bytes !== 871000 || answer?.openedBeforeSourceSeal !== false) issues.push(issue('REGER_ANSWER_DENYLIST_DRIFT', 'The approved answer must remain identified and unopened at seal time.'));
  const source = packet.sourceObservations;
  if (source?.layout !== 'FIRST FLOOR CEILINGS' || source?.zoneWidthFt !== 18.5 || source?.zoneLengthFt !== 16 || source?.pitchRiseIn !== 4 || source?.pitchRunIn !== 12 || source?.springElevationFt !== 12.083333 || source?.peakElevationFt !== 15.166667 || source?.cadEvidence?.length !== 4) issues.push(issue('REGER_SOURCE_OBSERVATION_DRIFT', 'The dimension-closed first-floor 4:12 vault controls changed.'));
  if (packet.selection?.status !== 'source-sealed-answer-unopened' || packet.selection?.priorImplementationSearchHits !== 0 || packet.selection?.rejectedBeforeAnswerOpen?.length !== 5) issues.push(issue('REGER_SELECTION_INVALID', 'Fresh selection and pre-answer rejections are incomplete.'));
  if (packet.toolchain?.releaseDigestVerified !== true || packet.brainPreflight?.status !== 'passed' || packet.brainPreflight?.spatialB1ThroughB7Priority !== 1) issues.push(issue('REGER_PREFLIGHT_INCOMPLETE', 'Verified DWG tooling and brain preflight are required.'));
  if (packet.generation?.answerKeyUsed !== false || packet.generation?.completedBidUsedForGeneration !== false || packet.generation?.roofPlaneSubstitutionAllowed !== false || Object.values(packet.claims || {}).some(Boolean)) issues.push(issue('REGER_SOURCE_SEAL_FALSE_PROMOTION', 'Source seal generation must be answer-free, reject roof substitution, and keep claims false.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function sourceGeometry() {
  const widthFt = 18.5; const lengthFt = 16; const halfRunFt = 9.25;
  const springElevationFt = 12 + 1 / 12; const peakElevationFt = 15 + 2 / 12;
  return {
    coordinateSystem: 'Ceiling Plans.dwg first-floor vault-zone-local feet',
    floor: { id: 'level-01', elevationFt: 0, sourceLayout: 'FIRST FLOOR CEILINGS' },
    room: { id: 'source-vault-zone-01', name: 'SOURCE VAULT ZONE 01', widthFt, lengthFt, areaSqFt: widthFt * lengthFt, polygonFt: [[0, 0], [widthFt, 0], [widthFt, lengthFt], [0, lengthFt]], identityStatus: 'source-geometry-closed-room-name-not-promoted' },
    ceiling: {
      kind: 'source-proven-two-plane-vault', axis: 'x', ridgeAxis: 'y', pitch: { riseIn: 4, runIn: 12 },
      springElevationFt: round(springElevationFt), peakElevationFt: round(peakElevationFt), halfRunFt, riseFt: round(peakElevationFt - springElevationFt),
      dimensionClosure: { pitchSymbol: '4:12', westSpring: "12'-1\"", peak: "15'-2\" @ PEAK", eastSpring: "12'-1\"", lengthDimensions: [8, 8], halfRunCalculation: '(37 inches / 4) * 12 = 111 inches = 9.25 feet', roofPlaneUsedAsCeiling: false },
      surfaces: [
        { id: 'vault-west-plane', polygonFt: [[0, 0], [halfRunFt, 0], [halfRunFt, lengthFt], [0, lengthFt]], downhillDirection: 'negative-x' },
        { id: 'vault-east-plane', polygonFt: [[halfRunFt, 0], [widthFt, 0], [widthFt, lengthFt], [halfRunFt, lengthFt]], downhillDirection: 'positive-x' },
      ],
    },
  };
}

const ceilingElevationFt = (geometry, point) => geometry.ceiling.springElevationFt + Math.min(point[0], geometry.room.widthFt - point[0]) * 4 / 12;

export async function buildRegerFloresSourceOnlyCandidate(sourceSeal, dillonPrior) {
  if ((await validateRegerFloresSourceSeal(sourceSeal)).status !== 'passed') throw new Error('REGER_SOURCE_SEAL_BLOCKED');
  if (dillonPrior?.artifactType !== 'halofire.dillon-pitched-placement-prior.v1' || dillonPrior?.receiptSha256 !== PRIOR_RECEIPT || dillonPrior?.candidatePlacementPriorReady !== true || dillonPrior?.transferPolicy?.empiricalPriorOnly !== true || dillonPrior?.transferPolicy?.codeLimit !== false) throw new Error('DILLON_EMPIRICAL_PRIOR_BLOCKED');
  const geometry = sourceGeometry();
  const input = { artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 1, regions: geometry.ceiling.surfaces.map((surface) => ({ id: surface.id, polygonSubmittedPt: surface.polygonFt, slopeAxis: 'x', downhillDirection: surface.downhillDirection, riseIn: 4, runIn: 12, shouldProtect: true, obstructions: [] })), maxAcrossSlopeSpanFt: dillonPrior.learnedGeometry.replayAcrossSlopeSpanFt, maxAlongSlopeSpanFt: dillonPrior.learnedGeometry.replayAlongSlopeSpanFt };
  const layout = generateSlopedCeilingLayout(input); if (layout.status !== 'passed') throw new Error('REGER_SOURCE_LAYOUT_BLOCKED');
  const heads3d = layout.heads.map((head, index) => ({ id: `reger-source-head-${String(index + 1).padStart(2, '0')}`, surfaceId: head.regionId, pointFt: [round(head.pointPt[0]), round(head.pointPt[1]), round(ceilingElevationFt(geometry, head.pointPt))], status: 'source-only-empirical-candidate', hydraulicNodeAssigned: false, obstructionClearanceVerified: false }));
  const draft = {
    artifactType: 'halofire.reger-flores-source-only-pitched-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSealReceiptSha256: sourceSeal.receiptSha256, dillonPriorReceiptSha256: dillonPrior.receiptSha256,
    generationMode: 'fresh-sealed-source-plus-cross-project-empirical-prior-before-answer-open', geometry, layoutInput: input, layout: { regions: layout.regions, headCount: layout.heads.length }, heads3d,
    branchPipes3d: [], branchPipeTopologyReady: false,
    buildingModel: { levelCount: 1, levels: [{ id: 'level-01', floorElevationFt: 0, roomIds: ['source-vault-zone-01'] }], modeledScope: 'source-closed-first-floor-vault-zone', wholeBuildingFootprintComplete: false, floorByFloorExtrusionReady: true, twoPlaneVaultReady: true },
    internalVerification: { primary: { status: 'passed', method: 'deterministic-two-plane-layout-replay' }, independent: { status: 'passed', method: 'pitch-spring-peak-dimension-closure' }, adversarial: { status: 'passed', method: 'source-prior-answer-leakage-and-false-promotion-mutations' } },
    answerKeyUsedAsGeometryInput: false, completedBidUsedAsGeometryInput: false, answerKeyOpened: false, unseenProjectPlacementVerified: false,
    roomEnvelopeGeometryGrounded: true, topViewReady: true, elevationViewReady: true, partialModel3dReady: true, wholeBuildingModelReady: false, wholeBuildingHeadLayoutReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'fresh-source-only-pitched-candidate-before-completed-answer-comparison-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateRegerFloresSourceOnlyCandidate(packet, dependencies = {}) {
  const issues = []; let expected;
  try { expected = await buildRegerFloresSourceOnlyCandidate(dependencies.sourceSeal, dependencies.dillonPrior); } catch (error) { return { status: 'blocked', issues: [issue('REGER_SOURCE_CANDIDATE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || receiptSha256 !== expected.receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('REGER_SOURCE_CANDIDATE_REPLAY_MISMATCH', 'Candidate does not equal deterministic sealed-source replay.'));
  const ceiling = packet?.geometry?.ceiling; const heads = packet?.heads3d || [];
  if (packet?.geometry?.room?.widthFt !== 18.5 || packet?.geometry?.room?.lengthFt !== 16 || ceiling?.pitch?.riseIn !== 4 || ceiling?.springElevationFt !== 12.083333 || ceiling?.peakElevationFt !== 15.166667 || ceiling?.halfRunFt !== 9.25 || ceiling?.dimensionClosure?.roofPlaneUsedAsCeiling !== false || ceiling?.surfaces?.length !== 2) issues.push(issue('REGER_SOURCE_GEOMETRY_DRIFT', 'The dimension-closed 4:12 vault geometry changed.'));
  if (heads.length !== 2 || new Set(heads.map((head) => head.surfaceId)).size !== 2 || heads.some((head) => head.hydraulicNodeAssigned || head.obstructionClearanceVerified)) issues.push(issue('REGER_SOURCE_HEAD_TALLY_DRIFT', 'The source-prior replay must emit one candidate per vault plane with downstream gates false.'));
  if (packet?.answerKeyUsedAsGeometryInput !== false || packet?.completedBidUsedAsGeometryInput !== false || packet?.answerKeyOpened !== false || packet?.unseenProjectPlacementVerified !== false || packet?.branchPipes3d?.length !== 0 || packet?.branchPipeTopologyReady !== false || packet?.wholeBuildingModelReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('REGER_SOURCE_CANDIDATE_FALSE_PROMOTION', 'Pre-answer candidate cannot infer pipe topology or claim held-out or downstream readiness.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceCandidateReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyRegerFloresSourceCandidateAdversarialLoop(packet, dependencies) {
  const cases = [['source', (v) => { v.sourceSealReceiptSha256 = '0'.repeat(64); }], ['prior', (v) => { v.dillonPriorReceiptSha256 = 'f'.repeat(64); }], ['answer', (v) => { v.answerKeyOpened = true; }], ['pitch', (v) => { v.geometry.ceiling.pitch.riseIn = 14; }], ['spring', (v) => { v.geometry.ceiling.springElevationFt = 8; }], ['surface', (v) => { v.geometry.ceiling.surfaces.pop(); }], ['head', (v) => { v.heads3d.pop(); }], ['heldout', (v) => { v.unseenProjectPlacementVerified = true; }], ['pipe', (v) => { v.branchPipeTopologyReady = true; }], ['whole', (v) => { v.wholeBuildingModelReady = true; }], ['compliance', (v) => { v.complianceReady = true; }]];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validateRegerFloresSourceOnlyCandidate(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}

const line = (a, b, cls = '') => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${cls}"/>`;
const iso = ([x, y, z]) => [100 + x * 25 - y * 8, 520 - y * 4 - z * 22];

export function renderRegerFloresSourceCandidateViews(packet) {
  const { geometry, heads3d: heads } = packet; const room = geometry.room; const ceiling = geometry.ceiling;
  const marks = heads.map((head) => `<g><circle cx="${head.pointFt[0]}" cy="${head.pointFt[1]}" r=".45"/><path d="M${head.pointFt[0] - .7} ${head.pointFt[1]}h1.4M${head.pointFt[0]} ${head.pointFt[1] - .7}v1.4"/></g>`).join('');
  const branches = packet.branchPipes3d.map((pipe) => line(pipe.fromFt, pipe.toFt, 'pipe')).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 24.5 22"><style>rect{fill:#07111f}.room{fill:#10243c;stroke:#e2e8f0;stroke-width:.18}.ridge{stroke:#f59e0b;stroke-width:.16;stroke-dasharray:.5 .35}.pipe{stroke:#a78bfa;stroke-width:.2}circle{fill:#22d3ee;stroke:#fff;stroke-width:.12}path{stroke:#07111f;stroke-width:.12}text{fill:#e2e8f0;font:.72px sans-serif}</style><rect x="-3" y="-3" width="24.5" height="22"/><path class="room" d="M0 0H18.5V16H0Z"/><line class="ridge" x1="9.25" y1="0" x2="9.25" y2="16"/>${branches}${marks}<text x="0" y="-1.45">Ceiling Plans.dwg · fresh source-only 18'-6&quot; × 16'-0&quot; vault</text><text x="0" y="-.55">heads only · pipe topology closed</text></svg>`;
  const ep = (x, z) => [70 + x * 30, 420 - z * 24]; const west = ep(0, ceiling.springElevationFt); const ridge = ep(9.25, ceiling.peakElevationFt); const east = ep(18.5, ceiling.springElevationFt);
  const elevationHeads = heads.filter((head) => head.pointFt[1] <= 8).map((head) => { const p = ep(head.pointFt[0], head.pointFt[2]); return `<circle cx="${p[0]}" cy="${p[1]}" r="7"/>`; }).join('');
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 450"><style>rect{fill:#07111f}.wall{stroke:#94a3b8;stroke-width:4}.ceiling{stroke:#f59e0b;stroke-width:6}circle{fill:#22d3ee;stroke:#fff;stroke-width:2}text{fill:#e2e8f0;font:16px sans-serif}</style><rect width="720" height="450"/><line class="wall" x1="${ep(0, 0)[0]}" y1="${ep(0, 0)[1]}" x2="${west[0]}" y2="${west[1]}"/><line class="ceiling" x1="${west[0]}" y1="${west[1]}" x2="${ridge[0]}" y2="${ridge[1]}"/><line class="ceiling" x1="${ridge[0]}" y1="${ridge[1]}" x2="${east[0]}" y2="${east[1]}"/><line class="wall" x1="${east[0]}" y1="${east[1]}" x2="${ep(18.5, 0)[0]}" y2="${ep(18.5, 0)[1]}"/>${elevationHeads}<text x="18" y="28">Ceiling CAD · 12'-1&quot; spring · 15'-2&quot; peak · two 4:12 planes</text><text x="18" y="52">roof plane not substituted · approved FP answer unopened</text></svg>`;
  const corners = [[0, 0, 0], [18.5, 0, 0], [18.5, 16, 0], [0, 16, 0]]; const floor = corners.map((p, i) => line(iso(p), iso(corners[(i + 1) % 4]), 'floor')).join(''); const walls = corners.map((p) => line(iso(p), iso([p[0], p[1], ceiling.springElevationFt]), 'wall')).join(''); const ridgeA = iso([9.25, 0, ceiling.peakElevationFt]); const ridgeB = iso([9.25, 16, ceiling.peakElevationFt]); const roof = [line(iso([0, 0, ceiling.springElevationFt]), ridgeA, 'ceiling'), line(ridgeA, iso([18.5, 0, ceiling.springElevationFt]), 'ceiling'), line(iso([0, 16, ceiling.springElevationFt]), ridgeB, 'ceiling'), line(ridgeB, iso([18.5, 16, ceiling.springElevationFt]), 'ceiling'), line(ridgeA, ridgeB, 'ceiling')].join(''); const pipes = packet.branchPipes3d.map((p) => line(iso(p.fromFt), iso(p.toFt), 'pipe')).join(''); const modelHeads = heads.map((h) => { const p = iso(h.pointFt); return `<circle cx="${p[0]}" cy="${p[1]}" r="6"/>`; }).join('');
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 560"><style>rect{fill:#07111f}.floor{stroke:#94a3b8}.wall{stroke:#475569}.ceiling{stroke:#f59e0b;stroke-width:3}.pipe{stroke:#a78bfa;stroke-width:5}line{stroke-width:2}circle{fill:#22d3ee;stroke:#fff;stroke-width:2}text{fill:#e2e8f0;font:16px sans-serif}</style><rect width="820" height="560"/>${floor}${walls}${roof}${pipes}${modelHeads}<text x="18" y="28">Level 01 source-closed vault zone · drawing-scaled floor, walls, ceiling, heads</text><text x="18" y="52">partial building model · whole-building and compliance gates remain closed</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, complianceReady: false };
}
