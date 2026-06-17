/**
 * plan-extract.js — PLAN-COMPREHENSION extractor (per PDF page -> structured LevelPlan).
 *
 * GOAL (the core failure this fixes): the Studio used to render a PDF sheet as a flat
 * texture on a margin-box with NO real extraction. This module READS the scale printed
 * on the drawing, EXTRACTS real vector geometry, COMPREHENDS spaces (rooms / stairs /
 * grid), and emits a structured per-level plan the 3D builder consumes. Verified by
 * OVERLAYING the extracted geometry on the actual sheet (see scripts/plan-extract-smoke.mjs),
 * not by markers.
 *
 * This module is a COMPOSITION LAYER over the proven T28-T35 primitives in
 * pdf-floorplan.js (extractSegmentsFromOpList with full CTM tracking, parseArchitecturalScale,
 * selectWallLayer, buildingOutlinePolygon, isolatePlanExtent). It adds the NEW comprehension
 * steps those primitives did not provide:
 *   - DERIVE the feet-per-PDF-unit scale FROM the sheet's printed SCALE notation (never hardcoded).
 *   - Extract GRID lines + bubble labels (the numbered/lettered column/row datums).
 *   - Extract TEXT labels with positions (room tags, notes — best-effort classification).
 *   - Segment ENCLOSED SPACES (rooms) from the wall network occupancy grid and classify each
 *     by the nearest text label (PARKING / STAIR / MECH / ELEC / ELEV / unit / unknown).
 *   - Detect STAIR cores (a "STAIR" label and/or a tight hatched/heavy shaft enclosure).
 *   - Optionally reconcile ambiguous spaces with a SAM raster segmentation (injected invoker);
 *     skip gracefully if SAM is down and flag those spaces lower-confidence.
 *
 * HONESTY (hard, fail-closed):
 *   - Every emitted element carries provenance and needs-verification. NOTHING here asserts
 *     AHJ / PE / manufacturer-exact / AutoSprink-parity.
 *   - The scale is DERIVED FROM THE DRAWING's printed notation. If no scale can be read AND
 *     none is supplied, extraction THROWS rather than guessing (1 world unit = 1 ft is derived,
 *     never hardcoded).
 *   - Geometry is REAL (the plan's own vector ops, CTM-mapped). Room/stair segmentation is a
 *     BEST-EFFORT geometric approximation, explicitly flagged.
 *
 * Pure core (no I/O) + a thin async pdfjs wrapper (extractLevelPlanFromPdf). The pure functions
 * accept already-extracted segments + text items so they unit-test offline with no pdfjs.
 */

import {
  extractSegmentsFromOpList,
  parseArchitecturalScale,
  selectWallLayer,
  buildingOutlinePolygon,
} from './pdf-floorplan.js';
import { buildWallRuns } from './plan-wall-runs.js';

const PROVENANCE_BASE = 'extracted (vector PDF, CTM-mapped, scale derived from sheet) — needs-verification';

/** Room/space classification vocabulary. Order matters: first match wins. */
const SPACE_KINDS = Object.freeze([
  { kind: 'stair', re: /\bSTAIR(WELL|CASE|S)?\b|\bSTR\b/i },
  { kind: 'elevator', re: /\bELEV(ATOR)?\b|\bELEV\.?\b|\bLIFT\b/i },
  { kind: 'mech', re: /\bMECH(ANICAL)?\b|\bM\.?E\.?P\b|\bBOILER\b|\bFAN\s*ROOM\b/i },
  { kind: 'elec', re: /\bELEC(TRICAL)?\b|\bELEC\.?\b|\bSWITCHGEAR\b|\bIDF\b|\bMDF\b/i },
  { kind: 'parking', re: /\bPARK(ING)?\b|\bGARAGE\b|\bSTALL\b|\bP\d{1,2}\b/i },
  { kind: 'ramp', re: /\bRAMP\b/i },
  { kind: 'trash', re: /\bTRASH\b|\bREFUSE\b|\bGARBAGE\b/i },
  { kind: 'storage', re: /\bSTOR(AGE|\.)?\b/i },
  { kind: 'lobby', re: /\bLOBBY\b|\bVESTIBULE\b|\bENTRY\b/i },
  { kind: 'corridor', re: /\bCORRIDOR\b|\bHALL(WAY)?\b/i },
  { kind: 'restroom', re: /\bREST\s*ROOM\b|\bTOILET\b|\bW\.?C\.?\b|\bBATH\b/i },
  { kind: 'unit', re: /\bUNIT\b|\b(STUDIO|1\s*BR|2\s*BR|3\s*BR|ONE\s*BED|TWO\s*BED)\b/i },
]);

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

function classifyLabel(text) {
  const t = String(text || '');
  for (const { kind, re } of SPACE_KINDS) {
    if (re.test(t)) return kind;
  }
  return null;
}

function normalizeSegmentsFt(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((s) => {
      if (s && Number.isFinite(s.x1) && Number.isFinite(s.y1) && Number.isFinite(s.x2) && Number.isFinite(s.y2)) {
        return { x1: Number(s.x1), y1: Number(s.y1), x2: Number(s.x2), y2: Number(s.y2), lineWidth: s.lineWidth };
      }
      if (s && Array.isArray(s.a) && Array.isArray(s.b)) {
        return { x1: Number(s.a[0]), y1: Number(s.a[1]), x2: Number(s.b[0]), y2: Number(s.b[1]), lineWidth: s.lineWidth };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Stair DIRECTION tokens. Architects almost never write "STAIR" inside the shaft on an overall
 * plan — they draw the tread hatch and annotate the run direction with "UP" / "DN" / "DOWN"
 * (+ an arrow). A101 (page 8) carries ZERO "STAIR" tokens but 8 UP/DOWN tokens sitting on the
 * three hatched shafts. Detecting these (co-located with dense tread hatch) is the honest
 * geometric+textual stair signal — NOT a fabrication.
 *
 * DELIBERATELY EXCLUDES "DW": on residential upper floors "DW" is the DISHWASHER appliance tag,
 * not "down" — including it produced ~19 false stair cores per residential floor (one per unit
 * kitchen). Stairs are annotated UP/DN/DOWN; the dishwasher exclusion keeps detection honest.
 */
const STAIR_DIR_RE = /^(UP|DN|DOWN)$/i;

const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/**
 * PURE. Derive feet-per-PDF-unit scale from a sheet's joined text.
 *
 * Wraps parseArchitecturalScale (which reads the architect's printed SCALE notation, e.g.
 * 3/32" = 1'-0"). Returns { feetPerUnit, scaleText, source } or null when no scale is
 * printed/parseable. The scaleText is the matched human-readable notation for provenance.
 *
 * @param {string} joinedText
 * @returns {{feetPerUnit:number, scaleText:string, source:string}|null}
 */
export function deriveScaleFromText(joinedText) {
  const feetPerUnit = parseArchitecturalScale(joinedText);
  if (!Number.isFinite(feetPerUnit) || feetPerUnit <= 0) return null;
  // Recover the matched human notation for provenance (best-effort; tolerant of glyph runs).
  const norm = String(joinedText)
    .replace(/[′‘’´]/g, "'")
    .replace(/[″“”]/g, '"');
  const m = norm.match(/(?:scale\s*:?\s*)?(\d+(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?|\d*\.\d+)\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'/i);
  const scaleText = m ? m[0].replace(/\s+/g, ' ').trim() : `derived feetPerUnit=${round(feetPerUnit)}`;
  return { feetPerUnit, scaleText, source: 'sheet-printed-scale-notation' };
}

/**
 * PURE. Extract GRID datum lines + bubble labels from text items + wall segments.
 *
 * Architectural grids are full-height/full-width thin lines terminated by a numbered
 * (columns) or lettered (rows) bubble. We do NOT need to find the lines geometrically to
 * be useful: the bubble TEXT positions are the column/row datum coordinates. We collect
 * tokens that are a single grid label (a number 1..99 or a letter A..Z optionally with a
 * .n decimal, e.g. "L.6") and split them into vertical datums (X positions, numeric/Latin
 * columns) and horizontal datums (Y positions, letter rows). Positions are in FEET.
 *
 * @param {Array<{s:string,xFt:number,yFt:number}>} textItemsFt - text items already in feet.
 * @returns {{xs:number[], ys:number[], labels:{cols:string[], rows:string[]},
 *            colBubbles:Array<{label:string,xFt:number,yFt:number}>,
 *            rowBubbles:Array<{label:string,xFt:number,yFt:number}>}}
 */
export function extractGrid(textItemsFt) {
  const items = Array.isArray(textItemsFt) ? textItemsFt : [];
  const colBubbles = []; // numeric columns -> vertical grid lines (datum X)
  const rowBubbles = []; // letter rows     -> horizontal grid lines (datum Y)
  const numRe = /^\d{1,2}(?:\.\d)?$/;
  const letRe = /^[A-Z](?:\.\d)?$/;
  for (const it of items) {
    const s = String(it.s || '').trim();
    if (numRe.test(s)) colBubbles.push({ label: s, xFt: round(it.xFt), yFt: round(it.yFt) });
    else if (letRe.test(s)) rowBubbles.push({ label: s, xFt: round(it.xFt), yFt: round(it.yFt) });
  }
  // Cluster bubble X (columns) / Y (rows) into datum coordinates. Bubbles for the same
  // grid line repeat top+bottom (cols) or left+right (rows); cluster within tolerance.
  // minPerDatum drops single-occurrence outliers: a REAL grid datum carries a bubble at
  // BOTH ends, so requiring >= minPerDatum bubbles per cluster filters stray note letters
  // (e.g. a lone "F"/"O"/"T" in prose) from genuine row/column datums.
  const clusterAxis = (vals, tolFt, minPerDatum) => {
    const sorted = [...vals].sort((a, b) => a - b);
    const out = [];
    for (const v of sorted) {
      if (out.length && Math.abs(v - out[out.length - 1].sum / out[out.length - 1].n) <= tolFt) {
        out[out.length - 1].sum += v;
        out[out.length - 1].n += 1;
      } else {
        out.push({ sum: v, n: 1 });
      }
    }
    return out.filter((c) => c.n >= minPerDatum).map((c) => round(c.sum / c.n));
  };
  // Columns are usually numbered (less prose collision) -> minPerDatum 1; rows are single
  // letters (heavy prose collision) -> require >= 2 bubbles to count as a real row datum.
  const xs = clusterAxis(colBubbles.map((b) => b.xFt), 2, 1);
  const ys = clusterAxis(rowBubbles.map((b) => b.yFt), 2, 2);
  // Distinct labels, but ONLY those whose bubble sits on a surviving datum (so stray note
  // letters that were filtered out of `ys`/`xs` don't pollute the label list).
  const onDatum = (v, datums, tolFt) => datums.some((d) => Math.abs(v - d) <= tolFt + 1e-9);
  const uniqOnDatum = (bubbles, datums, axis) => {
    const seen = new Set();
    const out = [];
    for (const b of bubbles) {
      const v = axis === 'x' ? b.xFt : b.yFt;
      if (onDatum(v, datums, 2) && !seen.has(b.label)) { seen.add(b.label); out.push(b.label); }
    }
    return out;
  };
  // label -> datum-coordinate pairs (each distinct label snapped to its surviving datum). This
  // is what cross-view registration needs: the X (or Y) where a NAMED grid line sits, so two
  // stacked views can be aligned by their SHARED column/row labels regardless of how many total
  // datums each view has. Snap each label's bubble to the nearest datum within tolerance.
  const nearestDatum = (v, datums, tolFt) => {
    let best = null, bestD = Infinity;
    for (const d of datums) { const dd = Math.abs(v - d); if (dd <= tolFt + 1e-9 && dd < bestD) { bestD = dd; best = d; } }
    return best;
  };
  const datumPairs = (bubbles, datums, axis) => {
    const seen = new Set();
    const out = [];
    for (const b of bubbles) {
      if (seen.has(b.label)) continue;
      const v = axis === 'x' ? b.xFt : b.yFt;
      const d = nearestDatum(v, datums, 2);
      if (d != null) { seen.add(b.label); out.push({ label: b.label, [axis === 'x' ? 'xFt' : 'yFt']: round(d) }); }
    }
    return out;
  };
  return {
    xs,
    ys,
    labels: {
      cols: uniqOnDatum(colBubbles, xs, 'x'),
      rows: uniqOnDatum(rowBubbles, ys, 'y'),
    },
    colDatums: datumPairs(colBubbles, xs, 'x'),
    rowDatums: datumPairs(rowBubbles, ys, 'y'),
    colBubbles,
    rowBubbles,
  };
}

/**
 * PURE. Segment ENCLOSED SPACES (rooms) from wall segments via an occupancy-grid +
 * connected-component flood fill, then classify each by the nearest text label.
 *
 * Algorithm (deterministic, geometric — thresholds are geometric defaults, NOT fitted to a
 * target count or dollar):
 *  a) Rasterize the wall segments onto a gridN x gridN occupancy grid over the wall bbox
 *     (DDA-sampled so no cell a wall passes through is missed).
 *  b) Flood-fill the EXTERIOR inward from the border (4-neighbour, blocked by wall cells).
 *  c) Every NON-exterior, NON-wall cell is interior void. Connected-component label the
 *     interior void cells (4-neighbour) -> each component is a candidate enclosed space.
 *  d) Drop components smaller than minRoomSqft (closet-scale noise / hatch gaps).
 *  e) For each kept component, compute its cell-bbox polygon (rectilinear) in feet and its
 *     area; assign the nearest text label centroid (within the component bbox, else nearest
 *     overall) and classify the kind. Unlabeled -> kind 'unknown', confidence 'low'.
 *
 * @param {Array<{x1,y1,x2,y2}>} wallSegments - in FEET (wall layer).
 * @param {Array<{s:string,xFt:number,yFt:number}>} textItemsFt - text items in feet for labelling.
 * @param {{gridN?:number, minRoomSqft?:number}} [opts]
 * @returns {{rooms:Array<{poly:Array<[number,number]>, bbox:Object, areaSqft:number, label:string|null, kind:string, confidence:string}>, gridN:number, interiorCells:number, note:string}}
 */
export function segmentRooms(wallSegments, textItemsFt = [], opts = {}) {
  const gridN = Number.isInteger(opts.gridN) && opts.gridN > 8 ? opts.gridN : 160;
  const minRoomSqft = Number.isFinite(opts.minRoomSqft) ? Number(opts.minRoomSqft) : 40;
  const segs = Array.isArray(wallSegments) ? wallSegments : [];
  const note =
    'Best-effort geometric room segmentation: enclosed interior voids of the extracted ' +
    'wall network (occupancy-grid flood fill), classified by nearest text label. NOT a ' +
    'verified room schedule; NOT AHJ/PE/AutoSprink parity. Unlabeled spaces are kind ' +
    '"unknown" at low confidence. Deterministic given segments + scale.';

  if (segs.length < 3) {
    return { rooms: [], gridN, interiorCells: 0, note };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.x1, s.x2); minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2); maxY = Math.max(maxY, s.y1, s.y2);
  }
  const w = maxX - minX, h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return { rooms: [], gridN, interiorCells: 0, note };
  const cw = w / gridN, ch = h / gridN;
  const cellArea = cw * ch;
  const idx = (cx, cy) => cy * gridN + cx;
  const clampC = (v) => (v < 0 ? 0 : v >= gridN ? gridN - 1 : v);
  const toCx = (x) => clampC(Math.floor((x - minX) / cw));
  const toCy = (y) => clampC(Math.floor((y - minY) / ch));

  const wall = new Uint8Array(gridN * gridN);
  const step = Math.max(Math.min(cw, ch) / 2, 1e-9);
  for (const s of segs) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const n = Math.max(1, Math.ceil(len / step));
    for (let t = 0; t <= n; t++) {
      const f = t / n;
      wall[idx(toCx(s.x1 + (s.x2 - s.x1) * f), toCy(s.y1 + (s.y2 - s.y1) * f))] = 1;
    }
  }
  // Flood the exterior from the border.
  const exterior = new Uint8Array(gridN * gridN);
  const stack = [];
  const pushIf = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= gridN || cy >= gridN) return;
    const k = idx(cx, cy);
    if (exterior[k] || wall[k]) return;
    exterior[k] = 1; stack.push(k);
  };
  for (let cx = 0; cx < gridN; cx++) { pushIf(cx, 0); pushIf(cx, gridN - 1); }
  for (let cy = 0; cy < gridN; cy++) { pushIf(0, cy); pushIf(gridN - 1, cy); }
  while (stack.length) {
    const k = stack.pop(); const cx = k % gridN; const cy = (k - cx) / gridN;
    pushIf(cx - 1, cy); pushIf(cx + 1, cy); pushIf(cx, cy - 1); pushIf(cx, cy + 1);
  }
  // Connected-component label the interior void (non-wall, non-exterior).
  const comp = new Int32Array(gridN * gridN).fill(-1);
  let interiorCells = 0;
  const components = [];
  for (let start = 0; start < gridN * gridN; start++) {
    if (wall[start] || exterior[start] || comp[start] !== -1) continue;
    const id = components.length;
    const cells = [];
    const st = [start]; comp[start] = id;
    while (st.length) {
      const k = st.pop(); cells.push(k); interiorCells++;
      const cx = k % gridN; const cy = (k - cx) / gridN;
      const nb = [cx > 0 ? idx(cx - 1, cy) : -1, cx < gridN - 1 ? idx(cx + 1, cy) : -1,
        cy > 0 ? idx(cx, cy - 1) : -1, cy < gridN - 1 ? idx(cx, cy + 1) : -1];
      for (const nk of nb) {
        if (nk >= 0 && !wall[nk] && !exterior[nk] && comp[nk] === -1) { comp[nk] = id; st.push(nk); }
      }
    }
    components.push(cells);
  }
  // Build rooms from kept components.
  const labels = (Array.isArray(textItemsFt) ? textItemsFt : []).map((it) => ({
    s: String(it.s || '').trim(), xFt: Number(it.xFt), yFt: Number(it.yFt),
  })).filter((it) => it.s && Number.isFinite(it.xFt) && Number.isFinite(it.yFt));

  const rooms = [];
  for (const cells of components) {
    const areaSqft = cells.length * cellArea;
    if (areaSqft < minRoomSqft) continue;
    let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
    let sumX = 0, sumY = 0;
    for (const k of cells) {
      const cx = k % gridN; const cy = (k - cx) / gridN;
      const fx = minX + (cx + 0.5) * cw; const fy = minY + (cy + 0.5) * ch;
      cMinX = Math.min(cMinX, minX + cx * cw); cMinY = Math.min(cMinY, minY + cy * ch);
      cMaxX = Math.max(cMaxX, minX + (cx + 1) * cw); cMaxY = Math.max(cMaxY, minY + (cy + 1) * ch);
      sumX += fx; sumY += fy;
    }
    const cenX = sumX / cells.length, cenY = sumY / cells.length;
    // Nearest label whose centroid is inside the cell bbox; else nearest by distance.
    let best = null, bestD = Infinity, bestInside = null, bestInsideD = Infinity;
    for (const lab of labels) {
      const d = Math.hypot(lab.xFt - cenX, lab.yFt - cenY);
      if (lab.xFt >= cMinX && lab.xFt <= cMaxX && lab.yFt >= cMinY && lab.yFt <= cMaxY) {
        if (d < bestInsideD) { bestInsideD = d; bestInside = lab; }
      }
      if (d < bestD) { bestD = d; best = lab; }
    }
    const chosen = bestInside || (best && bestD <= Math.max(cMaxX - cMinX, cMaxY - cMinY) ? best : null);
    const label = chosen ? chosen.s : null;
    const kind = classifyLabel(label) || 'unknown';
    const confidence = bestInside ? 'medium' : (chosen ? 'low' : 'low');
    rooms.push({
      poly: [
        [round(cMinX), round(cMinY)], [round(cMaxX), round(cMinY)],
        [round(cMaxX), round(cMaxY)], [round(cMinX), round(cMaxY)],
      ],
      bbox: { minX: round(cMinX), minY: round(cMinY), maxX: round(cMaxX), maxY: round(cMaxY) },
      areaSqft: round(areaSqft),
      label,
      kind,
      confidence,
    });
  }
  // Deterministic order: largest area first, then by position.
  rooms.sort((a, b) => b.areaSqft - a.areaSqft || a.bbox.minX - b.bbox.minX || a.bbox.minY - b.bbox.minY);
  return { rooms, gridN, interiorCells, note };
}

/**
 * PURE. Detect STAIR CORES geometrically: clusters of stair DIRECTION tokens (UP / DN / DOWN /
 * DW) co-located with a dense run of short tread-hatch segments.
 *
 * Rationale (the round-1 failure this fixes): the label-only detector found 0 stairs on A-101
 * because the sheet carries NO "STAIR" text — the shafts are drawn as hatched tread runs
 * annotated only with "UP"/"DOWN" + an arrow. This detector reads that real convention:
 *   1) Collect stair-direction tokens (UP/DN/DOWN/DW) — the run annotation inside every shaft.
 *   2) Cluster them within mergeRadiusFt into candidate cores (a scissor stair has UP+DOWN
 *      a few feet apart; two flights of one shaft share a core).
 *   3) VALIDATE each cluster geometrically: count short tread-hatch segments (length in
 *      [hatchMinFt,hatchMaxFt]) whose midpoint lies within hatchRadiusFt of the cluster
 *      centroid. A real stair shaft is densely hatched (treads); require >= minHatchSegs.
 *      A lone "UP" on a ramp/note with no hatch is rejected — no fabrication.
 *   4) Emit a square-ish core bbox sized to the hatch footprint (clamped to a plausible
 *      shaft size), in FEET, with the evidence and a confidence reflecting hatch strength.
 *
 * This is deterministic and geometry-grounded; every emitted core is flagged needs-verification
 * and is NOT an AHJ/PE egress certification.
 *
 * @param {Array<{x1,y1,x2,y2,lineWidth?}>} segments - ALL segments in FEET (for hatch density).
 * @param {Array<{s:string,xFt:number,yFt:number}>} textItemsFt - text items in FEET.
 * @param {Object} [opts]
 * @returns {{cores:Array<{poly:Array<[number,number]>, bbox:Object, centroidFt:[number,number], hatchSegs:number, dirTokens:number, evidence:string, confidence:string}>, note:string}}
 */
export function detectStairCores(segments, textItemsFt = [], opts = {}) {
  const mergeRadiusFt = Number.isFinite(opts.mergeRadiusFt) ? opts.mergeRadiusFt : 18;
  const hatchRadiusFt = Number.isFinite(opts.hatchRadiusFt) ? opts.hatchRadiusFt : 14;
  const hatchMinFt = Number.isFinite(opts.hatchMinFt) ? opts.hatchMinFt : 0.2;
  const hatchMaxFt = Number.isFinite(opts.hatchMaxFt) ? opts.hatchMaxFt : 4;
  const minHatchSegs = Number.isFinite(opts.minHatchSegs) ? opts.minHatchSegs : 60;
  const coreHalfFt = Number.isFinite(opts.coreHalfFt) ? opts.coreHalfFt : 9; // ~18ft shaft
  const note =
    'Geometric stair-core detection: clusters of UP/DN/DOWN direction tokens validated by ' +
    'dense short tread-hatch segments nearby. Reads the drawing convention (hatched shaft + ' +
    'run-direction annotation) because overall plans rarely carry a "STAIR" word. ' +
    'Best-effort, deterministic; NOT verified egress geometry; NOT AHJ/PE parity.';

  const items = Array.isArray(textItemsFt) ? textItemsFt : [];
  const dirToks = items.filter((it) => STAIR_DIR_RE.test(String(it.s || '').trim()));
  if (dirToks.length === 0) return { cores: [], note };

  // 1) cluster direction tokens (single-link within mergeRadiusFt).
  const clusters = [];
  for (const t of dirToks) {
    let merged = null;
    for (const c of clusters) {
      if (Math.hypot(c.cx - t.xFt, c.cy - t.yFt) <= mergeRadiusFt) { merged = c; break; }
    }
    if (merged) {
      merged.pts.push(t);
      merged.cx = merged.pts.reduce((a, p) => a + p.xFt, 0) / merged.pts.length;
      merged.cy = merged.pts.reduce((a, p) => a + p.yFt, 0) / merged.pts.length;
    } else {
      clusters.push({ cx: t.xFt, cy: t.yFt, pts: [t] });
    }
  }

  // 2) hatch density per cluster (short segments within hatchRadiusFt).
  const segs = Array.isArray(segments) ? segments : [];
  const hatch = segs.filter((s) => {
    const l = segLen(s);
    return l >= hatchMinFt && l <= hatchMaxFt;
  });
  const cores = [];
  for (const c of clusters) {
    let n = 0;
    let hMinX = Infinity, hMinY = Infinity, hMaxX = -Infinity, hMaxY = -Infinity;
    for (const s of hatch) {
      const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
      if (Math.hypot(mx - c.cx, my - c.cy) <= hatchRadiusFt) {
        n += 1;
        hMinX = Math.min(hMinX, mx); hMinY = Math.min(hMinY, my);
        hMaxX = Math.max(hMaxX, mx); hMaxY = Math.max(hMaxY, my);
      }
    }
    if (n < minHatchSegs) continue; // reject lone tokens with no tread hatch — no fabrication.
    // Core bbox: the hatch footprint, but clamped to a plausible shaft (avoid runaway from
    // stray hatch). Centered on the token-cluster centroid.
    const halfX = Math.min(coreHalfFt, Math.max(4, (hMaxX - hMinX) / 2 || coreHalfFt));
    const halfY = Math.min(coreHalfFt, Math.max(4, (hMaxY - hMinY) / 2 || coreHalfFt));
    const minX = round(c.cx - halfX), maxX = round(c.cx + halfX);
    const minY = round(c.cy - halfY), maxY = round(c.cy + halfY);
    cores.push({
      poly: [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]],
      bbox: { minX, minY, maxX, maxY },
      centroidFt: [round(c.cx), round(c.cy)],
      hatchSegs: n,
      dirTokens: c.pts.length,
      evidence: 'stair-direction-token(UP/DN)+tread-hatch-density',
      confidence: n >= minHatchSegs * 3 ? 'medium' : 'low',
    });
  }
  // Deterministic order: by position.
  cores.sort((a, b) => a.bbox.minX - b.bbox.minX || a.bbox.minY - b.bbox.minY);
  return { cores, note };
}

/**
 * PURE. Detect STAIR cores from rooms + text labels.
 *
 * A stair core is identified by: (1) a room already classified kind==='stair' via its label,
 * OR (2) a "STAIR" text token sitting inside a small enclosed room (a tight shaft). Returns a
 * de-duplicated set of stair bboxes/polys. Each carries the evidence used.
 *
 * @param {Array<{poly,bbox,areaSqft,label,kind}>} rooms - segmented rooms (FEET).
 * @param {Array<{s:string,xFt:number,yFt:number}>} textItemsFt
 * @returns {{stairs:Array<{poly:Array<[number,number]>, bbox:Object, evidence:string, confidence:string}>, note:string}}
 */
export function detectStairs(rooms, textItemsFt = []) {
  const note =
    'Best-effort stair-core detection: rooms classified "stair" by label, plus tight ' +
    'enclosed rooms containing a STAIR text token. NOT verified egress geometry; NOT ' +
    'AHJ/PE parity. Deterministic.';
  const out = [];
  const stairTokens = (Array.isArray(textItemsFt) ? textItemsFt : []).filter((it) =>
    /\bSTAIR(WELL|CASE|S)?\b/i.test(String(it.s || '')));
  for (const r of (Array.isArray(rooms) ? rooms : [])) {
    let evidence = null;
    if (r.kind === 'stair') evidence = 'label-classified-stair';
    else {
      for (const tok of stairTokens) {
        if (tok.xFt >= r.bbox.minX && tok.xFt <= r.bbox.maxX && tok.yFt >= r.bbox.minY && tok.yFt <= r.bbox.maxY) {
          evidence = 'stair-token-in-enclosed-room'; break;
        }
      }
    }
    if (evidence) {
      out.push({ poly: r.poly, bbox: r.bbox, evidence, confidence: r.confidence || 'low' });
    }
  }
  return { stairs: out, note };
}

/**
 * PURE. Build a structured LevelPlan from already-extracted segments + text.
 *
 * Composes the proven primitives + the new comprehension steps. Callers that have a pdfjs
 * page use extractLevelPlanFromPdf (below) which produces the inputs; this pure core is the
 * unit-testable heart.
 *
 * @param {Object} input
 * @param {Array<{x1,y1,x2,y2,lineWidth?,strokeColor?}>} input.segments - all segments in FEET.
 * @param {Array<{s:string,xFt:number,yFt:number}>} input.textItemsFt - text items in FEET.
 * @param {number} input.scaleFtPerUnit - derived feet per PDF unit.
 * @param {string} input.scaleText
 * @param {Object} [opts]
 * @returns {LevelPlan}
 */
export function buildLevelPlan(input, opts = {}) {
  const { segments, textItemsFt, scaleFtPerUnit, scaleText } = input;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('buildLevelPlan: no segments — extract geometry first (never fabricate)');
  }
  if (!Number.isFinite(scaleFtPerUnit) || scaleFtPerUnit <= 0) {
    throw new Error('buildLevelPlan: scaleFtPerUnit must be derived from the drawing (never hardcoded/guessed)');
  }
  // 1) WALL LAYER: select the heavier-than-baseline lineweight band (the cut walls), which
  //    drops the hairline fill + thin grid/dimension annotation. The footprint + room segmentation
  //    MUST use the SINGLE dominant cut-wall band (the verified W0 footprint/netalign depends on it),
  //    so partitionInclusive is explicitly stripped here — it only governs the additive wallsFull set.
  const preselectedWallSegmentsFt = normalizeSegmentsFt(opts.preselectedWallSegmentsFt);
  const { partitionInclusive: _pi, ...singleBandLayerOpts } = (opts.layerOpts || {});
  const wl = preselectedWallSegmentsFt.length
    ? { wallSegments: preselectedWallSegmentsFt, method: 'caller-preselected-wall-segments' }
    : selectWallLayer(segments, singleBandLayerOpts);
  const wallSegs = wl.wallSegments.length >= 3 ? wl.wallSegments : segments;

  // 2) FOOTPRINT: enclosed rectilinear outline of the dominant connected wall network.
  const outline = buildingOutlinePolygon(wallSegs, opts.outlineOpts || {});

  // 3) GRID from text bubbles.
  const grid = extractGrid(textItemsFt || []);

  // 4) ROOMS (enclosed spaces) + classification.
  const roomRes = segmentRooms(wallSegs, textItemsFt || [], opts.roomOpts || {});

  // 5) STAIRS — combine BOTH detectors so a sheet with no "STAIR" word still comprehends stairs:
  //    (a) label/STAIR-token rooms (detectStairs), and
  //    (b) GEOMETRIC cores from UP/DN direction tokens + tread-hatch density (detectStairCores,
  //        the round-1 fix — A-101 has zero STAIR labels but three hatched shafts annotated UP/DN).
  //    Pass the FULL segment set (not just the wall layer) to the hatch detector — tread hatch is
  //    drawn in a thin lineweight that selectWallLayer intentionally drops.
  const stairRes = detectStairs(roomRes.rooms, textItemsFt || []);
  const coreRes = detectStairCores(segments, textItemsFt || [], opts.stairCoreOpts || {});

  // Merge: start from label-based stairs, then add geometric cores that don't overlap an
  // already-found stair (centroid-in-bbox de-dup). Geometric cores carry their own evidence.
  const mergedStairs = stairRes.stairs.map((s) => ({
    poly: s.poly, bbox: s.bbox, evidence: s.evidence, confidence: s.confidence, source: 'label',
  }));
  const inBbox = (x, y, b) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  for (const core of coreRes.cores) {
    const [cx, cy] = core.centroidFt;
    const dup = mergedStairs.some((s) => inBbox(cx, cy, s.bbox));
    if (dup) continue;
    mergedStairs.push({
      poly: core.poly, bbox: core.bbox, evidence: core.evidence, confidence: core.confidence,
      source: 'geometric', hatchSegs: core.hatchSegs, dirTokens: core.dirTokens,
      centroidFt: core.centroidFt,
    });
  }

  // Reclassify any segmented room that CONTAINS a stair-core centroid as kind 'stair' (so the
  // 155 unknown enclosures are no longer ALL unknown — the shafts are now comprehended). Honest:
  // only rooms whose bbox encloses a validated core centroid are upgraded.
  for (const r of roomRes.rooms) {
    if (r.kind !== 'unknown') continue;
    const minX = Math.min(...r.poly.map((p) => p[0])), maxX = Math.max(...r.poly.map((p) => p[0]));
    const minY = Math.min(...r.poly.map((p) => p[1])), maxY = Math.max(...r.poly.map((p) => p[1]));
    const hasCore = coreRes.cores.some((c) => inBbox(c.centroidFt[0], c.centroidFt[1], { minX, maxX, minY, maxY }));
    if (hasCore) {
      r.kind = 'stair';
      r.kindSource = 'geometric-stair-core';
      r.confidence = r.confidence === 'low' ? 'medium' : r.confidence;
    }
  }

  // PARKING / open-floor comprehension (geometric, flagged). HONEST MODEL: this overall plan's
  // wall network fragments the floor into many small enclosed bays (no single big "PARKING"
  // room exists in the geometry, and the sheet carries NO 'PARK/STALL/GARAGE' text). So we do
  // NOT fabricate one parking room or a stall count. Instead we measure each unknown enclosed
  // bay's interior tread/symbol-hatch density and tag the LOW-HATCH bays (open vehicle/garage
  // floor, away from the dense residential/stair cores) as kind 'parking' at LOW confidence with
  // provenance 'geometric-open-floor-field'. We also derive a LEVEL occupancy hint when the
  // low-hatch open field dominates the floor and stair cores are present (a garage/podium
  // signature) — flagged needs-verification, never an AHJ/PE occupancy classification.
  const parkOpts = opts.parkingOpts || {};
  const enableParking = parkOpts.enabled !== false;
  let occupancyHint = null;
  if (enableParking) {
    const bboxArea = outline.bbox.widthFt * outline.bbox.heightFt;
    const minBayFrac = Number.isFinite(parkOpts.minBayFrac) ? parkOpts.minBayFrac : 0.004; // ~0.4% (>= ~80 sqft)
    const maxHatchPerSqft = Number.isFinite(parkOpts.maxHatchPerSqft) ? parkOpts.maxHatchPerSqft : 0.06;
    const hatchSegsAll = (segments || []).filter((s) => {
      const l = segLen(s);
      return l >= 0.2 && l <= 4;
    });
    const candidates = roomRes.rooms.filter((r) => r.kind === 'unknown' && r.areaSqft >= minBayFrac * bboxArea);
    for (const r of candidates) {
      const minX = Math.min(...r.poly.map((p) => p[0])), maxX = Math.max(...r.poly.map((p) => p[0]));
      const minY = Math.min(...r.poly.map((p) => p[1])), maxY = Math.max(...r.poly.map((p) => p[1]));
      let h = 0;
      for (const s of hatchSegsAll) {
        const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        if (mx >= minX && mx <= maxX && my >= minY && my <= maxY) h += 1;
      }
      r._hatchPerSqft = r.areaSqft > 0 ? h / r.areaSqft : Infinity;
    }
    const parkable = candidates.filter((r) => r._hatchPerSqft <= maxHatchPerSqft);
    let parkAreaSqft = 0;
    for (const r of parkable) {
      r.kind = 'parking';
      r.kindSource = 'geometric-open-floor-field';
      r.confidence = 'low'; // honest: no PARKING text label nor per-stall geometry confirmed
      parkAreaSqft += r.areaSqft;
    }
    for (const r of roomRes.rooms) delete r._hatchPerSqft;
    const openFrac = bboxArea > 0 ? parkAreaSqft / bboxArea : 0;
    if (coreRes.cores.length >= 1 && parkable.length >= 8 && openFrac >= 0.15) {
      occupancyHint = {
        kind: 'parking-structure',
        confidence: 'low',
        evidence: `geometric: ${parkable.length} low-hatch open bays (${Math.round(parkAreaSqft)} sqft, ` +
          `${(openFrac * 100).toFixed(0)}% of footprint bbox) + ${coreRes.cores.length} hatched stair core(s); ` +
          'no PARK/STALL/GARAGE text on sheet — DERIVED FROM GEOMETRY, needs-verification.',
      };
    }
  }

  // Walls emitted as {a,b,thickness?} pairs (the wall-layer segments).
  const walls = wallSegs.map((s) => ({ a: [round(s.x1), round(s.y1)], b: [round(s.x2), round(s.y2)] }));

  // RECORE: collapse the FRAGMENTED single-band cut-wall segments into real wall RUNS, with
  // non-wall exclusion (diagonals = door-swing arcs/hatch dropped; sub-2ft stubs = dimension
  // ticks/glyphs dropped). This is the HONEST structure — a plausible count of actual walls
  // (envelope + partitions), NOT the tens-of-thousands of ink fragments. Rendered as the
  // primary walls; `wallsFull` (the over-inclusive lineweight union) is retained only as an
  // OFF-by-default diagnostic overlay. needs-verification.
  const wr = buildWallRuns(walls, opts.wallRunOpts || {});
  const wallRuns = wr.runs;
  const wallRunsMeta = wr.meta;

  // RECALL-COMPLETE wall set (W2): the proven single-band `walls` above is the dominant cut-wall
  // lineweight — it keeps footprint/room segmentation stable (it is what the verified W0 footprint
  // and netalign depend on) but UNDER-captures interior partition + core walls (~71% wall recall
  // vs the rasterized sheet ink). `wallsFull` adds the FULL heavier-than-baseline lineweight spread
  // (partition-inclusive) so partition + core walls are present too (>=90% recall). It is CLIPPED
  // to the single-band wall envelope (expanded by clipPadFt) so off-building grid/section/dimension
  // ink at wall lineweights does NOT inflate the footprint — `wallsFull` is for RENDERING + recall,
  // never the footprint. Additive: emitted only when opts.layerOpts.partitionInclusive is set.
  let wallsFull = null;
  let wallsFullMeta = null;
  if (opts.layerOpts && opts.layerOpts.partitionInclusive) {
    const wlFull = selectWallLayer(segments, { ...opts.layerOpts, partitionInclusive: true });
    // clip envelope = single-band wall bbox padded.
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const s of wallSegs) {
      bMinX = Math.min(bMinX, s.x1, s.x2); bMinY = Math.min(bMinY, s.y1, s.y2);
      bMaxX = Math.max(bMaxX, s.x1, s.x2); bMaxY = Math.max(bMaxY, s.y1, s.y2);
    }
    const pad = Number.isFinite(opts.layerOpts.clipPadFt) ? opts.layerOpts.clipPadFt : 3;
    const inClip = (s) => {
      const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
      return mx >= bMinX - pad && mx <= bMaxX + pad && my >= bMinY - pad && my <= bMaxY + pad;
    };
    const kept = wlFull.wallSegments.filter(inClip);
    wallsFull = kept.map((s) => ({ a: [round(s.x1), round(s.y1)], b: [round(s.x2), round(s.y2)] }));
    wallsFullMeta = {
      method: wlFull.method,
      includedLineWidths: wlFull.includedLineWidths || null,
      baselineLineWidth: wlFull.baselineLineWidth ?? null,
      countBeforeClip: wlFull.wallSegments.length,
      countAfterClip: kept.length,
      clipEnvelopeFt: { minX: round(bMinX - pad), minY: round(bMinY - pad), maxX: round(bMaxX + pad), maxY: round(bMaxY + pad) },
      note: 'Partition-inclusive wall set (all heavier-than-baseline lineweight bands) clipped to the ' +
        'single-band wall envelope (+pad). For rendering + recall ONLY; the footprint uses the ' +
        'single-band `walls`. needs-verification.',
    };
  }

  // Wall-segment ENVELOPE bbox (ALL wall-layer segments, not just the traced connected loop).
  // This is the honest footprint envelope when buildingOutlinePolygon's enclosed trace collapses
  // — e.g. a wing whose match-line edge is OPEN, so the outline trace only captures a sub-network
  // and outline.bbox is a sliver. The merge/registration use wallBboxFt for such open wings.
  let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;
  for (const s of wallSegs) {
    wMinX = Math.min(wMinX, s.x1, s.x2); wMinY = Math.min(wMinY, s.y1, s.y2);
    wMaxX = Math.max(wMaxX, s.x1, s.x2); wMaxY = Math.max(wMaxY, s.y1, s.y2);
  }
  const wallBboxFt = Number.isFinite(wMinX)
    ? { widthFt: round(wMaxX - wMinX), heightFt: round(wMaxY - wMinY), minX: round(wMinX), minY: round(wMinY), maxX: round(wMaxX), maxY: round(wMaxY) }
    : null;

  // Footprint loop (close it).
  const footprintFt = outline.polygon.map(([x, y]) => [round(x), round(y)]);

  const labelItems = (textItemsFt || [])
    .map((it) => ({ text: String(it.s || '').trim(), xFt: round(it.xFt), yFt: round(it.yFt) }))
    .filter((it) => it.text);

  return {
    scaleFtPerUnit: round(scaleFtPerUnit),
    scaleText: scaleText || `feetPerUnit=${round(scaleFtPerUnit)}`,
    footprintFt,
    // Two honest area measures: the enclosed-trace area (reliable for closed plans) AND the
    // bbox area (always defined). For OPEN-ENDED plans (parking wings with open vehicle
    // entries) the exterior flood-fill leaks through the opening and the enclosed-trace area
    // collapses — so we surface BOTH and flag which is trustworthy.
    footprintAreaSqft: round(outline.areaSqft),
    footprintBboxAreaSqft: round(outline.bbox.widthFt * outline.bbox.heightFt),
    footprintAreaReliable: outline.areaSqft >= 0.5 * outline.bbox.widthFt * outline.bbox.heightFt,
    footprintBboxFt: {
      widthFt: outline.bbox.widthFt,
      heightFt: outline.bbox.heightFt,
      minX: outline.bbox.minX, minY: outline.bbox.minY,
      maxX: outline.bbox.maxX, maxY: outline.bbox.maxY,
    },
    wallBboxFt,
    walls,
    wallRuns,
    wallRunsMeta,
    ...(wallsFull ? { wallsFull, wallsFullMeta } : {}),
    rooms: roomRes.rooms.map((r) => ({
      poly: r.poly, label: r.label, kind: r.kind, areaSqft: r.areaSqft, confidence: r.confidence,
      ...(r.kindSource ? { kindSource: r.kindSource } : {}),
    })),
    stairs: mergedStairs.map((s) => ({
      poly: s.poly, bbox: s.bbox, evidence: s.evidence, confidence: s.confidence, source: s.source,
      ...(s.hatchSegs != null ? { hatchSegs: s.hatchSegs } : {}),
      ...(s.dirTokens != null ? { dirTokens: s.dirTokens } : {}),
      ...(s.centroidFt ? { centroidFt: s.centroidFt } : {}),
    })),
    grid: { xs: grid.xs, ys: grid.ys, labels: grid.labels, colDatums: grid.colDatums, rowDatums: grid.rowDatums },
    labels: labelItems,
    roomKinds: roomRes.rooms.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] || 0) + 1; return acc; }, {}),
    counts: {
      segments: segments.length,
      wallSegments: wallSegs.length,
      rooms: roomRes.rooms.length,
      stairs: mergedStairs.length,
      stairCoresGeometric: coreRes.cores.length,
      stairsLabelBased: stairRes.stairs.length,
      gridCols: grid.xs.length,
      gridRows: grid.ys.length,
    },
    wallLayer: { method: wl.method, chosen: wl.chosen },
    footprintMethod: outline.method,
    occupancyHint,
    provenance: PROVENANCE_BASE,
    needsVerification: true,
    notes: {
      footprint: outline.note,
      rooms: roomRes.note,
      stairs: stairRes.note,
      stairCores: coreRes.note,
    },
  };
}

/**
 * PURE. Split a sheet that carries TWO (or more) STACKED plan views into per-view regions.
 *
 * THE PROBLEM THIS FIXES: A-101 (and other "OVERALL" sheets) draw a building too long to fit
 * the page at the printed scale, so the building is broken at a MATCH LINE into two plan views
 * stacked vertically on one sheet (an UPPER view and a LOWER view), each with its own
 * "TYPICAL ... ASSEMBLY / SCALE ..." sub-title band beneath it. The single-region extractor
 * locks onto the densest connected wall band — only ONE wing — and silently drops the other.
 *
 * DETECTION (deterministic, geometry+text grounded — no fitted constants tied to a target):
 *  1) Build a Y-occupancy histogram of segment endpoints (excluding the right title-block
 *     column). Stacked plan views show up as TWO dense humps separated by a sparse VALLEY
 *     (the inter-view margin + each view's sub-title text band).
 *  2) Find the deepest valley between the two largest humps; its Y is the split line.
 *  3) Return each view's segment + text subsets (split at that Y), plus the split metadata.
 *
 * Returns { views: [{ region:'lower'|'upper', yRangeFt, segments, textItemsFt }...], splitYFt,
 *           valleyDepthFrac, isStacked }. When no clear valley (single plan view) -> isStacked
 * false and a single view spanning everything (caller then uses the normal single-region path).
 *
 * @param {Array<{x1,y1,x2,y2}>} segments - ALL segments in FEET.
 * @param {Array<{s:string,xFt:number,yFt:number}>} textItemsFt - text items in FEET.
 * @param {Object} [opts]
 * @param {number} [opts.bins] - Y histogram bins (default 96).
 * @param {number} [opts.pageWidthFt] - if given, exclude the right 20% (title block) from the histogram.
 * @param {number} [opts.minValleyFrac] - valley must drop below this fraction of the smaller hump peak (default 0.30).
 * @returns {{views:Array, splitYFt:number|null, valleyDepthFrac:number, isStacked:boolean, note:string}}
 */
export function splitStackedPlanViews(segments, textItemsFt = [], opts = {}) {
  const note =
    'Stacked-plan-view split: detects TWO plan views drawn on one sheet (a match-line break) ' +
    'via a Y-occupancy valley between two dense humps, so BOTH wings of an over-length floor ' +
    'are extracted (not just the denser one). Deterministic; the split Y is the deepest valley ' +
    'between the two largest geometry humps. needs-verification.';
  const segs = Array.isArray(segments) ? segments : [];
  const txt = Array.isArray(textItemsFt) ? textItemsFt : [];
  const single = () => ({
    views: [{ region: 'single', yRangeFt: null, segments: segs, textItemsFt: txt }],
    splitYFt: null, valleyDepthFrac: 0, isStacked: false, note,
  });
  if (segs.length < 100) return single();

  const bins = Number.isInteger(opts.bins) && opts.bins > 8 ? opts.bins : 96;
  const minValleyFrac = Number.isFinite(opts.minValleyFrac) ? opts.minValleyFrac : 0.30;
  const titleXFt = Number.isFinite(opts.pageWidthFt) ? 0.80 * opts.pageWidthFt : Infinity;

  let minY = Infinity, maxY = -Infinity;
  for (const s of segs) { minY = Math.min(minY, s.y1, s.y2); maxY = Math.max(maxY, s.y1, s.y2); }
  if (!(maxY > minY)) return single();
  const span = maxY - minY;
  const hist = new Float64Array(bins);
  const addPt = (x, y) => {
    if (x > titleXFt) return;
    const b = Math.min(bins - 1, Math.max(0, Math.floor((y - minY) / span * bins)));
    hist[b] += 1;
  };
  for (const s of segs) { addPt(s.x1, s.y1); addPt(s.x2, s.y2); }

  // Smooth lightly (3-tap) so single noisy bins don't read as occupied/empty by accident.
  const sm = new Float64Array(bins);
  for (let i = 0; i < bins; i++) {
    sm[i] = (hist[Math.max(0, i - 1)] + hist[i] + hist[Math.min(bins - 1, i + 1)]) / 3;
  }
  // STACKED VIEWS = two OCCUPIED MASSES separated by a sustained LOW-DENSITY GAP (the inter-view
  // margin + each view's sub-title band). The WRONG signal is the narrow dip BETWEEN two wall-rows
  // of ONE wing (perimeter walls of a single mass) — those dips are deep but NARROW. So we do not
  // pair two peaks (that finds within-wing wall-row dips); instead we find the LONGEST RUN of
  // low-density bins that lies BETWEEN two substantial occupied regions, and split at its center.
  const peak = Math.max(...sm);
  if (!(peak > 0)) return single();
  // "occupied" = density above a SMALL fraction of the peak. Wall-row spikes dwarf room interiors
  // (peak ~47k vs interior ~hundreds), so the cutoff must be low (1% of peak) or the wings
  // fragment into many false gaps at every interior row. The inter-view margin is genuinely
  // near-zero and forms the LONGEST empty run; within-wing dips between wall-rows are 1-2 bins.
  const occCutoffFrac = Number.isFinite(opts.occCutoffFrac) ? opts.occCutoffFrac : 0.01;
  const occThresh = occCutoffFrac * peak;
  const occupied = Array.from(sm, (v) => v >= occThresh ? 1 : 0);
  // total occupied mass on each side of a candidate gap must be substantial (both wings real).
  const prefix = new Float64Array(bins + 1);
  for (let i = 0; i < bins; i++) prefix[i + 1] = prefix[i] + sm[i];
  const totalMass = prefix[bins];
  // Scan maximal empty runs; pick the longest run with substantial mass on BOTH sides.
  let bestRun = null; // {start,end,len}
  let i = 0;
  while (i < bins) {
    if (occupied[i]) { i++; continue; }
    let j = i; while (j < bins && !occupied[j]) j++;
    const start = i, end = j - 1, len = j - i;
    const massBefore = prefix[start];
    const massAfter = totalMass - prefix[end + 1];
    // require each side >= 15% of total mass (a real wing), and the gap not at the very edge.
    if (start > 0 && end < bins - 1 && massBefore >= 0.15 * totalMass && massAfter >= 0.15 * totalMass) {
      if (!bestRun || len > bestRun.len) bestRun = { start, end, len };
    }
    i = j;
  }
  // A real inter-view margin spans several feet; require the gap >= minGapBins so a 1-2 bin dip
  // between two wall-rows of ONE wing can never be mistaken for the inter-view break.
  const minGapBins = Number.isInteger(opts.minGapBins) ? opts.minGapBins : 3;
  if (!bestRun || bestRun.len < minGapBins) return single(); // no sustained inter-view gap.
  const valleyi = Math.floor((bestRun.start + bestRun.end) / 2);
  // valley depth = min smoothed density inside the gap, relative to the peak (diagnostic).
  let valleyMin = Infinity;
  for (let k = bestRun.start; k <= bestRun.end; k++) valleyMin = Math.min(valleyMin, sm[k]);
  const valleyDepthFrac = peak > 0 ? valleyMin / peak : 1;

  const splitYFt = round(minY + (valleyi + 0.5) / bins * span);
  const lowerSegs = [], upperSegs = [];
  for (const s of segs) {
    const my = (s.y1 + s.y2) / 2;
    (my < splitYFt ? lowerSegs : upperSegs).push(s);
  }
  const lowerTxt = [], upperTxt = [];
  for (const t of txt) ((Number(t.yFt) < splitYFt) ? lowerTxt : upperTxt).push(t);
  return {
    views: [
      { region: 'lower', yRangeFt: [round(minY), splitYFt], segments: lowerSegs, textItemsFt: lowerTxt },
      { region: 'upper', yRangeFt: [splitYFt, round(maxY)], segments: upperSegs, textItemsFt: upperTxt },
    ],
    splitYFt, valleyDepthFrac: round(valleyDepthFrac), isStacked: true, note,
  };
}

/**
 * PURE. Compute the rigid (x,y) translation that registers wing B onto wing A using their
 * SHARED grid-column datums (and, when available, shared rows).
 *
 * Stacked views of one over-length building OVERLAP at a match line — the same numbered grid
 * columns appear in BOTH views (A-101: lower carries columns ~10..23, upper ~16..30; columns
 * 16..23 are shared). Each view places its drawing at a different sheet offset, so the shared
 * columns sit at different X in each view by a CONSTANT offset. We recover that offset from the
 * shared column label positions (median of per-shared-column deltas — robust to a stray bubble),
 * and the Y offset from shared row datums (median delta); rows are sparser/noisier so Y falls
 * back to aligning the footprint-bbox match-line edges when < 1 shared row.
 *
 * Returns the translation to ADD to wing B's coordinates so its shared columns land on wing A's.
 *
 * @param {{grid:{xs:number[],ys:number[],labels:{cols:string[],rows:string[]}}, footprintBboxFt:Object}} wingA
 * @param {Object} wingB - same shape.
 * @param {Object} [opts]
 * @returns {{dx:number, dy:number, sharedCols:string[], sharedRows:string[], method:string, confidence:string}}
 */
export function computeWingRegistration(wingA, wingB, opts = {}) {
  const colsA = mapLabelToCoord(wingA, 'cols');
  const colsB = mapLabelToCoord(wingB, 'cols');
  const rowsA = mapLabelToCoord(wingA, 'rows');
  const rowsB = mapLabelToCoord(wingB, 'rows');

  const sharedCols = Object.keys(colsA).filter((k) => k in colsB);
  const sharedRows = Object.keys(rowsA).filter((k) => k in rowsB);

  // The shared-label set is CONTAMINATED: some "datums" are dimension-string fragments mis-read as
  // grid bubbles and snapped to the wrong line, so their A-B delta is garbage. A real match-line
  // offset is a SINGLE CONSTANT, so the genuine shared columns all agree on one delta while the
  // noise scatters. Recover the offset as the CONSENSUS (largest agreeing cluster, tol ~2ft) of
  // per-label deltas — robust to the contamination a plain median can't survive.
  const tolFt = Number.isFinite(opts.deltaTolFt) ? opts.deltaTolFt : 2;
  const consensus = (labels, coordA, coordB) => {
    const deltas = labels.map((k) => ({ k, d: coordA[k] - coordB[k] })).filter((o) => Number.isFinite(o.d));
    if (!deltas.length) return null;
    // For each delta, count how many others agree within tol; pick the delta with the largest
    // agreeing set, then average that set for the final offset. Deterministic.
    let best = null;
    for (const cand of deltas) {
      const agree = deltas.filter((o) => Math.abs(o.d - cand.d) <= tolFt);
      if (!best || agree.length > best.agree.length ||
          (agree.length === best.agree.length && cand.d < best.cand.d)) {
        best = { cand, agree };
      }
    }
    const mean = best.agree.reduce((a, o) => a + o.d, 0) / best.agree.length;
    return { offset: mean, inliers: best.agree.map((o) => o.k), count: best.agree.length, total: deltas.length };
  };

  const colCon = consensus(sharedCols, colsA, colsB);

  let dx = colCon ? colCon.offset : null;
  // Inlier labels are the columns/rows that actually agree on the consensus offset (the honest
  // shared grid lines); report THOSE, not the contaminated full shared-label set.
  const colInliers = colCon ? colCon.inliers : [];
  let method = 'shared-grid-columns(consensus)';
  let confidence = (colCon && colCon.count >= 3) ? 'medium' : 'low';

  // Honest envelope per wing: the wall-segment bbox is the trustworthy extent for open-ended
  // wings (whose enclosed-trace footprintBboxFt collapses to a sliver at the open match-line edge).
  const envA = wingEnvelope(wingA);
  const envB = wingEnvelope(wingB);

  if (dx == null) {
    // No shared columns — fall back to aligning envelope left edges (weak).
    dx = (envA.minX ?? 0) - (envB.minX ?? 0);
    method = 'wall-bbox-edges(no-shared-columns)';
    confidence = 'low';
  }

  // Y REGISTRATION. Row-bubble extraction is heavily contaminated by prose letters (a single
  // letter "A"/"F"/"N" inside a NOTES word clusters as a "row datum"), so a row-label consensus
  // is UNRELIABLE on overall sheets. The trustworthy Y signal is geometric: in a match-line split
  // BOTH views show the SAME building rows, so their wall-segment envelopes have (near-)equal
  // HEIGHT and must be aligned edge-to-edge. We align the envelope bottom edges (minY). We only
  // PREFER a row-label consensus when it has >= 2 inlier rows AND it agrees (within 6 ft) with the
  // geometric alignment — otherwise the geometric alignment wins (and we say so).
  const dyGeom = (envA.minY ?? 0) - (envB.minY ?? 0);
  let rowCon = null;
  let dy = dyGeom;
  let rowInliers = [];
  const heightsAgree = Math.abs((envA.heightFt ?? 0) - (envB.heightFt ?? 0)) <= Math.max(4, 0.1 * (envA.heightFt ?? 1));
  // recompute row consensus here (declared earlier as const removed): use the same consensus fn.
  rowCon = consensus(sharedRows, rowsA, rowsB);
  if (rowCon && rowCon.count >= 2 && Math.abs(rowCon.offset - dyGeom) <= 6) {
    dy = rowCon.offset;
    rowInliers = rowCon.inliers;
    method += '+shared-rows(consensus,agrees-geom)';
  } else {
    method += heightsAgree ? '+wall-bbox-bottom-edge-Y(equal-height)' : '+wall-bbox-bottom-edge-Y(height-mismatch,low-conf)';
    if (!heightsAgree) confidence = 'low';
  }
  return {
    dx: round(dx), dy: round(dy),
    sharedCols, sharedRows,
    inlierCols: colInliers, inlierRows: rowInliers,
    colInlierCount: colCon ? colCon.count : 0, rowInlierCount: rowCon ? rowCon.count : 0,
    method, confidence,
  };
}

/** Honest extent of a wing: prefer the wall-segment bbox (covers open match-line edges), else the
 *  enclosed-trace footprint bbox. */
function wingEnvelope(wing) {
  const wb = wing?.wallBboxFt;
  if (wb && Number.isFinite(wb.minX) && (wb.widthFt > 0) && (wb.heightFt > 0)) return wb;
  return wing?.footprintBboxFt || { minX: 0, minY: 0, maxX: 0, maxY: 0, widthFt: 0, heightFt: 0 };
}

/**
 * Map grid labels -> datum coordinate. Prefer the explicit label->coord pairs (colDatums/rowDatums,
 * each label snapped to its surviving datum) so a NAMED grid line's coordinate is known regardless
 * of total datum count. Falls back to index-pairing only when the pairs are absent (legacy plans).
 */
function mapLabelToCoord(wing, which) {
  const out = {};
  const pairs = which === 'cols' ? (wing?.grid?.colDatums || []) : (wing?.grid?.rowDatums || []);
  const key = which === 'cols' ? 'xFt' : 'yFt';
  if (pairs.length) {
    for (const p of pairs) if (p && p.label != null && Number.isFinite(p[key])) out[p.label] = p[key];
    return out;
  }
  // Legacy fallback: index-pair labels[i] <-> coords[i] only when counts match.
  const labels = wing?.grid?.labels?.[which] || [];
  const coords = which === 'cols' ? (wing?.grid?.xs || []) : (wing?.grid?.ys || []);
  if (labels.length === coords.length) {
    for (let i = 0; i < labels.length; i++) out[labels[i]] = coords[i];
  }
  return out;
}

/**
 * PURE. Merge two wing LevelPlans (lower + upper) of ONE over-length floor into a single
 * complete LevelPlan, registering wing B (upper) onto wing A (lower) via shared grid columns.
 *
 * Geometry from BOTH wings is unioned in the COMMON coordinate frame (wing A's frame). Walls,
 * rooms, stairs, grid datums, and labels are translated by the registration offset for wing B
 * and concatenated. Footprint becomes the union bbox; counts are summed. The shared overlap
 * columns mean a thin band of duplicated geometry at the match line — acceptable (and honest:
 * we do NOT dedup walls, which could erase real geometry; the overlap is flagged in notes).
 *
 * @param {LevelPlan} wingA - lower wing (reference frame).
 * @param {LevelPlan} wingB - upper wing (translated onto A).
 * @param {Object} reg - from computeWingRegistration(wingA, wingB).
 * @param {Object} [meta] - { scaleFtPerUnit, scaleText, scaleSource }.
 * @returns {LevelPlan} merged complete-floor plan.
 */
export function mergeWingPlans(wingA, wingB, reg, meta = {}) {
  const dx = Number(reg?.dx) || 0;
  const dy = Number(reg?.dy) || 0;
  const shiftPt = ([x, y]) => [round(x + dx), round(y + dy)];
  const shiftPoly = (poly) => (Array.isArray(poly) ? poly.map(shiftPt) : poly);
  const shiftBbox = (b) => (b ? {
    minX: round(b.minX + dx), maxX: round(b.maxX + dx),
    minY: round(b.minY + dy), maxY: round(b.maxY + dy),
  } : b);

  // Walls: A as-is; B translated.
  const wallsA = (wingA.walls || []).map((w) => ({ a: w.a, b: w.b }));
  const wallsB = (wingB.walls || []).map((w) => ({ a: shiftPt(w.a), b: shiftPt(w.b) }));
  const walls = wallsA.concat(wallsB);

  // wallsFull (recall-complete partition-inclusive set): A as-is; B translated. Additive.
  let wallsFull = null;
  if (wingA.wallsFull || wingB.wallsFull) {
    const fa = (wingA.wallsFull || []).map((w) => ({ a: w.a, b: w.b }));
    const fb = (wingB.wallsFull || []).map((w) => ({ a: shiftPt(w.a), b: shiftPt(w.b) }));
    wallsFull = fa.concat(fb);
  }

  // RECORE: wall RUNS computed from the MERGED single-band walls (both wings in the common
  // frame) — the honest primary structure (envelope + partitions), non-wall ink excluded.
  const wrMerged = buildWallRuns(walls, meta.wallRunOpts || {});

  // Rooms: A as-is; B translated (poly + any bbox).
  const roomsA = (wingA.rooms || []).map((r) => ({ ...r }));
  const roomsB = (wingB.rooms || []).map((r) => ({ ...r, poly: shiftPoly(r.poly) }));
  const rooms = roomsA.concat(roomsB);

  // Stairs: A as-is; B translated (poly + bbox + centroid).
  const stairsA = (wingA.stairs || []).map((s) => ({ ...s }));
  const stairsB = (wingB.stairs || []).map((s) => ({
    ...s, poly: shiftPoly(s.poly), bbox: shiftBbox(s.bbox),
    ...(s.centroidFt ? { centroidFt: shiftPt(s.centroidFt) } : {}),
  }));
  const stairs = stairsA.concat(stairsB);

  // Footprint: union of both wings' HONEST envelopes (wall-segment bbox, which covers open
  // match-line edges where the enclosed-trace polygon collapses) in the common frame, reported
  // as the union bbox loop. WingB's envelope is translated by (dx,dy).
  const eA = wingEnvelope(wingA);
  const eB = wingEnvelope(wingB);
  let uMinX = Math.min(eA.minX, eB.minX + dx);
  let uMaxX = Math.max(eA.maxX, eB.maxX + dx);
  let uMinY = Math.min(eA.minY, eB.minY + dy);
  let uMaxY = Math.max(eA.maxY, eB.maxY + dy);
  // Fall back to translated wall endpoints if envelopes are degenerate.
  if (!Number.isFinite(uMinX) || !(uMaxX > uMinX)) {
    uMinX = Infinity; uMinY = Infinity; uMaxX = -Infinity; uMaxY = -Infinity;
    for (const w of walls) {
      for (const [x, y] of [w.a, w.b]) {
        uMinX = Math.min(uMinX, x); uMinY = Math.min(uMinY, y);
        uMaxX = Math.max(uMaxX, x); uMaxY = Math.max(uMaxY, y);
      }
    }
  }
  const footprintFt = [
    [round(uMinX), round(uMinY)], [round(uMaxX), round(uMinY)],
    [round(uMaxX), round(uMaxY)], [round(uMinX), round(uMaxY)], [round(uMinX), round(uMinY)],
  ];
  const widthFt = round(uMaxX - uMinX), heightFt = round(uMaxY - uMinY);

  // Grid: A's datums as-is; B's translated; merge unique (within 1ft tolerance) keeping sorted.
  const mergeAxis = (a, bShifted) => {
    const out = [...(a || [])];
    for (const v of (bShifted || [])) {
      if (!out.some((u) => Math.abs(u - v) <= 1)) out.push(round(v));
    }
    return out.sort((p, q) => p - q);
  };
  const xsMerged = mergeAxis(wingA.grid?.xs, (wingB.grid?.xs || []).map((x) => x + dx));
  const ysMerged = mergeAxis(wingA.grid?.ys, (wingB.grid?.ys || []).map((y) => y + dy));
  const colLabels = Array.from(new Set([...(wingA.grid?.labels?.cols || []), ...(wingB.grid?.labels?.cols || [])]))
    .sort((p, q) => (parseFloat(p) - parseFloat(q)) || String(p).localeCompare(String(q)));
  const rowLabels = Array.from(new Set([...(wingA.grid?.labels?.rows || []), ...(wingB.grid?.labels?.rows || [])])).sort();

  // Labels: A as-is; B translated.
  const labelsA = (wingA.labels || []).map((l) => ({ ...l }));
  const labelsB = (wingB.labels || []).map((l) => ({ text: l.text, xFt: round(l.xFt + dx), yFt: round(l.yFt + dy) }));
  const labels = labelsA.concat(labelsB);

  const roomKinds = rooms.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] || 0) + 1; return acc; }, {});
  const scaleFtPerUnit = Number(meta.scaleFtPerUnit) || wingA.scaleFtPerUnit;

  return {
    scaleFtPerUnit: round(scaleFtPerUnit),
    scaleText: meta.scaleText || wingA.scaleText,
    scaleSource: meta.scaleSource || wingA.scaleSource,
    footprintFt,
    footprintAreaSqft: round(widthFt * heightFt), // merged is a union envelope; bbox area is the honest measure
    footprintBboxAreaSqft: round(widthFt * heightFt),
    footprintAreaReliable: false, // a union of two wing envelopes — bbox only, not an enclosed trace
    footprintBboxFt: { widthFt, heightFt, minX: round(uMinX), minY: round(uMinY), maxX: round(uMaxX), maxY: round(uMaxY) },
    walls,
    wallRuns: wrMerged.runs,
    wallRunsMeta: wrMerged.meta,
    ...(wallsFull ? { wallsFull, wallsFullMeta: { merged: true, count: wallsFull.length, note: 'Partition-inclusive recall-complete wall set, both wings merged (wing B translated). Rendering + recall only; footprint uses single-band walls. needs-verification.' } } : {}),
    rooms,
    stairs,
    grid: { xs: xsMerged, ys: ysMerged, labels: { cols: colLabels, rows: rowLabels } },
    labels,
    roomKinds,
    counts: {
      segments: (wingA.counts?.segments || 0) + (wingB.counts?.segments || 0),
      wallSegments: walls.length,
      rooms: rooms.length,
      stairs: stairs.length,
      stairCoresGeometric: (wingA.counts?.stairCoresGeometric || 0) + (wingB.counts?.stairCoresGeometric || 0),
      stairsLabelBased: (wingA.counts?.stairsLabelBased || 0) + (wingB.counts?.stairsLabelBased || 0),
      gridCols: xsMerged.length,
      gridRows: ysMerged.length,
    },
    wallLayer: wingA.wallLayer,
    footprintMethod: 'stacked-wings-union(bbox)',
    occupancyHint: wingA.occupancyHint || wingB.occupancyHint || null,
    merged: {
      wings: 2,
      registration: { dx, dy, sharedCols: reg?.sharedCols || [], sharedRows: reg?.sharedRows || [], inlierCols: reg?.inlierCols || [], inlierRows: reg?.inlierRows || [], method: reg?.method, confidence: reg?.confidence },
      wingA: { footprintBboxFt: wingA.footprintBboxFt, stairs: (wingA.stairs || []).length, rooms: (wingA.rooms || []).length },
      wingB: { footprintBboxFt: wingB.footprintBboxFt, stairs: (wingB.stairs || []).length, rooms: (wingB.rooms || []).length },
    },
    provenance: PROVENANCE_BASE + ' — MERGED from TWO stacked plan views registered by shared grid columns',
    needsVerification: true,
    notes: {
      footprint: 'Union envelope (bbox) of two stacked wings registered via shared grid columns; ' +
        'NOT a single enclosed wall trace. Overlap band at the match line is NOT deduplicated ' +
        '(deduping could erase real geometry); flagged needs-verification.',
      rooms: wingA.notes?.rooms,
      stairs: wingA.notes?.stairs,
      merge: `Two plan views on one sheet merged: wing B (upper) translated by (dx=${dx}, dy=${dy}) ft ` +
        `onto wing A (lower) using shared grid columns [${(reg?.sharedCols || []).join(',')}] ` +
        `(method=${reg?.method}, confidence=${reg?.confidence}). needs-verification.`,
    },
  };
}

/**
 * Async. Extract a LevelPlan directly from a vector PDF page.
 *
 * Reads the page text (to derive scale + labels + grid bubbles) and the operator list (to
 * extract CTM-mapped vector segments), then runs buildLevelPlan. Operates PER-PAGE — the
 * caller passes one already-loaded pdfjs page (so a huge multi-page PDF is never fully
 * materialized here beyond what pdfjs lazily loads).
 *
 * @param {Object} page - a pdfjs page (doc.getPage(n)).
 * @param {Object} [opts]
 * @param {number} [opts.scaleFtPerUnit] - override; default DERIVED from the page text.
 *   If neither a printed scale is readable NOR an override is given -> THROWS (never guesses).
 * @param {Function} [opts.samInvoker] - optional async SAM reconciler; see reconcileWithSam.
 * @returns {Promise<LevelPlan & {samUsed:boolean, samReason?:string}>}
 */
export async function extractLevelPlanFromPdf(page, opts = {}) {
  if (!page || typeof page.getOperatorList !== 'function' || typeof page.getTextContent !== 'function') {
    throw new Error('extractLevelPlanFromPdf: a pdfjs page (getOperatorList + getTextContent) is required');
  }
  // 1) TEXT: items + joined string for scale.
  const tc = await page.getTextContent();
  const rawItems = (tc.items || []).map((it) => ({
    s: it.str, xPt: it.transform[4], yPt: it.transform[5],
  }));
  const joined = rawItems.map((i) => i.s).join(' ');

  // 2) SCALE: derive from the printed notation (never hardcoded). Override allowed but flagged.
  let scaleInfo = deriveScaleFromText(joined);
  if (opts.scaleFtPerUnit && Number(opts.scaleFtPerUnit) > 0) {
    scaleInfo = {
      feetPerUnit: Number(opts.scaleFtPerUnit),
      scaleText: scaleInfo ? scaleInfo.scaleText : `operator-supplied feetPerUnit=${opts.scaleFtPerUnit}`,
      source: scaleInfo ? 'sheet-printed-scale-notation(+override)' : 'operator-supplied-override',
    };
  }
  if (!scaleInfo) {
    throw new Error(
      'extractLevelPlanFromPdf: no printed SCALE notation found on the sheet and no ' +
      'scaleFtPerUnit override supplied — the scale is DERIVED FROM THE DRAWING and is ' +
      'never guessed. Provide opts.scaleFtPerUnit or use a sheet with a readable scale.',
    );
  }
  const scaleFtPerUnit = scaleInfo.feetPerUnit;

  // 3) GEOMETRY: CTM-mapped segments in feet.
  const precomputedSegmentsFt = normalizeSegmentsFt(opts.segmentsFt);
  const segments = precomputedSegmentsFt.length
    ? precomputedSegmentsFt
    : extractSegmentsFromOpList(await page.getOperatorList(), { scale: scaleFtPerUnit }).segments;
  if (!segments.length) {
    throw new Error('extractLevelPlanFromPdf: no vector path geometry on this page (raster/scanned or text-only).');
  }
  // Text items -> feet (text transform tx/ty are in PDF user units; same scale).
  const textItemsFt = rawItems
    .filter((i) => i.s && i.s.trim())
    .map((i) => ({ s: i.s.trim(), xFt: i.xPt * scaleFtPerUnit, yFt: i.yPt * scaleFtPerUnit }));

  const plan = buildLevelPlan(
    { segments, textItemsFt, scaleFtPerUnit, scaleText: scaleInfo.scaleText },
    opts,
  );
  plan.scaleSource = scaleInfo.source;

  // 4) Optional SAM reconciliation of ambiguous (unknown/low-confidence) spaces.
  let samUsed = false, samReason = 'not-attempted';
  if (typeof opts.samInvoker === 'function') {
    try {
      const rec = await reconcileWithSam(plan, opts.samInvoker, opts.samOpts || {});
      samUsed = rec.samUsed;
      samReason = rec.reason;
      if (rec.samUsed) plan.samReconcile = rec.summary;
    } catch (err) {
      samUsed = false;
      samReason = `sam-error:${err && err.message ? err.message : err}`;
    }
  }
  plan.samUsed = samUsed;
  plan.samReason = samReason;
  return plan;
}

/**
 * Async. Extract a COMPLETE floor from a sheet that carries TWO STACKED plan views (a building
 * broken at a match line into an upper + lower view on one sheet — e.g. A-101).
 *
 * Reads scale once (shared by both views — same printed notation), extracts ALL segments + text,
 * SPLITS them into the two plan-view regions (Y-occupancy valley), builds a LevelPlan per wing,
 * computes the rigid registration from shared grid columns, and MERGES into one complete-floor
 * LevelPlan. If the sheet turns out to be a single plan view (no clear valley) it falls back to
 * the normal single-region buildLevelPlan and flags merged:null.
 *
 * Honest: scale DERIVED from the sheet's printed notation; registration DERIVED from shared grid
 * datums; everything flagged needs-verification. If splitting/registration cannot find shared
 * columns it still merges (low-confidence, bbox-edge fallback) and SAYS SO in the merge note.
 *
 * @param {Object} page - a pdfjs page.
 * @param {Object} [opts] - same opts as extractLevelPlanFromPdf (scaleFtPerUnit override, splitOpts, etc.)
 * @returns {Promise<LevelPlan>} merged complete-floor plan (or single-view plan if not stacked).
 */
export async function extractStackedFloorPlanFromPdf(page, opts = {}) {
  if (!page || typeof page.getOperatorList !== 'function' || typeof page.getTextContent !== 'function') {
    throw new Error('extractStackedFloorPlanFromPdf: a pdfjs page (getOperatorList + getTextContent) is required');
  }
  // 1) TEXT + SCALE (shared by both stacked views).
  const tc = await page.getTextContent();
  const rawItems = (tc.items || []).map((it) => ({ s: it.str, xPt: it.transform[4], yPt: it.transform[5] }));
  const joined = rawItems.map((i) => i.s).join(' ');
  let scaleInfo = deriveScaleFromText(joined);
  if (opts.scaleFtPerUnit && Number(opts.scaleFtPerUnit) > 0) {
    scaleInfo = {
      feetPerUnit: Number(opts.scaleFtPerUnit),
      scaleText: scaleInfo ? scaleInfo.scaleText : `operator-supplied feetPerUnit=${opts.scaleFtPerUnit}`,
      source: scaleInfo ? 'sheet-printed-scale-notation(+override)' : 'operator-supplied-override',
    };
  }
  if (!scaleInfo) {
    throw new Error('extractStackedFloorPlanFromPdf: no printed SCALE notation and no override — scale is DERIVED, never guessed.');
  }
  const scaleFtPerUnit = scaleInfo.feetPerUnit;

  // 2) GEOMETRY + TEXT in feet.
  const opList = await page.getOperatorList();
  const { segments } = extractSegmentsFromOpList(opList, { scale: scaleFtPerUnit });
  if (!segments.length) {
    throw new Error('extractStackedFloorPlanFromPdf: no vector path geometry on this page.');
  }
  const textItemsFt = rawItems
    .filter((i) => i.s && i.s.trim())
    .map((i) => ({ s: i.s.trim(), xFt: i.xPt * scaleFtPerUnit, yFt: i.yPt * scaleFtPerUnit }));

  // 3) SPLIT into stacked plan views.
  const vp = (typeof page.getViewport === 'function') ? page.getViewport({ scale: 1 }) : null;
  const pageWidthFt = vp ? vp.width * scaleFtPerUnit : undefined;
  const split = splitStackedPlanViews(segments, textItemsFt, { ...(opts.splitOpts || {}), pageWidthFt });

  // Not stacked -> single-region plan (honest fallback).
  if (!split.isStacked) {
    const plan = buildLevelPlan({ segments, textItemsFt, scaleFtPerUnit, scaleText: scaleInfo.scaleText }, opts);
    plan.scaleSource = scaleInfo.source;
    plan.merged = null;
    plan.stackedSplit = { isStacked: false, note: split.note };
    return plan;
  }

  // 4) Build a LevelPlan per wing (lower = reference frame A, upper = B).
  const lowerView = split.views.find((v) => v.region === 'lower');
  const upperView = split.views.find((v) => v.region === 'upper');
  const buildWing = (view) => buildLevelPlan(
    { segments: view.segments, textItemsFt: view.textItemsFt, scaleFtPerUnit, scaleText: scaleInfo.scaleText },
    opts,
  );
  const wingA = buildWing(lowerView); // lower
  const wingB = buildWing(upperView); // upper
  wingA.scaleSource = scaleInfo.source;
  wingB.scaleSource = scaleInfo.source;

  // 5) REGISTER + MERGE.
  const reg = computeWingRegistration(wingA, wingB, opts.regOpts || {});
  const merged = mergeWingPlans(wingA, wingB, reg, {
    scaleFtPerUnit, scaleText: scaleInfo.scaleText, scaleSource: scaleInfo.source,
  });
  merged.stackedSplit = {
    isStacked: true, splitYFt: split.splitYFt, valleyDepthFrac: split.valleyDepthFrac,
    lowerYRangeFt: lowerView.yRangeFt, upperYRangeFt: upperView.yRangeFt, note: split.note,
  };
  return merged;
}

/**
 * Async. Best-effort SAM reconciliation of ambiguous spaces (fail-soft).
 *
 * Hands the injected invoker a deterministic payload (the plan's low-confidence/unknown room
 * bboxes + a request to confirm their kind). If SAM is unreachable / errors / returns nothing,
 * returns { samUsed:false, reason } WITHOUT throwing and WITHOUT fabricating. When SAM returns
 * space labels, they UPGRADE matching rooms' kind (and bump confidence) — never downgrade real
 * label-derived classifications silently; SAM-sourced kinds are tagged.
 *
 * @param {LevelPlan} plan
 * @param {Function} invoker - async (payload) => result
 * @param {Object} [opts]
 * @returns {Promise<{samUsed:boolean, reason:string, summary?:Object}>}
 */
export async function reconcileWithSam(plan, invoker, opts = {}) {
  if (typeof invoker !== 'function') return { samUsed: false, reason: 'no-invoker' };
  const ambiguous = (plan.rooms || []).filter((r) => r.kind === 'unknown' || r.confidence === 'low');
  if (ambiguous.length === 0) return { samUsed: false, reason: 'no-ambiguous-spaces' };
  let result;
  try {
    result = await invoker({
      task: 'plan-space-segmentation',
      targets: opts.targets || ['parking', 'stair', 'mechanical', 'electrical', 'room'],
      ambiguousBboxesFt: ambiguous.map((r) => r.poly),
      scaleFtPerUnit: plan.scaleFtPerUnit,
    });
  } catch (err) {
    return { samUsed: false, reason: `invoker-threw:${err && err.message ? err.message : err}` };
  }
  if (!result || !Array.isArray(result.spaces) || result.spaces.length === 0) {
    return { samUsed: false, reason: 'sam-returned-no-spaces' };
  }
  // Upgrade matching rooms by centroid containment.
  let upgraded = 0;
  for (const sp of result.spaces) {
    if (!sp || !sp.kind || !Array.isArray(sp.centroidFt)) continue;
    const [sx, sy] = sp.centroidFt;
    for (const r of plan.rooms) {
      const minX = Math.min(...r.poly.map((p) => p[0])), maxX = Math.max(...r.poly.map((p) => p[0]));
      const minY = Math.min(...r.poly.map((p) => p[1])), maxY = Math.max(...r.poly.map((p) => p[1]));
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY && r.kind === 'unknown') {
        r.kind = String(sp.kind);
        r.confidence = 'medium';
        r.kindSource = 'sam-3';
        upgraded += 1;
        break;
      }
    }
  }
  return {
    samUsed: true,
    reason: 'ok',
    summary: { ambiguousCount: ambiguous.length, samSpaces: result.spaces.length, upgraded },
  };
}
