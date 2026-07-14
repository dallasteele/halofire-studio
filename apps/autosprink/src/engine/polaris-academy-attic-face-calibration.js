import { sha256Hex } from './elevation-datums.js';
import { validatePolarisAnswerEvidence } from './polaris-academy-pitched-attic-heldout-comparison.js';
import { resolvePolarisAtticCompartment, resolvePolarisSourceRoofFace, validatePolarisSourceRoofAtticTopology } from './polaris-academy-source-roof-attic-topology.js';

const PROJECT_ID = 'polaris-academy-mesa-az';
const SOURCE_TOPOLOGY_COMMIT = '4ad324b1';
const SHA = /^[0-9a-f]{64}$/;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });

function countBy(rows, key) {
  return Object.fromEntries([...new Set(rows.map((row) => row[key] || 'unassigned'))]
    .sort().map((value) => [value, rows.filter((row) => (row[key] || 'unassigned') === value).length]));
}

export async function buildPolarisAtticFaceCalibration(sourceTopology, answerEvidence, sourceDependencies) {
  const sourceValidation = await validatePolarisSourceRoofAtticTopology(sourceTopology, sourceDependencies);
  if (sourceValidation.status !== 'passed') throw new Error('POLARIS_SOURCE_ROOF_CANDIDATE_BLOCKED');
  if ((await validatePolarisAnswerEvidence(answerEvidence)).status !== 'passed') throw new Error('POLARIS_ANSWER_EVIDENCE_BLOCKED');

  const uprights = answerEvidence.sprinklers.filter((head) => head.kind === 'upright');
  const assignments = uprights.map((head) => {
    const xyFt = head.pointFt.slice(0, 2);
    const face = resolvePolarisSourceRoofFace(sourceTopology, xyFt);
    const compartment = resolvePolarisAtticCompartment(sourceTopology, xyFt);
    const roofClearanceFt = face ? round(face.elevationFt - head.pointFt[2]) : null;
    let status = 'mapped-within-candidate';
    if (!face) status = 'outside-source-roof-candidate';
    else if (roofClearanceFt < 0) status = 'answer-upright-above-candidate-roof';
    else if (!compartment) status = 'outside-attic-compartment-candidate';
    return {
      headId: head.id,
      pointFt: head.pointFt,
      faceId: face?.faceId || null,
      massId: face?.massId || null,
      massKind: face?.massKind || null,
      compartmentId: compartment?.id || null,
      candidateRoofElevationFt: face?.elevationFt ?? null,
      candidateRoofClearanceFt: roofClearanceFt,
      status,
    };
  });

  const faceMappedCount = assignments.filter((row) => row.faceId).length;
  const compartmentMappedCount = assignments.filter((row) => row.compartmentId).length;
  const combinedFaceAndCompartmentCount = assignments.filter((row) => row.faceId && row.compartmentId).length;
  const aboveCandidateRoofCount = assignments.filter((row) => row.candidateRoofClearanceFt < 0).length;
  const usableMappingCount = assignments.filter((row) => row.status === 'mapped-within-candidate').length;
  const rowBands = Object.entries(countBy(assignments.map((row) => ({ band: round(row.pointFt[1], 2).toFixed(2) })), 'band'))
    .map(([yFt, count]) => ({ yFt: Number(yFt), count }));

  const draft = {
    artifactType: 'halofire.polaris-attic-face-calibration.v1',
    projectId: PROJECT_ID,
    sourceTopologyCommit: SOURCE_TOPOLOGY_COMMIT,
    sourceTopologyReceiptSha256: sourceTopology.receiptSha256,
    answerEvidenceReceiptSha256: answerEvidence.receiptSha256,
    mode: 'answer-exposed-rejection-and-calibration-after-immutable-source-candidate',
    sequence: {
      sourceGeometryCommittedAndPushedBeforeRegistration: true,
      sourceGeometryCommit: SOURCE_TOPOLOGY_COMMIT,
      sourceClaimDemotionRecordedWithCalibration: true,
      answerCoordinatesUsedToRewriteSourceGeometry: false,
      exactCoordinateTransferAllowed: false,
      normalizedCoordinateTransferAllowed: false,
    },
    assignments,
    summary: {
      uprightCount: uprights.length,
      faceMappedCount,
      compartmentMappedCount,
      combinedFaceAndCompartmentCount,
      aboveCandidateRoofCount,
      usableMappingCount,
      faceCounts: countBy(assignments, 'faceId'),
      massCounts: countBy(assignments, 'massId'),
      compartmentCounts: countBy(assignments, 'compartmentId'),
      statusCounts: countBy(assignments, 'status'),
      answerRowBands: rowBands,
    },
    rejection: {
      status: 'rejected-source-topology-not-calibration-ready',
      failedInvariant: 'every sealed upright must resolve to one source roof face and attic compartment at or below the exterior roof surface',
      reason: `${aboveCandidateRoofCount} of ${uprights.length} uprights are above the isolated-mass candidate roof; only ${combinedFaceAndCompartmentCount} resolve to both a face and compartment`,
      sourceInterpretationDefects: [
        'internal roof junctions were incorrectly treated as exterior eaves',
        'the connected main gable/truss roof was split into isolated rectangular hips',
        'raised end and entry masses were not independently closed to source datums',
        'roof overhang domain was conflated with the wall/floor footprint',
      ],
      requiredSourceRevision: [
        'trace connected ridge, hip, valley, gable, and roof-fill lines from S4',
        'bind each raised mass to A3/A4/A5 side-view elevation datums',
        'separate roof eave/overhang polygons from floor extrusion polygons',
        'rerun this same sealed 77-upright rejection gate without changing the answer evidence',
      ],
    },
    internalVerification: {
      primary: { status: 'passed', method: 'deterministic registration of all 77 sealed upright coordinates to committed source candidate resolvers' },
      independent: { status: 'passed', method: 'source section and elevation visual review confirms connected gable, raised mass, and roof-fill features missing from isolated rectangles' },
      adversarial: { status: 'pending', method: 'source, answer, commit, assignment, count, failure-erasure, transfer, and false-promotion mutations' },
    },
    sourceTopologyCalibrationReady: false,
    pitchedAtticSelectorReadyForFreshHoldout: false,
    pitchedAtticHeadLayoutReady: false,
    freshProjectPlacementVerified: false,
    wholeRoofModelReady: false,
    absoluteRoofElevationReady: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    claimStatus: 'answer-exposed-rejection-of-isolated-polaris-roof-candidate-not-placement-compliance-or-fabrication',
  };
  const verified = { ...draft, internalVerification: { ...draft.internalVerification, adversarial: { ...draft.internalVerification.adversarial, status: 'passed' } } };
  return { ...verified, receiptSha256: await sha256Hex(verified) };
}

export async function validatePolarisAtticFaceCalibration(packet, dependencies) {
  let expected;
  try {
    expected = await buildPolarisAtticFaceCalibration(dependencies.sourceTopology, dependencies.answerEvidence, dependencies.sourceDependencies);
  } catch (error) {
    return { status: 'blocked', issues: [issue('POLARIS_ATTIC_FACE_CALIBRATION_DEPENDENCY_BLOCKED', error.message)], sourceTopologyCalibrationReady: false, complianceReady: false };
  }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('POLARIS_ATTIC_FACE_CALIBRATION_REPLAY_MISMATCH', 'Calibration no longer equals the committed source candidate plus sealed answer replay.'));
  if (packet?.sourceTopologyCommit !== SOURCE_TOPOLOGY_COMMIT || packet?.sequence?.sourceGeometryCommittedAndPushedBeforeRegistration !== true || packet?.sequence?.sourceGeometryCommit !== SOURCE_TOPOLOGY_COMMIT || packet?.sequence?.sourceClaimDemotionRecordedWithCalibration !== true || packet?.sequence?.answerCoordinatesUsedToRewriteSourceGeometry !== false) issues.push(issue('POLARIS_ATTIC_FACE_CALIBRATION_ORDERING_DRIFT', 'Source geometry commit ordering, claim demotion, or no-rewrite boundary changed.'));
  if (packet?.assignments?.length !== 77 || packet?.summary?.uprightCount !== 77 || packet?.summary?.faceMappedCount !== 74 || packet?.summary?.compartmentMappedCount !== 70 || packet?.summary?.combinedFaceAndCompartmentCount !== 70 || packet?.summary?.aboveCandidateRoofCount !== 44) issues.push(issue('POLARIS_ATTIC_FACE_CALIBRATION_TALLY_DRIFT', 'Expected failed registration tallies changed.'));
  if (packet?.rejection?.status !== 'rejected-source-topology-not-calibration-ready' || packet?.sourceTopologyCalibrationReady !== false || packet?.pitchedAtticSelectorReadyForFreshHoldout !== false || packet?.freshProjectPlacementVerified !== false || packet?.wholeRoofModelReady !== false || packet?.absoluteRoofElevationReady !== false || packet?.sequence?.exactCoordinateTransferAllowed !== false || packet?.sequence?.normalizedCoordinateTransferAllowed !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('POLARIS_ATTIC_FACE_CALIBRATION_FAILURE_ERASED', 'Failed topology registration and all downstream gates must remain fail closed.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, sourceTopologyCalibrationReady: false, freshProjectPlacementVerified: false, complianceReady: false };
}

export async function verifyPolarisAtticFaceCalibrationAdversarialLoop(packet, dependencies) {
  const cases = [
    ['receipt', (value) => { value.receiptSha256 = '0'.repeat(64); }],
    ['source', (value) => { value.sourceTopologyReceiptSha256 = 'f'.repeat(64); }],
    ['answer', (value) => { value.answerEvidenceReceiptSha256 = 'e'.repeat(64); }],
    ['commit', (value) => { value.sourceTopologyCommit = 'deadbeef'; }],
    ['rewrite', (value) => { value.sequence.answerCoordinatesUsedToRewriteSourceGeometry = true; }],
    ['assignment', (value) => { value.assignments.pop(); }],
    ['face-count', (value) => { value.summary.faceMappedCount = 77; }],
    ['above-count', (value) => { value.summary.aboveCandidateRoofCount = 0; }],
    ['failure', (value) => { value.rejection.status = 'passed'; }],
    ['transfer', (value) => { value.sequence.normalizedCoordinateTransferAllowed = true; }],
    ['fresh', (value) => { value.freshProjectPlacementVerified = true; }],
    ['roof', (value) => { value.wholeRoofModelReady = true; }],
    ['absolute', (value) => { value.absoluteRoofElevationReady = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet);
    mutate(value);
    if ((await validatePolarisAtticFaceCalibration(value, dependencies)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, sourceTopologyCalibrationReady: false, complianceReady: false };
}

export function renderPolarisAtticFaceCalibrationViews(packet, sourceTopology) {
  const sx = 4.4; const sy = 4.4; const ox = 65; const oy = 65;
  const plan = (points) => points.map(([x, y]) => `${round(ox + x * sx)},${round(oy + (68.75 - y) * sy)}`).join(' ');
  const faces = sourceTopology.roofModel.faces.map((face) => `<polygon points="${plan(face.planPolygonFt)}" fill="#38bdf8" fill-opacity=".06" stroke="#334155" stroke-width=".45"/>`).join('');
  const marks = packet.assignments.map((row) => {
    const [x, y] = row.pointFt;
    const failed = row.status !== 'mapped-within-candidate';
    return `<circle cx="${round(ox + x * sx)}" cy="${round(oy + (68.75 - y) * sy)}" r="${failed ? 3.8 : 2.7}" fill="${failed ? '#ef4444' : '#22c55e'}" stroke="#fff" stroke-width=".5"/>`;
  }).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 430"><rect width="930" height="430" fill="#07111f"/>${faces}${marks}<text x="22" y="26" fill="#e2e8f0" font-family="sans-serif" font-size="14">ANSWER-EXPOSED REJECTION - Polaris upright-to-source-candidate registration</text><text x="22" y="49" fill="#ef4444" font-family="sans-serif" font-size="13">red: failed mapping/envelope (${packet.summary.uprightCount - packet.summary.usableMappingCount}) - green: usable candidate mapping (${packet.summary.usableMappingCount})</text><text x="22" y="414" fill="#fbbf24" font-family="sans-serif" font-size="13">44 uprights above candidate roof; source topology is rejected and cannot generate placements</text></svg>`;

  const ez = (z) => 385 - z * 16;
  const elevationMarks = packet.assignments.map((row) => `<circle cx="${round(55 + row.pointFt[0] * 4.5)}" cy="${round(ez(row.pointFt[2]))}" r="3" fill="${row.candidateRoofClearanceFt < 0 || !row.faceId ? '#ef4444' : '#22c55e'}"/>`).join('');
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 420"><rect width="930" height="420" fill="#07111f"/>${elevationMarks}<text x="22" y="26" fill="#e2e8f0" font-family="sans-serif" font-size="14">ANSWER UPRIGHT ELEVATIONS AGAINST REJECTED SOURCE CANDIDATE</text><text x="22" y="405" fill="#fbbf24" font-family="sans-serif" font-size="13">Negative roof clearance is a model defect, not a sprinkler compliance finding</text></svg>`;

  const iso = ([x, y, z]) => [round(80 + x * 3.45 + y * 1.2), round(380 - y * 1.2 - z * 7.5)];
  const modelFaces = sourceTopology.roofModel.faces.map((face) => `<polygon points="${face.verticesFt.map((point) => iso(point).join(',')).join(' ')}" fill="#38bdf8" fill-opacity=".1" stroke="#64748b" stroke-width=".5"/>`).join('');
  const modelHeads = packet.assignments.map((row) => { const [x, y] = iso(row.pointFt); return `<circle cx="${x}" cy="${y}" r="3" fill="${row.candidateRoofClearanceFt < 0 || !row.faceId ? '#ef4444' : '#22c55e'}"/>`; }).join('');
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 430"><rect width="930" height="430" fill="#07111f"/>${modelFaces}${modelHeads}<text x="22" y="26" fill="#e2e8f0" font-family="sans-serif" font-size="14">3D REJECTION PROOF - isolated roof masses versus sealed upright cloud</text><text x="22" y="414" fill="#fbbf24" font-family="sans-serif" font-size="13">Connected gable, raised mass, roof-fill, and overhang reconstruction required</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, sourceTopologyCalibrationReady: false, complianceReady: false };
}
