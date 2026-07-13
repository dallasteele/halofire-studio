import { sha256Hex } from './elevation-datums.js';
import { buildWinterGardenChapelPlaneAssignments, validatePiecewiseGridRegistration } from './piecewise-grid-registration.js';
import { validateRasterBullseyeHeadEvidence } from './raster-bullseye-head-evidence.js';

const SHA256 = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (left, right, tolerance = 1e-6) => Math.abs(left - right) <= tolerance;
const EXPECTED = Object.freeze({
  A151: '4a6c4b29eff18a8e964627ba41807f2f8119f8a2c8012d5900acf08e61ee8e43',
  A301: '719ae05138b3872c2ed8740fa4470ca457dcc0a9f8fec617cabf7969560ecc30',
  A303: 'dae14221cd3b913d350e53d146c6dd1abfca8a3b6d3ca142916474ba18a66de7',
  FP3: '93f8df04bc84ac817ecd2e222812fede93565879094c66b4d7511f783631543e',
  TYL: '53ff9f89d03a1672aa06788efd1d20c0a5a711e4bc97ef97f9aa83c333b03d12',
});

export async function sealWinterGardenCeilingElevationEvidence(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateWinterGardenCeilingElevationEvidence(value) {
  if (!value || value.artifactType !== 'halofire.winter-garden-ceiling-elevation-evidence.v1') return { status: 'blocked', issues: [issue('WG_CEILING_SCHEMA_INVALID', 'Winter Garden ceiling elevation evidence schema is invalid.')] };
  const issues = []; const { receiptSha256, ...draft } = value;
  if (!SHA256.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('WG_CEILING_RECEIPT_MISMATCH', 'Ceiling elevation evidence no longer matches its sealed receipt.'));
  const sources = value.sources || {};
  if (sources.reflectedCeilingPlan?.sha256 !== EXPECTED.A151 || sources.transverseSection?.sha256 !== EXPECTED.A301 || sources.coordinatedSection?.sha256 !== EXPECTED.A303 || sources.completedSprinklerRcp?.sha256 !== EXPECTED.FP3 || sources.fabricationListing?.sha256 !== EXPECTED.TYL) issues.push(issue('WG_CEILING_SOURCE_DRIFT', 'A151, A301, A303, FP3, or fabrication listing identity changed.'));
  const ceiling = value.ceiling || {}; const slope = ceiling.pitchRiseIn / ceiling.pitchRunIn;
  const halfRun = (ceiling.highHeightAboveFloorFt - ceiling.lowHeightAboveFloorFt) / slope;
  const northLow = ceiling.ridgeTargetYPx - halfRun * ceiling.targetPxPerFt; const southLow = ceiling.ridgeTargetYPx + halfRun * ceiling.targetPxPerFt;
  if (ceiling.finishType !== 'C8' || ceiling.floorDatumFt !== 100 || !near(ceiling.lowHeightAboveFloorFt, 15.046875) || !near(ceiling.highHeightAboveFloorFt, 20.5625) || !near(ceiling.pitchRiseIn, 4.5) || !near(ceiling.pitchRunIn, 12) || !near(halfRun, ceiling.derivedHalfRunFt, 1e-8) || !near(northLow, ceiling.derivedNorthLowYPx, 1e-8) || !near(southLow, ceiling.derivedSouthLowYPx, 1e-8)) issues.push(issue('WG_CEILING_COORDINATED_DATUM_DRIFT', 'C8 spot heights, section pitch, or derived plane extents changed.'));
  const observed = value.independentSectionReceipt?.observedRiseInPer12 || [];
  const mean = observed.length ? observed.reduce((sum, entry) => sum + entry, 0) / observed.length : NaN; const spread = observed.length ? Math.max(...observed) - Math.min(...observed) : Infinity;
  if (observed.length !== 4 || Math.abs(mean - 4.5) > 0.05 || spread > 0.1 || value.independentSectionReceipt.minimumLineLengthPx < 1000) issues.push(issue('WG_CEILING_SECTION_DISAGREEMENT', 'Independent FP3 transverse-section edges do not agree with the 4.5:12 ceiling model.'));
  const fabrication = value.fabricationReceipt || {};
  if (fabrication.pipingRows !== 316 || fabrication.outletRows !== 338 || fabrication.pendentHalfInchOutletRows !== 158 || fabrication.branch25PieceRows !== 15 || fabrication.spatialHeadMappingReady !== false) issues.push(issue('WG_CEILING_FABRICATION_RECEIPT_DRIFT', 'SprinkCad fabrication inventory or fail-closed spatial mapping status changed.'));
  if (value.ceilingSurfaceElevationReady !== true || value.model3dEnvelopeReady !== true || value.absoluteDeflectorDatumReady !== false || value.pipeElevationReady !== false || value.fabricationReady !== false || value.complianceReady !== false) issues.push(issue('WG_CEILING_FAIL_CLOSED_STATUS_DRIFT', 'Only the ceiling surface and 3D uncertainty envelope may be ready.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, metrics: { halfRunFt: halfRun, northLowYPx: northLow, southLowYPx: southLow, sectionPitchMeanInPer12: mean, sectionPitchSpreadInPer12: spread }, ceilingSurfaceElevationReady: !issues.length, absoluteDeflectorDatumReady: false, complianceReady: false };
}

export async function buildWinterGardenCeilingModel3d(evidence, registration, headEvidence) {
  const [ceilingValidation, gridValidation, headValidation, planes] = await Promise.all([
    validateWinterGardenCeilingElevationEvidence(evidence), validatePiecewiseGridRegistration(registration), validateRasterBullseyeHeadEvidence(headEvidence), buildWinterGardenChapelPlaneAssignments(registration, headEvidence),
  ]);
  const validations = [ceilingValidation, gridValidation, headValidation, planes];
  if (validations.some((entry) => entry.status !== 'passed')) return { status: 'blocked', issues: validations.flatMap((entry) => entry.issues || []), ceilingSurfaces: [], headEnvelopes: [], complianceReady: false };
  const c = evidence.ceiling; const slope = c.pitchRiseIn / c.pitchRunIn; const x = new Map(registration.gridX.labels.map((label, index) => [label, registration.gridX.targetPx[index]]));
  const left = x.get(registration.chapel.sourceGridBounds.left); const right = x.get(registration.chapel.sourceGridBounds.right);
  const surfaceElevation = (targetY) => c.floorDatumFt + c.highHeightAboveFloorFt - Math.abs(targetY - c.ridgeTargetYPx) / c.targetPxPerFt * slope;
  const ceilingSurfaces = [
    { id: 'chapel-c8-north', verticesFt: [[left / c.targetPxPerFt, c.derivedNorthLowYPx / c.targetPxPerFt, c.floorDatumFt + c.lowHeightAboveFloorFt], [right / c.targetPxPerFt, c.derivedNorthLowYPx / c.targetPxPerFt, c.floorDatumFt + c.lowHeightAboveFloorFt], [right / c.targetPxPerFt, c.ridgeTargetYPx / c.targetPxPerFt, c.floorDatumFt + c.highHeightAboveFloorFt], [left / c.targetPxPerFt, c.ridgeTargetYPx / c.targetPxPerFt, c.floorDatumFt + c.highHeightAboveFloorFt]] },
    { id: 'chapel-c8-south', verticesFt: [[left / c.targetPxPerFt, c.ridgeTargetYPx / c.targetPxPerFt, c.floorDatumFt + c.highHeightAboveFloorFt], [right / c.targetPxPerFt, c.ridgeTargetYPx / c.targetPxPerFt, c.floorDatumFt + c.highHeightAboveFloorFt], [right / c.targetPxPerFt, c.derivedSouthLowYPx / c.targetPxPerFt, c.floorDatumFt + c.lowHeightAboveFloorFt], [left / c.targetPxPerFt, c.derivedSouthLowYPx / c.targetPxPerFt, c.floorDatumFt + c.lowHeightAboveFloorFt]] },
  ];
  const headEnvelopes = planes.assignments.map((head) => {
    const ceilingSurfaceElevationFt = surfaceElevation(head.renderedPointPx[1]);
    return { headId: head.headId, plane: head.plane, planPointFt: head.renderedPointPx.map((entry) => entry / c.targetPxPerFt), ceilingSurfaceElevationFt, deflectorElevationRangeFt: [ceilingSurfaceElevationFt - 1, ceilingSurfaceElevationFt - (1 / 12)], exactDeflectorElevationReady: false };
  });
  return { status: 'passed', artifactType: 'halofire.winter-garden-ceiling-model3d-envelope.v1', ceilingSurfaces, headEnvelopes, counts: { ceilingSurfaces: 2, headEnvelopes: 15 }, ceilingSurfaceElevationReady: true, absoluteDeflectorDatumReady: false, pipeElevationReady: false, model3dEnvelopeReady: true, fabricationReady: false, complianceReady: false, residuals: ['fabricated_drop_to_plan_head_mapping_unresolved', 'pipe_elevation_unresolved'] };
}

export function renderWinterGardenCeilingViews(model) {
  if (model?.status !== 'passed') return { status: 'blocked', topSvg: '', elevationSvg: '' };
  const topHeads = model.headEnvelopes.map((head) => `<circle cx="${(head.planPointFt[0] * 5).toFixed(2)}" cy="${(head.planPointFt[1] * 5).toFixed(2)}" r="4" fill="#f97316"><title>${head.headId} / ceiling EL ${head.ceilingSurfaceElevationFt.toFixed(3)} FT</title></circle>`).join('');
  const ordered = [...model.headEnvelopes].sort((a, b) => a.planPointFt[1] - b.planPointFt[1]); const minY = ordered[0].planPointFt[1];
  const elevationHeads = ordered.map((head) => { const x = 80 + (head.planPointFt[1] - minY) * 24; const top = 640 - (head.deflectorElevationRangeFt[1] - 114) * 28; const bottom = 640 - (head.deflectorElevationRangeFt[0] - 114) * 28; return `<line x1="${x.toFixed(2)}" y1="${top.toFixed(2)}" x2="${x.toFixed(2)}" y2="${bottom.toFixed(2)}" stroke="#f97316" stroke-width="5"><title>${head.headId} deflector Z unresolved within source-bound interval</title></line>`; }).join('');
  return { status: 'passed', topSvg: `<svg viewBox="0 0 1200 1000" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Winter Garden source-bound pitched ceiling top view"><rect width="100%" height="100%" fill="#07111f"/>${topHeads}<text x="24" y="36" fill="#e0f2fe" font-family="monospace" font-size="18">15 completed FP3 heads / absolute C8 ceiling surface / deflector offset unresolved</text></svg>`, elevationSvg: `<svg viewBox="0 0 1200 720" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Winter Garden source-bound pitched ceiling elevation envelope"><rect width="100%" height="100%" fill="#07111f"/><polyline points="80,610 410,455 740,610" fill="none" stroke="#38bdf8" stroke-width="5"/>${elevationHeads}<text x="24" y="36" fill="#e0f2fe" font-family="monospace" font-size="18">C8 15'-0 9/16&quot; to 20'-6 3/4&quot; / 4.5:12 / orange = unresolved deflector interval</text></svg>`, complianceReady: false };
}
