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
