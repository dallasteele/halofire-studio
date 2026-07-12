import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';

const SHA256_RE = /^[0-9a-f]{64}$/;
const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Source = z.object({ id: z.string().min(1), sha256: z.string().regex(SHA256_RE) }).strict();
const Draft = z.object({
  artifactType: z.literal('halofire.submitted-sloped-ceiling-calibration.v1'),
  projectName: z.literal('Dillon Residence'),
  units: z.literal('pdf-pt'),
  printedScalePtPerFt: z.literal(13.5),
  sources: z.array(Source).length(5),
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
  submittedHeads: z.array(z.object({ id: z.string(), pointPt: Point, symbolClass: z.enum(['round-pendent-vector-candidate', 'cross-pendent-vector-candidate']) }).strict()).min(1),
  schedule: z.object({ totalHeads: z.literal(52), roundPendent: z.literal(40), alternatePendent: z.literal(12) }).strict(),
  hydraulicEvidence: z.array(z.object({ report: z.enum(['RA-1', 'RA-2', 'RA-3']), nodeId: z.string(), elevationFt: z.number(), nodeKind: z.literal('active-sprinkler') }).strict()).min(3),
  coverage: z.object({ complete: z.literal(false), detectedVectorCandidates: z.number().int(), unresolved: z.array(z.string().min(1)).min(1) }).strict(),
  claimStatus: z.literal('completed-bid-sloped-ceiling-calibration-not-code-compliance-or-approval'),
}).strict();
const Packet = Draft.extend({ evidenceReceiptSha256: z.string().regex(SHA256_RE) }).strict();

const blocking = (code, message, refs = []) => ({ severity: 'blocking', code, message, refs });
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

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
  for (const required of ['submitted-FP1', 'architectural-RCP', 'hydraulic-RA1', 'hydraulic-RA2', 'hydraulic-RA3']) {
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
  if (packet.coverage.detectedVectorCandidates !== packet.submittedHeads.length) issues.push(blocking('SLOPED_CALIBRATION_HEAD_COUNT_DRIFT', 'Detected vector count does not match the sealed candidate list.'));
  if (packet.submittedHeads.filter((head) => head.symbolClass === 'round-pendent-vector-candidate').length !== 40) issues.push(blocking('SLOPED_CALIBRATION_ROUND_SYMBOL_COUNT', 'The sealed round-pendent vector class must reproduce the submitted schedule count of 40.'));

  const radiusPt = 9 * packet.printedScalePtPerFt;
  const proximityMatches = packet.submittedHeads.flatMap((head) => packet.ceilingSlopeAnnotations
    .filter((annotation) => distance(head.pointPt, annotation.registeredSubmittedPointPt) <= radiusPt)
    .map((annotation) => ({ headId: head.id, slopeAnnotationId: annotation.id, distanceFt: Number((distance(head.pointPt, annotation.registeredSubmittedPointPt) / packet.printedScalePtPerFt).toFixed(3)) })));
  if (proximityMatches.length < 3) issues.push(blocking('SLOPED_CALIBRATION_POSITIVE_MATCH_MISSING', 'At least three submitted heads must fall within a nine-foot source-registered 3:12 annotation screen.'));
  const elevations = new Set(packet.hydraulicEvidence.map((entry) => entry.elevationFt));
  if (!elevations.has(10) || !elevations.has(22)) issues.push(blocking('SLOPED_CALIBRATION_ELEVATION_COVERAGE', 'Submitted active-sprinkler elevations must cover both 10 ft and 22 ft levels.'));

  return {
    status: issues.length ? 'blocked' : 'passed', issues,
    artifactType: 'halofire.submitted-sloped-ceiling-calibration-validation.v1',
    packet: issues.length ? null : packet,
    counts: { submittedScheduleHeads: 52, vectorCandidates: packet.submittedHeads.length, positiveAnnotationProximityMatches: proximityMatches.length },
    proximityMatches,
    slopeEvidenceReady: issues.length === 0,
    fullSlopeSurfaceRegistrationReady: false,
    generatedLayoutParityReady: false,
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
