/**
 * T28 — Vector-PDF floor-plan ingestion.
 *
 * The real bid plan sets the user supplied for The Cooperative 1881 Apartments
 * (and similar GC jobs) ship as VECTOR PDFs authored in Bluebeam Revu — there are
 * NO DXF/DWG. This module extracts building floor-plan geometry from such a PDF so
 * it can feed the EXISTING OpenGeometry layout/auto-bid pipeline, mirroring the
 * T21 SVG/DXF path.
 *
 * Design: a PURE, unit-testable core (no I/O, no pdfjs runtime) plus a thin async
 * pdfjs wrapper. The pure core walks a pdfjs operator list ({fnArray, argsArray}
 * from page.getOperatorList()) and emits line segments; it then reduces them to a
 * bbox-footprint floor plan.
 *
 * HONESTY (fail-closed):
 *  - The extracted geometry is REAL — it is the plan's own vector path ops, never
 *    fabricated.
 *  - The PDF-point -> feet `scale` (feet per PDF point) is OPERATOR-SUPPLIED. We
 *    NEVER guess or auto-derive a scale; floorPlanFromPdf THROWS if it is absent or
 *    non-positive, exactly like an operator-supplied CAD import unit.
 *  - The room polygon returned is the bbox of the extracted extents — an honest
 *    FIRST-PASS approximation of the plan geometry, explicitly NOT a full room
 *    segmentation and NOT an AHJ/PE/accurate drawing.
 *  - Nothing here flips a claim gate or asserts parity/accuracy.
 *
 * pdfjs operator-list shapes handled for path construction:
 *  - Legacy top-level ops: OPS.moveTo [x,y], OPS.lineTo [x,y], OPS.curveTo
 *    [x1,y1,x2,y2,x,y] (approximated by its endpoint), OPS.rectangle [x,y,w,h]
 *    (4 segments), OPS.closePath [] (connect back to subpath start).
 *  - Legacy batched OPS.constructPath args = [opsArray, coordsArray]: iterate the
 *    sub-ops, each moveTo/lineTo consuming 2 coords, curveTo 6 (endpoint), and a
 *    rectangle sub-op consuming 4 coords (4 segments).
 *  - Modern (pdfjs v6) batched OPS.constructPath args = [opType, [pathBuffer],
 *    minMax]: pathBuffer is a flat DrawOPS-coded typed array where 0=moveTo (2
 *    coords), 1=lineTo (2), 2=curveTo (6, endpoint), 3=quadraticCurveTo (4,
 *    endpoint), 4=closePath (0).
 * Text/image/other ops are ignored.
 */

import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

// pdfjs-internal DrawOPS codes for the v6 constructPath path buffer. These are a
// stable wire contract of the operator list (see pdf.worker buildPath); mirrored
// here as documented constants so the pure core needs no worker import.
const DRAW_OP = Object.freeze({
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
});
// Coords consumed by each DrawOPS code (closePath consumes none).
const DRAW_OP_ARITY = Object.freeze({
  [DRAW_OP.moveTo]: 2,
  [DRAW_OP.lineTo]: 2,
  [DRAW_OP.curveTo]: 6,
  [DRAW_OP.quadraticCurveTo]: 4,
  [DRAW_OP.closePath]: 0,
});

function round(n) {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

/**
 * PURE. Walk a pdfjs operator list and emit line segments in FEET.
 *
 * @param {{fnArray:number[], argsArray:any[]}} opList - from page.getOperatorList()
 * @param {{scale?:number}} [opts] - scale = feet per PDF point (default 1).
 * @returns {{segments:Array<{x1,y1,x2,y2}>, bbox:{minX,minY,maxX,maxY,widthFt,heightFt}, count:number}}
 */
export function extractSegmentsFromOpList(opList, opts = {}) {
  const scale = Number.isFinite(opts.scale) ? Number(opts.scale) : 1;
  const fnArray = (opList && opList.fnArray) || [];
  const argsArray = (opList && opList.argsArray) || [];

  const segments = [];
  // Path state, in PDF points (scaled to feet only at emit time).
  let cur = null; // current point [x, y]
  let start = null; // current subpath start [x, y]

  const emit = (x1, y1, x2, y2) => {
    segments.push({
      x1: round(x1 * scale),
      y1: round(y1 * scale),
      x2: round(x2 * scale),
      y2: round(y2 * scale),
    });
  };
  const moveTo = (x, y) => {
    cur = [x, y];
    start = [x, y];
  };
  const lineTo = (x, y) => {
    if (cur) emit(cur[0], cur[1], x, y);
    else start = [x, y];
    cur = [x, y];
  };
  const closePath = () => {
    if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) {
      emit(cur[0], cur[1], start[0], start[1]);
    }
    if (start) cur = [start[0], start[1]];
  };
  const rectangle = (x, y, w, h) => {
    // Emit the 4 closed edges; leaves current point at the rect origin.
    moveTo(x, y);
    lineTo(x + w, y);
    lineTo(x + w, y + h);
    lineTo(x, y + h);
    closePath();
  };

  // Consume a flat DrawOPS-coded path buffer (pdfjs v6 constructPath form).
  const walkDrawBuffer = (buf) => {
    let i = 0;
    const n = buf.length;
    while (i < n) {
      const code = buf[i] | 0;
      const arity = DRAW_OP_ARITY[code];
      if (arity === undefined) break; // unknown code -> stop (defensive)
      const a = buf;
      switch (code) {
        case DRAW_OP.moveTo:
          moveTo(a[i + 1], a[i + 2]);
          break;
        case DRAW_OP.lineTo:
          lineTo(a[i + 1], a[i + 2]);
          break;
        case DRAW_OP.curveTo: // [x1,y1,x2,y2,x,y] -> endpoint
          lineTo(a[i + 5], a[i + 6]);
          break;
        case DRAW_OP.quadraticCurveTo: // [x1,y1,x,y] -> endpoint
          lineTo(a[i + 3], a[i + 4]);
          break;
        case DRAW_OP.closePath:
          closePath();
          break;
        default:
          break;
      }
      i += 1 + arity;
    }
  };

  // Consume a legacy [opsArray, coordsArray] constructPath batch (older pdfjs).
  const walkLegacyConstructPath = (subOps, coords) => {
    let c = 0;
    for (const sub of subOps) {
      switch (sub) {
        case OPS.moveTo:
          moveTo(coords[c], coords[c + 1]);
          c += 2;
          break;
        case OPS.lineTo:
          lineTo(coords[c], coords[c + 1]);
          c += 2;
          break;
        case OPS.curveTo: // 6 coords, endpoint
          lineTo(coords[c + 4], coords[c + 5]);
          c += 6;
          break;
        case OPS.curveTo2: // 4 coords, endpoint at [2],[3]
        case OPS.curveTo3:
          lineTo(coords[c + 2], coords[c + 3]);
          c += 4;
          break;
        case OPS.rectangle:
          rectangle(coords[c], coords[c + 1], coords[c + 2], coords[c + 3]);
          c += 4;
          break;
        case OPS.closePath:
          closePath();
          break;
        default:
          break;
      }
    }
  };

  for (let k = 0; k < fnArray.length; k++) {
    const fn = fnArray[k];
    const args = argsArray[k] || [];
    switch (fn) {
      case OPS.moveTo:
        moveTo(args[0], args[1]);
        break;
      case OPS.lineTo:
        lineTo(args[0], args[1]);
        break;
      case OPS.curveTo:
        lineTo(args[4], args[5]);
        break;
      case OPS.curveTo2:
      case OPS.curveTo3:
        lineTo(args[2], args[3]);
        break;
      case OPS.rectangle:
        rectangle(args[0], args[1], args[2], args[3]);
        break;
      case OPS.closePath:
        closePath();
        break;
      case OPS.constructPath:
        constructPathDispatch(args, walkDrawBuffer, walkLegacyConstructPath);
        break;
      default:
        break; // ignore text/image/state ops
    }
  }

  const bbox = boundingBox(segments);
  return { segments, bbox, count: segments.length };
}

// Decide which constructPath shape we got and dispatch.
function constructPathDispatch(args, walkDrawBuffer, walkLegacyConstructPath) {
  // v6 form: [opType:number, [pathBuffer:TypedArray], minMax?]
  // legacy form: [opsArray:number[], coordsArray:number[]]
  const a0 = args[0];
  const a1 = args[1];
  if (Array.isArray(a1) && a1[0] && typeof a1[0] !== 'number' && typeof a1[0].length === 'number') {
    // a1 is [TypedArray] — modern v6 packed path buffer.
    walkDrawBuffer(a1[0]);
    return;
  }
  if (Array.isArray(a0) && Array.isArray(a1)) {
    // legacy [opsArray, coordsArray]
    walkLegacyConstructPath(a0, a1);
    return;
  }
  if (a0 && typeof a0.length === 'number' && a1 && typeof a1.length === 'number'
      && typeof a0 !== 'string' && typeof a1 !== 'string') {
    // legacy form where both are typed arrays.
    walkLegacyConstructPath(Array.from(a0), Array.from(a1));
  }
}

function boundingBox(segments) {
  if (!segments.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthFt: 0, heightFt: 0 };
  }
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2);
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

const VALID_HAZARDS = new Set(['light', 'ordinary', 'extra', 'esfr']);
const FOOTPRINT_NOTE =
  'Best-effort bbox footprint of the extracted PDF vector geometry — NOT a full ' +
  'room segmentation and NOT an AHJ/PE/accurate drawing. Geometry is real (the ' +
  'plan vector ops); the PDF-point->feet scale is operator-supplied.';

/**
 * PURE. Reduce a segment set to a floor plan the engine consumes: a single room
 * whose polygon is the overall bbox footprint (in feet), plus the raw segments as
 * wall candidates. Honest first-pass — see FOOTPRINT_NOTE.
 *
 * @param {Array<{x1,y1,x2,y2}>} segments
 * @param {{hazard?:string}} [opts]
 * @returns {{rooms:Array, bbox:Object, wallCandidates:Array, segmentCount:number, note:string}}
 */
export function segmentsToFloorPlan(segments, opts = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('segmentsToFloorPlan: no segments to bound — extract geometry first');
  }
  const hazard = VALID_HAZARDS.has(String(opts.hazard).toLowerCase())
    ? String(opts.hazard).toLowerCase()
    : 'ordinary';
  const bbox = boundingBox(segments);
  const { minX, minY, maxX, maxY } = bbox;
  const polygon = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  return {
    rooms: [{ name: 'Extracted Footprint', polygon, hazard }],
    bbox,
    wallCandidates: segments,
    segmentCount: segments.length,
    note: FOOTPRINT_NOTE,
  };
}

/**
 * Async. Build a floor plan from a vector PDF buffer.
 *
 * @param {Uint8Array|Buffer} source - the PDF bytes.
 * @param {Object} opts
 * @param {number} [opts.pageIndex=0] - 0-based page index (page pageIndex+1 is parsed).
 * @param {number} opts.scale - feet per PDF point. REQUIRED, must be > 0. Never guessed.
 * @param {string} [opts.hazard='ordinary']
 * @param {Object} opts.pdfjs - injected/imported pdfjs module exposing getDocument.
 *   Worker setup (GlobalWorkerOptions.workerSrc) is the caller's responsibility.
 * @returns {Promise<{rooms,bbox,segmentCount,pageIndex,scale,note}>}
 */
export async function floorPlanFromPdf(source, opts = {}) {
  const pageIndex = Number.isInteger(opts.pageIndex) ? opts.pageIndex : 0;
  const scale = Number(opts.scale);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(
      'floorPlanFromPdf: a positive drawing `scale` (feet per PDF point) is REQUIRED — ' +
      'it is operator-supplied (like a CAD import unit) and is never guessed. ' +
      'Provide the plan scale, e.g. scale=0.125 for 1pt=0.125ft.',
    );
  }
  const hazard = opts.hazard || 'ordinary';
  const pdfjs = opts.pdfjs;
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
    throw new Error('floorPlanFromPdf: a pdfjs module with getDocument must be provided');
  }

  let opList;
  try {
    const data = source instanceof Uint8Array ? source : new Uint8Array(source);
    const loadingTask = pdfjs.getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(pageIndex + 1); // pdfjs pages are 1-based
    opList = await page.getOperatorList();
  } catch (err) {
    throw new Error(`floorPlanFromPdf: failed to parse PDF page ${pageIndex}: ${err && err.message ? err.message : err}`);
  }

  const { segments, bbox, count } = extractSegmentsFromOpList(opList, { scale });
  if (count === 0) {
    throw new Error(
      `floorPlanFromPdf: no vector path geometry found on PDF page ${pageIndex} — ` +
      'the page may be raster/scanned (no extractable vector ops) or text-only.',
    );
  }
  const fp = segmentsToFloorPlan(segments, { hazard });
  return {
    rooms: fp.rooms,
    bbox,
    wallCandidates: fp.wallCandidates,
    segmentCount: count,
    pageIndex,
    scale,
    note: fp.note,
  };
}
