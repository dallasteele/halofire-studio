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
 * Coordinates inside path-construction ops are in the CURRENT USER SPACE, which the
 * content stream warps via the Current Transformation Matrix (CTM) — `OPS.transform`
 * pre-multiplies the CTM, `OPS.save`/`OPS.restore` push/pop it. Bluebeam/AutoCAD
 * sheets routinely author the whole drawing in a compact model space and blow it up
 * to page space with a base scale transform (e.g. the 2.83465x = 72/25.4 mm->pt
 * matrix this 1881 plan uses). If we ignore the CTM we read the UN-transformed local
 * coordinates and grossly UNDER-CAPTURE the plan extent (the 1881 p8 building reads
 * 915pt wide locally but 2594pt = the full sheet once the CTM is applied). So this
 * extractor maintains a CTM stack and maps every path coordinate to PAGE SPACE before
 * applying the operator-supplied feet-per-point `scale`. The identity CTM (a sheet
 * with no transforms) leaves coordinates unchanged, so synthetic op lists are
 * unaffected. This is REAL geometry — the plan's own ops mapped by the plan's own
 * matrices — never fabricated and never scale-guessed.
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
  // Path state, in PAGE-SPACE PDF points (CTM already applied; scaled to feet only at
  // emit time). cur/start track the CTM-mapped current point and subpath start.
  let cur = null; // current point [x, y] in page space
  let start = null; // current subpath start [x, y] in page space

  // CTM stack. ctm = [a, b, c, d, e, f] maps (x,y) -> (a*x+c*y+e, b*x+d*y+f).
  let ctm = [1, 0, 0, 1, 0, 0];
  const ctmStack = [];
  const applyCtm = (x, y) => [
    ctm[0] * x + ctm[2] * y + ctm[4],
    ctm[1] * x + ctm[3] * y + ctm[5],
  ];
  // m2 pre-multiplied into the CTM: ctm' = ctm * m2 (column-vector convention, so a
  // later transform composes on the right exactly as the content stream applies it).
  const multiplyCtm = (m) => {
    const a = ctm;
    ctm = [
      a[0] * m[0] + a[2] * m[1],
      a[1] * m[0] + a[3] * m[1],
      a[0] * m[2] + a[2] * m[3],
      a[1] * m[2] + a[3] * m[3],
      a[0] * m[4] + a[2] * m[5] + a[4],
      a[1] * m[4] + a[3] * m[5] + a[5],
    ];
  };

  const emit = (x1, y1, x2, y2) => {
    segments.push({
      x1: round(x1 * scale),
      y1: round(y1 * scale),
      x2: round(x2 * scale),
      y2: round(y2 * scale),
    });
  };
  // moveTo/lineTo/rectangle receive RAW user-space coords; map them through the CTM
  // so all stored path state is in page space.
  const moveTo = (rx, ry) => {
    const [x, y] = applyCtm(rx, ry);
    cur = [x, y];
    start = [x, y];
  };
  const lineTo = (rx, ry) => {
    const [x, y] = applyCtm(rx, ry);
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
      case OPS.save:
        // Push a copy of the CTM (graphics-state save).
        ctmStack.push(ctm.slice());
        break;
      case OPS.restore:
        // Pop back to the saved CTM (defensive: ignore an unbalanced restore).
        if (ctmStack.length) ctm = ctmStack.pop();
        break;
      case OPS.transform:
        // Pre-multiply the supplied matrix into the CTM, exactly as the renderer does.
        if (args.length >= 6) {
          multiplyCtm([args[0], args[1], args[2], args[3], args[4], args[5]]);
        }
        break;
      default:
        break; // ignore text/image/other state ops
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

const ISOLATE_NOTE =
  'Heuristic content-region approximation (T29): the sheet-frame border and ' +
  'detached title-block/legend clusters are stripped and the densest contiguous ' +
  'geometry cluster is isolated, yielding a tighter bbox than the whole sheet. ' +
  'This is a BEST-EFFORT APPROXIMATION — NOT a precise building outline, NOT a ' +
  'room segmentation, and NOT an AHJ/PE/accurate drawing. No scale guessing: the ' +
  'PDF-point->feet scale stays operator-supplied. Deterministic.';

/**
 * PURE. Heuristic content-region tightener (T29).
 *
 * Given the raw extracted segments (already in feet — the operator-supplied scale
 * was applied upstream by extractSegmentsFromOpList), narrow the WHOLE-SHEET bbox
 * down to the dominant plan-body content region. This is explicitly a HEURISTIC
 * APPROXIMATION (see ISOLATE_NOTE): it strips the sheet frame and isolates the
 * densest geometry cluster. It is NOT a building outline, NOT a room segmentation,
 * and introduces NO scale guessing.
 *
 * Algorithm (deterministic):
 *  a) Compute the full bbox of all segments.
 *  b) STRIP THE SHEET FRAME: drop axis-aligned segments that hug a full-bbox edge
 *     (within `borderMarginFrac` of the bbox size from that edge) AND span at least
 *     `borderSpanFrac` of that edge dimension. These are the drawing border/frame.
 *  c) DOMINANT CLUSTER: bin the remaining segment MIDPOINTS into a coarse `gridN` x
 *     `gridN` grid over the post-border bbox; flood-fill (4-neighbour) the occupied
 *     cells into contiguous groups; pick the group whose cells hold the most
 *     segments; return the bbox of those segments. This drops detached title-block /
 *     legend / detail clusters that are not part of the main plan body.
 *  d) FALLBACKS (never throw, never return an empty/zero region): if stripping +
 *     clustering leaves < 3 segments, fall back to the post-border bbox; if that is
 *     empty, fall back to the full bbox. The result is always clamped within the
 *     full bbox.
 *
 * @param {Array<{x1,y1,x2,y2}>} segments
 * @param {{borderMarginFrac?:number, borderSpanFrac?:number, gridN?:number}} [opts]
 * @returns {{bbox:{minX,minY,maxX,maxY,widthFt,heightFt}, keptCount:number, droppedBorderCount:number, note:string}}
 */
export function isolateContentRegion(segments, opts = {}) {
  const borderMarginFrac = Number.isFinite(opts.borderMarginFrac) ? Number(opts.borderMarginFrac) : 0.02;
  const borderSpanFrac = Number.isFinite(opts.borderSpanFrac) ? Number(opts.borderSpanFrac) : 0.6;
  const gridN = Number.isInteger(opts.gridN) && opts.gridN > 0 ? opts.gridN : 24;

  const segs = Array.isArray(segments) ? segments : [];

  // (a) Full bbox of everything.
  const full = boundingBox(segs);

  // Degenerate: nothing, or a zero-area extent -> return the full bbox as-is.
  if (segs.length === 0 || full.widthFt <= 0 || full.heightFt <= 0) {
    return {
      bbox: { ...full },
      keptCount: segs.length,
      droppedBorderCount: 0,
      note: ISOLATE_NOTE,
    };
  }

  const w = full.maxX - full.minX;
  const h = full.maxY - full.minY;
  const marginX = w * borderMarginFrac;
  const marginY = h * borderMarginFrac;

  // (b) Strip the sheet frame: axis-aligned segments hugging an edge AND spanning
  // most of that edge dimension.
  const EPS = Math.max(w, h) * 1e-9;
  const isHorizontal = (s) => Math.abs(s.y1 - s.y2) <= EPS;
  const isVertical = (s) => Math.abs(s.x1 - s.x2) <= EPS;

  const interior = [];
  let droppedBorderCount = 0;
  for (const s of segs) {
    const loX = Math.min(s.x1, s.x2);
    const hiX = Math.max(s.x1, s.x2);
    const loY = Math.min(s.y1, s.y2);
    const hiY = Math.max(s.y1, s.y2);
    const spanX = hiX - loX;
    const spanY = hiY - loY;

    let isFrame = false;
    if (isHorizontal(s) && spanX >= borderSpanFrac * w) {
      // Hugs top or bottom edge?
      const midY = (loY + hiY) / 2;
      if (midY <= full.minY + marginY || midY >= full.maxY - marginY) isFrame = true;
    }
    if (!isFrame && isVertical(s) && spanY >= borderSpanFrac * h) {
      // Hugs left or right edge?
      const midX = (loX + hiX) / 2;
      if (midX <= full.minX + marginX || midX >= full.maxX - marginX) isFrame = true;
    }

    if (isFrame) droppedBorderCount += 1;
    else interior.push(s);
  }

  const clampBbox = (b) => ({
    minX: Math.max(full.minX, round(b.minX)),
    minY: Math.max(full.minY, round(b.minY)),
    maxX: Math.min(full.maxX, round(b.maxX)),
    maxY: Math.min(full.maxY, round(b.maxY)),
  });
  const finalize = (b, kept) => {
    const c = clampBbox(b);
    return {
      bbox: {
        minX: c.minX,
        minY: c.minY,
        maxX: c.maxX,
        maxY: c.maxY,
        widthFt: round(c.maxX - c.minX),
        heightFt: round(c.maxY - c.minY),
      },
      keptCount: kept,
      droppedBorderCount,
      note: ISOLATE_NOTE,
    };
  };

  const postBorderBbox = boundingBox(interior);

  // Fallback: stripping left too little to cluster meaningfully.
  if (interior.length < 3 || postBorderBbox.widthFt <= 0 || postBorderBbox.heightFt <= 0) {
    if (interior.length > 0 && postBorderBbox.widthFt > 0 && postBorderBbox.heightFt > 0) {
      return finalize(postBorderBbox, interior.length);
    }
    return finalize(full, segs.length);
  }

  // (c) Dominant cluster via coarse-grid flood-fill on segment midpoints.
  const ow = postBorderBbox.maxX - postBorderBbox.minX;
  const oh = postBorderBbox.maxY - postBorderBbox.minY;
  const cellOf = (mx, my) => {
    let cx = Math.floor(((mx - postBorderBbox.minX) / ow) * gridN);
    let cy = Math.floor(((my - postBorderBbox.minY) / oh) * gridN);
    if (cx < 0) cx = 0; else if (cx >= gridN) cx = gridN - 1;
    if (cy < 0) cy = 0; else if (cy >= gridN) cy = gridN - 1;
    return [cx, cy];
  };

  // cellKey -> array of segment indices whose midpoint falls in that cell.
  const cellSegs = new Map();
  const keyOf = (cx, cy) => cy * gridN + cx;
  for (let i = 0; i < interior.length; i++) {
    const s = interior[i];
    const mx = (s.x1 + s.x2) / 2;
    const my = (s.y1 + s.y2) / 2;
    const [cx, cy] = cellOf(mx, my);
    const k = keyOf(cx, cy);
    let arr = cellSegs.get(k);
    if (!arr) { arr = []; cellSegs.set(k, arr); }
    arr.push(i);
  }

  // Flood-fill occupied cells (4-neighbour) into contiguous groups; track the group
  // holding the most segments. Iterate cell keys in sorted order for determinism.
  const visited = new Set();
  const occupiedKeys = Array.from(cellSegs.keys()).sort((a, b) => a - b);
  let bestSegIdx = null;
  let bestCount = -1;
  for (const startKey of occupiedKeys) {
    if (visited.has(startKey)) continue;
    // BFS over occupied neighbours.
    const stack = [startKey];
    visited.add(startKey);
    const groupSegIdx = [];
    while (stack.length) {
      const k = stack.pop();
      const arr = cellSegs.get(k);
      for (const idx of arr) groupSegIdx.push(idx);
      const cx = k % gridN;
      const cy = Math.floor(k / gridN);
      const neighbours = [
        cx > 0 ? keyOf(cx - 1, cy) : -1,
        cx < gridN - 1 ? keyOf(cx + 1, cy) : -1,
        cy > 0 ? keyOf(cx, cy - 1) : -1,
        cy < gridN - 1 ? keyOf(cx, cy + 1) : -1,
      ];
      for (const nk of neighbours) {
        if (nk >= 0 && cellSegs.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          stack.push(nk);
        }
      }
    }
    if (groupSegIdx.length > bestCount) {
      bestCount = groupSegIdx.length;
      bestSegIdx = groupSegIdx;
    }
  }

  // Fallback: clustering somehow produced too few segments.
  if (!bestSegIdx || bestSegIdx.length < 3) {
    return finalize(postBorderBbox, interior.length);
  }

  const clusterSegs = bestSegIdx.map((i) => interior[i]);
  const clusterBbox = boundingBox(clusterSegs);
  if (clusterBbox.widthFt <= 0 || clusterBbox.heightFt <= 0) {
    return finalize(postBorderBbox, interior.length);
  }
  return finalize(clusterBbox, clusterSegs.length);
}

const EXTENT_NOTE =
  'Heuristic FULL-EXTENT content-region approximation (T32): the sheet-frame ' +
  'border is stripped, then the bbox of the UNION of all non-trivial content ' +
  'clusters is returned — dropping ONLY tiny detached annotation islands ' +
  '(title block / legend / north-arrow / notes) whose segment-share is below a ' +
  'small outlier threshold. This captures the WHOLE building extent (all wings, ' +
  'even across courtyards/gaps) instead of a single dominant cluster. It is a ' +
  'BEST-EFFORT APPROXIMATION — NOT a precise building outline, NOT a room ' +
  'segmentation, and NOT an AHJ/PE/accurate drawing. No scale guessing: the ' +
  'PDF-point->feet scale stays operator-supplied. Deterministic.';

/**
 * PURE. Heuristic FULL-EXTENT content-region isolator (T32).
 *
 * The T29 isolateContentRegion keeps only the single densest flood-fill cluster,
 * which UNDER-CAPTURES multi-wing / connected plans (a building drawn as two dense
 * regions, or with an interior courtyard, splits into separate clusters and only one
 * is kept). This isolator instead returns the bbox of the UNION of ALL non-trivial
 * content clusters, dropping ONLY tiny detached annotation islands.
 *
 * Algorithm (deterministic), sharing T29's frame-strip:
 *  a) Compute the full bbox of all segments.
 *  b) STRIP THE SHEET FRAME using the SAME criterion as isolateContentRegion
 *     (axis-aligned segment hugging a full-bbox edge AND spanning >= borderSpanFrac
 *     of that edge dimension).
 *  c) Bin the remaining segment MIDPOINTS into a coarse gridN x gridN grid; flood-fill
 *     (4-neighbour) the occupied cells into contiguous groups (each distinct group is,
 *     by 4-neighbour connectivity, spatially DETACHED from every other group).
 *  d) OUTLIER DROP (principled, not a tuned percentile): a group is discarded ONLY
 *     when it is BOTH (i) tiny — its segment-share < outlierFrac of the total interior
 *     segments — AND (ii) detached, i.e. it is not the largest "main mass" group. All
 *     other groups are RETAINED. The result is the UNION bbox of the retained groups.
 *     This keeps every substantial wing of the building (even with internal gaps the
 *     grid splits into multiple groups) while discarding small detached annotation
 *     clusters (title block / legend / north arrow / notes).
 *  e) FALLBACKS (never throw, never return an empty region): if stripping/clustering
 *     leaves too little, fall back to the post-border bbox, then the full bbox. The
 *     result is always clamped within the full bbox.
 *
 * Defaults are principled and overridable; NONE is chosen to hit a dollar figure.
 *
 * @param {Array<{x1,y1,x2,y2}>} segments
 * @param {{borderMarginFrac?:number, borderSpanFrac?:number, gridN?:number, outlierFrac?:number}} [opts]
 * @returns {{bbox:{minX,minY,maxX,maxY,widthFt,heightFt}, keptCount:number, droppedBorderCount:number, droppedOutlierCount:number, groupCount:number, retainedGroupCount:number, note:string}}
 */
export function isolatePlanExtent(segments, opts = {}) {
  const borderMarginFrac = Number.isFinite(opts.borderMarginFrac) ? Number(opts.borderMarginFrac) : 0.02;
  const borderSpanFrac = Number.isFinite(opts.borderSpanFrac) ? Number(opts.borderSpanFrac) : 0.6;
  const gridN = Number.isInteger(opts.gridN) && opts.gridN > 0 ? opts.gridN : 24;
  const outlierFrac = Number.isFinite(opts.outlierFrac) ? Number(opts.outlierFrac) : 0.02;

  const segs = Array.isArray(segments) ? segments : [];
  const full = boundingBox(segs);

  // Degenerate: nothing, or zero-area -> full bbox as-is.
  if (segs.length === 0 || full.widthFt <= 0 || full.heightFt <= 0) {
    return {
      bbox: { ...full },
      keptCount: segs.length,
      droppedBorderCount: 0,
      droppedOutlierCount: 0,
      groupCount: 0,
      retainedGroupCount: 0,
      note: EXTENT_NOTE,
    };
  }

  const w = full.maxX - full.minX;
  const h = full.maxY - full.minY;
  const marginX = w * borderMarginFrac;
  const marginY = h * borderMarginFrac;

  // (b) Strip the sheet frame — identical criterion to isolateContentRegion.
  const EPS = Math.max(w, h) * 1e-9;
  const isHorizontal = (s) => Math.abs(s.y1 - s.y2) <= EPS;
  const isVertical = (s) => Math.abs(s.x1 - s.x2) <= EPS;

  const interior = [];
  let droppedBorderCount = 0;
  for (const s of segs) {
    const loX = Math.min(s.x1, s.x2);
    const hiX = Math.max(s.x1, s.x2);
    const loY = Math.min(s.y1, s.y2);
    const hiY = Math.max(s.y1, s.y2);
    const spanX = hiX - loX;
    const spanY = hiY - loY;

    let isFrame = false;
    if (isHorizontal(s) && spanX >= borderSpanFrac * w) {
      const midY = (loY + hiY) / 2;
      if (midY <= full.minY + marginY || midY >= full.maxY - marginY) isFrame = true;
    }
    if (!isFrame && isVertical(s) && spanY >= borderSpanFrac * h) {
      const midX = (loX + hiX) / 2;
      if (midX <= full.minX + marginX || midX >= full.maxX - marginX) isFrame = true;
    }

    if (isFrame) droppedBorderCount += 1;
    else interior.push(s);
  }

  const clampBbox = (b) => ({
    minX: Math.max(full.minX, round(b.minX)),
    minY: Math.max(full.minY, round(b.minY)),
    maxX: Math.min(full.maxX, round(b.maxX)),
    maxY: Math.min(full.maxY, round(b.maxY)),
  });
  const finalize = (b, kept, extra = {}) => {
    const c = clampBbox(b);
    return {
      bbox: {
        minX: c.minX,
        minY: c.minY,
        maxX: c.maxX,
        maxY: c.maxY,
        widthFt: round(c.maxX - c.minX),
        heightFt: round(c.maxY - c.minY),
      },
      keptCount: kept,
      droppedBorderCount,
      droppedOutlierCount: 0,
      groupCount: 0,
      retainedGroupCount: 0,
      note: EXTENT_NOTE,
      ...extra,
    };
  };

  const postBorderBbox = boundingBox(interior);

  // Fallback: stripping left too little to cluster meaningfully.
  if (interior.length < 3 || postBorderBbox.widthFt <= 0 || postBorderBbox.heightFt <= 0) {
    if (interior.length > 0 && postBorderBbox.widthFt > 0 && postBorderBbox.heightFt > 0) {
      return finalize(postBorderBbox, interior.length);
    }
    return finalize(full, segs.length);
  }

  // (c) Bin midpoints into a coarse grid and flood-fill into contiguous groups.
  const ow = postBorderBbox.maxX - postBorderBbox.minX;
  const oh = postBorderBbox.maxY - postBorderBbox.minY;
  const keyOf = (cx, cy) => cy * gridN + cx;
  const cellOf = (mx, my) => {
    let cx = Math.floor(((mx - postBorderBbox.minX) / ow) * gridN);
    let cy = Math.floor(((my - postBorderBbox.minY) / oh) * gridN);
    if (cx < 0) cx = 0; else if (cx >= gridN) cx = gridN - 1;
    if (cy < 0) cy = 0; else if (cy >= gridN) cy = gridN - 1;
    return [cx, cy];
  };

  const cellSegs = new Map();
  for (let i = 0; i < interior.length; i++) {
    const s = interior[i];
    const mx = (s.x1 + s.x2) / 2;
    const my = (s.y1 + s.y2) / 2;
    const [cx, cy] = cellOf(mx, my);
    const k = keyOf(cx, cy);
    let arr = cellSegs.get(k);
    if (!arr) { arr = []; cellSegs.set(k, arr); }
    arr.push(i);
  }

  // Flood-fill occupied cells into contiguous groups; record each group's segment
  // index list. Sorted iteration -> deterministic group ordering.
  const visited = new Set();
  const occupiedKeys = Array.from(cellSegs.keys()).sort((a, b) => a - b);
  const groups = []; // each: { segIdx: number[] }
  for (const startKey of occupiedKeys) {
    if (visited.has(startKey)) continue;
    const stack = [startKey];
    visited.add(startKey);
    const groupSegIdx = [];
    while (stack.length) {
      const k = stack.pop();
      const arr = cellSegs.get(k);
      for (const idx of arr) groupSegIdx.push(idx);
      const cx = k % gridN;
      const cy = Math.floor(k / gridN);
      const neighbours = [
        cx > 0 ? keyOf(cx - 1, cy) : -1,
        cx < gridN - 1 ? keyOf(cx + 1, cy) : -1,
        cy > 0 ? keyOf(cx, cy - 1) : -1,
        cy < gridN - 1 ? keyOf(cx, cy + 1) : -1,
      ];
      for (const nk of neighbours) {
        if (nk >= 0 && cellSegs.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          stack.push(nk);
        }
      }
    }
    groups.push({ segIdx: groupSegIdx });
  }

  // Fallback: no usable groups.
  if (groups.length === 0) {
    return finalize(postBorderBbox, interior.length);
  }

  // (d) OUTLIER DROP. The "main mass" is the largest group; never dropped. Every
  // OTHER group is dropped ONLY when its segment-share < outlierFrac (tiny AND
  // detached). Retain all the rest and take the UNION of their segments.
  const total = interior.length;
  let mainIdx = 0;
  for (let g = 1; g < groups.length; g++) {
    if (groups[g].segIdx.length > groups[mainIdx].segIdx.length) mainIdx = g;
  }

  const retained = [];
  let droppedOutlierCount = 0;
  for (let g = 0; g < groups.length; g++) {
    const share = groups[g].segIdx.length / total;
    if (g !== mainIdx && share < outlierFrac) {
      droppedOutlierCount += groups[g].segIdx.length;
      continue; // tiny detached annotation island -> drop
    }
    retained.push(groups[g]);
  }

  // Union of retained segments.
  const retainedSegIdx = [];
  for (const grp of retained) for (const idx of grp.segIdx) retainedSegIdx.push(idx);

  if (retainedSegIdx.length < 3) {
    return finalize(postBorderBbox, interior.length, {
      groupCount: groups.length,
      retainedGroupCount: retained.length,
    });
  }

  const unionSegs = retainedSegIdx.map((i) => interior[i]);
  const unionBbox = boundingBox(unionSegs);
  if (unionBbox.widthFt <= 0 || unionBbox.heightFt <= 0) {
    return finalize(postBorderBbox, interior.length, {
      groupCount: groups.length,
      retainedGroupCount: retained.length,
    });
  }

  return finalize(unionBbox, unionSegs.length, {
    droppedOutlierCount,
    groupCount: groups.length,
    retainedGroupCount: retained.length,
  });
}

/**
 * PURE. Parse a STATED architectural drawing scale out of sheet text and return
 * the feet-per-PDF-point conversion factor, or null when no recognizable scale is
 * present.
 *
 * This DERIVES the scale FROM THE DRAWING (a real datum printed on the sheet, e.g.
 * the SCALE: 3/32" = 1'-0" label on an ARCH-D plan). It is explicitly NOT a guess
 * and NOT an auto-derivation from geometry — it reads the architect's own stated
 * scale, exactly like a human estimator reading the title block. floorPlanFromPdf
 * still requires an operator/caller to PASS the scale; this helper lets the caller
 * obtain it honestly from the sheet rather than inventing one.
 *
 * Recognized form (whitespace/symbol tolerant):
 *   [SCALE[:]]  <lhs inches>  "  =  <rhs feet>  '  [- 0"]
 * where:
 *   - the inch mark may be a straight double-quote ", a curly ” / “, or the word-
 *     break is implicit; the foot mark may be a straight prime ', a curly ’ / ‘;
 *   - <lhs inches> is a fraction (a/b), a mixed number (a b/c), or a decimal/integer;
 *   - <rhs feet> is a decimal/integer;
 *   - an optional trailing dash + zero-inch suffix ( - 0" ) is accepted and ignored.
 *
 * Conversion: the drawing says lhsInches drawing-inches represent rhsFeet real feet.
 * So real-feet-per-drawing-inch = rhsFeet / lhsInches, and since 1 inch = 72 PDF
 * points, feetPerPoint = (rhsFeet / lhsInches) / 72.
 *
 * Examples (all computed, never table-looked-up):
 *   3/32" = 1'-0"  -> (1 / (3/32)) / 72 = (32/3) / 72 = 0.148148...
 *   1/8"  = 1'-0"  -> (1 / (1/8))  / 72 = 8 / 72       = 0.111111...
 *   1/16" = 1'-0"  -> (1 / (1/16)) / 72 = 16 / 72      = 0.222222...
 *   1"    = 20'    -> (20 / 1)     / 72 = 20 / 72      = 0.277778...
 *
 * @param {string} text - raw text extracted from the sheet (e.g. joined textContent).
 * @returns {number|null} feet per PDF point, or null when no scale is recognized.
 */
export function parseArchitecturalScale(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  // Normalize unicode quote/prime variants to straight marks so one regex covers
  // the curly glyphs Bluebeam/AutoCAD title blocks emit.
  const norm = text
    .replace(/[′‘’´]/g, "'") // primes / curly singles -> '
    .replace(/[″“”]/g, '"'); // double-primes / curly doubles -> "

  // <lhs> "  =  <rhs> '  [ - 0 " ]   with optional leading SCALE[:] label.
  // lhs: mixed number / fraction / decimal. rhs: decimal/integer.
  const re = new RegExp(
    String.raw`(?:scale\s*:?\s*)?` + // optional SCALE label
    String.raw`(\d+(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?|\d*\.\d+)` + // (1) lhs inches
    String.raw`\s*"` + // inch mark
    String.raw`\s*=\s*` + // =
    String.raw`(\d+(?:\.\d+)?)` + // (2) rhs feet
    String.raw`\s*'` + // foot mark
    String.raw`(?:\s*-\s*0\s*")?`, // optional - 0" suffix
    'i',
  );

  const m = norm.match(re);
  if (!m) return null;

  const lhsInches = parseNumberOrFraction(m[1]);
  const rhsFeet = Number(m[2]);
  if (!Number.isFinite(lhsInches) || lhsInches <= 0) return null;
  if (!Number.isFinite(rhsFeet) || rhsFeet <= 0) return null;

  // feetPerPoint = (real feet per drawing inch) / 72 points-per-inch.
  return (rhsFeet / lhsInches) / 72;
}

// Parse "a", "a.b", "a/b", or mixed "a b/c" into a Number. Returns NaN on junk.
function parseNumberOrFraction(token) {
  const t = String(token).trim();
  // Mixed number: whole + space + fraction.
  const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den === 0) return NaN;
    return whole + num / den;
  }
  // Pure fraction.
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den === 0) return NaN;
    return num / den;
  }
  // Decimal / integer.
  if (/^\d*\.?\d+$/.test(t)) return Number(t);
  return NaN;
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
 * Isolation modes (opts.isolate; default falsy — preserves existing behavior/tests):
 *  - falsy            -> whole-sheet bbox (T28).
 *  - true / 'dominant'-> T29 dominant-cluster bbox (sheet frame stripped, single
 *                        densest cluster isolated).
 *  - 'fullExtent'     -> T32 full-extent bbox (sheet frame stripped, UNION of all
 *                        non-trivial clusters minus tiny detached annotation islands).
 * When isolating, the room polygon uses the isolated bbox and the isolation metadata
 * (keptCount, droppedBorderCount, and for fullExtent droppedOutlierCount) + the
 * heuristic note are attached. The isolated region is a BEST-EFFORT APPROXIMATION,
 * not a building outline.
 *
 * @param {Array<{x1,y1,x2,y2}>} segments
 * @param {{hazard?:string, isolate?:(boolean|'dominant'|'fullExtent'), isolateOpts?:Object}} [opts]
 * @returns {{rooms:Array, bbox:Object, wallCandidates:Array, segmentCount:number, note:string, keptCount?:number, droppedBorderCount?:number, droppedOutlierCount?:number}}
 */
export function segmentsToFloorPlan(segments, opts = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('segmentsToFloorPlan: no segments to bound — extract geometry first');
  }
  const hazard = VALID_HAZARDS.has(String(opts.hazard).toLowerCase())
    ? String(opts.hazard).toLowerCase()
    : 'ordinary';

  let bbox;
  let note;
  let isolation = null;
  const fullExtentMode = opts.isolate === 'fullExtent';
  if (fullExtentMode) {
    isolation = isolatePlanExtent(segments, opts.isolateOpts || {});
    bbox = isolation.bbox;
    note = isolation.note;
  } else if (opts.isolate) {
    isolation = isolateContentRegion(segments, opts.isolateOpts || {});
    bbox = isolation.bbox;
    note = isolation.note;
  } else {
    bbox = boundingBox(segments);
    note = FOOTPRINT_NOTE;
  }
  const { minX, minY, maxX, maxY } = bbox;
  const polygon = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const result = {
    rooms: [{ name: 'Extracted Footprint', polygon, hazard }],
    bbox,
    wallCandidates: segments,
    segmentCount: segments.length,
    note,
  };
  if (isolation) {
    result.keptCount = isolation.keptCount;
    result.droppedBorderCount = isolation.droppedBorderCount;
    if (fullExtentMode) {
      result.droppedOutlierCount = isolation.droppedOutlierCount;
      result.groupCount = isolation.groupCount;
      result.retainedGroupCount = isolation.retainedGroupCount;
    }
  }
  return result;
}

/**
 * Async. Build a floor plan from a vector PDF buffer.
 *
 * @param {Uint8Array|Buffer} source - the PDF bytes.
 * @param {Object} opts
 * @param {number} [opts.pageIndex=0] - 0-based page index (page pageIndex+1 is parsed).
 * @param {number} opts.scale - feet per PDF point. REQUIRED, must be > 0. Never guessed.
 * @param {string} [opts.hazard='ordinary']
 * @param {(boolean|'dominant'|'fullExtent')} [opts.isolate=false] - opt-in heuristic
 *   content-region isolation (default false preserves T28 whole-sheet bbox behavior).
 *   true/'dominant' = T29 single densest cluster; 'fullExtent' = T32 union of all
 *   non-trivial clusters minus tiny detached annotation islands (captures the FULL
 *   building extent across wings/courtyards). The room polygon uses the isolated
 *   bbox (BEST-EFFORT APPROXIMATION, not a building outline) and the result carries
 *   keptCount / droppedBorderCount (+ droppedOutlierCount for fullExtent). No scale
 *   guessing either way.
 * @param {Object} opts.pdfjs - injected/imported pdfjs module exposing getDocument.
 *   Worker setup (GlobalWorkerOptions.workerSrc) is the caller's responsibility.
 * @returns {Promise<{rooms,bbox,segmentCount,pageIndex,scale,note,keptCount?,droppedBorderCount?}>}
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
  // Normalize the isolate mode: true/'dominant' -> T29 dominant cluster;
  // 'fullExtent' -> T32 full-extent union; anything else falsy -> T28 whole sheet.
  const fullExtentMode = opts.isolate === 'fullExtent';
  const isolate = fullExtentMode
    ? 'fullExtent'
    : (opts.isolate === true || opts.isolate === 'dominant');
  const isolating = isolate !== false;
  const fp = segmentsToFloorPlan(segments, { hazard, isolate });
  const result = {
    rooms: fp.rooms,
    // When isolating, surface the tightened bbox (matches the room polygon); else
    // the whole-sheet bbox, exactly as T28.
    bbox: isolating ? fp.bbox : bbox,
    wallCandidates: fp.wallCandidates,
    segmentCount: count,
    pageIndex,
    scale,
    note: fp.note,
  };
  if (isolating) {
    result.keptCount = fp.keptCount;
    result.droppedBorderCount = fp.droppedBorderCount;
    if (fullExtentMode) {
      result.droppedOutlierCount = fp.droppedOutlierCount;
      result.groupCount = fp.groupCount;
      result.retainedGroupCount = fp.retainedGroupCount;
    }
  }
  return result;
}
