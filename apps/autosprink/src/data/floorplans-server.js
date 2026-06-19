/**
 * SERVER-ONLY floor-plan helpers (read disk via node:fs).
 *
 * Kept separate from ./floorplans.js because that file is imported DIRECTLY into
 * the browser bundle (autosprink.html), where Node builtins (node:fs/path/url)
 * cannot load. Anything that touches the filesystem belongs here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COOPERATIVE_1881_PROJECT_NAME } from './floorplans.js';

const __floorplansDir = path.dirname(fileURLToPath(import.meta.url));

// Path to the client-EXTRACTED per-level plan (vector-PDF extraction, Stream A
// two-view merge). The Floor-1 entry carries the REAL building footprint at the
// drawing-derived true scale (3/32"=1'-0", scaleFtPerUnit 0.1481).
const COOPERATIVE_1881_PLAN_LEVELS_PATH = path.join(__floorplansDir, 'plan-levels.cooperative-1881.json');

/** Shoelace area (sqft, always positive) of a [[x,y],...] polygon. */
function polyAreaSqft(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/**
 * Build the Cooperative 1881 floor plan from the REAL extracted Floor-1 plate
 * instead of the square area-only placeholder.
 *
 * WHY: the sprinkler network must be generated against the SAME footprint, at
 * the SAME true scale, in the SAME coordinate frame as the extracted building
 * geometry the viewer already renders (plan-levels.cooperative-1881.json ->
 * buildBuildingFromPlans). The old cooperative1881FloorPlan() returned a
 * 413x413 ft square at the origin, so the network floated off-axis and at the
 * wrong footprint relative to the building. This consumes the extracted L1
 * `footprintFt` polygon (real ~361.6 x 81.9 ft plate) so heads / branch lines /
 * cross-main are laid across the real plate at real plan coordinates.
 *
 * Stair / elevator cores from the extraction are passed as `excludeRects` so no
 * ceiling head is laid over an open shaft (those get their own protection).
 *
 * HONESTY: this is ONE floor's plate. The total REAL sprinklered area across all
 * floors (170,654 sqft, Building (1)!G6) is unchanged and stays documented in
 * the source/disclaimer. The footprint is the extracted vector geometry, still
 * needs-verification — NOT surveyed, NOT AHJ/PE-reviewed, NOT AutoSprink parity.
 * Falls back (returns null) on any read/parse error so the caller can use the
 * documented placeholder rather than fabricate.
 *
 * @returns {object|null} a floorPlan {name,units,source,hazardAssumption,rooms}
 *   or null when the extracted plate is unavailable.
 */
export function cooperative1881FloorPlanFromExtractedPlate() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(COOPERATIVE_1881_PLAN_LEVELS_PATH, 'utf8'));
  } catch (_) {
    return null; // extracted plate unavailable — caller falls back to placeholder
  }
  const levels = Array.isArray(data && data.levels) ? data.levels : [];
  // Floor 1 carries the merged two-wing plate; prefer level===1, else first
  // level with a usable footprint polygon.
  const l1 = levels.find((l) => l && l.level === 1 && l.plan && Array.isArray(l.plan.footprintFt) && l.plan.footprintFt.length >= 3)
    || levels.find((l) => l && l.plan && Array.isArray(l.plan.footprintFt) && l.plan.footprintFt.length >= 3);
  if (!l1) return null;
  const plan = l1.plan;
  // footprintFt may be a closed ring (first==last); drop the duplicate closing
  // vertex so the engine's polygon helpers see a clean ring.
  let poly = plan.footprintFt.map((p) => [Number(p[0]), Number(p[1])]);
  if (poly.length > 3) {
    const a = poly[0];
    const b = poly[poly.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) poly = poly.slice(0, -1);
  }
  if (poly.length < 3) return null;

  // Stair / elevator cores -> excluded rectangles (open shafts, not sprinklered
  // from this ceiling grid). Only well-formed bboxes are used.
  const excludeRects = (Array.isArray(plan.stairs) ? plan.stairs : [])
    .map((s) => s && s.bbox)
    .filter((b) => b && Number.isFinite(b.minX) && Number.isFinite(b.minY) && Number.isFinite(b.maxX) && Number.isFinite(b.maxY))
    .map((b) => ({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }));

  const plateAreaSqft = Math.round(polyAreaSqft(poly));
  const ceilingHeightFt = Number(data.estimatedFloorToFloorFt) > 0
    ? Math.round((Number(data.estimatedFloorToFloorFt) - 1) * 100) / 100
    : 9;

  // STAGE 4 (2026-06-19): return the REAL segmented rooms (not one footprint room) so the sprinkler
  // engine grids PER ROOM. Each room carries its own polygon + kind->hazard. Pass walls through.
  const KIND_HAZARD = { unit: 'light', residential: 'light', apartment: 'light',
    corridor: 'light', lobby: 'light', office: 'light',
    parking: 'ordinary', garage: 'ordinary', mechanical: 'ordinary',
    storage: 'ordinary', unknown: 'ordinary' };
  const STAIR_KINDS = new Set(['stair', 'stairs', 'elevator', 'shaft', 'core']);
  const cleanRing = (ring) => {
    let pts = ring.map((q) => [Number(q[0]), Number(q[1])]);
    if (pts.length > 3) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) pts = pts.slice(0, -1);
    }
    return pts;
  };
  const srcRooms = Array.isArray(plan.rooms) ? plan.rooms : [];
  const realRooms = srcRooms
    .filter((r) => r && Array.isArray(r.poly) && r.poly.length >= 3
      && !STAIR_KINDS.has(String(r.kind || '').toLowerCase()))
    .map((r) => {
      const polygon = cleanRing(r.poly);
      const hazard = KIND_HAZARD[String(r.kind || 'unknown').toLowerCase()] || 'ordinary';
      const lbl = (r.label && !/^#|^\d+(\.\d+)?$/.test(String(r.label)))
        ? r.label : ((r.kind || 'space') + ' (' + Math.round(r.areaSqft || polyAreaSqft(polygon)) + ' sqft)');
      return { name: lbl, kind: r.kind || 'unknown', polygon, excludeRects, hazard, ceilingHeightFt, confidence: r.confidence || 'low' };
    })
    .filter((r) => { const a = polyAreaSqft(r.polygon); return a >= 20 && a <= 0.45 * plateAreaSqft; });
  if (realRooms.length === 0) console.warn('[cooperative1881] plan.rooms empty/unusable -> FALLING BACK to single footprint plate');
  const rooms = realRooms.length > 0 ? realRooms : [{
    name: 'Floor 1 (FALLBACK plate)', kind: 'plate', polygon: poly, excludeRects, hazard: 'ordinary', ceilingHeightFt,
  }];

  return {
    name: COOPERATIVE_1881_PROJECT_NAME,
    units: 'ft',
    source:
      'REAL extracted Floor-1 plate from the architectural PDF (A-101) at the '
      + `drawing-derived true scale (${plan.scaleText || '3/32"=1\'-0"'}, `
      + `scaleFtPerUnit ${plan.scaleFtPerUnit}); footprint ~${plateAreaSqft} sqft. `
      + 'Total REAL sprinklered area across all floors is 170,654 sqft '
      + '(Building (1)!G6). Vector extraction — needs-verification, NOT surveyed, '
      + 'NOT AHJ/PE-reviewed.',
    hazardAssumption:
      'ordinary (residential apartment standard-spray, NOT ESFR; matches the real '
      + '~120 sqft/head density — internal-alpha assumption, not an engineering call)',
    extractedPlate: true,
    footprintFt: poly,
    wallRuns: Array.isArray(plan.wallRuns) ? plan.wallRuns : [],
    wallsFull: Array.isArray(plan.wallsFull) ? plan.wallsFull : [],
    rooms,
    roomSource: realRooms.length > 0 ? 'extracted-segmented' : 'footprint-fallback',
  };
}
