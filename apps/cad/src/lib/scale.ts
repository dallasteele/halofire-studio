// HaloFire CAD — PURE scale + measurement math (no React / three / DOM / pdfjs).
//
// This is the OPERATOR-VERIFIABLE scale that fixes the blind-scale failure: rather
// than guessing a magic feet-per-point from geometry (the old deterministic vector
// path overshot real sets by 4.62x), the operator clicks two points on the plan
// whose real-world separation they KNOW (from a dimension string, a grid line, a
// door width, the title-block scale bar), types that known distance in feet, and we
// solve ftPerUnit = knownFeet / pixelDistance. Everything downstream (measureFeet,
// polygonAreaSqFt) is then a deterministic consequence of that one verified datum.
//
// HONESTY: nothing here invents a scale. setScaleFromTwoPoints REQUIRES the operator
// to supply knownFeet, and THROWS on a degenerate (zero-length) reference or a
// non-positive known distance — it never silently fabricates a factor.

import type { Point2 } from './model';

/** Euclidean distance between two plan-space points, in model units. */
export function distanceUnits(p1: Point2, p2: Point2): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * PURE. Derive feet-per-unit from a two-point reference whose real separation the
 * operator KNOWS. p1/p2 are the two clicked plan-space points (model units);
 * knownFeet is the real-world distance between them in feet.
 *
 *   ftPerUnit = knownFeet / |p2 - p1|
 *
 * Example: two points 100 units apart that the operator knows are 25 ft apart
 * -> 25 / 100 = 0.25 ft/unit.
 *
 * THROWS if the reference points coincide (no measurable distance) or knownFeet is
 * not a positive finite number — the scale is operator-supplied and verifiable, so a
 * bad input is a hard error, never a guessed fallback.
 */
export function setScaleFromTwoPoints(
  p1: Point2,
  p2: Point2,
  knownFeet: number,
): number {
  if (!Number.isFinite(knownFeet) || knownFeet <= 0) {
    throw new Error(
      'setScaleFromTwoPoints: knownFeet must be a positive finite number (the real ' +
        'distance, in feet, between the two reference points). The scale is ' +
        'operator-supplied and verifiable — it is never guessed.',
    );
  }
  const units = distanceUnits(p1, p2);
  if (!Number.isFinite(units) || units <= 0) {
    throw new Error(
      'setScaleFromTwoPoints: the two reference points coincide (zero pixel ' +
        'distance) — pick two distinct points to define the scale.',
    );
  }
  return knownFeet / units;
}

/**
 * PURE. Measure the real-world distance in feet between two plan-space points given
 * a known ftPerUnit. Returns 0 for a degenerate (missing/non-positive) scale rather
 * than throwing — a measurement readout should show 0 ft, not crash, before a scale
 * is set.
 */
export function measureFeet(p1: Point2, p2: Point2, ftPerUnit: number): number {
  if (!Number.isFinite(ftPerUnit) || ftPerUnit <= 0) return 0;
  return distanceUnits(p1, p2) * ftPerUnit;
}

/**
 * PURE. Signed polygon area in square model units via the shoelace formula. The
 * sign encodes winding (positive = CCW in a y-up frame); callers usually want the
 * absolute value (polygonAreaSqFt). Returns 0 for fewer than 3 points.
 */
export function shoelaceAreaUnits(points: readonly Point2[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/**
 * PURE. Closed-polygon area in SQUARE FEET: |shoelace area| * ftPerUnit^2. Returns 0
 * for a degenerate polygon (<3 points) or a missing/non-positive scale — an honest
 * "no area yet" rather than a fabricated number.
 */
export function polygonAreaSqFt(
  points: readonly Point2[],
  ftPerUnit: number,
): number {
  if (!Number.isFinite(ftPerUnit) || ftPerUnit <= 0) return 0;
  const areaUnits = Math.abs(shoelaceAreaUnits(points));
  return areaUnits * ftPerUnit * ftPerUnit;
}
