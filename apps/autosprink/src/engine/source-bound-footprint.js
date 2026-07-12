import { buildingOutlinePolygon, traceFilledBoundary } from './pdf-floorplan.js';
import { z } from 'zod';
import { SourceBindingSchema, sha256Hex } from './elevation-datums.js';

const EPS = 1e-8;
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

export function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}

export function polygonBounds(points) {
  const xs = points.map((point) => point[0]); const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, widthFt: maxX - minX, heightFt: maxY - minY };
}

export function convexHull(points) {
  const unique = [...new Map((points || []).filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [`${Number(point[0])},${Number(point[1])}`, [Number(point[0]), Number(point[1])]])).values()]
    .sort((left, right) => (left[0] - right[0]) || (left[1] - right[1]));
  if (unique.length < 3) return unique;
  const cross = (origin, a, b) => (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of unique.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function orientation(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(a, b, p) {
  return Math.abs(orientation(a, b, p)) <= EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
    && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}
function intersects(a, b, c, d) {
  const o1 = orientation(a, b, c); const o2 = orientation(a, b, d); const o3 = orientation(c, d, a); const o4 = orientation(c, d, b);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function isSimplePolygon(points) {
  if (!Array.isArray(points) || points.length < 3 || polygonArea(points) <= EPS) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i || j === (i + 1) % points.length || (j + 1) % points.length === i) continue;
      const c = points[j]; const d = points[(j + 1) % points.length];
      if (intersects(a, b, c, d)) return false;
    }
  }
  return true;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j]; const b = polygon[i];
    if (onSegment(a, b, point)) return true;
    if (((b[1] > point[1]) !== (a[1] > point[1]))
      && point[0] < ((a[0] - b[0]) * (point[1] - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}

function groupsByGraphicsState(segments) {
  const groups = new Map();
  for (const segment of (segments || [])) {
    const key = `${segment.lineWidth ?? 'null'}|${segment.strokeColor ?? 'null'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(segment);
  }
  return groups;
}

/**
 * Derive an exterior shell only when at least two independent heavy graphics-state
 * layers agree on the plan extent. Candidate selection uses drafting geometry, never
 * a desired square footage. A printed-area control may be supplied for validation
 * after selection; it cannot influence which candidate wins.
 */
export function deriveExteriorConsensus(segments, options = {}) {
  const minLineWidth = Number.isFinite(options.minLineWidth) ? options.minLineWidth : 0.15;
  const minSegments = Number.isInteger(options.minSegments) ? options.minSegments : 100;
  const minAspect = Number.isFinite(options.minAspect) ? options.minAspect : 2;
  const clusterTolerance = Number.isFinite(options.clusterTolerance) ? options.clusterTolerance : 0.03;
  const minOutlineFillRatio = Number.isFinite(options.minOutlineFillRatio) ? options.minOutlineFillRatio : 0.85;
  const candidates = [];
  for (const [graphicsState, members] of groupsByGraphicsState(segments)) {
    const lineWidth = Number(members[0]?.lineWidth);
    if (!(lineWidth >= minLineWidth) || members.length < minSegments) continue;
    const hull = convexHull(members.flatMap((segment) => [[segment.x1, segment.y1], [segment.x2, segment.y2]]));
    if (hull.length < 3) continue;
    const hullAreaSqft = polygonArea(hull); const hullBounds = polygonBounds(hull);
    const aspect = Math.max(hullBounds.widthFt, hullBounds.heightFt) / Math.max(EPS, Math.min(hullBounds.widthFt, hullBounds.heightFt));
    if (hullAreaSqft < 1000 || aspect < minAspect) continue;
    const outline = buildingOutlinePolygon(members, {
      networkMode: 'all-wall-like', bridgeGapsFt: options.bridgeGapsFt ?? 8,
      gridN: options.gridN ?? 420, minWallFt: options.minWallFt ?? 1,
    });
    const outlineBboxArea = outline.bbox.widthFt * outline.bbox.heightFt;
    candidates.push({
      graphicsState, lineWidth, strokeColor: members[0]?.strokeColor ?? null, segmentCount: members.length,
      hull, hullAreaSqft, hullBounds, outline: outline.polygon, outlineAreaSqft: outline.areaSqft,
      outlineFillRatio: outlineBboxArea > 0 ? outline.areaSqft / outlineBboxArea : 0,
      outlineMethod: outline.method,
    });
  }
  let bestCluster = [];
  for (const candidate of candidates) {
    const cluster = candidates.filter((other) => Math.abs(other.hullAreaSqft - candidate.hullAreaSqft)
      / Math.max(candidate.hullAreaSqft, other.hullAreaSqft) <= clusterTolerance);
    if (cluster.length > bestCluster.length
      || (cluster.length === bestCluster.length && cluster.reduce((sum, item) => sum + item.segmentCount, 0) > bestCluster.reduce((sum, item) => sum + item.segmentCount, 0))) {
      bestCluster = cluster;
    }
  }
  if (bestCluster.length < 2) {
    return { status: 'blocked', polygon: null, areaSqft: null, candidates, issues: [{ code: 'FOOTPRINT_GRAPHICS_CONSENSUS_MISSING', message: 'At least two independent heavy graphics-state layers must agree on the exterior extent.' }] };
  }
  const chosen = bestCluster.slice().sort((left, right) => (right.outlineFillRatio - left.outlineFillRatio) || (right.segmentCount - left.segmentCount))[0];
  if (chosen.outlineFillRatio < minOutlineFillRatio || !isSimplePolygon(chosen.outline)) {
    return { status: 'blocked', polygon: null, areaSqft: null, candidates, consensus: bestCluster.map((item) => item.graphicsState), issues: [{ code: 'FOOTPRINT_EXTERIOR_SHELL_NOT_CLOSED', message: 'Consensus extent exists, but no candidate provides a closed simple exterior shell.' }] };
  }
  const areaSqft = polygonArea(chosen.outline);
  const expected = Number(options.expectedAreaSqft); const controlResidualPct = Number.isFinite(expected) && expected > 0 ? Math.abs(areaSqft - expected) / expected * 100 : null;
  const controlTolerancePct = Number.isFinite(options.controlTolerancePct) ? options.controlTolerancePct : 2;
  if (controlResidualPct != null && controlResidualPct > controlTolerancePct) {
    return { status: 'blocked', polygon: null, areaSqft: null, candidates, consensus: bestCluster.map((item) => item.graphicsState), issues: [{ code: 'FOOTPRINT_PRINTED_AREA_CONTROL_FAILED', message: 'Selected exterior shell exceeds the independent printed-area control tolerance.' }], controlResidualPct };
  }
  return {
    status: 'passed', polygon: chosen.outline.map((point) => point.map((value) => round(value))), areaSqft: round(areaSqft),
    bounds: polygonBounds(chosen.outline), graphicsState: chosen.graphicsState,
    consensus: bestCluster.map((item) => ({ graphicsState: item.graphicsState, hullAreaSqft: round(item.hullAreaSqft), segmentCount: item.segmentCount })),
    controlResidualPct: controlResidualPct == null ? null : round(controlResidualPct),
    issues: [], claimStatus: 'source-bound-vector-exterior-shell-not-sprinkler-compliance',
  };
}

export function rasterUnionPolygons(polygons, options = {}) {
  const valid = (polygons || []).filter((polygon) => Array.isArray(polygon) && polygon.length >= 3 && isSimplePolygon(polygon));
  if (!valid.length) return { status: 'blocked', polygon: null, areaSqft: null, issues: [{ code: 'FOOTPRINT_UNION_INPUT_INVALID' }] };
  const bounds = polygonBounds(valid.flat()); const cellSizeFt = Number.isFinite(options.cellSizeFt) ? Math.max(0.05, options.cellSizeFt) : 0.25;
  const gridN = Math.ceil(Math.max(bounds.widthFt, bounds.heightFt) / cellSizeFt) + 2;
  const cw = cellSizeFt; const ch = cellSizeFt; const originX = bounds.minX - cellSizeFt; const originY = bounds.minY - cellSizeFt;
  const filled = new Uint8Array(gridN * gridN);
  let filledCount = 0;
  for (let cy = 0; cy < gridN; cy += 1) {
    const y = originY + (cy + 0.5) * ch;
    for (let cx = 0; cx < gridN; cx += 1) {
      const x = originX + (cx + 0.5) * cw;
      if (valid.some((polygon) => pointInPolygon([x, y], polygon))) { filled[cy * gridN + cx] = 1; filledCount += 1; }
    }
  }
  const polygon = traceFilledBoundary(filled, gridN, originX, originY, cw, ch);
  if (!polygon || !isSimplePolygon(polygon)) return { status: 'blocked', polygon: null, areaSqft: null, issues: [{ code: 'FOOTPRINT_UNION_TRACE_INVALID' }] };
  return { status: 'passed', polygon: polygon.map((point) => point.map((value) => round(value))), areaSqft: round(polygonArea(polygon)), rasterAreaSqft: round(filledCount * cellSizeFt * cellSizeFt), cellSizeFt, issues: [] };
}

/** Clip a simple polygon to an axis-aligned source-control rectangle. */
export function clipPolygonToRect(polygon, rect) {
  if (!isSimplePolygon(polygon) || !rect || !(rect.maxX > rect.minX) || !(rect.maxY > rect.minY)) return [];
  const clip = (input, inside, intersection) => {
    const output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index]; const previous = input[(index + input.length - 1) % input.length];
      const currentInside = inside(current); const previousInside = inside(previous);
      if (currentInside) {
        if (!previousInside) output.push(intersection(previous, current));
        output.push(current);
      } else if (previousInside) output.push(intersection(previous, current));
    }
    return output;
  };
  const vertical = (x) => (a, b) => {
    const t = (x - a[0]) / (b[0] - a[0]); return [x, a[1] + t * (b[1] - a[1])];
  };
  const horizontal = (y) => (a, b) => {
    const t = (y - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y];
  };
  let output = polygon.slice();
  output = clip(output, (point) => point[0] >= rect.minX, vertical(rect.minX));
  output = clip(output, (point) => point[0] <= rect.maxX, vertical(rect.maxX));
  output = clip(output, (point) => point[1] >= rect.minY, horizontal(rect.minY));
  output = clip(output, (point) => point[1] <= rect.maxY, horizontal(rect.maxY));
  return output.map((point) => point.map((value) => round(value)));
}

const LevelSchema = z.object({
  level: z.number().int().min(1).max(99), sheetId: z.string().min(1), sourceBinding: SourceBindingSchema,
  elevationFt: z.number().finite(), elevationEvidenceReceiptSha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(['passed', 'blocked']), polygonPlanFt: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).nullable(),
  areaSqft: z.number().positive().nullable(), derivation: z.record(z.unknown()),
  issues: z.array(z.object({ code: z.string().min(1) }).passthrough()),
}).strict();
const DraftSchema = z.object({
  artifactType: z.literal('halofire.source-bound-level-footprints.v1'), projectName: z.string().min(1), units: z.literal('ft'),
  sourcePdfSha256: z.string().regex(/^[0-9a-f]{64}$/), scaleFtPerPoint: z.number().positive(), scaleBasis: z.string().min(1),
  elevationEvidenceReceiptSha256: z.string().regex(/^[0-9a-f]{64}$/), levels: z.array(LevelSchema).min(1),
  coverage: z.object({ complete: z.boolean(), passedLevels: z.array(z.number().int()), blockedLevels: z.array(z.number().int()), unresolved: z.array(z.string()) }).strict(),
  claimStatus: z.literal('source-bound-building-geometry-only-not-sprinkler-code-compliance'),
}).strict();
const PacketSchema = DraftSchema.extend({ evidenceReceiptSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

export async function validateLevelFootprintPacket(input) {
  const parsed = PacketSchema.safeParse(input);
  if (!parsed.success) return { status: 'blocked', levels: [], issues: [{ code: 'LEVEL_FOOTPRINT_SCHEMA_INVALID', message: parsed.error.issues.map((entry) => entry.message).join('; ') }], complianceReady: false };
  const data = parsed.data; const { evidenceReceiptSha256, ...draft } = data;
  if (await sha256Hex(draft) !== evidenceReceiptSha256) return { status: 'blocked', levels: [], issues: [{ code: 'LEVEL_FOOTPRINT_RECEIPT_MISMATCH' }], complianceReady: false };
  const issues = []; const seen = new Set();
  for (const level of data.levels) {
    if (seen.has(level.level)) issues.push({ code: 'LEVEL_FOOTPRINT_LEVEL_DUPLICATE', refs: [String(level.level)] });
    seen.add(level.level);
    if (level.sheetId !== level.sourceBinding.sheetId) issues.push({ code: 'LEVEL_FOOTPRINT_SHEET_BINDING_MISMATCH', refs: [level.sheetId] });
    if (level.sourceBinding.sourcePdfSha256 !== data.sourcePdfSha256) issues.push({ code: 'LEVEL_FOOTPRINT_SOURCE_BINDING_MISMATCH', refs: [level.sheetId] });
    if (level.elevationEvidenceReceiptSha256 !== data.elevationEvidenceReceiptSha256) issues.push({ code: 'LEVEL_FOOTPRINT_ELEVATION_RECEIPT_MISMATCH', refs: [level.sheetId] });
    if (level.status === 'passed') {
      if (!level.polygonPlanFt || !isSimplePolygon(level.polygonPlanFt)) issues.push({ code: 'LEVEL_FOOTPRINT_POLYGON_INVALID', refs: [level.sheetId] });
      const actualArea = polygonArea(level.polygonPlanFt || []);
      if (level.areaSqft == null || Math.abs(actualArea - level.areaSqft) / Math.max(actualArea, 1) > 0.001) issues.push({ code: 'LEVEL_FOOTPRINT_AREA_MISMATCH', refs: [level.sheetId] });
      if (level.issues.length) issues.push({ code: 'LEVEL_FOOTPRINT_PASSED_WITH_ISSUES', refs: [level.sheetId] });
    } else if (level.polygonPlanFt != null || level.areaSqft != null || !level.issues.length) {
      issues.push({ code: 'LEVEL_FOOTPRINT_BLOCKED_STATE_INVALID', refs: [level.sheetId] });
    }
  }
  const passedLevels = data.levels.filter((level) => level.status === 'passed').map((level) => level.level);
  const blockedLevels = data.levels.filter((level) => level.status === 'blocked').map((level) => level.level);
  if (JSON.stringify(passedLevels) !== JSON.stringify(data.coverage.passedLevels)
    || JSON.stringify(blockedLevels) !== JSON.stringify(data.coverage.blockedLevels)
    || data.coverage.complete !== (blockedLevels.length === 0)) issues.push({ code: 'LEVEL_FOOTPRINT_COVERAGE_MISMATCH' });
  return {
    ...data, status: issues.length ? 'blocked' : 'passed', issues,
    geometryComplete: data.coverage.complete, complianceReady: false, approvalReady: false,
  };
}
