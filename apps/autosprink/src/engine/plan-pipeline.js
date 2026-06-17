import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_LEVELS_PATH = path.resolve(__dirname, '../data/plan-levels.cooperative-1881.json');
const SUPPORTED_PDF_BASENAME = '1881-architecturals.pdf';
const SUPPORTED_PAGE = 8;
const WALL_TOUCH_TOLERANCE_FT = 1.5;
const COLUMN_WALL_TOLERANCE_FT = 4;

function readPlanLevels() {
  return JSON.parse(fs.readFileSync(PLAN_LEVELS_PATH, 'utf8'));
}

function pointInBbox([x, y], bbox) {
  return x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY;
}

function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = ((yi > y) !== (yj > y))
      && (x < (((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON)) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance([x, y], seg) {
  const [x1, y1] = seg.a;
  const [x2, y2] = seg.b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = (dx * dx) + (dy * dy);
  const t = len2 > 0 ? Math.max(0, Math.min(1, (((x - x1) * dx) + ((y - y1) * dy)) / len2)) : 0;
  const px = x1 + (t * dx);
  const py = y1 + (t * dy);
  return Math.hypot(x - px, y - py);
}

function closePoints(a, b, tolerance = WALL_TOUCH_TOLERANCE_FT) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
}

function normalizeWall(seg, id, source) {
  const lengthFt = Number(seg.lengthFt) || Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
  return {
    id,
    a: [Number(seg.a[0]), Number(seg.a[1])],
    b: [Number(seg.b[0]), Number(seg.b[1])],
    axis: seg.axis || null,
    lengthFt,
    source,
    needsVerification: true,
  };
}

function connectedWalls(walls) {
  const degree = walls.map((wall, index) => walls.reduce((count, other, otherIndex) => {
    if (index === otherIndex) return count;
    const touches = [wall.a, wall.b].some((p) => [other.a, other.b].some((q) => closePoints(p, q)));
    return count + (touches ? 1 : 0);
  }, 0));
  const kept = walls.filter((_, index) => degree[index] > 0);
  const orphanWalls = kept.filter((wall, index) => kept.every((other, otherIndex) => {
    if (index === otherIndex) return true;
    return ![wall.a, wall.b].some((p) => [other.a, other.b].some((q) => closePoints(p, q)));
  }));
  return { kept, orphanWalls };
}

function deriveColumns(plan, walls, shell) {
  const xs = Array.isArray(plan.grid?.xs) ? plan.grid.xs : [];
  const ys = Array.isArray(plan.grid?.ys) ? plan.grid.ys : [];
  const columns = [];
  let index = 0;
  for (const x of xs) {
    for (const y of ys) {
      const point = [Number(x), Number(y)];
      if (!pointInBbox(point, shell.bbox) || !pointInPolygon(point, shell.footprint)) continue;
      const wallDistance = Math.min(...walls.map((wall) => pointToSegmentDistance(point, wall)));
      if (wallDistance > COLUMN_WALL_TOLERANCE_FT) continue;
      columns.push({
        id: `column-${index}`,
        x: point[0],
        y: point[1],
        sizeFt: 1,
        wallDistanceFt: wallDistance,
        source: 'architectural-grid-near-wall',
        needsVerification: true,
      });
      index += 1;
    }
  }
  return columns;
}

function buildWallIndex(primaryWalls, wallsFull, doors) {
  const index = new Map(primaryWalls.map((wall) => [wall.id, wall]));
  for (const door of doors) {
    const seg = wallsFull[door.hostWall];
    if (!seg || !Array.isArray(seg.a) || !Array.isArray(seg.b)) continue;
    const id = `wall-fragment-${door.hostWall}`;
    if (!index.has(id)) index.set(id, normalizeWall(seg, id, 'wallsFull-door-host'));
  }
  return [...index.values()];
}

function normalizeDoors(doors, shell, wallsFull) {
  return doors
    .filter((door) => Array.isArray(door.position)
      && pointInBbox(door.position, shell.bbox)
      && Number.isInteger(door.hostWall)
      && wallsFull[door.hostWall])
    .map((door, index) => ({
      id: `door-${index}`,
      position: [Number(door.position[0]), Number(door.position[1])],
      width: Number(door.width) || 0,
      wallId: `wall-fragment-${door.hostWall}`,
      hostWall: door.hostWall,
      confidence: door.confidence || 'low',
      suspect: door.suspect === true,
      onWall: door.onWall === true,
      needsVerification: true,
    }));
}

function normalizeRooms(rooms, shell) {
  return rooms
    .filter((room) => Array.isArray(room.poly)
      && room.poly.length >= 3
      && room.poly.every((point) => pointInBbox(point, shell.bbox))
      && Number(room.areaSqft) > 0)
    .map((room, index) => ({
      id: `room-${index}`,
      label: room.label || null,
      kind: room.kind || 'unknown',
      areaSqft: Number(room.areaSqft),
      poly: room.poly.map(([x, y]) => [Number(x), Number(y)]),
      confidence: room.confidence || 'low',
      needsVerification: true,
    }));
}

export async function buildModelFromPlan({ pdfPath, page = SUPPORTED_PAGE } = {}) {
  const basename = path.basename(String(pdfPath || ''));
  if (basename !== SUPPORTED_PDF_BASENAME || Number(page) !== SUPPORTED_PAGE) {
    throw new Error(
      `buildModelFromPlan currently supports only ${SUPPORTED_PDF_BASENAME} page ${SUPPORTED_PAGE} via committed extracted data`,
    );
  }

  const data = readPlanLevels();
  const level = (Array.isArray(data.levels) ? data.levels : []).find((entry) => entry?.sheet === 'A-101' && entry?.page === SUPPORTED_PAGE);
  if (!level?.plan) throw new Error('Committed Cooperative 1881 level data is unavailable');

  const plan = level.plan;
  const shell = {
    footprint: plan.footprintFt.map(([x, y]) => [Number(x), Number(y)]),
    bbox: {
      minX: Number(plan.footprintBboxFt.minX),
      minY: Number(plan.footprintBboxFt.minY),
      maxX: Number(plan.footprintBboxFt.maxX),
      maxY: Number(plan.footprintBboxFt.maxY),
    },
  };

  const candidateWalls = (Array.isArray(plan.wallRuns) ? plan.wallRuns : [])
    .map((seg, index) => normalizeWall(seg, `wall-run-${index}`, 'wallRuns'))
    .filter((wall) => pointInBbox(wall.a, shell.bbox) && pointInBbox(wall.b, shell.bbox));
  const wallConnectivity = connectedWalls(candidateWalls);
  const walls = wallConnectivity.kept;
  const rooms = normalizeRooms(Array.isArray(plan.rooms) ? plan.rooms : [], shell);
  const doors = normalizeDoors(Array.isArray(plan.doors) ? plan.doors : [], shell, Array.isArray(plan.wallsFull) ? plan.wallsFull : []);
  const columns = deriveColumns(plan, walls, shell);
  const wallIndex = buildWallIndex(walls, Array.isArray(plan.wallsFull) ? plan.wallsFull : [], doors);

  return {
    project: data.project,
    source: {
      pdfPath,
      page: Number(page),
      sheet: level.sheet,
      provenance: plan.provenance,
    },
    shell,
    walls,
    wallIndex,
    orphanWalls: wallConnectivity.orphanWalls,
    rooms,
    columns,
    doors,
    needsVerification: true,
  };
}
