// HaloFire CAD — PURE DXF import (no React / three / DOM). Parses a DXF text body
// via dxf-parser into typed lines + polylines + bounds + a REAL scale read from the
// DXF's own coordinate system, and pulls candidate wall polylines.
//
// Why DXF is the reliable lane: a DXF carries TRUE drawing coordinates and a units
// header ($INSUNITS). Unlike a raster/vector PDF — where the point->feet factor must
// be guessed or operator-supplied (the old vector path overshot real sets 4.62x) —
// the DXF tells us its units, so we can convert to feet deterministically with no
// magic number. When $INSUNITS is absent we DO NOT guess a multiplier: we report the
// units as 'unitless' and leave ftPerUnit = 1 (coordinates are taken as-authored),
// and the operator can still verify/override via the two-point set-scale tool.
//
// HONESTY: geometry returned is the DXF's OWN linework, never fabricated. Bad/empty
// input fails SOFT to an empty, clearly-flagged result (ok:false) instead of
// throwing or inventing a plan. Wall candidates are a best-effort filter, NOT an
// as-built / AHJ / PE model.

import type { Point2, Wall } from './model';
import { makeId } from './model';

/* ----------------------------------------------------------------- types */

/** DXF $INSUNITS code -> a human units tag + feet-per-unit conversion. */
export type DxfUnits =
  | 'unitless'
  | 'inches'
  | 'feet'
  | 'millimeters'
  | 'centimeters'
  | 'meters';

/** A straight line segment pulled from a DXF, in DXF coordinate units. */
export interface DxfLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  layer: string;
}

/** A polyline (LWPOLYLINE / POLYLINE) pulled from a DXF, in DXF units. */
export interface DxfPolyline {
  points: Point2[];
  closed: boolean;
  layer: string;
}

/** A circle pulled from a DXF, in DXF units (sprinkler heads in kernel DXFs). */
export interface DxfCircle {
  cx: number;
  cy: number;
  r: number;
  layer: string;
}

/** Axis-aligned bounds over the parsed geometry, in DXF units. */
export interface DxfBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Result of parseDxf. `ok:false` is the fail-soft empty state with a reason. */
export interface ParsedDxf {
  ok: boolean;
  /** Units declared by the DXF ($INSUNITS); 'unitless' when none/unknown. */
  units: DxfUnits;
  /**
   * Feet represented by one DXF coordinate unit, derived from `units`. 1 when the
   * DXF is unitless or already in feet — NEVER a guessed magic number.
   */
  ftPerUnit: number;
  /** Distinct layer names seen on geometry. */
  layers: string[];
  lines: DxfLine[];
  polylines: DxfPolyline[];
  /** CIRCLE entities (kernel DXFs draw sprinkler heads as circles). */
  circles: DxfCircle[];
  bounds: DxfBounds;
  /** Human note when ok:false (bad parse / empty / no geometry). */
  reason?: string;
}

/** Minimal dxf-parser shape we depend on (injectable for tests). */
export interface DxfParserLike {
  parseSync(source: string): unknown;
}

/* ------------------------------------------------------------- unit table */

// AutoCAD $INSUNITS enumeration (subset we map). Anything else -> unitless (ft/unit 1).
const INSUNITS: Record<number, { units: DxfUnits; ftPerUnit: number }> = {
  0: { units: 'unitless', ftPerUnit: 1 },
  1: { units: 'inches', ftPerUnit: 1 / 12 },
  2: { units: 'feet', ftPerUnit: 1 },
  4: { units: 'millimeters', ftPerUnit: 1 / 304.8 },
  5: { units: 'centimeters', ftPerUnit: 1 / 30.48 },
  6: { units: 'meters', ftPerUnit: 3.280839895 },
};

const EMPTY_BOUNDS: DxfBounds = {
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
  width: 0,
  height: 0,
};

function emptyResult(reason: string): ParsedDxf {
  return {
    ok: false,
    units: 'unitless',
    ftPerUnit: 1,
    layers: [],
    lines: [],
    polylines: [],
    circles: [],
    bounds: { ...EMPTY_BOUNDS },
    reason,
  };
}

/* ------------------------------------------------------------- helpers */

interface DxfPointish {
  x?: number;
  y?: number;
}
interface DxfEntityish {
  type?: string;
  layer?: string;
  vertices?: DxfPointish[];
  center?: DxfPointish;
  radius?: number;
  shape?: boolean;
  closed?: boolean;
}
interface DxfDocish {
  header?: Record<string, unknown>;
  entities?: DxfEntityish[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Read $INSUNITS off the parsed header; default unitless (ftPerUnit 1). */
function resolveUnits(header: Record<string, unknown> | undefined): {
  units: DxfUnits;
  ftPerUnit: number;
} {
  const code = num(header?.['$INSUNITS']);
  if (code !== null && INSUNITS[code]) return INSUNITS[code];
  return { units: 'unitless', ftPerUnit: 1 };
}

function boundsOf(lines: DxfLine[], polylines: DxfPolyline[]): DxfBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const acc = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const l of lines) {
    acc(l.x1, l.y1);
    acc(l.x2, l.y2);
  }
  for (const p of polylines) for (const pt of p.points) acc(pt.x, pt.y);
  if (!Number.isFinite(minX)) return { ...EMPTY_BOUNDS };
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/* --------------------------------------------------------------- parseDxf */

/**
 * PURE (given an injected parser). Parse a DXF text body into typed lines, polylines,
 * layers, bounds, and a real units->feet scale. Fails SOFT: malformed text, an empty
 * document, or a document with no usable LINE/POLYLINE geometry returns ok:false with
 * a reason — it never throws on bad input and never fabricates geometry.
 *
 * The parser is injectable so unit tests can pass a tiny fake; the default is the real
 * dxf-parser (pure JS, no worker).
 */
export function parseDxf(text: string, parser: DxfParserLike): ParsedDxf {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return emptyResult('empty DXF text');
  }

  let doc: DxfDocish | null = null;
  try {
    doc = parser.parseSync(text) as DxfDocish | null;
  } catch (err) {
    return emptyResult(
      `DXF parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!doc || !Array.isArray(doc.entities)) {
    return emptyResult('DXF parsed but contained no entities');
  }

  const { units, ftPerUnit } = resolveUnits(doc.header);

  const lines: DxfLine[] = [];
  const polylines: DxfPolyline[] = [];
  const circles: DxfCircle[] = [];
  const layerSet = new Set<string>();

  for (const ent of doc.entities) {
    const type = ent?.type;
    const layer = typeof ent?.layer === 'string' ? ent.layer : '0';

    if (type === 'CIRCLE') {
      const c = ent.center ?? {};
      const cx = num(c.x);
      const cy = num(c.y);
      const r = num(ent.radius);
      if (cx !== null && cy !== null && r !== null && r >= 0) {
        circles.push({ cx, cy, r, layer });
        layerSet.add(layer);
      }
    } else if (type === 'LINE') {
      const v = ent.vertices ?? [];
      if (v.length >= 2) {
        const x1 = num(v[0].x);
        const y1 = num(v[0].y);
        const x2 = num(v[1].x);
        const y2 = num(v[1].y);
        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
          lines.push({ x1, y1, x2, y2, layer });
          layerSet.add(layer);
        }
      }
    } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      const pts: Point2[] = [];
      for (const vtx of ent.vertices ?? []) {
        const x = num(vtx.x);
        const y = num(vtx.y);
        if (x !== null && y !== null) pts.push({ x, y });
      }
      if (pts.length >= 2) {
        polylines.push({
          points: pts,
          closed: ent.shape === true || ent.closed === true,
          layer,
        });
        layerSet.add(layer);
      }
    }
  }

  if (lines.length === 0 && polylines.length === 0 && circles.length === 0) {
    return emptyResult('DXF had no LINE / POLYLINE / CIRCLE geometry to import');
  }

  // Fold circle extents into the line/polyline bounds.
  const base = boundsOf(lines, polylines);
  let { minX, minY, maxX, maxY } = lines.length || polylines.length
    ? base
    : { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const c of circles) {
    minX = Math.min(minX, c.cx - c.r);
    minY = Math.min(minY, c.cy - c.r);
    maxX = Math.max(maxX, c.cx + c.r);
    maxY = Math.max(maxY, c.cy + c.r);
  }
  const bounds: DxfBounds = {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };

  return {
    ok: true,
    units,
    ftPerUnit,
    layers: [...layerSet].sort(),
    lines,
    polylines,
    circles,
    bounds,
  };
}

/* ------------------------------------------------- candidate wall pull */

/** Options for candidate wall extraction. */
export interface WallCandidateOpts {
  /** Minimum segment length, in FEET, to count as a wall (drops ticks/text). */
  minWallFt?: number;
  /** Optional layer-name substrings (case-insensitive) to restrict to. */
  layerHints?: string[];
}

/**
 * PURE. Pull best-effort candidate WALL segments from a parsed DXF as model Walls
 * (coordinates left in DXF units; the caller stores ftPerUnit alongside). Each LINE
 * long enough (in feet, using the DXF scale) becomes a Wall; closed/multi-segment
 * polylines contribute their long edges too. Optional layerHints restrict to layers
 * whose name contains any hint (e.g. ['WALL','A-WALL']).
 *
 * This is a BEST-EFFORT assist, NOT an as-built extraction: it does not de-dup
 * double-line walls, infer thickness, or guarantee closure. Returns [] when nothing
 * qualifies (honest empty), never fabricated walls.
 */
export function wallCandidates(
  parsed: ParsedDxf,
  opts: WallCandidateOpts = {},
): Wall[] {
  if (!parsed.ok) return [];
  const minWallFt = Number.isFinite(opts.minWallFt) ? Number(opts.minWallFt) : 2;
  const ft = parsed.ftPerUnit > 0 ? parsed.ftPerUnit : 1;
  const minUnits = minWallFt / ft;

  const hints = (opts.layerHints ?? [])
    .map((h) => h.toLowerCase())
    .filter((h) => h.length > 0);
  const layerOk = (layer: string): boolean =>
    hints.length === 0 || hints.some((h) => layer.toLowerCase().includes(h));

  const walls: Wall[] = [];
  let seed = 0;
  const pushSeg = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void => {
    if (Math.hypot(x2 - x1, y2 - y1) < minUnits) return;
    walls.push({
      id: makeId('wall', seed++),
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
    });
  };

  for (const l of parsed.lines) {
    if (!layerOk(l.layer)) continue;
    pushSeg(l.x1, l.y1, l.x2, l.y2);
  }
  for (const p of parsed.polylines) {
    if (!layerOk(p.layer)) continue;
    const pts = p.points;
    const last = p.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      pushSeg(a.x, a.y, b.x, b.y);
    }
  }
  return walls;
}
