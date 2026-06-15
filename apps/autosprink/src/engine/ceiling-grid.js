/**
 * HaloFire DROP-CEILING TILE GRID + CENTER-ON-TILE (Phase 4, intake & deliverables).
 *
 * Suspended (lay-in) acoustical ceilings are built on a regular tile grid — almost
 * always 2x2 ft or 2x4 ft lay-in panels. The fire-sprinkler designer working a
 * tenant-improvement / commercial fit-out lays heads in the CENTER of a ceiling
 * tile (it is where the head is meant to land for both appearance and the reflector
 * throw the manufacturer lists for a centered pendent). AutoSPRINK synthesizes that
 * grid over a level and offers a "center heads on tile" operation.
 *
 * This module does exactly that, PURELY:
 *
 *   synthesizeCeilingGrid({cadModel, level, tileW, tileH, ...})
 *     -> { ok, tileW, tileH, origin, cols, rows, tiles:[{i,j,cx,cy,x0,y0,x1,y1}],
 *          bounds, originSource, level, disclaimer }
 *     Builds the lay-in tile lattice over a level's extent. The extent is the
 *     building footprint for the level if walls are present (else the head field
 *     bbox), padded so the whole ceiling is tiled. Origin defaults to the extent
 *     min corner so tiles align to the wall (configurable: 'corner' | 'center').
 *
 *   centerHeadsOnTiles({cadModel, grid, hazard, coverage})
 *     -> { ok, headsCentered, headsConsidered, moves:[{name,from,to,tile,deltaFt}],
 *          skipped:[{name,reason}], maxSpacingFt, minSpacingFt, hazard, model? }
 *     Snaps each head on the level to the CENTER of the tile it currently sits in,
 *     but ONLY when the snap is NFPA-legal: the resulting layout must keep every
 *     moved pair at/above the hazard MINIMUM spacing and the move must not push a
 *     head's nearest neighbour beyond the hazard MAX spacing. A snap that would
 *     create a too-close or too-far condition is REJECTED and reported in `skipped`
 *     with the honest reason — we never silently produce an illegal layout. The
 *     hazard max coverage/spacing comes from compliance.coverage(hazard) (public
 *     NFPA-13 standard-spray limits), falling back to a passed `coverage` object.
 *
 * COORDINATES: plan feet (x,y). Heads carry position [x,y,z]; the z is preserved on
 * a center move (we only move the head IN PLAN to the tile centre). A "level" is the
 * set of heads whose z is within the level band (so multi-storey models tile each
 * floor independently); when no level is given we operate on every head.
 *
 * PURE + deterministic + browser-free. No THREE, no DOM, no I/O. Same model+params
 * in -> same grid/centered set out. Unit-tested in tests/ceiling-grid.test.js.
 *
 * HONESTY: this is the lay-in CEILING GEOMETRY only. The tile grid is a drafting
 * aid synthesized from the reconstructed extent — it is NOT the architect's reflected
 * ceiling plan (RCP). Centering respects NFPA-13 standard-spray spacing limits but is
 * NOT AHJ/PE approval, does not consider obstructions, light fixtures, diffusers,
 * sloped/coffered ceilings, or the manufacturer's listed coverage for the specific
 * sprinkler. Verify against the real RCP before submittal.
 */

export const CEILING_GRID_DISCLAIMER =
  'Engineering aid — synthesized lay-in ceiling tile grid, NOT the architect\'s '
  + 'reflected ceiling plan (RCP). Center-on-tile respects public NFPA-13 standard-spray '
  + 'spacing limits only (no obstruction/fixture/sloped-ceiling rules) and is NOT '
  + 'AHJ/PE approval. Verify against the real RCP before submittal.';

const EPS = 1e-9;

function round(n, p = 3) {
  const f = 10 ** p;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}

function dist2d(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** Heads (kind:'head', position:[x,y,z]) of a model, with their solid index. */
function headsOf(model) {
  const out = [];
  if (!model || !Array.isArray(model.solids)) return out;
  model.solids.forEach((s, i) => {
    if (!s || s.kind !== 'head' || !Array.isArray(s.position)) return;
    const x = Number(s.position[0]);
    const y = Number(s.position[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    out.push({ x, y, z: Number(s.position[2]) || 0, name: s.name || ('head#' + i), hazard: s.hazard, _idx: i });
  });
  return out;
}

/** Wall vertices of a model (kind:'wall', a/b:[x,y]) for the footprint bbox. */
function wallPointsOf(model) {
  const out = [];
  if (!model || !Array.isArray(model.solids)) return out;
  for (const s of model.solids) {
    if (!s || s.kind !== 'wall') continue;
    if (Array.isArray(s.a) && Number.isFinite(Number(s.a[0])) && Number.isFinite(Number(s.a[1]))) out.push([Number(s.a[0]), Number(s.a[1])]);
    if (Array.isArray(s.b) && Number.isFinite(Number(s.b[0])) && Number.isFinite(Number(s.b[1]))) out.push([Number(s.b[0]), Number(s.b[1])]);
    if (Array.isArray(s.center) && Number.isFinite(Number(s.center[0])) && Number.isFinite(Number(s.center[1]))) out.push([Number(s.center[0]), Number(s.center[1])]);
  }
  return out;
}

/**
 * Resolve the Z-band for a level so we tile only that floor's heads. Given the
 * `levels` metadata [{level,elevationFt}] (sorted), the band for level L is
 * [elev(L) - gapBelow, elev(L+1) - gapBelow) — i.e. everything from this floor's
 * slab up to (but not including) the next floor's slab. If no levels metadata,
 * returns null (operate on ALL heads).
 */
function levelZBand(level, levels) {
  if (level == null || !Array.isArray(levels) || !levels.length) return null;
  const sorted = levels.slice().filter((l) => Number.isFinite(Number(l.elevationFt)))
    .sort((a, b) => Number(a.elevationFt) - Number(b.elevationFt));
  if (!sorted.length) return null;
  const idx = sorted.findIndex((l) => Number(l.level) === Number(level));
  if (idx < 0) return null;
  const lo = Number(sorted[idx].elevationFt);
  const hi = idx + 1 < sorted.length ? Number(sorted[idx + 1].elevationFt) : Infinity;
  // a small downward tolerance so a head sitting just under the slab still bins here
  return { lo: lo - 1, hi: hi - 1 };
}

/**
 * Synthesize a drop-ceiling tile lattice over a level.
 *
 * @param {object}  args
 * @param {{solids:Array}} args.cadModel    the live model
 * @param {number}  [args.tileW=2]          tile width (ft, along x)
 * @param {number}  [args.tileH=2]          tile height (ft, along y). 2x4 => tileW=2,tileH=4
 * @param {number|string} [args.level]      level number to tile (with args.levels). Omit => all heads' extent.
 * @param {Array}   [args.levels]           level metadata [{level,elevationFt}] (to band heads by floor)
 * @param {'corner'|'center'} [args.originMode='corner']  tile origin alignment
 * @param {[number,number]} [args.origin]   explicit grid origin [x,y] (overrides originMode)
 * @param {{x0,y0,x1,y1}} [args.extent]     explicit extent to tile (else derived from walls/heads)
 * @param {number}  [args.padFt=2]          pad the derived extent so the whole ceiling is covered
 * @param {number}  [args.maxTiles=40000]   safety cap on tiles synthesized
 * @returns {{ ok, tileW, tileH, origin, cols, rows, tileCount, tiles, bounds, extent,
 *             originSource, extentSource, level, disclaimer, reason? }}
 */
export function synthesizeCeilingGrid(args = {}) {
  const model = args.cadModel;
  const tileW = Number.isFinite(Number(args.tileW)) && Number(args.tileW) > 0 ? Number(args.tileW) : 2;
  const tileH = Number.isFinite(Number(args.tileH)) && Number(args.tileH) > 0 ? Number(args.tileH) : 2;
  const padFt = Number.isFinite(Number(args.padFt)) ? Math.max(0, Number(args.padFt)) : 2;
  const maxTiles = Number.isFinite(Number(args.maxTiles)) && Number(args.maxTiles) > 0 ? Number(args.maxTiles) : 40000;
  const originMode = args.originMode === 'center' ? 'center' : 'corner';

  // ── Heads on this level (for centering + as a fallback extent) ──
  const band = levelZBand(args.level, args.levels);
  const allHeads = headsOf(model);
  const levelHeads = band ? allHeads.filter((h) => h.z >= band.lo - EPS && h.z < band.hi - EPS) : allHeads;

  // ── Extent to tile ──
  let extent = null, extentSource = null;
  if (args.extent && [args.extent.x0, args.extent.y0, args.extent.x1, args.extent.y1].every((v) => Number.isFinite(Number(v)))) {
    extent = { x0: Number(args.extent.x0), y0: Number(args.extent.y0), x1: Number(args.extent.x1), y1: Number(args.extent.y1) };
    extentSource = 'explicit';
  } else {
    // prefer the wall (footprint) bbox; else the head-field bbox.
    const wp = wallPointsOf(model);
    if (wp.length >= 2) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of wp) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      extent = { x0, y0, x1, y1 }; extentSource = 'wall-footprint-bbox';
    } else if (levelHeads.length >= 1) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const h of levelHeads) { if (h.x < x0) x0 = h.x; if (h.x > x1) x1 = h.x; if (h.y < y0) y0 = h.y; if (h.y > y1) y1 = h.y; }
      // a lone head has zero span — give it at least one tile around it.
      extent = { x0: x0 - tileW, y0: y0 - tileH, x1: x1 + tileW, y1: y1 + tileH };
      extentSource = 'head-field-bbox';
    }
  }
  if (!extent) {
    return { ok: false, reason: 'no extent — model has no walls or heads to tile (import a plan or generate a layout first)', tiles: [], tileCount: 0, tileW, tileH, level: args.level ?? null, disclaimer: CEILING_GRID_DISCLAIMER };
  }
  // pad the derived extent (not an explicit one) so tiles cover the whole ceiling
  if (extentSource !== 'explicit') { extent.x0 -= padFt; extent.y0 -= padFt; extent.x1 += padFt; extent.y1 += padFt; }
  if (!(extent.x1 - extent.x0 > EPS) || !(extent.y1 - extent.y0 > EPS)) {
    return { ok: false, reason: 'degenerate extent (zero width or depth)', tiles: [], tileCount: 0, tileW, tileH, level: args.level ?? null, disclaimer: CEILING_GRID_DISCLAIMER };
  }

  // ── Grid origin (the [x,y] of the i=0,j=0 tile's lower-left corner) ──
  let origin, originSource;
  if (Array.isArray(args.origin) && Number.isFinite(Number(args.origin[0])) && Number.isFinite(Number(args.origin[1]))) {
    origin = [Number(args.origin[0]), Number(args.origin[1])];
    originSource = 'explicit';
  } else if (originMode === 'center') {
    // center the lattice on the extent centre, so a tile centre sits at the middle
    const mcx = (extent.x0 + extent.x1) / 2, mcy = (extent.y0 + extent.y1) / 2;
    origin = [mcx - tileW / 2, mcy - tileH / 2]; // a tile is centred on the midpoint
    // back the origin off by whole tiles so the lattice still starts at/below extent.x0
    origin[0] -= Math.ceil((origin[0] - extent.x0) / tileW) * tileW;
    origin[1] -= Math.ceil((origin[1] - extent.y0) / tileH) * tileH;
    originSource = 'centered-on-extent';
  } else {
    origin = [extent.x0, extent.y0];
    originSource = 'extent-corner';
  }

  // ── Lattice extent: integer tile counts that cover the (padded) extent ──
  let cols = Math.ceil((extent.x1 - origin[0]) / tileW - EPS);
  let rows = Math.ceil((extent.y1 - origin[1]) / tileH - EPS);
  cols = Math.max(1, cols); rows = Math.max(1, rows);
  // safety clamp
  let clamped = false;
  if (cols * rows > maxTiles) {
    clamped = true;
    // keep aspect, scale both down to fit the cap
    const scale = Math.sqrt((cols * rows) / maxTiles);
    cols = Math.max(1, Math.floor(cols / scale));
    rows = Math.max(1, Math.floor(rows / scale));
  }

  const tiles = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x0 = origin[0] + i * tileW;
      const y0 = origin[1] + j * tileH;
      tiles.push({
        i, j,
        x0: round(x0), y0: round(y0),
        x1: round(x0 + tileW), y1: round(y0 + tileH),
        cx: round(x0 + tileW / 2), cy: round(y0 + tileH / 2),
      });
    }
  }

  return {
    ok: true,
    tileW, tileH,
    origin: [round(origin[0]), round(origin[1])],
    originSource,
    cols, rows,
    tileCount: tiles.length,
    tiles,
    bounds: { x0: round(origin[0]), y0: round(origin[1]), x1: round(origin[0] + cols * tileW), y1: round(origin[1] + rows * tileH) },
    extent: { x0: round(extent.x0), y0: round(extent.y0), x1: round(extent.x1), y1: round(extent.y1) },
    extentSource,
    clamped,
    level: args.level ?? null,
    headsOnLevel: levelHeads.length,
    disclaimer: CEILING_GRID_DISCLAIMER,
  };
}

/**
 * Which tile (i,j) does a plan point [x,y] fall in, given the grid origin+pitch?
 * Returns {i,j,cx,cy} of the containing tile (clamped to the lattice), or null if
 * the grid is degenerate. Used to snap a head to ITS tile centre.
 */
export function tileForPoint(grid, x, y) {
  if (!grid || !grid.ok || !Array.isArray(grid.origin)) return null;
  const i = Math.floor((x - grid.origin[0]) / grid.tileW + EPS);
  const j = Math.floor((y - grid.origin[1]) / grid.tileH + EPS);
  const ci = Math.min(Math.max(i, 0), grid.cols - 1);
  const cj = Math.min(Math.max(j, 0), grid.rows - 1);
  const cx = grid.origin[0] + ci * grid.tileW + grid.tileW / 2;
  const cy = grid.origin[1] + cj * grid.tileH + grid.tileH / 2;
  return { i: ci, j: cj, cx: round(cx), cy: round(cy), inBounds: i === ci && j === cj };
}

/**
 * Resolve the hazard's max coverage area + max/min spacing for the legality check.
 * Precedence: an explicit `coverage` arg (e.g. compliance.coverage(hazard) result),
 * else the passed `complianceCoverage` fn(hazard), else a built-in fallback.
 */
function resolveCoverageRule(hazard, opts) {
  // an explicit coverage object {maxAreaFt2,maxSpacingFt,minSpacingFt}
  if (opts.coverage && Number.isFinite(Number(opts.coverage.maxSpacingFt))) {
    return {
      maxAreaFt2: Number(opts.coverage.maxAreaFt2) || null,
      maxSpacingFt: Number(opts.coverage.maxSpacingFt),
      minSpacingFt: Number(opts.coverage.minSpacingFt) || 6,
      source: opts.coverage.source || 'explicit-coverage',
    };
  }
  // a compliance.coverage-style lookup fn
  if (typeof opts.complianceCoverage === 'function') {
    const c = opts.complianceCoverage(hazard);
    if (c && Number.isFinite(Number(c.maxSpacingFt))) {
      return { maxAreaFt2: Number(c.maxAreaFt2) || null, maxSpacingFt: Number(c.maxSpacingFt), minSpacingFt: Number(c.minSpacingFt) || 6, source: 'compliance.coverage' };
    }
  }
  // built-in NFPA-13 standard-spray fallback (light/ordinary 15 ft, extra 12 ft)
  const FALLBACK = {
    light: { maxAreaFt2: 225, maxSpacingFt: 15 },
    ordinary: { maxAreaFt2: 130, maxSpacingFt: 15 },
    ordinary_1: { maxAreaFt2: 130, maxSpacingFt: 15 },
    ordinary_2: { maxAreaFt2: 130, maxSpacingFt: 15 },
    extra: { maxAreaFt2: 100, maxSpacingFt: 12 },
  };
  const f = FALLBACK[hazard] || FALLBACK.ordinary;
  return { maxAreaFt2: f.maxAreaFt2, maxSpacingFt: f.maxSpacingFt, minSpacingFt: 6, source: 'builtin-fallback' };
}

/** Nearest-neighbour distance of point p against an array of {x,y} (excluding self by index). */
function nearestNeighbour(pts, selfIdx) {
  let best = Infinity;
  for (let k = 0; k < pts.length; k += 1) {
    if (k === selfIdx) continue;
    const d = dist2d(pts[selfIdx].x, pts[selfIdx].y, pts[k].x, pts[k].y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Center heads on their ceiling tiles — but only when NFPA-legal.
 *
 * For each head on the level we compute the centre of the tile it sits in, then
 * test the WHOLE candidate layout (this head moved, all others as they currently
 * are / as already accepted) against the hazard rule:
 *   • REJECT if the move drops ANY pair below the hazard minimum spacing (too-close);
 *   • REJECT if the move pushes this head's nearest neighbour BEYOND the hazard max
 *     spacing (the centred position would over-space it).
 * Accepted moves are applied to a CLONE of the model (the live model is never
 * mutated here — the caller installs the returned model via the edit pipeline).
 *
 * @param {object} args
 * @param {{solids:Array}} args.cadModel
 * @param {object} args.grid        a synthesizeCeilingGrid() result (ok:true)
 * @param {string} [args.hazard]    hazard class for the spacing rule (else model.sizing.hazard)
 * @param {object} [args.coverage]  compliance.coverage(hazard) result {maxAreaFt2,maxSpacingFt,minSpacingFt}
 * @param {Function} [args.complianceCoverage]  fn(hazard)->coverage (alt to args.coverage)
 * @param {boolean} [args.cloneModel=true]  return a mutated clone in `.model`
 * @returns {{ ok, headsConsidered, headsCentered, moves, skipped, alreadyCentered,
 *             maxSpacingFt, minSpacingFt, hazard, coverageSource, model?, disclaimer }}
 */
export function centerHeadsOnTiles(args = {}) {
  const model = args.cadModel;
  const grid = args.grid;
  if (!grid || !grid.ok) {
    return { ok: false, reason: 'no valid ceiling grid (synthesize one first)', headsCentered: 0, moves: [], skipped: [], disclaimer: CEILING_GRID_DISCLAIMER };
  }
  const hazard = args.hazard || (model && model.sizing && model.sizing.hazard) || 'ordinary';
  const rule = resolveCoverageRule(hazard, args);

  // heads on the SAME level the grid was built for (z-band), else all heads.
  const band = levelZBand(grid.level, args.levels || (grid.level != null ? undefined : null));
  const all = headsOf(model);
  const levelHeads = band ? all.filter((h) => h.z >= band.lo - EPS && h.z < band.hi - EPS) : all;

  // Pass 1 — compute each head's PROPOSED target (the centre of the tile it sits in).
  // Centering is a BATCH operation: every head moves at once, so the legality of a
  // single snap must be judged against where the OTHER heads will ALSO end up (their
  // own tile centres), not against their pre-move positions. Otherwise the order of
  // evaluation creates phantom too-close rejections (head A blocked by head B's old,
  // un-centred position even though B will move away). We build the full proposed
  // layout first, then validate it.
  const proposals = levelHeads.map((h) => {
    const tile = tileForPoint(grid, h.x, h.y);
    if (!tile) return { h, tile: null, tx: h.x, ty: h.y, willMove: false, outside: true };
    const delta = dist2d(h.x, h.y, tile.cx, tile.cy);
    return { h, tile, tx: tile.cx, ty: tile.cy, delta, willMove: delta > 1e-3, outside: false };
  });
  // The proposed layout: each head at its TARGET if it will move, else where it is.
  const targets = proposals.map((p) => ({ x: p.tx, y: p.ty, name: p.h.name }));

  const moves = [];
  const skipped = [];
  let alreadyCentered = 0;

  for (let n = 0; n < proposals.length; n += 1) {
    const p = proposals[n];
    if (p.outside) { skipped.push({ name: p.h.name, reason: 'no tile contains this head (outside the grid)' }); continue; }
    if (!p.willMove) { alreadyCentered += 1; continue; }

    // min-spacing: this head's TARGET vs every OTHER head's TARGET. Two heads whose
    // tile centres are below the hazard minimum apart genuinely collide once centred.
    let tooClose = null;
    for (let k = 0; k < targets.length; k += 1) {
      if (k === n) continue;
      const d = dist2d(p.tx, p.ty, targets[k].x, targets[k].y);
      if (d < rule.minSpacingFt - 1e-6) { tooClose = { other: targets[k].name, d: round(d) }; break; }
    }
    if (tooClose) {
      skipped.push({ name: p.h.name, reason: `centering would place it ${tooClose.d} ft from ${tooClose.other} — below the ${rule.minSpacingFt} ft minimum spacing`, tile: { i: p.tile.i, j: p.tile.j } });
      continue;
    }
    // max-spacing: in the proposed layout, this head's NEAREST neighbour must stay
    // within the hazard max spacing (a centred head must not become over-spaced).
    if (targets.length >= 2) {
      const nn = nearestNeighbour(targets, n);
      if (Number.isFinite(nn) && nn > rule.maxSpacingFt + 1e-6) {
        skipped.push({ name: p.h.name, reason: `centering would leave its nearest head ${round(nn)} ft away — beyond the ${rule.maxSpacingFt} ft max spacing for ${hazard} hazard`, tile: { i: p.tile.i, j: p.tile.j } });
        continue;
      }
    }
    moves.push({
      name: p.h.name, _idx: p.h._idx,
      from: [round(p.h.x), round(p.h.y)],
      to: [round(p.tx), round(p.ty)],
      tile: { i: p.tile.i, j: p.tile.j },
      deltaFt: round(p.delta),
    });
  }

  // Build the mutated clone (apply accepted moves; preserve z).
  let outModel = null;
  if (args.cloneModel !== false && moves.length) {
    outModel = cloneModelWithMoves(model, moves);
  }

  return {
    ok: true,
    headsConsidered: proposals.length,
    headsCentered: moves.length,
    alreadyCentered,
    skippedCount: skipped.length,
    moves,
    skipped,
    maxSpacingFt: rule.maxSpacingFt,
    minSpacingFt: rule.minSpacingFt,
    maxAreaFt2: rule.maxAreaFt2,
    hazard,
    coverageSource: rule.source,
    level: grid.level ?? null,
    model: outModel,
    disclaimer: CEILING_GRID_DISCLAIMER,
  };
}

/** Deep-ish clone of the model with the accepted head moves applied (plan x/y only; z kept). */
function cloneModelWithMoves(model, moves) {
  const byIdx = new Map(moves.map((m) => [m._idx, m]));
  const solids = model.solids.map((s, i) => {
    const mv = byIdx.get(i);
    if (mv && s && s.kind === 'head' && Array.isArray(s.position)) {
      return { ...s, position: [mv.to[0], mv.to[1], s.position[2]] };
    }
    return s;
  });
  return { ...model, solids };
}

export default {
  CEILING_GRID_DISCLAIMER,
  synthesizeCeilingGrid,
  centerHeadsOnTiles,
  tileForPoint,
};
