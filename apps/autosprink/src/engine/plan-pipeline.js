import fs from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractLevelPlanFromPdf, segmentRooms } from './plan-extract.js';
import { extractArcsFromOpList, detectDoors, detectOpenings } from './plan-doors.js';
import { buildWallRuns } from './plan-wall-runs.js';
import { classifyPlanZones } from './zone-classifier.js';

const STANDARD_FONT_DATA_URL = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href;

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

function cloneModel(model) {
  return {
    shell: model.shell ? { ...model.shell, outline: [...model.shell.outline] } : null,
    grid: model.grid ? { ...model.grid, xs: [...(model.grid.xs || [])], ys: [...(model.grid.ys || [])] } : { xs: [], ys: [] },
    zones: Array.isArray(model.zones) ? [...model.zones] : [],
    walls: Array.isArray(model.walls) ? [...model.walls] : [],
    columns: Array.isArray(model.columns) ? [...model.columns] : [],
    doors: Array.isArray(model.doors) ? [...model.doors] : [],
    openings: Array.isArray(model.openings) ? [...model.openings] : [],
    rooms: Array.isArray(model.rooms) ? [...model.rooms] : [],
    diagnostics: Array.isArray(model.diagnostics) ? [...model.diagnostics] : [],
    needsVerification: true,
  };
}

function bboxFromOutline(outline) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of Array.isArray(outline) ? outline : []) {
    minX = Math.min(minX, Number(pt[0]));
    minY = Math.min(minY, Number(pt[1]));
    maxX = Math.max(maxX, Number(pt[0]));
    maxY = Math.max(maxY, Number(pt[1]));
  }
  if (!Number.isFinite(minX)) return null;
  return { minX: round(minX), minY: round(minY), maxX: round(maxX), maxY: round(maxY) };
}

function pointInBbox(point, bbox, tolerance = 0) {
  return (
    bbox &&
    point[0] >= bbox.minX - tolerance &&
    point[0] <= bbox.maxX + tolerance &&
    point[1] >= bbox.minY - tolerance &&
    point[1] <= bbox.maxY + tolerance
  );
}

function wallLength(wall) {
  return Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
}

function midpoint(wall) {
  return [round((wall.a[0] + wall.b[0]) / 2), round((wall.a[1] + wall.b[1]) / 2)];
}

function pointSegDistance(point, wall) {
  const [px, py] = point;
  const [x1, y1] = wall.a;
  const [x2, y2] = wall.b;
  const vx = x2 - x1;
  const vy = y2 - y1;
  const c2 = vx * vx + vy * vy;
  if (c2 <= 1e-9) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / c2));
  const sx = x1 + t * vx;
  const sy = y1 + t * vy;
  return Math.hypot(px - sx, py - sy);
}

function endpointSupported(point, wallIndex, walls, shellBbox, tolerance) {
  if (pointInBbox(point, shellBbox, tolerance)) {
    for (let index = 0; index < walls.length; index += 1) {
      if (index === wallIndex) continue;
      if (pointSegDistance(point, walls[index]) <= tolerance) return true;
    }
    const wall = walls[wallIndex];
    const onShellEdge =
      Math.abs(point[0] - shellBbox.minX) <= tolerance ||
      Math.abs(point[0] - shellBbox.maxX) <= tolerance ||
      Math.abs(point[1] - shellBbox.minY) <= tolerance ||
      Math.abs(point[1] - shellBbox.maxY) <= tolerance;
    if (onShellEdge) return true;
  }
  return false;
}

function orphanWallIds(walls, shellBbox, tolerance = 0.35) {
  const out = [];
  for (let index = 0; index < walls.length; index += 1) {
    const wall = walls[index];
    const supportedA = endpointSupported(wall.a, index, walls, shellBbox, tolerance);
    const supportedB = endpointSupported(wall.b, index, walls, shellBbox, tolerance);
    if (!supportedA || !supportedB) out.push(wall.id);
  }
  return out;
}

function validateBuildingModel(model, stage) {
  const diagnostics = [];
  const push = (code, message, details = {}) => diagnostics.push({ stage, level: 'error', code, message, details });

  if (!model.shell || !Array.isArray(model.shell.outline) || model.shell.outline.length < 4) {
    push('shell_missing', 'Building shell must have at least 4 outline points.');
  }
  if (stage === 'pass2' && (!Array.isArray(model.zones) || model.zones.length === 0)) {
    push('zones_missing', 'Zone pass must produce at least one zone.');
  }
  if (stage === 'pass3') {
    if (!Array.isArray(model.walls) || model.walls.length === 0) {
      push('walls_missing', 'Wall pass must produce at least one wall.');
    } else {
      const shellBbox = bboxFromOutline(model.shell.outline);
      const badWalls = model.walls.filter((wall) => !pointInBbox(wall.a, shellBbox, 1) || !pointInBbox(wall.b, shellBbox, 1));
      if (badWalls.length) {
        push('walls_outside_shell', 'Wall pass produced walls outside the shell bbox.', { count: badWalls.length });
      }
      const orphans = orphanWallIds(model.walls, shellBbox);
      if (orphans.length) {
        push('orphan_walls', 'Wall pass produced orphan walls.', { wallIds: orphans });
      }
    }
  }
  if (stage === 'pass5' && Array.isArray(model.doors)) {
    const wallIds = new Set((model.walls || []).map((wall) => wall.id));
    const badDoors = model.doors.filter((door) => !wallIds.has(door.wallId));
    if (badDoors.length) {
      push('door_wall_reference_missing', 'Every door must reference an existing wall.', { count: badDoors.length });
    }
  }
  if (stage === 'pass6' && Array.isArray(model.openings)) {
    const wallIds = new Set((model.walls || []).map((wall) => wall.id));
    const badOpenings = model.openings.filter((opening) => opening.wallId && !wallIds.has(opening.wallId));
    if (badOpenings.length) {
      push('opening_wall_reference_missing', 'Every opening with a wall reference must point at an existing wall.', { count: badOpenings.length });
    }
  }
  if (stage === 'pass7' && (!Array.isArray(model.rooms) || model.rooms.length === 0)) {
    push('rooms_missing', 'Room pass must produce at least one room.');
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

function normalizePlanWall(wall, index, zones) {
  const mid = midpoint(wall);
  const zone = zones.find((candidate) => candidate.bbox && pointInBbox(mid, candidate.bbox, 0.5)) || null;
  return {
    id: `wall-${index + 1}`,
    a: [round(wall.a[0]), round(wall.a[1])],
    b: [round(wall.b[0]), round(wall.b[1])],
    lengthFt: round(wallLength(wall)),
    axis: Math.abs(wall.a[1] - wall.b[1]) <= 0.04 ? 'H' : Math.abs(wall.a[0] - wall.b[0]) <= 0.04 ? 'V' : 'D',
    zoneId: zone ? zone.id : null,
    type: zone && zone.kind === 'parking' ? 'parking-edge' : 'wall',
    needsVerification: true,
  };
}

function pickWallGeometry(plan, diagnostics) {
  const extractedWalls = Array.isArray(plan.walls) ? plan.walls : [];
  const mergedRuns = buildWallRuns(extractedWalls).runs;
  if (mergedRuns.length > extractedWalls.length) {
    return mergedRuns;
  }
  if (mergedRuns.length > 0 && extractedWalls.length - mergedRuns.length > 4) {
    diagnostics.push({
      stage: 'pass3',
      level: 'warning',
      code: 'wall_runs_fallback',
      message:
        'Merged wall runs collapsed too much plan detail for this fixture; using the validated extracted wall segments instead.',
      details: { extractedWalls: extractedWalls.length, mergedRuns: mergedRuns.length },
    });
  }
  return extractedWalls.length ? extractedWalls : mergedRuns;
}

function assignDoorWallId(door, walls) {
  let best = null;
  let bestDistance = Infinity;
  for (const wall of walls) {
    const distance = pointSegDistance(door.position, wall);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = wall;
    }
  }
  return best ? { wallId: best.id, distanceFt: round(bestDistance) } : { wallId: null, distanceFt: null };
}

async function loadPlanPage(pdfPath, pageNum, opts) {
  const bytes = await fs.readFile(pdfPath);
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(pageNum);
    const extractOpts = {
      ...(opts.extractOpts || {}),
      roomOpts: opts.extractOpts?.roomOpts || opts.roomOpts,
    };
    const plan = await extractLevelPlanFromPdf(page, extractOpts);
    const opList = await page.getOperatorList();
    return { plan, page, opList };
  } finally {
    await loadingTask.destroy();
  }
}

export async function buildModelFromPlan(pdfPath, pageNum = 1, opts = {}) {
  const diagnostics = [];
  const passesRun = [];
  const loaded = opts.plan
    ? { plan: opts.plan, page: null, opList: opts.opList || null }
    : await loadPlanPage(pdfPath, pageNum, opts);
  const { plan, opList } = loaded;
  const model = cloneModel({ shell: null, grid: { xs: [], ys: [] }, zones: [], walls: [], columns: [], doors: [], openings: [], rooms: [] });

  const validateAndMaybeStop = (stage) => {
    const result = validateBuildingModel(model, stage);
    diagnostics.push(...result.diagnostics);
    if (!result.ok) return true;
    passesRun.push(stage);
    return false;
  };

  model.shell = {
    outline: (Array.isArray(plan.footprintFt) ? plan.footprintFt : []).map(([x, y]) => [round(x), round(y)]),
    bbox: bboxFromOutline(plan.footprintFt),
    source: 'plan-extract',
    needsVerification: true,
  };
  model.grid = {
    xs: [...((plan.grid && plan.grid.xs) || [])],
    ys: [...((plan.grid && plan.grid.ys) || [])],
    labels: (plan.grid && plan.grid.labels) || { cols: [], rows: [] },
    source: 'plan-extract',
    needsVerification: true,
  };
  if (validateAndMaybeStop('pass1')) return { model, diagnostics, passesRun };

  const zoneResult = classifyPlanZones(plan, opts.zoneOpts || {});
  model.zones = zoneResult.zones;
  diagnostics.push({ stage: 'pass2', level: 'info', code: 'zones_classified', message: zoneResult.note, details: { counts: zoneResult.counts } });
  if (validateAndMaybeStop('pass2')) return { model, diagnostics, passesRun };

  const chosenWalls = pickWallGeometry(plan, diagnostics);
  const shellBbox = model.shell.bbox;
  const rawWalls = chosenWalls
    .map((wall, index) => normalizePlanWall(wall, index, model.zones))
    .filter((wall) => wall.lengthFt > 0.5 && pointInBbox(wall.a, shellBbox, 1) && pointInBbox(wall.b, shellBbox, 1));
  const orphansBefore = orphanWallIds(rawWalls, shellBbox);
  model.walls = rawWalls.filter((wall) => !orphansBefore.includes(wall.id));
  if (orphansBefore.length) {
    diagnostics.push({
      stage: 'pass3',
      level: 'warning',
      code: 'orphan_walls_dropped',
      message: 'Dropped orphan walls after the wall pass.',
      details: { droppedWallIds: orphansBefore },
    });
  }
  if (validateAndMaybeStop('pass3')) return { model, diagnostics, passesRun };

  const rawColumns = Array.isArray(plan.columns) ? plan.columns : [];
  model.columns = rawColumns
    .filter((column) => Number.isFinite(Number(column.x)) && Number.isFinite(Number(column.y)))
    .map((column, index) => ({
      id: `column-${index + 1}`,
      x: round(column.x),
      y: round(column.y),
      sizeFt: Number.isFinite(Number(column.sizeFt)) ? round(column.sizeFt) : 1,
      confidence: column.confidence || 'low',
      needsVerification: true,
    }));
  if (validateAndMaybeStop('pass4')) return { model, diagnostics, passesRun };

  const arcs = opList ? extractArcsFromOpList(opList, { scale: plan.scaleFtPerUnit }).arcs : [];
  const doorResult = detectDoors(arcs, model.walls, opts.doorOpts || {});
  model.doors = doorResult.doors.map((door, index) => {
    const ref = assignDoorWallId(door, model.walls);
    return {
      id: `door-${index + 1}`,
      wallId: ref.wallId,
      wallDistanceFt: ref.distanceFt,
      position: door.position,
      widthFt: round(door.width),
      confidence: door.confidence,
      needsVerification: true,
    };
  });
  diagnostics.push({
    stage: 'pass5',
    level: 'info',
    code: 'doors_detected',
    message: doorResult.note,
    details: { doors: model.doors.length, confidentCount: doorResult.confidentCount, suspectCount: doorResult.suspectCount },
  });
  if (validateAndMaybeStop('pass5')) return { model, diagnostics, passesRun };

  const openingResult = detectOpenings(model.walls, model.doors.map((door) => ({ position: door.position, width: door.widthFt })), opts.openingOpts || {});
  model.openings = openingResult.openings.map((opening, index) => {
    const ref = assignDoorWallId({ position: opening.position }, model.walls);
    return {
      id: `opening-${index + 1}`,
      wallId: ref.wallId,
      position: opening.position,
      widthFt: round(opening.width),
      confidence: opening.confidence,
      needsVerification: true,
    };
  });
  diagnostics.push({ stage: 'pass6', level: 'info', code: 'openings_detected', message: openingResult.note, details: { openings: model.openings.length } });
  if (validateAndMaybeStop('pass6')) return { model, diagnostics, passesRun };

  const segmented = segmentRooms(
    model.walls.map((wall) => ({ x1: wall.a[0], y1: wall.a[1], x2: wall.b[0], y2: wall.b[1] })),
    (plan.labels || []).map((label) => ({ s: label.text, xFt: label.xFt, yFt: label.yFt })),
    opts.roomOpts || {},
  );
  model.rooms = segmented.rooms.map((room, index) => {
    const zone = model.zones.find((candidate) => candidate.bbox && pointInBbox([room.bbox.minX, room.bbox.minY], candidate.bbox, 0.5)) || null;
    return {
      id: `room-${index + 1}`,
      polygon: room.poly.map(([x, y]) => [round(x), round(y)]),
      kind: zone ? zone.kind : room.kind,
      label: room.label || zone?.label || null,
      areaSqft: round(room.areaSqft),
      zoneId: zone ? zone.id : null,
      confidence: room.confidence,
      needsVerification: true,
    };
  });
  diagnostics.push({ stage: 'pass7', level: 'info', code: 'rooms_segmented', message: segmented.note, details: { rooms: model.rooms.length } });
  if (validateAndMaybeStop('pass7')) return { model, diagnostics, passesRun };

  return { model, diagnostics, passesRun };
}
