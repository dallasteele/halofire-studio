/**
 * zone-classifier.js — best-effort floor zone classification for internal alpha use.
 *
 * This slice classifies caller-supplied candidate space polygons into coarse building zones:
 * parking, lobby, unit, corridor, stair, mech, restroom, and storage.
 *
 * Honest scope:
 * - This module DOES NOT segment room polygons from raw wall geometry. Callers must provide
 *   `spaces` / `rooms` candidate polygons. If they do not, this module throws instead of
 *   fabricating a segmentation.
 * - SAM is optional and used ONLY per ambiguous zone via an injected async invoker.
 * - Every result stays best-effort and needsVerification:true.
 */

const ZONE_KINDS = Object.freeze([
  'parking',
  'lobby',
  'unit',
  'corridor',
  'stair',
  'mech',
  'restroom',
  'storage',
  'unknown',
]);

const LABEL_RULES = Object.freeze([
  { kind: 'stair', re: /\bSTAIR(WELL|CASE|S)?\b|\bSTR\b/i },
  { kind: 'mech', re: /\bMECH(ANICAL)?\b|\bELEC(TRICAL)?\b|\bM\.?E\.?P\b|\bBOILER\b|\bFAN\s*ROOM\b/i },
  { kind: 'restroom', re: /\bREST\s*ROOM\b|\bTOILET\b|\bW\.?C\.?\b|\bBATH(ROOM)?\b/i },
  { kind: 'storage', re: /\bSTOR(AGE|\.)?\b|\bCLOSET\b|\bJAN(ITOR)?\b/i },
  { kind: 'parking', re: /\bPARK(ING)?\b|\bGARAGE\b|\bSTALL\b/i },
  { kind: 'lobby', re: /\bLOBBY\b|\bENTRY\b|\bVESTIBULE\b/i },
  { kind: 'corridor', re: /\bCORRIDOR\b|\bHALL(WAY)?\b/i },
  { kind: 'unit', re: /\bUNIT\b|\bAPT\b|\bAPARTMENT\b|\bRESIDEN(CE|TIAL)\b|\bSTUDIO\b|\b[1-4]\s*BR\b/i },
]);

const RESIDENTIAL_FIXTURES = new Set(['sink', 'kitchen', 'range', 'fridge', 'refrigerator', 'toilet', 'shower', 'tub', 'lavatory']);
const RESTROOM_FIXTURES = new Set(['toilet', 'urinal', 'lavatory', 'sink']);

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

function validPoint(pt) {
  return Array.isArray(pt) && pt.length >= 2 && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1]));
}

function cleanPolygon(poly) {
  const out = Array.isArray(poly) ? poly.filter(validPoint).map(([x, y]) => [Number(x), Number(y)]) : [];
  return out.length >= 3 ? out : null;
}

function polygonArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function bboxOf(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function centroidOf(poly) {
  const sum = poly.reduce((acc, [x, y]) => {
    acc.x += x;
    acc.y += y;
    return acc;
  }, { x: 0, y: 0 });
  return [round(sum.x / poly.length), round(sum.y / poly.length)];
}

function pointInPolygon(point, poly) {
  if (!validPoint(point) || !Array.isArray(poly) || poly.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnSegment(point, a, b, tol = 0.5) {
  const [px, py] = point;
  const [ax, ay] = a;
  const [bx, by] = b;
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 <= 1e-9) return Math.hypot(px - ax, py - ay) <= tol;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy) <= tol;
}

function containsPointInclusive(point, poly, tol = 0.5) {
  if (pointInPolygon(point, poly)) return true;
  for (let i = 0; i < poly.length; i += 1) {
    if (pointOnSegment(point, poly[i], poly[(i + 1) % poly.length], tol)) return true;
  }
  return false;
}

function bboxOverlap(a, b) {
  const x = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const y = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return { x, y };
}

function bboxAdjacency(a, b, tol = 1) {
  const overlap = bboxOverlap(a, b);
  const verticalGap = Math.min(Math.abs(a.maxX - b.minX), Math.abs(b.maxX - a.minX));
  const horizontalGap = Math.min(Math.abs(a.maxY - b.minY), Math.abs(b.maxY - a.minY));
  if (overlap.y > tol && verticalGap <= tol) return overlap.y;
  if (overlap.x > tol && horizontalGap <= tol) return overlap.x;
  return 0;
}

function sharesFootprintBoundary(spaceBbox, footprintBbox, tol = 1) {
  if (!footprintBbox) return false;
  return Math.abs(spaceBbox.minX - footprintBbox.minX) <= tol
    || Math.abs(spaceBbox.maxX - footprintBbox.maxX) <= tol
    || Math.abs(spaceBbox.minY - footprintBbox.minY) <= tol
    || Math.abs(spaceBbox.maxY - footprintBbox.maxY) <= tol;
}

function classifyLabelText(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  for (const rule of LABEL_RULES) {
    if (rule.re.test(value)) return rule.kind;
  }
  return null;
}

function normalizeWall(wall) {
  if (!wall || typeof wall !== 'object') return null;
  const a = validPoint(wall.a) ? [Number(wall.a[0]), Number(wall.a[1])] : null;
  const b = validPoint(wall.b) ? [Number(wall.b[0]), Number(wall.b[1])] : null;
  if (!a || !b) return null;
  return { a, b, type: String(wall.type || 'interior').toLowerCase() };
}

function midpointOfWall(wall) {
  return [round((wall.a[0] + wall.b[0]) / 2), round((wall.a[1] + wall.b[1]) / 2)];
}

function normalizeDoor(door) {
  const pt = door && validPoint(door.position) ? [Number(door.position[0]), Number(door.position[1])] : null;
  if (!pt) return null;
  return { ...door, position: pt };
}

function normalizePointRecord(record) {
  const keys = [
    ['position', 'position'],
    ['centroidFt', 'position'],
    ['center', 'position'],
  ];
  for (const [from, to] of keys) {
    if (record && validPoint(record[from])) {
      return { ...record, [to]: [Number(record[from][0]), Number(record[from][1])] };
    }
  }
  if (record && Number.isFinite(Number(record.x)) && Number.isFinite(Number(record.y))) {
    return { ...record, position: [Number(record.x), Number(record.y)] };
  }
  return null;
}

function zoneId(kind, index) {
  return `zone:${kind}:${index + 1}`;
}

function classifyFixtureKind(raw) {
  return String(raw || '').trim().toLowerCase();
}

function columnGridScore(columns) {
  if (columns.length < 4) return 0;
  const xs = [...new Set(columns.map((c) => round(c.position[0])))].sort((a, b) => a - b);
  const ys = [...new Set(columns.map((c) => round(c.position[1])))].sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) return 0.25;
  const gapScore = (vals) => {
    if (vals.length < 3) return 1;
    const gaps = [];
    for (let i = 1; i < vals.length; i += 1) gaps.push(vals[i] - vals[i - 1]);
    const avg = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    if (!(avg > 0)) return 0;
    const variance = gaps.reduce((sum, gap) => sum + (gap - avg) ** 2, 0) / gaps.length;
    const cv = Math.sqrt(variance) / avg;
    return clamp01(1 - cv);
  };
  return round(clamp01(((gapScore(xs) + gapScore(ys)) / 2) * Math.min(1, columns.length / 8)));
}

function rectangleScore(bbox, areaSqft) {
  const bboxArea = Math.max((bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY), 1e-9);
  return clamp01(areaSqft / bboxArea);
}

function buildSpaceFacts(space, context) {
  const polygon = cleanPolygon(space.polygon || space.poly);
  if (!polygon) return null;
  const bbox = bboxOf(polygon);
  const areaSqft = round(polygonArea(polygon));
  const centroid = centroidOf(polygon);
  const labels = context.labels.filter((label) => containsPointInclusive(label.position, polygon));
  const labelKinds = labels.map((label) => classifyLabelText(label.text)).filter(Boolean);
  const doors = context.doors.filter((door) => containsPointInclusive(door.position, polygon));
  const columns = context.columns.filter((column) => containsPointInclusive(column.position, polygon));
  const stairs = context.stairs.filter((stair) => containsPointInclusive(stair.position, polygon));
  const fixtures = context.fixtures.filter((fixture) => containsPointInclusive(fixture.position, polygon));
  const parkingStalls = context.parkingStalls.filter((stall) => containsPointInclusive(stall.position, polygon));
  const walls = context.walls.filter((wall) => containsPointInclusive(midpointOfWall(wall), polygon));
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  const aspect = width > 0 && height > 0 ? round(Math.max(width, height) / Math.max(Math.min(width, height), 1e-9)) : 1;
  const extDoors = doors.filter((door) => door.isExterior === true
    || (context.footprintBbox && sharesFootprintBoundary({ minX: door.position[0], maxX: door.position[0], minY: door.position[1], maxY: door.position[1] }, context.footprintBbox, 1.5)));
  const fixtureKinds = fixtures.map((fixture) => classifyFixtureKind(fixture.fixtureKind || fixture.kind));
  return {
    source: space,
    polygon,
    bbox,
    areaSqft,
    centroid,
    labels,
    labelKinds,
    primaryLabel: labels[0]?.text || String(space.name || space.label || '').trim() || null,
    doors,
    columns,
    stairs,
    fixtures,
    parkingStalls,
    walls,
    width,
    height,
    aspect,
    fixtureKinds,
    exteriorDoorCount: extDoors.length,
    sharesExterior: sharesFootprintBoundary(bbox, context.footprintBbox),
    columnGridScore: columnGridScore(columns),
    rectangleScore: rectangleScore(bbox, areaSqft),
    interiorWallCount: walls.filter((wall) => wall.type !== 'exterior').length,
  };
}

function baseZone(facts, index) {
  return {
    id: zoneId('unknown', index),
    name: facts.source.name || facts.primaryLabel || `Zone ${index + 1}`,
    kind: 'unknown',
    polygon: facts.polygon,
    bbox: facts.bbox,
    centroidFt: facts.centroid,
    areaSqft: facts.areaSqft,
    label: facts.primaryLabel,
    confidence: 'low',
    kindSource: 'heuristic',
    evidence: [],
    needsVerification: true,
    doorCount: facts.doors.length,
    columnCount: facts.columns.length,
    stairCount: facts.stairs.length,
    fixtureKinds: [...new Set(facts.fixtureKinds)].filter(Boolean),
  };
}

function assignKind(zone, kind, confidence, source, evidence) {
  zone.id = zoneId(kind, Number(zone.id.split(':').at(-1)) - 1 || 0);
  zone.kind = kind;
  zone.confidence = confidence;
  zone.kindSource = source;
  zone.evidence = evidence.filter(Boolean);
  return zone;
}

function directKindFromFacts(facts) {
  const restroomFixtureCount = facts.fixtureKinds.filter((kind) => RESTROOM_FIXTURES.has(kind)).length;
  const residentialFixtureCount = facts.fixtureKinds.filter((kind) => RESIDENTIAL_FIXTURES.has(kind)).length;
  if (facts.stairs.length > 0 || facts.labelKinds.includes('stair') || facts.fixtureKinds.includes('stair')) {
    return { kind: 'stair', confidence: 'high', evidence: ['stair-core-or-label'] };
  }
  if (facts.labelKinds.includes('mech') || facts.fixtureKinds.some((kind) => ['water-heater', 'air-handler', 'panel', 'mech'].includes(kind))) {
    return { kind: 'mech', confidence: 'high', evidence: ['mech-label-or-fixture'] };
  }
  if (facts.labelKinds.includes('restroom')
    || (restroomFixtureCount >= 2 && facts.areaSqft <= 180 && residentialFixtureCount === restroomFixtureCount)) {
    return { kind: 'restroom', confidence: 'high', evidence: ['restroom-label-or-fixture'] };
  }
  if (facts.labelKinds.includes('storage')) {
    return { kind: 'storage', confidence: 'high', evidence: ['storage-label'] };
  }
  if (facts.labelKinds.includes('parking')) {
    return { kind: 'parking', confidence: 'high', evidence: ['parking-label'] };
  }
  if (facts.labelKinds.includes('lobby')) {
    return { kind: 'lobby', confidence: 'high', evidence: ['lobby-label'] };
  }
  if (facts.labelKinds.includes('corridor')) {
    return { kind: 'corridor', confidence: 'high', evidence: ['corridor-label'] };
  }
  if (facts.labelKinds.includes('unit')) {
    return { kind: 'unit', confidence: 'high', evidence: ['unit-label'] };
  }
  return null;
}

function unitLike(facts) {
  const residentialFixtures = facts.fixtureKinds.filter((kind) => RESIDENTIAL_FIXTURES.has(kind)).length;
  return facts.rectangleScore >= 0.92 && facts.doors.length >= 1 && residentialFixtures >= 2;
}

function parkingLike(facts, medianArea) {
  return facts.areaSqft >= Math.max(600, medianArea * 1.6)
    && facts.columnGridScore >= 0.45
    && facts.parkingStalls.length >= 2
    && facts.interiorWallCount <= 2;
}

function lobbyLike(facts) {
  return facts.sharesExterior
    && facts.exteriorDoorCount >= 1
    && facts.columnGridScore < 0.3
    && facts.areaSqft >= 120
    && facts.areaSqft <= 1200;
}

function corridorLike(facts, neighbors, zones) {
  const unitNeighbors = neighbors.filter((neighborIndex) => zones[neighborIndex]?.kind === 'unit').length;
  return facts.aspect >= 2.4 && facts.doors.length >= 2 && unitNeighbors >= 2;
}

function buildAdjacency(factsList, tol = 1) {
  return factsList.map(() => []);
}

async function refineAmbiguousZones(zones, factsList, context, opts = {}) {
  if (typeof context.samInvoker !== 'function') return zones;
  const candidates = zones
    .map((zone, index) => ({ zone, facts: factsList[index], index }))
    .filter(({ zone }) => zone.kind === 'unknown');
  for (const candidate of candidates) {
    let result = null;
    try {
      result = await context.samInvoker({
        task: 'zone-kind-classification',
        polygonFt: candidate.zone.polygon,
        centroidFt: candidate.zone.centroidFt,
        areaSqft: candidate.zone.areaSqft,
        label: candidate.zone.label,
        candidateKinds: opts.candidateKinds || ['parking', 'lobby', 'unit', 'corridor', 'stair', 'mech', 'restroom', 'storage'],
      });
    } catch (error) {
      candidate.zone.evidence.push(`sam-error:${error && error.message ? error.message : error}`);
      continue;
    }
    const kind = result && ZONE_KINDS.includes(String(result.kind || '').toLowerCase())
      ? String(result.kind).toLowerCase()
      : null;
    if (!kind || kind === 'unknown') continue;
    candidate.zone.kind = kind;
    candidate.zone.id = zoneId(kind, candidate.index);
    candidate.zone.kindSource = 'sam-3';
    candidate.zone.confidence = result.confidence === 'high' ? 'high' : 'medium';
    candidate.zone.evidence = [`sam:${kind}`];
  }
  return zones;
}

/**
 * Async. Classify caller-supplied candidate polygons into zone kinds.
 *
 * @param {object} input
 * @returns {Promise<Array>}
 */
export async function classifyZones(input = {}, opts = {}) {
  const spaces = Array.isArray(input.spaces) ? input.spaces : (Array.isArray(input.rooms) ? input.rooms : null);
  if (!spaces || spaces.length === 0) {
    throw new Error('classifyZones requires a non-empty spaces/rooms array; raw wall-only zone segmentation is not implemented in this slice.');
  }

  const footprint = cleanPolygon(input.footprint && input.footprint.polygon ? input.footprint.polygon : input.footprint);
  const context = {
    footprintBbox: footprint ? bboxOf(footprint) : null,
    walls: (Array.isArray(input.walls) ? input.walls : []).map(normalizeWall).filter(Boolean),
    columns: (Array.isArray(input.columns) ? input.columns : [])
      .map(normalizePointRecord)
      .filter(Boolean),
    labels: (Array.isArray(input.roomLabels) ? input.roomLabels : [])
      .map((label) => {
        const rec = normalizePointRecord(label);
        return rec ? { text: String(label.text || label.s || label.label || '').trim(), position: rec.position } : null;
      })
      .filter((label) => label && label.text),
    stairs: (Array.isArray(input.stairs) ? input.stairs : [])
      .map(normalizePointRecord)
      .filter(Boolean),
    fixtures: (Array.isArray(input.fixtures) ? input.fixtures : [])
      .map(normalizePointRecord)
      .filter(Boolean),
    parkingStalls: (Array.isArray(input.parkingStalls) ? input.parkingStalls : [])
      .map(normalizePointRecord)
      .filter(Boolean),
    doors: (Array.isArray(input.doors) ? input.doors : [])
      .map(normalizeDoor)
      .filter(Boolean),
    samInvoker: typeof opts.samInvoker === 'function' ? opts.samInvoker : (typeof input.samInvoker === 'function' ? input.samInvoker : null),
  };

  const factsList = spaces.map((space) => buildSpaceFacts(space, context)).filter(Boolean);
  const medianArea = (() => {
    const sorted = factsList.map((facts) => facts.areaSqft).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  })();

  const adjacency = buildAdjacency(factsList);
  for (let i = 0; i < factsList.length; i += 1) {
    for (let j = i + 1; j < factsList.length; j += 1) {
      const shared = bboxAdjacency(factsList[i].bbox, factsList[j].bbox, 1.25);
      if (shared > 0) {
        adjacency[i].push(j);
        adjacency[j].push(i);
      }
    }
  }

  const zones = factsList.map((facts, index) => {
    const zone = baseZone(facts, index);
    const direct = directKindFromFacts(facts);
    if (direct) return assignKind(zone, direct.kind, direct.confidence, 'label-or-fixture', direct.evidence);
    return zone;
  });

  factsList.forEach((facts, index) => {
    if (zones[index].kind !== 'unknown') return;
    if (parkingLike(facts, medianArea)) {
      assignKind(zones[index], 'parking', 'medium', 'heuristic', ['large-open-span', 'column-grid', 'stall-pattern', 'minimal-interior-walls']);
      return;
    }
    if (unitLike(facts)) {
      assignKind(zones[index], 'unit', 'medium', 'heuristic', ['rectangular-enclosure', 'door', 'residential-fixtures']);
      return;
    }
    if (lobbyLike(facts)) {
      assignKind(zones[index], 'lobby', 'medium', 'heuristic', ['exterior-adjacent', 'entry-door', 'no-column-grid']);
    }
  });

  factsList.forEach((facts, index) => {
    if (zones[index].kind !== 'unknown') return;
    if (corridorLike(facts, adjacency[index], zones)) {
      assignKind(zones[index], 'corridor', 'medium', 'heuristic', ['long-thin-space', 'multiple-doors', 'between-unit-rows']);
      return;
    }
    if (facts.fixtureKinds.length === 0 && facts.doors.length <= 1 && facts.areaSqft < 180) {
      assignKind(zones[index], 'storage', 'low', 'heuristic', ['small-enclosed-room']);
    }
  });

  await refineAmbiguousZones(zones, factsList, context, opts);

  return zones.map((zone, index) => ({
    ...zone,
    id: zone.kind === 'unknown' ? zoneId('unknown', index) : zone.id,
  }));
}

export function buildZoneClassifierInput(input = {}) {
  return {
    footprint: input.footprint || null,
    spaces: Array.isArray(input.spaces) ? input.spaces : [],
    walls: Array.isArray(input.walls) ? input.walls : [],
    columns: Array.isArray(input.columns) ? input.columns : [],
    roomLabels: Array.isArray(input.roomLabels) ? input.roomLabels : [],
    stairs: Array.isArray(input.stairs) ? input.stairs : [],
    fixtures: Array.isArray(input.fixtures) ? input.fixtures : [],
    parkingStalls: Array.isArray(input.parkingStalls) ? input.parkingStalls : [],
    doors: Array.isArray(input.doors) ? input.doors : [],
  };
}
