/**
 * loop-verify.js — fail-closed geometric cross-checks between plan passes.
 *
 * The current branch does not yet carry the planned layered runner, so this verifier
 * accepts a narrow, flexible model shape built from the geometry conventions already
 * used in autosprink: polygons in plan feet, walls as {a,b} or {x1,y1,x2,y2}, doors
 * with a point position, rooms with polygons, and columns with point positions.
 *
 * Exported API:
 *   verifyPass(model, passName) -> { ok: boolean, violations: string[] }
 */

const SHELL_AREA_RATIO_MIN = 0.8;
const WALL_RECALL_RATIO_MIN = 0.9;
const COLUMN_ESTIMATE_TOLERANCE = 0.3;
const DOOR_WALL_MAX_FT = 1.0;
const COLUMN_DEDUPE_MIN_FT = 4.0;

function round(n, decimals = 4) {
  const scale = 10 ** decimals;
  return Math.round((Number(n) + Number.EPSILON) * scale) / scale;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function pointSegDist(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(px, py, x1, y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return dist(px, py, x2, y2);
  const t = c1 / c2;
  return dist(px, py, x1 + t * vx, y1 + t * vy);
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

function normalizePolygon(poly) {
  if (!Array.isArray(poly)) return [];
  return poly
    .map((pt) => {
      if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
        return [Number(pt[0]), Number(pt[1])];
      }
      if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) return [Number(pt.x), Number(pt.y)];
      return null;
    })
    .filter(Boolean);
}

function normalizeSegment(seg) {
  if (!seg || typeof seg !== 'object') return null;
  if (Array.isArray(seg.a) && Array.isArray(seg.b)) {
    const [x1, y1] = seg.a;
    const [x2, y2] = seg.b;
    if ([x1, y1, x2, y2].every(Number.isFinite)) return { x1, y1, x2, y2 };
  }
  if ([seg.x1, seg.y1, seg.x2, seg.y2].every(Number.isFinite)) {
    return { x1: Number(seg.x1), y1: Number(seg.y1), x2: Number(seg.x2), y2: Number(seg.y2) };
  }
  return null;
}

function segmentLength(seg) {
  if (Number.isFinite(seg.lengthFt)) return Number(seg.lengthFt);
  const norm = normalizeSegment(seg);
  return norm ? dist(norm.x1, norm.y1, norm.x2, norm.y2) : 0;
}

function getAreaSqFt(entity) {
  if (!entity || typeof entity !== 'object') return null;
  const numericKeys = ['areaSqFt', 'areaFt2', 'area', 'sqft'];
  for (const key of numericKeys) {
    if (Number.isFinite(entity[key])) return Number(entity[key]);
  }
  const polyKeys = ['polygon', 'poly', 'footprint', 'outline', 'loop'];
  for (const key of polyKeys) {
    const area = polygonArea(entity[key]);
    if (Number.isFinite(area)) return area;
  }
  return null;
}

function getFootprintAreaSqFt(model) {
  const candidates = [
    model?.footprint,
    model?.footprintArea,
    model?.shell?.footprint,
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
  const candidates = [
    model?.shell,
    model?.buildingShell,
    model?.envelope,
  ];
  for (const candidate of candidates) {
    const area = getAreaSqFt(candidate);
    if (Number.isFinite(area) && area > 0) return area;
  }
  return null;
}

function getPlanInkContourLengthFt(model) {
  const candidates = [
    model?.planInkContourLengthFt,
    model?.planInk?.contourLengthFt,
    model?.footprint?.contourLengthFt,
    model?.counts?.planInkContourLengthFt,
  ];
  for (const value of candidates) {
    if (Number.isFinite(value) && value > 0) return Number(value);
  }
  return null;
}

function getWalls(model) {
  const wallSets = [
    model?.walls,
    model?.wallRuns,
    model?.structure?.walls,
  ];
  for (const set of wallSets) {
    if (Array.isArray(set)) return set.map(normalizeSegment).filter(Boolean);
  }
  return [];
}

function getWallTotalLengthFt(model) {
  const direct = [
    model?.wallTotalLengthFt,
    model?.wallRunsMeta?.totalRunLengthFt,
    model?.counts?.wallTotalLengthFt,
  ];
  for (const value of direct) {
    if (Number.isFinite(value) && value >= 0) return Number(value);
  }
  const walls = [
    ...(Array.isArray(model?.walls) ? model.walls : []),
    ...(Array.isArray(model?.wallRuns) ? model.wallRuns : []),
  ];
  if (walls.length === 0) return 0;
  return walls.reduce((sum, wall) => sum + segmentLength(wall), 0);
}

function getGridEstimate(model) {
  const cols = Number(
    model?.grid?.cols
    ?? model?.grid?.gridCols
    ?? model?.counts?.gridCols
    ?? model?.gridCols
    ?? 0
  );
  const rows = Number(
    model?.grid?.rows
    ?? model?.grid?.gridRows
    ?? model?.counts?.gridRows
    ?? model?.gridRows
    ?? 0
  );
  return cols > 0 && rows > 0 ? cols * rows : 0;
}

function getPoint(entity) {
  if (!entity || typeof entity !== 'object') return null;
  if (Array.isArray(entity.position) && entity.position.length >= 2 && entity.position.every(Number.isFinite)) {
    return [Number(entity.position[0]), Number(entity.position[1])];
  }
  if (Array.isArray(entity.center) && entity.center.length >= 2 && entity.center.every(Number.isFinite)) {
    return [Number(entity.center[0]), Number(entity.center[1])];
  }
  if (Number.isFinite(entity.x) && Number.isFinite(entity.y)) return [Number(entity.x), Number(entity.y)];
  if (Number.isFinite(entity.cx) && Number.isFinite(entity.cy)) return [Number(entity.cx), Number(entity.cy)];
  return null;
}

function getColumns(model) {
  const columns = model?.columns ?? model?.structure?.columns ?? [];
  return Array.isArray(columns)
    ? columns.map((column, index) => ({ index, point: getPoint(column), raw: column })).filter((column) => column.point)
    : [];
}

function getDoors(model) {
  const doors = model?.doors ?? model?.openings?.doors ?? [];
  return Array.isArray(doors)
    ? doors.map((door, index) => ({ index, point: getPoint(door), raw: door })).filter((door) => door.point)
    : [];
}

function getRooms(model) {
  const rooms = model?.rooms ?? model?.plan?.rooms ?? [];
  return Array.isArray(rooms)
    ? rooms.map((room, index) => ({ index, raw: room, polygon: normalizePolygon(room?.polygon ?? room?.poly) }))
    : [];
}

function roomName(room, fallbackIndex) {
  return room?.raw?.name || room?.raw?.label || `room_${fallbackIndex + 1}`;
}

function roomIsOutdoor(room) {
  if (room?.raw?.outdoor === true) return true;
  const tags = [
    room?.raw?.classification,
    room?.raw?.kind,
    room?.raw?.type,
    room?.raw?.label,
    room?.raw?.name,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return tags.some((tag) => /outdoor|outside|exterior|open[- ]air/.test(tag));
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = ((yi > py) !== (yj > py))
      && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
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
      violations.push(
        `${prefix}shell area ${round(shellArea, 2)} sqft is below 80% of footprint area ${round(footprintArea, 2)} sqft`
      );
    }
  }

  const contourLength = getPlanInkContourLengthFt(model);
  if (Number.isFinite(contourLength) && contourLength > 0) {
    const wallLength = getWallTotalLengthFt(model);
    if (wallLength < contourLength * WALL_RECALL_RATIO_MIN) {
      violations.push(
        `${prefix}wall total length ${round(wallLength, 2)} ft is below 90% of plan-ink contour length ${round(contourLength, 2)} ft`
      );
    }
  }

  const gridEstimate = getGridEstimate(model);
  if (gridEstimate > 0) {
    const columns = getColumns(model);
    const minColumns = gridEstimate * (1 - COLUMN_ESTIMATE_TOLERANCE);
    const maxColumns = gridEstimate * (1 + COLUMN_ESTIMATE_TOLERANCE);
    if (columns.length < minColumns || columns.length > maxColumns) {
      violations.push(
        `${prefix}column count ${columns.length} is outside the 30% tolerance band for grid estimate ${gridEstimate}`
      );
    }
  }

  const walls = getWalls(model);
  const doors = getDoors(model);
  for (const door of doors) {
    const nearestWallDist = walls.length
      ? Math.min(...walls.map((wall) => pointSegDist(door.point[0], door.point[1], wall.x1, wall.y1, wall.x2, wall.y2)))
      : Infinity;
    if (!(nearestWallDist <= DOOR_WALL_MAX_FT)) {
      violations.push(
        `${prefix}door ${door.index + 1} does not touch an existing wall within 1 ft`
      );
    }
  }

  const rooms = getRooms(model);
  for (const room of rooms) {
    if (roomIsOutdoor(room)) continue;
    if (room.polygon.length < 3) continue;
    const hasDoor = doors.some((door) => pointTouchesPolygon(door.point[0], door.point[1], room.polygon, DOOR_WALL_MAX_FT));
    if (!hasDoor) {
      violations.push(`${prefix}${roomName(room, room.index)} has no door and is not classified as outdoor`);
    }
  }

  const columns = getColumns(model);
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
