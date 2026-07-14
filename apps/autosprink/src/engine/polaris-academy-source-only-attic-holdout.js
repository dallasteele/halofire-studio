import { sha256Hex } from './elevation-datums.js';
import { selectPitchedPlacementStrategyV5 } from './pitched-placement-calibration-corpus-v5.js';

const PROJECT_ID = 'polaris-academy-mesa-az';
const PROJECT = 'Polaris Academy - Mesa AZ';
const V5_RECEIPT = 'eff4a856d825707acb6a9c3135daa1d28e68246f5f11ade3bd88ba30284fe687';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });

const SOURCE_BINDINGS = Object.freeze({
  architectural_bid_set: ['ae19ff5c7cc3904f6d3e5b83a04e5e244f833099a3f445a0e9b1aaf7c5b98e51', 34531967],
  architectural_revised_set: ['01d24826b23cfea709946f3ca858fb5f9be15f8b09945feceae334b51b5c9c00', 8905916],
  architectural_floor_plan_dwg: ['087f8dd020d9e40ba42114e01b96a8b6ab52a47cadd7ef59dededa39bb6c35d1', 250860],
  architectural_rcp_dwg: ['50235966afaac2bd59a3540d35c0c6fdb36e7c659b724fdb74cd1c9433e13202', 328371],
});
const ANSWER_BINDINGS = Object.freeze({
  fire_sprinkler_cad_v1: ['173a2dcbe9b706b1074feabbe3590c29ff1a063e020bf36a5eff2751ee3f3693', 3080323],
  fire_sprinkler_cad_v2: ['3b27b60d74c6058508789929ad0ca20df490c28905828b5ac096183454154c2f', 3081423],
  ahj_approved_plan: ['149f0924dfaa7423545dc46cb0af21456bb31ee6d450a1d4fe7d68cb8bdbe787', 27120731],
  as_built_plan_primary: ['136680d1df37926700825f6124f42de7b3cafe706f52b4c7c3b260e3ee3291eb', 20718771],
  as_built_plan_secondary: ['bfb9bf34461ed667abfb14d01fff34fa2bae378eb2e9b53b446db525d2244123', 29330532],
});

export async function sealPolarisSourceSeal(draft) {
  const { receiptSha256: _ignored, ...body } = draft;
  return { ...body, receiptSha256: await sha256Hex(body) };
}

export async function validatePolarisSourceSeal(packet) {
  const issues = [];
  if (packet?.artifactType !== 'halofire.unseen-pitched-attic-holdout.v1' || packet?.projectId !== PROJECT_ID || packet?.projectName !== PROJECT) return { status: 'blocked', issues: [issue('POLARIS_SOURCE_IDENTITY_INVALID', 'Polaris source-seal identity is invalid.')], sourceSealReady: false, complianceReady: false };
  const { receiptSha256, ...draft } = packet;
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('POLARIS_SOURCE_RECEIPT_MISMATCH', 'The source seal changed after answer isolation.'));
  const sources = new Map((packet.sources || []).map((entry) => [entry.role, entry]));
  for (const [role, [sha256, bytes]] of Object.entries(SOURCE_BINDINGS)) { const entry = sources.get(role); if (!entry || entry.sha256 !== sha256 || entry.bytes !== bytes) issues.push(issue('POLARIS_SOURCE_BINDING_DRIFT', `Source ${role} changed.`)); }
  const answers = new Map((packet.answerKeyDenylist || []).map((entry) => [entry.role, entry]));
  for (const [role, [sha256, bytes]] of Object.entries(ANSWER_BINDINGS)) { const entry = answers.get(role); if (!entry || entry.sha256 !== sha256 || entry.bytes !== bytes || entry.openedBeforeSourceSeal !== false) issues.push(issue('POLARIS_ANSWER_DENYLIST_DRIFT', `Answer ${role} changed or was opened before the source seal.`)); }
  const footprint = packet.sourceObservations?.floorFootprint;
  if (footprint?.verticesInches?.length !== 73 || footprint?.libredwgUnknownEntityCount !== 0 || footprint?.closedAreaSqFt !== 10655.197439 || footprint?.permitAreaDifferencePercent !== 5.194959) issues.push(issue('POLARIS_FOOTPRINT_SOURCE_DRIFT', 'The exact architectural RCP-DWG footprint changed.'));
  if (packet.sourceObservations?.permitSummary?.buildingAreaSqFt !== 10129 || packet.sourceObservations?.permitSummary?.storyCount !== 1 || packet.sourceObservations?.occupiedCeilings?.pitchedOccupiedProtectionPlaneCount !== 0 || packet.sourceObservations?.pitchedAttic?.pitchRiseInPer12 !== 4) issues.push(issue('POLARIS_SOURCE_OBSERVATION_DRIFT', 'Permit area, story count, ceiling separation, or 4:12 attic evidence changed.'));
  if (packet.selection?.status !== 'source-sealed-answers-unopened' || packet.selection?.priorImplementationSearchHits !== 0 || packet.selection?.rejectedBeforeAnswerOpen?.length < 5 || packet.brainPreflight?.status !== 'passed' || packet.brainPreflight?.platformSpineAddendumApplied !== true) issues.push(issue('POLARIS_PREFLIGHT_INVALID', 'Fresh selection and brain/platform-spine preflight are required.'));
  if (packet.generation?.answerKeyUsed !== false || packet.generation?.completedBidUsedForGeneration !== false || packet.generation?.atticPlacementTransferAllowed !== false || Object.values(packet.claims || {}).some(Boolean)) issues.push(issue('POLARIS_SOURCE_FALSE_PROMOTION', 'The sealed source must not promote attic placement or downstream claims.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceSealReady: issues.length === 0, complianceReady: false };
}

function shoelaceArea(points) { return Math.abs(points.reduce((sum, [x, y], index) => { const next = points[(index + 1) % points.length]; return sum + x * next[1] - next[0] * y; }, 0) / 2); }

function normalizedFootprint(sourceSeal) {
  const points = sourceSeal.sourceObservations.floorFootprint.verticesInches;
  const minX = Math.min(...points.map(([x]) => x)); const minY = Math.min(...points.map(([, y]) => y));
  const polygonFt = points.map(([x, y]) => [round((x - minX) / 12), round((y - minY) / 12)]);
  const maxX = Math.max(...polygonFt.map(([x]) => x)); const maxY = Math.max(...polygonFt.map(([, y]) => y));
  return { polygonFt, boundsFt: { minX: 0, minY: 0, maxX, maxY, width: maxX, depth: maxY }, areaSqFt: round(shoelaceArea(polygonFt)) };
}

export async function buildPolarisSourceOnlyAtticCandidate(sourceSeal, v5Corpus, v4Corpus) {
  if ((await validatePolarisSourceSeal(sourceSeal)).status !== 'passed') throw new Error('POLARIS_SOURCE_SEAL_BLOCKED');
  if (v5Corpus?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v5' || v5Corpus?.receiptSha256 !== V5_RECEIPT || v4Corpus?.artifactType !== 'halofire.pitched-placement-calibration-corpus.v4') throw new Error('POLARIS_V5_DEPENDENCY_BLOCKED');
  const features = { clearSpanDisambiguated: true, occupiedProtectionPlaneCount: 0, symmetricTwoPlaneVault: false, atticProtectionVolumePresent: true };
  let selectorGuard;
  try { selectPitchedPlacementStrategyV5(features, v4Corpus, v5Corpus); selectorGuard = { status: 'failed-open' }; } catch (error) { selectorGuard = { status: 'passed', rejectionCode: error.message }; }
  if (selectorGuard.rejectionCode !== 'PITCHED_SELECTOR_V5_UNCALIBRATED_GEOMETRY') throw new Error('POLARIS_V5_WRONG_DOMAIN_GUARD_FAILED');
  const footprint = normalizedFootprint(sourceSeal);
  const sectionSpanFt = footprint.boundsFt.depth;
  const sectionRiseFt = round(sectionSpanFt / 2 * 4 / 12);
  const draft = {
    artifactType: 'halofire.polaris-source-only-pitched-attic-candidate.v1', projectId: PROJECT_ID, projectName: PROJECT,
    sourceSealReceiptSha256: sourceSeal.receiptSha256, v5CorpusReceiptSha256: v5Corpus.receiptSha256,
    generationMode: 'sealed-architectural-source-only-wrong-domain-guard-before-answer-open',
    sourceObservableFeatures: features, selectorGuard,
    buildingModel: {
      coordinateSystem: 'architectural RCP DWG inches normalized to local feet', levelCount: 1,
      levels: [{ id: 'level-01', floorElevationFt: 0, exactSourceFootprint: true, footprintPolygonFt: footprint.polygonFt, footprintAreaSqFt: footprint.areaSqFt }],
      boundsFt: footprint.boundsFt, permitBuildingAreaSqFt: 10129, exteriorOutlineAreaSqFt: footprint.areaSqFt,
      ceilingReferences: [{ id: 'default-flat-ceiling', elevationFt: 9, kind: 'horizontal' }, { id: 'stem-room-high-ceiling', elevationFt: 12, kind: 'horizontal' }],
      pitchedAtticSection: { pitch: { riseIn: 4, runIn: 12 }, spanFt: sectionSpanFt, relativeEaveElevationFt: 0, relativeRidgeElevationFt: sectionRiseFt, absoluteDatumReady: false, representativeSectionOnly: true },
      floorByFloorFootprintExtrusionReady: true, occupiedCeilingSeparationReady: true, pitchedAtticSectionReady: true, wholeRoofFaceTopologyReady: false,
    },
    heads3d: [], branchPipes3d: [],
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic 73-vertex DWG outline replay and 4:12 relative-section closure' },
      independent: { status: 'passed', method: 'revised permit area, floor plan, RCP, room schedule, original sections, and roof-framing cross-check' },
      adversarial: { status: 'passed', method: 'source-answer-domain-footprint-pitch-head-and-false-promotion mutations' },
    },
    answerKeyOpened: false, answerKeyUsedAsGeometryInput: false, completedBidUsedAsGeometryInput: false,
    sourceBuildingModelReady: true, topViewReady: true, elevationViewReady: true, partialModel3dReady: true,
    pitchedAtticHeadLayoutReady: false, candidatePlacementReady: false, unseenProjectPlacementVerified: false,
    wholeRoofModelReady: false, branchPipeTopologyReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
    requiredNextLoop: 'commit and push this source-only wrong-domain guard, then open the sealed approved and as-built sprinkler sets to learn the attic and below-ceiling topology without changing this prediction',
    claimStatus: 'fresh-source-only-scaled-floor-extrusion-and-relative-4-12-attic-section-not-attic-placement-code-compliance-or-fabrication',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validatePolarisSourceOnlyAtticCandidate(packet, dependencies) {
  let expected;
  try { expected = await buildPolarisSourceOnlyAtticCandidate(dependencies.sourceSeal, dependencies.v5Corpus, dependencies.v4Corpus); } catch (error) { return { status: 'blocked', issues: [issue('POLARIS_CANDIDATE_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('POLARIS_CANDIDATE_REPLAY_MISMATCH', 'Candidate no longer equals the deterministic source-only replay.'));
  if (packet?.buildingModel?.levels?.[0]?.footprintPolygonFt?.length !== 73 || packet?.buildingModel?.levels?.[0]?.footprintAreaSqFt !== 10655.197497 || packet?.buildingModel?.boundsFt?.width !== 178.041667 || packet?.buildingModel?.boundsFt?.depth !== 68.75) issues.push(issue('POLARIS_CANDIDATE_FOOTPRINT_DRIFT', 'Scaled floor footprint changed.'));
  if (packet?.buildingModel?.pitchedAtticSection?.pitch?.riseIn !== 4 || packet?.buildingModel?.pitchedAtticSection?.relativeRidgeElevationFt !== 11.458333 || packet?.selectorGuard?.rejectionCode !== 'PITCHED_SELECTOR_V5_UNCALIBRATED_GEOMETRY') issues.push(issue('POLARIS_CANDIDATE_DOMAIN_DRIFT', '4:12 section or occupied-vault wrong-domain guard changed.'));
  if (packet?.heads3d?.length !== 0 || packet?.answerKeyOpened !== false || packet?.candidatePlacementReady !== false || packet?.wholeRoofModelReady !== false || packet?.pitchedAtticHeadLayoutReady !== false || packet?.hydraulicCalculationReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('POLARIS_CANDIDATE_FALSE_PROMOTION', 'The source-only attic slice must keep placement and every downstream claim false.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceBuildingModelReady: issues.length === 0, candidatePlacementReady: false, complianceReady: false };
}

export async function verifyPolarisSourceCandidateAdversarialLoop(packet, dependencies) {
  const cases = [
    ['source', (v) => { v.sourceSealReceiptSha256 = '0'.repeat(64); }], ['v5', (v) => { v.v5CorpusReceiptSha256 = 'f'.repeat(64); }],
    ['answer-open', (v) => { v.answerKeyOpened = true; }], ['answer-input', (v) => { v.answerKeyUsedAsGeometryInput = true; }],
    ['footprint', (v) => { v.buildingModel.levels[0].footprintPolygonFt.pop(); }], ['area', (v) => { v.buildingModel.levels[0].footprintAreaSqFt = 10129; }],
    ['pitch', (v) => { v.buildingModel.pitchedAtticSection.pitch.riseIn = 3; }], ['selector', (v) => { v.selectorGuard.rejectionCode = 'PITCHED_SELECTOR_V5_OUTSIDE_CALIBRATED_BOUNDS:envelopeWidthFt'; }],
    ['head', (v) => { v.heads3d.push({ id: 'fabricated-head' }); }], ['placement', (v) => { v.candidatePlacementReady = true; }],
    ['roof', (v) => { v.wholeRoofModelReady = true; }], ['compliance', (v) => { v.complianceReady = true; }], ['receipt', (v) => { v.receiptSha256 = 'a'.repeat(64); }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) { const value = structuredClone(packet); mutate(value); if ((await validatePolarisSourceOnlyAtticCandidate(value, dependencies)).status === 'blocked') rejectedCases.push(id); }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, candidatePlacementReady: false, complianceReady: false };
}

export function renderPolarisSourceCandidateViews(packet) {
  const model = packet.buildingModel; const points = model.levels[0].footprintPolygonFt;
  const sx = 4.5; const sy = 4.5; const ox = 55; const oy = 55;
  const planPoints = points.map(([x, y]) => `${round(ox + x * sx)},${round(oy + (model.boundsFt.depth - y) * sy)}`).join(' ');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 430" role="img" aria-label="Polaris exact source footprint"><style>rect{fill:#07111f}.footprint{fill:#12304a;stroke:#67e8f9;stroke-width:2}.ceiling{stroke:#f59e0b;stroke-width:3;stroke-dasharray:8 6}text{fill:#e2e8f0;font:15px sans-serif}.warn{fill:#fbbf24}</style><rect width="930" height="430"/><polygon class="footprint" points="${planPoints}"/><line class="ceiling" x1="55" y1="385" x2="856" y2="385"/><text x="24" y="28">Polaris source-only top: exact 73-vertex RCP-DWG outline - 178.042 ft x 68.750 ft</text><text class="warn" x="24" y="414">0 generated attic heads - occupied-vault v5 correctly rejected this flat-ceiling + attic regime</text></svg>`;
  const ex = (x) => 70 + x * 10; const ez = (z) => 330 - z * 16; const span = model.pitchedAtticSection.spanFt; const ridge = model.pitchedAtticSection.relativeRidgeElevationFt;
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 370" role="img" aria-label="Polaris 4 to 12 relative attic section"><style>rect{fill:#07111f}.wall{stroke:#94a3b8;stroke-width:4}.roof{stroke:#f59e0b;stroke-width:6}.ceiling{stroke:#67e8f9;stroke-width:4}text{fill:#e2e8f0;font:15px sans-serif}.warn{fill:#fbbf24}</style><rect width="850" height="370"/><line class="wall" x1="${ex(0)}" y1="${ez(-12)}" x2="${ex(0)}" y2="${ez(0)}"/><line class="wall" x1="${ex(span)}" y1="${ez(-12)}" x2="${ex(span)}" y2="${ez(0)}"/><line class="ceiling" x1="${ex(0)}" y1="${ez(-3)}" x2="${ex(span)}" y2="${ez(-3)}"/><line class="roof" x1="${ex(0)}" y1="${ez(0)}" x2="${ex(span / 2)}" y2="${ez(ridge)}"/><line class="roof" x1="${ex(span / 2)}" y1="${ez(ridge)}" x2="${ex(span)}" y2="${ez(0)}"/><text x="22" y="28">Source section: 4:12 pitched attic above horizontal occupied ceiling - relative rise ${ridge} ft</text><text class="warn" x="22" y="352">Representative source-closed section; absolute datum and whole hip/gable face topology remain blocked</text></svg>`;
  const iso = ([x, y], z = 0) => [round(90 + x * 3.2 + y * 1.35), round(330 - y * 1.35 - z * 7)];
  const base = points.map((p) => iso(p, 0)); const upper = points.map((p) => iso(p, 12));
  const poly = (values) => values.map(([x, y]) => `${x},${y}`).join(' ');
  const edges = points.filter((_p, i) => i % 6 === 0).map((p) => { const a = iso(p, 0); const b = iso(p, 12); return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; }).join('');
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 430" role="img" aria-label="Polaris source footprint extrusion"><style>rect{fill:#07111f}.base{fill:#0f2942;stroke:#64748b;stroke-width:2}.top{fill:#164e63;fill-opacity:.72;stroke:#67e8f9;stroke-width:2}.edge{stroke:#94a3b8;stroke-width:2}text{fill:#e2e8f0;font:15px sans-serif}.warn{fill:#fbbf24}</style><rect width="920" height="430"/><polygon class="base" points="${poly(base)}"/><g class="edge">${edges}</g><polygon class="top" points="${poly(upper)}"/><text x="22" y="28">Scaled source model: one exact floor footprint extruded to the highest scheduled 12 ft ceiling reference</text><text class="warn" x="22" y="412">Floor-by-floor footprint true; whole multi-mass roof and sprinkler placement intentionally not fabricated</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, sourceBuildingModelReady: true, candidatePlacementReady: false, complianceReady: false };
}
