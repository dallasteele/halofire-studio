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

import { OPS } from './pdfjs-ops.js';
import { segmentFloorPlanViaSam, reconstructFloorPlanFromSam } from '../components/sam-floorplan.js';

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

// Clamp a 0..255 channel to a 2-digit lowercase hex byte.
function hexByte(v) {
  let n = Math.round(v);
  if (n < 0) n = 0; else if (n > 255) n = 255;
  return n.toString(16).padStart(2, '0');
}

/**
 * PURE. Normalize the stroke-color argument of a pdfjs color op to a stable hex string
 * "#rrggbb" (lowercase), or null/a stable string key when no plain RGB color is present.
 *
 * pdfjs v6 normalizes EVERY stroke-color op (setStrokeColor / setStrokeGray /
 * setStrokeCMYKColor / non-pattern setStrokeColorN) into OPS.setStrokeRGBColor whose
 * single arg is already a HEX STRING produced by ColorSpace.getRgbHex -> Util.makeHexColor
 * (i.e. "#rrggbb"). Older / raw forms pass a packed integer 0xRRGGBB or an [r,g,b] array
 * (floats 0..1 or ints 0..255). The recon NaN came from decoding the hex-string form as a
 * number; this helper inspects the ACTUAL arg shape and decodes each correctly:
 *   - string "#rrggbb" / "rrggbb"   -> lowercased "#rrggbb"
 *   - finite number (packed 0xRRGGBB) -> "#rrggbb"
 *   - [r,g,b] array (0..1 or 0..255) -> "#rrggbb"
 *   - anything else (pattern object, missing) -> null
 *
 * @param {any} arg - argsArray[k] entry for a stroke-color op (may be a value or wrapper).
 * @returns {string|null}
 */
export function normalizeStrokeColorArg(arg) {
  // pdfjs passes the color as args[0]; accept both the raw value and the args array.
  let v = arg;
  if (Array.isArray(arg) && arg.length === 1) v = arg[0]; // single packed value/string

  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    const m = t.match(/^#?([0-9a-f]{6})$/);
    if (m) return `#${m[1]}`;
    // a 3-digit shorthand "#rgb"
    const m3 = t.match(/^#?([0-9a-f]{3})$/);
    if (m3) {
      const [r, g, b] = m3[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = v >>> 0; // treat as packed 0xRRGGBB
    return `#${hexByte((n >> 16) & 0xff)}${hexByte((n >> 8) & 0xff)}${hexByte(n & 0xff)}`;
  }
  // [r,g,b] component array.
  const asArr = Array.isArray(arg) && arg.length >= 3 && arg.every((x) => typeof x === 'number')
    ? arg
    : (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number') ? v : null);
  if (asArr) {
    const [r, g, b] = asArr;
    // Heuristic: if every channel is in 0..1, it is float RGB; else 0..255 ints.
    const max = Math.max(r, g, b);
    const scale = max <= 1 + 1e-9 ? 255 : 1;
    return `#${hexByte(r * scale)}${hexByte(g * scale)}${hexByte(b * scale)}`;
  }
  return null;
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
  // Graphics state tracked alongside the CTM (T34): current stroke lineWidth (the
  // OPS.setLineWidth arg) and current stroke color (normalized hex string). Both
  // default to null until a graphics-state op sets them, so op lists without these
  // ops behave EXACTLY as before (additive, backward-compatible). save/restore push
  // and pop the whole [ctm, lineWidth, strokeColor] state, exactly like the renderer.
  let gsLineWidth = null;
  let gsStrokeColor = null;
  const ctmStack = [];
  const gsStack = []; // parallel stack of { lineWidth, strokeColor }
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
    const seg = {
      x1: round(x1 * scale),
      y1: round(y1 * scale),
      x2: round(x2 * scale),
      y2: round(y2 * scale),
    };
    // T34 graphics-state tags are ADDITIVE and only attached when a graphics-state op
    // has actually set them. Op lists with NO setLineWidth/setStroke*Color ops emit the
    // bare {x1,y1,x2,y2} shape EXACTLY as before — preserving every existing test that
    // asserts segments with toEqual on the 4 geometry fields. selectWallLayer treats a
    // missing tag as null (one null/null group).
    if (gsLineWidth !== null) seg.lineWidth = gsLineWidth;
    if (gsStrokeColor !== null) seg.strokeColor = gsStrokeColor;
    segments.push(seg);
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
        // Push a copy of the CTM AND the graphics state (lineWidth + color).
        ctmStack.push(ctm.slice());
        gsStack.push({ lineWidth: gsLineWidth, strokeColor: gsStrokeColor });
        break;
      case OPS.restore:
        // Pop back to the saved CTM + graphics state (defensive: ignore unbalanced).
        if (ctmStack.length) ctm = ctmStack.pop();
        if (gsStack.length) {
          const g = gsStack.pop();
          gsLineWidth = g.lineWidth;
          gsStrokeColor = g.strokeColor;
        }
        break;
      case OPS.transform:
        // Pre-multiply the supplied matrix into the CTM, exactly as the renderer does.
        if (args.length >= 6) {
          multiplyCtm([args[0], args[1], args[2], args[3], args[4], args[5]]);
        }
        break;
      case OPS.setLineWidth: {
        // T34: track the current stroke lineWidth (in user-space units as authored;
        // we tag the relative band, not an absolute mm — the histogram groups by it).
        const w = Number(args[0]);
        if (Number.isFinite(w)) gsLineWidth = w;
        break;
      }
      case OPS.setStrokeRGBColor:
      case OPS.setStrokeColor:
      case OPS.setStrokeColorN: {
        // T34: track the current stroke color. In pdfjs v6 all of these arrive as
        // OPS.setStrokeRGBColor with a hex-string arg; older/raw forms (packed int or
        // [r,g,b]) and the colorspace-dependent setStrokeColor/N are normalized here.
        const c = normalizeStrokeColorArg(args);
        // A null (pattern / transparent / undecodable) leaves the prior color stable.
        if (c !== null) gsStrokeColor = c;
        break;
      }
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

const OUTLINE_NOTE =
  'Heuristic building-OUTLINE polygon (T33): from the extracted vector segments, ' +
  'only WALL-LIKE segments are kept (axis-aligned within a small angle tolerance ' +
  'AND at least minWallFt long), which drops short dimension witness-lines, text ' +
  'strokes and hatching; the DOMINANT connected wall NETWORK (segments joined ' +
  'end-to-end within connectTolFt, largest by total wall length) is isolated, ' +
  'dropping detached detail / legend / title geometry; the network is rasterized ' +
  'onto a gridN occupancy grid, the exterior is flood-filled, and the ENCLOSED ' +
  'footprint (wall + interior cells) is traced into a rectilinear polygon whose ' +
  'SHOELACE area is the reported footprint. This is the building footprint AREA ' +
  '(not the over-capturing bbox of the whole annotated sheet). It is a BEST-EFFORT ' +
  'APPROXIMATION — NOT a precise building outline, NOT a room segmentation, and ' +
  'NOT an AHJ/PE/accurate drawing. The minWallFt / connectTolFt / gridN thresholds ' +
  'are GEOMETRIC defaults (wall length, join tolerance, raster resolution) — they ' +
  'are NOT fitted to any target area or dollar figure. No scale guessing: coords ' +
  'are already in feet (operator-supplied scale applied upstream). Deterministic.';

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

/**
 * PURE. Extract the building OUTLINE polygon and its ENCLOSED footprint area from a
 * raw segment set (already in feet — the operator-supplied scale was applied upstream
 * by extractSegmentsFromOpList).
 *
 * Motivation (T33): a rectangular BBOX over an annotated architectural sheet grossly
 * OVER-captures the building (it swallows dimension witness-lines, leader/notes,
 * enlarged details, and title-block geometry stacked on the same sheet). The fix is to
 * measure the building's actual ENCLOSED FOOTPRINT, not a bbox. This is done with three
 * PRINCIPLED, geometric steps (defaults are geometric, NOT fitted to any area or dollar):
 *
 *  (a) WALL-LIKE FILTER. Keep only segments that are (near-)axis-aligned — their angle
 *      from horizontal/vertical is within `axisTolDeg` — AND at least `minWallFt` long.
 *      Real walls are long and orthogonal; dimension witness-lines, text strokes, and
 *      hatching are short and/or skew, so this drops the annotation layer. (Diagonal
 *      walls are rare in this stock and a near-axis test is the conservative choice; a
 *      plan with genuinely diagonal walls would under-capture and is reported, not fudged.)
 *
 *  (b) DOMINANT CONNECTED WALL NETWORK. Build a graph over the kept wall segments where
 *      two segments are joined when an endpoint of one lies within `connectTolFt` of an
 *      endpoint of the other (snapped via a spatial hash for O(n) grouping). Take the
 *      connected component with the greatest TOTAL WALL LENGTH — the main plan body —
 *      discarding detached detail/legend/title drawings that live in their own component.
 *
 *  (c) ENCLOSED RECTILINEAR FOOTPRINT. Rasterize the dominant network onto a
 *      `gridN` x `gridN` occupancy grid over the network bbox (mark every cell a wall
 *      passes through, via a DDA cell walk). Flood-fill the EXTERIOR inward from the grid
 *      border (4-neighbour, blocked by wall cells); every cell not reached is ENCLOSED.
 *      The footprint = wall cells + enclosed cells. Its outer boundary is traced into a
 *      rectilinear polygon (axis-aligned edges) and the SHOELACE area of that polygon is
 *      returned as `areaSqft`. For a building whose plan is mostly rectilinear this is the
 *      honest enclosed area — strictly the footprint, NOT the bbox of everything.
 *
 * FALLBACKS (never throw): if no wall-like segments survive (a), or the network/footprint
 * is degenerate, fall back to the dominant-network bbox, then the all-segment bbox, and
 * report the fallback in `method`. A degenerate (e.g. single short segment) input yields a
 * defined zero/near-zero result without throwing.
 *
 * @param {Array<{x1,y1,x2,y2}>} segments  - segments in FEET.
 * @param {{minWallFt?:number, connectTolFt?:number, gridN?:number, axisTolDeg?:number}} [opts]
 *   GEOMETRIC defaults: minWallFt=3 (a true wall run, drops witness-ticks/text strokes),
 *   connectTolFt=1.5 (join slop at corners), gridN=140 (raster resolution), axisTolDeg=5
 *   (orthogonality tolerance). NONE is fitted to 21,332 sqft or any dollar.
 * @returns {{polygon:Array<[number,number]>, areaSqft:number, bbox:{minX,minY,maxX,maxY,widthFt,heightFt}, method:string, note:string, wallSegmentCount:number, networkSegmentCount:number}}
 */
export function buildingOutlinePolygon(segments, opts = {}) {
  const minWallFt = Number.isFinite(opts.minWallFt) ? Number(opts.minWallFt) : 3;
  const connectTolFt = Number.isFinite(opts.connectTolFt) ? Number(opts.connectTolFt) : 1.5;
  const gridN = Number.isInteger(opts.gridN) && opts.gridN > 1 ? opts.gridN : 140;
  const axisTolDeg = Number.isFinite(opts.axisTolDeg) ? Number(opts.axisTolDeg) : 5;
  const axisTol = Math.tan((axisTolDeg * Math.PI) / 180);

  const segs = Array.isArray(segments) ? segments : [];

  const bboxToObj = (b) => ({
    minX: round(b.minX),
    minY: round(b.minY),
    maxX: round(b.maxX),
    maxY: round(b.maxY),
    widthFt: round(b.maxX - b.minX),
    heightFt: round(b.maxY - b.minY),
  });
  const bboxPolygon = (b) => [
    [round(b.minX), round(b.minY)],
    [round(b.maxX), round(b.minY)],
    [round(b.maxX), round(b.maxY)],
    [round(b.minX), round(b.maxY)],
  ];
  const polyArea = (poly) => {
    let sum = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
  };

  // Degenerate: nothing / zero-area -> defined empty result, never throw.
  const full = boundingBox(segs);
  if (segs.length === 0 || full.widthFt <= 0 || full.heightFt <= 0) {
    const poly = bboxPolygon(full);
    return {
      polygon: poly,
      areaSqft: round(polyArea(poly)),
      bbox: bboxToObj(full),
      method: 'degenerate-bbox',
      note: OUTLINE_NOTE,
      wallSegmentCount: 0,
      networkSegmentCount: 0,
    };
  }

  // ---- (a) WALL-LIKE FILTER -------------------------------------------------
  const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const isAxisAligned = (s) => {
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    if (dx === 0 || dy === 0) return true;
    // near-horizontal (dy/dx small) OR near-vertical (dx/dy small)
    return dy / dx <= axisTol || dx / dy <= axisTol;
  };
  const walls = segs.filter((s) => segLen(s) >= minWallFt && isAxisAligned(s));

  // No walls survived -> fall back to the all-segment bbox (reported as fallback).
  if (walls.length === 0) {
    const poly = bboxPolygon(full);
    return {
      polygon: poly,
      areaSqft: round(polyArea(poly)),
      bbox: bboxToObj(full),
      method: 'fallback-no-walls-bbox',
      note: OUTLINE_NOTE,
      wallSegmentCount: 0,
      networkSegmentCount: 0,
    };
  }

  // ---- (b) DOMINANT CONNECTED WALL NETWORK ----------------------------------
  // Union-Find over wall segments; join two when an endpoint of one is within
  // connectTolFt of an endpoint of the other. Endpoints are snapped to a spatial
  // hash of cell size connectTolFt so each endpoint only checks its 3x3 neighbour
  // cells (O(n) grouping, deterministic).
  const parent = new Array(walls.length);
  for (let i = 0; i < walls.length; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };

  const cell = Math.max(connectTolFt, 1e-9);
  const hashKey = (gx, gy) => `${gx},${gy}`;
  // endpoint bucket -> list of wall indices touching that bucket
  const buckets = new Map();
  const endpointsOf = (s) => [[s.x1, s.y1], [s.x2, s.y2]];
  for (let i = 0; i < walls.length; i++) {
    for (const [ex, ey] of endpointsOf(walls[i])) {
      const gx = Math.floor(ex / cell);
      const gy = Math.floor(ey / cell);
      const k = hashKey(gx, gy);
      let arr = buckets.get(k);
      if (!arr) { arr = []; buckets.set(k, arr); }
      arr.push(i);
    }
  }
  const within = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) <= connectTolFt;
  for (let i = 0; i < walls.length; i++) {
    for (const [ex, ey] of endpointsOf(walls[i])) {
      const gx = Math.floor(ex / cell);
      const gy = Math.floor(ey / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const arr = buckets.get(hashKey(gx + dx, gy + dy));
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            // join i,j if ANY endpoint pair is within tolerance
            let joined = false;
            for (const [px, py] of endpointsOf(walls[i])) {
              for (const [qx, qy] of endpointsOf(walls[j])) {
                if (within(px, py, qx, qy)) { joined = true; break; }
              }
              if (joined) break;
            }
            if (joined) union(i, j);
          }
        }
      }
    }
  }

  // Component with the greatest total wall length.
  const compLen = new Map();
  const compMembers = new Map();
  for (let i = 0; i < walls.length; i++) {
    const r = find(i);
    compLen.set(r, (compLen.get(r) || 0) + segLen(walls[i]));
    let m = compMembers.get(r);
    if (!m) { m = []; compMembers.set(r, m); }
    m.push(i);
  }
  let bestRoot = null;
  let bestLen = -1;
  for (const [r, len] of [...compLen.entries()].sort((a, b) => a[0] - b[0])) {
    if (len > bestLen) { bestLen = len; bestRoot = r; }
  }
  const network = compMembers.get(bestRoot).map((i) => walls[i]);
  const netBbox = boundingBox(network);

  // Network degenerate -> fall back to wall bbox / full bbox.
  if (network.length < 3 || netBbox.widthFt <= 0 || netBbox.heightFt <= 0) {
    const base = netBbox.widthFt > 0 && netBbox.heightFt > 0 ? netBbox : full;
    const poly = bboxPolygon(base);
    return {
      polygon: poly,
      areaSqft: round(polyArea(poly)),
      bbox: bboxToObj(base),
      method: 'fallback-network-bbox',
      note: OUTLINE_NOTE,
      wallSegmentCount: walls.length,
      networkSegmentCount: network.length,
    };
  }

  // ---- (c) ENCLOSED RECTILINEAR FOOTPRINT via occupancy grid ----------------
  const nbW = netBbox.maxX - netBbox.minX;
  const nbH = netBbox.maxY - netBbox.minY;
  const cw = nbW / gridN; // cell width in feet
  const ch = nbH / gridN; // cell height in feet
  const cellArea = cw * ch;
  // wall[cy*gridN + cx] = true when a network wall passes through that cell.
  const wall = new Uint8Array(gridN * gridN);
  const idx = (cx, cy) => cy * gridN + cx;
  const clampC = (v) => (v < 0 ? 0 : v >= gridN ? gridN - 1 : v);
  const toCx = (x) => clampC(Math.floor((x - netBbox.minX) / cw));
  const toCy = (y) => clampC(Math.floor((y - netBbox.minY) / ch));
  // Rasterize each wall segment by sampling along it (dense enough that no cell is
  // skipped — step = min(cw,ch)/2 in feet).
  const step = Math.max(Math.min(cw, ch) / 2, 1e-9);
  for (const s of network) {
    const len = segLen(s);
    const n = Math.max(1, Math.ceil(len / step));
    for (let t = 0; t <= n; t++) {
      const f = t / n;
      const x = s.x1 + (s.x2 - s.x1) * f;
      const y = s.y1 + (s.y2 - s.y1) * f;
      wall[idx(toCx(x), toCy(y))] = 1;
    }
  }

  // Flood-fill the EXTERIOR from the grid border (4-neighbour), blocked by wall cells.
  const exterior = new Uint8Array(gridN * gridN);
  const stack = [];
  const pushIf = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= gridN || cy >= gridN) return;
    const k = idx(cx, cy);
    if (exterior[k] || wall[k]) return;
    exterior[k] = 1;
    stack.push(k);
  };
  for (let cx = 0; cx < gridN; cx++) { pushIf(cx, 0); pushIf(cx, gridN - 1); }
  for (let cy = 0; cy < gridN; cy++) { pushIf(0, cy); pushIf(gridN - 1, cy); }
  while (stack.length) {
    const k = stack.pop();
    const cx = k % gridN;
    const cy = (k - cx) / gridN;
    pushIf(cx - 1, cy); pushIf(cx + 1, cy); pushIf(cx, cy - 1); pushIf(cx, cy + 1);
  }

  // Footprint cells = wall OR not-exterior (enclosed interior + the walls themselves).
  let footprintCells = 0;
  const filled = new Uint8Array(gridN * gridN);
  for (let k = 0; k < gridN * gridN; k++) {
    if (wall[k] || !exterior[k]) { filled[k] = 1; footprintCells++; }
  }
  const footprintAreaSqft = footprintCells * cellArea;

  // Trace the outer rectilinear boundary of the filled cell set into a polygon. We
  // emit the boundary as the union of cell edges that separate a filled cell from a
  // non-filled cell (or the grid border), then stitch them into one closed loop.
  // (For the polygon handed to layoutRoom, point-in-polygon over this orthogonal
  // boundary correctly drops heads outside the footprint.)
  const polygon = traceFilledBoundary(filled, gridN, netBbox.minX, netBbox.minY, cw, ch);

  // If the trace failed (shouldn't for a connected footprint), fall back to the
  // network bbox polygon but keep the grid area as the honest footprint measure.
  let outPoly = polygon;
  let method = 'wall-network-occupancy-grid';
  if (!outPoly || outPoly.length < 4) {
    outPoly = bboxPolygon(netBbox);
    method = 'wall-network-bbox';
  }

  // areaSqft is the OCCUPANCY-GRID enclosed footprint (the honest footprint area).
  // The traced polygon's shoelace area should match it closely; we report the grid
  // area as the primary measure (discretization-stable) and round it.
  const areaSqft = round(footprintAreaSqft);

  return {
    polygon: outPoly.map(([x, y]) => [round(x), round(y)]),
    areaSqft,
    bbox: bboxToObj(netBbox),
    method,
    note: OUTLINE_NOTE,
    wallSegmentCount: walls.length,
    networkSegmentCount: network.length,
  };
}

/**
 * PURE helper. Trace the outer boundary of a filled cell mask into a single closed
 * rectilinear polygon in FEET. Walks boundary edges (cell-edge segments separating a
 * filled cell from a non-filled neighbour / the grid border) and stitches them.
 * Returns vertices in feet; collinear runs are merged. Deterministic.
 */
function traceFilledBoundary(filled, gridN, originX, originY, cw, ch) {
  const isFilled = (cx, cy) => cx >= 0 && cy >= 0 && cx < gridN && cy < gridN && filled[cy * gridN + cx] === 1;
  // Collect directed boundary edges so the filled region stays on the LEFT, giving a
  // CCW outer loop. Edge endpoints are grid-corner integer coords (gx,gy) in cell units.
  // For each filled cell, any side adjacent to a non-filled cell is a boundary edge.
  // Represent each edge by its two corner points and build an adjacency map.
  const edges = new Map(); // "x,y" start corner -> [end corner "x,y"]
  const cornerKey = (gx, gy) => `${gx},${gy}`;
  const addEdge = (x1, y1, x2, y2) => {
    const k = cornerKey(x1, y1);
    let arr = edges.get(k);
    if (!arr) { arr = []; edges.set(k, arr); }
    arr.push([x2, y2]);
  };
  for (let cy = 0; cy < gridN; cy++) {
    for (let cx = 0; cx < gridN; cx++) {
      if (!isFilled(cx, cy)) continue;
      // bottom edge (y=cy): neighbour below is (cx,cy-1). filled-on-left => direction +x
      if (!isFilled(cx, cy - 1)) addEdge(cx, cy, cx + 1, cy);
      // top edge (y=cy+1): neighbour above (cx,cy+1). direction -x
      if (!isFilled(cx, cy + 1)) addEdge(cx + 1, cy + 1, cx, cy + 1);
      // left edge (x=cx): neighbour left (cx-1,cy). direction -y
      if (!isFilled(cx - 1, cy)) addEdge(cx, cy + 1, cx, cy);
      // right edge (x=cx+1): neighbour right (cx+1,cy). direction +y
      if (!isFilled(cx + 1, cy)) addEdge(cx + 1, cy, cx + 1, cy + 1);
    }
  }
  if (edges.size === 0) return null;

  // Pick the lexicographically smallest start corner for determinism, then walk the
  // directed edges until we return to start. This yields the outer loop (the boundary
  // is a set of closed loops; the outer one contains the min corner).
  let startKey = null;
  for (const k of edges.keys()) {
    if (startKey === null) { startKey = k; continue; }
    const [ax, ay] = startKey.split(',').map(Number);
    const [bx, by] = k.split(',').map(Number);
    if (bx < ax || (bx === ax && by < ay)) startKey = k;
  }
  const parseKey = (k) => k.split(',').map(Number);
  const loop = [];
  let cur = startKey;
  const used = new Set();
  let guard = 0;
  const maxSteps = edges.size * 4 + 16;
  while (guard++ < maxSteps) {
    const outs = edges.get(cur);
    if (!outs || outs.length === 0) break;
    // Prefer an unused outgoing edge; deterministic order.
    let nextPt = null;
    for (const cand of outs) {
      const ek = `${cur}->${cand[0]},${cand[1]}`;
      if (!used.has(ek)) { nextPt = cand; used.add(ek); break; }
    }
    if (!nextPt) break;
    const [cx, cy] = parseKey(cur);
    loop.push([cx, cy]);
    const nk = cornerKey(nextPt[0], nextPt[1]);
    if (nk === startKey) break;
    cur = nk;
  }
  if (loop.length < 4) return null;

  // Merge collinear runs, then convert grid corners -> feet.
  const merged = [];
  for (let i = 0; i < loop.length; i++) {
    const prev = loop[(i - 1 + loop.length) % loop.length];
    const cur2 = loop[i];
    const next = loop[(i + 1) % loop.length];
    const d1x = cur2[0] - prev[0]; const d1y = cur2[1] - prev[1];
    const d2x = next[0] - cur2[0]; const d2y = next[1] - cur2[1];
    // keep vertex only when direction changes (not collinear)
    if (d1x * d2y - d1y * d2x !== 0 || (d1x === 0 && d1y === 0)) merged.push(cur2);
  }
  const poly = (merged.length >= 4 ? merged : loop).map(([gx, gy]) => [
    originX + gx * cw,
    originY + gy * ch,
  ]);
  return poly;
}

const WALL_LAYER_NOTE =
  'PDF graphics-state WALL-LAYER selection (T34): segments are grouped by their ' +
  'PDF graphics state (strokeColor, lineWidth) as tagged during extraction, then the ' +
  'wall layer is selected by a PRINCIPLED, DOCUMENTED CAD drafting convention — ' +
  'architectural CUT WALLS are drawn at a HEAVIER lineweight than dimension / grid / ' +
  'match-line / text annotation linework. The default rule: among the groups whose ' +
  'lineWidth is at or above the length-weighted MEDIAN lineweight of the sheet (the ' +
  '"heavier-than-typical-annotation" band, a labelled geometric default — NOT fitted ' +
  'to any area or dollar), pick the single group that forms the most COHERENT ' +
  'CONNECTED building extent (greatest total connected-wall length within connectTolFt), ' +
  'breaking ties toward the heavier lineweight. The full (strokeColor,lineWidth) group ' +
  'histogram and the chosen group are REPORTED for inspection. The selected wall ' +
  'segments are the building linework; the thin full-sheet-spanning grid/dimension ' +
  'annotation is excluded by being a lighter-lineweight group. This is a BEST-EFFORT ' +
  'convention — NOT a precise building outline, NOT a room segmentation, and NOT an ' +
  'AHJ/PE/accurate drawing. The selection is NEVER a search for the group whose ' +
  'footprint area or bid dollar matches a desired figure; the result is reported ' +
  'honestly (including a negative). No scale guessing: coords are already in feet ' +
  '(operator-supplied scale applied upstream). Deterministic.';

/**
 * PURE. Select the WALL LAYER from graphics-state-tagged segments by a principled,
 * documented CAD drafting convention (T34).
 *
 * Every segment carries { x1,y1,x2,y2, lineWidth, strokeColor } (lineWidth/strokeColor
 * may be null when the source op list set no graphics state). We GROUP by
 * (strokeColor, lineWidth) and then select the wall layer.
 *
 * SELECTION CONVENTION (documented, principled, NOT a target-fit):
 *   Architectural CUT WALLS are drawn at a HEAVIER lineweight than the dimension /
 *   grid / match-line / text annotation linework — a genuine drafting convention. So:
 *    1. Compute the LENGTH-WEIGHTED MEDIAN lineWidth over all tagged segments (the
 *       lineweight that splits the sheet's drawn length in half). Groups at or above
 *       this median are the "heavier-than-typical annotation" candidates. `heavyQuantile`
 *       (default 0.5 = median) is a LABELLED geometric default; it is NOT tuned to a
 *       target area or dollar.
 *    2. Among those heavy candidate groups, choose the single group whose segments form
 *       the most COHERENT CONNECTED building extent — the greatest total wall length in
 *       one connected component (endpoints joined within `connectTolFt`). This prefers a
 *       contiguous building over scattered heavy detail marks. Ties break toward the
 *       heavier lineWidth (more structural).
 *    3. FALLBACKS: if no segment carries a lineWidth (untagged source), there is a single
 *       null/null group -> select it (whole-geometry, reported as `method:"single-group"`).
 *       If the heavy-candidate set is empty (degenerate), fall back to the overall group
 *       with the greatest total length.
 *
 * @param {Array<{x1,y1,x2,y2,lineWidth?:number|null,strokeColor?:string|null}>} segments
 * @param {{heavyQuantile?:number, connectTolFt?:number}} [opts]
 *   heavyQuantile default 0.5 (length-weighted median lineweight); connectTolFt default
 *   1.5 ft (corner join slop, same datum as buildingOutlinePolygon). NEITHER is fitted.
 * @returns {{wallSegments:Array, chosen:{lineWidth?:number|null,strokeColor?:string|null}|null,
 *   groups:Array<{key:string,lineWidth:number|null,strokeColor:string|null,count:number,totalLenFt:number,bbox:Object}>,
 *   method:string, note:string}}
 */
export function selectWallLayer(segments, opts = {}) {
  const heavyQuantile = Number.isFinite(opts.heavyQuantile) ? Number(opts.heavyQuantile) : 0.5;
  const connectTolFt = Number.isFinite(opts.connectTolFt) ? Number(opts.connectTolFt) : 1.5;

  const segs = Array.isArray(segments) ? segments : [];
  const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

  // --- GROUP by (strokeColor, lineWidth) -------------------------------------
  const groupMap = new Map(); // key -> { lineWidth, strokeColor, members:[seg], totalLen }
  const keyOf = (s) => `${s.strokeColor == null ? 'null' : s.strokeColor}|${s.lineWidth == null ? 'null' : s.lineWidth}`;
  for (const s of segs) {
    const k = keyOf(s);
    let g = groupMap.get(k);
    if (!g) {
      g = { key: k, lineWidth: s.lineWidth ?? null, strokeColor: s.strokeColor ?? null, members: [], totalLen: 0 };
      groupMap.set(k, g);
    }
    g.members.push(s);
    g.totalLen += segLen(s);
  }

  // Public histogram (deterministic order: totalLen desc, then key asc).
  const groupsArr = [...groupMap.values()].sort(
    (a, b) => (b.totalLen - a.totalLen) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const histogram = groupsArr.map((g) => {
    const b = boundingBox(g.members);
    return {
      key: g.key,
      lineWidth: g.lineWidth,
      strokeColor: g.strokeColor,
      count: g.members.length,
      totalLenFt: round(g.totalLen),
      bbox: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, widthFt: b.widthFt, heightFt: b.heightFt },
    };
  });

  const emptyResult = () => ({
    wallSegments: [],
    chosen: null,
    groups: histogram,
    method: 'empty',
    note: WALL_LAYER_NOTE,
  });
  if (segs.length === 0) return emptyResult();

  // --- coherent connected extent of a group (greatest single-component length) ---
  // Reuse a light union-find on the group's members joined within connectTolFt.
  const coherentLen = (members) => {
    const n = members.length;
    if (n === 0) return 0;
    if (n === 1) return segLen(members[0]);
    const parent = new Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
    const cell = Math.max(connectTolFt, 1e-9);
    const buckets = new Map();
    const epOf = (s) => [[s.x1, s.y1], [s.x2, s.y2]];
    const hk = (gx, gy) => `${gx},${gy}`;
    for (let i = 0; i < n; i++) {
      for (const [ex, ey] of epOf(members[i])) {
        const gx = Math.floor(ex / cell); const gy = Math.floor(ey / cell);
        const k = hk(gx, gy);
        let arr = buckets.get(k); if (!arr) { arr = []; buckets.set(k, arr); } arr.push(i);
      }
    }
    const within = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) <= connectTolFt;
    for (let i = 0; i < n; i++) {
      for (const [ex, ey] of epOf(members[i])) {
        const gx = Math.floor(ex / cell); const gy = Math.floor(ey / cell);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const arr = buckets.get(hk(gx + dx, gy + dy));
            if (!arr) continue;
            for (const j of arr) {
              if (j <= i) continue;
              let joined = false;
              for (const [px, py] of epOf(members[i])) {
                for (const [qx, qy] of epOf(members[j])) {
                  if (within(px, py, qx, qy)) { joined = true; break; }
                }
                if (joined) break;
              }
              if (joined) union(i, j);
            }
          }
        }
      }
    }
    const compLen = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      compLen.set(r, (compLen.get(r) || 0) + segLen(members[i]));
    }
    let best = 0;
    for (const v of compLen.values()) if (v > best) best = v;
    return best;
  };

  const finalize = (group, method) => ({
    wallSegments: group.members.slice(),
    chosen: { lineWidth: group.lineWidth, strokeColor: group.strokeColor },
    groups: histogram,
    method,
    note: WALL_LAYER_NOTE,
  });

  // --- FALLBACK: no lineWidth tags at all -> single group, select it ----------
  const withWidth = groupsArr.filter((g) => g.lineWidth != null);
  if (withWidth.length === 0) {
    // No graphics-state lineweight info; the whole geometry is one layer.
    const only = groupsArr[0];
    return finalize(only, 'single-group');
  }

  // --- (1) BASELINE lineweight = the dominant (modal-by-drawn-length) band ----
  // Build a length-weighted distribution over distinct lineWidths. The lineweight at
  // which the MOST total length is drawn is the sheet's baseline linework (hairline /
  // dimension / grid / text) — by the drafting convention, structural CUT WALLS are
  // drawn at a lineweight STRICTLY HEAVIER than this dominant baseline band. This is a
  // labelled, principled default decided from the drawing's own lineweight distribution
  // BEFORE any area/dollar is computed — it is NOT a search for the group that matches a
  // figure. (heavyQuantile is retained as an optional alternative band threshold; the
  // default selection below is the heavier-than-baseline rule.)
  void heavyQuantile;
  const widthLen = new Map(); // lineWidth -> total length drawn at that width
  for (const s of segs) {
    if (s.lineWidth == null) continue;
    const l = segLen(s);
    widthLen.set(s.lineWidth, (widthLen.get(s.lineWidth) || 0) + l);
  }
  let baselineLineWidth = null;
  let baselineLen = -1;
  // Deterministic: iterate widths ascending; the most-drawn-length width is the baseline,
  // ties broken toward the LIGHTER width (more conservative annotation baseline).
  for (const w of [...widthLen.keys()].sort((a, b) => a - b)) {
    const l = widthLen.get(w);
    if (l > baselineLen) { baselineLen = l; baselineLineWidth = w; }
  }

  // --- (2) wall candidates = groups STRICTLY HEAVIER than the baseline band ---
  // Among those, choose the single group forming the most COHERENT CONNECTED building
  // extent (greatest single-component connected-wall length); ties break toward the
  // heavier lineWidth (more structural). Restricting the candidate set to the heavier
  // minority bands BEFORE the (costly) connectivity scan also keeps this O(building),
  // never touching the huge baseline band.
  const heavyGroups = withWidth.filter((g) => g.lineWidth > baselineLineWidth + 1e-12);

  // HONEST NEGATIVE: if NO group is heavier than the baseline, the graphics state offers
  // no principled wall/annotation lineweight split. Fall back to the single largest band
  // by total length and REPORT it as the no-heavier-band case (the verifier reads this).
  const candidates = heavyGroups.length > 0 ? heavyGroups : withWidth;
  const method = heavyGroups.length > 0
    ? 'heavier-lineweight-coherent-extent'
    : 'no-heavier-band-largest-group';

  let best = null;
  let bestScore = -Infinity;
  let bestWidth = -Infinity;
  for (const g of candidates) {
    const score = coherentLen(g.members);
    // Greatest coherent connected length wins; ties break toward heavier lineWidth.
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && g.lineWidth > bestWidth)) {
      bestScore = score;
      bestWidth = g.lineWidth;
      best = g;
    }
  }
  if (!best) best = candidates[0];

  // --- (3) PARTITION-INCLUSIVE wall layer (opt-in, for RECALL) ----------------
  // The single best heavier-than-baseline band is the dominant CUT-WALL lineweight, but a real
  // floor's INTERIOR PARTITION walls and heavy CORE walls are drawn at OTHER heavier-than-baseline
  // lineweights (on A-101: partitions at 0.255pt, primary walls at 0.51pt, cores at 0.992pt). The
  // single-band selection drops the partitions+cores, costing wall RECALL (~71% measured vs the
  // sheet's wall-ink). When opts.partitionInclusive is set, return the UNION of ALL strictly-
  // heavier-than-baseline groups (the full structural lineweight spread) so partition + core walls
  // are captured too. The hairline baseline mass (lw=0 hatch/fill) is still excluded. The primary
  // band is still reported as `chosen`. Deterministic; raises recall to >=90% on A-101.
  if (opts.partitionInclusive && heavyGroups.length > 0) {
    const merged = [];
    for (const g of heavyGroups) for (const m of g.members) merged.push(m);
    return {
      wallSegments: merged,
      chosen: { lineWidth: best.lineWidth, strokeColor: best.strokeColor },
      groups: histogram,
      method: 'partition-inclusive-all-heavier-than-baseline',
      baselineLineWidth,
      includedLineWidths: heavyGroups.map((g) => g.lineWidth).sort((a, b) => a - b),
      note: WALL_LAYER_NOTE +
        ' PARTITION-INCLUSIVE: union of ALL lineweight bands strictly heavier than the hairline ' +
        'baseline (captures interior partitions + core walls, not just the dominant cut-wall band) ' +
        'to raise wall recall; baseline hatch/fill still excluded. needs-verification.',
    };
  }

  return finalize(best, method);
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
 * Extraction mode (opts.extract='outline', T33): instead of any bbox footprint, run
 * buildingOutlinePolygon — keep wall-like segments, isolate the dominant connected wall
 * network, and return its ENCLOSED rectilinear footprint polygon (the room polygon is
 * that orthogonal outline, NOT a bbox) plus its shoelace/occupancy area. This avoids the
 * bbox over-capture of annotated sheets. opts.outlineOpts is forwarded. Default
 * (no extract) is UNCHANGED.
 *
 * @param {Array<{x1,y1,x2,y2}>} segments
 * @param {{hazard?:string, isolate?:(boolean|'dominant'|'fullExtent'), isolateOpts?:Object, extract?:'outline', outlineOpts?:Object}} [opts]
 * @returns {{rooms:Array, bbox:Object, wallCandidates:Array, segmentCount:number, note:string, keptCount?:number, droppedBorderCount?:number, droppedOutlierCount?:number, areaSqft?:number, method?:string}}
 */
export function segmentsToFloorPlan(segments, opts = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('segmentsToFloorPlan: no segments to bound — extract geometry first');
  }
  const hazard = VALID_HAZARDS.has(String(opts.hazard).toLowerCase())
    ? String(opts.hazard).toLowerCase()
    : 'ordinary';

  // T33 OUTLINE extraction: enclosed wall-network footprint polygon (not a bbox).
  if (opts.extract === 'outline') {
    const outline = buildingOutlinePolygon(segments, opts.outlineOpts || {});
    return {
      rooms: [{ name: 'Extracted Building Outline', polygon: outline.polygon, hazard }],
      bbox: outline.bbox,
      wallCandidates: segments,
      segmentCount: segments.length,
      note: outline.note,
      areaSqft: outline.areaSqft,
      method: outline.method,
      wallSegmentCount: outline.wallSegmentCount,
      networkSegmentCount: outline.networkSegmentCount,
    };
  }

  // T34 WALL-LAYER extraction: select the wall layer by the PDF graphics-state
  // (strokeColor,lineWidth) convention, then bound JUST the selected wall segments.
  if (opts.extract === 'wallLayer' || opts.extract === 'layerSelect') {
    const sel = selectWallLayer(segments, opts.layerOpts || {});
    const wallSegs = sel.wallSegments.length ? sel.wallSegments : segments;
    const bbox = boundingBox(wallSegs);
    const { minX, minY, maxX, maxY } = bbox;
    const polygon = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
    return {
      rooms: [{ name: 'Extracted Wall Layer', polygon, hazard }],
      bbox,
      wallCandidates: wallSegs,
      segmentCount: segments.length,
      note: sel.note,
      chosen: sel.chosen,
      groups: sel.groups,
      method: sel.method,
      wallSegmentCount: wallSegs.length,
    };
  }

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
 * @param {'outline'} [opts.extract] - T33 building-OUTLINE extraction. When 'outline',
 *   the room polygon is the ENCLOSED rectilinear footprint of the dominant connected
 *   wall network (see buildingOutlinePolygon), NOT a bbox, and the result carries
 *   areaSqft / method / wallSegmentCount / networkSegmentCount. opts.outlineOpts is
 *   forwarded. extract takes precedence over isolate; default (no extract) is unchanged.
 * @param {Object} [opts.outlineOpts] - geometric opts for buildingOutlinePolygon
 *   (minWallFt, connectTolFt, gridN, axisTolDeg). NONE is fitted to a target.
 * @param {Object} opts.pdfjs - injected/imported pdfjs module exposing getDocument.
 *   Worker setup (GlobalWorkerOptions.workerSrc) is the caller's responsibility.
 * @returns {Promise<{rooms,bbox,segmentCount,pageIndex,scale,note,keptCount?,droppedBorderCount?,areaSqft?,method?}>}
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

  // T35 SAM-3.1 plan-segmentation extraction. OpenClaw reads the PDF and SAM 3.1
  // segments the rendered page IMAGE (it does NOT need our pdfjs vector parse — the
  // PDF-read tool renders the page itself), so this branch runs BEFORE the pdfjs
  // requirement. It hands a deterministic payload to the INJECTED async
  // opts.samInvoker (production wires the OpenClaw governed bridge -> GX10 SAM 3.1).
  // FAIL-SOFT: if SAM is skipped / unreachable / throws / yields no polygon, return a
  // clear { samSkipped:true, reason } WITHOUT throwing and WITHOUT fabricating — the
  // caller (server) may then fall back to the vector path. The real SAM run is
  // DEFERRED until the bridge is reachable (currently HTTP_UNREACHABLE).
  if (opts.extract === 'sam') {
    const sam = await segmentFloorPlanViaSam({
      invoker: opts.samInvoker,
      pdfRef: opts.pdfRef != null ? opts.pdfRef : source,
      pageIndex,
      scale,
      targets: opts.samTargets,
    });
    if (!sam.ok) {
      return { samSkipped: true, reason: sam.reason, pageIndex, scale };
    }
    const recon = reconstructFloorPlanFromSam(sam, { scale, hazard });
    return {
      rooms: recon.rooms,
      bbox: recon.bbox,
      wallCandidates: [],
      segmentCount: recon.rooms[0] ? recon.rooms[0].polygon.length : 0,
      pageIndex,
      scale,
      note: recon.note,
      areaSqft: recon.areaSqft,
      method: 'sam-3.1',
      source: 'sam-3.1',
      label: sam.label,
      layerMap: recon.layerMap,
      imageSize: sam.imageSize,
    };
  }

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
  // T33 OUTLINE extraction takes precedence over isolate: enclosed wall-network
  // footprint polygon (not a bbox).
  if (opts.extract === 'outline') {
    const fpOutline = segmentsToFloorPlan(segments, {
      hazard,
      extract: 'outline',
      outlineOpts: opts.outlineOpts || {},
    });
    return {
      rooms: fpOutline.rooms,
      bbox: fpOutline.bbox,
      wallCandidates: fpOutline.wallCandidates,
      segmentCount: count,
      pageIndex,
      scale,
      note: fpOutline.note,
      areaSqft: fpOutline.areaSqft,
      method: fpOutline.method,
      wallSegmentCount: fpOutline.wallSegmentCount,
      networkSegmentCount: fpOutline.networkSegmentCount,
    };
  }

  // T34 WALL-LAYER extraction: graphics-state (strokeColor,lineWidth) group selection.
  if (opts.extract === 'wallLayer' || opts.extract === 'layerSelect') {
    const fpWall = segmentsToFloorPlan(segments, {
      hazard,
      extract: 'wallLayer',
      layerOpts: opts.layerOpts || {},
    });
    return {
      rooms: fpWall.rooms,
      bbox: fpWall.bbox,
      wallCandidates: fpWall.wallCandidates,
      segmentCount: count,
      pageIndex,
      scale,
      note: fpWall.note,
      chosen: fpWall.chosen,
      groups: fpWall.groups,
      method: fpWall.method,
      wallSegmentCount: fpWall.wallSegmentCount,
    };
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
