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
  return {
    xs,
    ys,
    labels: {
      cols: uniqOnDatum(colBubbles, xs, 'x'),
      rows: uniqOnDatum(rowBubbles, ys, 'y'),
    },
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
  //    drops the hairline fill + thin grid/dimension annotation.
  const wl = selectWallLayer(segments, opts.layerOpts || {});
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
    walls,
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
    grid: { xs: grid.xs, ys: grid.ys, labels: grid.labels },
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
  const opList = await page.getOperatorList();
  const { segments } = extractSegmentsFromOpList(opList, { scale: scaleFtPerUnit });
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
