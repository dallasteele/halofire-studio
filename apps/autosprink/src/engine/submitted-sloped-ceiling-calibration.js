import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';

const SHA256_RE = /^[0-9a-f]{64}$/;
const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Polygon = z.array(Point).min(4);
const Source = z.object({ id: z.string().min(1), sha256: z.string().regex(SHA256_RE) }).strict();
const Draft = z.object({
  artifactType: z.literal('halofire.submitted-sloped-ceiling-calibration.v1'),
  projectName: z.literal('Dillon Residence'),
  units: z.literal('pdf-pt'),
  printedScalePtPerFt: z.literal(13.5),
  sources: z.array(Source).length(6),
  registration: z.object({
    method: z.literal('three-independent-raster-control-crops'),
    architectureFromSubmitted: z.object({ xOffsetPt: z.number(), yOffsetPt: z.number(), scale: z.number(), rotationDeg: z.number() }).strict(),
    controls: z.array(z.object({ id: z.string(), xOffsetPt: z.number(), yOffsetPt: z.number(), score: z.number().min(0).max(1) }).strict()).length(3),
    xRmsResidualPt: z.number().nonnegative(), yRmsResidualPt: z.number().nonnegative(), scaleErrorPct: z.number().nonnegative(),
  }).strict(),
  ceilingSlopeAnnotations: z.array(z.object({
    id: z.string(), sourcePointUnrotatedPt: Point, registeredSubmittedPointPt: Point,
    riseIn: z.literal(3), runIn: z.literal(12), text: z.literal('3"/12"'),
  }).strict()).min(3),
  slopeRegions: z.array(z.object({
    id: z.string(), annotationId: z.string(), polygonRcpPt: Polygon,
    polygonSubmittedPt: Polygon, slopeAxis: z.enum(['x', 'y']), downhillDirection: z.enum(['positive-x', 'negative-x', 'positive-y', 'negative-y']),
    protectionBasis: z.enum(['completed-bid-protected', 'completed-bid-no-submitted-heads']),
    submittedHeadIds: z.array(z.string()),
    obstructions: z.array(z.object({ id: z.string(), kind: z.literal('ceiling-fan'), centerRcpPt: Point, centerSubmittedPt: Point, clearanceFt: z.number().positive(), preferredSide: z.enum(['negative-x', 'positive-x', 'negative-y', 'positive-y']), sourceGeometry: z.literal('four-blade-ceiling-fan-vector') }).strict()),
    elevationDatum: z.object({ sourceText: z.string().min(1), datumPointRcpPt: Point, datumPointSubmittedPt: Point, projectElevationFt: z.number().finite(), slopeDirection: z.literal('positive-y-down') }).strict().nullable(),
  }).strict()).length(4),
  submittedHeads: z.array(z.object({ id: z.string(), pointPt: Point, symbolClass: z.enum(['round-pendent-vector-candidate', 'cross-pendent-vector-candidate']) }).strict()).min(1),
  continuationHeads: z.array(z.object({
    id: z.string(), sourceId: z.literal('submitted-FP2'), sourcePageIndex: z.literal(0), pointPortraitTopLeftPt: Point,
    symbolClass: z.literal('cross-pendent-vector-candidate'), vectorSignature: z.literal('paired-8.7pt-diagonals-over-filled-pendent-center'),
    sourceDrawingIndices: z.tuple([z.literal(2408), z.literal(2434)]),
  }).strict()).length(0),
  schedule: z.object({ totalHeads: z.literal(52), roundPendent: z.literal(40), alternatePendent: z.literal(12) }).strict(),
  hydraulicEvidence: z.array(z.object({ report: z.enum(['RA-1', 'RA-2', 'RA-3']), nodeId: z.string(), elevationFt: z.number(), nodeKind: z.literal('active-sprinkler') }).strict()).min(3),
  hydraulicDatumJoin: z.object({
    method: z.literal('architectural-project-elevation-minus-100ft-to-hydraulic-local-elevation'), projectDatumOffsetFt: z.literal(100),
    architecturalDatumProjectElevationFt: z.literal(109), architecturalDatumLocalElevationFt: z.literal(9),
    activeNodes: z.array(z.object({ report: z.enum(['RA-1', 'RA-2', 'RA-3']), nodeId: z.string(), hydraulicLocalElevationFt: z.number(), projectElevationFt: z.number() }).strict()).length(5),
    protectedRegionHeadNodeMappingReady: z.literal(false), reason: z.string().min(1),
  }).strict(),
  coverage: z.object({ complete: z.literal(false), detectedVectorCandidates: z.literal(51), unresolved: z.tuple([z.literal('FP-1 schedule declares 52 heads but the FP-1 vector sheet contains 51 symbols (40 round + 11 alternate); FP-2 is a separate 25-head upper-level schedule and cannot close this mismatch.')]) }).strict(),
  limitations: z.tuple([
    z.literal('protected-sloped-heads-not-mapped-to-hydraulic-remote-area-nodes'),
    z.literal('code-compliance-and-approval-not-inferred-from-completed-bid'),
    z.literal('fp1-schedule-to-vector-count-mismatch-one-head-unresolved'),
  ]),
  claimStatus: z.literal('completed-bid-sloped-ceiling-calibration-not-code-compliance-or-approval'),
}).strict();
const Packet = Draft.extend({ evidenceReceiptSha256: z.string().regex(SHA256_RE) }).strict();

const blocking = (code, message, refs = []) => ({ severity: 'blocking', code, message, refs });
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export async function sealSubmittedSlopedCeilingCalibration(draft) {
  const parsed = Draft.parse(draft);
  return { ...parsed, evidenceReceiptSha256: await sha256Hex(parsed) };
}

export async function validateSubmittedSlopedCeilingCalibration(input) {
  const parsed = Packet.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [blocking('SLOPED_CALIBRATION_SCHEMA_INVALID', parsed.error.message)], complianceReady: false };
  const packet = parsed.data;
  const { evidenceReceiptSha256, ...draft } = packet;
  const issues = [];
  if (await sha256Hex(draft) !== evidenceReceiptSha256) issues.push(blocking('SLOPED_CALIBRATION_RECEIPT_MISMATCH', 'Calibration evidence does not match its immutable receipt.'));
  const ids = new Set(packet.sources.map((source) => source.id));
  for (const required of ['submitted-FP1', 'submitted-FP2', 'architectural-RCP', 'hydraulic-RA1', 'hydraulic-RA2', 'hydraulic-RA3']) {
    if (!ids.has(required)) issues.push(blocking('SLOPED_CALIBRATION_SOURCE_MISSING', `Missing ${required}.`, [required]));
  }
  const registration = packet.registration;
  if (registration.architectureFromSubmitted.scale !== 1 || registration.architectureFromSubmitted.rotationDeg !== 0 || registration.scaleErrorPct !== 0) {
    issues.push(blocking('SLOPED_CALIBRATION_SCALE_DRIFT', 'FP-1 and RCP must retain their common printed 3/16 inch scale.'));
  }
  if (registration.xRmsResidualPt > 1 || registration.yRmsResidualPt > 1) issues.push(blocking('SLOPED_CALIBRATION_REGISTRATION_RESIDUAL', 'Registration exceeds one PDF point RMS.'));
  for (const control of registration.controls) {
    if (Math.abs(control.xOffsetPt - registration.architectureFromSubmitted.xOffsetPt) > 1 || Math.abs(control.yOffsetPt - registration.architectureFromSubmitted.yOffsetPt) > 1) {
      issues.push(blocking('SLOPED_CALIBRATION_CONTROL_DISAGREEMENT', `Control ${control.id} disagrees with the sealed transform.`, [control.id]));
    }
  }
  const transformSlopePoint = ([x, y]) => [3024 - y - registration.architectureFromSubmitted.xOffsetPt, x - registration.architectureFromSubmitted.yOffsetPt];
  for (const annotation of packet.ceilingSlopeAnnotations) {
    const expected = transformSlopePoint(annotation.sourcePointUnrotatedPt);
    if (distance(expected, annotation.registeredSubmittedPointPt) > 0.1) issues.push(blocking('SLOPED_CALIBRATION_SLOPE_POINT_DRIFT', `Slope annotation ${annotation.id} is not registered by the sealed transform.`, [annotation.id]));
  }
  const annotationById = new Map(packet.ceilingSlopeAnnotations.map((annotation) => [annotation.id, annotation]));
  const headById = new Map(packet.submittedHeads.map((head) => [head.id, head]));
  for (const region of packet.slopeRegions) {
    const annotation = annotationById.get(region.annotationId);
    if (!annotation) {
      issues.push(blocking('SLOPED_CALIBRATION_REGION_ANNOTATION_MISSING', `Region ${region.id} has no source annotation.`, [region.id]));
      continue;
    }
    const displayPoint = [3024 - annotation.sourcePointUnrotatedPt[1], annotation.sourcePointUnrotatedPt[0]];
    if (!pointInPolygon(displayPoint, region.polygonRcpPt)) issues.push(blocking('SLOPED_CALIBRATION_ANNOTATION_OUTSIDE_REGION', `Annotation ${annotation.id} is outside ${region.id}.`, [region.id, annotation.id]));
    for (let index = 0; index < region.polygonRcpPt.length; index += 1) {
      const expected = [region.polygonRcpPt[index][0] - registration.architectureFromSubmitted.xOffsetPt, region.polygonRcpPt[index][1] - registration.architectureFromSubmitted.yOffsetPt];
      if (distance(expected, region.polygonSubmittedPt[index]) > 0.1) issues.push(blocking('SLOPED_CALIBRATION_REGION_TRANSFORM_DRIFT', `Region ${region.id} does not follow the sealed RCP-to-FP transform.`, [region.id]));
    }
    const actualHeadIds = packet.submittedHeads.filter((head) => pointInPolygon(head.pointPt, region.polygonSubmittedPt)).map((head) => head.id).sort();
    const declaredHeadIds = [...region.submittedHeadIds].sort();
    if (actualHeadIds.join(',') !== declaredHeadIds.join(',')) issues.push(blocking('SLOPED_CALIBRATION_REGION_HEAD_MEMBERSHIP_DRIFT', `Region ${region.id} submitted-head membership is not source-derived.`, [region.id]));
    if (region.protectionBasis === 'completed-bid-protected' && declaredHeadIds.length === 0) issues.push(blocking('SLOPED_CALIBRATION_PROTECTED_REGION_EMPTY', `Protected region ${region.id} has no submitted heads.`, [region.id]));
    if (region.protectionBasis === 'completed-bid-no-submitted-heads' && declaredHeadIds.length !== 0) issues.push(blocking('SLOPED_CALIBRATION_EMPTY_REGION_FALSE', `Reference-empty region ${region.id} contains submitted heads.`, [region.id]));
    for (const headId of declaredHeadIds) if (!headById.has(headId)) issues.push(blocking('SLOPED_CALIBRATION_REGION_HEAD_MISSING', `Region ${region.id} references missing head ${headId}.`, [region.id, headId]));
    for (const obstruction of region.obstructions) {
      const expected = [obstruction.centerRcpPt[0] - registration.architectureFromSubmitted.xOffsetPt, obstruction.centerRcpPt[1] - registration.architectureFromSubmitted.yOffsetPt];
      if (distance(expected, obstruction.centerSubmittedPt) > 0.1) issues.push(blocking('SLOPED_CALIBRATION_OBSTRUCTION_TRANSFORM_DRIFT', `Obstruction ${obstruction.id} does not follow the sealed transform.`, [region.id, obstruction.id]));
      if (!pointInPolygon(obstruction.centerRcpPt, region.polygonRcpPt)) issues.push(blocking('SLOPED_CALIBRATION_OBSTRUCTION_OUTSIDE_REGION', `Obstruction ${obstruction.id} is outside ${region.id}.`, [region.id, obstruction.id]));
    }
    if (region.protectionBasis === 'completed-bid-protected' && !region.elevationDatum) issues.push(blocking('SLOPED_CALIBRATION_ABSOLUTE_DATUM_MISSING', `Protected region ${region.id} has no absolute elevation datum.`, [region.id]));
    if (region.elevationDatum) {
      const expected = [region.elevationDatum.datumPointRcpPt[0] - registration.architectureFromSubmitted.xOffsetPt, region.elevationDatum.datumPointRcpPt[1] - registration.architectureFromSubmitted.yOffsetPt];
      if (distance(expected, region.elevationDatum.datumPointSubmittedPt) > 0.1) issues.push(blocking('SLOPED_CALIBRATION_DATUM_TRANSFORM_DRIFT', `Elevation datum for ${region.id} does not follow the sealed transform.`, [region.id]));
    }
  }
  const allScheduleHeads = [...packet.submittedHeads, ...packet.continuationHeads];
  if (packet.coverage.detectedVectorCandidates !== allScheduleHeads.length) issues.push(blocking('SLOPED_CALIBRATION_HEAD_COUNT_DRIFT', 'Detected vector count does not match the sealed FP-1 candidate list.'));
  if (allScheduleHeads.filter((head) => head.symbolClass === 'round-pendent-vector-candidate').length !== 40) issues.push(blocking('SLOPED_CALIBRATION_ROUND_SYMBOL_COUNT', 'The sealed round-pendent vector class must reproduce the submitted schedule count of 40.'));
  if (packet.submittedHeads.filter((head) => head.symbolClass === 'cross-pendent-vector-candidate').length !== 11) issues.push(blocking('SLOPED_CALIBRATION_FP1_ALTERNATE_VECTOR_COUNT', 'FP-1 must retain its 11 detected alternate-pendent vectors; the declared twelfth is unresolved.'));

  const radiusPt = 9 * packet.printedScalePtPerFt;
  const proximityMatches = packet.submittedHeads.flatMap((head) => packet.ceilingSlopeAnnotations
    .filter((annotation) => distance(head.pointPt, annotation.registeredSubmittedPointPt) <= radiusPt)
    .map((annotation) => ({ headId: head.id, slopeAnnotationId: annotation.id, distanceFt: Number((distance(head.pointPt, annotation.registeredSubmittedPointPt) / packet.printedScalePtPerFt).toFixed(3)) })));
  if (proximityMatches.length < 3) issues.push(blocking('SLOPED_CALIBRATION_POSITIVE_MATCH_MISSING', 'At least three submitted heads must fall within a nine-foot source-registered 3:12 annotation screen.'));
  const elevations = new Set(packet.hydraulicEvidence.map((entry) => entry.elevationFt));
  if (!elevations.has(10) || !elevations.has(22)) issues.push(blocking('SLOPED_CALIBRATION_ELEVATION_COVERAGE', 'Submitted active-sprinkler elevations must cover both 10 ft and 22 ft levels.'));
  if (packet.hydraulicDatumJoin.architecturalDatumLocalElevationFt + packet.hydraulicDatumJoin.projectDatumOffsetFt !== packet.hydraulicDatumJoin.architecturalDatumProjectElevationFt) issues.push(blocking('SLOPED_CALIBRATION_ARCHITECTURAL_DATUM_JOIN_INVALID', 'Architectural local and project elevations do not share the sealed 100 ft datum offset.'));
  const hydraulicEvidenceKeys = new Set(packet.hydraulicEvidence.map((entry) => `${entry.report}:${entry.nodeId}:${entry.elevationFt}`));
  for (const node of packet.hydraulicDatumJoin.activeNodes) {
    if (node.hydraulicLocalElevationFt + packet.hydraulicDatumJoin.projectDatumOffsetFt !== node.projectElevationFt) issues.push(blocking('SLOPED_CALIBRATION_HYDRAULIC_DATUM_JOIN_INVALID', `Hydraulic node ${node.report}:${node.nodeId} does not follow the sealed project datum offset.`, [node.report, node.nodeId]));
    if (!hydraulicEvidenceKeys.has(`${node.report}:${node.nodeId}:${node.hydraulicLocalElevationFt}`)) issues.push(blocking('SLOPED_CALIBRATION_HYDRAULIC_NODE_SUBSTITUTION', `Hydraulic datum node ${node.report}:${node.nodeId} is not in the sealed RA evidence.`, [node.report, node.nodeId]));
  }

  return {
    status: issues.length ? 'blocked' : 'passed', issues,
    artifactType: 'halofire.submitted-sloped-ceiling-calibration-validation.v1',
    packet: issues.length ? null : packet,
    counts: { submittedScheduleHeads: 52, vectorCandidates: allScheduleHeads.length, fp1VectorCandidates: packet.submittedHeads.length, fp2ContinuationCandidates: 0, unresolvedHeadSymbols: 52 - allScheduleHeads.length, positiveAnnotationProximityMatches: proximityMatches.length },
    proximityMatches,
    slopeEvidenceReady: issues.length === 0,
    fullSlopeSurfaceRegistrationReady: issues.length === 0,
    generatedLayoutParityReady: false,
    hydraulicDatumJoined: issues.length === 0,
    protectedRegionHeadNodeMappingReady: false,
    complianceReady: false,
    claimStatus: 'completed-bid-sloped-ceiling-calibration-validated-not-code-compliance-or-approval',
  };
}

export function renderSubmittedSlopedCeilingCalibration(validation) {
  if (!validation || validation.status !== 'passed' || !validation.packet) return { status: 'blocked', issues: [blocking('SLOPED_CALIBRATION_NOT_VALIDATED', 'A passed calibration is required.')] };
  const { submittedHeads, ceilingSlopeAnnotations } = validation.packet;
  const heads = submittedHeads.map((head) => `<circle cx="${head.pointPt[0]}" cy="${head.pointPt[1]}" r="5" fill="#111" data-head-id="${head.id}"/>`).join('');
  const slopes = ceilingSlopeAnnotations.map((slope) => `<g data-slope-id="${slope.id}"><circle cx="${slope.registeredSubmittedPointPt[0]}" cy="${slope.registeredSubmittedPointPt[1]}" r="121.5" fill="#ff9f0a18" stroke="#ff9f0a" stroke-width="3"/><text x="${slope.registeredSubmittedPointPt[0] + 8}" y="${slope.registeredSubmittedPointPt[1] - 8}" font-size="18">3:12 ${slope.id}</text></g>`).join('');
  return { status: 'passed', topSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3024 2160" role="img" aria-label="Dillon submitted FP-1 heads registered to RCP 3:12 annotation screens"><rect width="3024" height="2160" fill="#fff"/>${slopes}${heads}</svg>`, complianceReady: false };
}
