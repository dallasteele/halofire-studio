import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBuildingModel,
  validateBuildingModel,
  mergeIntoModel,
} from './building-model.js';
import { buildWallRuns } from './plan-wall-runs.js';
import { buildZoneClassifierInput } from './zone-classifier.js';
import { verifyPass } from './loop-verify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '../..');
const FALLBACK_PLAN_JSON = path.resolve(APP_ROOT, 'src/data/plan-levels.cooperative-1881.json');
const KNOWN_PLAN_BASENAME = '1881-architecturals.pdf';

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

function toSeg(wall) {
  return wall && wall.a && wall.b
    ? { x1: Number(wall.a[0]), y1: Number(wall.a[1]), x2: Number(wall.b[0]), y2: Number(wall.b[1]) }
    : wall;
}

function pointDistance(a, b) {
  return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));
}

function midpoint(wall) {
  return [
    (Number(wall.a[0]) + Number(wall.b[0])) / 2,
    (Number(wall.a[1]) + Number(wall.b[1])) / 2,
  ];
}

function pointInBbox(pt, bbox) {
  return bbox && pt[0] >= bbox.minX && pt[0] <= bbox.maxX && pt[1] >= bbox.minY && pt[1] <= bbox.maxY;
}

function normalizeRoom(room) {
  return {
    poly: Array.isArray(room?.poly) ? room.poly : Array.isArray(room?.polygon) ? room.polygon : [],
    kind: room?.kind || 'unknown',
    label: room?.label || room?.name || null,
    confidence: room?.confidence || 'low',
    areaSqft: Number.isFinite(room?.areaSqft) ? room.areaSqft : null,
  };
}

function orphanWall(wall, walls, tolFt = 3) {
  const pts = [wall.a, wall.b];
  return pts.every((pt) => walls.every((other) => {
    if (other === wall) return true;
    return pointDistance(pt, other.a) > tolFt && pointDistance(pt, other.b) > tolFt;
  }));
}

function pruneOrphanWalls(walls, tolFt = 3) {
  return (Array.isArray(walls) ? walls : []).filter((wall) => !orphanWall(wall, walls, tolFt));
}

function attachOpeningsToWalls(walls, openings) {
  return walls.map((wall, index) => ({
    ...wall,
    openings: (Array.isArray(openings) ? openings : []).filter((opening) => opening.hostWall === index),
  }));
}

function resolvePdfPath(pdfPath) {
  const candidates = [];
  if (pdfPath) {
    candidates.push(path.resolve(process.cwd(), pdfPath));
    candidates.push(path.resolve(APP_ROOT, pdfPath));
  }
  candidates.push(path.resolve(APP_ROOT, 'plans/cooperative-1881/1881-architecturals.pdf'));
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function loadFallbackPlan(pageNum) {
  if (!fs.existsSync(FALLBACK_PLAN_JSON)) return null;
  const data = JSON.parse(fs.readFileSync(FALLBACK_PLAN_JSON, 'utf8'));
  const level = (data.levels || []).find((entry) => Number(entry.page) === Number(pageNum));
  if (!level?.plan) return null;
  return level.plan;
}

async function loadPlanSource(pdfPath, pageNum, opts, diagnostics) {
  const resolvedPdf = resolvePdfPath(pdfPath);
  if (resolvedPdf && fs.existsSync(resolvedPdf)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { extractLevelPlanFromPdf } = await import('./plan-extract.js');
    const bytes = fs.readFileSync(resolvedPdf);
    const loadingTask = getDocument({ data: new Uint8Array(bytes) });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNum);
    const plan = await extractLevelPlanFromPdf(page, opts.extractOpts || {});
    const opList = await page.getOperatorList();
    return { plan, opList, source: 'pdf', resolvedPdf };
  }
  if (path.basename(pdfPath || '') === KNOWN_PLAN_BASENAME || String(pdfPath || '').includes('cooperative-1881')) {
    const plan = loadFallbackPlan(pageNum);
    if (plan) {
      diagnostics.push({
        pass: 'source',
        severity: 'warning',
        message: `PDF asset missing at ${resolvedPdf}; used checked-in extracted cooperative-1881 plan data for page ${pageNum}.`,
      });
      return { plan, opList: null, source: 'fallback-json', resolvedPdf };
    }
  }
  throw new Error(`buildModelFromPlan: PDF not found at ${resolvedPdf}`);
}

function recordVerify(model, passName, diagnostics) {
  const result = verifyPass(model, passName);
  if (!result.ok) {
    diagnostics.push({
      pass: passName,
      severity: 'warning',
      message: result.diagnostics.join('; '),
    });
  }
}

function buildCandidateColumnPoints(grid) {
  const xs = Array.isArray(grid?.xs) ? grid.xs : [];
  const ys = Array.isArray(grid?.ys) ? grid.ys : [];
  const out = [];
  for (const x of xs) {
    for (const y of ys) out.push({ x, y });
  }
  return out;
}

export async function buildModelFromPlan(pdfPath, pageNum, opts = {}) {
  const diagnostics = [];
  const passesRun = [];
  const { plan, opList, source, resolvedPdf } = await loadPlanSource(pdfPath, pageNum, opts, diagnostics);

  let model = createBuildingModel({
    name: `Plan p${pageNum}`,
    meta: {
      source,
      resolvedPdf,
      scaleFtPerUnit: plan.scaleFtPerUnit || null,
      provenance: plan.provenance || null,
    },
  });

  model = mergeIntoModel(model, {
    shell: {
      outline: Array.isArray(plan.footprintFt) ? plan.footprintFt : [],
      areaSqft: Number.isFinite(plan.footprintAreaSqft) ? plan.footprintAreaSqft : 0,
      bbox: plan.footprintBboxFt || null,
    },
    grid: plan.grid || { xs: [], ys: [], labels: { cols: [], rows: [] } },
  });
  passesRun.push('pass1-footprint-grid');
  recordVerify(model, 'pass1-footprint-grid', diagnostics);

  const zoneInput = buildZoneClassifierInput({
    rooms: Array.isArray(plan.rooms) ? plan.rooms : [],
    labels: Array.isArray(plan.labels) ? plan.labels : [],
    occupancyHint: plan.occupancyHint || null,
  });
  model = mergeIntoModel(model, { zones: zoneInput.zones });
  passesRun.push('pass2-zones');
  recordVerify(model, 'pass2-zones', diagnostics);

  const parkingZones = zoneInput.zones.filter((zone) => zone.kind === 'parking' && zone.bbox);
  const filteredWallSegs = (Array.isArray(plan.walls) ? plan.walls : [])
    .filter((wall) => {
      if (parkingZones.length === 0) return true;
      const mid = midpoint(wall);
      return !parkingZones.some((zone) => pointInBbox(mid, zone.bbox));
    });
  const mergedWalls = buildWallRuns(filteredWallSegs, opts.wallRunOpts || {}).runs.map((run) => ({
    a: run.a,
    b: run.b,
    axis: run.axis,
    lengthFt: run.lengthFt,
    thicknessFt: 0.5,
    type: 'interior',
    openings: [],
  }));
  model = mergeIntoModel(model, {
    walls: pruneOrphanWalls(mergedWalls, 3),
  });
  passesRun.push('pass3-walls');
  recordVerify(model, 'pass3-walls', diagnostics);

  const columnCandidates = buildCandidateColumnPoints(model.grid);
  let markerRes = { markers: [] };
  let columnRes = { columns: [] };
  try {
    const { detectColumnMarkers, detectColumns } = await import('./structure-from-plan.js');
    markerRes = detectColumnMarkers(columnCandidates, (Array.isArray(plan.walls) ? plan.walls : []).map(toSeg), opts.columnOpts || {});
    columnRes = detectColumns(model.grid, (Array.isArray(plan.walls) ? plan.walls : []).map(toSeg), [], opts.columnOpts || {});
  } catch (error) {
    diagnostics.push({
      pass: 'pass4-columns',
      severity: 'warning',
      message: `Column pass skipped: ${error.message}`,
    });
  }
  model = mergeIntoModel(model, {
    columns: columnRes.columns.map((column) => ({
      x: column.x,
      y: column.y,
      sizeFt: 1,
      size: column.size || null,
      kind: column.kind || null,
      markerSegs: column.markerSegs,
      confidence: column.confidence,
    })),
  });
  if (markerRes.markers.length === 0) {
    diagnostics.push({
      pass: 'pass4-columns',
      severity: 'info',
      message: 'No validated column markers found on this plan source.',
    });
  }
  passesRun.push('pass4-columns');
  recordVerify(model, 'pass4-columns', diagnostics);

  let doorRes = { doors: [] };
  if (opList) {
    const { detectDoorsFromOpList } = await import('./door-extractor.js');
    doorRes = detectDoorsFromOpList(opList, model.walls, {
      ...opts.doorOpts,
      scaleFtPerUnit: plan.scaleFtPerUnit,
    });
  } else if (Array.isArray(plan.doors)) {
    doorRes = { doors: plan.doors };
  }
  const doors = (Array.isArray(doorRes.doors) ? doorRes.doors : [])
    .filter((door) => Number.isFinite(door.hostWallDistFt) ? door.hostWallDistFt <= 3 : true)
    .map((door) => ({
      ...door,
      widthFt: Number.isFinite(door.widthFt) ? door.widthFt : Number(door.width) || null,
    }));
  model = mergeIntoModel(model, { doors });
  passesRun.push('pass5-doors');
  recordVerify(model, 'pass5-doors', diagnostics);

  let openingRes = { openings: [] };
  if (Array.isArray(plan.openings)) {
    openingRes = { openings: plan.openings };
  } else {
    const { detectOpenings } = await import('./plan-doors.js');
    openingRes = detectOpenings(model.walls, model.doors, opts.openingOpts || {});
  }
  const openings = (Array.isArray(openingRes.openings) ? openingRes.openings : []).map((opening) => {
    if (Number.isInteger(opening.hostWall)) return opening;
    let hostWall = null;
    let best = Infinity;
    model.walls.forEach((wall, index) => {
      const mx = midpoint(wall);
      const d = pointDistance(mx, opening.position);
      if (d < best) {
        best = d;
        hostWall = index;
      }
    });
    return { ...opening, hostWall };
  });
  model = mergeIntoModel(model, { openings });
  model.walls = attachOpeningsToWalls(model.walls, model.openings);
  passesRun.push('pass6-openings');
  recordVerify(model, 'pass6-openings', diagnostics);

  let rooms = Array.isArray(plan.rooms)
    ? plan.rooms.map(normalizeRoom)
    : [];
  if (rooms.length === 0) {
    const { segmentRooms } = await import('./plan-extract.js');
    rooms = segmentRooms(model.walls.map(toSeg), Array.isArray(plan.labels) ? plan.labels.map((label) => ({
      s: label.text,
      xFt: label.xFt,
      yFt: label.yFt,
    })) : [], opts.roomOpts || {}).rooms.map(normalizeRoom);
  }
  rooms = rooms.map((room) => {
    const zone = zoneInput.zones.find((candidate) => candidate.bbox && room.poly.some((pt) => pointInBbox(pt, candidate.bbox)));
    return { ...room, zoneId: zone?.id || null };
  });
  model = mergeIntoModel(model, { rooms });
  passesRun.push('pass7-rooms');
  recordVerify(model, 'pass7-rooms', diagnostics);

  try {
    validateBuildingModel(model);
  } catch (error) {
    diagnostics.push({
      pass: 'validate',
      severity: 'warning',
      message: error.message,
    });
    throw error;
  }

  return { model, diagnostics, passesRun };
}
