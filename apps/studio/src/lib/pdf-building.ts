// T47 — BUILDING vector-PDF-first lane (DETERMINISTIC core).
//
// From a VECTOR bid PDF, deterministically extract wall polylines into a building
// footprint so the studio can render it in 3D. NO SAM, NO GPU, NO OpenClaw — this
// module is a PURE, unit-testable TypeScript port of the PROVEN algorithm in
// apps/autosprink/src/engine/pdf-floorplan.js (extractSegmentsFromOpList CTM-aware,
// parseArchitecturalScale, buildingOutlinePolygon). Only loadPdfVectorPage touches
// pdfjs, and pdfjs is INJECTABLE so the unit tests never need a real PDF.
//
// HONESTY (hard, fail-closed):
//  - The extracted geometry is REAL — it is the plan's own vector path ops, never
//    fabricated. We do NOT invent a footprint when no usable wall geometry exists
//    (segmentsToFootprint returns a clear empty/skipped result instead).
//  - The PDF-point -> feet scale is OPERATOR/DRAWING-SUPPLIED. We NEVER guess or
//    auto-derive it from geometry. segmentsToFootprint THROWS if scaleFtPerUnit is
//    missing or <= 0, exactly like a CAD import unit.
//  - The footprint is a BEST-EFFORT vector-geometry extraction — NOT AHJ, NOT
//    PE-sealed, NOT code-compliant, NOT a permit drawing, NOT for construction.
//
// pdfjs operator-list shapes handled for path construction mirror the autosprink
// engine: legacy top-level ops (moveTo/lineTo/curveTo/rectangle/closePath), legacy
// batched constructPath [opsArray, coordsArray], and modern v6 batched constructPath
// [opType, [pathBuffer], minMax] where pathBuffer is a flat DrawOPS-coded typed array.

import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

/* ------------------------------------------------------------------ types */

/** A single extracted line segment in OPERATOR-SCALED units (feet once scaled). */
export interface VectorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke lineWidth at emit time (null until a graphics-state op sets it). */
  lineWidth?: number | null;
  /** Normalized stroke color "#rrggbb" (null until a color op sets it). */
  strokeColor?: string | null;
}

/** Axis-aligned bounding box over a segment set, in the same units as segments. */
export interface SegmentBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  widthFt: number;
  heightFt: number;
}

/** A pdfjs operator list as returned by page.getOperatorList(). */
export interface PdfOpList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

/** Minimal pdfjs viewport shape (optional; CTM handling is internal). */
export interface PdfViewport {
  width?: number;
  height?: number;
  scale?: number;
}

/** Options for extractVectorSegments. */
export interface ExtractOpts {
  /** Feet per PDF point. Default 1 (raw points). Operator-supplied. */
  scale?: number;
}

/** Result of extractVectorSegments. */
export interface ExtractResult {
  segments: VectorSegment[];
  bbox: SegmentBBox;
  count: number;
}

/** Options for segmentsToFootprint. */
export interface FootprintOpts {
  /**
   * Feet per extracted-unit. REQUIRED, must be > 0. Operator/drawing-supplied,
   * NEVER guessed. If segments are already in feet (scale applied upstream by
   * extractVectorSegments), pass 1.
   */
  scaleFtPerUnit: number;
  /** Minimum wall run length in feet (drops witness ticks / text strokes). */
  minWallFt?: number;
  /** Corner join tolerance in feet. */
  connectTolFt?: number;
  /** Occupancy-grid raster resolution. */
  gridN?: number;
  /** Orthogonality tolerance in degrees. */
  axisTolDeg?: number;
}

/** Result of segmentsToFootprint. */
export interface FootprintResult {
  /** Outline polygon points [x,y] in feet (empty when no footprint found). */
  outline: Array<[number, number]>;
  /** Building bbox dimensions in feet: { w, l }. */
  bboxFt: { w: number; l: number };
  /** Enclosed footprint area in square feet (shoelace / occupancy grid). */
  areaSqft: number;
  /** Count of wall-like segments retained after filtering. */
  wallSegmentCount: number;
  /** Count of segments in the dominant connected wall network. */
  networkSegmentCount: number;
  /** Extraction method / fallback reported honestly. */
  method: string;
  /** Honesty note (best-effort, operator-supplied scale, not AHJ/PE). */
  note: string;
  /** True when no usable wall geometry was found — NOT a fabricated footprint. */
  empty: boolean;
}

/* ----------------------------------------------------------------- consts */

// pdfjs-internal DrawOPS codes for the v6 constructPath path buffer (stable wire
// contract; mirrored here so the pure core needs no worker import).
const DRAW_OP = Object.freeze({
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
});
const DRAW_OP_ARITY: Record<number, number> = Object.freeze({
  [DRAW_OP.moveTo]: 2,
  [DRAW_OP.lineTo]: 2,
  [DRAW_OP.curveTo]: 6,
  [DRAW_OP.quadraticCurveTo]: 4,
  [DRAW_OP.closePath]: 0,
});

export const FOOTPRINT_NOTE =
  'BEST-EFFORT vector-geometry extraction (T47): the building footprint is traced ' +
  'from the plan’s own vector wall linework. The PDF-point->feet scale is ' +
  'OPERATOR/DRAWING-supplied and is NEVER guessed. This is NOT an AHJ-approved, ' +
  'NOT a PE-sealed, NOT a code-compliant, and NOT a permit / for-construction ' +
  'drawing. No accuracy or parity is claimed. Deterministic.';

/* ----------------------------------------------------------------- utils */

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

function hexByte(v: number): string {
  let n = Math.round(v);
  if (n < 0) n = 0;
  else if (n > 255) n = 255;
  return n.toString(16).padStart(2, '0');
}

/**
 * PURE. Normalize the stroke-color argument of a pdfjs color op to "#rrggbb"
 * (lowercase), or null when no plain RGB color is present. Mirrors the autosprink
 * engine: pdfjs v6 normalizes color ops to a hex STRING; older/raw forms pass a
 * packed integer 0xRRGGBB or an [r,g,b] array (0..1 floats or 0..255 ints).
 */
export function normalizeStrokeColorArg(arg: unknown): string | null {
  let v: unknown = arg;
  if (Array.isArray(arg) && arg.length === 1) v = arg[0];

  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    const m = t.match(/^#?([0-9a-f]{6})$/);
    if (m) return `#${m[1]}`;
    const m3 = t.match(/^#?([0-9a-f]{3})$/);
    if (m3) {
      const [r, g, b] = m3[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = v >>> 0;
    return `#${hexByte((n >> 16) & 0xff)}${hexByte((n >> 8) & 0xff)}${hexByte(n & 0xff)}`;
  }
  const isNumArr = (x: unknown): x is number[] =>
    Array.isArray(x) && x.length >= 3 && x.every((c) => typeof c === 'number');
  const asArr = isNumArr(arg) ? arg : isNumArr(v) ? v : null;
  if (asArr) {
    const [r, g, b] = asArr;
    const max = Math.max(r, g, b);
    const scale = max <= 1 + 1e-9 ? 255 : 1;
    return `#${hexByte(r * scale)}${hexByte(g * scale)}${hexByte(b * scale)}`;
  }
  return null;
}

function boundingBox(segments: VectorSegment[]): SegmentBBox {
  if (!segments.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthFt: 0, heightFt: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
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

/* ------------------------------------------------- extractVectorSegments */

/**
 * PURE. Walk a pdfjs operator list and emit typed line segments. Coordinates are
 * mapped through the Current Transformation Matrix (CTM) to PAGE SPACE before the
 * operator-supplied feet-per-point `scale` is applied, so model-space sheets blown
 * up by a base transform are captured at full extent (mirrors the autosprink core).
 *
 * The optional `viewport` is accepted for API parity; CTM handling is internal and
 * the identity CTM leaves synthetic op lists unchanged.
 */
export function extractVectorSegments(
  opList: PdfOpList | null | undefined,
  viewport?: PdfViewport | ExtractOpts,
  opts: ExtractOpts = {},
): ExtractResult {
  // Allow either (opList, opts) or (opList, viewport, opts). If the 2nd arg looks
  // like ExtractOpts (has `scale` but no width/height), treat it as opts.
  let effectiveOpts = opts;
  if (
    viewport &&
    typeof viewport === 'object' &&
    'scale' in viewport &&
    !('width' in viewport) &&
    !('height' in viewport) &&
    Object.keys(opts).length === 0
  ) {
    effectiveOpts = viewport as ExtractOpts;
  }

  const scale = Number.isFinite(effectiveOpts.scale) ? Number(effectiveOpts.scale) : 1;
  const fnArray = opList?.fnArray ?? [];
  const argsArray = opList?.argsArray ?? [];

  const segments: VectorSegment[] = [];
  let cur: [number, number] | null = null;
  let start: [number, number] | null = null;

  let ctm = [1, 0, 0, 1, 0, 0];
  let gsLineWidth: number | null = null;
  let gsStrokeColor: string | null = null;
  const ctmStack: number[][] = [];
  const gsStack: Array<{ lineWidth: number | null; strokeColor: string | null }> = [];

  const applyCtm = (x: number, y: number): [number, number] => [
    ctm[0] * x + ctm[2] * y + ctm[4],
    ctm[1] * x + ctm[3] * y + ctm[5],
  ];
  const multiplyCtm = (m: number[]): void => {
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

  const emit = (x1: number, y1: number, x2: number, y2: number): void => {
    const seg: VectorSegment = {
      x1: round(x1 * scale),
      y1: round(y1 * scale),
      x2: round(x2 * scale),
      y2: round(y2 * scale),
    };
    if (gsLineWidth !== null) seg.lineWidth = gsLineWidth;
    if (gsStrokeColor !== null) seg.strokeColor = gsStrokeColor;
    segments.push(seg);
  };
  const moveTo = (rx: number, ry: number): void => {
    const [x, y] = applyCtm(rx, ry);
    cur = [x, y];
    start = [x, y];
  };
  const lineTo = (rx: number, ry: number): void => {
    const [x, y] = applyCtm(rx, ry);
    if (cur) emit(cur[0], cur[1], x, y);
    else start = [x, y];
    cur = [x, y];
  };
  const closePath = (): void => {
    if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) {
      emit(cur[0], cur[1], start[0], start[1]);
    }
    if (start) cur = [start[0], start[1]];
  };
  const rectangle = (x: number, y: number, w: number, h: number): void => {
    moveTo(x, y);
    lineTo(x + w, y);
    lineTo(x + w, y + h);
    lineTo(x, y + h);
    closePath();
  };

  const walkDrawBuffer = (buf: ArrayLike<number>): void => {
    let i = 0;
    const n = buf.length;
    while (i < n) {
      const code = buf[i] | 0;
      const arity = DRAW_OP_ARITY[code];
      if (arity === undefined) break;
      const a = buf;
      switch (code) {
        case DRAW_OP.moveTo:
          moveTo(a[i + 1], a[i + 2]);
          break;
        case DRAW_OP.lineTo:
          lineTo(a[i + 1], a[i + 2]);
          break;
        case DRAW_OP.curveTo:
          lineTo(a[i + 5], a[i + 6]);
          break;
        case DRAW_OP.quadraticCurveTo:
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

  const walkLegacyConstructPath = (
    subOps: ArrayLike<number>,
    coords: ArrayLike<number>,
  ): void => {
    let c = 0;
    for (let k = 0; k < subOps.length; k++) {
      const sub = subOps[k];
      switch (sub) {
        case OPS.moveTo:
          moveTo(coords[c], coords[c + 1]);
          c += 2;
          break;
        case OPS.lineTo:
          lineTo(coords[c], coords[c + 1]);
          c += 2;
          break;
        case OPS.curveTo:
          lineTo(coords[c + 4], coords[c + 5]);
          c += 6;
          break;
        case OPS.curveTo2:
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

  const constructPathDispatch = (args: unknown[]): void => {
    const a0 = args[0];
    const a1 = args[1];
    if (
      Array.isArray(a1) &&
      a1[0] != null &&
      typeof a1[0] !== 'number' &&
      typeof (a1[0] as ArrayLike<number>).length === 'number'
    ) {
      walkDrawBuffer(a1[0] as ArrayLike<number>);
      return;
    }
    if (Array.isArray(a0) && Array.isArray(a1)) {
      walkLegacyConstructPath(a0 as number[], a1 as number[]);
      return;
    }
    if (
      a0 != null &&
      typeof (a0 as ArrayLike<number>).length === 'number' &&
      a1 != null &&
      typeof (a1 as ArrayLike<number>).length === 'number' &&
      typeof a0 !== 'string' &&
      typeof a1 !== 'string'
    ) {
      walkLegacyConstructPath(
        Array.from(a0 as ArrayLike<number>),
        Array.from(a1 as ArrayLike<number>),
      );
    }
  };

  for (let k = 0; k < fnArray.length; k++) {
    const fn = fnArray[k];
    const args = (argsArray[k] as unknown[]) || [];
    switch (fn) {
      case OPS.moveTo:
        moveTo(args[0] as number, args[1] as number);
        break;
      case OPS.lineTo:
        lineTo(args[0] as number, args[1] as number);
        break;
      case OPS.curveTo:
        lineTo(args[4] as number, args[5] as number);
        break;
      case OPS.curveTo2:
      case OPS.curveTo3:
        lineTo(args[2] as number, args[3] as number);
        break;
      case OPS.rectangle:
        rectangle(
          args[0] as number,
          args[1] as number,
          args[2] as number,
          args[3] as number,
        );
        break;
      case OPS.closePath:
        closePath();
        break;
      case OPS.constructPath:
        constructPathDispatch(args);
        break;
      case OPS.save:
        ctmStack.push(ctm.slice());
        gsStack.push({ lineWidth: gsLineWidth, strokeColor: gsStrokeColor });
        break;
      case OPS.restore:
        if (ctmStack.length) ctm = ctmStack.pop() as number[];
        if (gsStack.length) {
          const g = gsStack.pop() as { lineWidth: number | null; strokeColor: string | null };
          gsLineWidth = g.lineWidth;
          gsStrokeColor = g.strokeColor;
        }
        break;
      case OPS.transform:
        if (args.length >= 6) {
          multiplyCtm([
            args[0] as number,
            args[1] as number,
            args[2] as number,
            args[3] as number,
            args[4] as number,
            args[5] as number,
          ]);
        }
        break;
      case OPS.setLineWidth: {
        const w = Number(args[0]);
        if (Number.isFinite(w)) gsLineWidth = w;
        break;
      }
      case OPS.setStrokeRGBColor:
      case OPS.setStrokeColor:
      case OPS.setStrokeColorN: {
        const c = normalizeStrokeColorArg(args);
        if (c !== null) gsStrokeColor = c;
        break;
      }
      default:
        break;
    }
  }

  const bbox = boundingBox(segments);
  return { segments, bbox, count: segments.length };
}

/* ----------------------------------------------- parseArchitecturalScale */

// Parse "a", "a.b", "a/b", or mixed "a b/c" into a Number. Returns NaN on junk.
function parseNumberOrFraction(token: string): number {
  const t = String(token).trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den === 0) return NaN;
    return whole + num / den;
  }
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den === 0) return NaN;
    return num / den;
  }
  if (/^\d*\.?\d+$/.test(t)) return Number(t);
  return NaN;
}

/**
 * PURE. Parse a STATED architectural drawing scale out of sheet text and return
 * the feet-per-PDF-point conversion factor, or null when none is present.
 *
 * Recognized form (whitespace/symbol tolerant):
 *   [SCALE[:]] <lhs inches> " = <rhs feet> ' [- 0"]
 * Conversion: feetPerPoint = (rhsFeet / lhsInches) / 72 (72 points per inch).
 * Examples: 3/32" = 1'-0" -> 0.148148..., 1/8" = 1'-0" -> 0.111111...,
 *           1/16" = 1'-0" -> 0.222222..., 1" = 20' -> 0.277778...
 *
 * This DERIVES the scale FROM THE DRAWING (a printed datum) — it is NOT a guess and
 * NOT an auto-derivation from geometry. The caller still must PASS it explicitly.
 */
export function parseArchitecturalScale(text: string): number | null {
  if (typeof text !== 'string' || !text.trim()) return null;

  const norm = text
    .replace(/[′‘’´]/g, "'") // primes / curly singles -> '
    .replace(/[″“”]/g, '"'); // double-primes / curly doubles -> "

  const re = new RegExp(
    String.raw`(?:scale\s*:?\s*)?` +
      String.raw`(\d+(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?|\d*\.\d+)` + // (1) lhs inches
      String.raw`\s*"` +
      String.raw`\s*=\s*` +
      String.raw`(\d+(?:\.\d+)?)` + // (2) rhs feet
      String.raw`\s*'` +
      String.raw`(?:\s*-\s*0\s*")?`,
    'i',
  );

  const m = norm.match(re);
  if (!m) return null;

  const lhsInches = parseNumberOrFraction(m[1]);
  const rhsFeet = Number(m[2]);
  if (!Number.isFinite(lhsInches) || lhsInches <= 0) return null;
  if (!Number.isFinite(rhsFeet) || rhsFeet <= 0) return null;

  return rhsFeet / lhsInches / 72;
}

/* ------------------------------------------------- segmentsToFootprint */

/**
 * PURE helper. Trace the outer boundary of a filled cell mask into a single closed
 * rectilinear polygon in FEET (mirrors autosprink traceFilledBoundary).
 */
function traceFilledBoundary(
  filled: Uint8Array,
  gridN: number,
  originX: number,
  originY: number,
  cw: number,
  ch: number,
): Array<[number, number]> | null {
  const isFilled = (cx: number, cy: number): boolean =>
    cx >= 0 && cy >= 0 && cx < gridN && cy < gridN && filled[cy * gridN + cx] === 1;
  const edges = new Map<string, Array<[number, number]>>();
  const cornerKey = (gx: number, gy: number): string => `${gx},${gy}`;
  const addEdge = (x1: number, y1: number, x2: number, y2: number): void => {
    const k = cornerKey(x1, y1);
    let arr = edges.get(k);
    if (!arr) {
      arr = [];
      edges.set(k, arr);
    }
    arr.push([x2, y2]);
  };
  for (let cy = 0; cy < gridN; cy++) {
    for (let cx = 0; cx < gridN; cx++) {
      if (!isFilled(cx, cy)) continue;
      if (!isFilled(cx, cy - 1)) addEdge(cx, cy, cx + 1, cy);
      if (!isFilled(cx, cy + 1)) addEdge(cx + 1, cy + 1, cx, cy + 1);
      if (!isFilled(cx - 1, cy)) addEdge(cx, cy + 1, cx, cy);
      if (!isFilled(cx + 1, cy)) addEdge(cx + 1, cy, cx + 1, cy + 1);
    }
  }
  if (edges.size === 0) return null;

  let startKey: string | null = null;
  for (const k of edges.keys()) {
    if (startKey === null) {
      startKey = k;
      continue;
    }
    const [ax, ay] = startKey.split(',').map(Number);
    const [bx, by] = k.split(',').map(Number);
    if (bx < ax || (bx === ax && by < ay)) startKey = k;
  }
  const parseKey = (k: string): number[] => k.split(',').map(Number);
  const loop: Array<[number, number]> = [];
  let curKey = startKey as string;
  const used = new Set<string>();
  let guard = 0;
  const maxSteps = edges.size * 4 + 16;
  while (guard++ < maxSteps) {
    const outs = edges.get(curKey);
    if (!outs || outs.length === 0) break;
    let nextPt: [number, number] | null = null;
    for (const cand of outs) {
      const ek = `${curKey}->${cand[0]},${cand[1]}`;
      if (!used.has(ek)) {
        nextPt = cand;
        used.add(ek);
        break;
      }
    }
    if (!nextPt) break;
    const [cx, cy] = parseKey(curKey);
    loop.push([cx, cy]);
    const nk = cornerKey(nextPt[0], nextPt[1]);
    if (nk === startKey) break;
    curKey = nk;
  }
  if (loop.length < 4) return null;

  const merged: Array<[number, number]> = [];
  for (let i = 0; i < loop.length; i++) {
    const prev = loop[(i - 1 + loop.length) % loop.length];
    const cur2 = loop[i];
    const next = loop[(i + 1) % loop.length];
    const d1x = cur2[0] - prev[0];
    const d1y = cur2[1] - prev[1];
    const d2x = next[0] - cur2[0];
    const d2y = next[1] - cur2[1];
    if (d1x * d2y - d1y * d2x !== 0 || (d1x === 0 && d1y === 0)) merged.push(cur2);
  }
  const src = merged.length >= 4 ? merged : loop;
  return src.map(([gx, gy]) => [originX + gx * cw, originY + gy * ch] as [number, number]);
}

/**
 * PURE. Reduce a raw segment set to a building FOOTPRINT.
 *
 * Steps (deterministic, geometric defaults — NONE fitted to any area/dollar):
 *  1. Apply the operator-supplied scaleFtPerUnit so all coordinates are in feet.
 *  2. WALL-LIKE FILTER: keep near-axis-aligned segments (within axisTolDeg) that
 *     are at least minWallFt long — drops witness lines / text strokes / hatching.
 *  3. DOMINANT CONNECTED WALL NETWORK: union-find join wall endpoints within
 *     connectTolFt, take the component with the greatest total wall length.
 *  4. ENCLOSED RECTILINEAR FOOTPRINT: rasterize the network onto a gridN occupancy
 *     grid, flood-fill the exterior, the enclosed cells + walls are the footprint;
 *     trace its outer rectilinear boundary; the area is the occupancy-grid area.
 *
 * THROWS if scaleFtPerUnit is missing or <= 0 (scale is operator-supplied, never
 * guessed). When NO usable wall geometry is found, returns a clear EMPTY result
 * (empty:true, no polygon) — it NEVER fabricates a footprint.
 */
export function segmentsToFootprint(
  segments: VectorSegment[],
  opts: FootprintOpts,
): FootprintResult {
  const scaleFtPerUnit = Number(opts?.scaleFtPerUnit);
  if (!Number.isFinite(scaleFtPerUnit) || scaleFtPerUnit <= 0) {
    throw new Error(
      'segmentsToFootprint: a positive `scaleFtPerUnit` (feet per extracted unit) is ' +
        'REQUIRED — it is operator/drawing-supplied (like a CAD import unit) and is ' +
        'NEVER guessed. Pass 1 if segments are already in feet.',
    );
  }

  const minWallFt = Number.isFinite(opts.minWallFt) ? Number(opts.minWallFt) : 3;
  const connectTolFt = Number.isFinite(opts.connectTolFt) ? Number(opts.connectTolFt) : 1.5;
  const gridN = Number.isInteger(opts.gridN) && (opts.gridN as number) > 1 ? (opts.gridN as number) : 140;
  const axisTolDeg = Number.isFinite(opts.axisTolDeg) ? Number(opts.axisTolDeg) : 5;
  const axisTol = Math.tan((axisTolDeg * Math.PI) / 180);

  const raw = Array.isArray(segments) ? segments : [];

  // (1) Scale into feet.
  const segs: VectorSegment[] = raw.map((s) => ({
    x1: s.x1 * scaleFtPerUnit,
    y1: s.y1 * scaleFtPerUnit,
    x2: s.x2 * scaleFtPerUnit,
    y2: s.y2 * scaleFtPerUnit,
    lineWidth: s.lineWidth ?? null,
    strokeColor: s.strokeColor ?? null,
  }));

  const emptyResult = (method: string): FootprintResult => ({
    outline: [],
    bboxFt: { w: 0, l: 0 },
    areaSqft: 0,
    wallSegmentCount: 0,
    networkSegmentCount: 0,
    method,
    note: FOOTPRINT_NOTE,
    empty: true,
  });

  const full = boundingBox(segs);
  if (segs.length === 0 || full.widthFt <= 0 || full.heightFt <= 0) {
    return emptyResult('empty-no-geometry');
  }

  // (2) WALL-LIKE FILTER.
  const segLen = (s: VectorSegment): number => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const isAxisAligned = (s: VectorSegment): boolean => {
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    if (dx === 0 || dy === 0) return true;
    return dy / dx <= axisTol || dx / dy <= axisTol;
  };
  const walls = segs.filter((s) => segLen(s) >= minWallFt && isAxisAligned(s));

  // No walls survived -> EMPTY result (never fabricate a footprint).
  if (walls.length === 0) {
    return emptyResult('empty-no-walls');
  }

  // (3) DOMINANT CONNECTED WALL NETWORK (union-find via spatial hash).
  const parent = new Array(walls.length);
  for (let i = 0; i < walls.length; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const cell = Math.max(connectTolFt, 1e-9);
  const hashKey = (gx: number, gy: number): string => `${gx},${gy}`;
  const buckets = new Map<string, number[]>();
  const endpointsOf = (s: VectorSegment): Array<[number, number]> => [
    [s.x1, s.y1],
    [s.x2, s.y2],
  ];
  for (let i = 0; i < walls.length; i++) {
    for (const [ex, ey] of endpointsOf(walls[i])) {
      const gx = Math.floor(ex / cell);
      const gy = Math.floor(ey / cell);
      const k = hashKey(gx, gy);
      let arr = buckets.get(k);
      if (!arr) {
        arr = [];
        buckets.set(k, arr);
      }
      arr.push(i);
    }
  }
  const within = (ax: number, ay: number, bx: number, by: number): boolean =>
    Math.hypot(ax - bx, ay - by) <= connectTolFt;
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
            let joined = false;
            for (const [px, py] of endpointsOf(walls[i])) {
              for (const [qx, qy] of endpointsOf(walls[j])) {
                if (within(px, py, qx, qy)) {
                  joined = true;
                  break;
                }
              }
              if (joined) break;
            }
            if (joined) union(i, j);
          }
        }
      }
    }
  }

  const compLen = new Map<number, number>();
  const compMembers = new Map<number, number[]>();
  for (let i = 0; i < walls.length; i++) {
    const r = find(i);
    compLen.set(r, (compLen.get(r) || 0) + segLen(walls[i]));
    let m = compMembers.get(r);
    if (!m) {
      m = [];
      compMembers.set(r, m);
    }
    m.push(i);
  }
  let bestRoot: number | null = null;
  let bestLen = -1;
  for (const [r, len] of [...compLen.entries()].sort((a, b) => a[0] - b[0])) {
    if (len > bestLen) {
      bestLen = len;
      bestRoot = r;
    }
  }
  const network = (compMembers.get(bestRoot as number) as number[]).map((i) => walls[i]);
  const netBbox = boundingBox(network);

  // Network degenerate -> EMPTY result (never fabricate).
  if (network.length < 3 || netBbox.widthFt <= 0 || netBbox.heightFt <= 0) {
    return {
      ...emptyResult('empty-degenerate-network'),
      wallSegmentCount: walls.length,
      networkSegmentCount: network.length,
    };
  }

  // (4) ENCLOSED RECTILINEAR FOOTPRINT via occupancy grid.
  const nbW = netBbox.maxX - netBbox.minX;
  const nbH = netBbox.maxY - netBbox.minY;
  const cw = nbW / gridN;
  const ch = nbH / gridN;
  const cellArea = cw * ch;
  const wall = new Uint8Array(gridN * gridN);
  const idx = (cx: number, cy: number): number => cy * gridN + cx;
  const clampC = (v: number): number => (v < 0 ? 0 : v >= gridN ? gridN - 1 : v);
  const toCx = (x: number): number => clampC(Math.floor((x - netBbox.minX) / cw));
  const toCy = (y: number): number => clampC(Math.floor((y - netBbox.minY) / ch));
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

  const exterior = new Uint8Array(gridN * gridN);
  const stack: number[] = [];
  const pushIf = (cx: number, cy: number): void => {
    if (cx < 0 || cy < 0 || cx >= gridN || cy >= gridN) return;
    const k = idx(cx, cy);
    if (exterior[k] || wall[k]) return;
    exterior[k] = 1;
    stack.push(k);
  };
  for (let cx = 0; cx < gridN; cx++) {
    pushIf(cx, 0);
    pushIf(cx, gridN - 1);
  }
  for (let cy = 0; cy < gridN; cy++) {
    pushIf(0, cy);
    pushIf(gridN - 1, cy);
  }
  while (stack.length) {
    const k = stack.pop() as number;
    const cx = k % gridN;
    const cy = (k - cx) / gridN;
    pushIf(cx - 1, cy);
    pushIf(cx + 1, cy);
    pushIf(cx, cy - 1);
    pushIf(cx, cy + 1);
  }

  let footprintCells = 0;
  const filled = new Uint8Array(gridN * gridN);
  for (let k = 0; k < gridN * gridN; k++) {
    if (wall[k] || !exterior[k]) {
      filled[k] = 1;
      footprintCells++;
    }
  }
  const footprintAreaSqft = footprintCells * cellArea;

  const polygon = traceFilledBoundary(filled, gridN, netBbox.minX, netBbox.minY, cw, ch);

  let outPoly = polygon;
  let method = 'wall-network-occupancy-grid';
  if (!outPoly || outPoly.length < 4) {
    outPoly = [
      [netBbox.minX, netBbox.minY],
      [netBbox.maxX, netBbox.minY],
      [netBbox.maxX, netBbox.maxY],
      [netBbox.minX, netBbox.maxY],
    ];
    method = 'wall-network-bbox';
  }

  const areaSqft = round(footprintAreaSqft);

  return {
    outline: outPoly.map(([x, y]) => [round(x), round(y)] as [number, number]),
    bboxFt: { w: netBbox.widthFt, l: netBbox.heightFt },
    areaSqft,
    wallSegmentCount: walls.length,
    networkSegmentCount: network.length,
    method,
    note: FOOTPRINT_NOTE,
    empty: false,
  };
}

/* ------------------------------------------------- loadPdfVectorPage */

/** Minimal pdfjs module shape needed by loadPdfVectorPage (injectable for tests). */
export interface PdfjsLike {
  getDocument(params: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
  }): { promise: Promise<PdfDocumentLike> };
}
export interface PdfDocumentLike {
  numPages?: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}
export interface PdfPageLike {
  getOperatorList(): Promise<PdfOpList>;
  getViewport?(params: { scale: number }): PdfViewport;
}

/** Options for loadPdfVectorPage. */
export interface LoadPdfOpts {
  /** 0-based page index (page pageIndex+1 is parsed). Default 0. */
  pageIndex?: number;
  /** Feet per PDF point. Operator-supplied; forwarded to extractVectorSegments. */
  scale?: number;
}

/**
 * IMPURE (the only impure part). Load a vector PDF page via an INJECTED pdfjs
 * module, get its operator list, and run extractVectorSegments. pdfjs is injectable
 * so unit tests use a mock and never depend on a real PDF / worker / canvas.
 */
export async function loadPdfVectorPage(
  pdfBytes: Uint8Array | ArrayBuffer,
  pageIndex: number,
  pdfjs: PdfjsLike,
  opts: LoadPdfOpts = {},
): Promise<ExtractResult & { pageIndex: number; scale: number }> {
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
    throw new Error('loadPdfVectorPage: a pdfjs module with getDocument must be provided');
  }
  const idx = Number.isInteger(pageIndex) ? pageIndex : 0;
  const scale = Number.isFinite(opts.scale) ? Number(opts.scale) : 1;

  const data = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(idx + 1); // pdfjs pages are 1-based
  const opList = await page.getOperatorList();
  const viewport = typeof page.getViewport === 'function' ? page.getViewport({ scale: 1 }) : undefined;

  const result = extractVectorSegments(opList, viewport, { scale });
  return { ...result, pageIndex: idx, scale };
}
