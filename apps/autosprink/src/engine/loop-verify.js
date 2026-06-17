/**
 * loop-verify.js — fail-closed geometric cross-checks between pipeline passes.
 *
 * Current autosprink stages do not share one strict model type yet, so this verifier
 * accepts the plain geometry shapes already used in this repo: polygons in plan feet,
 * walls as {a,b} or {x1,y1,x2,y2}, optional solids-based CAD walls/columns, rooms with
 * polygons, and doors as either explicit point objects or wall openings.
 *
 * Exported API:
 *   verifyPass(model, passName) -> { ok: boolean, violations: string[] }
 */

const SHELL_AREA_RATIO_MIN = 0.8;
const WALL_RECALL_RATIO_MIN = 0.9;
const COLUMN_ESTIMATE_TOLERANCE = 0.3;
const DOOR_WALL_MAX_FT = 1.0;
const COLUMN_DEDUPE_MIN_FT = 4.0;

function round(n, decimals = 2) {
  const scale = 10 ** decimals;
  return Math.round((Number(n) + Number.EPSILON) * scale) / scale;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function normalizePolygon(poly) {
  if (!Array.isArray(poly)) return [];
  return poly.map((pt) => {
    if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
      return [Number(pt[0]), Number(pt[1])];
    }
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) return [Number(pt.x), Number(pt.y)];
    return null;
  }).filter(Boolean);
}

function polygonArea(poly) {
  const pts = normalizePolygon(poly);
  if (pts.length < 3) return null;
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += (x1 * y2) - (x2 * y1);
  }
  return Math.abs(sum) / 2;
}

function pointSegDist(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(px, py, x1, y1);
  const c2 = (vx * vx) + (vy * vy);
  if (c2 <= c1) return dist(px, py, x2, y2);
  const t = c1 / c2;
  return dist(px, py, x1 + (t * vx), y1 + (t * vy));
}

function normalizeSegment(seg) {
  if (!seg || typeof seg !== 'object') return null;
  if (Array.isArray(seg.a) && Array.isArray(seg.b) && [...seg.a, ...seg.b].every(Number.isFinite)) {
    return { x1: Number(seg.a[0]), y1: Number(seg.a[1]), x2: Number(seg.b[0]), y2: Number(seg.b[1]) };
  }
  if ([seg.x1, seg.y1, seg.x2, seg.y2].every(Number.isFinite)) {
    return { x1: Number(seg.x1), y1: Number(seg.y1), x2: Number(seg.x2), y2: Number(seg.y2) };
  }
  return null;
}

function segmentLength(seg) {
  if (Number.isFinite(seg?.lengthFt)) return Number(seg.lengthFt);
  const norm = normalizeSegment(seg);
  return norm ? dist(norm.x1, norm.y1, norm.x2, norm.y2) : 0;
}

function getPoint(entity) {
  if (!entity || typeof entity !== 'object') return null;
  if (Array.isArray(entity.position) && entity.position.length >= 2 && entity.position[0] != null && entity.position[1] != null) {
    return [Number(entity.position[0]), Number(entity.position[1])];
  }
  if (Array.isArray(entity.center) && entity.center.length >= 2 && entity.center[0] != null && entity.center[1] != null) {
    return [Number(entity.center[0]), Number(entity.center[1])];
  }
  if (Number.isFinite(entity.x) && Number.isFinite(entity.y)) return [Number(entity.x), Number(entity.y)];
  if (Number.isFinite(entity.cx) && Number.isFinite(entity.cy)) return [Number(entity.cx), Number(entity.cy)];
  return null;
}

function getAreaSqFt(entity) {
  if (!entity || typeof entity !== 'object') return null;
  for (const key of ['areaSqFt', 'areaSqft', 'areaFt2', 'area', 'sqft']) {
    if (Number.isFinite(entity[key]) && Number(entity[key]) > 0) return Number(entity[key]);
  }
  for (const key of ['polygon', 'poly', 'footprint', 'outline', 'loop']) {
    const area = polygonArea(entity[key]);
    if (Number.isFinite(area) && area > 0) return area;
  }
  return null;
}

function getFootprintAreaSqFt(model) {
  const candidates = [
    model?.footprint,
    model?.footprintArea,
    model?.plan?.footprint,
    model?.plan,
    model,
  ];
  for (const candidate of candidates) {
    const area = getAreaSqFt(candidate);
    if (Number.isFinite(area) && area > 0) return area;
  }
  return null;
}

function getShellAreaSqFt(model) {
  for (const candidate of [model?.shell, model?.buildingShell, model?.envelope]) {
    const area = getAreaSqFt(candidate);
    if (Number.isFinite(area) && area > 0) return area;
  }
  return null;
}

function getPlanInkContourLengthFt(model) {
  for (const value of [
    model?.planInkContourLengthFt,
    model?.planInk?.contourLengthFt,
    model?.footprint?.contourLengthFt,
    model?.counts?.planInkContourLengthFt,
  ]) {
    if (Number.isFinite(value) && Number(value) > 0) return Number(value);
  }
  return null;
}

function getWalls(model) {
  const directSets = [model?.walls, model?.wallRuns, model?.structure?.walls];
  for (const set of directSets) {
    if (Array.isArray(set) && set.length) return set.map(normalizeSegment).filter(Boolean);
  }
  if (Array.isArray(model?.solids)) {
    return model.solids.filter((solid) => solid?.kind === 'wall').map(normalizeSegment).filter(Boolean);
  }
  return [];
}

function getWallTotalLengthFt(model) {
  for (const value of [
    model?.wallTotalLengthFt,
    model?.wallRunsMeta?.totalRunLengthFt,
    model?.counts?.wallTotalLengthFt,
  ]) {
    if (Number.isFinite(value) && Number(value) >= 0) return Number(value);
  }
  const walls = getWalls(model);
  return walls.reduce((sum, wall) => sum + segmentLength(wall), 0);
}

function getGridEstimate(model) {
  const cols = Number(model?.grid?.cols ?? model?.grid?.gridCols ?? model?.counts?.gridCols ?? model?.gridCols ?? 0);
  const rows = Number(model?.grid?.rows ?? model?.grid?.gridRows ?? model?.counts?.gridRows ?? model?.gridRows ?? 0);
  return cols > 0 && rows > 0 ? cols * rows : 0;
}

function getColumns(model) {
  const source = model?.columns ?? model?.structure?.columns
    ?? (Array.isArray(model?.solids) ? model.solids.filter((solid) => solid?.kind === 'column') : []);
  return Array.isArray(source)
    ? source.map((column, index) => ({ index, point: getPoint(column), raw: column })).filter((column) => column.point)
    : [];
}

function doorFromWallOpening(wall, opening, index) {
  const seg = normalizeSegment(wall);
  if (!seg || !opening || String(opening.type || '').toLowerCase() !== 'door') return null;
  const widthFt = Number(opening.widthFt);
  const offsetFt = Number(opening.offsetFt);
  const len = dist(seg.x1, seg.y1, seg.x2, seg.y2);
  if (!(len > 0) || !Number.isFinite(widthFt) || !Number.isFinite(offsetFt)) return null;
  const centerOffset = Math.min(len, Math.max(0, offsetFt + (widthFt / 2)));
  const t = centerOffset / len;
  return {
    index,
    point: [seg.x1 + ((seg.x2 - seg.x1) * t), seg.y1 + ((seg.y2 - seg.y1) * t)],
    raw: opening,
  };
}

function getDoors(model) {
  const explicit = model?.doors ?? model?.openings?.doors
    ?? (Array.isArray(model?.solids) ? model.solids.filter((solid) => solid?.kind === 'door') : []);
  const doors = Array.isArray(explicit)
    ? explicit.map((door, index) => ({ index, point: getPoint(door), raw: door })).filter((door) => door.point)
    : [];
  if (doors.length) return doors;

  const derived = [];
  const walls = Array.isArray(model?.walls) ? model.walls : (Array.isArray(model?.solids) ? model.solids.filter((solid) => solid?.kind === 'wall') : []);
  for (const wall of walls) {
    for (const opening of (Array.isArray(wall?.openings) ? wall.openings : [])) {
      const door = doorFromWallOpening(wall, opening, derived.length);
      if (door) derived.push(door);
    }
  }
  return derived;
}

function getRooms(model) {
  const source = model?.rooms ?? model?.plan?.rooms ?? model?.spaces ?? [];
  return Array.isArray(source)
    ? source.map((room, index) => ({ index, raw: room, polygon: normalizePolygon(room?.polygon ?? room?.poly) }))
    : [];
}

function roomName(room) {
  return room?.raw?.name || room?.raw?.label || `room_${room.index + 1}`;
}

function roomIsOutdoor(room) {
  if (room?.raw?.outdoor === true) return true;
  const tags = [
    room?.raw?.classification,
    room?.raw?.kind,
    room?.raw?.type,
    room?.raw?.label,
    room?.raw?.name,
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  return tags.some((tag) => /outdoor|outside|exterior|open[- ]air/.test(tag));
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = ((yi > py) !== (yj > py))
      && (px < (((xj - xi) * (py - yi)) / ((yj - yi) || Number.EPSILON)) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointTouchesPolygon(px, py, poly, tolFt = DOOR_WALL_MAX_FT) {
  if (poly.length < 3) return false;
  if (pointInPolygon(px, py, poly)) return true;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    if (pointSegDist(px, py, x1, y1, x2, y2) <= tolFt) return true;
  }
  return false;
}

function formatPrefix(passName) {
  return passName ? `[${passName}] ` : '';
}

export function verifyPass(model = {}, passName = '') {
  const violations = [];
  const prefix = formatPrefix(passName);

  const footprintArea = getFootprintAreaSqFt(model);
  const shellArea = getShellAreaSqFt(model);
  if (Number.isFinite(footprintArea) && footprintArea > 0) {
    if (!Number.isFinite(shellArea) || shellArea <= 0) {
      violations.push(`${prefix}shell area missing for footprint cross-check`);
    } else if (shellArea < footprintArea * SHELL_AREA_RATIO_MIN) {
      violations.push(`${prefix}shell area ${round(shellArea)} sqft is below 80% of footprint area ${round(footprintArea)} sqft`);
    }
  }

  const contourLength = getPlanInkContourLengthFt(model);
  if (Number.isFinite(contourLength) && contourLength > 0) {
    const wallLength = getWallTotalLengthFt(model);
    if (wallLength < contourLength * WALL_RECALL_RATIO_MIN) {
      violations.push(`${prefix}wall total length ${round(wallLength)} ft is below 90% of plan-ink contour length ${round(contourLength)} ft`);
    }
  }

  const columns = getColumns(model);
  const gridEstimate = getGridEstimate(model);
  if (gridEstimate > 0) {
    const minColumns = gridEstimate * (1 - COLUMN_ESTIMATE_TOLERANCE);
    const maxColumns = gridEstimate * (1 + COLUMN_ESTIMATE_TOLERANCE);
    if (columns.length < minColumns || columns.length > maxColumns) {
      violations.push(`${prefix}column count ${columns.length} is outside the 30% tolerance band for grid estimate ${gridEstimate}`);
    }
  }

  const walls = getWalls(model);
  const doors = getDoors(model);
  for (const door of doors) {
    const nearestWallDist = walls.length
      ? Math.min(...walls.map((wall) => pointSegDist(door.point[0], door.point[1], wall.x1, wall.y1, wall.x2, wall.y2)))
      : Infinity;
    if (!(nearestWallDist <= DOOR_WALL_MAX_FT)) {
      violations.push(`${prefix}door ${door.index + 1} does not touch an existing wall within 1 ft`);
    }
  }

  const rooms = getRooms(model);
  for (const room of rooms) {
    if (roomIsOutdoor(room) || room.polygon.length < 3) continue;
    const hasDoor = doors.some((door) => pointTouchesPolygon(door.point[0], door.point[1], room.polygon, DOOR_WALL_MAX_FT));
    if (!hasDoor) {
      violations.push(`${prefix}${roomName(room)} has no door and is not classified as outdoor`);
    }
  }

  for (let i = 0; i < columns.length; i += 1) {
    for (let j = i + 1; j < columns.length; j += 1) {
      const a = columns[i].point;
      const b = columns[j].point;
      if (dist(a[0], a[1], b[0], b[1]) <= COLUMN_DEDUPE_MIN_FT) {
        violations.push(`${prefix}columns ${i + 1} and ${j + 1} are within 4 ft of each other`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}
