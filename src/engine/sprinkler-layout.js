/**
 * HaloFire sprinkler auto-layout + auto-bid engine (internal alpha, best-effort).
 *
 * Deterministic geometry engine that takes a floor plan (rooms as polygons in
 * feet) and produces a sprinkler head grid, pipe routing, a bill of materials,
 * and a priced estimate.
 *
 * This implements PUBLIC NFPA 13 standard-spray spacing limits. It is NOT a
 * reverse-engineered copy of any commercial product (e.g. AutoSprink) and it
 * does NOT clear the AUTOSPRINK_EVIDENCE_MISSING, AHJ, professional-review, or
 * manufacturer claim gates. Output is labelled best-effort internal alpha and
 * must be reviewed by a licensed professional before any regulated use.
 *
 * All math is deterministic: identical input always yields identical output.
 */

// NFPA 13 standard-spray protection-area + max-spacing limits by hazard class.
// (Public code values; light/ordinary/extra hazard, non-storage, smooth ceiling.)
export const HAZARD_RULES = Object.freeze({
  light: { label: 'Light Hazard', maxAreaSqFt: 225, maxSpacingFt: 15, minSpacingFt: 6 },
  ordinary: { label: 'Ordinary Hazard', maxAreaSqFt: 130, maxSpacingFt: 15, minSpacingFt: 6 },
  extra: { label: 'Extra Hazard', maxAreaSqFt: 100, maxSpacingFt: 12, minSpacingFt: 6 },
});

export function getHazardRule(hazard) {
  const key = String(hazard || 'ordinary').toLowerCase();
  const rule = HAZARD_RULES[key];
  if (!rule) {
    throw new Error(`Unknown hazard class "${hazard}". Use one of: ${Object.keys(HAZARD_RULES).join(', ')}`);
  }
  return { key, ...rule };
}

/** Axis-aligned bounding box of a polygon ([[x,y], ...] in feet). */
export function boundingBox(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error('Polygon must have at least 3 [x,y] vertices');
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Shoelace area of a polygon, in square feet (always positive). */
export function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Ray-casting point-in-polygon test (point on/inside counts as inside). */
export function pointInPolygon([px, py], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = (yi > py) !== (yj > py)
      && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Compute the head count along each axis so that both per-head spacing and
 * per-head coverage area stay within the hazard limits. Deterministic.
 */
function gridCounts(width, height, rule) {
  let nx = Math.max(1, Math.ceil(width / rule.maxSpacingFt));
  let ny = Math.max(1, Math.ceil(height / rule.maxSpacingFt));
  // Tighten until coverage per head <= maxArea, always shrinking the larger gap.
  let guard = 0;
  while ((width / nx) * (height / ny) > rule.maxAreaSqFt && guard < 10000) {
    if (width / nx >= height / ny) nx += 1;
    else ny += 1;
    guard += 1;
  }
  return { nx, ny };
}

/**
 * Lay out sprinkler heads over a single room polygon.
 * Heads sit on a centered grid; first/last row & column are spacing/2 from the
 * bounding edges (so wall offset <= maxSpacing/2, per NFPA 13). Heads whose
 * grid point falls outside a non-rectangular polygon are dropped.
 *
 * @returns {{heads: Array<{x:number,y:number,row:number,col:number}>, spacingX:number,
 *   spacingY:number, coveragePerHeadSqFt:number, rule:object, bbox:object,
 *   gridRows:number, gridCols:number}}
 */
export function layoutRoom(room) {
  const polygon = room.polygon;
  const rule = getHazardRule(room.hazard);
  const bbox = boundingBox(polygon);
  const { nx, ny } = gridCounts(bbox.width, bbox.height, rule);

  const spacingX = bbox.width / nx;
  const spacingY = bbox.height / ny;
  const heads = [];
  for (let row = 0; row < ny; row += 1) {
    const y = bbox.minY + spacingY * (row + 0.5);
    for (let col = 0; col < nx; col += 1) {
      const x = bbox.minX + spacingX * (col + 0.5);
      if (pointInPolygon([x, y], polygon)) {
        heads.push({ x: round(x), y: round(y), row, col });
      }
    }
  }
  return {
    heads,
    spacingX: round(spacingX),
    spacingY: round(spacingY),
    coveragePerHeadSqFt: round(spacingX * spacingY),
    rule,
    bbox,
    gridRows: ny,
    gridCols: nx,
  };
}

/**
 * Route piping for a laid-out room: one branch line per occupied grid row,
 * plus a cross-main connecting the branch lines. Lengths in linear feet.
 */
export function routePiping(layout) {
  const rowsMap = new Map();
  for (const head of layout.heads) {
    if (!rowsMap.has(head.row)) rowsMap.set(head.row, []);
    rowsMap.get(head.row).push(head);
  }
  const branchLines = [];
  let branchFt = 0;
  for (const [row, heads] of [...rowsMap.entries()].sort((a, b) => a[0] - b[0])) {
    const xs = heads.map((h) => h.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const length = round((maxX - minX) + layout.spacingX); // half-spacing stub each end
    branchLines.push({ row, y: heads[0].y, startX: minX, endX: maxX, lengthFt: length, heads: heads.length });
    branchFt += length;
  }
  // Cross-main spans the vertical extent of the branch lines.
  const ys = branchLines.map((b) => b.y);
  const mainFt = branchLines.length > 1 ? round((Math.max(...ys) - Math.min(...ys)) + layout.spacingY) : 0;
  return {
    branchLines,
    crossMainFt: mainFt,
    branchFt: round(branchFt),
    totalPipeFt: round(branchFt + mainFt),
  };
}

/**
 * Build a deterministic bill of materials from a layout + piping.
 * Quantities are best-effort estimates (heads, pipe ft, fittings, hangers).
 */
export function buildBillOfMaterials(layout, piping) {
  const headCount = layout.heads.length;
  const pipeFt = piping.totalPipeFt;
  return [
    { key: 'sprinkler_head', description: 'Sprinkler head (standard spray)', unit: 'EA', quantity: headCount },
    { key: 'branch_pipe', description: 'Branch + cross-main pipe', unit: 'FT', quantity: round(pipeFt) },
    { key: 'fitting', description: 'Fittings (tees/elbows/couplings)', unit: 'EA', quantity: headCount + piping.branchLines.length + 2 },
    { key: 'hanger', description: 'Pipe hangers', unit: 'EA', quantity: Math.max(1, Math.ceil(pipeFt / 12)) },
    { key: 'escutcheon', description: 'Escutcheon/trim per head', unit: 'EA', quantity: headCount },
  ];
}

/**
 * Default unit-cost map (USD) used only when a pricebook lookup is unavailable.
 * Real bids must resolve prices from the imported vendor pricebooks; these are
 * clearly-labelled fallback placeholders for internal-alpha math only.
 */
export const FALLBACK_UNIT_COSTS = Object.freeze({
  sprinkler_head: 12.5,
  branch_pipe: 4.25,
  fitting: 3.75,
  hanger: 2.1,
  escutcheon: 1.6,
});

/**
 * Price a bill of materials. `priceResolver(key)` may return a unit cost from
 * the real pricebook; when it returns null/undefined we fall back to
 * FALLBACK_UNIT_COSTS and flag the line as estimated.
 */
export function priceBid(bom, { priceResolver = () => null, laborRatePerHead = 85, markupPct = 25 } = {}) {
  const lines = bom.map((item) => {
    const resolved = priceResolver(item.key);
    const unitCost = (typeof resolved === 'number' && resolved >= 0) ? resolved : FALLBACK_UNIT_COSTS[item.key] ?? 0;
    const estimated = !(typeof resolved === 'number' && resolved >= 0);
    return {
      ...item,
      unitCost: round(unitCost),
      lineTotal: round(unitCost * item.quantity),
      priceSource: estimated ? 'fallback_estimate' : 'pricebook',
    };
  });
  const materialCost = round(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const headCount = bom.find((b) => b.key === 'sprinkler_head')?.quantity ?? 0;
  const laborCost = round(headCount * laborRatePerHead);
  const subtotal = round(materialCost + laborCost);
  const markup = round(subtotal * (markupPct / 100));
  const total = round(subtotal + markup);
  return {
    lines,
    materialCost,
    laborCost,
    subtotal,
    markupPct,
    markup,
    total,
    anyEstimated: lines.some((l) => l.priceSource === 'fallback_estimate'),
  };
}

/**
 * Full pipeline: floor plan -> per-room layouts -> piping -> BOM -> priced bid.
 * Always returns the fail-closed disclaimer; never asserts AHJ/PE/AutoSprink
 * readiness.
 *
 * @param {{name:string, units?:string, rooms:Array<{name:string,polygon:Array<[number,number]>,hazard:string,ceilingHeightFt?:number}>}} floorPlan
 */
export function generateSprinklerBid(floorPlan, opts = {}) {
  if (!floorPlan || !Array.isArray(floorPlan.rooms) || floorPlan.rooms.length === 0) {
    throw new Error('floorPlan.rooms must be a non-empty array');
  }
  const rooms = floorPlan.rooms.map((room) => {
    const layout = layoutRoom(room);
    const piping = routePiping(layout);
    const bom = buildBillOfMaterials(layout, piping);
    return {
      name: room.name,
      hazard: layout.rule.key,
      areaSqFt: round(polygonArea(room.polygon)),
      headCount: layout.heads.length,
      spacingX: layout.spacingX,
      spacingY: layout.spacingY,
      coveragePerHeadSqFt: layout.coveragePerHeadSqFt,
      layout,
      piping,
      bom,
    };
  });

  // Aggregate BOM across rooms by key.
  const aggregate = new Map();
  for (const room of rooms) {
    for (const item of room.bom) {
      const prev = aggregate.get(item.key);
      if (prev) prev.quantity = round(prev.quantity + item.quantity);
      else aggregate.set(item.key, { ...item });
    }
  }
  const bom = [...aggregate.values()];
  const pricing = priceBid(bom, opts);

  return {
    floorPlanName: floorPlan.name,
    units: floorPlan.units || 'ft',
    generatedBy: 'halofire-internal-alpha-engine',
    totalAreaSqFt: round(rooms.reduce((s, r) => s + r.areaSqFt, 0)),
    totalHeadCount: rooms.reduce((s, r) => s + r.headCount, 0),
    rooms,
    bom,
    pricing,
    disclaimer: 'best-effort internal alpha — NOT AHJ-approved, NOT PE-reviewed, '
      + 'NOT AutoSprink-parity, NOT fabrication-ready. Requires licensed professional review.',
    blockedClaims: [
      'AutoSprink parity',
      'fabrication-ready layout',
      'permit-ready',
      'AHJ-approved',
      'professionally reviewed',
    ],
  };
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
