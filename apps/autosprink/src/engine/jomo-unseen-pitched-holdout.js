import { sha256Hex } from './elevation-datums.js';
import { generateSlopedCeilingLayout } from './sloped-ceiling-layout.js';

const PROJECT = 'JOMO Residence - Wanship UT';
const PROJECT_ID = 'jomo-residence-wanship-ut';
const PRIOR_RECEIPT = '20a553b24f20219e2f3d1e8022b05079dc6e22f3189c63c9684fcf3dbbf1bf26';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });

const EXPECTED_SOURCES = Object.freeze({
  architectural_bid_set: ['ac0321e24a1defb2fc5a5a3b6868657c8123f114e625c13e86acafd21204be09', 28402305],
  first_floor_cad: ['dd06096137a8ace2b89a559c118bf7dd43d3d79b9aef20e3bf837d16f5e23263', 1081823],
  reflected_ceiling_cad: ['5333242c066a43d85ec188b8e6ae3be6925bd2746f97337525eb6ebeeb012a78', 896545],
  roof_plan_cad: ['87e42077c3466902ba44883497ac7d7b92bd9e076446be2cf7ec7d4af7fd8db3', 784102],
  building_section_b_cad: ['e96fb00dc86ce218baee19e623d56fed28cf85f8e61b762212e068d3b0d8ce56', 884269],
  building_section_d_cad: ['3e19193dddf5f0e513f40a872c247c063085ddba8344a94cee1bb0549593060f', 331786],
  building_section_e_cad: ['5e74d18dd83837b1d659d38ab4df2005335b511c9dc41ca43746f2becdb3a837', 279556],
  east_elevation_cad: ['663930577461f598fd654792c8019ec4784ed99f1bab6c3bf2f2be560928c400', 247476],
  north_elevation_cad: ['c37875442667ae5a04cf47ae09fea81b36f4f274eaad95c6f6752f798efa11a4', 165846],
  south_elevation_cad: ['d973ef0250c00ed10c2a00c31ff3d2b89ecebf58a46c4b10d12023c84f781014', 155611],
  west_elevation_cad: ['d4a4d7db3ef3d92fbd5a55e489b2d3ed9a1192e33676a5a1f3f5b68f64222536', 244743],
});

const ANSWER = Object.freeze({
  sha256: 'ad1639fb83f4dc433492c1918e9a813c898f918d430ac9643fa845cded30f67b',
  bytes: 1447182,
});

export async function validateJomoSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-holdout.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) {
    return { status: 'blocked', issues: [issue('JOMO_SOURCE_SEAL_IDENTITY_INVALID', 'JOMO holdout identity is invalid.')], sourceSealReady: false, complianceReady: false };
  }
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('JOMO_SOURCE_SEAL_RECEIPT_MISMATCH', 'The pre-answer source seal changed.'));
  const byRole = new Map((packet.sources || []).map((source) => [source.role, source]));
  for (const [role, [sha256, bytes]] of Object.entries(EXPECTED_SOURCES)) {
    const source = byRole.get(role);
    if (!source || source.sha256 !== sha256 || source.bytes !== bytes) issues.push(issue('JOMO_SOURCE_IDENTITY_DRIFT', `Source ${role} changed or is missing.`));
  }
  if (byRole.size !== Object.keys(EXPECTED_SOURCES).length) issues.push(issue('JOMO_SOURCE_SET_DRIFT', 'The sealed source set is not exact.'));
  const answer = packet.answerKeyDenylist?.[0];
  if (packet.answerKeyDenylist?.length !== 1 || answer?.sha256 !== ANSWER.sha256 || answer?.bytes !== ANSWER.bytes || answer?.openedBeforeSourceSeal !== false) issues.push(issue('JOMO_ANSWER_DENYLIST_DRIFT', 'The completed answer must remain identified and unopened at source seal time.'));
  if (packet.selection?.status !== 'source-sealed-answer-unopened' || packet.selection?.priorImplementationSearchHits !== 0 || packet.selection?.rejectedBeforeAnswerOpen?.length < 5) issues.push(issue('JOMO_HOLDOUT_SELECTION_INVALID', 'The unseen selection and pre-answer rejection record must remain intact.'));
  if (packet.toolchain?.releaseDigestVerified !== true || packet.brainPreflight?.status !== 'passed' || packet.brainPreflight?.platformSpineAddendumApplied !== true || packet.brainPreflight?.spatialB1ThroughB7Priority !== 1) issues.push(issue('JOMO_PREFLIGHT_INCOMPLETE', 'Verified DWG tooling, brain preflight, and spatial priority are required.'));
  if (packet.generation?.answerKeyUsed !== false || packet.generation?.completedBidUsedForGeneration !== false || packet.generation?.dillonEmpiricalPriorAllowed !== true) issues.push(issue('JOMO_PREANSWER_LEAKAGE', 'Generation controls no longer prove source-only operation.'));
  if (Object.values(packet.claims || {}).some(Boolean)) issues.push(issue('JOMO_SOURCE_SEAL_FALSE_PROMOTION', 'The source seal cannot promote design, compliance, fabrication, or field claims.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function sourceGeometry() {
  const widthFt = 44.125;
  const areaSqFt = 788.5;
  const depthFt = areaSqFt / widthFt;
  const halfDepthFt = depthFt / 2;
  const springElevationFt = 10;
  const ridgeElevationFt = 16;
  const riseFt = ridgeElevationFt - springElevationFt;
  const derivedRiseInPer12 = riseFt / halfDepthFt * 12;
  return {
    coordinateSystem: 'A.01 room-local feet with first-floor datum 0.00 ft',
    floor: { id: 'level-01', elevationFt: 0, sourceSheet: 'A.01', sourcePhysicalPage: 5 },
    room: {
      id: 'great-room', name: 'GREAT ROOM', areaSqFt, widthFt, depthFt: round(depthFt),
      polygonFt: [[0, 0], [widthFt, 0], [widthFt, round(depthFt)], [0, round(depthFt)]],
      sourceObservations: [
        { sheet: 'A.01', physicalPage: 5, observation: 'GREAT ROOM area 788.5 square feet and 44 foot 1-1/2 inch long dimension' },
        { sheet: 'A.03', physicalPage: 7, observation: 'GREAT ROOM CLG 16 feet with keynote 09.07 VAULTED CEILING' },
        { sheet: 'A.05', physicalPage: 9, observation: 'BUILDING SECTION A cuts the GREAT ROOM, shows two interior sloped ceiling planes, and binds their spring to the dimensioned +10 foot top-of-wall datum' },
      ],
    },
    ceiling: {
      kind: 'source-proven-two-plane-vault',
      pitch: { riseIn: round(derivedRiseInPer12), runIn: 12, normalizedDrawingRiseIn: 8 }, axis: 'y', ridgeAxis: 'x',
      springElevationFt: round(springElevationFt), ridgeElevationFt, halfRunFt: round(halfDepthFt), riseFt: round(riseFt),
      pitchDerivation: {
        method: 'dimension-authority-not-scaled-roof-graphic',
        halfRunSource: 'A.01 788.5 square foot area divided by 44 foot 1-1/2 inch length then halved',
        springSource: 'A.05 Section A +10 foot top-of-wall datum',
        ridgeSource: 'A.03 GREAT ROOM CLG 16 foot label and vaulted ceiling keynote',
        rawRiseInPer12: round(derivedRiseInPer12), normalizedDrawingRiseIn: 8,
        rejectedRoofGraphicRiseInPer12: 10,
      },
      surfaces: [
        { id: 'great-room-south-plane', polygonFt: [[0, 0], [widthFt, 0], [widthFt, round(halfDepthFt)], [0, round(halfDepthFt)]], downhillDirection: 'negative-y' },
        { id: 'great-room-north-plane', polygonFt: [[0, round(halfDepthFt)], [widthFt, round(halfDepthFt)], [widthFt, round(depthFt)], [0, round(depthFt)]], downhillDirection: 'positive-y' },
      ],
    },
  };
}

function ceilingElevationFt(geometry, point) {
  const half = geometry.ceiling.halfRunFt;
  const distanceFromWall = point[1] <= half ? point[1] : geometry.room.depthFt - point[1];
  return geometry.ceiling.springElevationFt + distanceFromWall * geometry.ceiling.riseFt / geometry.ceiling.halfRunFt;
}

export async function buildJomoSourceOnlyCandidate(sourceSeal, dillonPrior) {
  const sourceValidation = await validateJomoSourceSeal(sourceSeal);
  if (sourceValidation.status !== 'passed') throw new Error('JOMO_SOURCE_SEAL_BLOCKED');
  if (dillonPrior?.artifactType !== 'halofire.dillon-pitched-placement-prior.v1' || dillonPrior?.receiptSha256 !== PRIOR_RECEIPT || dillonPrior?.candidatePlacementPriorReady !== true || dillonPrior?.transferPolicy?.empiricalPriorOnly !== true || dillonPrior?.transferPolicy?.codeLimit !== false || dillonPrior?.transferPolicy?.protectionLabelTransferAllowed !== false) throw new Error('DILLON_EMPIRICAL_PRIOR_BLOCKED');
  const geometry = sourceGeometry();
  const input = {
    artifactType: 'halofire.sloped-ceiling-layout-input.v1', printedScalePtPerFt: 1,
    regions: geometry.ceiling.surfaces.map((surface) => ({
      id: surface.id, polygonSubmittedPt: surface.polygonFt, slopeAxis: 'y', downhillDirection: surface.downhillDirection,
      riseIn: geometry.ceiling.pitch.riseIn, runIn: 12, shouldProtect: true, obstructions: [],
    })),
    maxAcrossSlopeSpanFt: dillonPrior.learnedGeometry.replayAcrossSlopeSpanFt,
    maxAlongSlopeSpanFt: dillonPrior.learnedGeometry.replayAlongSlopeSpanFt,
  };
  const layout = generateSlopedCeilingLayout(input);
  if (layout.status !== 'passed') throw new Error('JOMO_SOURCE_LAYOUT_BLOCKED');
  const heads3d = layout.heads.map((head, index) => ({
    id: `jomo-source-head-${String(index + 1).padStart(2, '0')}`, surfaceId: head.regionId,
    pointFt: [round(head.pointPt[0]), round(head.pointPt[1]), round(ceilingElevationFt(geometry, head.pointPt))],
    status: 'source-only-empirical-candidate', hydraulicNodeAssigned: false, obstructionClearanceVerified: false,
  }));
  const branchPipes3d = geometry.ceiling.surfaces.map((surface) => {
    const heads = heads3d.filter((head) => head.surfaceId === surface.id).sort((a, b) => a.pointFt[0] - b.pointFt[0]);
    return { id: `${surface.id}-candidate-branch`, surfaceId: surface.id, fromFt: heads[0].pointFt, toFt: heads.at(-1).pointFt, nominalSizeIn: null, status: 'candidate-topology-no-hydraulic-size' };
  });
  const draft = {
    artifactType: 'halofire.jomo-source-only-pitched-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSealReceiptSha256: sourceSeal.receiptSha256, dillonPriorReceiptSha256: dillonPrior.receiptSha256,
    generationMode: 'sealed-architectural-source-plus-cross-project-empirical-prior-post-heldout-correction',
    geometry, layoutInput: input, layout: { regions: layout.regions, headCount: layout.heads.length }, heads3d, branchPipes3d,
    buildingModel: {
      levelCount: 1, levels: [{ id: 'level-01', floorElevationFt: 0, roomIds: ['great-room'] }],
      modeledScope: 'source-closed-great-room-envelope', wholeBuildingFootprintComplete: false,
      floorByFloorExtrusionReady: true, twoPlaneVaultReady: true,
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic-two-plane-layout-replay' },
      independent: { status: 'passed', method: 'area-dimension-pitch-and-ridge-recalculation' },
      adversarial: { status: 'passed', method: 'source-prior-answer-leakage-and-false-promotion-mutations' },
    },
    correctionLoop: {
      preAnswerCandidateReceiptSha256: '68364be6a6efe932b5a99eccb296d6a912bf100ad93ac9d0b48dfa895482c367',
      preAnswerPlanTopologyMatched: true,
      preAnswerElevationFailed: true,
      rejectedDefect: 'roof-pitch-substituted-for-dimension-derived-ceiling-pitch',
      answerKeyExposedBeforeCurrentImplementation: true,
      freshHoldoutRequired: true,
    },
    answerKeyUsedAsGeometryInput: false, completedBidUsedAsGeometryInput: false, unseenProjectPlacementVerified: false,
    roomEnvelopeGeometryGrounded: true, topViewReady: true, elevationViewReady: true, partialModel3dReady: true,
    wholeBuildingModelReady: false, wholeBuildingHeadLayoutReady: false, hydraulicCalculationReady: false,
    complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    claimStatus: 'source-derived-post-heldout-correction-requires-fresh-unseen-project-not-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateJomoSourceOnlyCandidate(packet, { sourceSeal, dillonPrior } = {}) {
  const issues = [];
  let expected;
  try { expected = await buildJomoSourceOnlyCandidate(sourceSeal, dillonPrior); } catch (error) {
    return { status: 'blocked', issues: [issue('JOMO_SOURCE_CANDIDATE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false };
  }
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || receiptSha256 !== expected.receiptSha256) issues.push(issue('JOMO_SOURCE_CANDIDATE_RECEIPT_MISMATCH', 'Candidate or dependency binding changed.'));
  if (JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('JOMO_SOURCE_CANDIDATE_REPLAY_MISMATCH', 'Candidate does not equal deterministic source replay.'));
  const geometry = packet?.geometry; const heads = packet?.heads3d || [];
  if (geometry?.room?.areaSqFt !== 788.5 || geometry?.room?.widthFt !== 44.125 || Math.abs(geometry?.room?.widthFt * geometry?.room?.depthFt - 788.5) > 0.01 || Math.abs(geometry?.ceiling?.pitch?.riseIn - 8.059) > 0.002 || geometry?.ceiling?.pitch?.normalizedDrawingRiseIn !== 8 || geometry?.ceiling?.springElevationFt !== 10 || geometry?.ceiling?.ridgeElevationFt !== 16 || geometry?.ceiling?.pitchDerivation?.rejectedRoofGraphicRiseInPer12 !== 10 || geometry?.ceiling?.surfaces?.length !== 2) issues.push(issue('JOMO_SOURCE_GEOMETRY_DRIFT', 'Great Room dimensions or the dimension-derived 10-to-16 foot two-plane vault changed.'));
  if (heads.length !== 6 || new Set(heads.map((head) => head.id)).size !== 6 || new Set(heads.map((head) => head.surfaceId)).size !== 2 || heads.some((head) => head.hydraulicNodeAssigned || head.obstructionClearanceVerified)) issues.push(issue('JOMO_SOURCE_HEAD_TALLY_DRIFT', 'The empirical replay must emit three candidates on each source ceiling plane with downstream gates false.'));
  if (packet?.answerKeyUsedAsGeometryInput !== false || packet?.completedBidUsedAsGeometryInput !== false || packet?.correctionLoop?.answerKeyExposedBeforeCurrentImplementation !== true || packet?.correctionLoop?.freshHoldoutRequired !== true || packet?.unseenProjectPlacementVerified !== false || packet?.wholeBuildingModelReady !== false || packet?.wholeBuildingHeadLayoutReady !== false || packet?.hydraulicCalculationReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('JOMO_SOURCE_CANDIDATE_FALSE_PROMOTION', 'Post-answer correction must disclose exposure, require a fresh holdout, and keep downstream readiness false.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : packet, sourceCandidateReady: issues.length === 0, unseenProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyJomoSourceCandidateAdversarialLoop(packet, dependencies) {
  const mutations = [
    ['source-receipt', (value) => { value.sourceSealReceiptSha256 = '0'.repeat(64); }],
    ['prior-receipt', (value) => { value.dillonPriorReceiptSha256 = 'f'.repeat(64); }],
    ['answer-input-leakage', (value) => { value.answerKeyUsedAsGeometryInput = true; }],
    ['heldout-premature-pass', (value) => { value.unseenProjectPlacementVerified = true; }],
    ['pitch', (value) => { value.geometry.ceiling.pitch.riseIn = 3; }],
    ['surface-collapse', (value) => { value.geometry.ceiling.surfaces.pop(); }],
    ['head-removal', (value) => { value.heads3d.pop(); }],
    ['whole-building-promotion', (value) => { value.wholeBuildingModelReady = true; }],
    ['compliance-promotion', (value) => { value.complianceReady = true; }],
    ['receipt', (value) => { value.receiptSha256 = 'a'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of mutations) {
    const candidate = structuredClone(packet); mutate(candidate);
    const result = await validateJomoSourceOnlyCandidate(candidate, dependencies);
    if (result.status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === mutations.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: mutations.length, complianceReady: false };
}

function line(a, b, attrs = '') { return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" ${attrs}/>`; }
function iso([x, y, z]) { return [90 + x * 15 - y * 6, 500 - y * 3.2 - z * 20]; }

export function renderJomoSourceCandidateViews(packet) {
  const geometry = packet.geometry; const room = geometry.room; const heads = packet.heads3d;
  const topHeads = heads.map((head) => `<g><circle cx="${head.pointFt[0]}" cy="${head.pointFt[1]}" r=".42"/><path d="M ${head.pointFt[0] - .65} ${head.pointFt[1]}h1.3M${head.pointFt[0]} ${head.pointFt[1] - .65}v1.3"/></g>`).join('');
  const topBranches = packet.branchPipes3d.map((pipe) => line(pipe.fromFt, pipe.toFt)).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${room.widthFt + 8} ${room.depthFt + 8}" role="img" aria-label="JOMO source-only pitched candidate top view"><style>rect{fill:#07111f}.room{fill:#0f2138;stroke:#e2e8f0;stroke-width:.22}.ridge{stroke:#f59e0b;stroke-width:.18;stroke-dasharray:.6 .4}line{stroke:#a78bfa;stroke-width:.22}circle{fill:#22d3ee;stroke:#fff;stroke-width:.12}path{stroke:#07111f;stroke-width:.12}text{fill:#e2e8f0;font:1.2px sans-serif}</style><rect x="-4" y="-4" width="${room.widthFt + 8}" height="${room.depthFt + 8}"/><path class="room" d="M0 0H${room.widthFt}V${room.depthFt}H0Z"/><line class="ridge" x1="0" y1="${geometry.ceiling.halfRunFt}" x2="${room.widthFt}" y2="${geometry.ceiling.halfRunFt}"/>${topBranches}${topHeads}<text x="1" y="-1.2">A.01/A.03 source room · 44'-1 1/2&quot; × ${room.depthFt.toFixed(2)}' · 788.5 sf</text></svg>`;
  const yScale = 30; const zScale = 22; const ox = 80; const oy = 390;
  const ep = (y, z) => [ox + y * yScale, oy - z * zScale];
  const south = ep(0, geometry.ceiling.springElevationFt), ridge = ep(geometry.ceiling.halfRunFt, 16), north = ep(room.depthFt, geometry.ceiling.springElevationFt);
  const elevationHeads = heads.filter((head) => head.pointFt[0] < 10).map((head) => { const p = ep(head.pointFt[1], head.pointFt[2]); return `<circle cx="${p[0]}" cy="${p[1]}" r="7"/>`; }).join('');
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 450" role="img" aria-label="JOMO source-only pitched candidate elevation"><style>rect{fill:#07111f}.floor,.wall{stroke:#94a3b8;stroke-width:4}.ceiling{stroke:#f59e0b;stroke-width:6}circle{fill:#22d3ee;stroke:#fff;stroke-width:2}text{fill:#e2e8f0;font:16px sans-serif}</style><rect width="720" height="450"/><line class="floor" x1="${ep(0, 0)[0]}" y1="${ep(0, 0)[1]}" x2="${ep(room.depthFt, 0)[0]}" y2="${ep(room.depthFt, 0)[1]}"/><line class="wall" x1="${ep(0, 0)[0]}" y1="${ep(0, 0)[1]}" x2="${south[0]}" y2="${south[1]}"/><line class="wall" x1="${ep(room.depthFt, 0)[0]}" y1="${ep(room.depthFt, 0)[1]}" x2="${north[0]}" y2="${north[1]}"/><line class="ceiling" x1="${south[0]}" y1="${south[1]}" x2="${ridge[0]}" y2="${ridge[1]}"/><line class="ceiling" x1="${ridge[0]}" y1="${ridge[1]}" x2="${north[0]}" y2="${north[1]}"/>${elevationHeads}<text x="20" y="28">A.03/A.05 dimensional replay · +10.00' spring · 16.00' ridge · 8.059:12</text><text x="20" y="52">candidate head elevation ${heads[0].pointFt[2].toFixed(2)}' · roof graphic rejected as ceiling datum</text></svg>`;
  const corners = [[0, 0, 0], [room.widthFt, 0, 0], [room.widthFt, room.depthFt, 0], [0, room.depthFt, 0]];
  const floorLines = corners.map((point, index) => line(iso(point), iso(corners[(index + 1) % 4]), 'class="floor"')).join('');
  const wallLines = corners.map((point) => line(iso(point), iso([point[0], point[1], geometry.ceiling.springElevationFt]), 'class="wall"')).join('');
  const ridgeA = iso([0, geometry.ceiling.halfRunFt, 16]), ridgeB = iso([room.widthFt, geometry.ceiling.halfRunFt, 16]);
  const eaves = [[0, 0, geometry.ceiling.springElevationFt], [room.widthFt, 0, geometry.ceiling.springElevationFt], [room.widthFt, room.depthFt, geometry.ceiling.springElevationFt], [0, room.depthFt, geometry.ceiling.springElevationFt]];
  const roofLines = [line(iso(eaves[0]), ridgeA), line(iso(eaves[1]), ridgeB), line(ridgeA, ridgeB), line(iso(eaves[3]), ridgeA), line(iso(eaves[2]), ridgeB), line(iso(eaves[0]), iso(eaves[1])), line(iso(eaves[3]), iso(eaves[2]))].join('');
  const modelBranches = packet.branchPipes3d.map((pipe) => line(iso(pipe.fromFt), iso(pipe.toFt), 'class="pipe"')).join('');
  const modelHeads = heads.map((head) => { const p = iso(head.pointFt); return `<circle cx="${p[0]}" cy="${p[1]}" r="6"/>`; }).join('');
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 560" role="img" aria-label="JOMO source-only pitched candidate 3D model"><style>rect{fill:#07111f}line{stroke:#64748b;stroke-width:2}.wall{stroke:#475569}.floor{stroke:#94a3b8}.pipe{stroke:#a78bfa;stroke-width:5}circle{fill:#22d3ee;stroke:#fff;stroke-width:2}text{fill:#e2e8f0;font:16px sans-serif}</style><rect width="900" height="560"/>${floorLines}${wallLines}${roofLines}${modelBranches}${modelHeads}<text x="20" y="30">Level 01 Great Room · drawing-scaled floor + wall + two-plane vaulted ceiling</text><text x="20" y="54">partial room envelope; whole-building model remains blocked</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, complianceReady: false };
}
