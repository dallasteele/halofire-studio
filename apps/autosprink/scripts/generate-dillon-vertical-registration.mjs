import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../src/engine/elevation-datums.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const bid = read(path.join(root, 'src/data/dillon-completed-bid-geometry.json'));
const floorModel = read(path.join(root, 'src/data/dillon-floor-by-floor-model.json'));
const slope = read(path.join(root, 'src/data/submitted-sloped-ceiling-calibration.dillon.json'));
const temp = path.join(root, 'tmp/pdfs/dillon-roof-calibration');
const analyses = { 'FP-1': read(path.join(temp, 'fp-1-ceiling-analysis.json')), 'FP-2': read(path.join(temp, 'fp-2-ceiling-analysis.json')) };
const round = (value) => Number(value.toFixed(5));
const inside = (point, polygon) => { let result = false; for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j]; if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) result = !result; } return result; };

const sourceConfigs = {
  'FP-1': { sourceId: 'main-rcp-pdf', sourceSha256: 'ed51fe47cdbb0c95db5d3a4f64117fe2625d3c0bf4e7170c6f3dec0d38ed11ba', transformMethod: 'sealed-RCP-to-FP1 transform composed with 195-coordinate FP1-to-main-DWG transform', transformResidualFt: 0.04 },
  'FP-2': { sourceId: 'upper-floor-pdf', sourceSha256: '5175c15b80a53014b0dfd98f1ca5038a70ecb9578e004cda4f954aafc511a564', transformMethod: '177-coordinate cropped upper-ceiling-view to upper-DWG vector match', transformResidualFt: 0.01637 },
};
const annotationsBySheet = {};
for (const [sheetId, analysis] of Object.entries(analyses)) {
  annotationsBySheet[sheetId] = analysis.annotations.map((annotation) => ({ id: annotation.id, kind: annotation.kind, heightAboveFloorFt: round(annotation.height), sourceText: annotation.text, sourceTopLeftPt: annotation.topLeft.map(round), planPointDwgFt: annotation.dwg.map(round), sourceBlockIndex: annotation.block }));
}
const annotationMap = new Map(Object.values(annotationsBySheet).flat().map((annotation) => [annotation.id, annotation]));
const analysisMap = new Map(Object.entries(analyses).flatMap(([sheetId, analysis]) => analysis.assignments.map((assignment) => [`${sheetId}:${assignment.headId}`, assignment])));

const protectedRegion = slope.slopeRegions.find((region) => region.id === 'slope-region-east-covered');
const submittedToDwg = ([x, y]) => [round(x / 13.5 - 76.70833), round(17.14583 - y / 13.5)];
const protectedPolygonDwgFt = protectedRegion.polygonSubmittedPt.map(submittedToDwg);
function slopeHeightAtDwg([, y]) {
  const submittedY = (17.14583 - y) * 13.5;
  return round(9 - ((submittedY - protectedRegion.elevationDatum.datumPointSubmittedPt[1]) / 13.5) * 3 / 12);
}
function trustedFlatAssignment(sheetId, analysisAssignment) {
  if (!analysisAssignment) return null;
  const [first, second] = analysisAssignment.nearest; const a = annotationMap.get(first.annotationId); const b = annotationMap.get(second.annotationId);
  const trusted = first.distanceFt <= 3 || (first.distanceFt <= 6 && a.kind === b.kind && a.heightAboveFloorFt === b.heightAboveFloorFt);
  return trusted ? { method: first.distanceFt <= 3 ? 'nearest-source-annotation-within-3ft' : 'two-nearest-source-annotations-agree-within-6ft', annotationId: a.id, surfaceKind: a.kind, heightAboveFloorFt: a.heightAboveFloorFt, sourceDistanceFt: round(first.distanceFt) } : null;
}
function assignmentForPoint(sheetId, point, analysisAssignment = null) {
  if (sheetId === 'FP-1' && inside(point, protectedPolygonDwgFt)) return { method: 'sealed-3:12-source-plane', annotationId: protectedRegion.annotationId, surfaceKind: 'sloped-ceiling', heightAboveFloorFt: slopeHeightAtDwg(point), sourceDistanceFt: 0 };
  if (analysisAssignment) return trustedFlatAssignment(sheetId, analysisAssignment);
  const rows = annotationsBySheet[sheetId].map((annotation) => ({ annotation, distanceFt: Math.hypot(point[0] - annotation.planPointDwgFt[0], point[1] - annotation.planPointDwgFt[1]) })).sort((a, b) => a.distanceFt - b.distanceFt);
  if (rows.length < 2) return null;
  return trustedFlatAssignment(sheetId, { nearest: rows.slice(0, 2).map((row) => ({ annotationId: row.annotation.id, distanceFt: row.distanceFt })) });
}

const sheets = bid.sheets.map((sheet) => {
  const level = floorModel.levels.find((entry) => entry.id === sheet.levelId);
  const headAssignments = sheet.heads.map((head) => {
    const assignment = assignmentForPoint(sheet.id, head.planPointDwgFt, analysisMap.get(`${sheet.id}:${head.id}`));
    return assignment ? { headId: head.id, planPointDwgFt: head.planPointDwgFt, ...assignment, modelElevationFt: round(level.modelElevationFt + assignment.heightAboveFloorFt), siteProjectElevationFt: round(level.projectFloorElevationFt + assignment.heightAboveFloorFt), status: 'source-assigned' } : { headId: head.id, planPointDwgFt: head.planPointDwgFt, status: 'unresolved' };
  });
  const pipeAssignments = sheet.pipeSegments.map((pipe) => {
    const endpoints = pipe.planDwgFt.map((point) => assignmentForPoint(sheet.id, point));
    if (endpoints.every(Boolean) && ((endpoints[0].annotationId === endpoints[1].annotationId && endpoints[0].heightAboveFloorFt === endpoints[1].heightAboveFloorFt) || endpoints.every((entry) => entry.method === 'sealed-3:12-source-plane'))) {
      return { pipeId: pipe.id, planDwgFt: pipe.planDwgFt, endpointMethods: endpoints.map((entry) => entry.method), endpointAnnotationIds: endpoints.map((entry) => entry.annotationId), heightAboveFloorFt: endpoints.map((entry) => entry.heightAboveFloorFt), modelElevationsFt: endpoints.map((entry) => round(level.modelElevationFt + entry.heightAboveFloorFt)), siteProjectElevationsFt: endpoints.map((entry) => round(level.projectFloorElevationFt + entry.heightAboveFloorFt)), status: 'source-assigned' };
    }
    return { pipeId: pipe.id, planDwgFt: pipe.planDwgFt, status: 'unresolved' };
  });
  return { sheetId: sheet.id, levelId: sheet.levelId, source: sourceConfigs[sheet.id], annotations: annotationsBySheet[sheet.id], headAssignments, pipeAssignments };
});
const assignedHeads = sheets.reduce((n, sheet) => n + sheet.headAssignments.filter((entry) => entry.status === 'source-assigned').length, 0);
const assignedPipes = sheets.reduce((n, sheet) => n + sheet.pipeAssignments.filter((entry) => entry.status === 'source-assigned').length, 0);
const draft = {
  artifactType: 'halofire.dillon-vertical-registration.v1', projectName: 'Dillon Residence', completedBidGeometryReceiptSha256: bid.receiptSha256, floorModelReceiptSha256: floorModel.receiptSha256, slopedCalibrationReceiptSha256: slope.evidenceReceiptSha256,
  sheets, counts: { totalHeads: 76, sourceAssignedHeads: assignedHeads, unresolvedHeads: 76 - assignedHeads, totalPipeSegments: 67, sourceAssignedPipeSegments: assignedPipes, unresolvedPipeSegments: 67 - assignedPipes },
  complete: false, geometryGrounded: true, complianceReady: false, approvalReady: false,
  limitations: ['Only redundant-nearest-annotation consensus or the sealed 3:12 source plane assigns Z; no default story height is used.', 'Elements crossing ceiling zones or lacking nearby agreeing source annotations remain unresolved.', 'Ceiling-surface elevation is not a manufacturer deflector-offset or fabrication elevation.', 'The missing FP-1 scheduled head remains unresolved.'],
  claimStatus: 'partial-source-bound-vertical-registration-not-code-compliance-or-fabrication',
};
const packet = { ...draft, receiptSha256: await sha256Hex(draft) };
fs.writeFileSync(path.join(root, 'src/data/dillon-vertical-registration.json'), `${JSON.stringify(packet)}\n`);
console.log(JSON.stringify({ receiptSha256: packet.receiptSha256, counts: packet.counts, sheets: packet.sheets.map((sheet) => ({ sheetId: sheet.sheetId, annotations: sheet.annotations.length, assignedHeads: sheet.headAssignments.filter((entry) => entry.status === 'source-assigned').length, assignedPipes: sheet.pipeAssignments.filter((entry) => entry.status === 'source-assigned').length })) }, null, 2));
