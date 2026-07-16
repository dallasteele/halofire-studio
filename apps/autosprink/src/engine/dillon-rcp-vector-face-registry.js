import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';

const SHA = z.string().regex(/^[0-9a-f]{64}$/);
const Point = z.tuple([z.number().finite(), z.number().finite()]);
const SurfaceKind = z.enum(['clg', 'soffit']);
const Face = z.object({
  id: z.string().min(1), sourceFaceIndex: z.number().int().positive(), polygonPdfPt: z.array(Point).min(3), holesPdfPt: z.array(z.array(Point).min(3)), polygonDwgFt: z.array(Point).min(3), holesDwgFt: z.array(z.array(Point).min(3)), areaPdfPt2: z.number().positive(), areaFt2: z.number().positive(),
  boundsDwgFt: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }).strict(), annotationIds: z.array(z.string()).min(1), surfaceKeys: z.array(z.string()).min(1), surfaceResolved: z.boolean(), surfaceKind: SurfaceKind.optional(), heightAboveFloorFt: z.number().positive().optional(),
}).strict();
const SourceCounts = z.object({ selectedLineSegments: z.number().int().positive(), usableLineSegments: z.number().int().positive(), polygonizedFaces: z.number().int().positive(), annotatedFaces: z.number().int().positive(), singleSurfaceFaces: z.number().int().positive(), mixedSurfaceFaces: z.number().int().nonnegative() }).strict();
const Sheet = z.object({
  sheetId: z.enum(['FP-1', 'FP-2']), levelId: z.enum(['main-house-main', 'main-house-upper']),
  source: z.object({ sourceId: z.string(), sourceSha256: SHA, pageIndex: z.literal(0), transformMethod: z.string(), transformResidualFt: z.number().max(0.05), pdfToDwgTransform: z.object({ formula: z.literal('dwgX=constantX-pdfY/scale;dwgY=constantY-pdfX/scale'), constantX: z.number(), constantY: z.number(), scalePtPerFt: z.literal(13.5) }).strict() }).strict(),
  sourceCounts: SourceCounts, faces: z.array(Face).min(1),
}).strict();
const Draft = z.object({
  artifactType: z.literal('halofire.dillon-rcp-vector-face-registry.v1'), projectName: z.literal('Dillon Residence'),
  generationPolicy: z.object({ answerKeyUsed: z.literal(false), completedBidGeometryUsed: z.literal(false), lineSelection: z.literal('black-strokes-width-1.14-1.44-1.68-2.22pt'), endpointQuantizationPt: z.literal(0.5), faceConstruction: z.literal('unary-union-plus-polygonize'), surfaceJoin: z.literal('source-annotation-point-contained-by-vector-face'), mixedSurfacePolicy: z.literal('fail-closed-unresolved') }).strict(),
  sheets: z.array(Sheet).length(2), counts: z.object({ totalVectorFaces: z.literal(386), annotatedFaces: z.literal(42), singleSurfaceFaces: z.literal(37), mixedSurfaceFaces: z.literal(5) }).strict(), geometryGrounded: z.literal(true), complete: z.literal(false), claimStatus: z.literal('source-architectural-rcp-vector-faces-not-code-compliance-or-fabrication'),
}).strict();
const Packet = Draft.extend({ receiptSha256: SHA }).strict();
const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (a, b, tolerance = 0.00005) => Math.abs(a - b) <= tolerance;

function onSegment(point, a, b) {
  const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 0.00001) return false;
  return point[0] >= Math.min(a[0], b[0]) - 0.00001 && point[0] <= Math.max(a[0], b[0]) + 0.00001 && point[1] >= Math.min(a[1], b[1]) - 0.00001 && point[1] <= Math.max(a[1], b[1]) + 0.00001;
}

function ringContains(point, polygon, includeBoundary = true) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]; const b = polygon[i];
    if (onSegment(point, a, b)) return includeBoundary;
    if ((b[1] > point[1]) !== (a[1] > point[1]) && point[0] < ((a[0] - b[0]) * (point[1] - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}

export function dillonRcpFaceContains(face, point, includeBoundary = true) {
  return ringContains(point, face.polygonDwgFt, includeBoundary) && !face.holesDwgFt.some((hole) => ringContains(point, hole, true));
}

function orientation(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function segmentTouchesRing(from, to, ring) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]; const b = ring[i];
    const o1 = orientation(from, to, a); const o2 = orientation(from, to, b); const o3 = orientation(a, b, from); const o4 = orientation(a, b, to);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
    if (Math.abs(o1) <= 0.00001 && onSegment(a, from, to)) return true;
    if (Math.abs(o2) <= 0.00001 && onSegment(b, from, to)) return true;
    if (Math.abs(o3) <= 0.00001 && onSegment(from, a, b)) return true;
    if (Math.abs(o4) <= 0.00001 && onSegment(to, a, b)) return true;
  }
  return false;
}

export function dillonRcpFaceContainsSegment(face, from, to) {
  if (!dillonRcpFaceContains(face, from, false) || !dillonRcpFaceContains(face, to, false)) return false;
  if (segmentTouchesRing(from, to, face.polygonDwgFt)) return false;
  return !face.holesDwgFt.some((hole) => segmentTouchesRing(from, to, hole));
}

export function locateDillonRcpVectorFace(packet, sheetId, point) {
  const sheet = packet?.sheets?.find((entry) => entry.sheetId === sheetId);
  if (!sheet) return { face: null, ambiguous: false };
  const matches = sheet.faces.filter((face) => face.surfaceResolved && dillonRcpFaceContains(face, point, false));
  return { face: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(sum / 2);
}

function polygonArea(outer, holes) { return ringArea(outer) - holes.reduce((sum, hole) => sum + ringArea(hole), 0); }
function surfaceKey(annotation) { return `${annotation.kind}:${Number(annotation.heightAboveFloorFt.toFixed(5))}`; }
function transformed(point, transform) { return [transform.constantX - point[1] / transform.scalePtPerFt, transform.constantY - point[0] / transform.scalePtPerFt]; }

export async function validateDillonRcpVectorFaceRegistry(input, { verticalSheets } = {}) {
  const parsed = Packet.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [issue('DILLON_RCP_FACE_SCHEMA_INVALID', parsed.error.issues.map((entry) => entry.message).join('; '))], packet: null };
  const packet = parsed.data; const { receiptSha256, ...draft } = packet; const issues = [];
  if (await sha256Hex(draft) !== receiptSha256) issues.push(issue('DILLON_RCP_FACE_RECEIPT_MISMATCH', 'RCP vector-face registry does not match its receipt.'));
  const expectedSourceCounts = { 'FP-1': [1902, 1897, 231, 28, 25, 3], 'FP-2': [1435, 1430, 155, 14, 12, 2] };
  const ids = new Set(); const annotationIds = new Set();
  let totalVectorFaces = 0; let annotatedFaces = 0; let singleSurfaceFaces = 0; let mixedSurfaceFaces = 0;
  for (const sheet of packet.sheets) {
    const sourceSheet = verticalSheets?.find((entry) => entry.sheetId === sheet.sheetId);
    if (!sourceSheet || sourceSheet.levelId !== sheet.levelId || sourceSheet.source.sourceId !== sheet.source.sourceId || sourceSheet.source.sourceSha256 !== sheet.source.sourceSha256 || sourceSheet.source.transformMethod !== sheet.source.transformMethod || !near(sourceSheet.source.transformResidualFt, sheet.source.transformResidualFt)) issues.push(issue('DILLON_RCP_FACE_SOURCE_MISMATCH', `${sheet.sheetId} RCP source identity or transform does not match the sealed vertical source.`));
    const expected = expectedSourceCounts[sheet.sheetId]; const actual = Object.values(sheet.sourceCounts);
    if (actual.some((value, index) => value !== expected[index])) issues.push(issue('DILLON_RCP_FACE_EXTRACTION_COUNT_DRIFT', `${sheet.sheetId} vector extraction counts differ from the sealed source replay.`));
    const annotations = new Map((sourceSheet?.annotations || []).map((entry) => [entry.id, entry]));
    let resolved = 0; let mixed = 0; const sourceFaceIndexes = new Set();
    for (const face of sheet.faces) {
      if (ids.has(face.id)) issues.push(issue('DILLON_RCP_FACE_ID_DUPLICATE', `${face.id} is duplicated.`)); ids.add(face.id);
      if (sourceFaceIndexes.has(face.sourceFaceIndex)) issues.push(issue('DILLON_RCP_FACE_INDEX_DUPLICATE', `${sheet.sheetId} source face index ${face.sourceFaceIndex} is duplicated.`)); sourceFaceIndexes.add(face.sourceFaceIndex);
      if (face.polygonPdfPt.length !== face.polygonDwgFt.length || face.holesPdfPt.length !== face.holesDwgFt.length) issues.push(issue('DILLON_RCP_FACE_TRANSFORM_SHAPE_INVALID', `${face.id} PDF and DWG rings do not correspond.`));
      face.polygonPdfPt.forEach((point, index) => { const expectedPoint = transformed(point, sheet.source.pdfToDwgTransform); const actualPoint = face.polygonDwgFt[index]; if (!actualPoint || !near(actualPoint[0], expectedPoint[0]) || !near(actualPoint[1], expectedPoint[1])) issues.push(issue('DILLON_RCP_FACE_TRANSFORM_DRIFT', `${face.id} exterior does not follow the sealed transform.`)); });
      face.holesPdfPt.forEach((ring, ringIndex) => ring.forEach((point, pointIndex) => { const expectedPoint = transformed(point, sheet.source.pdfToDwgTransform); const actualPoint = face.holesDwgFt[ringIndex]?.[pointIndex]; if (!actualPoint || !near(actualPoint[0], expectedPoint[0]) || !near(actualPoint[1], expectedPoint[1])) issues.push(issue('DILLON_RCP_FACE_TRANSFORM_DRIFT', `${face.id} hole does not follow the sealed transform.`)); }));
      const areaPdf = polygonArea(face.polygonPdfPt, face.holesPdfPt); const areaFt = polygonArea(face.polygonDwgFt, face.holesDwgFt);
      if (!near(face.areaPdfPt2, areaPdf, 0.1) || !near(face.areaFt2, areaFt, 0.001)) issues.push(issue('DILLON_RCP_FACE_AREA_DRIFT', `${face.id} area does not match its rings.`));
      const xs = face.polygonDwgFt.map((point) => point[0]); const ys = face.polygonDwgFt.map((point) => point[1]);
      if (!near(face.boundsDwgFt.minX, Math.min(...xs)) || !near(face.boundsDwgFt.minY, Math.min(...ys)) || !near(face.boundsDwgFt.maxX, Math.max(...xs)) || !near(face.boundsDwgFt.maxY, Math.max(...ys))) issues.push(issue('DILLON_RCP_FACE_BOUNDS_DRIFT', `${face.id} bounds do not match its DWG polygon.`));
      const sourceAnnotations = face.annotationIds.map((id) => annotations.get(id));
      if (sourceAnnotations.some((entry) => !entry) || face.annotationIds.some((id) => { if (annotationIds.has(id)) return true; annotationIds.add(id); return false; })) issues.push(issue('DILLON_RCP_FACE_ANNOTATION_INVALID', `${face.id} annotations are missing or reused across faces.`));
      const keys = [...new Set(sourceAnnotations.filter(Boolean).map(surfaceKey))].sort();
      if (JSON.stringify(keys) !== JSON.stringify(face.surfaceKeys)) issues.push(issue('DILLON_RCP_FACE_SURFACE_KEY_DRIFT', `${face.id} surface keys do not match source annotations.`));
      if (face.surfaceResolved) {
        resolved += 1;
        const annotation = sourceAnnotations[0];
        if (keys.length !== 1 || !annotation || face.surfaceKind !== annotation.kind || !near(face.heightAboveFloorFt, annotation.heightAboveFloorFt)) issues.push(issue('DILLON_RCP_FACE_FALSE_RESOLUTION', `${face.id} is not a single-source-surface face.`));
      } else {
        mixed += 1;
        if (keys.length < 2 || face.surfaceKind != null || face.heightAboveFloorFt != null) issues.push(issue('DILLON_RCP_FACE_MIXED_PROMOTION', `${face.id} mixed source surfaces must remain unresolved.`));
      }
    }
    if (sheet.faces.length !== sheet.sourceCounts.annotatedFaces || resolved !== sheet.sourceCounts.singleSurfaceFaces || mixed !== sheet.sourceCounts.mixedSurfaceFaces) issues.push(issue('DILLON_RCP_FACE_SHEET_COUNT_DRIFT', `${sheet.sheetId} face counts do not match its registry.`));
    totalVectorFaces += sheet.sourceCounts.polygonizedFaces; annotatedFaces += sheet.faces.length; singleSurfaceFaces += resolved; mixedSurfaceFaces += mixed;
  }
  if (totalVectorFaces !== packet.counts.totalVectorFaces || annotatedFaces !== packet.counts.annotatedFaces || singleSurfaceFaces !== packet.counts.singleSurfaceFaces || mixedSurfaceFaces !== packet.counts.mixedSurfaceFaces) issues.push(issue('DILLON_RCP_FACE_TOTAL_COUNT_DRIFT', 'Registry totals do not match sheet evidence.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : packet, counts: packet.counts, geometryGrounded: !issues.length, complete: false, claimStatus: packet.claimStatus };
}
