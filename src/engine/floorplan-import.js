/**
 * Floor-plan import (internal alpha, best-effort, dependency-free).
 *
 * Turns a drawing into the engine's floor-plan shape
 * ({ name, units, rooms:[{name, polygon, hazard, ceilingHeightFt}] }).
 *
 * Supported inputs:
 *  - normalizeFloorPlan(spec): validate/clean a JSON spec.
 *  - floorPlanFromSvg(svgText, opts): extract <rect>, <polygon>, and simple
 *    <path> (absolute M/L/Z) elements as rooms. Coordinates are scaled px->ft
 *    via opts.unitsPerPx. SVG y (down) maps to plan y/z; this is consistent for
 *    layout + geometry. Per-room name/hazard/ceiling can be set with
 *    data-name / data-hazard / data-ceiling attributes.
 *  - floorPlanFromDxf(dxfText, opts): parse the DXF ENTITIES section. Supports
 *    LWPOLYLINE and POLYLINE/VERTEX as room polygons, and best-effort assembly
 *    of room polygons from LINE entities that chain into a closed loop.
 *    Coordinates are scaled to feet via opts.unitsPerDrawingUnit (default 1).
 *    opts.layer filters entities by DXF layer (group code 8). PDF import is
 *    DEFERRED (out of scope here) — DXF is the supported CAD interchange path.
 *
 * This is NOT a CAD-grade importer and does not infer walls, openings, or
 * hazard classes. It produces best-effort room polygons for the layout engine;
 * all claim gates remain fail-closed.
 */

import { normalizeBuilding } from './building-model.js';

const VALID_HAZARDS = new Set(['light', 'ordinary', 'extra']);

/** Parse an SVG points string ("x,y x,y" or "x y x y") into [[x,y], ...]. */
export function parsePolygonPoints(str) {
  const nums = String(str).trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

/** Parse a simple absolute SVG path ("M x y L x y ... Z") into [[x,y], ...]. */
export function parseSimplePath(d) {
  const pts = [];
  const re = /([MLmlZz])([^MLmlZz]*)/g;
  let m;
  let cur = [0, 0];
  while ((m = re.exec(String(d))) !== null) {
    const cmd = m[1];
    const nums = m[2].trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    if (cmd === 'M' || cmd === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) { cur = [nums[i], nums[i + 1]]; pts.push(cur); }
    } else if (cmd === 'm' || cmd === 'l') {
      for (let i = 0; i + 1 < nums.length; i += 2) { cur = [cur[0] + nums[i], cur[1] + nums[i + 1]]; pts.push(cur); }
    }
    // Z/z closes the path; the layout treats the vertex list as a closed loop.
  }
  return pts;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

/** True if a (possibly valueless) attribute like `data-space` is present. */
function hasAttr(tag, name) {
  return new RegExp(`(?:^|[\\s"'])${name}(?=[\\s=>/]|$)`, 'i').test(tag);
}

function roomMeta(tag, index, fallbackHazard) {
  const name = attr(tag, 'data-name') || `Room ${index + 1}`;
  const hazRaw = (attr(tag, 'data-hazard') || fallbackHazard || 'ordinary').toLowerCase();
  const hazard = VALID_HAZARDS.has(hazRaw) ? hazRaw : 'ordinary';
  const ceiling = Number(attr(tag, 'data-ceiling')) || undefined;
  return { name, hazard, ceiling };
}

/**
 * Build a floor plan from SVG text.
 * @param {string} svgText
 * @param {{name?:string, unitsPerPx?:number, hazard?:string}} [opts]
 */
export function floorPlanFromSvg(svgText, opts = {}) {
  const unitsPerPx = opts.unitsPerPx && opts.unitsPerPx > 0 ? opts.unitsPerPx : 1;
  const scale = (p) => [round(p[0] * unitsPerPx), round(p[1] * unitsPerPx)];
  const rooms = [];
  const svg = String(svgText || '');

  const pushRoom = (poly, tag, idx) => {
    if (poly.length < 3) return;
    const meta = roomMeta(tag, rooms.length, opts.hazard);
    rooms.push({
      name: meta.name,
      polygon: poly.map(scale),
      hazard: meta.hazard,
      ...(meta.ceiling ? { ceilingHeightFt: meta.ceiling } : {}),
    });
    void idx;
  };

  // <rect x y width height>
  let m;
  const rectRe = /<rect\b[^>]*>/gi;
  while ((m = rectRe.exec(svg)) !== null) {
    const t = m[0];
    const x = Number(attr(t, 'x')) || 0;
    const y = Number(attr(t, 'y')) || 0;
    const w = Number(attr(t, 'width'));
    const h = Number(attr(t, 'height'));
    if (w > 0 && h > 0) pushRoom([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], t, 0);
  }
  // <polygon points="...">
  const polyRe = /<polygon\b[^>]*>/gi;
  while ((m = polyRe.exec(svg)) !== null) {
    const t = m[0];
    const pts = parsePolygonPoints(attr(t, 'points') || '');
    pushRoom(pts, t, 0);
  }
  // <path d="...">
  const pathRe = /<path\b[^>]*>/gi;
  while ((m = pathRe.exec(svg)) !== null) {
    const t = m[0];
    const pts = parseSimplePath(attr(t, 'd') || '');
    pushRoom(pts, t, 0);
  }

  if (!rooms.length) throw new Error('No <rect>, <polygon>, or <path> rooms found in SVG');
  return normalizeFloorPlan({ name: opts.name || 'Imported SVG Plan', units: 'ft', rooms });
}

/**
 * Parse a DXF text into a list of (code, value) pairs. DXF is a flat list of
 * alternating group-code lines and value lines.
 */
function parseDxfTags(dxfText) {
  const lines = String(dxfText || '').split(/\r\n|\r|\n/);
  const tags = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) continue;
    tags.push([code, lines[i + 1]]);
  }
  return tags;
}

/** Slice out the tags between SECTION/ENTITIES and the matching ENDSEC. */
function entitiesTags(tags) {
  let inEntities = false;
  const out = [];
  for (let i = 0; i < tags.length; i++) {
    const [code, value] = tags[i];
    const v = String(value).trim();
    if (code === 0 && v === 'SECTION') {
      // The next tag (code 2) names the section.
      inEntities = tags[i + 1] && tags[i + 1][0] === 2 && String(tags[i + 1][1]).trim() === 'ENTITIES';
      continue;
    }
    if (code === 0 && v === 'ENDSEC') { inEntities = false; continue; }
    if (inEntities) out.push([code, value]);
  }
  return out;
}

/**
 * Group a tag list into entities. Each entity starts at a code-0 tag whose
 * value is the entity type, and runs until the next code-0 tag.
 */
function splitEntities(tags) {
  const entities = [];
  let cur = null;
  for (const [code, value] of tags) {
    if (code === 0) {
      cur = { type: String(value).trim(), tags: [] };
      entities.push(cur);
    } else if (cur) {
      cur.tags.push([code, value]);
    }
  }
  return entities;
}

function entityLayer(ent) {
  const t = ent.tags.find((tag) => tag[0] === 8);
  return t ? String(t[1]).trim() : null;
}

/** Vertices of an LWPOLYLINE: paired group codes 10 (x) / 20 (y). */
function lwpolylineVerts(ent) {
  const verts = [];
  let x = null;
  for (const [code, value] of ent.tags) {
    if (code === 10) x = Number(value);
    else if (code === 20 && x !== null) { verts.push([x, Number(value)]); x = null; }
  }
  return verts;
}

const EPS = 1e-6;
const samePt = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

/**
 * Best-effort assembly of polygons from LINE segments by chaining shared
 * endpoints. Returns closed loops (first==last dropped) found among the
 * segments. A greedy walk; not a full planar-graph cycle decomposition.
 */
function assembleLoopsFromLines(segments) {
  const remaining = segments.map((s) => [s[0].slice(), s[1].slice()]);
  const loops = [];
  while (remaining.length) {
    const start = remaining.shift();
    const path = [start[0], start[1]];
    let closed = false;
    while (!closed) {
      const tail = path[path.length - 1];
      if (samePt(tail, path[0]) && path.length > 2) { closed = true; break; }
      const idx = remaining.findIndex((seg) => samePt(seg[0], tail) || samePt(seg[1], tail));
      if (idx === -1) break;
      const seg = remaining.splice(idx, 1)[0];
      const next = samePt(seg[0], tail) ? seg[1] : seg[0];
      path.push(next);
    }
    if (closed) {
      // Drop the duplicated closing vertex.
      loops.push(path.slice(0, -1));
    }
  }
  return loops;
}

/**
 * Build a floor plan from DXF text.
 * @param {string} dxfText
 * @param {{name?:string, layer?:string, unitsPerDrawingUnit?:number, hazard?:string}} [opts]
 */
export function floorPlanFromDxf(dxfText, opts = {}) {
  const scaleFactor = opts.unitsPerDrawingUnit && opts.unitsPerDrawingUnit > 0 ? opts.unitsPerDrawingUnit : 1;
  const scale = (p) => [round(p[0] * scaleFactor), round(p[1] * scaleFactor)];
  const layerFilter = opts.layer ? String(opts.layer) : null;
  const hazard = VALID_HAZARDS.has(String(opts.hazard).toLowerCase()) ? String(opts.hazard).toLowerCase() : 'ordinary';

  const entities = splitEntities(entitiesTags(parseDxfTags(dxfText)));
  const onLayer = (ent) => !layerFilter || entityLayer(ent) === layerFilter;

  const polygons = [];
  const lineSegments = [];

  for (const ent of entities) {
    if (!onLayer(ent)) continue;
    if (ent.type === 'LWPOLYLINE') {
      polygons.push(lwpolylineVerts(ent));
    } else if (ent.type === 'POLYLINE') {
      // Vertices follow as separate VERTEX entities until SEQEND; collect them.
      const verts = [];
      let i = entities.indexOf(ent) + 1;
      for (; i < entities.length; i++) {
        const nxt = entities[i];
        if (nxt.type === 'VERTEX') {
          const xt = nxt.tags.find((t) => t[0] === 10);
          const yt = nxt.tags.find((t) => t[0] === 20);
          if (xt && yt) verts.push([Number(xt[1]), Number(yt[1])]);
        } else if (nxt.type === 'SEQEND') { break; } else { break; }
      }
      polygons.push(verts);
    } else if (ent.type === 'LINE') {
      const x1 = ent.tags.find((t) => t[0] === 10);
      const y1 = ent.tags.find((t) => t[0] === 20);
      const x2 = ent.tags.find((t) => t[0] === 11);
      const y2 = ent.tags.find((t) => t[0] === 21);
      if (x1 && y1 && x2 && y2) {
        lineSegments.push([[Number(x1[1]), Number(y1[1])], [Number(x2[1]), Number(y2[1])]]);
      }
    }
  }

  if (lineSegments.length) {
    for (const loop of assembleLoopsFromLines(lineSegments)) polygons.push(loop);
  }

  const rooms = [];
  for (const poly of polygons) {
    // Drop a trailing duplicate of the first vertex if present (closed polyline).
    let verts = poly;
    if (verts.length > 1 && samePt(verts[0], verts[verts.length - 1])) verts = verts.slice(0, -1);
    if (verts.length < 3) continue; // skip degenerate
    rooms.push({
      name: `Room ${rooms.length + 1}`,
      polygon: verts.map(scale),
      hazard,
    });
  }

  if (!rooms.length) throw new Error('No LWPOLYLINE/POLYLINE/closed-LINE-loop entities found in DXF');
  return normalizeFloorPlan({ name: opts.name || 'Imported DXF Plan', units: 'ft', rooms });
}

/** Validate + clean a JSON floor-plan spec; throws on structural problems. */
export function normalizeFloorPlan(spec) {
  if (!spec || !Array.isArray(spec.rooms) || spec.rooms.length === 0) {
    throw new Error('Floor plan must have a non-empty rooms array');
  }
  const rooms = spec.rooms.map((room, i) => {
    if (!Array.isArray(room.polygon) || room.polygon.length < 3) {
      throw new Error(`Room ${i + 1} must have a polygon with >= 3 vertices`);
    }
    const polygon = room.polygon.map((pt) => {
      if (!Array.isArray(pt) || pt.length < 2 || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
        throw new Error(`Room ${i + 1} has an invalid vertex`);
      }
      return [Number(pt[0]), Number(pt[1])];
    });
    const hazard = VALID_HAZARDS.has(String(room.hazard).toLowerCase()) ? String(room.hazard).toLowerCase() : 'ordinary';
    return {
      name: room.name || `Room ${i + 1}`,
      polygon,
      hazard,
      ...(room.ceilingHeightFt ? { ceilingHeightFt: Number(room.ceilingHeightFt) } : {}),
    };
  });
  return { name: spec.name || 'Imported Plan', units: spec.units || 'ft', rooms };
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ------------------------------------------------------------------------- *
 * Building (multi-space) import — best-effort, layer/convention-based.
 *
 * These parse a richer building (walls / spaces / openings / columns) from a
 * single drawing using LAYER NAMES (DXF group code 8) and ATTRIBUTE CONVENTIONS
 * (SVG data-* attrs). This is NOT CAD object-recognition AI — it only honors the
 * conventions documented below; anything else is ignored. Deterministic.
 * All claim gates remain fail-closed.
 * ------------------------------------------------------------------------- */

/** Default layer-name groups; opts.layers overrides any of these. */
const DEFAULT_BUILDING_LAYERS = Object.freeze({
  spaces: ['ROOMS', 'SPACES'],
  walls: ['WALLS', 'WALL'],
  wallsExterior: ['WALLS-EXT', 'WALL-EXT', 'A-WALL-EXT', 'EXTERIOR'],
  wallsInterior: ['WALLS-INT', 'WALL-INT', 'A-WALL-INT', 'INTERIOR'],
  doors: ['DOOR', 'DOORS', 'A-DOOR'],
  windows: ['WINDOW', 'WINDOWS', 'A-GLAZ'],
  columns: ['COLUMN', 'COLUMNS', 'COLS', 'A-COLS'],
});

function mergeLayerGroups(opts) {
  const o = (opts && opts.layers) || {};
  const norm = (arr) => (arr || []).map((s) => String(s).trim().toUpperCase());
  const groups = {};
  for (const key of Object.keys(DEFAULT_BUILDING_LAYERS)) {
    groups[key] = new Set([...norm(DEFAULT_BUILDING_LAYERS[key]), ...norm(o[key])]);
  }
  return groups;
}

function inGroup(layer, set) {
  return layer != null && set.has(String(layer).trim().toUpperCase());
}

/** Perpendicular distance from point p to the segment a-b, and nearest fraction. */
function segDistance(p, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = a[0] + t * vx;
  const cy = a[1] + t * vy;
  return { dist: Math.hypot(p[0] - cx, p[1] - cy), t };
}

/**
 * Attach an opening (its midpoint + width + type) to the nearest wall as a
 * wall-local opening {offsetFt,widthFt,heightFt,type}. Mutates walls in place.
 */
function attachOpeningToNearestWall(walls, mid, widthFt, type, heightFt) {
  if (!walls.length) return;
  let best = -1;
  let bestDist = Infinity;
  let bestT = 0;
  for (let i = 0; i < walls.length; i++) {
    const { dist, t } = segDistance(mid, walls[i].a, walls[i].b);
    if (dist < bestDist) { bestDist = dist; best = i; bestT = t; }
  }
  if (best === -1) return;
  const w = walls[best];
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const center = bestT * len;
  const offsetFt = Math.max(0, center - widthFt / 2);
  if (!w.openings) w.openings = [];
  w.openings.push({ offsetFt, widthFt, heightFt: heightFt || 7, type });
}

/**
 * Build a building from SVG text (best-effort, attribute-convention based).
 * Conventions:
 *  - spaces:  <polygon data-space ...> (data-name / data-hazard optional)
 *  - walls:   <line data-wall ...> or <polyline data-wall ...>; type from
 *             data-wall-type="exterior"|"interior" (default interior)
 *  - openings:<line data-opening ...> with data-opening-type="door"|"window";
 *             attached to the nearest wall. width = segment length.
 *  - columns: <circle data-column cx cy r> (sizeFt = 2*r)
 * Coordinates scaled px->ft via opts.unitsPerPx. opts.layers is accepted for
 * API symmetry with DXF but SVG keys off data-* attrs. NOT CAD recognition AI.
 * @param {string} svgText
 * @param {{name?:string, unitsPerPx?:number}} [opts]
 */
export function buildingFromSvg(svgText, opts = {}) {
  const unitsPerPx = opts.unitsPerPx && opts.unitsPerPx > 0 ? opts.unitsPerPx : 1;
  const sc = (n) => round(Number(n) * unitsPerPx);
  const scPt = (p) => [sc(p[0]), sc(p[1])];
  const svg = String(svgText || '');

  const spaces = [];
  const walls = [];
  const columns = [];

  // Spaces: <polygon data-space>
  let m;
  const polyRe = /<polygon\b[^>]*>/gi;
  while ((m = polyRe.exec(svg)) !== null) {
    const t = m[0];
    if (!hasAttr(t, 'data-space')) continue;
    const pts = parsePolygonPoints(attr(t, 'points') || '').map(scPt);
    if (pts.length < 3) continue;
    const meta = roomMeta(t, spaces.length, opts.hazard);
    spaces.push({ name: meta.name, polygon: pts, hazard: meta.hazard });
  }

  // Walls: <line data-wall> / <polyline data-wall>
  const lineRe = /<line\b[^>]*>/gi;
  const wallTags = [];
  while ((m = lineRe.exec(svg)) !== null) wallTags.push(m[0]);
  const polylineRe = /<polyline\b[^>]*>/gi;
  while ((m = polylineRe.exec(svg)) !== null) wallTags.push(m[0]);

  const pushWall = (a, b, type) => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) return;
    walls.push({ a, b, thicknessFt: 0.5, type, openings: [] });
  };

  for (const t of wallTags) {
    if (!hasAttr(t, 'data-wall')) continue;
    const wt = (attr(t, 'data-wall-type') || 'interior').toLowerCase();
    const type = wt === 'exterior' ? 'exterior' : 'interior';
    if (/^<line/i.test(t)) {
      const a = scPt([Number(attr(t, 'x1')) || 0, Number(attr(t, 'y1')) || 0]);
      const b = scPt([Number(attr(t, 'x2')) || 0, Number(attr(t, 'y2')) || 0]);
      pushWall(a, b, type);
    } else {
      const pts = parsePolygonPoints(attr(t, 'points') || '').map(scPt);
      for (let i = 0; i + 1 < pts.length; i++) pushWall(pts[i], pts[i + 1], type);
    }
  }

  // Openings: <line data-opening>
  for (const t of wallTags) {
    if (!hasAttr(t, 'data-opening')) continue;
    if (!/^<line/i.test(t)) continue;
    const a = scPt([Number(attr(t, 'x1')) || 0, Number(attr(t, 'y1')) || 0]);
    const b = scPt([Number(attr(t, 'x2')) || 0, Number(attr(t, 'y2')) || 0]);
    const widthFt = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (widthFt < 1e-9) continue;
    const ot = (attr(t, 'data-opening-type') || 'door').toLowerCase();
    const type = ot === 'window' ? 'window' : 'door';
    const heightFt = Number(attr(t, 'data-height')) || (type === 'window' ? 4 : 7);
    attachOpeningToNearestWall(walls, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], round(widthFt), type, heightFt);
  }

  // Columns: <circle data-column>
  const circleRe = /<circle\b[^>]*>/gi;
  while ((m = circleRe.exec(svg)) !== null) {
    const t = m[0];
    if (!hasAttr(t, 'data-column')) continue;
    const cx = Number(attr(t, 'cx'));
    const cy = Number(attr(t, 'cy'));
    const r = Number(attr(t, 'r')) || 0.5;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    columns.push({ x: sc(cx), y: sc(cy), sizeFt: round(2 * r * unitsPerPx) });
  }

  if (!spaces.length && !walls.length) {
    throw new Error('No data-space / data-wall elements found in SVG');
  }

  const story = {
    level: 0,
    baseElevationFt: 0,
    ceilingHeightFt: Number(opts.ceilingHeightFt) || 14,
    spaces,
    walls,
    columns,
  };
  return normalizeBuilding({ name: opts.name || 'Imported SVG Building', units: 'ft', stories: [story] });
}

/** CIRCLE center (code 10/20) + radius (code 40). */
function circleEntity(ent) {
  const cx = ent.tags.find((t) => t[0] === 10);
  const cy = ent.tags.find((t) => t[0] === 20);
  const r = ent.tags.find((t) => t[0] === 40);
  if (!cx || !cy) return null;
  return { x: Number(cx[1]), y: Number(cy[1]), r: r ? Number(r[1]) : 0.5 };
}

/** LINE endpoints (codes 10/20 -> 11/21). */
function lineEntity(ent) {
  const x1 = ent.tags.find((t) => t[0] === 10);
  const y1 = ent.tags.find((t) => t[0] === 20);
  const x2 = ent.tags.find((t) => t[0] === 11);
  const y2 = ent.tags.find((t) => t[0] === 21);
  if (!x1 || !y1 || !x2 || !y2) return null;
  return [[Number(x1[1]), Number(y1[1])], [Number(x2[1]), Number(y2[1])]];
}

/**
 * Build a building from DXF text (best-effort, layer-convention based).
 * Conventions (override layer names via opts.layers):
 *  - spaces:  LWPOLYLINE on a ROOMS/SPACES layer -> space polygons
 *  - walls:   LINE (and LWPOLYLINE segments) on a WALLS layer -> wall segments;
 *             type from layer (exterior vs interior groups) else interior
 *  - openings:LINE on a DOOR/WINDOW layer -> attached to the nearest wall
 *  - columns: CIRCLE (or POINT) on a COLUMN layer
 * opts.unitsPerDrawingUnit scales to feet. NOT CAD object-recognition AI —
 * only the documented layer/attr conventions are honored. Deterministic.
 * @param {string} dxfText
 * @param {{name?:string, unitsPerDrawingUnit?:number, layers?:object}} [opts]
 */
export function buildingFromDxf(dxfText, opts = {}) {
  const scaleFactor = opts.unitsPerDrawingUnit && opts.unitsPerDrawingUnit > 0 ? opts.unitsPerDrawingUnit : 1;
  const sc = (n) => round(Number(n) * scaleFactor);
  const scPt = (p) => [sc(p[0]), sc(p[1])];
  const groups = mergeLayerGroups(opts);

  const entities = splitEntities(entitiesTags(parseDxfTags(dxfText)));

  const spaces = [];
  const walls = [];
  const columns = [];
  const openings = []; // {mid, widthFt, type, heightFt}

  const wallTypeFor = (layer) => {
    if (inGroup(layer, groups.wallsExterior)) return 'exterior';
    if (inGroup(layer, groups.wallsInterior)) return 'interior';
    return 'interior';
  };
  const isWallLayer = (layer) => inGroup(layer, groups.walls)
    || inGroup(layer, groups.wallsExterior) || inGroup(layer, groups.wallsInterior);

  const pushWall = (a, b, type) => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9) return;
    walls.push({ a, b, thicknessFt: 0.5, type, openings: [] });
  };

  for (const ent of entities) {
    const layer = entityLayer(ent);
    if (ent.type === 'LWPOLYLINE') {
      const verts = lwpolylineVerts(ent);
      let v = verts;
      if (v.length > 1 && samePt(v[0], v[v.length - 1])) v = v.slice(0, -1);
      if (inGroup(layer, groups.spaces)) {
        if (v.length >= 3) {
          spaces.push({ name: `Space ${spaces.length + 1}`, polygon: v.map(scPt), hazard: 'ordinary' });
        }
      } else if (isWallLayer(layer)) {
        const type = wallTypeFor(layer);
        for (let i = 0; i + 1 < v.length; i++) pushWall(scPt(v[i]), scPt(v[i + 1]), type);
      }
    } else if (ent.type === 'LINE') {
      const seg = lineEntity(ent);
      if (!seg) continue;
      if (isWallLayer(layer)) {
        pushWall(scPt(seg[0]), scPt(seg[1]), wallTypeFor(layer));
      } else if (inGroup(layer, groups.doors) || inGroup(layer, groups.windows)) {
        const a = scPt(seg[0]);
        const b = scPt(seg[1]);
        const widthFt = round(Math.hypot(b[0] - a[0], b[1] - a[1]));
        if (widthFt < 1e-9) continue;
        const type = inGroup(layer, groups.windows) ? 'window' : 'door';
        openings.push({ mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], widthFt, type, heightFt: type === 'window' ? 4 : 7 });
      }
    } else if (ent.type === 'CIRCLE' || ent.type === 'POINT') {
      if (!inGroup(layer, groups.columns)) continue;
      const c = circleEntity(ent);
      if (!c) continue;
      columns.push({ x: sc(c.x), y: sc(c.y), sizeFt: round(2 * (c.r || 0.5) * scaleFactor) });
    }
  }

  // Attach openings to nearest walls after all walls are collected (deterministic order).
  for (const op of openings) {
    attachOpeningToNearestWall(walls, op.mid, op.widthFt, op.type, op.heightFt);
  }

  if (!spaces.length && !walls.length) {
    throw new Error('No ROOMS/SPACES or WALLS layer entities found in DXF');
  }

  const story = {
    level: 0,
    baseElevationFt: 0,
    ceilingHeightFt: 14,
    spaces,
    walls,
    columns,
  };
  return normalizeBuilding({ name: opts.name || 'Imported DXF Building', units: 'ft', stories: [story] });
}
