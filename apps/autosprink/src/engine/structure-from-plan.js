/**
 * structure-from-plan.js — STRUCTURAL extraction (Stream B) so sprinkler hangers
 * attach to REAL steel/wood members instead of floating in air.
 *
 * GOAL: the plan-comprehension pipeline (plan-extract.js) reads the ARCHITECTURAL sheet
 * and builds walls/rooms/stairs at the scale DERIVED from that sheet. But a hanger must
 * grab a structural member ABOVE the support point — a beam, a joist, or a column cap.
 * This module reads the STRUCTURAL drawings (1881-structurals.pdf) and emits a
 * StructureLayer: columns at grid intersections, beams/joists as member lines, and the
 * structural grid — all REGISTERED to the architectural grid (shared column datums
 * 1..N / A..L) so structure aligns with the arch plan. It exposes nearestMember(point)
 * so the hanger router snaps each support point to the closest beam/joist above it.
 *
 * This is a COMPOSITION LAYER over the proven T28-T35 primitives in pdf-floorplan.js
 * (extractSegmentsFromOpList with full CTM tracking, parseArchitecturalScale,
 * selectWallLayer) and mirrors plan-extract.js (pure core + thin async pdfjs wrapper).
 *
 * WHAT THE 1881 STRUCTURALS ACTUALLY ARE (probed, not assumed):
 *   - OVERALL sheets (S-110 foundation p8, S-120..S-190 framing) are at SCALE 1" = 30'
 *     (each sheet carries its OWN printed scale — DIFFERENT from arch A-101's 3/32"=1'-0";
 *     we read each sheet's notation, never reuse arch's). They carry the GRID + numbered/
 *     lettered column DATUMS (cols 1..40, rows A..K) but member sizes are too small to print.
 *   - ENLARGED AREA sheets (S-111.B/.C foundation, S-150.B/.C..S-190 framing) are at
 *     1/8" = 1'-0" and carry per-location MEMBER tags: HSS steel columns (HSS8X4X5/16,
 *     HSS4x4x1/4, HSS5x5x1/2) and wood/engineered beams (6x12, 2x8, (1)1 3/4x11 7/8 LVL, GLB).
 *   So this is a concrete-podium + wood/steel-framed building. The honest structural model:
 *     COLUMNS sit at GRID INTERSECTIONS (validated by a local dense marker cluster), sized
 *     from the nearest member token; BEAMS/JOISTS are the long member lines spanning between
 *     grid lines, sized from the nearest beam token.
 *
 * HONESTY (hard, fail-closed):
 *   - Scale is DERIVED FROM THE STRUCTURAL SHEET's printed notation. If none is readable AND
 *     no override is given, extraction THROWS rather than guessing or borrowing arch's scale.
 *   - Geometry is REAL (the structural sheet's own vector ops, CTM-mapped to feet).
 *   - Column/beam detection is a BEST-EFFORT geometric+textual approximation, every element
 *     flagged provenance:'extracted ... needs-verification'. NOTHING asserts AHJ / PE /
 *     manufacturer-exact / AutoSprink-parity / fabrication-ready steel.
 *   - Member SIZES are the nearest printed tag (or null) — never invented.
 */

import {
  extractSegmentsFromOpList,
  parseArchitecturalScale,
  selectWallLayer,
} from './pdf-floorplan.js';

const PROVENANCE_BASE =
  'extracted (vector structural PDF, CTM-mapped, scale derived from THIS sheet) — needs-verification; NOT AHJ/PE/fabrication-ready';

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const segMid = (s) => [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];

/**
 * Member-tag vocabulary (probed from the real 1881 area framing sheets). Order: first match
 * wins for `kind`. Each entry captures the SIZE string so the model carries the printed member.
 *  - HSS steel columns:  HSS8X4X5/16, HSS4x4x1/4, HSS5x5x1/2
 *  - AISC wide-flange:   W12x26, W10X22 (rare in this stock but supported)
 *  - engineered beams:   LVL, GLB, PSL, GLULAM (e.g. "(1)1 3/4x11 7/8 LVL")
 *  - dimensioned wood:   6x12, 2x8, 6x8 (sawn lumber beams/joists)
 *  - steel channel/angle: C10, L4x4
 */
const MEMBER_KINDS = Object.freeze([
  { kind: 'steel-hss', role: 'column', re: /\bHSS\s?\d{1,2}\s?[xX]\s?\d{1,2}(?:\s?[xX]\s?\d{1,2}\/?\d{0,2})?\b/i },
  { kind: 'steel-wf', role: 'beam', re: /\bW\d{1,2}\s?[xX]\s?\d{1,3}\b/ },
  { kind: 'steel-channel', role: 'beam', re: /\bC\d{1,2}\s?[xX]\s?\d{1,3}(?:\.\d)?\b/ },
  { kind: 'steel-angle', role: 'brace', re: /\bL\d\s?[xX]\s?\d(?:\s?[xX]\s?\d\/?\d{0,2})?\b/ },
  { kind: 'engineered', role: 'beam', re: /\b(GLB|GLULAM|LVL|PSL)\b/i },
  { kind: 'wood-sawn', role: 'beam', re: /\b\d{1,2}\s?[xX]\s?\d{1,2}\b/ },
]);

/** PURE. Classify a single text token to a member {kind, role, size} or null. */
export function classifyMember(text) {
  const t = String(text || '');
  for (const { kind, role, re } of MEMBER_KINDS) {
    const m = t.match(re);
    if (m) return { kind, role, size: m[0].replace(/\s+/g, '').toUpperCase() };
  }
  return null;
}

/**
 * PURE. Derive feet-per-PDF-unit scale from THIS structural sheet's joined text.
 * Wraps parseArchitecturalScale (reads the printed SCALE notation, e.g. 1" = 30' or
 * 1/8" = 1'-0"). Returns {feetPerUnit, scaleText, source} or null. The structural sheets
 * carry their OWN scale — we NEVER reuse the architectural scale here.
 */
export function deriveScaleFromText(joinedText) {
  const feetPerUnit = parseArchitecturalScale(joinedText);
  if (!Number.isFinite(feetPerUnit) || feetPerUnit <= 0) return null;
  const norm = String(joinedText).replace(/[′‘’´]/g, "'").replace(/[″“”]/g, '"');
  const m = norm.match(/(?:scale\s*:?\s*)?(\d+(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?|\d*\.\d+)\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'/i);
  const scaleText = m ? m[0].replace(/\s+/g, ' ').trim() : `derived feetPerUnit=${round(feetPerUnit)}`;
  return { feetPerUnit, scaleText, source: 'structural-sheet-printed-scale-notation' };
}

/**
 * PURE. Extract the STRUCTURAL grid (numbered column datums -> vertical X lines; lettered
 * row datums -> horizontal Y lines) from text bubbles, in FEET. Same convention as the
 * architectural grid so the two REGISTER on shared datums.
 *
 * minPerDatum drops single-occurrence stray letters/numbers in prose: a REAL grid datum
 * carries a bubble at BOTH ends. Columns are numbered (less prose collision) -> minPerDatum 1;
 * rows are single letters (heavy collision) -> require >= 2.
 *
 * @param {Array<{s:string,xFt:number,yFt:number}>} textItemsFt
 * @returns {{xs:number[], ys:number[], labels:{cols:string[],rows:string[]},
 *            colBubbles:Array, rowBubbles:Array}}
 */
export function extractStructuralGrid(textItemsFt, opts = {}) {
  // Columns are INTEGERS on this stock (1..40). Decimal numerics like "30.8"/"28.1" are
  // DIMENSION callouts, not grid labels — excluding them keeps the grid clean. Letter rows may
  // carry a .n sub-datum (e.g. "L.6"). minBubbles>=2 (a real datum bubbles at BOTH ends) drops
  // stray single note glyphs; tolFt merges the two-ended bubbles of one datum.
  const minBubbles = Number.isFinite(opts.minBubbles) ? opts.minBubbles : 2;
  const tolFt = Number.isFinite(opts.tolFt) ? opts.tolFt : 4;
  const items = Array.isArray(textItemsFt) ? textItemsFt : [];
  const colBubbles = [];
  const rowBubbles = [];
  const numRe = /^\d{1,2}$/;            // INTEGER column labels only (no decimals)
  const letRe = /^[A-Z](?:\.\d)?$/;     // letter rows, optional .n sub-datum
  for (const it of items) {
    const s = String(it.s || '').trim();
    if (numRe.test(s)) colBubbles.push({ label: s, xFt: round(it.xFt), yFt: round(it.yFt) });
    else if (letRe.test(s)) rowBubbles.push({ label: s, xFt: round(it.xFt), yFt: round(it.yFt) });
  }
  // Build authoritative label -> coordinate datums: for each distinct label, take the MEDIAN of
  // its bubble coordinates along the datum axis, but only if it appears >= minBubbles times AND
  // its bubbles are spatially consistent (spread <= tolFt — a true datum's two end-bubbles share
  // the same X for cols / Y for rows). A label whose bubbles are scattered is a coincidental
  // note collision and is dropped. Returns sorted [{label, coord}] pairs (deduped, robust).
  const datumsFor = (bubbles, axis) => {
    const byLabel = new Map();
    for (const b of bubbles) {
      const v = axis === 'x' ? b.xFt : b.yFt;
      let arr = byLabel.get(b.label); if (!arr) { arr = []; byLabel.set(b.label, arr); }
      arr.push(v);
    }
    const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    // For each label, CLUSTER its bubble coordinates (a label may appear on the main plan AND in a
    // key-plan thumbnail / legend / matchline callout — different locations). The MAIN-PLAN datum
    // is the cluster with the MOST bubbles (the two end-bubbles of the real grid line at the SAME
    // coord; key-plan copies are isolated singletons). Pick that cluster's median; require it to
    // hold >= minBubbles. This keeps rows A..L even when each also has a stray key-plan bubble.
    const out = [];
    for (const [label, vals] of byLabel) {
      const sorted = [...vals].sort((a, b) => a - b);
      const clusters = [];
      for (const v of sorted) {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(v - last.vals[last.vals.length - 1]) <= tolFt) last.vals.push(v);
        else clusters.push({ vals: [v] });
      }
      // densest cluster (ties -> the one with the tightest spread).
      clusters.sort((a, b) => b.vals.length - a.vals.length
        || ((a.vals[a.vals.length - 1] - a.vals[0]) - (b.vals[b.vals.length - 1] - b.vals[0])));
      const best = clusters[0];
      if (!best || best.vals.length < minBubbles) continue;
      // Record the ORTHOGONAL positions of this datum's chosen bubbles (for the plan-body gate):
      // a real grid datum spans the plan (col bubbles at top+bottom -> wide Y; row bubbles at
      // left+right -> wide X). The median orthogonal position locates the datum's bubbles.
      const chosen = best.vals;
      const within = (b) => { const v = axis === 'x' ? b.xFt : b.yFt; return chosen.some((c) => Math.abs(c - v) <= tolFt); };
      const orth = bubbles.filter((b) => b.label === label && within(b)).map((b) => (axis === 'x' ? b.yFt : b.xFt));
      out.push({ label, coord: round(median(best.vals)), orthMed: orth.length ? median(orth) : null, orthVals: orth });
    }
    out.sort((a, b) => a.coord - b.coord);
    return out;
  };
  let colDatums = datumsFor(colBubbles, 'x'); // {label, coord=xFt, orthMed=yFt-of-bubbles}
  let rowDatums = datumsFor(rowBubbles, 'y'); // {label, coord=yFt, orthMed=xFt-of-bubbles}

  // PLAN-BODY CROSS-GATE (drops legend/key-plan/title-block datums): the real grid is the dense
  // rectangle where column datums and row datums INTERSECT. Column bubbles sit at the plan's TOP
  // and BOTTOM Y; row bubbles sit at the plan's LEFT and RIGHT X. So the plan-body X-range is the
  // span of column datum coords, and its Y-range is the span of row datum coords. A legitimate
  // ROW datum's bubbles (orthMed = X) must fall within the column-datum X-range (±margin); a
  // legitimate COLUMN datum's bubbles (orthMed = Y) must fall within the row-datum Y-range. A
  // stray "S" note in the legend, or a key-plan thumbnail bubble, sits OUTSIDE this rectangle and
  // is dropped. Deterministic; uses ONLY the datums themselves (no tuned pixel band).
  if (colDatums.length >= 2 && rowDatums.length >= 2) {
    const span = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr) });
    const colX = span(colDatums.map((d) => d.coord));
    const rowY = span(rowDatums.map((d) => d.coord));
    const margin = Number.isFinite(opts.bodyMarginFt) ? opts.bodyMarginFt : 12;
    const inX = (v) => v != null && v >= colX.min - margin && v <= colX.max + margin;
    const inY = (v) => v != null && v >= rowY.min - margin && v <= rowY.max + margin;
    // Keep rows whose bubbles' X sits inside the column span; keep cols whose bubbles' Y sits
    // inside the row span. Only apply when it doesn't annihilate the grid (need >= 2 survivors).
    const rowKeep = rowDatums.filter((d) => inX(d.orthMed));
    const colKeep = colDatums.filter((d) => inY(d.orthMed));
    if (rowKeep.length >= 2) rowDatums = rowKeep;
    if (colKeep.length >= 2) colDatums = colKeep;
  }

  // ISOLATION GATE: a real grid is a sequence of datums with roughly REGULAR spacing. A stray
  // legend/note datum (e.g. an "S" symbol-key letter far below row L) sits ISOLATED — its gap to
  // the nearest surviving datum is many times the typical bay. Drop any END datum whose gap to its
  // single neighbor exceeds isolationFactor × the median interior gap. Interior datums are kept
  // (a real grid can have an irregular bay; only the isolated extremes are pruned). Deterministic.
  const dropIsolatedEnds = (datums) => {
    if (datums.length < 4) return datums;
    const coords = datums.map((d) => d.coord);
    const gaps = [];
    for (let i = 1; i < coords.length; i++) gaps.push(coords[i] - coords[i - 1]);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medGap = sortedGaps[Math.floor(sortedGaps.length / 2)] || 1;
    const isolationFactor = Number.isFinite(opts.isolationFactor) ? opts.isolationFactor : 3;
    let lo = 0, hi = datums.length - 1;
    while (hi - lo >= 3 && (coords[lo + 1] - coords[lo]) > isolationFactor * medGap) lo += 1;
    while (hi - lo >= 3 && (coords[hi] - coords[hi - 1]) > isolationFactor * medGap) hi -= 1;
    return datums.slice(lo, hi + 1);
  };
  colDatums = dropIsolatedEnds(colDatums);
  rowDatums = dropIsolatedEnds(rowDatums);
  // Strip the internal orth fields from the public datums.
  colDatums = colDatums.map((d) => ({ label: d.label, coord: d.coord }));
  rowDatums = rowDatums.map((d) => ({ label: d.label, coord: d.coord }));
  return {
    xs: colDatums.map((d) => d.coord),
    ys: rowDatums.map((d) => d.coord),
    labels: { cols: colDatums.map((d) => d.label), rows: rowDatums.map((d) => d.label) },
    colDatums,
    rowDatums,
    colBubbles,
    rowBubbles,
  };
}

/**
 * PURE. Parse all MEMBER tags from the sheet text into positioned member tokens.
 * @param {Array<{s:string,xFt:number,yFt:number}>} textItemsFt
 * @returns {{members:Array<{size:string,kind:string,role:string,xFt:number,yFt:number,raw:string}>,
 *            byRole:{column:number,beam:number,brace:number}}}
 */
export function parseMemberTags(textItemsFt) {
  const items = Array.isArray(textItemsFt) ? textItemsFt : [];
  const members = [];
  for (const it of items) {
    const c = classifyMember(it.s);
    if (!c) continue;
    members.push({ size: c.size, kind: c.kind, role: c.role, xFt: round(it.xFt), yFt: round(it.yFt), raw: String(it.s).trim() });
  }
  const byRole = members.reduce((a, m) => { a[m.role] = (a[m.role] || 0) + 1; return a; }, {});
  return { members, byRole };
}

/**
 * PURE. Detect real column-marker clusters from short local linework only.
 *
 * A structural column is drawn as a small filled/hatched marker (a box, I-shape, or HSS
 * rectangle). We detect those blobs FIRST from the sheet's own short linework so later stages
 * only emit one column per real marker, never one per bare grid crossing.
 *
 * @param {Array<{x1,y1,x2,y2}>} segments
 * @param {Object} [opts]
 * @returns {{markers:Array<{x:number,y:number,markerSegs:number,bbox:{minX:number,minY:number,maxX:number,maxY:number}}>, note:string}}
 */
export function detectColumnMarkers(segments, opts = {}) {
  const markerRadiusFt = Number.isFinite(opts.markerRadiusFt) ? opts.markerRadiusFt : 2.5;
  const markerMaxLenFt = Number.isFinite(opts.markerMaxLenFt) ? opts.markerMaxLenFt : 3;
  const minMarkerSegs = Number.isFinite(opts.minMarkerSegs) ? opts.minMarkerSegs : 4;
  const note =
    'Column markers are emitted ONLY from dense clusters of short local linework (real ink), ' +
    'never from bare grid intersections.';

  const segs = (Array.isArray(segments) ? segments : []).filter((s) => segLen(s) <= markerMaxLenFt);
  if (!segs.length) return { markers: [], note };

  const clusters = [];
  for (const s of segs) {
    const [mx, my] = segMid(s);
    let best = null;
    let bestDist = Infinity;
    for (const cluster of clusters) {
      const d = Math.hypot(cluster.sumX / cluster.segCount - mx, cluster.sumY / cluster.segCount - my);
      if (d <= markerRadiusFt && d < bestDist) {
        best = cluster;
        bestDist = d;
      }
    }
    if (!best) {
      clusters.push({
        sumX: mx,
        sumY: my,
        segCount: 1,
        minX: mx,
        minY: my,
        maxX: mx,
        maxY: my,
      });
      continue;
    }
    best.sumX += mx;
    best.sumY += my;
    best.segCount += 1;
    best.minX = Math.min(best.minX, mx);
    best.minY = Math.min(best.minY, my);
    best.maxX = Math.max(best.maxX, mx);
    best.maxY = Math.max(best.maxY, my);
  }

  const markers = clusters
    .filter((cluster) => cluster.segCount >= minMarkerSegs)
    .map((cluster) => ({
      x: round(cluster.sumX / cluster.segCount),
      y: round(cluster.sumY / cluster.segCount),
      markerSegs: cluster.segCount,
      bbox: {
        minX: round(cluster.minX),
        minY: round(cluster.minY),
        maxX: round(cluster.maxX),
        maxY: round(cluster.maxY),
      },
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  return { markers, note };
}

/**
 * PURE. Detect COLUMNS from real marker clusters, then snap those real markers to nearby grid
 * labels when available. No marker means no column.
 *
 * @param {{xs:number[], ys:number[]}} grid - structural grid datums in FEET.
 * @param {Array<{x1,y1,x2,y2}>} segments - ALL segments in FEET (for marker density).
 * @param {Array<{size,kind,role,xFt,yFt}>} members - parsed member tokens (FEET).
 * @param {Object} [opts]
 * @returns {{columns:Array<{x,y,grid:{col,row},size:string|null,kind:string|null,markerSegs:number,confidence:string}>, note:string}}
 */
export function detectColumns(grid, segments, members = [], opts = {}) {
  const tagRadiusFt = Number.isFinite(opts.tagRadiusFt) ? opts.tagRadiusFt : 8;
  const snapRadiusFt = Number.isFinite(opts.snapRadiusFt)
    ? opts.snapRadiusFt
    : (Number.isFinite(opts.markerRadiusFt) ? opts.markerRadiusFt : 2.5);
  const note =
    'Columns come only from real dense marker clusters, then inherit nearby grid labels when ' +
    'available. Sized from the nearest member token (role column). Best-effort, deterministic; ' +
    'NOT verified, NOT AHJ/PE/fabrication-ready.';

  const xs = (grid && Array.isArray(grid.xs)) ? grid.xs : [];
  const ys = (grid && Array.isArray(grid.ys)) ? grid.ys : [];
  const colLabels = (grid && grid.labels && Array.isArray(grid.labels.cols)) ? grid.labels.cols : [];
  const rowLabels = (grid && grid.labels && Array.isArray(grid.labels.rows)) ? grid.labels.rows : [];
  const { markers } = detectColumnMarkers(segments, opts);
  if (!markers.length) return { columns: [], note };

  const colMembers = members.filter((m) => m.role === 'column');
  const anyMembers = members;
  const nearestDatum = (coord, datums, labels, fallbackFactory) => {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < datums.length; i++) {
      const d = Math.abs(datums[i] - coord);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestDist > snapRadiusFt) return fallbackFactory(coord);
    return labels[bestIdx] || fallbackFactory(datums[bestIdx]);
  };
  const pick = (x, y, pool) => {
    let best = null;
    let bd = Infinity;
    for (const m of pool) {
      const d = Math.hypot(m.xFt - x, m.yFt - y);
      if (d < bd && d <= tagRadiusFt) {
        bd = d;
        best = m;
      }
    }
    return best;
  };

  const columns = markers.map((marker) => {
    const tag = pick(marker.x, marker.y, colMembers) || pick(marker.x, marker.y, anyMembers);
    return {
      x: marker.x,
      y: marker.y,
      grid: {
        col: nearestDatum(marker.x, xs, colLabels, (v) => String(round(v))),
        row: nearestDatum(marker.y, ys, rowLabels, (v) => String(round(v))),
      },
      size: tag ? tag.size : null,
      kind: tag ? tag.kind : null,
      markerSegs: marker.markerSegs,
      confidence: tag ? 'medium' : 'low',
    };
  });
  return { columns, note };
}

/**
 * PURE. Detect BEAMS / JOISTS as long axis-aligned member lines, each tagged by the nearest
 * beam member token. Beams span between grid lines; we keep long, near-axis-aligned segments
 * (drops grid lines themselves by requiring the segment NOT to lie exactly on a single grid
 * datum end-to-end is impractical, so we instead keep the heavier structural lineweight band
 * via selectWallLayer-style filtering done by the caller; here we filter by length + axis).
 *
 * @param {Array<{x1,y1,x2,y2,lineWidth?}>} segments - segments in FEET (structural framing layer).
 * @param {Array<{size,kind,role,xFt,yFt}>} members - parsed member tokens (FEET).
 * @param {{xs:number[],ys:number[]}} grid
 * @param {Object} [opts]
 * @returns {{beams:Array<{a:[number,number],b:[number,number],lengthFt:number,member:string|null,kind:string|null,axis:'h'|'v'|'d',confidence:string}>, joists:Array, note:string}}
 */
export function detectBeams(segments, members = [], grid = {}, opts = {}) {
  const minBeamFt = Number.isFinite(opts.minBeamFt) ? opts.minBeamFt : 8;
  const axisTolDeg = Number.isFinite(opts.axisTolDeg) ? opts.axisTolDeg : 6;
  const joistMaxFt = Number.isFinite(opts.joistMaxFt) ? opts.joistMaxFt : 30;
  const tagRadiusFt = Number.isFinite(opts.tagRadiusFt) ? opts.tagRadiusFt : 12;
  const gridSnapFt = Number.isFinite(opts.gridSnapFt) ? opts.gridSnapFt : 1.5;
  const axisTol = Math.tan((axisTolDeg * Math.PI) / 180);
  const note =
    'Beams/joists = long near-axis-aligned member lines (>= minBeamFt) WITHIN the plan-body bbox ' +
    '(the grid extent ± margin), which excludes legend/key-plan/title-block linework. Lines lying ' +
    'ON a grid datum are dropped (those are grid lines, not members). Each tagged by nearest beam ' +
    'token. Best-effort, deterministic; NOT verified, NOT AHJ/PE/fabrication-ready.';

  const xs = (grid && Array.isArray(grid.xs)) ? grid.xs : [];
  const ys = (grid && Array.isArray(grid.ys)) ? grid.ys : [];
  // PLAN-BODY BBOX (from the grid extent + margin): real framing lives inside the grid; the
  // legend, key-plan thumbnail and title block sit OUTSIDE it. Clip members to this box so we
  // don't emit legend symbol lines as joists. Skipped (no clip) when the grid is too small.
  const bodyMarginFt = Number.isFinite(opts.bodyMarginFt) ? opts.bodyMarginFt : 12;
  const haveBody = xs.length >= 2 && ys.length >= 2;
  const bMinX = haveBody ? Math.min(...xs) - bodyMarginFt : -Infinity;
  const bMaxX = haveBody ? Math.max(...xs) + bodyMarginFt : Infinity;
  const bMinY = haveBody ? Math.min(...ys) - bodyMarginFt : -Infinity;
  const bMaxY = haveBody ? Math.max(...ys) + bodyMarginFt : Infinity;
  const inBody = (s) => {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    return mx >= bMinX && mx <= bMaxX && my >= bMinY && my <= bMaxY;
  };
  const onGridLine = (s) => {
    const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1);
    if (dx <= 1e-6) { // vertical: drop if x sits on a column datum
      return xs.some((g) => Math.abs(s.x1 - g) <= gridSnapFt);
    }
    if (dy <= 1e-6) { // horizontal: drop if y sits on a row datum
      return ys.some((g) => Math.abs(s.y1 - g) <= gridSnapFt);
    }
    return false;
  };
  const isAxis = (s) => {
    const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1);
    if (dx === 0 || dy === 0) return true;
    return dy / dx <= axisTol || dx / dy <= axisTol;
  };
  const beamMembers = members.filter((m) => m.role === 'beam');
  const anyMembers = members;
  const pick = (mx, my, pool) => {
    let best = null, bd = Infinity;
    for (const m of pool) {
      const d = Math.hypot(m.xFt - mx, m.yFt - my);
      if (d < bd && d <= tagRadiusFt) { bd = d; best = m; }
    }
    return best;
  };

  const beams = [];
  const joists = [];
  for (const s of (Array.isArray(segments) ? segments : [])) {
    const len = segLen(s);
    if (len < minBeamFt) continue;
    if (!isAxis(s)) continue;
    if (!inBody(s)) continue; // outside the grid extent -> legend/key-plan/title-block line
    if (onGridLine(s)) continue; // a grid datum line, not a member
    const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1);
    const axis = dy <= 1e-6 || dx / Math.max(dy, 1e-9) > 1 ? 'h' : 'v';
    const [mx, my] = segMid(s);
    const tag = pick(mx, my, beamMembers) || pick(mx, my, anyMembers);
    const rec = {
      a: [round(s.x1), round(s.y1)], b: [round(s.x2), round(s.y2)],
      lengthFt: round(len), member: tag ? tag.size : null, kind: tag ? tag.kind : null,
      axis, confidence: tag ? 'medium' : 'low',
    };
    // Heuristic split: short closely-spaced parallel runs read as JOISTS; longer single spans
    // read as BEAMS. Without per-line spacing analysis here, classify by length only (flagged):
    // <= joistMaxFt with a wood/engineered tag (or no tag) => joist; else beam.
    const isJoistTag = !tag || tag.kind === 'wood-sawn' || tag.kind === 'engineered';
    if (len <= joistMaxFt && isJoistTag) joists.push(rec); else beams.push(rec);
  }
  // Deterministic order.
  const ord = (a, b) => a.a[0] - b.a[0] || a.a[1] - b.a[1];
  beams.sort(ord); joists.sort(ord);
  return { beams, joists, note };
}

/**
 * PURE. Build a StructureLayer from already-extracted segments + text (the unit-testable heart).
 *
 * Registration to the architectural grid: pass opts.archGrid = {xs, ys} (the arch LevelPlan's
 * grid in FEET) and opts.gridAlign = true to compute the rigid (translation) offset that best
 * maps the structural grid onto the architectural grid on shared datums, then apply it to ALL
 * structural geometry so columns/beams sit under the arch walls. Honest: only a translation is
 * applied (shared datums imply same orientation + scale once each sheet's own scale is used);
 * the residual alignment error is reported (gridMatch.medianErrFt) and flagged.
 *
 * @param {Object} input
 * @param {Array<{x1,y1,x2,y2,lineWidth?,strokeColor?}>} input.segments - all segments in FEET.
 * @param {Array<{s:string,xFt:number,yFt:number}>} input.textItemsFt
 * @param {number} input.scaleFtPerUnit
 * @param {string} input.scaleText
 * @param {Object} [opts]
 * @returns {StructureLayer}
 */
export function buildStructureLayer(input, opts = {}) {
  const { segments, textItemsFt, scaleFtPerUnit, scaleText } = input;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('buildStructureLayer: no segments — extract structural geometry first (never fabricate)');
  }
  if (!Number.isFinite(scaleFtPerUnit) || scaleFtPerUnit <= 0) {
    throw new Error('buildStructureLayer: scaleFtPerUnit must be derived from THIS structural sheet (never hardcoded/borrowed)');
  }

  // 1) GRID from structural bubbles.
  const grid = extractStructuralGrid(textItemsFt || []);

  // 2) MEMBER TAGS.
  const { members, byRole } = parseMemberTags(textItemsFt || []);

  // 3) FRAMING LAYER: the heavier-lineweight band (beams/columns), dropping hairline hatch +
  //    thin grid/dimension annotation. Fall back to all segments if the layer split is weak.
  const wl = selectWallLayer(segments, opts.layerOpts || {});
  const framingSegs = wl.wallSegments.length >= 3 ? wl.wallSegments : segments;

  // 4) COLUMNS from real marker clusters (use FULL segments for marker density — markers are thin).
  const colRes = detectColumns(grid, segments, members, opts.columnOpts || {});

  // 5) BEAMS / JOISTS from the framing layer.
  const beamRes = detectBeams(framingSegs, members, grid, opts.beamOpts || {});

  // 6) REGISTER to the architectural grid (rigid translation on shared datums), if requested.
  let gridMatch = null;
  let offset = { dx: 0, dy: 0 };
  const archGrid = opts.archGrid;
  if (opts.gridAlign && archGrid && Array.isArray(archGrid.xs) && Array.isArray(archGrid.ys)) {
    const matched = matchGridOffset(grid, archGrid, opts.gridMatchOpts || {});
    if (matched) {
      offset = { dx: matched.dx, dy: matched.dy };
      gridMatch = matched;
    } else {
      gridMatch = { matchedCols: 0, matchedRows: 0, dx: 0, dy: 0, medianErrFt: null,
        note: 'no shared datums matched — structure left in its own sheet frame (needs-verification)' };
    }
  }

  // Apply the rigid offset to every emitted coordinate (columns, beams, joists, grid).
  const shiftXY = (x, y) => [round(x + offset.dx), round(y + offset.dy)];
  const columns = colRes.columns.map((c) => {
    const [x, y] = shiftXY(c.x, c.y);
    return { ...c, x, y };
  });
  const beams = beamRes.beams.map((b) => ({ ...b, a: shiftXY(b.a[0], b.a[1]), b: shiftXY(b.b[0], b.b[1]) }));
  const joists = beamRes.joists.map((j) => ({ ...j, a: shiftXY(j.a[0], j.a[1]), b: shiftXY(j.b[0], j.b[1]) }));
  const shiftedGrid = {
    xs: grid.xs.map((x) => round(x + offset.dx)),
    ys: grid.ys.map((y) => round(y + offset.dy)),
    labels: grid.labels,
  };

  const layer = {
    scaleFtPerUnit: round(scaleFtPerUnit),
    scaleText: scaleText || `feetPerUnit=${round(scaleFtPerUnit)}`,
    grid: shiftedGrid,
    columns,
    beams,
    joists,
    members: members.map((m) => ({ size: m.size, kind: m.kind, role: m.role, xFt: round(m.xFt + offset.dx), yFt: round(m.yFt + offset.dy), raw: m.raw })),
    gridMatch,
    registrationOffsetFt: offset,
    counts: {
      segments: segments.length,
      framingSegments: framingSegs.length,
      columns: columns.length,
      beams: beams.length,
      joists: joists.length,
      memberTags: members.length,
      gridCols: shiftedGrid.xs.length,
      gridRows: shiftedGrid.ys.length,
    },
    memberRoles: byRole,
    framingLayer: { method: wl.method, chosen: wl.chosen },
    provenance: PROVENANCE_BASE,
    needsVerification: true,
    notes: { columns: colRes.note, beams: beamRes.note },
  };

  // Attach the nearestMember helper bound to THIS layer's beams + joists.
  layer.nearestMember = (point) => nearestMember(layer, point);
  return layer;
}

/**
 * PURE. Compute the rigid TRANSLATION offset that maps the structural grid onto the
 * architectural grid using shared LABELED datums. Returns {dx,dy,matchedCols,matchedRows,
 * medianErrFt,...} or null when too few shared datums.
 *
 * Both grids carry labels (cols numbers, rows letters). For each label present in BOTH, the
 * structural datum coordinate minus the architectural datum coordinate is one offset sample;
 * the MEDIAN sample is the robust rigid offset (resistant to a stray mislabeled bubble). The
 * residual (after applying the offset) median error is reported and flagged.
 */
export function matchGridOffset(structGrid, archGrid, opts = {}) {
  const minMatches = Number.isFinite(opts.minMatches) ? opts.minMatches : 2;
  // Prefer the clean label->coord datum pairs (index-aligned, deduped) when present; fall back to
  // zipping labels with xs/ys for grids built by the older extractGrid (arch side).
  const colMapOf = (g, xs) => (Array.isArray(g.colDatums) && g.colDatums.length)
    ? new Map(g.colDatums.map((d) => [String(d.label), d.coord]))
    : labelMap(g.labels && g.labels.cols, xs);
  const rowMapOf = (g, ys) => (Array.isArray(g.rowDatums) && g.rowDatums.length)
    ? new Map(g.rowDatums.map((d) => [String(d.label), d.coord]))
    : labelMap(g.labels && g.labels.rows, ys);
  const sCols = colMapOf(structGrid, structGrid.xs);
  const aCols = colMapOf(archGrid, archGrid.xs);
  const sRows = rowMapOf(structGrid, structGrid.ys);
  const aRows = rowMapOf(archGrid, archGrid.ys);

  const median = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  // ROBUST translation per axis: gather (arch - struct) samples, take the median, then DROP
  // samples more than outlierTolFt from the median (a mislabeled bubble or a non-translation
  // datum) and re-median on the inliers. This keeps the fit honest when one shared label is noise.
  const outlierTolFt = Number.isFinite(opts.outlierTolFt) ? opts.outlierTolFt : 4;
  const robust = (samples) => {
    if (!samples.length) return { value: 0, inliers: [] };
    const m0 = median(samples);
    const inliers = samples.filter((v) => Math.abs(v - m0) <= outlierTolFt);
    return { value: inliers.length ? median(inliers) : m0, inliers };
  };
  const dxSamples = [];
  for (const [lab, sv] of sCols) { if (aCols.has(lab)) dxSamples.push(aCols.get(lab) - sv); }
  const dySamples = [];
  for (const [lab, sv] of sRows) { if (aRows.has(lab)) dySamples.push(aRows.get(lab) - sv); }

  const rX = robust(dxSamples);
  const rY = robust(dySamples);
  const dxs = rX.inliers, dys = rY.inliers;
  if (dxs.length + dys.length < minMatches) return null;
  const dx = dxs.length ? rX.value : 0;
  const dy = dys.length ? rY.value : 0;
  // Residual error: only over INLIER matched datums after the offset (honest fit quality).
  const errs = [];
  for (const [lab, sv] of sCols) { if (aCols.has(lab)) { const e = Math.abs(sv + dx - aCols.get(lab)); if (e <= outlierTolFt) errs.push(e); } }
  for (const [lab, sv] of sRows) { if (aRows.has(lab)) { const e = Math.abs(sv + dy - aRows.get(lab)); if (e <= outlierTolFt) errs.push(e); } }
  return {
    dx: round(dx), dy: round(dy),
    matchedCols: dxs.length, matchedRows: dys.length,
    medianErrFt: round(median(errs)),
    sharedColLabels: [...sCols.keys()].filter((l) => aCols.has(l)),
    sharedRowLabels: [...sRows.keys()].filter((l) => aRows.has(l)),
    note: 'rigid translation on shared LABELED grid datums (median offset). Same scale/orientation ' +
      'assumed because each sheet was read at its OWN derived scale. needs-verification.',
  };
}

function labelMap(labels, coords) {
  const m = new Map();
  const L = Array.isArray(labels) ? labels : [];
  const C = Array.isArray(coords) ? coords : [];
  for (let i = 0; i < Math.min(L.length, C.length); i++) m.set(String(L[i]), C[i]);
  return m;
}

/**
 * PURE. nearestMember(layer, point) — KEY HANGER HELPER.
 *
 * Returns the structural member (beam or joist) whose line is CLOSEST to the support point,
 * with the perpendicular distance and the snap point ON the member where the hanger attaches.
 * Hangers grab the member ABOVE the support, so this gives the router the exact attach point
 * and the member size to size the hanger. Columns are also searched (a hanger near a column
 * cap may attach to the column). Returns null when no member exists.
 *
 * @param {StructureLayer} layer
 * @param {[number,number]|{x:number,y:number}} point - in FEET (same registered frame as the layer).
 * @returns {{type:'beam'|'joist'|'column', distanceFt:number, snapFt:[number,number], member:string|null, kind:string|null, ref:Object}|null}
 */
export function nearestMember(layer, point) {
  if (!layer) return null;
  const p = Array.isArray(point) ? { x: point[0], y: point[1] } : (point || {});
  const px = Number(p.x), py = Number(p.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

  let best = null;
  const consider = (type, ref) => {
    if (type === 'column') {
      const d = Math.hypot(ref.x - px, ref.y - py);
      if (!best || d < best.distanceFt) {
        best = { type, distanceFt: round(d), snapFt: [round(ref.x), round(ref.y)], member: ref.size || null, kind: ref.kind || null, ref };
      }
      return;
    }
    // beam/joist: perpendicular distance to the segment + the foot of the perpendicular.
    const ax = ref.a[0], ay = ref.a[1], bx = ref.b[0], by = ref.b[1];
    const vx = bx - ax, vy = by - ay;
    const L2 = vx * vx + vy * vy;
    let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const sx = ax + t * vx, sy = ay + t * vy;
    const d = Math.hypot(sx - px, sy - py);
    if (!best || d < best.distanceFt) {
      best = { type, distanceFt: round(d), snapFt: [round(sx), round(sy)], member: ref.member || null, kind: ref.kind || null, ref };
    }
  };
  for (const b of (layer.beams || [])) consider('beam', b);
  for (const j of (layer.joists || [])) consider('joist', j);
  for (const c of (layer.columns || [])) consider('column', c);
  return best;
}

/**
 * Async. Extract a StructureLayer directly from a vector structural PDF page.
 *
 * Reads THIS sheet's printed scale (never reuses arch's), CTM-maps the vector geometry to feet,
 * parses grid + member tags, detects columns/beams/joists, and (optionally) registers to a
 * supplied architectural grid. THROWS if no scale is readable and none supplied (never guesses).
 *
 * @param {Object} page - a pdfjs page (doc.getPage(n)).
 * @param {Object} [opts]
 *   opts.scaleFtPerUnit — override (flagged); default DERIVED from this sheet's text.
 *   opts.archGrid + opts.gridAlign — register structure onto the architectural grid.
 * @returns {Promise<StructureLayer>}
 */
export async function extractStructureLayerFromPdf(page, opts = {}) {
  if (!page || typeof page.getOperatorList !== 'function' || typeof page.getTextContent !== 'function') {
    throw new Error('extractStructureLayerFromPdf: a pdfjs page (getOperatorList + getTextContent) is required');
  }
  const tc = await page.getTextContent();
  const rawItems = (tc.items || []).map((it) => ({ s: it.str, xPt: it.transform[4], yPt: it.transform[5] }));
  const joined = rawItems.map((i) => i.s).join(' ');

  let scaleInfo = deriveScaleFromText(joined);
  if (opts.scaleFtPerUnit && Number(opts.scaleFtPerUnit) > 0) {
    scaleInfo = {
      feetPerUnit: Number(opts.scaleFtPerUnit),
      scaleText: scaleInfo ? scaleInfo.scaleText : `operator-supplied feetPerUnit=${opts.scaleFtPerUnit}`,
      source: scaleInfo ? 'structural-sheet-printed-scale-notation(+override)' : 'operator-supplied-override',
    };
  }
  if (!scaleInfo) {
    throw new Error(
      'extractStructureLayerFromPdf: no printed SCALE notation on this structural sheet and no ' +
      'scaleFtPerUnit override — the scale is DERIVED FROM THE STRUCTURAL DRAWING and is never ' +
      'guessed (and never borrowed from the architectural sheet). Provide opts.scaleFtPerUnit ' +
      'or use a sheet with a readable scale.',
    );
  }
  const scaleFtPerUnit = scaleInfo.feetPerUnit;

  const opList = await page.getOperatorList();
  const { segments } = extractSegmentsFromOpList(opList, { scale: scaleFtPerUnit });
  if (!segments.length) {
    throw new Error('extractStructureLayerFromPdf: no vector path geometry on this page (raster/scanned or text-only).');
  }
  const textItemsFt = rawItems
    .filter((i) => i.s && i.s.trim())
    .map((i) => ({ s: i.s.trim(), xFt: i.xPt * scaleFtPerUnit, yFt: i.yPt * scaleFtPerUnit }));

  const layer = buildStructureLayer(
    { segments, textItemsFt, scaleFtPerUnit, scaleText: scaleInfo.scaleText },
    opts,
  );
  layer.scaleSource = scaleInfo.source;
  return layer;
}

// ---------------------------------------------------------------------------
// 3D BUILDER — extrude columns + beams/joists at the framing elevation.
// ---------------------------------------------------------------------------

const COLUMN_COLOR = 0x9fb3c8;
const BEAM_COLOR = 0xc05a3a;   // steel/wood beam (rusty)
const JOIST_COLOR = 0xb08968;  // wood joist (tan)

/** Parse a member size string into an approximate {widthFt, depthFt} for extrusion (best-effort). */
function memberDims(size, fallbackW, fallbackD) {
  const s = String(size || '');
  // HSS8X4X5/16 -> 8 x 4 inches; 6x12 -> 6 x 12 inches; W12X26 -> ~12in deep (depth from first num).
  const hss = s.match(/HSS(\d{1,2})X(\d{1,2})/i);
  if (hss) return { widthFt: (+hss[2]) / 12, depthFt: (+hss[1]) / 12 };
  const wf = s.match(/^W(\d{1,2})X/i);
  if (wf) return { widthFt: (+wf[1]) / 12 * 0.6, depthFt: (+wf[1]) / 12 };
  const dim = s.match(/^(\d{1,2})X(\d{1,2})/i);
  if (dim) return { widthFt: (+dim[1]) / 12, depthFt: (+dim[2]) / 12 };
  return { widthFt: fallbackW, depthFt: fallbackD };
}

/**
 * Build a THREE.Group of the structural layer (columns extruded up to the framing elevation,
 * beams/joists as boxes AT the ceiling elevation). THREE is dependency-injected (testable with
 * a stub). Geometry is centered on `bounds.cx/cy` (the SAME union footprint center the
 * architectural building uses) so structure aligns with the arch model in the same scene.
 *
 * @param {Object} THREE
 * @param {StructureLayer} layer
 * @param {{cx:number,cy:number}} bounds - shared world origin in plan feet (unionFootprintCenter).
 * @param {Object} [opts] - storyHeightFt (column height, default 10), ceilingElevFt (beam Y, default 9),
 *   columnSizeFt (fallback square, 1), beamWidthFt (0.5), beamDepthFt (1), joistDepthFt (0.66).
 * @returns {{root, counts, summary}}
 */
export function buildStructure3D(THREE, layer, bounds, opts = {}) {
  if (!THREE || !THREE.Group) throw new Error('buildStructure3D: THREE namespace is required');
  if (!layer) throw new Error('buildStructure3D: a StructureLayer is required (no layer -> no structure; never fabricate)');
  const cx = Number(bounds && bounds.cx) || 0;
  const cy = Number(bounds && bounds.cy) || 0;
  const {
    storyHeightFt = 10,
    ceilingElevFt = 9,
    columnSizeFt = 1,
    beamWidthFt = 0.5,
    beamDepthFt = 1,
    joistDepthFt = 0.66,
  } = opts;

  const root = new THREE.Group();
  root.name = 'structure-from-plan';
  root.userData = { kind: 'structure-from-plan', needsVerification: true, provenance: layer.provenance };

  const stdMat = (color, opacity) => (THREE.MeshStandardMaterial
    ? new THREE.MeshStandardMaterial({ color, transparent: true, opacity, metalness: 0.2, roughness: 0.7 })
    : (THREE.MeshBasicMaterial ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity }) : null));
  const colMat = stdMat(COLUMN_COLOR, 0.85);
  const beamMat = stdMat(BEAM_COLOR, 0.8);
  const joistMat = stdMat(JOIST_COLOR, 0.7);

  let columnCount = 0, beamCount = 0, joistCount = 0;

  // COLUMNS: vertical boxes from floor (0) up to the story height, centered on each grid pt.
  if (THREE.BoxGeometry) {
    for (const c of (layer.columns || [])) {
      const dims = memberDims(c.size, columnSizeFt, columnSizeFt);
      const geo = new THREE.BoxGeometry(dims.widthFt, storyHeightFt, dims.depthFt);
      const mesh = new THREE.Mesh(geo, colMat);
      mesh.position.set(c.x - cx, storyHeightFt / 2, c.y - cy);
      mesh.name = `column:${c.grid.col}-${c.grid.row}`;
      mesh.userData = { kind: 'structure-column', grid: c.grid, size: c.size, confidence: c.confidence, needsVerification: true };
      root.add(mesh); columnCount += 1;
    }
  }

  // BEAMS / JOISTS: horizontal boxes at the ceiling elevation along each member line.
  const addLine = (rec, mat, depthFt, name, kindTag) => {
    const ax = rec.a[0] - cx, az = rec.a[1] - cy;
    const bx = rec.b[0] - cx, bz = rec.b[1] - cy;
    const len = Math.hypot(bx - ax, bz - az);
    if (!(len > 0.01) || !THREE.BoxGeometry) return false;
    const dims = memberDims(rec.member, beamWidthFt, depthFt);
    const geo = new THREE.BoxGeometry(len, dims.depthFt, dims.widthFt);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((ax + bx) / 2, ceilingElevFt + dims.depthFt / 2, (az + bz) / 2);
    mesh.rotation.y = -Math.atan2(bz - az, bx - ax);
    mesh.name = name;
    mesh.userData = { kind: kindTag, member: rec.member, memberKind: rec.kind, lengthFt: rec.lengthFt, confidence: rec.confidence, needsVerification: true };
    root.add(mesh);
    return true;
  };
  for (const b of (layer.beams || [])) { if (addLine(b, beamMat, beamDepthFt, 'beam', 'structure-beam')) beamCount += 1; }
  for (const j of (layer.joists || [])) { if (addLine(j, joistMat, joistDepthFt, 'joist', 'structure-joist')) joistCount += 1; }

  const summary = {
    columns: columnCount, beams: beamCount, joists: joistCount,
    ceilingElevFt, storyHeightFt,
    gridMatch: layer.gridMatch,
    needsVerification: true,
    provenance: 'built from extracted StructureLayer — true scale derived from structural sheet, needs-verification',
  };
  return { root, counts: { columns: columnCount, beams: beamCount, joists: joistCount }, summary };
}
