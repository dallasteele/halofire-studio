import { z } from 'zod';
import { SourceBindingSchema, sha256Hex } from './elevation-datums.js';

const SHA256_RE = /^[0-9a-f]{64}$/;
const EPS = 1e-9;

const EvidenceSourceSchema = z.object({
  id: z.string().trim().min(1),
  binding: SourceBindingSchema,
}).strict();

const DatumSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['eave', 'ridge', 'valley', 'section-point', 'roof-point']),
  label: z.string().min(1),
  elevationFt: z.number().finite(),
  planPointFt: z.tuple([z.number().finite(), z.number().finite()]),
  sourceBindingRefs: z.array(z.string().trim().min(1)).min(1),
  derivation: z.object({
    method: z.enum(['direct-elevation-datum', 'slope-from-anchor', 'section-intersection']),
    anchorDatumId: z.string().trim().min(1).optional(),
    slopeRisePerFoot: z.number().finite().optional(),
    sourceSlopeText: z.string().trim().min(1).optional(),
    sourcePdfPoint: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    sheetScaleFtPerPoint: z.number().positive().optional(),
  }).strict(),
}).passthrough();

const RoofRegionSchema = z.object({
  id: z.string().min(1),
  boundaryPlanFt: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3),
  datumIds: z.array(z.string().min(1)).min(3),
}).strict();

const RoofExclusionSchema = z.object({
  id: z.string().trim().min(1),
  boundaryPlanFt: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3),
  reason: z.enum(['open-core', 'roof-hatch', 'shaft', 'mechanical-opening', 'unresolved-obstruction']),
  sourceBindingRefs: z.array(z.string().trim().min(1)).min(1),
}).strict();

const RoofFeatureSchema = z.object({
  id: z.string().trim().min(1),
  type: z.enum(['internal-roof-drain', 'internal-overflow-drain', 'roof-hatch', 'other-penetration']),
  geometry: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('point'),
      planPointFt: z.tuple([z.number().finite(), z.number().finite()]),
    }).strict(),
    z.object({
      kind: z.literal('polygon'),
      boundaryPlanFt: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3),
    }).strict(),
  ]),
  sourceBindingRefs: z.array(z.string().trim().min(1)).min(1),
  sourceCallout: z.string().trim().min(1),
  sourcePdfPoint: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  dimensionsFt: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  clearance: z.object({
    status: z.enum(['resolved', 'unresolved']),
    boundaryPlanFt: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).optional(),
    basis: z.string().trim().min(1),
  }).strict(),
}).strict();

const ReconstructionDraftSchema = z.object({
  artifactType: z.literal('halofire.roof-reconstruction-input.v1'),
  sourceBindings: z.array(EvidenceSourceSchema).min(1),
  datums: z.array(DatumSchema).min(3),
  regions: z.array(RoofRegionSchema).min(1),
  exclusions: z.array(RoofExclusionSchema),
  features: z.array(RoofFeatureSchema),
  coverage: z.object({
    complete: z.boolean(),
    resolvedScope: z.string().trim().min(1),
    unresolvedRegions: z.array(z.string().trim().min(1)),
  }).strict(),
}).strict();

const ReconstructionInputSchema = ReconstructionDraftSchema.extend({
  evidenceReceiptSha256: z.string().regex(SHA256_RE),
}).strict();

function issue(code, message, refs = []) {
  return { severity: 'blocking', code, refs, message };
}
function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function pointOnSegment(point, a, b, tolerance = 1e-7) {
  const [x, y] = point; const [ax, ay] = a; const [bx, by] = b;
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > tolerance) return false;
  const dot = (x - ax) * (bx - ax) + (y - ay) * (by - ay);
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  return dot >= -tolerance && dot <= len2 + tolerance;
}

export function pointInPolygon(point, polygon) {
  if (!Array.isArray(point) || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j]; const b = polygon[i];
    if (pointOnSegment(point, a, b)) return true;
    const intersects = ((b[1] > point[1]) !== (a[1] > point[1]))
      && point[0] < ((a[0] - b[0]) * (point[1] - b[1])) / (a[1] - b[1]) + b[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonArea(polygon) {
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, y1] = polygon[i]; const [x2, y2] = polygon[(i + 1) % polygon.length];
    twiceArea += x1 * y2 - x2 * y1;
  }
  return twiceArea / 2;
}

function planeFromDatums(datums) {
  for (let i = 0; i < datums.length - 2; i += 1) {
    for (let j = i + 1; j < datums.length - 1; j += 1) {
      for (let k = j + 1; k < datums.length; k += 1) {
        const p1 = datums[i]; const p2 = datums[j]; const p3 = datums[k];
        const [x1, y1] = p1.planPointFt; const [x2, y2] = p2.planPointFt; const [x3, y3] = p3.planPointFt;
        const determinant = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
        if (Math.abs(determinant) <= EPS) continue;
        const z1 = p1.elevationFt; const z2 = p2.elevationFt; const z3 = p3.elevationFt;
        const a = (z1 * (y2 - y3) + z2 * (y3 - y1) + z3 * (y1 - y2)) / determinant;
        const b = (z1 * (x3 - x2) + z2 * (x1 - x3) + z3 * (x2 - x1)) / determinant;
        const c = (z1 * (x2 * y3 - x3 * y2) + z2 * (x3 * y1 - x1 * y3) + z3 * (x1 * y2 - x2 * y1)) / determinant;
        return { a, b, c };
      }
    }
  }
  return null;
}

function planeNormal(plane) {
  const length = Math.hypot(plane.a, plane.b, 1);
  return [-plane.a / length, -plane.b / length, 1 / length];
}

function elevationOnPlane(plane, point) {
  return plane.a * point[0] + plane.b * point[1] + plane.c;
}

export async function sealRoofReconstructionInput(draft) {
  const parsed = ReconstructionDraftSchema.parse(draft);
  return { ...parsed, evidenceReceiptSha256: await sha256Hex(parsed) };
}

export async function reconstructRoofPlanes(input, opts = {}) {
  const parsed = ReconstructionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'blocked', planes: [], issues: [issue('ROOF_INPUT_SCHEMA_INVALID', parsed.error.issues.map((entry) => entry.message).join('; '))], complianceReady: false };
  }
  const data = parsed.data;
  const { evidenceReceiptSha256, ...draft } = data;
  const actualReceipt = await sha256Hex(draft);
  if (actualReceipt !== evidenceReceiptSha256) {
    return { status: 'blocked', planes: [], issues: [issue('ROOF_EVIDENCE_RECEIPT_MISMATCH', 'Roof reconstruction content does not match its immutable SHA-256 receipt.', [evidenceReceiptSha256])], complianceReady: false };
  }
  const toleranceFt = Number.isFinite(Number(opts.residualToleranceFt)) ? Math.abs(Number(opts.residualToleranceFt)) : 1 / 96;
  const issues = [];
  const sourceIds = new Set();
  for (const source of data.sourceBindings) {
    if (sourceIds.has(source.id)) issues.push(issue('ROOF_SOURCE_ID_DUPLICATE', `Duplicate roof evidence source id: ${source.id}`, [source.id]));
    sourceIds.add(source.id);
  }
  const datumMap = new Map();
  for (const datum of data.datums) {
    if (datumMap.has(datum.id)) issues.push(issue('ROOF_DATUM_ID_DUPLICATE', `Duplicate roof datum id: ${datum.id}`, [datum.id]));
    const missingRefs = datum.sourceBindingRefs.filter((ref) => !sourceIds.has(ref));
    if (missingRefs.length) {
      issues.push(issue('ROOF_DATUM_SOURCE_MISMATCH', `Roof datum ${datum.id} references evidence outside the sealed source bundle.`, [datum.id, ...missingRefs]));
    }
    datumMap.set(datum.id, datum);
  }
  const planes = [];
  const regionIds = new Set();
  for (const region of data.regions) {
    if (regionIds.has(region.id)) {
      issues.push(issue('ROOF_REGION_ID_DUPLICATE', `Duplicate roof region id: ${region.id}`, [region.id]));
      continue;
    }
    regionIds.add(region.id);
    if (Math.abs(polygonArea(region.boundaryPlanFt)) <= EPS) {
      issues.push(issue('ROOF_REGION_BOUNDARY_DEGENERATE', `Roof region ${region.id} has a zero-area boundary.`, [region.id]));
      continue;
    }
    const datums = region.datumIds.map((id) => datumMap.get(id)).filter(Boolean);
    if (datums.length !== region.datumIds.length) {
      issues.push(issue('ROOF_REGION_DATUM_MISSING', `Roof region ${region.id} references missing datums.`, region.datumIds));
      continue;
    }
    const outside = datums.filter((datum) => !pointInPolygon(datum.planPointFt, region.boundaryPlanFt));
    if (outside.length) {
      issues.push(issue('ROOF_DATUM_OUTSIDE_REGION', `Roof region ${region.id} has source datums outside its bounded polygon.`, outside.map((datum) => datum.id)));
      continue;
    }
    const equation = planeFromDatums(datums);
    if (!equation) {
      issues.push(issue('ROOF_DATUMS_COLLINEAR', `Roof region ${region.id} does not contain three non-collinear plan points.`, region.datumIds));
      continue;
    }
    const residuals = datums.map((datum) => Math.abs(elevationOnPlane(equation, datum.planPointFt) - datum.elevationFt));
    const maxResidualFt = Math.max(...residuals);
    if (maxResidualFt > toleranceFt) {
      issues.push(issue('ROOF_PLANE_RESIDUAL_EXCEEDED', `Roof region ${region.id} source datums do not converge to one plane.`, region.datumIds));
      continue;
    }
    const normal = planeNormal(equation);
    planes.push({
      id: region.id,
      boundaryPlanFt: region.boundaryPlanFt,
      datumIds: region.datumIds,
      equation: { a: round(equation.a), b: round(equation.b), c: round(equation.c) },
      normal: normal.map((value) => round(value)),
      slopeRisePerFoot: round(Math.hypot(equation.a, equation.b)),
      slopeDegrees: round(Math.atan(Math.hypot(equation.a, equation.b)) * 180 / Math.PI),
      maxResidualFt: round(maxResidualFt),
      sourceBindingRefs: [...new Set(datums.flatMap((datum) => datum.sourceBindingRefs))].sort(),
      evidenceReceiptSha256: data.evidenceReceiptSha256,
    });
  }
  const featureIds = new Set();
  for (const feature of data.features) {
    if (featureIds.has(feature.id)) issues.push(issue('ROOF_FEATURE_ID_DUPLICATE', `Duplicate roof feature id: ${feature.id}`, [feature.id]));
    featureIds.add(feature.id);
    const missingRefs = feature.sourceBindingRefs.filter((ref) => !sourceIds.has(ref));
    if (missingRefs.length) issues.push(issue('ROOF_FEATURE_SOURCE_MISMATCH', `Roof feature ${feature.id} references evidence outside the sealed source bundle.`, [feature.id, ...missingRefs]));
    if (feature.geometry.kind === 'polygon' && Math.abs(polygonArea(feature.geometry.boundaryPlanFt)) <= EPS) {
      issues.push(issue('ROOF_FEATURE_BOUNDARY_DEGENERATE', `Roof feature ${feature.id} has a zero-area boundary.`, [feature.id]));
    }
    if (feature.clearance.boundaryPlanFt && Math.abs(polygonArea(feature.clearance.boundaryPlanFt)) <= EPS) {
      issues.push(issue('ROOF_FEATURE_CLEARANCE_DEGENERATE', `Roof feature ${feature.id} has a zero-area clearance boundary.`, [feature.id]));
    }
  }
  const unresolvedFeatureClearances = data.features.filter((feature) => feature.clearance.status !== 'resolved');
  if (data.coverage.complete && (data.coverage.unresolvedRegions.length || unresolvedFeatureClearances.length)) {
    issues.push(issue('ROOF_COVERAGE_COMPLETENESS_CONTRADICTED', 'Roof coverage cannot be complete while regions or feature clearances remain unresolved.', [
      ...data.coverage.unresolvedRegions,
      ...unresolvedFeatureClearances.map((feature) => feature.id),
    ]));
  }
  return {
    status: issues.length ? 'blocked' : 'passed',
    artifactType: 'halofire.roof-plane-model.v1',
    sourceBindings: data.sourceBindings,
    evidenceReceiptSha256: data.evidenceReceiptSha256,
    coverage: data.coverage,
    exclusions: data.exclusions,
    features: data.features,
    planes: issues.length ? [] : planes,
    issues,
    verification: { sourceBound: issues.every((entry) => entry.code !== 'ROOF_DATUM_SOURCE_MISMATCH'), residualToleranceFt: toleranceFt },
    complianceReady: false,
    claimStatus: 'source-bound-roof-geometry-only',
  };
}

export function roofElevationAt(roofModel, planPointFt, opts = {}) {
  if (!roofModel || roofModel.status !== 'passed' || !Array.isArray(roofModel.planes)) {
    return { status: 'blocked', issues: [issue('ROOF_MODEL_NOT_VERIFIED', 'A passed source-bound roof model is required.')] };
  }
  const exclusion = (Array.isArray(roofModel.exclusions) ? roofModel.exclusions : [])
    .find((entry) => pointInPolygon(planPointFt, entry.boundaryPlanFt));
  if (exclusion) {
    return { status: 'blocked', issues: [issue('ROOF_POINT_IN_EXCLUDED_OPENING', `Plan point falls inside excluded roof geometry: ${exclusion.reason}.`, [exclusion.id])] };
  }
  const featurePointToleranceFt = Number.isFinite(Number(opts.featurePointToleranceFt)) ? Math.abs(Number(opts.featurePointToleranceFt)) : 1 / 96;
  const feature = (Array.isArray(roofModel.features) ? roofModel.features : []).find((entry) => {
    if (entry.clearance && entry.clearance.boundaryPlanFt && pointInPolygon(planPointFt, entry.clearance.boundaryPlanFt)) return true;
    if (entry.geometry.kind === 'polygon') return pointInPolygon(planPointFt, entry.geometry.boundaryPlanFt);
    return Math.hypot(planPointFt[0] - entry.geometry.planPointFt[0], planPointFt[1] - entry.geometry.planPointFt[1]) <= featurePointToleranceFt;
  });
  if (feature) {
    return { status: 'blocked', issues: [issue('ROOF_POINT_IN_FEATURE_OR_CLEARANCE', `Plan point conflicts with source-bound roof feature: ${feature.type}.`, [feature.id])] };
  }
  const toleranceFt = Number.isFinite(Number(opts.overlapToleranceFt)) ? Math.abs(Number(opts.overlapToleranceFt)) : 1 / 96;
  const candidates = roofModel.planes
    .filter((plane) => pointInPolygon(planPointFt, plane.boundaryPlanFt))
    .map((plane) => ({ plane, elevationFt: elevationOnPlane(plane.equation, planPointFt) }))
    .sort((left, right) => left.plane.id.localeCompare(right.plane.id));
  if (!candidates.length) return { status: 'blocked', issues: [issue('ROOF_POINT_OUTSIDE_MODEL', 'Plan point is outside every verified roof plane.')] };
  const elevations = candidates.map((candidate) => candidate.elevationFt);
  if (Math.max(...elevations) - Math.min(...elevations) > toleranceFt) {
    return { status: 'blocked', issues: [issue('ROOF_OVERLAP_CONFLICT', 'Overlapping roof planes disagree at the requested plan point.', candidates.map((candidate) => candidate.plane.id))] };
  }
  const chosen = candidates[0];
  return {
    status: 'passed', elevationFt: round(chosen.elevationFt), planeId: chosen.plane.id,
    planeIds: candidates.map((candidate) => candidate.plane.id), normal: chosen.plane.normal,
  };
}

function point3(value) {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => Number.isFinite(Number(entry)));
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function nodeKey(point) {
  return point.map((value) => round(value, 5)).join(',');
}

export function projectCadModelToRoof(input) {
  const cadModel = input && input.cadModel;
  const roofModel = input && input.roofModel;
  const offsets = input && input.offsets;
  const issues = [];
  if (!cadModel || !Array.isArray(cadModel.solids)) issues.push(issue('ROOF_PROJECTION_MODEL_INVALID', 'cadModel.solids is required.'));
  if (!roofModel || roofModel.status !== 'passed') issues.push(issue('ROOF_MODEL_NOT_VERIFIED', 'A passed roof model is required for projection.'));
  if (roofModel && roofModel.coverage && roofModel.coverage.complete !== true) {
    issues.push(issue('ROOF_MODEL_COVERAGE_INCOMPLETE', 'Full-model projection requires every roof region to be resolved and source-bound.', roofModel.coverage.unresolvedRegions || []));
  }
  const headOffset = Number(offsets && offsets.headOffsetBelowRoofFt);
  const pipeOffset = Number(offsets && offsets.pipeOffsetBelowRoofFt);
  const hangerSpacing = Number(offsets && offsets.hangerSpacingFt);
  if (!(headOffset >= 0) || !(pipeOffset > 0) || !(hangerSpacing > 0)) {
    issues.push(issue('ROOF_PROJECTION_OFFSETS_INVALID', 'Explicit nonnegative head offset, positive pipe offset, and positive hanger spacing are required.'));
  }
  if (issues.length) return { status: 'blocked', model: null, hangers: [], issues, complianceReady: false };

  const heads = cadModel.solids.filter((solid) => solid && solid.kind === 'head' && point3(solid.position));
  const projectedNodeMap = new Map();
  const endpointClass = (point) => heads.some((head) => distance3(head.position, point) <= 0.05) ? 'head' : 'pipe';
  const projectNode = (point, klass) => {
    const key = nodeKey(point);
    if (projectedNodeMap.has(key)) return projectedNodeMap.get(key);
    const roof = roofElevationAt(roofModel, [Number(point[0]), Number(point[1])]);
    if (roof.status !== 'passed') {
      issues.push(...roof.issues.map((entry) => ({ ...entry, refs: [...(entry.refs || []), key] })));
      return null;
    }
    const offset = klass === 'head' ? headOffset : pipeOffset;
    const projected = [round(point[0]), round(point[1]), round(roof.elevationFt - offset)];
    projectedNodeMap.set(key, projected);
    return projected;
  };

  const solids = [];
  for (const solid of cadModel.solids) {
    if (!solid || typeof solid !== 'object') continue;
    if (solid.kind === 'head' && point3(solid.position)) {
      const position = projectNode(solid.position, 'head');
      if (position) {
        const roof = roofElevationAt(roofModel, [position[0], position[1]]);
        solids.push({ ...solid, position, roofPlaneId: roof.planeId, roofNormal: roof.normal, roofProjected: true });
      }
    } else if (solid.kind === 'pipe' && point3(solid.from) && point3(solid.to)) {
      const from = projectNode(solid.from, endpointClass(solid.from));
      const to = projectNode(solid.to, endpointClass(solid.to));
      if (from && to) solids.push({ ...solid, from, to, roofProjected: true, sourceEvidenceReceiptSha256: roofModel.evidenceReceiptSha256 });
    } else {
      solids.push({ ...solid });
    }
  }
  if (issues.length) return { status: 'blocked', model: null, hangers: [], issues, complianceReady: false };

  const hangers = [];
  const carriers = solids.filter((solid) => solid.kind === 'pipe' && ['main', 'branch'].includes(solid.role) && point3(solid.from) && point3(solid.to));
  for (const pipe of carriers) {
    const planLength = Math.hypot(pipe.to[0] - pipe.from[0], pipe.to[1] - pipe.from[1]);
    const divisions = Math.max(1, Math.ceil(planLength / hangerSpacing));
    for (let index = 0; index <= divisions; index += 1) {
      const t = index / divisions;
      const x = pipe.from[0] + (pipe.to[0] - pipe.from[0]) * t;
      const y = pipe.from[1] + (pipe.to[1] - pipe.from[1]) * t;
      const pipeZ = pipe.from[2] + (pipe.to[2] - pipe.from[2]) * t;
      const roof = roofElevationAt(roofModel, [x, y]);
      if (roof.status !== 'passed') {
        issues.push(...roof.issues);
        continue;
      }
      hangers.push({
        kind: 'hanger', role: 'hanger', layer: 'SUPPORTS',
        name: `${pipe.name || 'pipe'}/roof-hanger-${index}`,
        pipe: pipe.name || null,
        from: [round(x), round(y), round(pipeZ)],
        to: [round(x), round(y), round(roof.elevationFt)],
        rodLengthFt: round(roof.elevationFt - pipeZ),
        roofPlaneId: roof.planeId,
        roofNormal: roof.normal,
        spacingLimitFt: hangerSpacing,
        sourceEvidenceReceiptSha256: roofModel.evidenceReceiptSha256,
      });
    }
  }
  if (issues.length) return { status: 'blocked', model: null, hangers: [], issues, complianceReady: false };
  const model = { ...cadModel, solids: [...solids, ...hangers] };
  return {
    status: 'passed',
    artifactType: 'halofire.roof-projected-cad-model.v1',
    model,
    hangers,
    counts: {
      headsProjected: solids.filter((solid) => solid.kind === 'head' && solid.roofProjected).length,
      pipesProjected: solids.filter((solid) => solid.kind === 'pipe' && solid.roofProjected).length,
      hangersProjected: hangers.length,
      uniqueTopologyNodesProjected: projectedNodeMap.size,
    },
    issues: [],
    verification: { sourceBound: true, topologyNodeMapUsed: true, boundedPlaneProjection: true },
    complianceReady: false,
    claimStatus: 'pitched-roof-geometry-verified-not-code-compliant',
    disclaimer: 'Source-bound pitched-roof geometry aid only. NFPA, hydraulic, obstruction, seismic, listing, AHJ, and PE gates remain separate and fail-closed.',
  };
}
