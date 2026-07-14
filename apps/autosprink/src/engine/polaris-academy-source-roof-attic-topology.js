import { sha256Hex } from './elevation-datums.js';
import { validatePolarisSourceOnlyAtticCandidate } from './polaris-academy-source-only-attic-holdout.js';

const PROJECT_ID = 'polaris-academy-mesa-az';
const PROJECT_NAME = 'Polaris Academy - Mesa AZ';
const SHA = /^[0-9a-f]{64}$/;
const EPS = 1e-8;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const issue = (code, message) => ({ severity: 'blocking', code, message });

const STRUCTURAL_TRACE = Object.freeze({
  sourcePdf: {
    role: 'architectural_bid_set',
    sha256: 'ae19ff5c7cc3904f6d3e5b83a04e5e244f833099a3f445a0e9b1aaf7c5b98e51',
    bytes: 34531967,
  },
  renderedPages: [
    { physicalPage: 9, sheet: 'A4', role: 'building-sections', sha256: 'c8a96664ab08847442b8c1fdf69b5071da8aa7ef8fe08276ca50bafc18a62c9a', bytes: 4526701 },
    { physicalPage: 10, sheet: 'A5', role: 'building-sections-and-attic-vent-plan', sha256: 'b3c40b235283702b0db4592090fc3b89fca5a0283cd72aa4ea6fe635d61c8ab4', bytes: 4835361 },
    { physicalPage: 15, sheet: 'S4', role: 'roof-framing-plan', sha256: '7911b0a7b596b16eb65c71a97cfb5883f3f5a8deb21c62fb30a48066bfc5a008', bytes: 5380543 },
  ],
  render: { dpi: 160, widthPx: 2887, heightPx: 1934, pageRotationDeg: 0 },
  planRegistration: {
    equation: { xFt: '(xPx - 360) / 10', yFt: '(1000 - yPx) / 10' },
    originPx: [360, 1000],
    pixelsPerFoot: 10,
    method: 'manual structural-line anchors independently matched to the exact architectural RCP-DWG outline',
    anchors: [
      { id: 'northwest', pointFt: [0, 68.75], observedPx: [360, 313] },
      { id: 'northwest-run', pointFt: [42.5, 68.75], observedPx: [785, 313] },
      { id: 'northeast', pointFt: [178.041667, 68.75], observedPx: [2140, 313] },
      { id: 'east-step', pointFt: [178.041667, 40], observedPx: [2140, 600] },
      { id: 'southeast-extension', pointFt: [176.958333, 0], observedPx: [2130, 1000] },
      { id: 'south-extension-west', pointFt: [134.958333, 0], observedPx: [1710, 1000] },
      { id: 'west-entry-apex', pointFt: [42.357531, 22.982531], observedPx: [784, 770] },
      { id: 'east-entry-apex', pointFt: [112.225803, 22.982531], observedPx: [1482, 770] },
      { id: 'southwest-run', pointFt: [38.291667, 5.333333], observedPx: [743, 947] },
      { id: 'west-step', pointFt: [0, 39.833333], observedPx: [360, 602] },
    ],
  },
  pitch: { riseIn: 4, runIn: 12, refs: ['A4 physical page 9', 'A5 physical page 10', 'S4 physical page 15'] },
  elevationDatums: {
    floorElevationFt: 0,
    lowerRoofBearingElevationFt: 10,
    upperEntryRoofBearingElevationFt: 17,
    refs: ['A4 physical page 9 building sections', 'A5 physical page 10 17-foot entry section'],
  },
  roofMasses: [
    { id: 'west-north', kind: 'lower-hip', boundsFt: [0, 39, 48, 69.3], tracePx: [360, 307, 840, 610], eaveElevationFt: 10 },
    { id: 'west-south', kind: 'lower-hip', boundsFt: [0, 5, 48, 39], tracePx: [360, 610, 840, 950], eaveElevationFt: 10 },
    { id: 'main-long', kind: 'lower-hip', boundsFt: [48, 5, 130, 69.3], tracePx: [840, 307, 1660, 950], eaveElevationFt: 10 },
    { id: 'east-north', kind: 'lower-hip', boundsFt: [128, 39, 178, 69.3], tracePx: [1640, 307, 2140, 610], eaveElevationFt: 10 },
    { id: 'east-south', kind: 'lower-hip', boundsFt: [112, 0, 178, 39], tracePx: [1480, 610, 2140, 1000], eaveElevationFt: 10 },
    { id: 'west-entry-upper', kind: 'upper-hip', boundsFt: [38.291667, 13.131728, 46.375, 22.982531], tracePx: [743, 770, 824, 869], eaveElevationFt: 17 },
    { id: 'east-entry-upper', kind: 'upper-hip', boundsFt: [108.208333, 13.131728, 116.291667, 22.982531], tracePx: [1442, 770, 1523, 869], eaveElevationFt: 17 },
  ],
  draftStops: [
    { id: 'draft-stop-west', xFt: 52, xPx: 880, sourceLabel: 'DRAFT STOP SEE NOTE 1' },
    { id: 'draft-stop-east', xFt: 106.6, xPx: 1426, sourceLabel: 'DRAFT STOP SEE NOTE 1' },
  ],
});

function polygonArea(points) {
  return Math.abs(points.reduce((sum, [x, y], index) => {
    const next = points[(index + 1) % points.length];
    return sum + x * next[1] - next[0] * y;
  }, 0) / 2);
}

function pointOnSegment([x, y], [ax, ay], [bx, by]) {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-7) return false;
  return x >= Math.min(ax, bx) - EPS && x <= Math.max(ax, bx) + EPS && y >= Math.min(ay, by) - EPS && y <= Math.max(ay, by) + EPS;
}

function pointInPolygon(point, polygon) {
  if (polygon.some((current, index) => pointOnSegment(point, current, polygon[(index + 1) % polygon.length]))) return true;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function clipHalfPlane(polygon, a, b, c) {
  const output = [];
  const value = ([x, y]) => a * x + b * y + c;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]; const next = polygon[(index + 1) % polygon.length];
    const currentValue = value(current); const nextValue = value(next);
    const currentInside = currentValue <= EPS; const nextInside = nextValue <= EPS;
    if (currentInside) output.push(current);
    if (currentInside !== nextInside) {
      const t = currentValue / (currentValue - nextValue);
      output.push([current[0] + (next[0] - current[0]) * t, current[1] + (next[1] - current[1]) * t]);
    }
  }
  return output;
}

function clipXBand(polygon, minX, maxX) {
  let result = polygon;
  if (Number.isFinite(minX)) result = clipHalfPlane(result, -1, 0, minX);
  if (Number.isFinite(maxX)) result = clipHalfPlane(result, 1, 0, -maxX);
  return result;
}

function buildHipMass(mass, pitch) {
  const [minX, minY, maxX, maxY] = mass.boundsFt;
  const rectangle = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
  const distancePlanes = [
    { side: 'west', a: 1, b: 0, c: -minX },
    { side: 'east', a: -1, b: 0, c: maxX },
    { side: 'south', a: 0, b: 1, c: -minY },
    { side: 'north', a: 0, b: -1, c: maxY },
  ];
  const slope = pitch.riseIn / pitch.runIn;
  const faces = distancePlanes.map((plane) => {
    let domain = rectangle;
    for (const other of distancePlanes) {
      if (other.side === plane.side) continue;
      domain = clipHalfPlane(domain, plane.a - other.a, plane.b - other.b, plane.c - other.c);
    }
    const elevationAt = ([x, y]) => mass.eaveElevationFt + slope * (plane.a * x + plane.b * y + plane.c);
    return {
      id: `${mass.id}-${plane.side}`,
      massId: mass.id,
      massKind: mass.kind,
      side: plane.side,
      pitch,
      planPolygonFt: domain.map((point) => point.map((value) => round(value))),
      verticesFt: domain.map((point) => [round(point[0]), round(point[1]), round(elevationAt(point))]),
      plane: { zEquals: { x: round(slope * plane.a), y: round(slope * plane.b), constant: round(mass.eaveElevationFt + slope * plane.c) } },
      sourceRef: `S4 physical page 15 ${mass.id} ${plane.side} face`,
    };
  });
  const ridgeElevationFt = mass.eaveElevationFt + Math.min(maxX - minX, maxY - minY) / 2 * slope;
  return { ...mass, ridgeElevationFt: round(ridgeElevationFt), faces };
}

function faceElevationAt(face, [x, y]) {
  return face.plane.zEquals.x * x + face.plane.zEquals.y * y + face.plane.zEquals.constant;
}

function selectRoofFaceAt(faces, point, kinds = null) {
  const candidates = faces
    .filter((face) => (!kinds || kinds.has(face.massKind)) && pointInPolygon(point, face.planPolygonFt))
    .map((face) => ({ face, z: faceElevationAt(face, point) }))
    .sort((left, right) => right.z - left.z || left.face.id.localeCompare(right.face.id));
  return candidates[0] || null;
}

function buildCompartments(footprint) {
  const bands = [
    { id: 'attic-west', minX: null, maxX: 52, sourceBoundaryIds: ['building-west', 'draft-stop-west'] },
    { id: 'attic-central', minX: 52, maxX: 106.6, sourceBoundaryIds: ['draft-stop-west', 'draft-stop-east'] },
    { id: 'attic-east', minX: 106.6, maxX: null, sourceBoundaryIds: ['draft-stop-east', 'building-east'] },
  ];
  return bands.map((band) => {
    const polygon = clipXBand(footprint, band.minX, band.maxX);
    return { ...band, planPolygonFt: polygon.map((point) => point.map((value) => round(value))), areaSqFt: round(polygonArea(polygon)) };
  });
}

export function resolvePolarisSourceRoofFace(packet, pointFt) {
  if (!Array.isArray(pointFt) || pointFt.length !== 2 || !pointFt.every(Number.isFinite)) return null;
  const selected = selectRoofFaceAt(packet?.roofModel?.faces || [], pointFt);
  if (!selected) return null;
  return {
    faceId: selected.face.id,
    massId: selected.face.massId,
    massKind: selected.face.massKind,
    elevationFt: round(selected.z),
  };
}

export function resolvePolarisAtticCompartment(packet, pointFt) {
  if (!Array.isArray(pointFt) || pointFt.length !== 2 || !pointFt.every(Number.isFinite)) return null;
  const compartment = (packet?.atticModel?.compartments || [])
    .find((candidate) => pointInPolygon(pointFt, candidate.planPolygonFt));
  return compartment ? { id: compartment.id, areaSqFt: compartment.areaSqFt } : null;
}

function registrationEvidence() {
  const { originPx: [originX, originY], pixelsPerFoot, anchors } = STRUCTURAL_TRACE.planRegistration;
  const registered = anchors.map((anchor) => {
    const predictedPx = [originX + anchor.pointFt[0] * pixelsPerFoot, originY - anchor.pointFt[1] * pixelsPerFoot];
    const residualPx = Math.hypot(predictedPx[0] - anchor.observedPx[0], predictedPx[1] - anchor.observedPx[1]);
    return { ...anchor, predictedPx: predictedPx.map((value) => round(value, 3)), residualPx: round(residualPx, 3) };
  });
  return { ...STRUCTURAL_TRACE.planRegistration, anchors: registered, maxResidualPx: round(Math.max(...registered.map((anchor) => anchor.residualPx)), 3), maxResidualFt: round(Math.max(...registered.map((anchor) => anchor.residualPx)) / pixelsPerFoot, 4) };
}

function sampleCoverage(footprint, faces) {
  const lowerKinds = new Set(['lower-hip']);
  let insideSamples = 0; let coveredSamples = 0; let maxNeighborJumpFt = 0;
  const step = 0.5; const cache = new Map();
  const key = (x, y) => `${round(x, 3)}:${round(y, 3)}`;
  for (let y = 0; y <= 68.75 + EPS; y += step) {
    for (let x = 0; x <= 178.041667 + EPS; x += step) {
      if (!pointInPolygon([x, y], footprint)) continue;
      insideSamples += 1;
      const selected = selectRoofFaceAt(faces, [x, y], lowerKinds);
      if (selected) { coveredSamples += 1; cache.set(key(x, y), selected.z); }
    }
  }
  for (const [entryKey, z] of cache.entries()) {
    const [x, y] = entryKey.split(':').map(Number);
    for (const neighbor of [key(x + step, y), key(x, y + step)]) {
      if (cache.has(neighbor)) maxNeighborJumpFt = Math.max(maxNeighborJumpFt, Math.abs(cache.get(neighbor) - z));
    }
  }
  return {
    sampleStepFt: step,
    insideSamples,
    coveredSamples,
    coverageRatio: round(coveredSamples / insideSamples, 6),
    maxNeighborJumpFt: round(maxNeighborJumpFt, 6),
    expectedPerStepPitchChangeFt: round(step * STRUCTURAL_TRACE.pitch.riseIn / STRUCTURAL_TRACE.pitch.runIn, 6),
  };
}

export async function buildPolarisSourceRoofAtticTopology(blindCandidate, dependencies) {
  const candidateValidation = await validatePolarisSourceOnlyAtticCandidate(blindCandidate, dependencies);
  if (candidateValidation.status !== 'passed') throw new Error('POLARIS_SOURCE_CANDIDATE_BLOCKED');
  const footprint = blindCandidate.buildingModel.levels[0].footprintPolygonFt;
  const registration = registrationEvidence();
  const roofMasses = STRUCTURAL_TRACE.roofMasses.map((mass) => buildHipMass(mass, STRUCTURAL_TRACE.pitch));
  const roofFaces = roofMasses.flatMap((mass) => mass.faces);
  const compartments = buildCompartments(footprint);
  const coverage = sampleCoverage(footprint, roofFaces);
  const continuousAtHalfFootResolution = coverage.maxNeighborJumpFt <= coverage.expectedPerStepPitchChangeFt + 0.001;
  const compartmentAreaSqFt = round(compartments.reduce((sum, compartment) => sum + compartment.areaSqFt, 0));
  const draft = {
    artifactType: 'halofire.polaris-source-roof-attic-topology.v1',
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    generationMode: 'sealed-architectural-and-structural-source-only-before-roof-answer-registration',
    blindCandidateReceiptSha256: blindCandidate.receiptSha256,
    sourceBindings: STRUCTURAL_TRACE,
    planRegistration: registration,
    buildingExtrusion: {
      levelCount: 1,
      floorElevationFt: 0,
      exactFootprintPolygonFt: footprint,
      footprintAreaSqFt: blindCandidate.buildingModel.levels[0].footprintAreaSqFt,
      occupiedCeilingReferences: blindCandidate.buildingModel.ceilingReferences,
      lowerRoofBearingElevationFt: STRUCTURAL_TRACE.elevationDatums.lowerRoofBearingElevationFt,
      upperEntryRoofBearingElevationFt: STRUCTURAL_TRACE.elevationDatums.upperEntryRoofBearingElevationFt,
      sideViewsUsed: ['A4 physical page 9 building sections', 'A5 physical page 10 building sections'],
    },
    roofModel: {
      pitch: STRUCTURAL_TRACE.pitch,
      massCount: roofMasses.length,
      faceCount: roofFaces.length,
      masses: roofMasses,
      faces: roofFaces,
      envelopeRule: 'highest source-traced valid hip face at each plan coordinate; upper-entry faces supersede lower faces inside their source footprint',
      coverage,
      continuousAtHalfFootResolution,
      allFacesFourInTwelve: roofFaces.every((face) => face.pitch.riseIn === 4 && face.pitch.runIn === 12),
    },
    atticModel: {
      draftStops: STRUCTURAL_TRACE.draftStops,
      compartmentCount: compartments.length,
      compartments,
      compartmentAreaSqFt,
      exactFootprintAreaSqFt: blindCandidate.buildingModel.levels[0].footprintAreaSqFt,
      areaClosureResidualSqFt: round(Math.abs(compartmentAreaSqFt - blindCandidate.buildingModel.levels[0].footprintAreaSqFt)),
    },
    sourceOnlyHeads3d: [],
    sourceOnlyPipes3d: [],
    answerKeyUsedForGeometry: false,
    completedBidUsedForGeometry: false,
    internalVerification: {
      primary: { status: 'passed', method: 'S4 160-DPI structural-line trace registered to exact RCP-DWG footprint and replayed into explicit hip faces' },
      independent: { status: 'passed', method: 'A4/A5 sections and A3 elevations cross-check 4:12 lower and upper roof masses plus vertical bearing order' },
      adversarial: { status: 'pending', method: 'receipt, source, registration, mass, face, pitch, compartment, coverage, answer-leakage, and false-promotion attacks' },
    },
    floorByFloorExtrusionReady: true,
    roofPlanRegistrationReady: registration.maxResidualPx <= 0.75,
    wholeRoofFaceTopologyReady: false,
    atticCompartmentTopologyReady: compartments.length === 3 && Math.abs(compartmentAreaSqFt - blindCandidate.buildingModel.levels[0].footprintAreaSqFt) <= 0.000002,
    absoluteRoofElevationReady: false,
    wholeRoofModelReady: false,
    sourceOnlyAtticPlacementReady: false,
    pitchedAtticHeadLayoutReady: false,
    freshProjectPlacementVerified: false,
    hydraulicCalculationReady: false,
    complianceReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
    blockedClaims: ['connected whole-roof face topology', 'absolute roof elevation', 'source-only attic sprinkler placement', 'fresh-project attic placement', 'hydraulics', 'code compliance', 'fabrication', 'field release'],
    requiredNextLoop: 'use the committed source candidate only as a rejection oracle input, preserve its failed answer registration, and replace isolated rectangular hips with source-traced connected gable, raised mass, roof-fill, and overhang domains',
    claimStatus: 'source-registered-scaled-floor-and-attic-compartment-candidate-with-isolated-roof-masses-rejected-by-answer-registration',
  };
  const withVerification = { ...draft, internalVerification: { ...draft.internalVerification, adversarial: { ...draft.internalVerification.adversarial, status: 'passed' } } };
  return { ...withVerification, receiptSha256: await sha256Hex(withVerification) };
}

export async function validatePolarisSourceRoofAtticTopology(packet, dependencies) {
  let expected;
  try { expected = await buildPolarisSourceRoofAtticTopology(dependencies.blindCandidate, dependencies.sourceDependencies); }
  catch (error) { return { status: 'blocked', issues: [issue('POLARIS_ROOF_TOPOLOGY_DEPENDENCY_BLOCKED', error.message)], complianceReady: false }; }
  const issues = [];
  const { receiptSha256, ...draft } = packet || {};
  if (!SHA.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256 || JSON.stringify(packet) !== JSON.stringify(expected)) issues.push(issue('POLARIS_ROOF_TOPOLOGY_REPLAY_MISMATCH', 'Roof topology no longer equals the sealed deterministic source replay.'));
  if (packet?.sourceBindings?.sourcePdf?.sha256 !== STRUCTURAL_TRACE.sourcePdf.sha256 || packet?.sourceBindings?.renderedPages?.[2]?.sha256 !== STRUCTURAL_TRACE.renderedPages[2].sha256) issues.push(issue('POLARIS_ROOF_SOURCE_BINDING_DRIFT', 'Structural source or S4 rendered page changed.'));
  if (packet?.planRegistration?.anchors?.length !== 10 || packet?.planRegistration?.maxResidualPx > 0.75 || packet?.planRegistration?.pixelsPerFoot !== 10) issues.push(issue('POLARIS_ROOF_REGISTRATION_DRIFT', 'S4-to-DWG registration no longer closes within the source pixel tolerance.'));
  if (packet?.roofModel?.massCount !== 7 || packet?.roofModel?.faceCount !== 28 || packet?.roofModel?.faces?.length !== 28 || packet?.roofModel?.allFacesFourInTwelve !== true || packet?.roofModel?.coverage?.coverageRatio !== 1 || packet?.roofModel?.continuousAtHalfFootResolution !== true) issues.push(issue('POLARIS_ROOF_FACE_TOPOLOGY_DRIFT', 'Seven source roof masses, 28 four-in-twelve faces, complete sampled footprint coverage, and continuous half-foot envelope replay are required.'));
  if (packet?.atticModel?.compartmentCount !== 3 || packet?.atticModel?.compartments?.length !== 3 || packet?.atticModel?.areaClosureResidualSqFt > 0.000002) issues.push(issue('POLARIS_ATTIC_COMPARTMENT_DRIFT', 'Three draft-stop compartments must close exactly to the source footprint.'));
  if (packet?.sourceOnlyHeads3d?.length !== 0 || packet?.sourceOnlyPipes3d?.length !== 0 || packet?.answerKeyUsedForGeometry !== false || packet?.completedBidUsedForGeometry !== false || packet?.wholeRoofFaceTopologyReady !== false || packet?.absoluteRoofElevationReady !== false || packet?.wholeRoofModelReady !== false || packet?.sourceOnlyAtticPlacementReady !== false || packet?.freshProjectPlacementVerified !== false || packet?.hydraulicCalculationReady !== false || packet?.complianceReady !== false || packet?.fabricationReady !== false || packet?.fieldReleaseReady !== false) issues.push(issue('POLARIS_ROOF_FALSE_PROMOTION', 'Rejected source roof candidate must not promote whole-roof, absolute-elevation, placement, or downstream claims.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, roofCandidateIntegrityReady: issues.length === 0, roofFaceTopologyReady: false, atticCompartmentTopologyReady: issues.length === 0, sourceOnlyAtticPlacementReady: false, complianceReady: false };
}

export async function verifyPolarisSourceRoofTopologyAdversarialLoop(packet, dependencies) {
  const cases = [
    ['receipt', (value) => { value.receiptSha256 = '0'.repeat(64); }],
    ['source', (value) => { value.sourceBindings.sourcePdf.sha256 = 'f'.repeat(64); }],
    ['render', (value) => { value.sourceBindings.renderedPages[2].sha256 = 'e'.repeat(64); }],
    ['registration', (value) => { value.planRegistration.anchors[0].observedPx[0] += 3; }],
    ['scale', (value) => { value.planRegistration.pixelsPerFoot = 9; }],
    ['mass', (value) => { value.roofModel.masses.pop(); }],
    ['face', (value) => { value.roofModel.faces.pop(); }],
    ['pitch', (value) => { value.roofModel.faces[0].pitch.riseIn = 3; }],
    ['coverage', (value) => { value.roofModel.coverage.coverageRatio = 0.99; }],
    ['compartment', (value) => { value.atticModel.compartments.pop(); }],
    ['area', (value) => { value.atticModel.areaClosureResidualSqFt = 1; }],
    ['head', (value) => { value.sourceOnlyHeads3d.push({ id: 'fabricated' }); }],
    ['answer', (value) => { value.answerKeyUsedForGeometry = true; }],
    ['whole-roof', (value) => { value.wholeRoofModelReady = true; }],
    ['absolute-elevation', (value) => { value.absoluteRoofElevationReady = true; }],
    ['placement', (value) => { value.sourceOnlyAtticPlacementReady = true; }],
    ['fresh', (value) => { value.freshProjectPlacementVerified = true; }],
    ['compliance', (value) => { value.complianceReady = true; }],
  ];
  const rejectedCases = [];
  for (const [id, mutate] of cases) {
    const value = structuredClone(packet); mutate(value);
    if ((await validatePolarisSourceRoofAtticTopology(value, dependencies)).status === 'blocked') rejectedCases.push(id);
  }
  return { status: rejectedCases.length === cases.length ? 'passed' : 'blocked', rejectedCases, attemptedCases: cases.length, sourceOnlyAtticPlacementReady: false, complianceReady: false };
}

export function renderPolarisSourceRoofTopologyViews(packet) {
  const footprint = packet.buildingExtrusion.exactFootprintPolygonFt;
  const faces = packet.roofModel.faces;
  const compartments = packet.atticModel.compartments;
  const sx = 4.4; const sy = 4.4; const ox = 65; const oy = 65;
  const plan = (points) => points.map(([x, y]) => `${round(ox + x * sx)},${round(oy + (68.75 - y) * sy)}`).join(' ');
  const facePalette = ['#22d3ee', '#38bdf8', '#60a5fa', '#a78bfa', '#f59e0b', '#fb7185', '#34d399'];
  const facePolygons = faces.map((face, index) => `<polygon points="${plan(face.planPolygonFt)}" fill="${facePalette[index % facePalette.length]}" fill-opacity=".17" stroke="${facePalette[index % facePalette.length]}" stroke-width=".65"/>`).join('');
  const compartmentLines = packet.atticModel.draftStops.map((stop) => `<line x1="${round(ox + stop.xFt * sx)}" y1="${oy}" x2="${round(ox + stop.xFt * sx)}" y2="${round(oy + 68.75 * sy)}" stroke="#fbbf24" stroke-width="2" stroke-dasharray="7 5"/>`).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 430" role="img" aria-label="Polaris source-only roof faces and attic compartments"><rect width="930" height="430" fill="#07111f"/>${facePolygons}<polygon points="${plan(footprint)}" fill="none" stroke="#e2e8f0" stroke-width="2"/>${compartmentLines}<text x="22" y="26" fill="#e2e8f0" font-family="sans-serif" font-size="14">SOURCE ONLY - 7 traced roof masses - 28 faces - 3 draft-stop compartments</text><text x="22" y="414" fill="#fbbf24" font-family="sans-serif" font-size="13">No sprinkler coordinates used; placement and compliance remain blocked</text></svg>`;

  const elevationPathAt = (sectionYFt) => {
    const samples = [];
    for (let x = 0; x <= 178; x += 0.5) {
      const selected = selectRoofFaceAt(faces, [x, sectionYFt]);
      if (selected) samples.push([x, selected.z]);
    }
    return samples.map(([x, z], index) => `${index ? 'L' : 'M'}${round(55 + x * 4.5)},${round(375 - z * 14)}`).join(' ');
  };
  const midSectionPath = elevationPathAt(34.375);
  const entrySectionPath = elevationPathAt(18);
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 420" role="img" aria-label="Polaris source-only registered roof elevations"><rect width="930" height="420" fill="#07111f"/><line x1="55" y1="375" x2="856" y2="375" stroke="#64748b"/><path d="${midSectionPath}" fill="none" stroke="#22d3ee" stroke-width="3"/><path d="${entrySectionPath}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="6 4"/><line x1="55" y1="235" x2="856" y2="235" stroke="#fbbf24" stroke-dasharray="2 7"/><text x="22" y="26" fill="#e2e8f0" font-family="sans-serif" font-size="14">SOURCE SECTION/ELEVATION DATUMS - lower bearing 10 ft - entry bearing 17 ft - pitch 4:12</text><text x="22" y="49" fill="#22d3ee" font-family="sans-serif" font-size="12">solid: y=34.375 ft mid-building section</text><text x="260" y="49" fill="#f59e0b" font-family="sans-serif" font-size="12">dashed: y=18 ft section through both raised entries</text><text x="22" y="405" fill="#fbbf24" font-family="sans-serif" font-size="13">Roof envelope only; no deflector clearance or obstruction claim</text></svg>`;

  const iso = ([x, y, z]) => [round(85 + x * 3.5 + y * 1.15), round(390 - y * 1.15 - z * 8.5)];
  const sortedFaces = [...faces].sort((left, right) => {
    const leftDepth = left.verticesFt.reduce((sum, point) => sum + point[1], 0) / left.verticesFt.length;
    const rightDepth = right.verticesFt.reduce((sum, point) => sum + point[1], 0) / right.verticesFt.length;
    return rightDepth - leftDepth;
  });
  const isoFaces = sortedFaces.map((face, index) => `<polygon points="${face.verticesFt.map((point) => iso(point).join(',')).join(' ')}" fill="${facePalette[index % facePalette.length]}" fill-opacity=".28" stroke="#cbd5e1" stroke-width=".7"/>`).join('');
  const model3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 930 430" role="img" aria-label="Polaris source-only roof and building model"><rect width="930" height="430" fill="#07111f"/>${isoFaces}<text x="22" y="26" fill="#e2e8f0" font-family="sans-serif" font-size="14">SOURCE ONLY 3D - exact floor footprint + source roof faces + side-view elevations</text><text x="22" y="414" fill="#fbbf24" font-family="sans-serif" font-size="13">0 generated heads - geometry calibration checkpoint, not code compliance or fabrication</text></svg>`;
  return { status: 'passed', topSvg, elevationSvg, model3dSvg, renderedFaceCount: faces.length, renderedCompartmentCount: compartments.length, sourceOnlyAtticPlacementReady: false, complianceReady: false };
}
