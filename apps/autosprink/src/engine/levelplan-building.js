import { normalizeBuilding } from './building-model.js';

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function pointSegDist(px, py, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = px - a[0];
  const wy = py - a[1];
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(px, py, a[0], a[1]);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return dist(px, py, b[0], b[1]);
  const t = c1 / c2;
  return dist(px, py, a[0] + t * vx, a[1] + t * vy);
}

function projectOffsetFt(pt, wall) {
  const dx = wall.b[0] - wall.a[0];
  const dy = wall.b[1] - wall.a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return Math.max(0, Math.min(len, ((pt[0] - wall.a[0]) * ux) + ((pt[1] - wall.a[1]) * uy)));
}

function normalizeWallSegments(plan) {
  const source = Array.isArray(plan.wallRuns) && plan.wallRuns.length ? plan.wallRuns : plan.walls;
  const walls = [];
  for (const wall of (Array.isArray(source) ? source : [])) {
    if (wall && Array.isArray(wall.a) && Array.isArray(wall.b)) {
      walls.push({ a: [Number(wall.a[0]), Number(wall.a[1])], b: [Number(wall.b[0]), Number(wall.b[1])] });
    } else if (wall && Number.isFinite(wall.x1) && Number.isFinite(wall.y1) && Number.isFinite(wall.x2) && Number.isFinite(wall.y2)) {
      walls.push({ a: [Number(wall.x1), Number(wall.y1)], b: [Number(wall.x2), Number(wall.y2)] });
    }
  }
  return walls;
}

function footprintEdges(plan) {
  const pts = Array.isArray(plan.footprintFt) ? plan.footprintFt : [];
  const edges = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (Array.isArray(a) && Array.isArray(b)) edges.push({ a, b });
  }
  return edges;
}

function classifyWallType(wall, edges, tolFt = 1) {
  if (!edges.length) return 'interior';
  const mx = (wall.a[0] + wall.b[0]) / 2;
  const my = (wall.a[1] + wall.b[1]) / 2;
  for (const edge of edges) {
    if (pointSegDist(mx, my, edge.a, edge.b) <= tolFt) return 'exterior';
  }
  return 'interior';
}

function nearestWallIndex(position, walls) {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < walls.length; i += 1) {
    const d = pointSegDist(position[0], position[1], walls[i].a, walls[i].b);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function attachOpenings(walls, features, type) {
  for (const feature of (Array.isArray(features) ? features : [])) {
    if (!feature || !Array.isArray(feature.position) || !(Number(feature.width) > 0)) continue;
    const hostIdx = Number.isInteger(feature.hostWall) && feature.hostWall >= 0 && feature.hostWall < walls.length
      ? feature.hostWall
      : nearestWallIndex(feature.position, walls);
    if (!(hostIdx >= 0)) continue;
    const wall = walls[hostIdx];
    const offsetFt = projectOffsetFt(feature.position, wall);
    wall.openings.push({
      offsetFt: round(offsetFt),
      widthFt: round(Number(feature.width)),
      heightFt: type === 'window' ? 4 : 7,
      type,
    });
  }
}

function columnsFromEntry(entry, defaultSizeFt) {
  const pools = [
    entry?.columns,
    entry?.plan?.columns,
    entry?.structure?.columns,
    entry?.structureLayer?.columns,
  ];
  const seen = new Set();
  const cols = [];
  for (const pool of pools) {
    for (const col of (Array.isArray(pool) ? pool : [])) {
      const x = Number(col.x);
      const y = Number(col.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const sizeFt = Number(col.sizeFt) || Number(col.widthFt) || defaultSizeFt;
      const key = `${round(x)}:${round(y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cols.push({ x: round(x), y: round(y), sizeFt: round(sizeFt > 0 ? sizeFt : defaultSizeFt) });
    }
  }
  return cols;
}

function storyFromLevelPlan(entry, opts) {
  const plan = entry.plan || entry;
  const wallThicknessFt = Number(opts.wallThicknessFt) > 0 ? Number(opts.wallThicknessFt) : 0.5;
  const ceilingHeightFt = Number(opts.defaultCeilingHeightFt) > 0 ? Number(opts.defaultCeilingHeightFt) : 14;
  const defaultHazard = opts.defaultHazard || 'ordinary';
  const footprint = footprintEdges(plan);
  const walls = normalizeWallSegments(plan).map((wall) => ({
    a: [round(wall.a[0]), round(wall.a[1])],
    b: [round(wall.b[0]), round(wall.b[1])],
    thicknessFt: wallThicknessFt,
    type: classifyWallType(wall, footprint, Number(opts.exteriorTolFt) > 0 ? Number(opts.exteriorTolFt) : 1),
    openings: [],
  }));
  attachOpenings(walls, plan.doors, 'door');
  attachOpenings(walls, plan.openings, 'window');
  const spaces = (Array.isArray(plan.rooms) ? plan.rooms : [])
    .filter((room) => Array.isArray(room.poly) && room.poly.length >= 3)
    .map((room, idx) => ({
      name: room.label || `Space ${idx + 1}`,
      polygon: room.poly.map(([x, y]) => [round(x), round(y)]),
      hazard: defaultHazard,
    }));
  return {
    level: Number.isFinite(Number(entry.level)) ? Number(entry.level) : 0,
    baseElevationFt: Number.isFinite(Number(entry.elevationFt)) ? Number(entry.elevationFt) : 0,
    ceilingHeightFt,
    spaces,
    walls,
    columns: columnsFromEntry(entry, Number(opts.defaultColumnSizeFt) > 0 ? Number(opts.defaultColumnSizeFt) : 1.5),
  };
}

export function buildingFromLevelPlans(levelPlans, opts = {}) {
  if (!Array.isArray(levelPlans) || !levelPlans.length) {
    throw new Error('buildingFromLevelPlans: at least one level plan is required');
  }
  const stories = levelPlans.map((entry) => storyFromLevelPlan(entry, opts));
  const building = normalizeBuilding({
    name: opts.name || 'Extracted PDF Building',
    units: 'ft',
    stories,
  });
  const summary = {
    source: opts.source || 'vector',
    levels: building.stories.length,
    walls: building.stories.reduce((sum, story) => sum + story.walls.length, 0),
    openings: building.stories.reduce((sum, story) => sum + story.walls.reduce((n, wall) => n + (wall.openings?.length || 0), 0), 0),
    columns: building.stories.reduce((sum, story) => sum + story.columns.length, 0),
    spaces: building.stories.reduce((sum, story) => sum + story.spaces.length, 0),
    scaleFtPerUnit: levelPlans[0]?.plan?.scaleFtPerUnit ?? levelPlans[0]?.scaleFtPerUnit ?? null,
    perLevel: building.stories.map((story, idx) => ({
      level: story.level,
      walls: story.walls.length,
      openings: story.walls.reduce((n, wall) => n + (wall.openings?.length || 0), 0),
      columns: story.columns.length,
      spaces: story.spaces.length,
      scaleFtPerUnit: levelPlans[idx]?.plan?.scaleFtPerUnit ?? levelPlans[idx]?.scaleFtPerUnit ?? null,
    })),
    needsVerification: true,
    label: 'engineering-aid — needsVerification',
  };
  return { building, summary };
}
