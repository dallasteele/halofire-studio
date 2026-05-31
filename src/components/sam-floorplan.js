/**
 * SAM 3.1 plan-segmentation adapter (T35).
 *
 * USER DIRECTIVE / sanctioned d4 path: OpenClaw uses a tool to READ the PDF plans
 * and segment them with SAM 3.1 to reconstruct the building and every layer. T31-T34
 * proved that vector/lineweight parsing CANNOT cleanly isolate the building from an
 * annotated CAD sheet (dimension witness-lines, leaders, hatching, title block and
 * detail drawings all live in the same vector layer). SAM 3.1 segments the RENDERED
 * plan IMAGE instead — it sees the drawing the way a human estimator does — so it can
 * isolate the building outline / walls / rooms as visual masks.
 *
 * Flow: pdfRef -> OpenClaw PDF-read tool renders the page to an image -> SAM 3.1
 * segments it -> masks/polygons come back. SAM 3.1 + the OpenClaw governed bridge run
 * EXTERNALLY (on GX10), so this module never calls them directly. It builds a
 * deterministic request payload and hands it to an INJECTED async `invoker(payload)`
 * that production wires to the bridge (auto-source-runner.js makeBridgeInvoker ->
 * OPENCLAW_BRIDGE_URL/codex-bridge/invoke). That keeps the adapter fully unit-testable
 * offline — identical to how T18 sam-reconstruct.js + the S1-S3 auto-source sourcers
 * were built with mocks while OpenClaw was down.
 *
 * REACHABILITY: the OpenClaw bridge is CURRENTLY HTTP_UNREACHABLE (same state as task
 * S5). A real SAM segmentation + d4 re-measure is therefore DEFERRED until the bridge
 * is reachable. This module degrades fail-soft; the tests use a mock. No real SAM run
 * is claimed here.
 *
 * HONESTY / fail-closed:
 *   - A SAM mask/polygon is REAL segmentation when the bridge runs — it is NEVER
 *     fabricated here. The returned `label` says the result is best-effort and confers
 *     NO AHJ/PE/AutoSprink/manufacturer parity.
 *   - If the invoker is absent / not a function (no bridge wired) OR throws (OpenClaw /
 *     GX10 / gateway down) OR yields an empty result / no building_outline polygon, we
 *     fail closed to { ok:false, skipped:true, reason } WITHOUT throwing and WITHOUT
 *     inventing a polygon. A missing segmentation stays missing (the caller may fall
 *     back to the vector path).
 *   - The image-pixel -> feet `scale` is OPERATOR/DRAWING-supplied (read from the sheet
 *     scale label, like floorPlanFromPdf). reconstructFloorPlanFromSam THROWS if it is
 *     absent or non-positive — a scale is NEVER guessed.
 *
 * Pure request-building + injected async I/O; browser-free; no network or process is
 * spawned here.
 */

import { polygonArea } from '../engine/sprinkler-layout.js';

/** SAM 3.1 layer targets requested by default (building + its layers). */
const DEFAULT_TARGETS = Object.freeze(['building_outline', 'walls', 'rooms', 'layers']);

/** Honesty label stamped on every successful segmentation. */
const BEST_EFFORT_LABEL =
  'best-effort SAM 3.1 plan segmentation — NOT AHJ/PE/AutoSprink/manufacturer parity';

/** Honest reconstruction note (best-effort approximation, not AHJ/PE). */
const RECON_NOTE =
  'Best-effort SAM 3.1 plan-segmentation reconstruction (T35): the building outline ' +
  'polygon is a VISUAL segmentation mask of the rendered plan page, scaled to feet by ' +
  'the operator/drawing-supplied pixel->feet scale (never guessed). It is a BEST-EFFORT ' +
  'APPROXIMATION of the building footprint — NOT a precise outline, NOT a room ' +
  'segmentation guarantee, and NOT an AHJ/PE/AutoSprink/manufacturer-parity drawing. ' +
  'Other SAM layers (walls/rooms/MEP/etc.) are carried in layerMap for future per-layer ' +
  'use. Deterministic given the segmentation + scale.';

/**
 * PURE. Build the deterministic request payload for the GX10 SAM 3.1 plan-segmentation
 * service (reached through the OpenClaw governed bridge).
 *
 * @param {{pdfRef:(string), pageIndex?:number, scale?:number, targets?:string[]}} args
 *   pdfRef   - path/URL/id the OpenClaw PDF-read tool resolves (it renders that page to
 *              an image, then SAM 3.1 segments it).
 *   pageIndex- 0-based page index (default 0).
 *   scale    - feet per image pixel (operator/drawing-derived); carried for the service.
 *   targets  - layer targets to segment (default DEFAULT_TARGETS).
 * @returns {{service:string, op:string, pdfRef:(string|null), pageIndex:number,
 *   scale:(number|null), targets:string[]}}
 *
 * Deterministic: same inputs always yield the same object.
 */
export function buildPlanSegmentationPayload({ pdfRef, pageIndex = 0, scale, targets } = {}) {
  const idx = Number.isInteger(pageIndex) ? pageIndex : 0;
  const tg = Array.isArray(targets) && targets.length ? targets.slice() : DEFAULT_TARGETS.slice();
  return {
    service: 'sam-3.1',
    op: 'segment_floorplan',
    pdfRef: pdfRef == null ? null : String(pdfRef),
    pageIndex: idx,
    scale: Number.isFinite(scale) ? Number(scale) : null,
    targets: tg,
  };
}

/** A polygon is usable only as a closed ring of >= 3 [x,y] points. */
function isUsablePolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return false;
  return poly.every(
    (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  );
}

/**
 * Extract the segmentation layers from a raw invoker result. SAM may return the layers
 * at the top level ({ building_outline, walls, ... }) or nested under `layers`. Returns
 * a merged layers object, or null when nothing usable is present.
 */
function layersOf(raw) {
  if (raw == null || typeof raw !== 'object') return null;
  const nested = raw.layers && typeof raw.layers === 'object' ? raw.layers : null;
  // Top-level layer keys (excluding the envelope fields) merged with the nested map.
  const merged = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'layers' || k === 'imageSize' || k === 'ok' || k === 'source' || k === 'label') {
      continue;
    }
    merged[k] = v;
  }
  if (nested) Object.assign(merged, nested);
  return Object.keys(merged).length ? merged : null;
}

/** A segmentation counts as usable iff it has a real building_outline OR a non-empty layers map. */
function isUsableSegmentation(layers) {
  if (!layers) return false;
  if (isUsablePolygon(layers.building_outline)) return true;
  // A non-empty layers map with at least one non-empty layer ALSO counts — but a
  // building_outline that failed isUsablePolygon (e.g. a degenerate < 3-point ring)
  // must NOT rescue itself through the generic array-length check below.
  return Object.entries(layers).some(([k, v]) => {
    if (k === 'building_outline') return false;
    if (isUsablePolygon(v)) return true;
    return Array.isArray(v) && v.length > 0;
  });
}

/**
 * Segment a floor plan via SAM 3.1 (through the injected OpenClaw bridge invoker).
 *
 * Builds the payload and calls the INJECTED async `invoker(payload)` (production wires
 * the OpenClaw governed bridge -> GX10 SAM 3.1). On a usable result (a real
 * building_outline polygon, OR a non-empty layers map) returns the carried layers with
 * a best-effort honesty label. On ANY failure mode it skips gracefully WITHOUT throwing
 * and WITHOUT fabricating a mask/polygon.
 *
 * @param {{invoker?:(payload:object)=>Promise<unknown>, pdfRef?:string, pageIndex?:number,
 *   scale?:number, targets?:string[]}} [args]
 * @returns {Promise<
 *   {ok:true, source:'sam-3.1', layers:object, imageSize?:object, label:string} |
 *   {ok:false, skipped:true, reason:string}
 * >}
 */
export async function segmentFloorPlanViaSam(args = {}) {
  const { invoker, pdfRef, pageIndex, scale, targets } = args || {};
  if (typeof invoker !== 'function') {
    return { ok: false, skipped: true, reason: 'sam_invoker_unavailable' };
  }

  const payload = buildPlanSegmentationPayload({ pdfRef, pageIndex, scale, targets });

  let raw;
  try {
    raw = await invoker(payload);
  } catch (err) {
    const reason = err && err.message ? `sam_invoke_failed: ${err.message}` : 'sam_invoke_failed';
    return { ok: false, skipped: true, reason };
  }

  const layers = layersOf(raw);
  if (!isUsableSegmentation(layers)) {
    return { ok: false, skipped: true, reason: 'sam_empty_segmentation' };
  }

  const result = {
    ok: true,
    source: 'sam-3.1',
    layers,
    label: BEST_EFFORT_LABEL,
  };
  if (raw && typeof raw === 'object' && raw.imageSize && typeof raw.imageSize === 'object') {
    result.imageSize = raw.imageSize;
  }
  return result;
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

function bboxOf(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    minX: round(minX),
    minY: round(minY),
    maxX: round(maxX),
    maxY: round(maxY),
    widthFt: round(maxX - minX),
    heightFt: round(maxY - minY),
  };
}

/**
 * Reconstruct a floor plan from a SAM 3.1 segmentation result.
 *
 * Scales the SAM building_outline polygon from IMAGE PIXELS to FEET using `scale` (feet
 * per pixel — operator/drawing-derived, NEVER guessed). The scaled polygon becomes
 * rooms[0].polygon (consumed by layoutRoom); areaSqft is its shoelace area; layerMap
 * carries every OTHER SAM layer (walls/rooms/MEP/etc.) for future per-layer use.
 *
 * THROWS when `scale` is missing or non-positive, exactly like floorPlanFromPdf — a
 * scale is never invented. Also throws when the segmentation lacks a usable
 * building_outline polygon (nothing to reconstruct from honestly).
 *
 * @param {{ok?:boolean, layers?:object, imageSize?:object}} samResult - from segmentFloorPlanViaSam.
 * @param {{scale:number, hazard?:string}} opts - scale = feet per pixel (REQUIRED, > 0).
 * @returns {{rooms:Array<{name:string, polygon:Array<[number,number]>, hazard:string}>,
 *   bbox:object, areaSqft:number, layerMap:object, note:string, imageSize?:object}}
 */
export function reconstructFloorPlanFromSam(samResult, opts = {}) {
  const scale = Number(opts.scale);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(
      'reconstructFloorPlanFromSam: a positive image `scale` (feet per pixel) is REQUIRED — ' +
      'it is operator/drawing-derived (read from the sheet scale label, like floorPlanFromPdf) ' +
      'and is never guessed. Provide the plan scale, e.g. scale=0.1 for 1px=0.1ft.',
    );
  }
  const hazard = opts.hazard ? String(opts.hazard).toLowerCase() : 'ordinary';

  const layers = samResult && samResult.layers ? samResult.layers : null;
  const outlinePx = layers && layers.building_outline;
  if (!isUsablePolygon(outlinePx)) {
    throw new Error(
      'reconstructFloorPlanFromSam: SAM result has no usable building_outline polygon to ' +
      'reconstruct from — nothing is fabricated. Re-run SAM segmentation when the bridge is reachable.',
    );
  }

  // Scale the px polygon to feet.
  const polygon = outlinePx.map(([x, y]) => [round(x * scale), round(y * scale)]);
  const bbox = bboxOf(polygon);
  const areaSqft = round(polygonArea(polygon));

  // Carry every other SAM layer (not the outline we just consumed) for future use.
  const layerMap = {};
  for (const [k, v] of Object.entries(layers)) {
    if (k === 'building_outline') continue;
    layerMap[k] = v;
  }

  const out = {
    rooms: [{ name: 'SAM Segmented Building Outline', polygon, hazard }],
    bbox,
    areaSqft,
    layerMap,
    note: RECON_NOTE,
  };
  if (samResult && samResult.imageSize) out.imageSize = samResult.imageSize;
  return out;
}
