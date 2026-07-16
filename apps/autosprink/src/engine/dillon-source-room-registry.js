import { sha256Hex } from './elevation-datums.js';

const DEFAULT_CELL_SIZE_FT = 0.25;
const DEFAULT_CLOSURE_HALF_WIDTH_FT = 0.16;
const GRID_PADDING_FT = 1;
const POINT_SNAP_LIMIT_FT = 0.51;
const round = (value, places = 5) => Number(value.toFixed(places));

function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax; const dy = by - ay; const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function surfaceKey(annotation) {
  return `${annotation.kind}:${round(annotation.heightAboveFloorFt)}`;
}

function buildGrid(level, cellSizeFt, closureHalfWidthFt) {
  const minX = Math.floor((level.boundsFt.minX - GRID_PADDING_FT) / cellSizeFt) * cellSizeFt;
  const minY = Math.floor((level.boundsFt.minY - GRID_PADDING_FT) / cellSizeFt) * cellSizeFt;
  const maxX = Math.ceil((level.boundsFt.maxX + GRID_PADDING_FT) / cellSizeFt) * cellSizeFt;
  const maxY = Math.ceil((level.boundsFt.maxY + GRID_PADDING_FT) / cellSizeFt) * cellSizeFt;
  const width = Math.round((maxX - minX) / cellSizeFt);
  const height = Math.round((maxY - minY) / cellSizeFt);
  const blocked = new Uint8Array(width * height);
  const index = (x, y) => y * width + x;
  const center = (x, y) => [minX + (x + 0.5) * cellSizeFt, minY + (y + 0.5) * cellSizeFt];
  const range = (low, high, origin, limit) => [
    Math.max(0, Math.floor((low - origin) / cellSizeFt) - 1),
    Math.min(limit - 1, Math.floor((high - origin) / cellSizeFt) + 1),
  ];

  for (const polygon of level.wallPolygonsFt) {
    const xs = polygon.map((point) => point[0]); const ys = polygon.map((point) => point[1]);
    const [x0, x1] = range(Math.min(...xs), Math.max(...xs), minX, width);
    const [y0, y1] = range(Math.min(...ys), Math.max(...ys), minY, height);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const point = center(x, y);
      if (pointInPolygon(point, polygon) || polygon.some((a, i) => pointSegmentDistance(point, a, polygon[(i + 1) % polygon.length]) <= cellSizeFt * 0.34)) blocked[index(x, y)] = 1;
    }
  }

  for (const segment of [...(level.roomBoundarySegmentsFt || []), ...level.openingClosureSegmentsFt]) {
    const [x0, x1] = range(Math.min(segment.a[0], segment.b[0]) - closureHalfWidthFt, Math.max(segment.a[0], segment.b[0]) + closureHalfWidthFt, minX, width);
    const [y0, y1] = range(Math.min(segment.a[1], segment.b[1]) - closureHalfWidthFt, Math.max(segment.a[1], segment.b[1]) + closureHalfWidthFt, minY, height);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (pointSegmentDistance(center(x, y), segment.a, segment.b) <= closureHalfWidthFt) blocked[index(x, y)] = 1;
  }

  return { minX, minY, maxX, maxY, width, height, blocked, index, center, cellSizeFt };
}

function labelComponents(grid) {
  const labels = new Int32Array(grid.width * grid.height); labels.fill(-1);
  const components = [];
  const queueX = new Int32Array(labels.length); const queueY = new Int32Array(labels.length);
  for (let startY = 0; startY < grid.height; startY += 1) for (let startX = 0; startX < grid.width; startX += 1) {
    const startIndex = grid.index(startX, startY);
    if (grid.blocked[startIndex] || labels[startIndex] !== -1) continue;
    const componentId = components.length; let read = 0; let write = 0; let touchesGridEdge = false;
    let minCellX = startX; let maxCellX = startX; let minCellY = startY; let maxCellY = startY;
    queueX[write] = startX; queueY[write] = startY; write += 1; labels[startIndex] = componentId;
    while (read < write) {
      const x = queueX[read]; const y = queueY[read]; read += 1;
      if (x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1) touchesGridEdge = true;
      minCellX = Math.min(minCellX, x); maxCellX = Math.max(maxCellX, x); minCellY = Math.min(minCellY, y); maxCellY = Math.max(maxCellY, y);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        const nextIndex = grid.index(nx, ny);
        if (grid.blocked[nextIndex] || labels[nextIndex] !== -1) continue;
        labels[nextIndex] = componentId; queueX[write] = nx; queueY[write] = ny; write += 1;
      }
    }
    components.push({ componentId, cellCount: write, touchesGridEdge, minCellX, maxCellX, minCellY, maxCellY, annotations: [] });
  }
  return { labels, components };
}

function locatePoint(grid, labels, point) {
  const baseX = Math.floor((point[0] - grid.minX) / grid.cellSizeFt); const baseY = Math.floor((point[1] - grid.minY) / grid.cellSizeFt);
  let best = null;
  for (let radius = 0; radius <= Math.ceil(POINT_SNAP_LIMIT_FT / grid.cellSizeFt); radius += 1) {
    for (let y = baseY - radius; y <= baseY + radius; y += 1) for (let x = baseX - radius; x <= baseX + radius; x += 1) {
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height || Math.max(Math.abs(x - baseX), Math.abs(y - baseY)) !== radius) continue;
      const label = labels[grid.index(x, y)]; if (label < 0) continue;
      const distanceFt = Math.hypot(point[0] - grid.center(x, y)[0], point[1] - grid.center(x, y)[1]);
      if (distanceFt <= POINT_SNAP_LIMIT_FT && (!best || distanceFt < best.distanceFt)) best = { componentId: label, distanceFt };
    }
    if (best) break;
  }
  return best;
}

export async function buildDillonSourceRoomRegistry(level, annotations, options = {}) {
  const cellSizeFt = options.cellSizeFt ?? DEFAULT_CELL_SIZE_FT;
  const closureHalfWidthFt = options.closureHalfWidthFt ?? DEFAULT_CLOSURE_HALF_WIDTH_FT;
  const grid = buildGrid(level, cellSizeFt, closureHalfWidthFt);
  const { labels, components } = labelComponents(grid);
  for (const annotation of annotations) {
    const location = locatePoint(grid, labels, annotation.planPointDwgFt);
    if (location) components[location.componentId].annotations.push({ ...annotation, snapDistanceFt: round(location.distanceFt) });
  }
  const rooms = components.map((component) => {
    const keys = [...new Set(component.annotations.map(surfaceKey))].sort();
    const sourceBounded = !component.touchesGridEdge;
    const surfaceResolved = sourceBounded && component.annotations.length > 0 && keys.length === 1;
    const first = component.annotations[0];
    return {
      id: `${level.id}-cell-${String(component.componentId + 1).padStart(4, '0')}`,
      componentId: component.componentId,
      sourceBounded,
      surfaceResolved,
      cellCount: component.cellCount,
      areaFt2: round(component.cellCount * cellSizeFt * cellSizeFt, 4),
      boundsFt: {
        minX: round(grid.minX + component.minCellX * cellSizeFt), minY: round(grid.minY + component.minCellY * cellSizeFt),
        maxX: round(grid.minX + (component.maxCellX + 1) * cellSizeFt), maxY: round(grid.minY + (component.maxCellY + 1) * cellSizeFt),
      },
      annotationIds: component.annotations.map((annotation) => annotation.id).sort(),
      surfaceKeys: keys,
      ...(surfaceResolved ? { surfaceKind: first.kind, heightAboveFloorFt: round(first.heightAboveFloorFt) } : {}),
    };
  });
  const publicDraft = {
    artifactType: 'halofire.dillon-source-room-registry.v1', algorithm: 'quarter-foot-wall-hatch-and-opening-closure-four-neighbor-components',
    levelId: level.id, sourceId: level.sourceId, cellSizeFt, closureHalfWidthFt,
    sourceCounts: { wallPolygons: level.wallPolygonsFt.length, roomBoundarySegments: level.roomBoundarySegmentsFt?.length || 0, openingClosureSegments: level.openingClosureSegmentsFt.length },
    counts: { totalCells: rooms.length, sourceBoundedCells: rooms.filter((room) => room.sourceBounded).length, surfaceResolvedCells: rooms.filter((room) => room.surfaceResolved).length },
    rooms,
  };
  const receiptSha256 = await sha256Hex(publicDraft);
  const roomByComponent = new Map(rooms.map((room) => [room.componentId, room]));
  return {
    ...publicDraft, receiptSha256,
    locate(point) {
      const location = locatePoint(grid, labels, point); if (!location) return null;
      const room = roomByComponent.get(location.componentId);
      return { room, snapDistanceFt: round(location.distanceFt) };
    },
  };
}

export function dillonSourceRoomRegistryPacket(registry) {
  if (!registry) return null;
  const { locate: _locate, ...packet } = registry;
  return packet;
}

export const DILLON_SOURCE_ROOM_GRID = Object.freeze({
  cellSizeFt: DEFAULT_CELL_SIZE_FT,
  closureHalfWidthFt: DEFAULT_CLOSURE_HALF_WIDTH_FT,
  pointSnapLimitFt: POINT_SNAP_LIMIT_FT,
});
