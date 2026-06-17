/**
 * Spec-dimension tables for fire-sprinkler catalog parts (W3 — REAL PART MODELS).
 *
 * Single source of truth for the REAL, published spec dimensions every OpenSCAD
 * emitter must build to. Where a number comes from a recognized standard or a
 * manufacturer submittal it is recorded here with its provenance so the emitter
 * and the Inspector can both cite it.
 *
 * PROVENANCE TAXONOMY (per-dimension truth — NON-NEGOTIABLE):
 *   - 'spec-nominal'  : a published dimensional standard (ASME B16.4 fittings,
 *                       ASTM/ANSI steel-pipe OD & wall, NPT thread OD, NFPA head
 *                       geometry). Spec-accurate, not tied to one SKU.
 *   - 'cutsheet'      : a number read off a specific manufacturer submittal
 *                       (cutsheet-urls-fittings.json). Tied to that figure/model.
 *   - 'derived'       : computed from a spec-nominal value by a documented rule
 *                       (e.g. coupling length = 1.6 x OD). Honest, not arbitrary.
 *
 * MANUFACTURER-EXACT stays FALSE for everything here. These are spec-accurate
 * parametric bodies, NOT licensed manufacturer CAD. The Inspector flags every
 * part needs-verification; the AUTOSPRINK_PARITY gate is untouched.
 *
 * Units: all numbers are INCHES (emitters convert to mm with IN_TO_MM). Pure,
 * deterministic, browser-free.
 */

const SPEC = 'spec-nominal';
const CUT = 'cutsheet';
const DERIVED = 'derived';

/** Wrap a value with its provenance + source citation for the Inspector. */
function dim(value, provenance, source) {
  return Object.freeze({ value, provenance, source });
}

/**
 * Steel pipe outside diameter (true OD, inches) by NPS — ASME B36.10 / ANSI.
 * The OD is FIXED per NPS regardless of schedule; only the wall (and thus bore)
 * changes between Sch 10 and Sch 40. These are the numbers a real layout uses.
 */
export const PIPE_OD_IN = Object.freeze({
  1: 1.315,
  1.25: 1.66,
  1.5: 1.9,
  2: 2.375,
  2.5: 2.875,
  3: 3.5,
  4: 4.5,
  6: 6.625,
  8: 8.625,
});

/** Nominal wall thickness (inches) by NPS — ASTM A795/A53, Sch 10 & Sch 40. */
export const PIPE_WALL_IN = Object.freeze({
  10: { 1: 0.109, 1.25: 0.109, 1.5: 0.109, 2: 0.109, 2.5: 0.12, 3: 0.12, 4: 0.12, 6: 0.134, 8: 0.148 },
  40: { 1: 0.133, 1.25: 0.14, 1.5: 0.145, 2: 0.154, 2.5: 0.203, 3: 0.216, 4: 0.237, 6: 0.28, 8: 0.322 },
});

/** Nearest catalogued NPS for an arbitrary nominal-inch request. */
export function nearestNps(nominalIn) {
  const keys = Object.keys(PIPE_OD_IN).map(Number);
  let best = keys[0];
  let bestErr = Infinity;
  for (const k of keys) {
    const e = Math.abs(k - Number(nominalIn));
    if (e < bestErr) {
      bestErr = e;
      best = k;
    }
  }
  return best;
}

/** True pipe OD (inches) for a nominal size, snapping to the nearest NPS. */
export function pipeOdIn(nominalIn) {
  return PIPE_OD_IN[nearestNps(nominalIn)];
}

/**
 * Sprinkler-head spec geometry (inches). Bodies built from real submittal
 * envelopes: 1/2" NPT heads (5.6/8.0K) and 3/4" NPT (ESFR). A standard pendent
 * is ~2-1/4" overall with a ~1" wrench-boss hex, a frame yoke, and a ~1.3"
 * stamped deflector. Orifice from the listed K nominal orifice (NOT a K*0.6
 * guess): 5.6K ~ 1/2" (0.50"), 8.0K ~ 17/32" (0.53"), ESFR large-orifice.
 */
export const HEAD_DIMS = Object.freeze({
  thread_half_npt_od: dim(0.84, SPEC, '1/2 NPT external thread OD (ANSI/ASME B1.20.1)'),
  thread_three_quarter_npt_od: dim(1.05, SPEC, '3/4 NPT external thread OD'),
  thread_one_npt_od: dim(1.315, SPEC, '1 NPT external thread OD'),
  thread_len: dim(0.55, SPEC, 'NPT engagement length (short male nipple)'),
  hex_across_flats: dim(1.0, SPEC, 'wrench boss across-flats, standard 1/2" head'),
  hex_height: dim(0.45, SPEC, 'wrench boss height'),
  frame_arm_dia: dim(0.16, SPEC, 'cast frame arm thickness'),
  frame_height: dim(1.1, SPEC, 'frame yoke height boss->deflector, std pendent'),
  deflector_dia_5_6: dim(1.3, SPEC, 'stamped deflector dia, 5.6K standard-coverage'),
  deflector_dia_8_0: dim(1.45, SPEC, 'stamped deflector dia, 8.0K standard-coverage'),
  deflector_dia_esfr: dim(1.85, SPEC, 'stamped deflector dia, ESFR large-orifice'),
  deflector_thk: dim(0.07, SPEC, 'stamped deflector thickness'),
  orifice_5_6: dim(0.5, SPEC, '5.6K nominal orifice 1/2"'),
  orifice_8_0: dim(0.53, SPEC, '8.0K nominal orifice 17/32"'),
  orifice_esfr: dim(0.75, SPEC, 'ESFR large orifice ~3/4"'),
  // Sidewall: deflector is offset to one side to throw horizontally.
  sidewall_deflector_w: dim(1.6, SPEC, 'sidewall deflector width (horizontal throw)'),
  sidewall_deflector_h: dim(0.9, SPEC, 'sidewall deflector height'),
  sidewall_deflector_offset: dim(0.55, SPEC, 'sidewall deflector lateral offset from axis'),
  // Concealed: cover plate flush ring that drops on activation.
  cover_plate_dia: dim(3.25, SPEC, 'concealed cover plate dia (typical 3-1/4")'),
  cover_plate_thk: dim(0.12, SPEC, 'concealed cover plate thickness'),
  recess_depth: dim(0.5, SPEC, 'concealed assembly recess below cover plate'),
});

/**
 * ASME B16.4 Class 125 threaded cast-iron fitting dimensions (inches).
 * center-to-end (A) and band OD per NPS — the dims an Anvil Fig. 351/358
 * submittal lists. Bands are the fitting body outside the pipe; ends seat the
 * pipe OD. (Anvil Fig. 351 90 ell, Fig. 358 tee — cutsheet-urls-fittings.json.)
 */
export const FITTING_B16_4 = Object.freeze({
  // [nps]: { cte: center-to-end inches, bandOd: outside dia of fitting body }
  1: { cte: 1.5, bandOd: 1.93 },
  1.25: { cte: 1.75, bandOd: 2.39 },
  1.5: { cte: 1.94, bandOd: 2.68 },
  2: { cte: 2.25, bandOd: 3.28 },
  2.5: { cte: 2.7, bandOd: 3.86 },
  3: { cte: 3.08, bandOd: 4.62 },
  4: { cte: 3.79, bandOd: 5.8 },
});

/** Center-to-end for a 45 ell is shorter than a 90 (ASME B16.4 ratio ~0.5). */
export const ELBOW_45_CTE_FACTOR = 0.62;

/**
 * Grooved-coupling spec geometry (inches) — Victaulic FireLock submittals.
 * RIGID = Style 005H (pub 10.02): two-segment housing, bolt pads, compact width.
 * FLEXIBLE = Style 177 FireLock: wider housing with a visible flexing gasket
 * band so the two types are VISUALLY DISTINCT (doctrine requirement).
 * Housing OD (X), overall width (length along pipe), bolt-pad spread.
 */
export const GROOVED_DIMS = Object.freeze({
  // [nps]: { rigidOd, rigidWidth, flexOd, flexWidth, boltDia }
  2: { rigidOd: 4.5, rigidWidth: 2.5, flexOd: 4.75, flexWidth: 3.62, boltDia: 0.5 },
  2.5: { rigidOd: 5.12, rigidWidth: 2.5, flexOd: 5.37, flexWidth: 3.62, boltDia: 0.5 },
  3: { rigidOd: 6.0, rigidWidth: 2.62, flexOd: 6.25, flexWidth: 3.75, boltDia: 0.625 },
  4: { rigidOd: 7.25, rigidWidth: 2.75, flexOd: 7.5, flexWidth: 3.94, boltDia: 0.625 },
  6: { rigidOd: 9.5, rigidWidth: 3.0, flexOd: 9.75, flexWidth: 4.25, boltDia: 0.75 },
  8: { rigidOd: 11.75, rigidWidth: 3.25, flexOd: 12.0, flexWidth: 4.62, boltDia: 0.875 },
  source: 'Victaulic FireLock Style 005H (rigid, pub 10.02) / Style 177 (flexible)',
});

/** Nearest grooved NPS (grooved only exists 2"+). */
export function nearestGroovedNps(nominalIn) {
  const keys = [2, 2.5, 3, 4, 6, 8];
  let best = keys[0];
  let bestErr = Infinity;
  for (const k of keys) {
    const e = Math.abs(k - Number(nominalIn));
    if (e < bestErr) {
      bestErr = e;
      best = k;
    }
  }
  return best;
}

/**
 * Escutcheon (cover ring) spec geometry (inches). Flat flanged ring around a
 * sprinkler drop where it passes through the ceiling — typical 2-piece chrome
 * ring ~2-3/4" OD with a cup depth.
 */
export const ESCUTCHEON_DIMS = Object.freeze({
  outer_dia: dim(2.75, SPEC, 'standard escutcheon OD (2-piece chrome ring)'),
  inner_bore: dim(1.0, SPEC, 'escutcheon bore (clears 1/2-3/4 drop + thread)'),
  flange_thk: dim(0.06, SPEC, 'flange ring thickness'),
  cup_depth: dim(0.5, SPEC, 'adjustable cup skirt depth'),
});

/**
 * Pipe hanger spec geometry (inches) — clevis / adjustable swivel ring band.
 * Ring strap wraps the pipe OD; rod is the standard 3/8" all-thread drop.
 */
export const HANGER_DIMS = Object.freeze({
  strap_thk: dim(0.12, SPEC, 'band-iron strap thickness (typ 12-10 ga)'),
  strap_width: dim(0.75, SPEC, 'ring strap width'),
  rod_dia: dim(0.375, SPEC, '3/8" all-thread hanger rod (NFPA 13 typ <= 4")'),
  rod_len: dim(8.0, SPEC, 'representative rod drop length'),
  clearance: dim(0.06, SPEC, 'ring-to-pipe radial clearance'),
});

/**
 * Drop nipple spec geometry (inches) — a short threaded pipe nipple from a
 * branch-line tee/reducer down to the head. NPS bore at the pipe OD, real
 * close/short-nipple lengths, threaded both ends.
 */
export const NIPPLE_DIMS = Object.freeze({
  default_len: dim(6.0, SPEC, 'representative short drop nipple length'),
  thread_len: dim(0.55, SPEC, 'NPT engagement each end'),
  thread_tpi_by_nps: Object.freeze({
    1: dim(11.5, SPEC, '1" NPT external thread pitch (ANSI/ASME B1.20.1)'),
  }),
  thread_taper_diam_per_in: dim(1 / 16, SPEC, 'NPT taper on diameter: 3/4" per foot'),
});

/** Reducer (concentric) spec: ASME B16.4 reducing coupling overall length. */
export const REDUCER_DIMS = Object.freeze({
  // length grows with the larger size; B16.4 reducing-coupling band lengths
  lengthByLargeNps: Object.freeze({ 1: 2.0, 1.25: 1.94, 1.5: 2.0, 2: 2.25, 2.5: 2.62, 3: 2.88, 4: 3.5 }),
});

/** Threaded-coupling spec (ASME B16.4 Class 150 straight coupling) length. */
export const COUPLING_DIMS = Object.freeze({
  // [nps]: { len: overall band length, bandOd: outside dia of coupling body }
  1: { len: 1.94, bandOd: 1.77 },
  1.25: { len: 2.13, bandOd: 2.21 },
  1.5: { len: 2.25, bandOd: 2.46 },
  2: { len: 2.5, bandOd: 3.07 },
  2.5: { len: 3.0, bandOd: 3.7 },
  3: { len: 3.25, bandOd: 4.44 },
  4: { len: 3.94, bandOd: 5.66 },
  source: 'ASME B16.4 Class 150 malleable-iron straight coupling (Anvil Fig. 1121/1122)',
});

export { SPEC, CUT, DERIVED, dim };
