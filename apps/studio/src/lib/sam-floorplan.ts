// T48 — BUILDING raster-FALLBACK lane (SAM segmentation, 2D MASK ONLY).
//
// This is the FALLBACK for SCANNED / RASTER plans that have NO vector layer (T47
// pdf-building.ts handles real VECTOR PDFs). SAM (Segment Anything) produces a 2D
// MASK ONLY — it is NOT a 3D reconstruction. We turn the mask's building_outline
// into a polygon footprint and REUSE the T47 footprint->3D path (FootprintResult +
// BuildingScene), so the studio renders the SAM-segmented building exactly like the
// vector one — just labeled raster-segmented, never vector-exact.
//
// This is a PURE, unit-testable TypeScript port of the PROVEN injectable pattern in
// apps/autosprink/src/components/sam-floorplan.js (buildPlanSegmentationPayload,
// segmentFloorPlanViaSam with an INJECTED invoker, reconstructFloorPlanFromSam).
// Everything here is deterministic EXCEPT the single INJECTED async invoker; there is
// NO React, NO three, NO network, NO process spawn in this module.
//
// HONESTY (hard, fail-closed):
//   - SAM is SEGMENTATION ONLY: a 2D mask, NOT a 3D model.
//   - A SAM mask/polygon is REAL segmentation ONLY when a real invoker runs it — it is
//     NEVER fabricated here. Every unavailable/empty path returns
//     { ok:false, skipped:true, reason } with NO outline and NO polygon. A missing
//     segmentation stays missing (the operator falls back to the vector lane).
//   - The image-pixel -> feet `scaleFtPerPx` is OPERATOR-supplied (read from the sheet
//     scale label). reconstructFootprintFromSam THROWS if it is missing or <= 0 — a
//     scale is NEVER guessed.
//   - A SAM-derived footprint is labeled RASTER-SEGMENTED — NOT vector-exact, NOT
//     AHJ / PE-sealed / code-compliant / for construction. No parity is claimed.

import type { FootprintResult } from './pdf-building';

/* ------------------------------------------------------------------ types */

/** A point in image-pixel space [x, y]. */
export type PixelPoint = [number, number];

/** A point in feet [x, y]. */
export type FeetPoint = [number, number];

/**
 * Raw result shape the INJECTED invoker resolves to. SAM may return the
 * building_outline mask at the top level or nested under `layers`. Coordinates are
 * image PIXELS (closed/open ring of [x, y] points). Everything is optional /
 * unknown-shaped because it crosses an external boundary; we validate before use.
 */
export interface SamResult {
  ok?: boolean;
  source?: string;
  label?: string;
  building_outline?: unknown;
  layers?: { building_outline?: unknown; [k: string]: unknown } | null;
  imageSize?: { width?: number; height?: number } | null;
  [k: string]: unknown;
}

/** The deterministic request payload handed to the injected invoker. */
export interface SamPayload {
  tool: 'sam_segment_floorplan';
  op: 'segment_floorplan';
  imageRef: string | null;
  scaleFtPerPx: number | null;
  targets: string[];
}

/** Single-arg async invoker, INJECTED. Default undefined => SAM disabled. */
export type SamInvoker = (payload: SamPayload) => Promise<SamResult>;

/** Args for buildSamPayload. */
export interface BuildSamPayloadArgs {
  /** Path/URL/id the SAM service resolves to a rasterized plan image. */
  imageRef?: string | null;
  /** Feet per image pixel (operator-supplied); carried for the service. */
  scaleFtPerPx?: number;
  /** Layer targets to segment (default ['building_outline']). */
  targets?: string[];
}

/** Args for segmentFloorPlanViaSam. */
export interface SegmentArgs {
  /** INJECTED async invoker. Default undefined => SAM disabled (skipped). */
  invoker?: SamInvoker;
  /** Prebuilt payload (preferred), or the fields to build one from. */
  payload?: SamPayload;
  imageRef?: string | null;
  scaleFtPerPx?: number;
  targets?: string[];
}

/** Success shape of segmentFloorPlanViaSam (a 2D mask outline, never 3D). */
export interface SamSegmentationOk {
  ok: true;
  source: 'sam-3';
  /** Building outline as a closed ring of image-pixel points. */
  outlinePx: PixelPoint[];
  label: string;
}

/** Fail-soft shape: SAM unavailable / empty / degenerate — NO outline, NO polygon. */
export interface SamSegmentationSkipped {
  ok: false;
  skipped: true;
  reason: string;
}

export type SamSegmentationResult = SamSegmentationOk | SamSegmentationSkipped;

/** Options for reconstructFootprintFromSam. */
export interface ReconstructOpts {
  /** Feet per image pixel. REQUIRED, must be > 0. Operator-supplied, NEVER guessed. */
  scaleFtPerPx: number;
}

/* ----------------------------------------------------------------- consts */

/** Default segmentation targets — the building outline mask is all we consume. */
const DEFAULT_TARGETS = Object.freeze(['building_outline']);

/** Honesty label stamped on every successful SAM segmentation. */
export const SAM_BEST_EFFORT_LABEL =
  'best-effort SAM raster-plan segmentation (2D MASK ONLY, not 3D) — NOT vector-exact, ' +
  'NOT AHJ / PE-sealed / code-compliant / for construction';

/** Honesty note stamped on every SAM-derived footprint. */
export const SAM_FOOTPRINT_NOTE =
  'BEST-EFFORT SAM RASTER SEGMENTATION (T48): this building footprint is the OUTLINE of ' +
  'a 2D SAM segmentation MASK of a SCANNED / RASTER plan image (the fallback for plans ' +
  'with no vector layer; vector PDFs use the T47 vector lane). SAM is SEGMENTATION ONLY ' +
  '— a 2D mask, NOT a 3D model. The pixel->feet scale is OPERATOR-supplied and is NEVER ' +
  'guessed. It is RASTER-SEGMENTED — NOT vector-exact, NOT AHJ-approved, NOT PE-sealed, ' +
  'NOT code-compliant, and NOT a permit / for-construction drawing. No accuracy or ' +
  'parity is claimed. Deterministic given the mask + scale.';

/* ----------------------------------------------------------------- utils */

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

/** A polygon is usable only as a ring of >= 3 finite [x, y] points. */
function isUsablePolygon(poly: unknown): poly is PixelPoint[] {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  return poly.every(
    (p) =>
      Array.isArray(p) &&
      p.length >= 2 &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1]),
  );
}

/**
 * Extract the building_outline pixel ring from a raw SAM result. SAM may put it at
 * the top level or nested under `layers`. Returns the usable ring, or null.
 */
function outlineOf(raw: SamResult | null | undefined): PixelPoint[] | null {
  if (raw == null || typeof raw !== 'object') return null;
  const top = (raw as { building_outline?: unknown }).building_outline;
  if (isUsablePolygon(top)) return top;
  const nested = raw.layers && typeof raw.layers === 'object' ? raw.layers.building_outline : null;
  if (isUsablePolygon(nested)) return nested;
  return null;
}

/** Shoelace area (absolute) of a closed polygon. Same helper used for the footprint. */
function shoelaceArea(poly: FeetPoint[]): number {
  const n = poly.length;
  if (n < 3) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    acc += x1 * y2 - x2 * y1;
  }
  return Math.abs(acc) / 2;
}

function bboxOf(poly: FeetPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/* ------------------------------------------------------ buildSamPayload */

/**
 * PURE. Build the deterministic request payload for the SAM raster-segmentation
 * service. Same inputs always yield the same object. Carries the operator scale for
 * the service but does NOT validate it here (validation happens at reconstruct time,
 * where a missing scale THROWS — mirroring the vector lane).
 */
export function buildSamPayload({
  imageRef,
  scaleFtPerPx,
  targets,
}: BuildSamPayloadArgs = {}): SamPayload {
  const tg = Array.isArray(targets) && targets.length ? targets.slice() : DEFAULT_TARGETS.slice();
  return {
    tool: 'sam_segment_floorplan',
    op: 'segment_floorplan',
    imageRef: imageRef == null ? null : String(imageRef),
    scaleFtPerPx: Number.isFinite(scaleFtPerPx) ? Number(scaleFtPerPx) : null,
    targets: tg,
  };
}

/* --------------------------------------------------- segmentFloorPlanViaSam */

/**
 * Segment a RASTER floor plan via SAM through the INJECTED async invoker.
 *
 * On a usable SAM building_outline mask returns
 *   { ok:true, source:'sam-3', outlinePx:[[x,y]...], label } (a 2D mask outline).
 * On ANY failure mode — invoker absent / not a function / throws / empty result /
 * no building_outline / degenerate (< 3 points) — returns
 *   { ok:false, skipped:true, reason } with NO outline.
 * It NEVER fabricates a mask or polygon. A missing segmentation stays missing.
 */
export async function segmentFloorPlanViaSam(
  args: SegmentArgs = {},
): Promise<SamSegmentationResult> {
  const { invoker } = args || {};
  if (typeof invoker !== 'function') {
    return { ok: false, skipped: true, reason: 'sam_invoker_unavailable' };
  }

  const payload =
    args.payload ??
    buildSamPayload({
      imageRef: args.imageRef,
      scaleFtPerPx: args.scaleFtPerPx,
      targets: args.targets,
    });

  let raw: SamResult;
  try {
    raw = await invoker(payload);
  } catch (err) {
    const msg = err instanceof Error && err.message ? `: ${err.message}` : '';
    return { ok: false, skipped: true, reason: `sam_invoke_failed${msg}` };
  }

  if (raw == null || typeof raw !== 'object') {
    return { ok: false, skipped: true, reason: 'sam_empty_segmentation' };
  }

  const outlinePx = outlineOf(raw);
  if (!outlinePx) {
    // Either no building_outline at all, or a degenerate (< 3 point) ring.
    return { ok: false, skipped: true, reason: 'sam_no_building_outline' };
  }

  return {
    ok: true,
    source: 'sam-3',
    outlinePx: outlinePx.map(([x, y]) => [x, y] as PixelPoint),
    label: SAM_BEST_EFFORT_LABEL,
  };
}

/* ------------------------------------------- reconstructFootprintFromSam */

/**
 * Reconstruct a FootprintResult from a SAM segmentation result, REUSING the T47
 * FootprintResult shape so it renders through the SAME BuildingScene path.
 *
 * Scales the SAM building_outline mask from IMAGE PIXELS to FEET using
 * `scaleFtPerPx` (operator-supplied, NEVER guessed). areaSqft is the shoelace area of
 * the scaled outline. method is 'sam-raster' (provenance: raster-segmented, NOT
 * vector-exact).
 *
 * THROWS when scaleFtPerPx is missing or <= 0 — a scale is never invented. When the
 * samResult is skipped (or carries no usable outline), returns the HONEST empty /
 * skipped footprint (empty:true, NO polygon) — it NEVER fabricates a footprint.
 */
export function reconstructFootprintFromSam(
  samResult: SamSegmentationResult | null | undefined,
  opts: ReconstructOpts,
): FootprintResult {
  const scaleFtPerPx = Number(opts?.scaleFtPerPx);
  if (!Number.isFinite(scaleFtPerPx) || scaleFtPerPx <= 0) {
    throw new Error(
      'reconstructFootprintFromSam: a positive `scaleFtPerPx` (feet per image pixel) is ' +
        'REQUIRED — it is operator-supplied (read from the sheet scale label) and is NEVER ' +
        'guessed. Provide the plan scale, e.g. scaleFtPerPx=0.1 for 1px=0.1ft.',
    );
  }

  // Honest empty/skipped footprint: NO polygon, never fabricated.
  if (!samResult || samResult.ok !== true) {
    return {
      outline: [],
      bboxFt: { w: 0, l: 0 },
      areaSqft: 0,
      wallSegmentCount: 0,
      networkSegmentCount: 0,
      method: 'sam-raster-skipped',
      note: SAM_FOOTPRINT_NOTE,
      empty: true,
    };
  }

  // Scale the px outline -> feet.
  const outline: FeetPoint[] = samResult.outlinePx.map(
    ([x, y]) => [round(x * scaleFtPerPx), round(y * scaleFtPerPx)] as FeetPoint,
  );
  const bb = bboxOf(outline);
  const areaSqft = round(shoelaceArea(outline));

  return {
    outline,
    bboxFt: { w: round(bb.maxX - bb.minX), l: round(bb.maxY - bb.minY) },
    areaSqft,
    wallSegmentCount: outline.length,
    networkSegmentCount: outline.length,
    method: 'sam-raster',
    note: SAM_FOOTPRINT_NOTE,
    empty: false,
  };
}
