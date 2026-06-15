/**
 * HaloFire — NFPA-13 fitting equivalent-length (Le) table (Phase 3 hydraulics).
 *
 * Pure, deterministic. Maps a fitting type + nominal pipe size to the
 * equivalent length of straight pipe (feet) that produces the same friction
 * loss, per the standard NFPA-13 "Equivalent Pipe Length Chart" (C=120 basis).
 * For a Hazen-Williams coefficient C other than 120, Le is scaled by the
 * standard multiplier (C/120)^1.852 (NFPA-13 §23.4.3.1.1 / 27.2.3.1.1).
 *
 * HONESTY: representative public NFPA-13 schedule-40 Le values for the common
 * fittings used by this clone's auto-router (tee/elbow/coupling). NOT a complete
 * manufacturer-certified fitting database, NOT AHJ/PE-stamped. An ENGINEERING
 * AID only — verify against the stamped calc before permit.
 *
 * Units: nominal size in inches; Le in feet.
 */

// NFPA-13 Table — equivalent length of schedule-40 pipe (feet), C=120 basis.
// Rows are nominal pipe size; columns are fitting type. Values are the standard
// published figures used in fire-sprinkler hydraulic calcs.
//                         1"   1.25  1.5   2     2.5   3     4     6     8
const NOMINAL = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8];

const LE_TABLE = Object.freeze({
  // 90° standard elbow
  elbow90: { 0.75: 2, 1: 2, 1.25: 3, 1.5: 4, 2: 5, 2.5: 6, 3: 7, 4: 10, 6: 14, 8: 18 },
  // 45° elbow
  elbow45: { 0.75: 1, 1: 1, 1.25: 1, 1.5: 2, 2: 2, 2.5: 3, 3: 3, 4: 4, 6: 7, 8: 9 },
  // tee/cross — flow turning 90° through the branch
  teeBranch: { 0.75: 3, 1: 5, 1.25: 6, 1.5: 8, 2: 10, 2.5: 12, 3: 15, 4: 20, 6: 30, 8: 35 },
  // tee/cross — straight-through run (negligible, but standard lists small Le)
  teeRun: { 0.75: 0, 1: 0, 1.25: 0, 1.5: 0, 2: 0, 2.5: 0, 3: 0, 4: 0, 6: 0, 8: 0 },
  // gate valve (fully open)
  gateValve: { 0.75: 0, 1: 0, 1.25: 0, 1.5: 0, 2: 1, 2.5: 1, 3: 1, 4: 2, 6: 3, 8: 4 },
  // butterfly valve
  butterflyValve: { 0.75: 0, 1: 0, 1.25: 0, 1.5: 0, 2: 6, 2.5: 7, 3: 10, 4: 12, 6: 9, 8: 10 },
  // swing check valve
  checkValve: { 0.75: 4, 1: 5, 1.25: 7, 1.5: 9, 2: 11, 2.5: 14, 3: 16, 4: 22, 6: 32, 8: 45 },
  // coupling / straight pass-through (no added loss)
  coupling: { 0.75: 0, 1: 0, 1.25: 0, 1.5: 0, 2: 0, 2.5: 0, 3: 0, 4: 0, 6: 0, 8: 0 },
});

/** Snap an actual internal diameter to the nearest nominal-size table key. */
export function nominalSizeFor(diameterIn) {
  const d = Number(diameterIn) || 0;
  let best = NOMINAL[0];
  let bestErr = Infinity;
  for (const n of NOMINAL) {
    const err = Math.abs(n - d);
    if (err < bestErr) { bestErr = err; best = n; }
  }
  return best;
}

/**
 * Equivalent length (feet) for one fitting of `type` at the given pipe size and
 * Hazen-Williams C (Le is published on a C=120 basis; scale for other C).
 *
 * @param {string} type fitting key (elbow90, teeBranch, ...)
 * @param {number} diameterIn pipe internal diameter (inches)
 * @param {number} [C=120] Hazen-Williams roughness
 * @returns {number} equivalent length in feet (0 for unknown types — fail-soft)
 */
export function equivalentLengthFt(type, diameterIn, C = 120) {
  const row = LE_TABLE[type];
  if (!row) return 0;
  const nom = nominalSizeFor(diameterIn);
  const base = row[nom] != null ? row[nom] : 0;
  if (!base) return 0;
  const c = Number(C) > 0 ? Number(C) : 120;
  // NFPA-13 C-conversion multiplier (Le tables are tabulated at C=120).
  const mult = Math.pow(c / 120, 1.852);
  return base * mult;
}

export const FITTING_TYPES = Object.freeze(Object.keys(LE_TABLE));
export { LE_TABLE };
