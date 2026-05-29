/**
 * HaloFire hanger + seismic support placement (internal alpha, best-effort).
 *
 * Walks the pipe solids of a cad-model (the SAME solids buildCadModel emits —
 * see src/engine/cad-model.js: each pipe is { kind:'pipe', role, from:[x,y,z],
 * to:[x,y,z], diameterIn }) and places:
 *   - a pipe HANGER along every horizontal pipe run at the NFPA-13 maximum
 *     hanger spacing for its nominal size, clamped to at least one per run and
 *     to within ~1 ft of each end of the run; and
 *   - a lateral SEISMIC sway BRACE roughly every 40 ft along main/branch runs.
 *
 * Pure geometry, fully deterministic — same cad-model in, same supports out.
 * These support solids/counts feed the BOM / takeoff (the `hanger` and
 * `seismic_brace` components already exist in src/components/registry.js).
 *
 * HONESTY / fail-closed: this is a BEST-EFFORT spacing estimate, NOT a seismic
 * engineering design, NOT a stamped support/bracing layout, NOT PE-reviewed,
 * NOT AHJ-approved, NOT AutoSprink parity. It clears no claim gate.
 *
 * Coordinates: feet. X/Y are plan; Z is elevation (0 = floor).
 */

// NFPA-13 maximum hanger spacing (ft) by nominal pipe size (in). Public code
// values: small steel pipe is hung closer together than large pipe.
//   <= 1"      -> 12 ft
//   1.25"      -> 12 ft
//   1.5" - 3.5"-> 15 ft
//   >= 4"      -> 15 ft
export function maxHangerSpacingFt(nominalIn) {
  const d = Number(nominalIn) || 0;
  if (d <= 1.25) return 12;
  return 15;
}

// Best-effort lateral seismic sway-brace interval (ft) along mains/branches.
export const SEISMIC_BRACE_INTERVAL_FT = 40;

// Roles that are horizontal pipe RUNS we hang + (for main/branch) brace.
// Drops/risers/ties are short vertical jumps — they get neither here.
const RUN_ROLES = new Set(['branch', 'main']);
const BRACE_ROLES = new Set(['branch', 'main']);

export const SUPPORTS_NOTE = 'best-effort NFPA-13 hanger spacing + seismic brace '
  + 'interval estimate — NOT a seismic engineering design, NOT PE-reviewed, NOT '
  + 'AHJ-approved, NOT AutoSprink parity; clears no claim gate.';

function round(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** Length (ft) of a pipe solid in plan+elevation space. */
function pipeLength(p) {
  const [ax, ay, az] = p.from;
  const [bx, by, bz] = p.to;
  return Math.hypot(bx - ax, by - ay, bz - az);
}

/** True iff the pipe is (effectively) horizontal — a run we hang, not a drop. */
function isHorizontal(p) {
  return Math.abs(p.from[2] - p.to[2]) < 1e-6;
}

/** Point a fraction `t` (0..1) along the pipe from->to. */
function pointAlong(p, t) {
  const [ax, ay, az] = p.from;
  const [bx, by, bz] = p.to;
  return [round(ax + (bx - ax) * t), round(ay + (by - ay) * t), round(az + (bz - az) * t)];
}

/**
 * Hanger offsets (in ft from the run start) for a run of `len` ft at max
 * spacing `spacing`. Always at least one hanger; an end hanger within ~1 ft of
 * each end, plus interior hangers so no gap exceeds the max spacing.
 *
 * For a 30 ft run at 15 ft spacing this yields the two ends + the interior
 * spacing hangers: ceil(30/15)=2 interior division points -> offsets
 * {0, 15, 30} = 3 hangers... we report counts as ceil(len/spacing) interior
 * spacing hangers PLUS the two end hangers, deduped when ends coincide with a
 * spacing node.
 */
function hangerOffsets(len, spacing) {
  if (len <= 1e-6) return [0]; // zero-length run still needs one hanger
  const offsets = new Set();
  offsets.add(0); // end hanger near the start
  // interior hangers every `spacing` ft so no span exceeds the max spacing
  const interior = Math.ceil(len / spacing);
  for (let i = 1; i < interior; i += 1) offsets.add(round(i * spacing));
  offsets.add(round(len)); // end hanger near the far end
  return [...offsets].sort((a, b) => a - b);
}

/** Brace offsets (ft from start) at ~SEISMIC_BRACE_INTERVAL_FT along a run. */
function braceOffsets(len, interval) {
  const offsets = [];
  if (len < interval) return offsets; // short runs need no lateral brace here
  const n = Math.floor(len / interval);
  for (let i = 1; i <= n; i += 1) offsets.push(round(i * interval));
  return offsets;
}

/**
 * Place hangers + seismic braces for a cad-model's pipe solids.
 *
 * @param {{solids:Array}} cadModel - output of buildCadModel/buildRoomCad.
 * @param {{seismicIntervalFt?:number}} [opts]
 * @returns {{hangers:Array, braces:Array, counts:{hangers:number,braces:number},
 *   note:string}}
 */
export function placeSupports(cadModel, opts = {}) {
  const interval = Number(opts.seismicIntervalFt) > 0
    ? Number(opts.seismicIntervalFt) : SEISMIC_BRACE_INTERVAL_FT;

  const solids = (cadModel && Array.isArray(cadModel.solids)) ? cadModel.solids : [];
  const pipes = solids.filter((s) => s && s.kind === 'pipe');

  const hangers = [];
  const braces = [];

  for (const p of pipes) {
    if (!RUN_ROLES.has(p.role) || !isHorizontal(p)) continue;
    const len = pipeLength(p);
    const spacing = maxHangerSpacingFt(p.diameterIn);

    for (const off of hangerOffsets(len, spacing)) {
      const t = len > 0 ? off / len : 0;
      hangers.push({
        position: pointAlong(p, Math.min(1, Math.max(0, t))),
        pipe: p.name,
        role: 'hanger',
        diameterIn: p.diameterIn,
        spacingFt: spacing,
      });
    }

    if (BRACE_ROLES.has(p.role)) {
      for (const off of braceOffsets(len, interval)) {
        const t = len > 0 ? off / len : 0;
        braces.push({
          position: pointAlong(p, Math.min(1, Math.max(0, t))),
          pipe: p.name,
          role: 'seismic_brace',
          braceType: 'lateral',
          diameterIn: p.diameterIn,
          intervalFt: interval,
        });
      }
    }
  }

  return {
    hangers,
    braces,
    counts: { hangers: hangers.length, braces: braces.length },
    note: SUPPORTS_NOTE,
  };
}
