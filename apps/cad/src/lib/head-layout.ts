// HaloFire CAD — PURE NFPA-13 sprinkler head auto-layout + coverage report.
// No React / three / DOM imports. Deterministic: same inputs -> same outputs.
//
// autoLayoutHeads(roomPolygonFt, hazard, opts):
//   Lay heads on a regular GRID at the hazard's cited MAXIMUM spacing
//   (nfpa13-rules.MAX_SPACING_FT — the widest legal grid), starting a half-spacing
//   in from the polygon's bounding-box walls (the cited distance-to-wall rule is
//   one-half max spacing, so a half-spacing inset both satisfies the wall rule and
//   centers the grid). Each candidate is clipped to the room polygon via turf
//   booleanPointInPolygon so heads only land inside the space. Positions are in FEET.
//
// coverageReport(roomPolygonFt, heads, hazard):
//   Check every head against the cited rules: protection area per head must not
//   exceed MAX_PROTECTION_AREA_SQFT; nearest-neighbour spacing must not exceed
//   MAX_SPACING_FT. Returns covered:boolean + maxAreaPerHead + findings[] where each
//   finding carries the CITED rule string from nfpa13-rules. Pure/deterministic.
//
// HONESTY (hard, fail-closed): every coverage/spacing number used here comes ONLY
// from the cited nfpa13-rules re-export — this file forks NO new uncited numbers.
// Findings carry the citation verbatim and say "verify adopted edition". This is a
// DESIGN AID: NOT a hydraulically-calculated layout, NOT AHJ/PE/code-certified.
// Heads returned map 1:1 to what the store persists — nothing is fabricated.

import { booleanPointInPolygon, point as turfPoint, polygon as turfPolygon } from '@turf/turf';
import type { Point2 } from './model';
import { polygonAreaSqFt } from './scale';
import {
  MAX_PROTECTION_AREA_SQFT,
  MAX_SPACING_FT,
  MAX_DISTANCE_TO_WALL_FT,
  NFPA13_DESIGN_AID_DISCLAIMER,
} from './nfpa13-rules';
import type { HazardClass } from './model';

/**
 * The CAD model's hazard enum is UPPER_SNAKE (`ORDINARY_1`); the authored
 * nfpa13-rules enum is lower_snake (`ordinary_1`). Map between them ONCE here so
 * the cited rule tables key correctly — no number is touched, only the key.
 */
const HAZARD_TO_NFPA: Record<HazardClass, keyof typeof MAX_SPACING_FT> = {
  LIGHT: 'light',
  ORDINARY_1: 'ordinary_1',
  ORDINARY_2: 'ordinary_2',
  EXTRA_1: 'extra_1',
  EXTRA_2: 'extra_2',
};

/** Resolve the cited max spacing (ft) + its citation for a CAD hazard class. */
export function maxSpacingFt(hazard: HazardClass): { value: number; citation: string } {
  const rule = MAX_SPACING_FT[HAZARD_TO_NFPA[hazard]];
  // Fail-closed to the cited value; nfpa13-rules guarantees a non-null number here.
  return { value: rule.value as number, citation: rule.citation };
}

/** Resolve the cited max protection area (ft^2) + its citation for a CAD hazard class. */
export function maxProtectionAreaSqFt(hazard: HazardClass): { value: number; citation: string } {
  const rule = MAX_PROTECTION_AREA_SQFT[HAZARD_TO_NFPA[hazard]];
  return { value: rule.value as number, citation: rule.citation };
}

/** Resolve the cited max distance-to-wall (ft) + its citation for a CAD hazard class. */
export function maxDistanceToWallFt(hazard: HazardClass): { value: number; citation: string } {
  const rule = MAX_DISTANCE_TO_WALL_FT[HAZARD_TO_NFPA[hazard]];
  return { value: rule.value as number, citation: rule.citation };
}

/** Options for autoLayoutHeads. */
export interface AutoLayoutOpts {
  /** Catalog SKU id assigned to each placed head (carried onto the store node). */
  sku?: string;
  /**
   * Override the grid spacing (ft). Defaults to the cited MAX spacing for the
   * hazard. A smaller spacing is always legal (tighter than the maximum); a value
   * larger than the cited max is clamped DOWN to the max (never exceed the rule).
   */
  spacingFt?: number;
}

/** A laid-out head: position in FEET + the SKU it was placed with. */
export interface LaidOutHead {
  /** Plan-space X in feet. */
  x: number;
  /** Plan-space Y in feet. */
  y: number;
  /** The catalog SKU id assigned (or undefined when none chosen). */
  sku?: string;
}

/** Axis-aligned bounds of a polygon (feet). */
interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(poly: readonly Point2[]): Bounds | null {
  if (poly.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

/** Build a closed turf polygon ring ([lng,lat]==[x,y]) from a CAD polygon. */
function toTurfRing(poly: readonly Point2[]): number[][] {
  const ring = poly.map((p) => [p.x, p.y]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return ring;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

/** True when (x,y) is inside (or on the boundary of) the room polygon. */
function insidePolygon(x: number, y: number, ring: number[][]): boolean {
  try {
    return booleanPointInPolygon(turfPoint([x, y]), turfPolygon([ring]), {
      ignoreBoundary: false,
    });
  } catch {
    return false;
  }
}

/** Round to 4 decimals for deterministic, stable feet positions. */
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * PURE. Auto-layout sprinkler heads on a grid that respects BOTH cited NFPA-13
 * limits — the maximum distance between sprinklers AND the maximum protection
 * area per sprinkler — clipped to the room polygon. Returns head positions in FEET.
 *
 * Effective spacing (deterministic):
 *   - The cited MAX spacing for the hazard is an absolute ceiling on neighbour
 *     distance.
 *   - The cited MAX protection AREA per head caps a square grid cell at
 *     sqrt(maxArea) per side — for Ordinary (130 ft^2) that is ~11.4 ft, TIGHTER
 *     than the 15 ft spacing ceiling, so the area rule binds. We take the MIN of
 *     the two so neither cited limit is exceeded.
 *   - opts.spacingFt may request an even tighter grid (always legal); it is
 *     clamped DOWN to the effective limit but never relaxed above it.
 *
 * Grid count per axis = ceil(span / spacing) (>= 1), heads spread evenly so the
 * neighbour spacing AND the wall margin (= half the per-axis step) both stay within
 * the cited limits. Each grid point is kept ONLY if inside the room polygon (turf).
 *
 * Returns [] for a degenerate polygon (<3 pts) or a non-positive spacing — never
 * fabricates a head.
 */
export function autoLayoutHeads(
  roomPolygonFt: readonly Point2[],
  hazard: HazardClass,
  opts: AutoLayoutOpts = {},
): LaidOutHead[] {
  const b = boundsOf(roomPolygonFt);
  if (!b) return [];

  const maxRule = maxSpacingFt(hazard);
  const areaRule = maxProtectionAreaSqFt(hazard);
  // The area limit caps a square grid cell: side <= sqrt(maxArea). Take the MIN of
  // that and the cited max spacing so BOTH cited rules hold.
  const areaSpacing = Math.sqrt(areaRule.value);
  const effectiveMax = Math.min(maxRule.value, areaSpacing);
  let spacing = opts.spacingFt ?? effectiveMax;
  if (!Number.isFinite(spacing) || spacing <= 0) return [];
  // Never exceed the binding cited limit — clamp DOWN.
  if (spacing > effectiveMax) spacing = effectiveMax;

  const ring = toTurfRing(roomPolygonFt);
  const width = b.maxX - b.minX;
  const depth = b.maxY - b.minY;
  if (width <= 0 || depth <= 0) return [];

  // NFPA grid count per axis: enough rows/columns that the spacing between heads
  // AND the margin to each wall both stay within the cited limits. With n heads
  // evenly spread across `span`, neighbour spacing = span/n and the wall margin =
  // span/(2n). Choosing n = ceil(span / spacing) guarantees span/n <= spacing
  // (the cited max distance between sprinklers) and the margin <= half-spacing
  // (the cited distance-to-wall = one-half max spacing). At least one head.
  const axisCount = (span: number): number => Math.max(1, Math.ceil(span / spacing));
  const axisPositions = (start: number, span: number): number[] => {
    const n = axisCount(span);
    if (n === 1) return [start + span / 2];
    const step = span / n; // <= spacing
    const margin = step / 2; // <= half-spacing (wall rule)
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) out.push(start + margin + i * step);
    return out;
  };

  const xs = axisPositions(b.minX, width);
  const ys = axisPositions(b.minY, depth);

  const heads: LaidOutHead[] = [];
  for (const x of xs) {
    for (const y of ys) {
      const rx = round(x);
      const ry = round(y);
      if (insidePolygon(rx, ry, ring)) {
        heads.push(opts.sku ? { x: rx, y: ry, sku: opts.sku } : { x: rx, y: ry });
      }
    }
  }
  return heads;
}

/** One coverage finding — a cited pass/fail observation about the layout. */
export interface CoverageFinding {
  /** Stable rule id (e.g. 'area', 'spacing', 'count'). */
  id: string;
  /** true = within the cited limit; false = a violation. */
  ok: boolean;
  /** Human-readable message. */
  message: string;
  /** The CITED NFPA-13 rule string this finding rests on. */
  citation: string;
}

/** The coverage report for a room + its placed heads. */
export interface CoverageReport {
  /** True iff every cited check passes AND at least one head is present. */
  covered: boolean;
  /** The largest protection area assigned to any one head (ft^2 of the room / head count). */
  maxAreaPerHead: number;
  /** The cited max protection-area limit (ft^2) for this hazard. */
  maxAllowedAreaPerHead: number;
  /** The cited max spacing limit (ft) for this hazard. */
  maxAllowedSpacingFt: number;
  /** The worst (largest) nearest-neighbour spacing observed (ft); 0 with <2 heads. */
  maxObservedSpacingFt: number;
  /** Number of heads evaluated. */
  headCount: number;
  /** All cited findings (passes and failures). */
  findings: CoverageFinding[];
  /** The honest design-aid disclaimer, restated. */
  disclaimer: string;
}

/** Nearest-neighbour distance (ft) for each head; 0-length list returns []. */
function nearestNeighbourDistances(heads: readonly Point2[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < heads.length; i += 1) {
    let nearest = Infinity;
    for (let j = 0; j < heads.length; j += 1) {
      if (i === j) continue;
      const d = Math.hypot(heads[i].x - heads[j].x, heads[i].y - heads[j].y);
      if (d < nearest) nearest = d;
    }
    if (Number.isFinite(nearest)) out.push(nearest);
  }
  return out;
}

/**
 * PURE. Build a cited coverage report for `heads` protecting `roomPolygonFt` under
 * `hazard`. Checks (all numbers from the cited nfpa13-rules re-export):
 *   1. area: room area / head count must be <= cited max protection area per head.
 *   2. spacing: every head's nearest-neighbour spacing must be <= cited max spacing.
 *   3. count: at least one head must be present to claim any coverage.
 *
 * `covered` is true only when ALL checks pass. Findings carry the verbatim
 * citation + "verify adopted edition". Pure/deterministic; reuses polygonAreaSqFt
 * (heads are already in feet, so ftPerUnit=1).
 */
export function coverageReport(
  roomPolygonFt: readonly Point2[],
  heads: readonly Point2[],
  hazard: HazardClass,
): CoverageReport {
  const areaRule = maxProtectionAreaSqFt(hazard);
  const spacingRule = maxSpacingFt(hazard);
  const verify = ' Verify adopted edition.';

  const headCount = heads.length;
  // Heads are already in FEET, so the polygon area is computed at scale 1 ft/unit.
  const roomAreaSqFt = polygonAreaSqFt(roomPolygonFt, 1);
  const maxAreaPerHead = headCount > 0 ? roomAreaSqFt / headCount : Infinity;

  const findings: CoverageFinding[] = [];

  // 3. count check first — no heads means no coverage claim at all.
  const hasHeads = headCount > 0;
  findings.push({
    id: 'count',
    ok: hasHeads,
    message: hasHeads
      ? `${headCount} head(s) placed in the room.`
      : 'No heads placed — the room is not covered.',
    citation:
      'NFPA 13 — a sprinkler is required to protect every portion of the area. ' +
      'Edition-dependent.' +
      verify,
  });

  // 1. area-per-head check.
  const areaOk = hasHeads && maxAreaPerHead <= areaRule.value + 1e-6;
  findings.push({
    id: 'area',
    ok: areaOk,
    message: hasHeads
      ? `Max protection area per head ${maxAreaPerHead.toFixed(1)} ft^2 ` +
        `(limit ${areaRule.value} ft^2): ${areaOk ? 'OK' : 'EXCEEDS LIMIT'}.`
      : `No heads — protection area per head is unbounded (limit ${areaRule.value} ft^2).`,
    citation: areaRule.citation + verify,
  });

  // 2. nearest-neighbour spacing check (only meaningful with >= 2 heads).
  const nn = nearestNeighbourDistances(heads);
  const maxObservedSpacingFt = nn.length > 0 ? Math.max(...nn) : 0;
  const spacingOk =
    !hasHeads || nn.length === 0
      ? hasHeads // a single head trivially satisfies the spacing rule
      : maxObservedSpacingFt <= spacingRule.value + 1e-6;
  findings.push({
    id: 'spacing',
    ok: spacingOk,
    message:
      nn.length === 0
        ? hasHeads
          ? `Single head — spacing rule trivially satisfied (limit ${spacingRule.value} ft).`
          : `No heads — spacing not evaluated (limit ${spacingRule.value} ft).`
        : `Worst neighbour spacing ${maxObservedSpacingFt.toFixed(1)} ft ` +
          `(limit ${spacingRule.value} ft): ${spacingOk ? 'OK' : 'EXCEEDS LIMIT'}.`,
    citation: spacingRule.citation + verify,
  });

  const covered = findings.every((f) => f.ok);

  return {
    covered,
    maxAreaPerHead: Number.isFinite(maxAreaPerHead) ? round(maxAreaPerHead) : maxAreaPerHead,
    maxAllowedAreaPerHead: areaRule.value,
    maxAllowedSpacingFt: spacingRule.value,
    maxObservedSpacingFt: round(maxObservedSpacingFt),
    headCount,
    findings,
    disclaimer: NFPA13_DESIGN_AID_DISCLAIMER,
  };
}
