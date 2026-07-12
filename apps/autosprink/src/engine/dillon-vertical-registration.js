import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';

const SHA = z.string().regex(/^[0-9a-f]{64}$/); const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Annotation = z.object({ id: z.string(), kind: z.enum(['clg', 'soffit']), heightAboveFloorFt: z.number().positive(), sourceText: z.string(), sourceTopLeftPt: Point, planPointDwgFt: Point, sourceBlockIndex: z.number().int().nonnegative() }).strict();
const AssignedHead = z.object({ headId: z.string(), planPointDwgFt: Point, method: z.enum(['nearest-source-annotation-within-3ft', 'two-nearest-source-annotations-agree-within-6ft', 'sealed-3:12-source-plane']), annotationId: z.string(), surfaceKind: z.enum(['clg', 'soffit', 'sloped-ceiling']), heightAboveFloorFt: z.number().positive(), sourceDistanceFt: z.number().nonnegative(), modelElevationFt: z.number(), siteProjectElevationFt: z.number(), status: z.literal('source-assigned') }).strict();
const UnresolvedHead = z.object({ headId: z.string(), planPointDwgFt: Point, status: z.literal('unresolved') }).strict();
const AssignedPipe = z.object({ pipeId: z.string(), planDwgFt: z.tuple([Point, Point]), endpointMethods: z.tuple([z.string(), z.string()]), endpointAnnotationIds: z.tuple([z.string(), z.string()]), heightAboveFloorFt: z.tuple([z.number().positive(), z.number().positive()]), modelElevationsFt: z.tuple([z.number(), z.number()]), siteProjectElevationsFt: z.tuple([z.number(), z.number()]), status: z.literal('source-assigned') }).strict();
const UnresolvedPipe = z.object({ pipeId: z.string(), planDwgFt: z.tuple([Point, Point]), status: z.literal('unresolved') }).strict();
const Sheet = z.object({ sheetId: z.enum(['FP-1', 'FP-2']), levelId: z.enum(['main-house-main', 'main-house-upper']), source: z.object({ sourceId: z.string(), sourceSha256: SHA, transformMethod: z.string(), transformResidualFt: z.number().max(0.05) }).strict(), annotations: z.array(Annotation).min(1), headAssignments: z.array(z.union([AssignedHead, UnresolvedHead])).min(1), pipeAssignments: z.array(z.union([AssignedPipe, UnresolvedPipe])).min(1) }).strict();
const Draft = z.object({ artifactType: z.literal('halofire.dillon-vertical-registration.v1'), projectName: z.literal('Dillon Residence'), completedBidGeometryReceiptSha256: SHA, floorModelReceiptSha256: SHA, slopedCalibrationReceiptSha256: SHA, sheets: z.array(Sheet).length(2), counts: z.object({ totalHeads: z.literal(76), sourceAssignedHeads: z.number().int(), unresolvedHeads: z.number().int(), totalPipeSegments: z.literal(67), sourceAssignedPipeSegments: z.number().int(), unresolvedPipeSegments: z.number().int() }).strict(), complete: z.literal(false), geometryGrounded: z.literal(true), complianceReady: z.literal(false), approvalReady: z.literal(false), limitations: z.array(z.string()).min(4), claimStatus: z.literal('partial-source-bound-vertical-registration-not-code-compliance-or-fabrication') }).strict();
const Packet = Draft.extend({ receiptSha256: SHA }).strict();
const issue = (code, message) => ({ severity: 'blocking', code, message }); const near = (a, b, tolerance = 0.00002) => Math.abs(a - b) <= tolerance;

export async function validateDillonVerticalRegistration(input, { bidGeometry, floorModel, slopedCalibration } = {}) {
  const parsed = Packet.safeParse(input); if (!parsed.success) return { status: 'blocked', issues: [issue('DILLON_VERTICAL_SCHEMA_INVALID', parsed.error.issues.map((x) => x.message).join('; '))], complianceReady: false };
  const packet = parsed.data; const { receiptSha256, ...draft } = packet; const issues = [];
  if (await sha256Hex(draft) !== receiptSha256) issues.push(issue('DILLON_VERTICAL_RECEIPT_MISMATCH', 'Vertical packet does not match its receipt.'));
  if (bidGeometry?.receiptSha256 !== packet.completedBidGeometryReceiptSha256) issues.push(issue('DILLON_VERTICAL_BID_SOURCE_MISMATCH', 'Completed-bid geometry receipt mismatch.'));
  if (floorModel?.receiptSha256 !== packet.floorModelReceiptSha256) issues.push(issue('DILLON_VERTICAL_FLOOR_SOURCE_MISMATCH', 'Floor model receipt mismatch.'));
  if (slopedCalibration?.evidenceReceiptSha256 !== packet.slopedCalibrationReceiptSha256) issues.push(issue('DILLON_VERTICAL_SLOPE_SOURCE_MISMATCH', 'Sloped calibration receipt mismatch.'));
  let assignedHeads = 0; let assignedPipes = 0; let totalHeads = 0; let totalPipes = 0;
  for (const sheet of packet.sheets) {
    const level = floorModel?.levels?.find((entry) => entry.id === sheet.levelId); const annotations = new Map(sheet.annotations.map((entry) => [entry.id, entry]));
    totalHeads += sheet.headAssignments.length; totalPipes += sheet.pipeAssignments.length;
    for (const assignment of sheet.headAssignments) if (assignment.status === 'source-assigned') {
      assignedHeads += 1;
      if (!level || !near(assignment.modelElevationFt, level.modelElevationFt + assignment.heightAboveFloorFt) || !near(assignment.siteProjectElevationFt, level.projectFloorElevationFt + assignment.heightAboveFloorFt)) issues.push(issue('DILLON_VERTICAL_HEAD_DATUM_DRIFT', `${assignment.headId} does not follow its floor datum.`));
      if (assignment.method !== 'sealed-3:12-source-plane') { const annotation = annotations.get(assignment.annotationId); if (!annotation || annotation.kind !== assignment.surfaceKind || !near(annotation.heightAboveFloorFt, assignment.heightAboveFloorFt) || assignment.sourceDistanceFt > 6) issues.push(issue('DILLON_VERTICAL_HEAD_ANNOTATION_INVALID', `${assignment.headId} is not bound to a compatible source annotation.`)); }
    }
    for (const assignment of sheet.pipeAssignments) if (assignment.status === 'source-assigned') {
      assignedPipes += 1;
      for (let i = 0; i < 2; i += 1) if (!level || !near(assignment.modelElevationsFt[i], level.modelElevationFt + assignment.heightAboveFloorFt[i]) || !near(assignment.siteProjectElevationsFt[i], level.projectFloorElevationFt + assignment.heightAboveFloorFt[i])) issues.push(issue('DILLON_VERTICAL_PIPE_DATUM_DRIFT', `${assignment.pipeId} endpoint ${i} does not follow its floor datum.`));
      if (!assignment.endpointMethods.every((method) => method === 'sealed-3:12-source-plane') && (assignment.endpointAnnotationIds[0] !== assignment.endpointAnnotationIds[1] || !near(assignment.heightAboveFloorFt[0], assignment.heightAboveFloorFt[1]))) issues.push(issue('DILLON_VERTICAL_PIPE_ZONE_CROSSING', `${assignment.pipeId} was assigned across incompatible source zones.`));
    }
  }
  if (totalHeads !== packet.counts.totalHeads || assignedHeads !== packet.counts.sourceAssignedHeads || totalHeads - assignedHeads !== packet.counts.unresolvedHeads || totalPipes !== packet.counts.totalPipeSegments || assignedPipes !== packet.counts.sourceAssignedPipeSegments || totalPipes - assignedPipes !== packet.counts.unresolvedPipeSegments) issues.push(issue('DILLON_VERTICAL_COUNT_DRIFT', 'Assignment counts do not match packet totals.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : packet, counts: packet.counts, complete: false, geometryGrounded: !issues.length, complianceReady: false, claimStatus: packet.claimStatus };
}

export function buildDillonVerticalModel(validation) {
  if (validation?.status !== 'passed' || !validation.packet) return { status: 'blocked', issues: [issue('DILLON_VERTICAL_NOT_VALIDATED', 'Passed vertical registration is required.')] };
  const heads = []; const pipes = [];
  for (const sheet of validation.packet.sheets) {
    for (const entry of sheet.headAssignments) if (entry.status === 'source-assigned') heads.push({ id: entry.headId, sheetId: sheet.sheetId, pointFt: [entry.planPointDwgFt[0], entry.modelElevationFt, entry.planPointDwgFt[1]], siteProjectElevationFt: entry.siteProjectElevationFt, surfaceKind: entry.surfaceKind, method: entry.method });
    for (const entry of sheet.pipeAssignments) if (entry.status === 'source-assigned') pipes.push({ id: entry.pipeId, sheetId: sheet.sheetId, fromFt: [entry.planDwgFt[0][0], entry.modelElevationsFt[0], entry.planDwgFt[0][1]], toFt: [entry.planDwgFt[1][0], entry.modelElevationsFt[1], entry.planDwgFt[1][1]], method: entry.endpointMethods[0] });
  }
  return { status: 'passed', artifactType: 'halofire.dillon-partial-vertical-model.v1', heads, pipes, counts: validation.counts, complete: false, geometryGrounded: true, complianceReady: false, claimStatus: validation.packet.claimStatus };
}

export function renderDillonVerticalElevationView(model) {
  if (model?.status !== 'passed') return { status: 'blocked' }; const w = 900, h = 420; const allX = model.heads.map((head) => head.pointFt[0]); const minX = Math.min(...allX), maxX = Math.max(...allX); const minY = -1, maxY = 24; const mx = (x) => 40 + ((x - minX) / Math.max(1, maxX - minX)) * (w - 80); const my = (y) => h - 40 - ((y - minY) / (maxY - minY)) * (h - 80);
  const pipes = model.pipes.map((pipe) => `<line x1="${mx(pipe.fromFt[0])}" y1="${my(pipe.fromFt[1])}" x2="${mx(pipe.toFt[0])}" y2="${my(pipe.toFt[1])}" stroke="#d946ef" stroke-width="2"/>`).join(''); const heads = model.heads.map((head) => `<circle cx="${mx(head.pointFt[0])}" cy="${my(head.pointFt[1])}" r="3.5" fill="${head.surfaceKind === 'sloped-ceiling' ? '#f59e0b' : '#16a34a'}"/>`).join('');
  return { status: 'passed', svg: `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Dillon partial source-bound sprinkler elevation" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#07111f"/>${pipes}${heads}<text x="18" y="24" fill="#e0f2fe" font-family="monospace" font-size="13">${model.heads.length}/${model.counts.totalHeads} heads + ${model.pipes.length}/${model.counts.totalPipeSegments} pipes have source-bound Z; unresolved elements are omitted</text></svg>` };
}
