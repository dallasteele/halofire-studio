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

import { SEISMIC_BRACE_INTERVAL_FT, SUPPORTS_NOTE } from './supports.js';

// NFPA 13 standard-spray protection-area + max-spacing limits by hazard class.
// (Public code values; light/ordinary/extra hazard, non-storage, smooth ceiling.)
export const HAZARD_RULES = Object.freeze({
  light: { label: 'Light Hazard', maxAreaSqFt: 225, maxSpacingFt: 15, minSpacingFt: 6 },
  ordinary: { label: 'Ordinary Hazard', maxAreaSqFt: 130, maxSpacingFt: 15, minSpacingFt: 6 },
  extra: { label: 'Extra Hazard', maxAreaSqFt: 100, maxSpacingFt: 12, minSpacingFt: 6 },
});

// NFPA 13 STORAGE / ESFR protection values (public code). ESFR (Early
// Suppression Fast Response) for high-piled / rack storage warehouses uses a
// max coverage of 100 sqft per head and a minimum spacing of 8 ft (NFPA 13
// storage chapters). Kept SEPARATE from the standard-spray HAZARD_RULES map so
// light/ordinary/extra projects are byte-for-byte unchanged; getHazardRule
// merges this in additively. `storage:true` marks the storage system class.
export const STORAGE_RULES = Object.freeze({
  esfr: { label: 'ESFR Storage', maxAreaSqFt: 100, maxSpacingFt: 12, minSpacingFt: 8, storage: true },
});

export function getHazardRule(hazard) {
  const key = String(hazard || 'ordinary').toLowerCase();
  const rule = HAZARD_RULES[key] || STORAGE_RULES[key];
  if (!rule) {
    const known = [...Object.keys(HAZARD_RULES), ...Object.keys(STORAGE_RULES)];
    throw new Error(`Unknown hazard class "${hazard}". Use one of: ${known.join(', ')}`);
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

  // Optional excluded rectangles (open shafts: stair / elevator cores). Heads
  // whose grid point falls inside an excluded rect are dropped — an open stair
  // or elevator shaft is not sprinklered from this ceiling grid (it gets its
  // own protection). Each rect is {minX,minY,maxX,maxY} in the SAME plan-feet
  // coordinate frame as the room polygon. Empty/absent -> no exclusion (the
  // pre-existing behaviour is byte-identical).
  const excludeRects = Array.isArray(room.excludeRects) ? room.excludeRects : [];
  const inExcluded = (x, y) => excludeRects.some(
    (r) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY,
  );

  const spacingX = bbox.width / nx;
  const spacingY = bbox.height / ny;
  const heads = [];
  for (let row = 0; row < ny; row += 1) {
    const y = bbox.minY + spacingY * (row + 0.5);
    for (let col = 0; col < nx; col += 1) {
      const x = bbox.minX + spacingX * (col + 0.5);
      if (pointInPolygon([x, y], polygon) && !inExcluded(x, y)) {
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
 * Documented default assumptions for the ESFR/storage system scope. These are
 * NOT derived from geometry — they are labelled, overridable documented
 * conventions (like SOFT_COST_ASSUMPTIONS / LABOR_ASSUMPTIONS), so the lines
 * that use them carry assumption:true. NEVER tuned to hit a target number.
 *   bulkMainFt    — assumed riser / bulk-main vertical run feeding the system.
 *   undergroundFt — assumed underground lead-in from the city main to the riser.
 */
export const ESFR_SCOPE_ASSUMPTIONS = Object.freeze({
  bulkMainFt: 40,
  undergroundFt: 100,
});

/**
 * T26 — Seismic sway-brace count interval (ft) for the ESFR scope. This is the
 * SAME public NFPA-13 best-effort lateral-brace interval that supports.js uses
 * (SEISMIC_BRACE_INTERVAL_FT); re-exported here as a frozen named constant so the
 * derived brace COUNT is documented at the call site. The brace count is derived
 * from the routed main footage (floor(totalMainFt / interval)), NOT tuned, and is
 * carried as a best-effort estimate (assumption:true) — supports.js already
 * carries the SUPPORTS_NOTE honesty disclaimer for the same interval math.
 */
export const ESFR_SEISMIC_BRACE_INTERVAL_FT = SEISMIC_BRACE_INTERVAL_FT;

/**
 * Build the EXTRA, diameter-aware BOM lines for an ESFR storage system, ADDITIVE
 * on top of the existing branch-pipe / fitting / hanger lines. Every quantity is
 * either (a) derived from the routed geometry the engine already produced, or
 * (b) a clearly-labelled documented assumption (assumption:true). Nothing here
 * is reverse-engineered to match a known total.
 *
 * The ESFR head line REPLACES the standard-spray sprinkler_head line at the call
 * site (heads are not double-counted): same head count, ESFR head price class.
 *
 * Derivations:
 *   esfr_head        EA  qty = layout.heads.length                         (geometry)
 *   cross_main_pipe  FT  qty = piping.crossMainFt, 3" ESFR cross main      (geometry)
 *   feed_main_pipe   FT  qty = round(max(bbox.width, bbox.height)) — ONE   (geometry)
 *                        feed main running the long dimension of the system,
 *                        6" nominal.
 *   bulk_main_pipe   FT  qty = ESFR_SCOPE_ASSUMPTIONS.bulkMainFt, 6"       (assumption)
 *   underground_main FT  qty = ESFR_SCOPE_ASSUMPTIONS.undergroundFt, 8"    (assumption)
 *
 * T26 — two GENUINELY-OMITTED, geometry/NFPA-derivable material categories the
 * BOM previously dropped (additive, ESFR-only, NOT tuned, NOT in-rack):
 *   drop_armover     EA  qty = layout.heads.length                         (geometry)
 *                        Every ESFR ceiling head needs a drop/armover set
 *                        (nipple + reducer + fitting) from the branch line —
 *                        one per head, 1:1 with the head count.
 *   seismic_brace    EA  qty = floor(totalMainFt / interval), where         (geometry)
 *                        totalMainFt = crossMainFt + feedMainFt + bulkMainFt
 *                        and interval = ESFR_SEISMIC_BRACE_INTERVAL_FT. NFPA-13
 *                        lateral sway bracing hardware along the mains; best-effort
 *                        interval estimate, so assumption:true (mirrors supports.js
 *                        SUPPORTS_NOTE). In-rack sprinklers are NOT added: real ESFR
 *                        is ceiling-only, so in-rack would over-scope dishonestly.
 *
 * @param {{heads:Array, bbox:{width:number,height:number}}} layout
 * @param {{crossMainFt:number}} piping
 * @param {{bulkMainFt?:number, undergroundFt?:number, seismicIntervalFt?:number}} opts
 * @returns {Array<{key,description,unit,quantity,nominalIn,scope,assumption?}>}
 */
export function buildEsfrSystemScope(layout, piping, opts = {}) {
  const bbox = layout?.bbox || boundingBox((layout?.heads || []).map((h) => [h.x, h.y]).length >= 3
    ? layout.heads.map((h) => [h.x, h.y]) : [[0, 0], [0, 0], [0, 0]]);
  const headCount = Array.isArray(layout?.heads) ? layout.heads.length : 0;
  const crossMainFt = round(piping?.crossMainFt ?? 0);
  // ONE feed main running the long building dimension (NFPA-13 storage systems
  // feed cross mains from a feed main spanning the long axis of the system).
  const feedMainFt = round(Math.max(bbox.width || 0, bbox.height || 0));
  const bulkMainFt = round(opts.bulkMainFt ?? ESFR_SCOPE_ASSUMPTIONS.bulkMainFt);
  const undergroundFt = round(opts.undergroundFt ?? ESFR_SCOPE_ASSUMPTIONS.undergroundFt);

  // T26 — seismic sway-brace count from the routed main footage. Geometry-derived:
  // total horizontal main run (cross + feed + bulk) divided by the public NFPA-13
  // lateral-brace interval. floor() so partial intervals do not invent a brace.
  const seismicIntervalFt = Number(opts.seismicIntervalFt) > 0
    ? Number(opts.seismicIntervalFt) : ESFR_SEISMIC_BRACE_INTERVAL_FT;
  const totalMainFt = round(crossMainFt + feedMainFt + bulkMainFt);
  const braceCount = Math.floor(totalMainFt / seismicIntervalFt);

  return [
    { key: 'esfr_head', description: 'ESFR storage sprinkler head', unit: 'EA', quantity: headCount, nominalIn: null, scope: 'esfr' },
    { key: 'cross_main_pipe', description: 'ESFR cross main', unit: 'FT', quantity: crossMainFt, nominalIn: 3, scope: 'esfr' },
    { key: 'feed_main_pipe', description: 'ESFR feed main (long building dimension)', unit: 'FT', quantity: feedMainFt, nominalIn: 6, scope: 'esfr' },
    { key: 'bulk_main_pipe', description: 'ESFR riser / bulk main run (documented assumption)', unit: 'FT', quantity: bulkMainFt, nominalIn: 6, scope: 'esfr', assumption: true },
    { key: 'underground_main', description: 'Underground lead-in main (documented assumption)', unit: 'FT', quantity: undergroundFt, nominalIn: 8, scope: 'esfr', assumption: true },
    // T26 — genuinely-omitted, geometry/NFPA-derivable categories (ESFR-only).
    { key: 'drop_armover', description: 'ESFR drop/armover (per head)', unit: 'EA', quantity: headCount, scope: 'esfr' },
    { key: 'seismic_brace', description: 'Seismic sway brace (NFPA-13, est)', unit: 'EA', quantity: braceCount, scope: 'esfr', assumption: true },
  ];
}

/**
 * Default unit-cost map (USD) used only when a pricebook lookup is unavailable.
 * Real bids must resolve prices from the imported vendor pricebooks; these are
 * clearly-labelled fallback placeholders for internal-alpha math only.
 *
 * The ESFR/storage entries (cross/feed/bulk/underground/esfr_head) are likewise
 * labelled fallbacks: representative size-class $/ft figures used ONLY when the
 * real pricebook band lookup returns null. Real bids use the pricebook median.
 */
export const FALLBACK_UNIT_COSTS = Object.freeze({
  sprinkler_head: 12.5,
  branch_pipe: 4.25,
  fitting: 3.75,
  hanger: 2.1,
  escutcheon: 1.6,
  // ESFR / storage size classes (labelled fallbacks only).
  esfr_head: 38,
  cross_main_pipe: 9,
  feed_main_pipe: 22,
  bulk_main_pipe: 35,
  underground_main: 30,
  // T26 — genuinely-omitted ESFR categories (labelled fallbacks; used only when
  // the pricebook band lookup returns null). A drop/armover set (nipple + reducer
  // + fitting) is a small-component cost; a seismic sway-brace assembly is a
  // mid-size hardware kit.
  drop_armover: 8,
  seismic_brace: 45,
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
  // Head count drives the flat labor allowance. For ESFR systems the head line
  // is esfr_head (the standard spray sprinkler_head line is replaced upstream).
  const headCount = bom.find((b) => b.key === 'sprinkler_head')?.quantity
    ?? bom.find((b) => b.key === 'esfr_head')?.quantity
    ?? 0;
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
