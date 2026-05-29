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
