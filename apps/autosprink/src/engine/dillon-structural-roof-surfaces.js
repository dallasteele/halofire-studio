import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';

const SHA = z.string().regex(/^[0-9a-f]{64}$/);
const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Polygon = z.array(Point).min(3);
const SourceTriangle = z.array(Point).length(3);
const RejectedPatch = z.object({
  id: z.string(), sourceDrawingIndex: z.number().int().nonnegative(), sourceSubpathIndex: z.number().int().nonnegative(),
  polygonDwgFt: z.union([SourceTriangle, z.null()]), classification: z.literal('recess-floor-at-bathroom'),
  roofCandidateStatus: z.literal('rejected-by-legend'), planeStatus: z.literal('rejected-non-roof-hatch'), render3d: z.literal(false),
}).strict();
const RoofContourBase = z.object({
  id: z.string(), sourcePolygonTopLeftPt: Polygon, sourceHolesTopLeftPt: z.array(Polygon),
  boundaryStatus: z.literal('reconstructed-from-exploded-vector-speckle-strokes'), reconstructionTolerancePt: z.literal(4),
  sourceSpeckleStrokeCount: z.number().int().positive(), classification: z.literal('slope-roof'), pitchControlIds: z.array(z.string()),
  pitchAssociationStatus: z.enum(['source-arrow-linked', 'unlinked']), datumAssociationStatus: z.literal('unlinked'),
  planeStatus: z.literal('blocked-pitch-or-datum-unlinked'), render3d: z.literal(false),
});
const RoofContour = z.discriminatedUnion('registrationStatus', [
  RoofContourBase.extend({ registrationStatus: z.literal('registered'), polygonDwgFt: Polygon, holesDwgFt: z.array(Polygon) }).strict(),
  RoofContourBase.extend({ registrationStatus: z.literal('ambiguous-horizontal-mirror'), polygonDwgFt: z.null(), holesDwgFt: z.null() }).strict(),
]);
const Registration = z.discriminatedUnion('status', [
  z.object({ status: z.literal('registered'), method: z.literal('axis-coordinate vector consensus against source-DWG wall polygons'), pointsPerFoot: z.literal(13.5), pageHeightPt: z.literal(2160), xSign: z.literal(1), ySign: z.literal(1), translateXFt: z.number(), translateYFt: z.number(), matchedCoordinates: z.number().int().min(100), weightedRmsXFt: z.number().max(0.025), weightedRmsYFt: z.number().max(0.025), alternateScoreMargin: z.number().positive() }).strict(),
  z.object({ status: z.literal('ambiguous-horizontal-mirror'), method: z.literal('axis-coordinate vector consensus produced near-tied mirrored candidates'), pointsPerFoot: z.literal(13.5), pageHeightPt: z.literal(2160), candidates: z.array(z.object({ xSign: z.union([z.literal(-1), z.literal(1)]), ySign: z.literal(1), translateXFt: z.number(), translateYFt: z.number(), score: z.number().positive() }).strict()).length(2), scoreMarginRatio: z.number().min(0).max(0.02) }).strict(),
]);
const Sheet = z.object({
  sheetId: z.enum(['S-020', 'S-021', 'TOY-FRAMING']), sourceId: z.string(), levelId: z.enum(['main-house-main', 'main-house-upper', 'toy-garage']),
  sourceSha256: SHA, registration: Registration, rejectedPatches: z.array(RejectedPatch).min(1), roofContours: z.array(RoofContour).min(1),
}).strict();
const Counts = z.object({
  sourceHatchDrawings: z.literal(35), sourceHatchTriangles: z.literal(48), rejectedRecessFloorDrawings: z.literal(35), rejectedRecessFloorTriangles: z.literal(48),
  sourceSpeckleStrokes: z.literal(63267), sourceSpeckleContours: z.literal(15), registeredRoofFacePatches: z.literal(11),
  sourcePitchLinkedRoofContours: z.literal(1), registeredPitchLinkedRoofContours: z.literal(0), structurallyResolvedPlanes: z.literal(0),
  existingCalibratedCeilingPlanes: z.literal(4), existingAbsoluteDatumCeilingPlanes: z.literal(1),
}).strict();
const Draft = z.object({
  artifactType: z.literal('halofire.dillon-structural-roof-surfaces.v2'), projectName: z.literal('Dillon Residence'), structuralSourceArtifactSha256: SHA,
  floorModelReceiptSha256: SHA, slopedCalibrationReceiptSha256: SHA, sheets: z.array(Sheet).length(3), counts: Counts,
  geometryGrounded: z.literal(true), completeRoofPlanes: z.literal(false), complianceReady: z.literal(false), approvalReady: z.literal(false),
  limitations: z.array(z.string()).min(5), claimStatus: z.literal('structural-speckled-roof-contours-registered-planes-blocked'),
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

function polygonsNear(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((point, index) => near(point[0], expected[index][0]) && near(point[1], expected[index][1]));
}

function polygonListsNear(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((polygon, index) => polygonsNear(polygon, expected[index]));
}

export async function buildDillonStructuralRoofPacket(source, floorModel, slopedCalibration) {
  const sheets = source.sheets.map((sheet) => {
    const registration = REGISTRATIONS[sheet.sheetId];
    const rejectedPatches = sheet.hatchDrawings.flatMap((drawing) => drawing.trianglesTopLeftPt.map((polygon, sourceSubpathIndex) => ({
      id: `${sheet.sheetId.toLowerCase()}-rejected-${drawing.sourceDrawingIndex}-${sourceSubpathIndex}`, sourceDrawingIndex: drawing.sourceDrawingIndex, sourceSubpathIndex,
      polygonDwgFt: registration.status === 'registered' ? polygon.map((point) => transformPoint(point, registration)) : null,
      classification: 'recess-floor-at-bathroom', roofCandidateStatus: 'rejected-by-legend', planeStatus: 'rejected-non-roof-hatch', render3d: false,
    })));
    const roofContours = sheet.speckledRoofExtraction.contours.map((contour) => {
      const base = {
        id: contour.id, sourcePolygonTopLeftPt: contour.exteriorTopLeftPt, sourceHolesTopLeftPt: contour.holesTopLeftPt,
        boundaryStatus: contour.boundaryStatus, reconstructionTolerancePt: contour.reconstructionTolerancePt,
        sourceSpeckleStrokeCount: contour.sourceSpeckleStrokeCount, classification: 'slope-roof', pitchControlIds: contour.pitchControlIds,
        pitchAssociationStatus: contour.pitchControlIds.length ? 'source-arrow-linked' : 'unlinked', datumAssociationStatus: 'unlinked',
        planeStatus: 'blocked-pitch-or-datum-unlinked', render3d: false,
      };
      if (registration.status === 'registered') return {
        ...base, registrationStatus: 'registered', polygonDwgFt: contour.exteriorTopLeftPt.map((point) => transformPoint(point, registration)),
        holesDwgFt: contour.holesTopLeftPt.map((hole) => hole.map((point) => transformPoint(point, registration))),
      };
      return { ...base, registrationStatus: 'ambiguous-horizontal-mirror', polygonDwgFt: null, holesDwgFt: null };
    });
    return { sheetId: sheet.sheetId, sourceId: sheet.sourceId, levelId: sheet.levelId, sourceSha256: sheet.sourceSha256, registration, rejectedPatches, roofContours };
  });
  const draft = {
    artifactType: 'halofire.dillon-structural-roof-surfaces.v2', projectName: 'Dillon Residence', structuralSourceArtifactSha256: await sha256Hex(source),
    floorModelReceiptSha256: floorModel.receiptSha256, slopedCalibrationReceiptSha256: slopedCalibration.evidenceReceiptSha256, sheets,
    counts: {
      sourceHatchDrawings: 35, sourceHatchTriangles: 48, rejectedRecessFloorDrawings: 35, rejectedRecessFloorTriangles: 48,
      sourceSpeckleStrokes: 63267, sourceSpeckleContours: 15, registeredRoofFacePatches: 11, sourcePitchLinkedRoofContours: 1,
      registeredPitchLinkedRoofContours: 0, structurallyResolvedPlanes: 0, existingCalibratedCeilingPlanes: 4, existingAbsoluteDatumCeilingPlanes: 1,
    },
    geometryGrounded: true, completeRoofPlanes: false, complianceReady: false, approvalReady: false,
    limitations: [
      'The 35 solid-gray structural drawings and 48 triangles remain rejected as the legend class RECESS FLOOR AT BATHROOM.',
      'The 15 slope-roof contours are reconstructed only from 63,267 clipped vector strokes on the Roof-Hatch optional-content layer and carry a 4-point (0.296-foot) boundary tolerance.',
      'Eleven main and upper contours use the source-DWG registration; all four toy contours remain unregistered because the horizontal mirror candidates are near-tied.',
      'Only one pitch arrow lands directly on a speckled contour, and it belongs to the unregistered toy sheet; no registered contour has a source-bound pitch direction.',
      'No structural contour has an absolute elevation datum association, so zero structural roof planes are promoted to 3D.',
      'The four existing calibrated 3:12 ceiling regions remain separate evidence; only one has an absolute project-elevation datum.',
    ],
    claimStatus: 'structural-speckled-roof-contours-registered-planes-blocked',
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
  let sourceDrawings = 0; let sourceTriangles = 0; let sourceStrokes = 0; let sourceContours = 0; let registeredContours = 0; let pitchLinked = 0; let registeredPitchLinked = 0;
  for (const sheet of packet.sheets) {
    const sourceSheet = source?.sheets?.find((entry) => entry.sheetId === sheet.sheetId); const registration = REGISTRATIONS[sheet.sheetId];
    if (!sourceSheet || sourceSheet.sourceSha256 !== sheet.sourceSha256) { issues.push(issue('DILLON_STRUCTURAL_ROOF_SHEET_SOURCE_MISMATCH', `${sheet.sheetId} source identity mismatch.`)); continue; }
    if (JSON.stringify(sheet.registration) !== JSON.stringify(registration)) issues.push(issue('DILLON_STRUCTURAL_ROOF_REGISTRATION_DRIFT', `${sheet.sheetId} registration differs from the sealed transform.`));
    sourceDrawings += sourceSheet.counts.hatchDrawings; sourceTriangles += sourceSheet.counts.hatchTriangles;
    sourceStrokes += sourceSheet.counts.slopeRoofSpeckleStrokes; sourceContours += sourceSheet.counts.slopeRoofContours;
    const expectedRejected = sourceSheet.hatchDrawings.flatMap((drawing) => drawing.trianglesTopLeftPt.map((polygon, sourceSubpathIndex) => ({ drawing: drawing.sourceDrawingIndex, sourceSubpathIndex, polygon })));
    if (sheet.rejectedPatches.length !== expectedRejected.length) issues.push(issue('DILLON_STRUCTURAL_ROOF_REJECTED_COUNT_DRIFT', `${sheet.sheetId} rejected patch count differs from source.`));
    for (let index = 0; index < Math.min(sheet.rejectedPatches.length, expectedRejected.length); index += 1) {
      const patch = sheet.rejectedPatches[index]; const expected = expectedRejected[index];
      if (patch.sourceDrawingIndex !== expected.drawing || patch.sourceSubpathIndex !== expected.sourceSubpathIndex || patch.render3d || patch.classification !== 'recess-floor-at-bathroom') issues.push(issue('DILLON_STRUCTURAL_ROOF_LEGEND_CLASSIFICATION_DRIFT', `${patch.id} no longer follows the recess-floor rejection.`));
      if (registration.status === 'registered' && !polygonsNear(patch.polygonDwgFt, expected.polygon.map((point) => transformPoint(point, registration)))) issues.push(issue('DILLON_STRUCTURAL_ROOF_REJECTED_REGISTRATION_DRIFT', `${patch.id} rejected-source registration drifted.`));
      if (registration.status !== 'registered' && patch.polygonDwgFt !== null) issues.push(issue('DILLON_STRUCTURAL_ROOF_REJECTED_FACE_PROMOTED', `${patch.id} was registered despite the ambiguous transform.`));
    }
    const expectedContours = sourceSheet.speckledRoofExtraction.contours;
    if (sheet.roofContours.length !== expectedContours.length) issues.push(issue('DILLON_STRUCTURAL_ROOF_CONTOUR_COUNT_DRIFT', `${sheet.sheetId} roof contour count differs from source.`));
    for (let index = 0; index < Math.min(sheet.roofContours.length, expectedContours.length); index += 1) {
      const contour = sheet.roofContours[index]; const expected = expectedContours[index];
      if (contour.id !== expected.id || !polygonsNear(contour.sourcePolygonTopLeftPt, expected.exteriorTopLeftPt) || !polygonListsNear(contour.sourceHolesTopLeftPt, expected.holesTopLeftPt) || contour.sourceSpeckleStrokeCount !== expected.sourceSpeckleStrokeCount || JSON.stringify(contour.pitchControlIds) !== JSON.stringify(expected.pitchControlIds)) issues.push(issue('DILLON_STRUCTURAL_ROOF_SOURCE_CONTOUR_DRIFT', `${contour.id} no longer matches its vector-speckle source evidence.`));
      if (contour.render3d || contour.planeStatus !== 'blocked-pitch-or-datum-unlinked' || contour.datumAssociationStatus !== 'unlinked') issues.push(issue('DILLON_STRUCTURAL_ROOF_UNRESOLVED_PLANE_PROMOTED', `${contour.id} was promoted without pitch and datum joins.`));
      if (contour.pitchControlIds.length) pitchLinked += 1;
      if (registration.status === 'registered') {
        registeredContours += 1; if (contour.pitchControlIds.length) registeredPitchLinked += 1;
        const transformed = expected.exteriorTopLeftPt.map((point) => transformPoint(point, registration));
        const transformedHoles = expected.holesTopLeftPt.map((hole) => hole.map((point) => transformPoint(point, registration)));
        if (contour.registrationStatus !== 'registered' || !polygonsNear(contour.polygonDwgFt, transformed) || !polygonListsNear(contour.holesDwgFt, transformedHoles)) issues.push(issue('DILLON_STRUCTURAL_ROOF_CONTOUR_REGISTRATION_DRIFT', `${contour.id} registered contour drifted.`));
      } else if (contour.registrationStatus !== 'ambiguous-horizontal-mirror' || contour.polygonDwgFt !== null || contour.holesDwgFt !== null) issues.push(issue('DILLON_STRUCTURAL_ROOF_AMBIGUOUS_CONTOUR_PROMOTED', `${contour.id} was promoted despite the ambiguous toy transform.`));
    }
  }
  const counts = packet.counts;
  if (sourceDrawings !== counts.sourceHatchDrawings || sourceTriangles !== counts.sourceHatchTriangles || sourceStrokes !== counts.sourceSpeckleStrokes || sourceContours !== counts.sourceSpeckleContours || registeredContours !== counts.registeredRoofFacePatches || pitchLinked !== counts.sourcePitchLinkedRoofContours || registeredPitchLinked !== counts.registeredPitchLinkedRoofContours || counts.structurallyResolvedPlanes !== 0) issues.push(issue('DILLON_STRUCTURAL_ROOF_COUNT_DRIFT', 'Structural roof counts do not match the sealed speckle, registration, pitch, and datum evidence.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : packet, counts, geometryGrounded: !issues.length, completeRoofPlanes: false, complianceReady: false, claimStatus: packet.claimStatus };
}

export function buildDillonStructuralRoofModel(validation) {
  if (validation?.status !== 'passed' || !validation.packet) return { status: 'blocked', issues: [issue('DILLON_STRUCTURAL_ROOF_NOT_VALIDATED', 'Passed structural roof validation is required.')] };
  const footprints = validation.packet.sheets.flatMap((sheet) => sheet.roofContours.filter((contour) => contour.registrationStatus === 'registered').map((contour) => ({ id: contour.id, sheetId: sheet.sheetId, levelId: sheet.levelId, sourcePolygonTopLeftPt: contour.sourcePolygonTopLeftPt, sourceHolesTopLeftPt: contour.sourceHolesTopLeftPt, polygonDwgFt: contour.polygonDwgFt, holesDwgFt: contour.holesDwgFt, reconstructionToleranceFt: round(contour.reconstructionTolerancePt / 13.5), pitchAssociationStatus: contour.pitchAssociationStatus, datumAssociationStatus: contour.datumAssociationStatus, render3d: false })));
  return { status: 'passed', artifactType: 'halofire.dillon-structural-roof-footprint-model.v2', footprints, surfaces3d: [], rejectedCandidates: validation.packet.counts.rejectedRecessFloorTriangles, counts: validation.counts, completeRoofPlanes: false, geometryGrounded: true, complianceReady: false, claimStatus: validation.packet.claimStatus };
}

function pathForSourcePolygon(polygon) {
  return polygon.map((point, index) => `${index ? 'L' : 'M'}${round(point[0])},${round(point[1])}`).join(' ') + ' Z';
}

function manifestSheetFor(sheetId, sourceSheet, underlayManifest) {
  const underlay = underlayManifest?.sheets?.find((entry) => entry.sheetId === sheetId);
  if (!underlay || underlay.sourceId !== sourceSheet?.sourceId || underlay.sourcePdfSha256 !== sourceSheet?.sourceSha256 || underlay.widthPt !== sourceSheet?.pageTopLeftPt?.width || underlay.heightPt !== sourceSheet?.pageTopLeftPt?.height || !/^\/public\/plan-underlays\/dillon-structural-roof\/[A-Za-z0-9._-]+\.png$/.test(underlay.url || '') || !/^[0-9a-f]{64}$/.test(underlay.pngSha256 || '')) return null;
  return underlay;
}

export function renderDillonStructuralRoofTopView(model, source, underlayManifest) {
  if (model?.status !== 'passed') return { status: 'blocked' };
  const sourceSheets = ['S-020', 'S-021'].map((sheetId) => source?.sheets?.find((entry) => entry.sheetId === sheetId));
  const underlays = sourceSheets.map((sourceSheet) => manifestSheetFor(sourceSheet?.sheetId, sourceSheet, underlayManifest));
  if (sourceSheets.some((sheet) => !sheet) || underlays.some((entry) => !entry)) return { status: 'blocked', issues: [issue('DILLON_STRUCTURAL_ROOF_UNDERLAY_BINDING_INVALID', 'Exact hash-bound S-020 and S-021 structural PDF underlays are required.')] };
  const width = 920; const height = 1465; const panelX = 20; const panelWidth = 880; const scale = panelWidth / 3024; const firstY = 100; const secondY = 790;
  const renderPanel = (sourceSheet, underlay, panelY) => {
    const footprints = model.footprints.filter((entry) => entry.sheetId === sourceSheet.sheetId);
    const contours = footprints.map((footprint) => `<path d="${pathForSourcePolygon(footprint.sourcePolygonTopLeftPt)}" fill="#f9731630" stroke="#ea580c" stroke-width="9" vector-effect="non-scaling-stroke"><title>${footprint.id} · exact PDF coordinates · ${footprint.reconstructionToleranceFt} ft reconstruction tolerance · not a 3D plane</title></path>`).join('');
    const pitchControls = sourceSheet.pitchControls.map((control) => {
      const [x, y] = control.arrowTipTopLeftPt; const [dx, dy] = control.slopeDirectionTopLeftUnit; const linked = control.associationStatus === 'linked-to-speckled-contour';
      return `<g><circle cx="${x}" cy="${y}" r="18" fill="${linked ? '#16a34a' : '#2563eb'}" stroke="#fff" stroke-width="6" vector-effect="non-scaling-stroke"/><line x1="${x}" y1="${y}" x2="${round(x + dx * 120)}" y2="${round(y + dy * 120)}" stroke="${linked ? '#16a34a' : '#2563eb'}" stroke-width="9" stroke-dasharray="22 13" vector-effect="non-scaling-stroke"/><title>${control.id} · ${control.sourceText} · ${linked ? 'source linked' : 'unlinked'} · direction ${dx},${dy}</title></g>`;
    }).join('');
    const datums = sourceSheet.topPlateControls.map((control) => {
      const [x0, y0, x1, y1] = control.bboxTopLeftPt;
      return `<rect x="${x0 - 8}" y="${y0 - 8}" width="${x1 - x0 + 16}" height="${y1 - y0 + 16}" fill="#facc1530" stroke="#ca8a04" stroke-width="7" vector-effect="non-scaling-stroke"><title>${control.sourceText} · extracted top-plate text only · not joined to a roof face</title></rect>`;
    }).join('');
    return `<text x="${panelX}" y="${panelY - 16}" fill="#e2e8f0" font-family="system-ui" font-size="17" font-weight="700">${sourceSheet.sheetId} · exact PDF underlay ${sourceSheet.sourceSha256.slice(0, 12)}…</text><g transform="translate(${panelX} ${panelY}) scale(${scale})"><image href="${underlay.url}" x="0" y="0" width="3024" height="2160" preserveAspectRatio="none"/>${contours}${pitchControls}${datums}</g>`;
  };
  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Dillon structural PDF roof evidence overlays" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#07111f"/><text x="20" y="28" fill="#f8fafc" font-family="system-ui" font-size="19" font-weight="700">Actual structural sheets · source-coordinate evidence overlay</text><text x="20" y="50" fill="#94a3b8" font-family="monospace" font-size="12">orange = Roof-Hatch contour · blue = unlinked pitch arrow · yellow = unlinked T.P. text</text>${renderPanel(sourceSheets[0], underlays[0], firstY)}${renderPanel(sourceSheets[1], underlays[1], secondY)}<text x="20" y="1438" fill="#fde68a" font-family="monospace" font-size="13">0 structural 3D planes · pitch/datum joins remain blocked · 48 gray recess-floor triangles rejected</text><text x="20" y="1457" fill="#cbd5e1" font-family="monospace" font-size="12">Exact underlays and overlays are evidence only — not compliance, fabrication, or field release.</text></svg>`;
  return { status: 'passed', svg, sourceCoordinateOverlay: true, underlays: underlays.map(({ sheetId, sourcePdfSha256, pngSha256, url }) => ({ sheetId, sourcePdfSha256, pngSha256, url })) };
}
