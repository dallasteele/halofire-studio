import { z } from 'zod';
import { SourceBindingSchema, sha256Hex } from './elevation-datums.js';
import { pointInPolygon } from './roof-geometry.js';

const SHA256_RE = /^[0-9a-f]{64}$/;
const PointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const SourceSchema = z.object({ id: z.string().min(1), binding: SourceBindingSchema }).strict();
const ControlSchema = z.object({
  id: z.string().min(1), sourcePdfPoint: PointSchema, targetA121PdfPoint: PointSchema,
  derivedPlanPointFt: PointSchema, expectedPlanPointFt: PointSchema, residualFt: z.number().nonnegative(),
}).strict();
const TransformSchema = z.object({
  id: z.string().min(1), sourceSheetId: z.enum(['M109', 'P109']), area: z.enum(['B', 'C']),
  sourceScaleFtPerPoint: z.number().positive(), targetScaleFtPerPoint: z.number().positive(),
  sourceAnchorPdf: PointSchema, targetAnchorA121Pdf: PointSchema, targetAnchorPlanFt: PointSchema,
  controls: z.array(ControlSchema).min(2), maxResidualFt: z.number().nonnegative(),
}).strict();
const EquipmentSchema = z.object({
  id: z.string().min(1), kind: z.enum(['heat-pump', 'outdoor-unit']), modelTag: z.string().min(1), area: z.enum(['B', 'C']),
  sourceBindingRefs: z.array(z.string().min(1)).min(1), sourceRectPdf: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  boundaryPlanFt: z.array(PointSchema).length(4), heightFt: z.number().positive().nullable(),
  heightStatus: z.enum(['resolved-model-specific-source', 'unresolved-model-specific-dimension']),
  clearanceStatus: z.enum(['resolved', 'unresolved']),
}).strict();
const VentSchema = z.object({
  id: z.string().min(1), kind: z.literal('vent-penetration'), diameterIn: z.union([z.literal(2), z.literal(3), z.literal(4)]), area: z.enum(['B', 'C']),
  sourceBindingRefs: z.array(z.string().min(1)).min(1), sourceLabelPdf: PointSchema, sourcePointPdf: PointSchema,
  planPointFt: PointSchema, clearanceStatus: z.enum(['resolved', 'unresolved']),
}).strict();
const CountsSchema = z.object({
  acceptedHeatPumpFootprints: z.number().int().nonnegative(), acceptedOutdoorUnitFootprints: z.number().int().nonnegative(),
  acceptedVentPoints: z.number().int().nonnegative(), unmatchedMechanicalLabels: z.number().int().nonnegative(),
  unmatchedVentLabels: z.number().int().nonnegative(),
  scheduleCounts: z.record(z.string(), z.number().int().nonnegative()),
}).strict();
const DraftSchema = z.object({
  artifactType: z.literal('halofire.roof-coordination-input.v1'), projectName: z.string().min(1),
  sourceBindings: z.array(SourceSchema).min(3), transforms: z.array(TransformSchema).min(4),
  equipment: z.array(EquipmentSchema), vents: z.array(VentSchema), counts: CountsSchema,
  coverage: z.object({ complete: z.literal(false), resolvedScope: z.string().min(1), unresolved: z.array(z.string().min(1)).min(1) }).strict(),
  derivation: z.object({ method: z.string().min(1), oneToOneMatching: z.literal(true), syntheticFeaturesAdded: z.literal(false) }).strict(),
}).strict();
const InputSchema = DraftSchema.extend({ evidenceReceiptSha256: z.string().regex(SHA256_RE) }).strict();

function issue(code, message, refs = []) { return { severity: 'blocking', code, message, refs }; }
function polygonArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}
function orientation(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(a, b, p, tolerance = 1e-8) {
  return Math.abs(orientation(a, b, p)) <= tolerance
    && p[0] >= Math.min(a[0], b[0]) - tolerance && p[0] <= Math.max(a[0], b[0]) + tolerance
    && p[1] >= Math.min(a[1], b[1]) - tolerance && p[1] <= Math.max(a[1], b[1]) + tolerance;
}
function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c); const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a); const o4 = orientation(c, d, b);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function pointSegmentDistance(point, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  if (!length2) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

export async function sealRoofCoordinationInput(draft) {
  const parsed = DraftSchema.parse(draft);
  return { ...parsed, evidenceReceiptSha256: await sha256Hex(parsed) };
}

export async function validateRoofCoordination(input, options = {}) {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [issue('ROOF_COORDINATION_SCHEMA_INVALID', parsed.error.issues.map((entry) => entry.message).join('; '))], complianceReady: false };
  const data = parsed.data; const { evidenceReceiptSha256, ...draft } = data;
  if (await sha256Hex(draft) !== evidenceReceiptSha256) {
    return { status: 'blocked', issues: [issue('ROOF_COORDINATION_RECEIPT_MISMATCH', 'Coordination content does not match its immutable SHA-256 receipt.')], complianceReady: false };
  }
  const toleranceFt = Number.isFinite(Number(options.registrationToleranceFt)) ? Math.abs(Number(options.registrationToleranceFt)) : 1 / 6;
  const issues = []; const sourceIds = new Set(data.sourceBindings.map((source) => source.id)); const ids = new Set();
  for (const transform of data.transforms) {
    const actualMax = Math.max(...transform.controls.map((control) => control.residualFt));
    if (Math.abs(actualMax - transform.maxResidualFt) > 1e-6 || actualMax > toleranceFt) {
      issues.push(issue('ROOF_COORDINATION_REGISTRATION_RESIDUAL_EXCEEDED', `Transform ${transform.id} exceeds or misstates its grid-control residual.`, [transform.id]));
    }
  }
  for (const item of [...data.equipment, ...data.vents]) {
    if (ids.has(item.id)) issues.push(issue('ROOF_COORDINATION_ID_DUPLICATE', `Duplicate coordination id: ${item.id}`, [item.id]));
    ids.add(item.id);
    const missing = item.sourceBindingRefs.filter((ref) => !sourceIds.has(ref));
    if (missing.length) issues.push(issue('ROOF_COORDINATION_SOURCE_MISMATCH', `${item.id} references evidence outside the sealed source bundle.`, [item.id, ...missing]));
    if (item.boundaryPlanFt && Math.abs(polygonArea(item.boundaryPlanFt)) < 1e-8) issues.push(issue('ROOF_COORDINATION_FOOTPRINT_DEGENERATE', `${item.id} has a zero-area footprint.`, [item.id]));
  }
  const actual = {
    acceptedHeatPumpFootprints: data.equipment.filter((item) => item.kind === 'heat-pump').length,
    acceptedOutdoorUnitFootprints: data.equipment.filter((item) => item.kind === 'outdoor-unit').length,
    acceptedVentPoints: data.vents.length,
  };
  for (const [key, value] of Object.entries(actual)) if (data.counts[key] !== value) issues.push(issue('ROOF_COORDINATION_COUNT_MISMATCH', `${key} does not match the sealed feature inventory.`));
  return {
    ...data, status: issues.length ? 'blocked' : 'passed', issues,
    verification: { sourceBound: !issues.some((entry) => entry.code === 'ROOF_COORDINATION_SOURCE_MISMATCH'), registrationToleranceFt: toleranceFt, oneToOneMatching: true },
    complianceReady: false, approvalReady: false, claimStatus: 'registered-visible-features-only-not-code-compliant',
  };
}

export function mergeRoofCoordination(roofModel, coordinationModel) {
  if (!roofModel || roofModel.status !== 'passed' || !coordinationModel || coordinationModel.status !== 'passed') {
    return { status: 'blocked', issues: [issue('ROOF_COORDINATION_MODEL_NOT_VERIFIED', 'Passed roof and coordination models are required.')] };
  }
  if (roofModel.projectName !== coordinationModel.projectName) return { status: 'blocked', issues: [issue('ROOF_COORDINATION_PROJECT_MISMATCH', 'Roof and coordination packets belong to different projects.')] };
  const equipment = coordinationModel.equipment.map((item) => ({
    id: item.id, type: item.kind === 'heat-pump' ? 'rooftop-heat-pump' : 'outdoor-unit',
    geometry: { kind: 'polygon', boundaryPlanFt: item.boundaryPlanFt }, sourceBindingRefs: item.sourceBindingRefs,
    sourceCallout: item.modelTag, clearance: { status: item.clearanceStatus, basis: 'Registered plan footprint only; feature-specific obstruction clearance is unresolved.' },
    heightFt: item.heightFt, heightStatus: item.heightStatus,
  }));
  const vents = coordinationModel.vents.map((item) => ({
    id: item.id, type: 'vent-penetration', geometry: { kind: 'point', planPointFt: item.planPointFt },
    sourceBindingRefs: item.sourceBindingRefs, sourceCallout: `${item.diameterIn} inch vent`,
    clearance: { status: item.clearanceStatus, basis: 'Registered penetration center; sprinkler obstruction clearance is unresolved.' },
  }));
  return { ...roofModel, features: [...(roofModel.features || []), ...equipment, ...vents], coordination: coordinationModel };
}

export function checkRoofRouteAgainstCoordination(segments, coordinationModel, options = {}) {
  if (!coordinationModel || coordinationModel.status !== 'passed') return { status: 'blocked', conflicts: [], issues: [issue('ROOF_COORDINATION_MODEL_NOT_VERIFIED', 'A passed coordination model is required.')] };
  const ventBufferFt = Number.isFinite(Number(options.ventBufferFt)) ? Math.max(0, Number(options.ventBufferFt)) : 0.5;
  const conflicts = [];
  for (const [index, segment] of (segments || []).entries()) {
    if (!segment || !Array.isArray(segment.from) || !Array.isArray(segment.to)) {
      conflicts.push({ segmentIndex: index, featureId: null, type: 'invalid-segment' }); continue;
    }
    const a = [Number(segment.from[0]), Number(segment.from[1])]; const b = [Number(segment.to[0]), Number(segment.to[1])];
    for (const item of coordinationModel.equipment) {
      const polygon = item.boundaryPlanFt;
      if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon) || polygon.some((point, edge) => segmentsIntersect(a, b, point, polygon[(edge + 1) % polygon.length]))) {
        conflicts.push({ segmentIndex: index, featureId: item.id, type: item.kind });
      }
    }
    for (const item of coordinationModel.vents) if (pointSegmentDistance(item.planPointFt, a, b) <= ventBufferFt) {
      conflicts.push({ segmentIndex: index, featureId: item.id, type: item.kind, bufferFt: ventBufferFt });
    }
  }
  return {
    status: conflicts.length ? 'blocked' : 'passed', conflicts,
    issues: conflicts.length ? [issue('ROOF_ROUTE_COORDINATION_CONFLICT', 'Route intersects registered rooftop equipment or a vent penetration buffer.', conflicts.map((entry) => entry.featureId).filter(Boolean))] : [],
    complianceReady: false, claimStatus: 'registered-plan-geometry-check-only',
  };
}
