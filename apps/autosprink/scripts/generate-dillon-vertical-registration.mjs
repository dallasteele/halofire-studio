import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../src/engine/elevation-datums.js';
import { buildDillonSourceRoomRegistry, dillonSourceRoomRegistryPacket } from '../src/engine/dillon-source-room-registry.js';
import { dillonRcpFaceContainsSegment, locateDillonRcpVectorFace } from '../src/engine/dillon-rcp-vector-face-registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const bid = read(path.join(root, 'src/data/dillon-completed-bid-geometry.json'));
const floorModel = read(path.join(root, 'src/data/dillon-floor-by-floor-model.json'));
const sourceGeometry = read(path.join(root, 'src/data/dillon-dwg-source-geometry.json'));
const slope = read(path.join(root, 'src/data/submitted-sloped-ceiling-calibration.dillon.json'));
const rcpFaceRegistry = read(path.join(root, 'src/data/dillon-rcp-vector-face-registry.json'));
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

const protectedRegion = slope.slopeRegions.find((region) => region.id === 'slope-region-east-covered');
const submittedToDwg = ([x, y]) => [round(x / 13.5 - 76.70833), round(17.14583 - y / 13.5)];
const protectedPolygonDwgFt = protectedRegion.polygonSubmittedPt.map(submittedToDwg);
function slopeHeightAtDwg([, y]) {
  const submittedY = (17.14583 - y) * 13.5;
  return round(9 - ((submittedY - protectedRegion.elevationDatum.datumPointSubmittedPt[1]) / 13.5) * 3 / 12);
}
const roomRegistries = new Map();
for (const sheet of bid.sheets) {
  const level = sourceGeometry.levels.find((entry) => entry.id === sheet.levelId);
  roomRegistries.set(sheet.id, await buildDillonSourceRoomRegistry(level, annotationsBySheet[sheet.id]));
}
function assignmentForPoint(sheetId, point) {
  if (sheetId === 'FP-1' && inside(point, protectedPolygonDwgFt)) return { method: 'sealed-3:12-source-plane', annotationId: protectedRegion.annotationId, surfaceKind: 'sloped-ceiling', heightAboveFloorFt: slopeHeightAtDwg(point), sourceDistanceFt: 0 };
  const face = locateDillonRcpVectorFace(rcpFaceRegistry, sheetId, point).face;
  if (face) return { method: 'sealed-source-rcp-vector-face', sourceFaceId: face.id, annotationId: face.annotationIds[0], surfaceKind: face.surfaceKind, heightAboveFloorFt: face.heightAboveFloorFt };
  const location = roomRegistries.get(sheetId)?.locate(point);
  if (!location?.room?.surfaceResolved) return null;
  const annotationId = location.room.annotationIds[0]; const annotation = annotationMap.get(annotationId);
  if (!annotation) return null;
  const sourceDistanceFt = Math.min(...location.room.annotationIds.map((id) => {
    const candidate = annotationMap.get(id);
    return candidate ? Math.hypot(point[0] - candidate.planPointDwgFt[0], point[1] - candidate.planPointDwgFt[1]) : Number.POSITIVE_INFINITY;
  }));
  return { method: 'sealed-source-room-cell', roomCellId: location.room.id, annotationId, surfaceKind: annotation.kind, heightAboveFloorFt: annotation.heightAboveFloorFt, sourceDistanceFt: round(sourceDistanceFt) };
}

const sheets = bid.sheets.map((sheet) => {
  const level = floorModel.levels.find((entry) => entry.id === sheet.levelId);
  const headAssignments = sheet.heads.map((head) => {
    const assignment = assignmentForPoint(sheet.id, head.planPointDwgFt);
    return assignment ? { headId: head.id, planPointDwgFt: head.planPointDwgFt, ...assignment, modelElevationFt: round(level.modelElevationFt + assignment.heightAboveFloorFt), siteProjectElevationFt: round(level.projectFloorElevationFt + assignment.heightAboveFloorFt), status: 'source-assigned' } : { headId: head.id, planPointDwgFt: head.planPointDwgFt, status: 'unresolved' };
  });
  const pipeAssignments = sheet.pipeSegments.map((pipe) => {
    const endpoints = pipe.planDwgFt.map((point) => assignmentForPoint(sheet.id, point));
    const face = endpoints[0]?.sourceFaceId ? rcpFaceRegistry.sheets.find((entry) => entry.sheetId === sheet.id)?.faces.find((entry) => entry.id === endpoints[0].sourceFaceId) : null;
    const sameFace = face && endpoints[0].sourceFaceId === endpoints[1]?.sourceFaceId && dillonRcpFaceContainsSegment(face, pipe.planDwgFt[0], pipe.planDwgFt[1]);
    if (endpoints.every(Boolean) && ((endpoints[0].roomCellId && endpoints[0].roomCellId === endpoints[1].roomCellId && endpoints[0].heightAboveFloorFt === endpoints[1].heightAboveFloorFt) || sameFace || endpoints.every((entry) => entry.method === 'sealed-3:12-source-plane'))) {
      return { pipeId: pipe.id, planDwgFt: pipe.planDwgFt, endpointMethods: endpoints.map((entry) => entry.method), endpointAnnotationIds: endpoints.map((entry) => entry.annotationId), ...(endpoints[0].roomCellId ? { endpointRoomCellIds: endpoints.map((entry) => entry.roomCellId) } : {}), ...(endpoints[0].sourceFaceId ? { endpointSourceFaceIds: endpoints.map((entry) => entry.sourceFaceId) } : {}), heightAboveFloorFt: endpoints.map((entry) => entry.heightAboveFloorFt), modelElevationsFt: endpoints.map((entry) => round(level.modelElevationFt + entry.heightAboveFloorFt)), siteProjectElevationsFt: endpoints.map((entry) => round(level.projectFloorElevationFt + entry.heightAboveFloorFt)), status: 'source-assigned' };
    }
    return { pipeId: pipe.id, planDwgFt: pipe.planDwgFt, status: 'unresolved' };
  });
  return { sheetId: sheet.id, levelId: sheet.levelId, source: sourceConfigs[sheet.id], roomRegistry: dillonSourceRoomRegistryPacket(roomRegistries.get(sheet.id)), annotations: annotationsBySheet[sheet.id], headAssignments, pipeAssignments };
});
const assignedHeads = sheets.reduce((n, sheet) => n + sheet.headAssignments.filter((entry) => entry.status === 'source-assigned').length, 0);
const assignedPipes = sheets.reduce((n, sheet) => n + sheet.pipeAssignments.filter((entry) => entry.status === 'source-assigned').length, 0);
const draft = {
  artifactType: 'halofire.dillon-vertical-registration.v3', projectName: 'Dillon Residence', sourceGeometrySha256: await sha256Hex(sourceGeometry), completedBidGeometryReceiptSha256: bid.receiptSha256, floorModelReceiptSha256: floorModel.receiptSha256, slopedCalibrationReceiptSha256: slope.evidenceReceiptSha256, rcpVectorFaceRegistryReceiptSha256: rcpFaceRegistry.receiptSha256,
  sheets, counts: { totalHeads: 76, sourceAssignedHeads: assignedHeads, unresolvedHeads: 76 - assignedHeads, totalPipeSegments: 67, sourceAssignedPipeSegments: assignedPipes, unresolvedPipeSegments: 67 - assignedPipes },
  complete: false, geometryGrounded: true, complianceReady: false, approvalReady: false,
  limitations: ['Only a sealed single-surface source-RCP vector face, sealed source-room cell, or the sealed 3:12 source plane assigns Z; annotation proximity alone is rejected.', 'Exterior-connected, mixed-surface, annotation-free, face-crossing, and every element outside the sealed zones remain unresolved.', 'Ceiling-surface elevation is not a manufacturer deflector-offset or fabrication elevation.', 'The missing FP-1 scheduled head remains unresolved.'],
  claimStatus: 'partial-source-bound-vertical-registration-not-code-compliance-or-fabrication',
};
const packet = { ...draft, receiptSha256: await sha256Hex(draft) };
fs.writeFileSync(path.join(root, 'src/data/dillon-vertical-registration.json'), `${JSON.stringify(packet)}\n`);
console.log(JSON.stringify({ receiptSha256: packet.receiptSha256, counts: packet.counts, sheets: packet.sheets.map((sheet) => ({ sheetId: sheet.sheetId, annotations: sheet.annotations.length, assignedHeads: sheet.headAssignments.filter((entry) => entry.status === 'source-assigned').length, assignedPipes: sheet.pipeAssignments.filter((entry) => entry.status === 'source-assigned').length })) }, null, 2));
