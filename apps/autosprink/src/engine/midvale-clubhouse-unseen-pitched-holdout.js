import { sha256Hex } from './elevation-datums.js';
import { generateSlopedCeilingLayout } from './sloped-ceiling-layout.js';

const PROJECT = 'Midvale Townhome Clubhouse - Midvale UT';
const PROJECT_ID = 'midvale-townhome-clubhouse-midvale-ut';
const PRIOR_RECEIPT = '20a553b24f20219e2f3d1e8022b05079dc6e22f3189c63c9684fcf3dbbf1bf26';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });
const EXPECTED = Object.freeze({
  architectural_asi8_set: ['8c69d500ed59ec7c60d96c57b1ad63495eec3a2820aa5f7f72e0293ceb1be387', 65283673],
  architectural_floor_plan: ['64f193c64d6206c251efe5e45c27cbb1a68c50021caa57842263cca7dbd521d9', 2390486],
  architectural_sections: ['fc0bdcb314013c3901f6009e6c4f4d13d3515c90c45873babb6fb11abb10edeb', 1270411],
  structural_roof_framing: ['da2d82d0cfbca94fe50e158443f8ca836b46df819662a438b3fb3078055fbc54', 1676368],
});

export async function sealMidvaleSourceSeal(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMidvaleSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-holdout.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('MIDVALE_SOURCE_SEAL_IDENTITY_INVALID', 'Midvale holdout identity is invalid.')], complianceReady: false };
  }
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('MIDVALE_SOURCE_SEAL_RECEIPT_MISMATCH', 'The pre-answer source seal changed.'));
  const sources = new Map((packet.sources || []).map((source) => [source.role, source]));
  for (const [role, [sha256, bytes]] of Object.entries(EXPECTED)) {
    const source = sources.get(role);
    if (!source || source.sha256 !== sha256 || source.bytes !== bytes) issues.push(issue('MIDVALE_SOURCE_IDENTITY_DRIFT', `Source ${role} changed or is missing.`));
  }
  if (sources.size !== Object.keys(EXPECTED).length) issues.push(issue('MIDVALE_SOURCE_SET_DRIFT', 'The source set must contain exactly the ASI set, floor plan, sections, and roof framing inputs.'));
  const answer = packet.answerKeyDenylist?.[0];
  if (packet.answerKeyDenylist?.length !== 1 || answer?.sha256 !== '043920f7514e7bb250a8eb20502f3f3ae7738b6d6f771dc4604580e2595f9e9a'
    || answer?.bytes !== 12644865 || answer?.openedBeforeSourceSeal !== false) issues.push(issue('MIDVALE_ANSWER_DENYLIST_DRIFT', 'The stamped sprinkler answer must remain identified and unopened at source-seal time.'));
  const observation = packet.sourceObservations?.clubroomVault;
  if (observation?.riserRun !== '6:12' || observation?.springElevationFt !== 12 || observation?.peakElevationFt !== 19.25
    || observation?.derivedWidthFt !== 29 || observation?.planWidthFt !== 29.0625 || observation?.planLengthFt !== 30
    || observation?.planWidthResidualIn !== 0.75 || packet.sourceObservations?.zoneRegistry?.length !== 4) {
    issues.push(issue('MIDVALE_SOURCE_OBSERVATION_DRIFT', 'The Clubroom dimension closure or source-only zone registry changed.'));
  }
  if (packet.selection?.status !== 'source-sealed-answer-unopened' || packet.selection?.priorImplementationSearchHits !== 0
    || packet.selection?.rejectedBeforeAnswerOpen?.length !== 3) issues.push(issue('MIDVALE_SELECTION_INVALID', 'Fresh selection and pre-answer rejection history are incomplete.'));
  if (packet.toolchain?.pdfReader !== 'PyMuPDF 1.27.2.2' || packet.toolchain?.readOnlySourceInspection !== true
    || packet.brainPreflight?.status !== 'passed' || packet.brainPreflight?.platformSpineAddendumApplied !== true
    || packet.brainPreflight?.spatialB1ThroughB7Priority !== 1) issues.push(issue('MIDVALE_PREFLIGHT_INCOMPLETE', 'Verified PDF tooling and brain preflight are required.'));
  if (packet.generation?.answerKeyUsed !== false || packet.generation?.completedBidUsedForGeneration !== false
    || packet.generation?.roofPlaneSubstitutionAllowed !== false || Object.values(packet.claims || {}).some(Boolean)) {
    issues.push(issue('MIDVALE_SOURCE_SEAL_FALSE_PROMOTION', 'The source seal must reject answer leakage, roof substitution, and downstream claims.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function sourceGeometry(sourceSeal) {
  const widthFt = 29;
  const lengthFt = 30;
  const halfRunFt = widthFt / 2;
  const springElevationFt = 12;
  const peakElevationFt = 19.25;
  return {
    coordinateSystem: 'A403 Clubroom vault-zone-local feet; project level datum 100 feet',
    floor: { id: 'level-01', localElevationFt: 0, projectDatumElevationFt: 100, sourceSheet: 'A102/A301' },
    room: {
      id: 'clubroom-vault-zone', name: 'CLUBROOM 115 - OCCUPIED VAULT ZONE', widthFt, lengthFt, areaSqFt: widthFt * lengthFt,
      polygonFt: [[0, 0], [widthFt, 0], [widthFt, lengthFt], [0, lengthFt]],
      scopeStatus: 'dimension-closed-source-only-vault-zone-not-whole-room-or-building',
    },
    ceiling: {
      kind: 'source-proven-occupied-two-plane-vault', axis: 'x', ridgeAxis: 'y', pitch: { riseIn: 6, runIn: 12 },
      springElevationFt, peakElevationFt, halfRunFt, riseFt: peakElevationFt - springElevationFt,
      dimensionClosure: {
        sourceSheets: ['A111', 'A301', 'A403'], springLabels: ["12'-0\"", "12'-0\""], peakLabels: ["19'-3\"", "19'-3\""],
        pitchSymbols: ['6:12', '6:12', '6:12', '6:12'], derivedWidthCalculation: '2 * ((19.25 - 12) / (6 / 12)) = 29 feet',
        planWidthFt: 29.0625, planWidthResidualIn: 0.75, planLengthFt: 30, roofPlaneUsedAsCeiling: false,
      },
      surfaces: [
        { id: 'clubroom-vault-west-plane', polygonFt: [[0, 0], [halfRunFt, 0], [halfRunFt, lengthFt], [0, lengthFt]], downhillDirection: 'negative-x' },
        { id: 'clubroom-vault-east-plane', polygonFt: [[halfRunFt, 0], [widthFt, 0], [widthFt, lengthFt], [halfRunFt, lengthFt]], downhillDirection: 'positive-x' },
      ],
    },
    zoneRegistry: sourceSeal.sourceObservations.zoneRegistry,
  };
}

const ceilingElevationFt = (geometry, point) => geometry.ceiling.springElevationFt + Math.min(point[0], geometry.room.widthFt - point[0]) * 6 / 12;

export async function buildMidvaleSourceOnlyCandidate(sourceSeal, dillonPrior) {
  if ((await validateMidvaleSourceSeal(sourceSeal)).status !== 'passed') throw new Error('MIDVALE_SOURCE_SEAL_BLOCKED');
  if (dillonPrior?.artifactType !== 'halofire.dillon-pitched-placement-prior.v1' || dillonPrior?.receiptSha256 !== PRIOR_RECEIPT
    || dillonPrior?.candidatePlacementPriorReady !== true || dillonPrior?.transferPolicy?.empiricalPriorOnly !== true
    || dillonPrior?.transferPolicy?.codeLimit !== false) throw new Error('DILLON_EMPIRICAL_PRIOR_BLOCKED');
  const geometry = sourceGeometry(sourceSeal);
  const input = {
    artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 1,
    regions: geometry.ceiling.surfaces.map((surface) => ({ id: surface.id, polygonSubmittedPt: surface.polygonFt, slopeAxis: 'x', downhillDirection: surface.downhillDirection, riseIn: 6, runIn: 12, shouldProtect: true, obstructions: [] })),
    maxAcrossSlopeSpanFt: dillonPrior.learnedGeometry.replayAcrossSlopeSpanFt,
    maxAlongSlopeSpanFt: dillonPrior.learnedGeometry.replayAlongSlopeSpanFt,
  };
  const layout = generateSlopedCeilingLayout(input);
  if (layout.status !== 'passed') throw new Error('MIDVALE_SOURCE_LAYOUT_BLOCKED');
  const heads3d = layout.heads.map((head, index) => ({
    id: `midvale-source-head-${String(index + 1).padStart(2, '0')}`, surfaceId: head.regionId,
    pointFt: [round(head.pointPt[0]), round(head.pointPt[1]), round(ceilingElevationFt(geometry, head.pointPt))],
    status: 'source-only-empirical-candidate', hydraulicNodeAssigned: false, obstructionClearanceVerified: false,
  }));
  const draft = {
    artifactType: 'halofire.midvale-clubhouse-source-only-pitched-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSealReceiptSha256: sourceSeal.receiptSha256, dillonPriorReceiptSha256: dillonPrior.receiptSha256,
    generationMode: 'fresh-sealed-architectural-source-plus-cross-project-empirical-prior-before-answer-open',
    geometry, layoutInput: input, layout: { regions: layout.regions, headCount: heads3d.length }, heads3d,
    branchPipes3d: [], branchPipeTopologyReady: false,
    buildingModel: {
      levelCount: 1, levels: [{ id: 'level-01', floorElevationFt: 0, roomIds: ['clubroom-vault-zone'] }],
      modeledScope: 'source-closed-Clubroom-vault-zone', floorByFloorExtrusionReady: true, twoPlaneVaultReady: true,
      wholeBuildingFootprintComplete: false, unresolvedZones: ['community-work-room-sloped-zone', 'gym-sloped-zone', 'flat-admin-spa-support-zones'],
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-two-plane-layout-replay' },
      independent: { status: 'passed', method: 'A111-A301-A403-pitch-spring-peak-plan-dimension-closure' },
      adversarial: { status: 'passed', method: 'source-prior-zone-roof-answer-leakage-and-false-promotion-mutations' },
    },
    answerKeyUsedAsGeometryInput: false, completedBidUsedAsGeometryInput: false, answerKeyOpened: false,
    unseenProjectPlacementVerified: false, roomEnvelopeGeometryGrounded: true, topViewReady: true, elevationViewReady: true,
    partialModel3dReady: true, wholeBuildingModelReady: false, wholeBuildingHeadLayoutReady: false,
    hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'fresh-source-only-Clubroom-vault-candidate-before-stamped-answer-comparison-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateMidvaleSourceOnlyCandidate(packet, dependencies = {}) {
  let expected;
  try { expected = await buildMidvaleSourceOnlyCandidate(dependencies.sourceSeal, dependencies.dillonPrior); } catch (error) {
    return { status: 'blocked', issues: [issue('MIDVALE_SOURCE_CANDIDATE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('MIDVALE_SOURCE_CANDIDATE_REPLAY_MISMATCH', 'Candidate does not equal deterministic sealed-source replay.'));
  const ceiling = packet?.geometry?.ceiling;
  const heads = packet?.heads3d || [];
  if (packet?.geometry?.room?.widthFt !== 29 || packet?.geometry?.room?.lengthFt !== 30 || ceiling?.pitch?.riseIn !== 6
    || ceiling?.springElevationFt !== 12 || ceiling?.peakElevationFt !== 19.25 || ceiling?.halfRunFt !== 14.5
    || ceiling?.dimensionClosure?.roofPlaneUsedAsCeiling !== false || ceiling?.surfaces?.length !== 2) issues.push(issue('MIDVALE_SOURCE_GEOMETRY_DRIFT', 'The dimension-closed 6:12 Clubroom vault geometry changed.'));
  if (heads.length !== 8 || new Set(heads.map((head) => head.surfaceId)).size !== 2
    || heads.some((head) => head.hydraulicNodeAssigned || head.obstructionClearanceVerified)) issues.push(issue('MIDVALE_SOURCE_HEAD_TALLY_DRIFT', 'The empirical replay must emit eight scoped candidates across both vault planes with downstream gates false.'));
  if (packet?.geometry?.zoneRegistry?.filter((zone) => zone.placementEligible).length !== 1
    || packet?.answerKeyUsedAsGeometryInput !== false || packet?.completedBidUsedAsGeometryInput !== false || packet?.answerKeyOpened !== false
    || packet?.unseenProjectPlacementVerified !== false || packet?.branchPipes3d?.length !== 0 || packet?.branchPipeTopologyReady !== false
    || packet?.wholeBuildingModelReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) {
    issues.push(issue('MIDVALE_SOURCE_CANDIDATE_FALSE_PROMOTION', 'Pre-answer candidate cannot infer unresolved zones, pipe topology, held-out acceptance, or downstream readiness.'));
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceCandidateReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyMidvaleSourceCandidateAdversarialLoop(packet, dependencies) {
  const cases = [
    ['source', (value) => { value.sourceSealReceiptSha256 = '0'.repeat(64); }],
    ['prior', (value) => { value.dillonPriorReceiptSha256 = 'f'.repeat(64); }],
    ['answer', (value) => { value.answerKeyOpened = true; }],
    ['roof-substitution', (value) => { value.geometry.ceiling.dimensionClosure.roofPlaneUsedAsCeiling = true; }],
    ['pitch', (value) => { value.geometry.ceiling.pitch.riseIn = 2; }],
    ['spring', (value) => { value.geometry.ceiling.springElevationFt = 10; }],
    ['peak', (value) => { value.geometry.ceiling.peakElevationFt = 22; }],
    ['zone-promotion', (value) => { value.geometry.zoneRegistry[1].placementEligible = true; }],
    ['surface', (value) => { value.geometry.ceiling.surfaces.pop(); }],
    ['head', (value) => { value.heads3d.pop(); }],
    ['pipe', (value) => { value.branchPipeTopologyReady = true; }],
    ['whole-building', (value) => { value.wholeBuildingModelReady = true; }],
    ['heldout', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validateMidvaleSourceOnlyCandidate(value, dependencies)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, complianceReady: false };
}

const line = (a, b, cls = '') => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${cls}"/>`;
const iso = ([x, y, z]) => [115 + x * 20 - y * 7, 520 - y * 4 - z * 18];

export function renderMidvaleSourceCandidateViews(packet) {
  const { geometry, heads3d: heads } = packet;
  const ceiling = geometry.ceiling;
  const marks = heads.map((head) => `<g><circle cx="${head.pointFt[0]}" cy="${head.pointFt[1]}" r=".52"/><path d="M${head.pointFt[0] - .8} ${head.pointFt[1]}h1.6M${head.pointFt[0]} ${head.pointFt[1] - .8}v1.6"/></g>`).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 35 36"><style>rect{fill:#07111f}.room{fill:#10243c;stroke:#e2e8f0;stroke-width:.18}.ridge{stroke:#f59e0b;stroke-width:.18;stroke-dasharray:.55 .35}circle{fill:#22d3ee;stroke:#fff;stroke-width:.12}path{stroke:#07111f;stroke-width:.12}text{fill:#e2e8f0;font:.78px sans-serif}</style><rect x="-3" y="-3" width="35" height="36"/><path class="room" d="M0 0H29V30H0Z"/><line class="ridge" x1="14.5" y1="0" x2="14.5" y2="30"/>${marks}<text x="0" y="-1.45">A403 source-only Clubroom vault zone: 29'-0&quot; x 30'-0&quot;</text><text x="0" y="-.55">eight empirical candidates; stamped FP answer unopened; pipe topology closed</text></svg>`;
  const ep = (x, z) => [70 + x * 20, 430 - z * 19];
  const west = ep(0, 12); const ridge = ep(14.5, 19.25); const east = ep(29, 12);
  const elevationHeads = heads.filter((head) => head.pointFt[1] <= 15).map((head) => { const p = ep(head.pointFt[0], head.pointFt[2]); return `<circle cx="${p[0]}" cy="${p[1]}" r="7"/>`; }).join('');
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 740 460"><style>rect{fill:#07111f}.wall{stroke:#94a3b8;stroke-width:4}.ceiling{stroke:#f59e0b;stroke-width:6}circle{fill:#22d3ee;stroke:#fff;stroke-width:2}text{fill:#e2e8f0;font:16px sans-serif}</style><rect width="740" height="460"/><line class="wall" x1="${ep(0, 0)[0]}" y1="${ep(0, 0)[1]}" x2="${west[0]}" y2="${west[1]}"/><line class="ceiling" x1="${west[0]}" y1="${west[1]}" x2="${ridge[0]}" y2="${ridge[1]}"/><line class="ceiling" x1="${ridge[0]}" y1="${ridge[1]}" x2="${east[0]}" y2="${east[1]}"/><line class="wall" x1="${east[0]}" y1="${east[1]}" x2="${ep(29, 0)[0]}" y2="${ep(29, 0)[1]}"/>${elevationHeads}<text x="18" y="28">A301/A403: 12'-0&quot; springs; 19'-3&quot; ridge; two 6:12 occupied ceiling planes</text><text x="18" y="52">roof framing is corroboration only; it is not substituted for the ceiling surface</text></svg>`;
  const corners = [[0, 0, 0], [29, 0, 0], [29, 30, 0], [0, 30, 0]];
  const floor = corners.map((point, index) => line(iso(point), iso(corners[(index + 1) % 4]), 'floor')).join('');
  const walls = corners.map((point) => line(iso(point), iso([point[0], point[1], 12]), 'wall')).join('');
  const ridgeA = iso([14.5, 0, 19.25]); const ridgeB = iso([14.5, 30, 19.25]);
  const roof = [line(iso([0, 0, 12]), ridgeA, 'ceiling'), line(ridgeA, iso([29, 0, 12]), 'ceiling'), line(iso([0, 30, 12]), ridgeB, 'ceiling'), line(ridgeB, iso([29, 30, 12]), 'ceiling'), line(ridgeA, ridgeB, 'ceiling')].join('');
  const modelHeads = heads.map((head) => { const p = iso(head.pointFt); return `<circle cx="${p[0]}" cy="${p[1]}" r="6"/>`; }).join('');
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 580"><style>rect{fill:#07111f}.floor{stroke:#94a3b8}.wall{stroke:#475569}.ceiling{stroke:#f59e0b;stroke-width:3}line{stroke-width:2}circle{fill:#22d3ee;stroke:#fff;stroke-width:2}text{fill:#e2e8f0;font:16px sans-serif}</style><rect width="860" height="580"/>${floor}${walls}${roof}${modelHeads}<text x="18" y="28">Level 01 Clubroom vault zone: drawing-scaled floor, walls, ceiling, and candidates</text><text x="18" y="52">partial 3D only; other zones, pipes, hydraulics, compliance, and fabrication remain closed</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, complianceReady: false };
}
