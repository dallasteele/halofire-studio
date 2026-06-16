/**
 * Building model (internal alpha, best-effort, dependency-free, deterministic).
 *
 * A richer-than-floorplan schema describing a multi-story building with
 * multiple spaces, interior + exterior walls, wall openings (doors/windows),
 * and structural columns. Plain data only — no OpenGeometry / browser deps;
 * the browser renders what these engines emit.
 *
 * Schema:
 *   building = {
 *     name, units:'ft',
 *     stories: [{
 *       level:int, baseElevationFt:number, ceilingHeightFt:number,
 *       spaces: [{ name, polygon:[[x,y],...], hazard }],
 *       walls:  [{ a:[x,y], b:[x,y], thicknessFt, type:'exterior'|'interior',
 *                  openings:[{offsetFt, widthFt, heightFt, sill?:number, type:'door'|'window'}],
 *                  inkRef?:string }],
 *       columns:[{ x, y, sizeFt, inkRef?:string }],
 *       sourceInkRefs?: string[],
 *       requireSourceInkRefs?: boolean,
 *     }],
 *   }
 *
 * normalizeBuilding(spec): validates/cleans, applies defaults (hazard
 * 'ordinary', wall thicknessFt 0.5, wall type 'interior', ceilingHeightFt 14,
 * baseElevationFt 0), drops degenerate spaces (<3 verts) and zero-length walls,
 * and clamps each opening's offset/width so it stays within its wall.
 *
 * buildingFromFloorPlan(floorPlan): backward-compat helper that converts a
 * legacy {rooms} or {floors} floor plan into a building (each room -> one space;
 * the room perimeter -> exterior walls; no interior walls/openings/columns) so
 * the rest of the pipeline can consume either shape.
 *
 * This is NOT a CAD-grade model and infers nothing beyond what it is given;
 * all claim gates remain fail-closed.
 */

const VALID_HAZARDS = new Set(['light', 'ordinary', 'extra']);
const VALID_WALL_TYPES = new Set(['exterior', 'interior']);
const VALID_OPENING_TYPES = new Set(['door', 'window']);

const DEFAULTS = Object.freeze({
  hazard: 'ordinary',
  thicknessFt: 0.5,
  wallType: 'interior',
  ceilingHeightFt: 14,
  baseElevationFt: 0,
});

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function cleanVertex(pt) {
  if (!Array.isArray(pt) || pt.length < 2 || !Number.isFinite(Number(pt[0])) || !Number.isFinite(Number(pt[1]))) {
    return null;
  }
  return [Number(pt[0]), Number(pt[1])];
}

function cleanHazard(h) {
  const v = String(h == null ? '' : h).toLowerCase();
  return VALID_HAZARDS.has(v) ? v : DEFAULTS.hazard;
}

function wallLength(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function cleanInkRef(inkRef, opts = {}) {
  const text = typeof inkRef === 'string' ? inkRef.trim() : '';
  if (!opts.requireSourceInkRefs) return text || null;
  if (!text) return null;
  if (opts.validInkRefs instanceof Set && opts.validInkRefs.size > 0 && !opts.validInkRefs.has(text)) {
    return null;
  }
  return text;
}

/** Clean a single opening against its host wall length; returns null if unusable. */
function cleanOpening(op, len) {
  if (!op || typeof op !== 'object') return null;
  let widthFt = Number(op.widthFt);
  if (!Number.isFinite(widthFt) || widthFt <= 0) return null;
  let offsetFt = Number(op.offsetFt);
  if (!Number.isFinite(offsetFt) || offsetFt < 0) offsetFt = 0;
  // Clamp so the opening stays within the wall span [0, len].
  if (widthFt > len) widthFt = len;
  if (offsetFt + widthFt > len) offsetFt = Math.max(0, len - widthFt);
  if (widthFt <= 0) return null;
  const heightFt = Number.isFinite(Number(op.heightFt)) && Number(op.heightFt) > 0 ? Number(op.heightFt) : 7;
  const type = VALID_OPENING_TYPES.has(String(op.type).toLowerCase()) ? String(op.type).toLowerCase() : 'door';
  const out = {
    offsetFt: round(offsetFt),
    widthFt: round(widthFt),
    heightFt: round(heightFt),
    type,
  };
  if (Number.isFinite(Number(op.sill))) out.sill = round(Number(op.sill));
  return out;
}

/** Clean a wall; returns null if zero-length or malformed. */
function cleanWall(wall, opts = {}) {
  if (!wall || typeof wall !== 'object') return null;
  const a = cleanVertex(wall.a);
  const b = cleanVertex(wall.b);
  if (!a || !b) return null;
  const len = wallLength(a, b);
  if (len < 1e-9) return null; // zero-length
  const thicknessFt = Number.isFinite(Number(wall.thicknessFt)) && Number(wall.thicknessFt) > 0
    ? Number(wall.thicknessFt)
    : DEFAULTS.thicknessFt;
  const type = VALID_WALL_TYPES.has(String(wall.type).toLowerCase()) ? String(wall.type).toLowerCase() : DEFAULTS.wallType;
  const openings = Array.isArray(wall.openings)
    ? wall.openings.map((o) => cleanOpening(o, len)).filter(Boolean)
    : [];
  const inkRef = cleanInkRef(wall.inkRef, opts);
  if (opts.requireSourceInkRefs && !inkRef) return null;
  const out = { a, b, thicknessFt: round(thicknessFt), type, openings };
  if (inkRef) out.inkRef = inkRef;
  return out;
}

/** Clean a space polygon; returns null if degenerate (<3 verts). */
function cleanSpace(space, index) {
  if (!space || typeof space !== 'object') return null;
  const polygon = Array.isArray(space.polygon)
    ? space.polygon.map(cleanVertex).filter(Boolean)
    : [];
  if (polygon.length < 3) return null;
  return {
    name: space.name || `Space ${index + 1}`,
    polygon,
    hazard: cleanHazard(space.hazard),
  };
}

function cleanColumn(col, opts = {}) {
  if (!col || typeof col !== 'object') return null;
  const x = Number(col.x);
  const y = Number(col.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const sizeFt = Number.isFinite(Number(col.sizeFt)) && Number(col.sizeFt) > 0 ? Number(col.sizeFt) : 1;
  const inkRef = cleanInkRef(col.inkRef, opts);
  if (opts.requireSourceInkRefs && !inkRef) return null;
  const out = { x, y, sizeFt: round(sizeFt) };
  if (inkRef) out.inkRef = inkRef;
  return out;
}

function cleanStory(story, index) {
  const level = Number.isFinite(Number(story.level)) ? Math.trunc(Number(story.level)) : index;
  const baseElevationFt = Number.isFinite(Number(story.baseElevationFt))
    ? Number(story.baseElevationFt)
    : DEFAULTS.baseElevationFt;
  const ceilingHeightFt = Number.isFinite(Number(story.ceilingHeightFt)) && Number(story.ceilingHeightFt) > 0
    ? Number(story.ceilingHeightFt)
    : DEFAULTS.ceilingHeightFt;
  const spaces = (Array.isArray(story.spaces) ? story.spaces : [])
    .map((sp, i) => cleanSpace(sp, i))
    .filter(Boolean);
  const sourceInkRefs = Array.isArray(story.sourceInkRefs)
    ? story.sourceInkRefs
      .map((ref) => (typeof ref === 'string' ? ref.trim() : ''))
      .filter(Boolean)
    : [];
  const requireSourceInkRefs = story.requireSourceInkRefs === true;
  const inkOpts = { requireSourceInkRefs, validInkRefs: new Set(sourceInkRefs) };
  const walls = (Array.isArray(story.walls) ? story.walls : [])
    .map((wall) => cleanWall(wall, inkOpts))
    .filter(Boolean);
  const columns = (Array.isArray(story.columns) ? story.columns : [])
    .map((col) => cleanColumn(col, inkOpts))
    .filter(Boolean);
  const out = { level, baseElevationFt, ceilingHeightFt, spaces, walls, columns };
  if (sourceInkRefs.length) out.sourceInkRefs = sourceInkRefs;
  if (requireSourceInkRefs) out.requireSourceInkRefs = true;
  return out;
}

/**
 * Validate + clean a building spec. Throws if there are no stories.
 * @param {object} spec
 * @returns {{name:string, units:string, stories:Array}}
 */
export function normalizeBuilding(spec) {
  if (!spec || !Array.isArray(spec.stories) || spec.stories.length === 0) {
    throw new Error('Building must have a non-empty stories array');
  }
  const stories = spec.stories.map((story, i) => cleanStory(story || {}, i));
  return {
    name: spec.name || 'Imported Building',
    units: spec.units || 'ft',
    stories,
  };
}

/** Perimeter exterior walls for a room polygon (no openings). */
function perimeterWalls(polygon) {
  const walls = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (wallLength(a, b) < 1e-9) continue;
    walls.push({ a: [a[0], a[1]], b: [b[0], b[1]], thicknessFt: DEFAULTS.thicknessFt, type: 'exterior', openings: [] });
  }
  return walls;
}

/** Convert a list of legacy rooms into a story (spaces + perimeter exterior walls). */
function storyFromRooms(rooms, storyMeta) {
  const spaces = [];
  const walls = [];
  rooms.forEach((room, i) => {
    const polygon = (Array.isArray(room.polygon) ? room.polygon.map(cleanVertex).filter(Boolean) : []);
    if (polygon.length < 3) return;
    spaces.push({
      name: room.name || `Space ${i + 1}`,
      polygon,
      hazard: cleanHazard(room.hazard),
    });
    walls.push(...perimeterWalls(polygon));
  });
  return {
    level: storyMeta.level,
    baseElevationFt: storyMeta.baseElevationFt,
    ceilingHeightFt: storyMeta.ceilingHeightFt,
    spaces,
    walls,
    columns: [],
  };
}

/**
 * Backward-compat: convert a legacy {rooms} or {floors} floor plan into a
 * building. Each room becomes a space; the room perimeter becomes exterior
 * walls; no interior walls, openings, or columns are inferred.
 * @param {object} floorPlan
 * @returns {{name:string, units:string, stories:Array}}
 */
export function buildingFromFloorPlan(floorPlan) {
  if (!floorPlan || typeof floorPlan !== 'object') {
    throw new Error('floorPlan must be an object');
  }
  const name = floorPlan.name || 'Imported Building';
  const units = floorPlan.units || 'ft';

  let stories;
  if (Array.isArray(floorPlan.floors) && floorPlan.floors.length > 0) {
    stories = floorPlan.floors.map((floor, i) => storyFromRooms(
      Array.isArray(floor.rooms) ? floor.rooms : [],
      {
        level: Number.isFinite(Number(floor.level)) ? Math.trunc(Number(floor.level)) : i,
        baseElevationFt: Number.isFinite(Number(floor.baseElevationFt)) ? Number(floor.baseElevationFt) : DEFAULTS.baseElevationFt,
        ceilingHeightFt: Number.isFinite(Number(floor.ceilingHeightFt)) && Number(floor.ceilingHeightFt) > 0
          ? Number(floor.ceilingHeightFt)
          : DEFAULTS.ceilingHeightFt,
      },
    ));
  } else if (Array.isArray(floorPlan.rooms) && floorPlan.rooms.length > 0) {
    stories = [storyFromRooms(floorPlan.rooms, {
      level: 0,
      baseElevationFt: DEFAULTS.baseElevationFt,
      ceilingHeightFt: DEFAULTS.ceilingHeightFt,
    })];
  } else {
    throw new Error('floorPlan must have a non-empty rooms or floors array');
  }

  return normalizeBuilding({ name, units, stories });
}
