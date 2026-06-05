// PURE sprinkler-layout logic — no React / three / DOM imports.
//
// Lays sprinkler heads onto a rectangular building footprint on a uniform grid,
// using NFPA 13 MAXIMUM spacing / coverage limits as a BEST-EFFORT heuristic to
// pick a grid that does not exceed those maxima. It then derives branch lines
// (along rows) plus a single cross-main.
//
// HONESTY (hard, fail-closed): this is a coarse VISUAL spacing heuristic, NOT a
// hydraulically-calculated, AHJ-approved, PE-sealed, or code-compliant design,
// and NOT for construction or permit. See LAYOUT_DISCLAIMER. We never claim NFPA
// compliance — the hazard maxima are upper bounds we stay under, nothing more.

export type HazardClass = 'light' | 'ordinary' | 'extra';

export const HAZARD_CLASSES: readonly HazardClass[] = [
  'light',
  'ordinary',
  'extra',
] as const;

/**
 * NFPA 13 MAXIMUM allowable distance between sprinklers, in feet, per hazard
 * class. Used here ONLY as an upper bound on grid spacing — NOT a guarantee of
 * compliance.
 *   light    15 ft
 *   ordinary 15 ft
 *   extra    12 ft
 */
export const HAZARD_MAX_SPACING_FT: Record<HazardClass, number> = {
  light: 15,
  ordinary: 15,
  extra: 12,
};

/**
 * NFPA 13 MAXIMUM protection area per sprinkler, in square feet, per hazard
 * class (standard-spray, unobstructed). Used here ONLY as an upper bound on the
 * per-head coverage of the chosen grid — NOT a guarantee of compliance.
 *   light    225 sqft
 *   ordinary 130 sqft
 *   extra    100 sqft
 */
export const HAZARD_MAX_COVERAGE_SQFT: Record<HazardClass, number> = {
  light: 225,
  ordinary: 130,
  extra: 100,
};

/** A single sprinkler head position on the floor, in feet, centered on origin. */
export interface HeadPosition {
  x: number;
  z: number;
}

/** A 2D line segment on the floor plane, endpoints in feet. */
export interface LineSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface LayoutResult {
  /** Head positions, in feet, centered on the origin (x,z). */
  heads: HeadPosition[];
  /** Number of grid rows (along the length / z axis). */
  rows: number;
  /** Number of grid columns (along the width / x axis). */
  cols: number;
  /** Uniform spacing used between heads, in feet (same on both axes). */
  spacingFt: number;
  /** Total head count == rows * cols. */
  count: number;
  /** Floor area each head covers under this grid, in square feet. */
  coveragePerHeadSqft: number;
}

export interface LayoutInput {
  widthFt: number;
  lengthFt: number;
  hazard: HazardClass;
}

/**
 * Pick the smallest integer count of heads along an axis such that the resulting
 * uniform spacing (length / count, with half-spacing edge offset) does not
 * exceed `maxSpacingFt`. Always returns at least 1.
 *
 *   spacing = length / count  (count heads each cover a length/count band,
 *   centered, so the first/last head sit half a spacing in from the edges).
 */
function countAlong(lengthFt: number, maxSpacingFt: number): number {
  if (lengthFt <= 0) return 1;
  // ceil(length / maxSpacing) is the fewest equal segments each <= maxSpacing.
  return Math.max(1, Math.ceil(lengthFt / maxSpacingFt));
}

/**
 * Lay heads on a uniform grid over a `widthFt` x `lengthFt` footprint such that
 * BOTH the per-axis spacing <= the hazard max spacing AND the per-head coverage
 * <= the hazard max coverage. Heads use a half-spacing edge offset and the whole
 * grid is centered on the origin. Deterministic for a given input.
 *
 * Spacing is uniform (the same value on both axes) — we take the tighter of the
 * two axis spacings so neither axis exceeds its band, then, if coverage
 * (spacing^2) still exceeds the hazard maximum, we tighten spacing further until
 * coverage is within the limit. This is a best-effort heuristic, NOT a
 * hydraulic calculation.
 */
export function layoutHeads({
  widthFt,
  lengthFt,
  hazard,
}: LayoutInput): LayoutResult {
  const maxSpacing = HAZARD_MAX_SPACING_FT[hazard];
  const maxCoverage = HAZARD_MAX_COVERAGE_SQFT[hazard];

  // Spacing implied by the coverage cap (square cell): sqrt(maxCoverage).
  const coverageSpacingCap = Math.sqrt(maxCoverage);
  // The binding upper bound on uniform spacing is the tighter of the two caps.
  const spacingCap = Math.min(maxSpacing, coverageSpacingCap);

  // Per-axis head counts so each axis spacing stays within the binding cap.
  const cols = countAlong(widthFt, spacingCap);
  const rows = countAlong(lengthFt, spacingCap);

  // Actual spacing per axis from those integer counts.
  const colSpacing = widthFt > 0 ? widthFt / cols : 0;
  const rowSpacing = lengthFt > 0 ? lengthFt / rows : 0;

  // Use a single uniform spacing = the tighter axis spacing (so neither axis
  // band, nor the square coverage cell, exceeds the caps). Falls back to the cap
  // for degenerate zero-size axes.
  const candidates = [colSpacing, rowSpacing].filter((s) => s > 0);
  const spacingFt = candidates.length ? Math.min(...candidates) : spacingCap;

  const coveragePerHeadSqft = spacingFt * spacingFt;

  // Centered grid with half-spacing edge offset.
  const heads: HeadPosition[] = [];
  const xStart = -((cols - 1) / 2) * spacingFt;
  const zStart = -((rows - 1) / 2) * spacingFt;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      heads.push({
        x: round(xStart + c * spacingFt),
        z: round(zStart + r * spacingFt),
      });
    }
  }

  return {
    heads,
    rows,
    cols,
    spacingFt: round(spacingFt),
    count: rows * cols,
    coveragePerHeadSqft: round(coveragePerHeadSqft),
  };
}

/**
 * Branch + cross-main lines for a laid-out grid.
 *
 *  - Branch lines: one per row, connecting that row's first head to its last
 *    head (a straight run along the +x axis at the row's z).
 *  - Cross-main: a single line running along the +z axis at x = 0 (the grid is
 *    centered on the origin), spanning the first row's z to the last row's z —
 *    the trunk the branch lines tap off of.
 *
 * Deterministic. Returns { branches, crossMain } as flat segment arrays.
 */
export function branchLines(layout: LayoutResult): {
  branches: LineSegment[];
  crossMain: LineSegment[];
} {
  const { rows, cols, spacingFt } = layout;
  const branches: LineSegment[] = [];

  const xStart = -((cols - 1) / 2) * spacingFt;
  const xEnd = ((cols - 1) / 2) * spacingFt;
  const zStart = -((rows - 1) / 2) * spacingFt;
  const zEnd = ((rows - 1) / 2) * spacingFt;

  // One branch line per row (skip degenerate single-column rows — no run).
  if (cols > 1) {
    for (let r = 0; r < rows; r += 1) {
      const z = round(zStart + r * spacingFt);
      branches.push({ x1: round(xStart), z1: z, x2: round(xEnd), z2: z });
    }
  }

  // Single cross-main down the centerline (x = 0), spanning all rows. For a
  // single-row grid there is nothing to trunk together, so emit none.
  const crossMain: LineSegment[] =
    rows > 1
      ? [{ x1: 0, z1: round(zStart), x2: 0, z2: round(zEnd) }]
      : [];

  return { branches, crossMain };
}

/** Round to 4 decimal places to keep output deterministic and tidy. */
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * HONESTY DISCLAIMER — shown verbatim in the Layout UI. This layout is a coarse,
 * best-effort VISUAL spacing heuristic only.
 */
export const LAYOUT_DISCLAIMER =
  'BEST-EFFORT VISUAL HEURISTIC ONLY. This sprinkler layout is a coarse spacing ' +
  'sketch. It is NOT a hydraulically-calculated design, NOT AHJ-approved, NOT ' +
  'PE-sealed, and NOT code-compliant. It is NOT for construction or permit. The ' +
  'hazard maxima are upper bounds the grid stays under — not a compliance ' +
  'guarantee. Heads are source="generated" visual references, not ' +
  'manufacturer-exact. Engage a licensed fire-protection engineer for any real ' +
  'design.';
