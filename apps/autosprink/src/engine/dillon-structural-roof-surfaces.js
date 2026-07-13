import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';

const SHA = z.string().regex(/^[0-9a-f]{64}$/);
const Point = z.tuple([z.number().finite(), z.number().finite()]);
const SourceTriangle = z.array(Point).length(3);
const RegisteredPatch = z.object({
  id: z.string(),
  sourceDrawingIndex: z.number().int().nonnegative(),
  sourceSubpathIndex: z.number().int().nonnegative(),
  polygonDwgFt: SourceTriangle,
  classification: z.literal('recess-floor-at-bathroom'),
  roofCandidateStatus: z.literal('rejected-by-legend'),
  planeStatus: z.literal('rejected-non-roof-hatch'),
  render3d: z.literal(false),
}).strict();
const UnregisteredPatch = z.object({
  id: z.string(),
  sourceDrawingIndex: z.number().int().nonnegative(),
  sourceSubpathIndex: z.number().int().nonnegative(),
  polygonDwgFt: z.null(),
  classification: z.literal('recess-floor-at-bathroom'),
  roofCandidateStatus: z.literal('rejected-by-legend'),
  planeStatus: z.literal('rejected-non-roof-hatch'),
  render3d: z.literal(false),
}).strict();
const Registration = z.discriminatedUnion('status', [
  z.object({ status: z.literal('registered'), method: z.literal('axis-coordinate vector consensus against source-DWG wall polygons'), pointsPerFoot: z.literal(13.5), pageHeightPt: z.literal(2160), xSign: z.literal(1), ySign: z.literal(1), translateXFt: z.number(), translateYFt: z.number(), matchedCoordinates: z.number().int().min(100), weightedRmsXFt: z.number().max(0.025), weightedRmsYFt: z.number().max(0.025), alternateScoreMargin: z.number().positive() }).strict(),
  z.object({ status: z.literal('ambiguous-horizontal-mirror'), method: z.literal('axis-coordinate vector consensus produced near-tied mirrored candidates'), pointsPerFoot: z.literal(13.5), pageHeightPt: z.literal(2160), candidates: z.array(z.object({ xSign: z.union([z.literal(-1), z.literal(1)]), ySign: z.literal(1), translateXFt: z.number(), translateYFt: z.number(), score: z.number().positive() }).strict()).length(2), scoreMarginRatio: z.number().min(0).max(0.02) }).strict(),
]);
const Sheet = z.object({
  sheetId: z.enum(['S-020', 'S-021', 'TOY-FRAMING']),
  sourceId: z.string(),
  levelId: z.enum(['main-house-main', 'main-house-upper', 'toy-garage']),
  sourceSha256: SHA,
  registration: Registration,
  patches: z.array(z.union([RegisteredPatch, UnregisteredPatch])).min(1),
}).strict();
const Counts = z.object({ sourceHatchDrawings: z.literal(35), sourceHatchTriangles: z.literal(48), rejectedRecessFloorDrawings: z.literal(35), rejectedRecessFloorTriangles: z.literal(48), registeredRoofFacePatches: z.literal(0), structurallyResolvedPlanes: z.literal(0), existingCalibratedCeilingPlanes: z.literal(4), existingAbsoluteDatumCeilingPlanes: z.literal(1) }).strict();
const Draft = z.object({
  artifactType: z.literal('halofire.dillon-structural-roof-surfaces.v1'),
  projectName: z.literal('Dillon Residence'),
  structuralSourceArtifactSha256: SHA,
  floorModelReceiptSha256: SHA,
  slopedCalibrationReceiptSha256: SHA,
  sheets: z.array(Sheet).length(3),
  counts: Counts,
  geometryGrounded: z.literal(true),
  completeRoofPlanes: z.literal(false),
  complianceReady: z.literal(false),
  approvalReady: z.literal(false),
  limitations: z.array(z.string()).min(4),
  claimStatus: z.literal('structural-solid-gray-hatches-rejected-as-recess-floor-not-roof'),
}).strict();
const Packet = Draft.extend({ receiptSha256: SHA }).strict();
const issue = (code, message) => ({ severity: 'blocking', code, message });
const round = (value) => Number(value.toFixed(5));
const near = (a, b, tolerance = 0.00002) => Math.abs(a - b) <= tolerance;

const REGISTRATIONS = Object.freeze({
  'S-020': Object.freeze({ status: 'registered', method: 'axis-coordinate vector consensus against source-DWG wall polygons', pointsPerFoot: 13.5, pageHeightPt: 2160, xSign: 1, ySign: 1, translateXFt: -68.60417, translateYFt: -118.95833, matchedCoordinates: 179, weightedRmsXFt: 0.01313, weightedRmsYFt: 0.02246, alternateScoreMargin: 793.60553 }),
  'S-021': Object.freeze({ status: 'registered', method: 'axis-coordinate vector consensus against source-DWG wall polygons', pointsPerFoot: 13.5, pageHeightPt: 2160, xSign: 1, ySign: 1, translateXFt: -68.60417, translateYFt: -118.95833, matchedCoordinates: 152, weightedRmsXFt: 0.01901, weightedRmsYFt: 0.01803, alternateScoreMargin: 301.15327 }),
  'TOY-FRAMING': Object.freeze({ status: 'ambiguous-horizontal-mirror', method: 'axis-coordinate vector consensus produced near-tied mirrored candidates', pointsPerFoot: 13.5, pageHeightPt: 2160, candidates: [{ xSign: 1, ySign: 1, translateXFt: -100.04167, translateYFt: -68.33334, score: 973.26669 }, { xSign: -1, ySign: 1, translateXFt: 176.04167, translateYFt: -68.33334, score: 964.59729 }], scoreMarginRatio: 0.00891 }),
});

function transformPoint(point, registration) {
  return [round(registration.xSign * point[0] / registration.pointsPerFoot + registration.translateXFt), round(registration.ySign * (registration.pageHeightPt - point[1]) / registration.pointsPerFoot + registration.translateYFt)];
}

export async function buildDillonStructuralRoofPacket(source, floorModel, slopedCalibration) {
  const sheets = source.sheets.map((sheet) => {
    const registration = REGISTRATIONS[sheet.sheetId];
    const patches = sheet.hatchDrawings.flatMap((drawing) => drawing.trianglesTopLeftPt.map((polygon, sourceSubpathIndex) => {
      const base = { id: `${sheet.sheetId.toLowerCase()}-${drawing.sourceDrawingIndex}-${sourceSubpathIndex}`, sourceDrawingIndex: drawing.sourceDrawingIndex, sourceSubpathIndex };
      if (registration.status === 'registered') return { ...base, polygonDwgFt: polygon.map((point) => transformPoint(point, registration)), classification: 'recess-floor-at-bathroom', roofCandidateStatus: 'rejected-by-legend', planeStatus: 'rejected-non-roof-hatch', render3d: false };
      return { ...base, polygonDwgFt: null, classification: 'recess-floor-at-bathroom', roofCandidateStatus: 'rejected-by-legend', planeStatus: 'rejected-non-roof-hatch', render3d: false };
    }));
    return { sheetId: sheet.sheetId, sourceId: sheet.sourceId, levelId: sheet.levelId, sourceSha256: sheet.sourceSha256, registration, patches };
  });
  const draft = {
    artifactType: 'halofire.dillon-structural-roof-surfaces.v1',
    projectName: 'Dillon Residence',
    structuralSourceArtifactSha256: await sha256Hex(source),
    floorModelReceiptSha256: floorModel.receiptSha256,
    slopedCalibrationReceiptSha256: slopedCalibration.evidenceReceiptSha256,
    sheets,
    counts: { sourceHatchDrawings: 35, sourceHatchTriangles: 48, rejectedRecessFloorDrawings: 35, rejectedRecessFloorTriangles: 48, registeredRoofFacePatches: 0, structurallyResolvedPlanes: 0, existingCalibratedCeilingPlanes: 4, existingAbsoluteDatumCeilingPlanes: 1 },
    geometryGrounded: true,
    completeRoofPlanes: false,
    complianceReady: false,
    approvalReady: false,
    limitations: [
      'The 35 solid-gray structural drawings and 48 triangles are the legend class HATCH AREA INDICATES RECESS FLOOR AT BATHROOM, not slope roof.',
      'All previously proposed solid-gray roof candidates are rejected by the structural legend and omitted from roof top views and 3D.',
      'Actual slope-roof areas use the speckled hatch and require a separate boundary extraction tied to the explicit pitch arrows.',
      'No structural roof face is registered or promoted until that speckled hatch extraction passes legend and geometry verification.',
      'The four existing calibrated 3:12 ceiling regions remain separate evidence; only one has an absolute project-elevation datum.',
    ],
    claimStatus: 'structural-solid-gray-hatches-rejected-as-recess-floor-not-roof',
  };
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateDillonStructuralRoofPacket(input, { source, floorModel, slopedCalibration } = {}) {
  const parsed = Packet.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [issue('DILLON_STRUCTURAL_ROOF_SCHEMA_INVALID', parsed.error.issues.map((entry) => entry.message).join('; '))], complianceReady: false };
  const packet = parsed.data; const { receiptSha256, ...draft } = packet; const issues = [];
  if (await sha256Hex(draft) !== receiptSha256) issues.push(issue('DILLON_STRUCTURAL_ROOF_RECEIPT_MISMATCH', 'Structural roof packet does not match its receipt.'));
  if (!source || await sha256Hex(source) !== packet.structuralSourceArtifactSha256) issues.push(issue('DILLON_STRUCTURAL_ROOF_SOURCE_MISMATCH', 'Structural framing source artifact mismatch.'));
  if (floorModel?.receiptSha256 !== packet.floorModelReceiptSha256) issues.push(issue('DILLON_STRUCTURAL_ROOF_FLOOR_MODEL_MISMATCH', 'Floor model receipt mismatch.'));
  if (slopedCalibration?.evidenceReceiptSha256 !== packet.slopedCalibrationReceiptSha256) issues.push(issue('DILLON_STRUCTURAL_ROOF_SLOPE_CALIBRATION_MISMATCH', 'Sloped-ceiling calibration receipt mismatch.'));
  let sourceDrawings = 0; let sourceTriangles = 0; let rejectedDrawings = 0; let rejectedTriangles = 0;
  for (const sheet of packet.sheets) {
    const sourceSheet = source?.sheets?.find((entry) => entry.sheetId === sheet.sheetId); const registration = REGISTRATIONS[sheet.sheetId];
    if (!sourceSheet || sourceSheet.sourceSha256 !== sheet.sourceSha256) { issues.push(issue('DILLON_STRUCTURAL_ROOF_SHEET_SOURCE_MISMATCH', `${sheet.sheetId} source identity mismatch.`)); continue; }
    sourceDrawings += sourceSheet.counts.hatchDrawings; sourceTriangles += sourceSheet.counts.hatchTriangles; rejectedDrawings += sourceSheet.counts.hatchDrawings;
    const sourcePatches = sourceSheet.hatchDrawings.flatMap((drawing) => drawing.trianglesTopLeftPt.map((polygon, sourceSubpathIndex) => ({ drawing: drawing.sourceDrawingIndex, sourceSubpathIndex, polygon })));
    if (sheet.patches.length !== sourcePatches.length) issues.push(issue('DILLON_STRUCTURAL_ROOF_PATCH_COUNT_DRIFT', `${sheet.sheetId} patch count differs from source.`));
    for (let index = 0; index < Math.min(sheet.patches.length, sourcePatches.length); index += 1) {
      const patch = sheet.patches[index]; const expected = sourcePatches[index];
      if (patch.sourceDrawingIndex !== expected.drawing || patch.sourceSubpathIndex !== expected.sourceSubpathIndex) issues.push(issue('DILLON_STRUCTURAL_ROOF_SOURCE_POLYGON_DRIFT', `${patch.id} no longer matches its exact source triangle identity.`));
      rejectedTriangles += 1;
      if (patch.classification !== 'recess-floor-at-bathroom' || patch.roofCandidateStatus !== 'rejected-by-legend' || patch.planeStatus !== 'rejected-non-roof-hatch' || patch.render3d) issues.push(issue('DILLON_STRUCTURAL_ROOF_LEGEND_CLASSIFICATION_DRIFT', `${patch.id} no longer follows the recess-floor legend classification.`));
      if (registration.status === 'registered') {
        const transformed = expected.polygon.map((point) => transformPoint(point, registration));
        if (!patch.polygonDwgFt || patch.polygonDwgFt.some((point, pointIndex) => !near(point[0], transformed[pointIndex][0]) || !near(point[1], transformed[pointIndex][1])) || patch.render3d) issues.push(issue('DILLON_STRUCTURAL_ROOF_REGISTRATION_DRIFT', `${patch.id} registration or fail-closed 3D status drifted.`));
      } else if (patch.polygonDwgFt !== null || patch.render3d) issues.push(issue('DILLON_STRUCTURAL_ROOF_REJECTED_FACE_PROMOTED', `${patch.id} was promoted despite the legend rejection.`));
    }
  }
  const counts = packet.counts;
  if (sourceDrawings !== counts.sourceHatchDrawings || sourceTriangles !== counts.sourceHatchTriangles || rejectedDrawings !== counts.rejectedRecessFloorDrawings || rejectedTriangles !== counts.rejectedRecessFloorTriangles || counts.registeredRoofFacePatches !== 0 || counts.structurallyResolvedPlanes !== 0) issues.push(issue('DILLON_STRUCTURAL_ROOF_COUNT_DRIFT', 'Structural roof counts do not match the legend rejection state.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : packet, counts, geometryGrounded: !issues.length, completeRoofPlanes: false, complianceReady: false, claimStatus: packet.claimStatus };
}

export function buildDillonStructuralRoofModel(validation) {
  if (validation?.status !== 'passed' || !validation.packet) return { status: 'blocked', issues: [issue('DILLON_STRUCTURAL_ROOF_NOT_VALIDATED', 'Passed structural roof validation is required.')] };
  return { status: 'passed', artifactType: 'halofire.dillon-structural-roof-footprint-model.v1', footprints: [], surfaces3d: [], rejectedCandidates: validation.packet.counts.rejectedRecessFloorTriangles, counts: validation.counts, completeRoofPlanes: false, geometryGrounded: true, complianceReady: false, claimStatus: validation.packet.claimStatus };
}

export function renderDillonStructuralRoofTopView(model) {
  if (model?.status !== 'passed') return { status: 'blocked' };
  const width = 920; const height = 180;
  return { status: 'passed', svg: `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Dillon structural roof legend correction" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#07111f"/><text x="24" y="48" fill="#fca5a5" font-family="monospace" font-size="17">0 registered structural roof faces</text><text x="24" y="82" fill="#fde68a" font-family="monospace" font-size="14">48 solid-gray triangles rejected: legend class = RECESS FLOOR AT BATHROOM</text><text x="24" y="116" fill="#bae6fd" font-family="monospace" font-size="14">Actual slope roof = speckled hatch; boundary extraction pending</text><text x="24" y="150" fill="#cbd5e1" font-family="monospace" font-size="13">No rejected polygon is shown as roof or promoted to 3D.</text></svg>` };
}
