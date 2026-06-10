// HaloFire CAD — the part PLACEMENT CONTRACT (PURE — no three/react/DOM imports;
// plain numbers in, plain numbers out).
//
// This ends the "part free-for-all": EVERY rendered network part gets a
// contracted rotation, orientation, and size — never an ad-hoc per-callsite
// guess.
//
//   ROTATION — derived from the directions of the pipe segments attached to the
//   node. Fitting STEP bodies are modeled run=+X, branch=+Z (see
//   fitting-orient.ts), so for horizontal runs the placement is one rotation
//   about world Y:
//     TEE / CROSS — run = the most-collinear pair of horizontal attached dirs,
//       branch = the horizontal dir most orthogonal to the run -> teeRotationY.
//     ELBOW — the first two horizontal attached dirs -> elbowRotationY.
//     VALVE / SOURCE / REDUCER — body +X aligned to the first horizontal
//       attached dir (atan2(-z, x)).
//     HEAD — rotation 0 + deflectorDown (the viewer flips it deflector-down).
//
//   SIZE (the SIZING CONTRACT) — when the loaded body's real bounding box is a
//   plausible physical part size (PHYSICAL_MIN_FT..PHYSICAL_MAX_FT) the body is
//   rendered AT REAL SIZE: sizeMode 'physical', scale 1. Otherwise the body is
//   scaled to the documented nominal display target and the mode is REPORTED as
//   'nominal-fallback' — fake sizing is never silent.
//
// LIMITATIONS (documented, honest):
//   - Rotation is solved about world Y for HORIZONTAL runs only (the wet-system
//     common case). Vertical/sloped attached runs are excluded from the
//     horizontal set; a part with fewer than the required horizontal dirs keeps
//     rotation 0. Full quaternion alignment is the documented follow-up
//     (fitting-orient.ts header).
//   - A tee whose only usable branch candidate is parallel to its run (e.g. the
//     routed cross-main tees, whose branch elbow sits at the SAME point so the
//     tap segment has zero length) makes teeRotationY throw -> rotation falls
//     back to 0 per the contract.

import { elbowRotationY, teeRotationY } from './fitting-orient';

/** Unit-ish direction of an attached segment AWAY from the node (feet space). */
export interface AttachedDir {
  x: number;
  y: number;
  z: number;
}

/** The contracted placement for one rendered part. */
export interface PartPlacement {
  /** Rotation about world Y (radians). 0 when no horizontal solve is possible. */
  rotationY: number;
  /**
   * 'physical'        — the body's real bbox is a plausible part size; it renders
   *                     at REAL size (scale 1).
   * 'nominal-fallback' — the bbox is unknown or implausible; the body is scaled
   *                     to the nominal display target. REPORTED, never silent.
   */
  sizeMode: 'physical' | 'nominal-fallback';
  /** Uniform scale to apply on top of the body's feet-space geometry. Always finite > 0. */
  scale: number;
  /** True for HEAD parts — the viewer flips the body so the deflector points down. */
  deflectorDown: boolean;
}

/** Sizing-contract inputs. */
export interface PlacementOpts {
  /**
   * The loaded body's max bounding-box dimension in FEET, or null when the body
   * has not loaded / has a degenerate bbox.
   */
  bboxMaxFt: number | null;
  /** Documented nominal display target (ft) used ONLY in nominal-fallback mode. */
  nominalTargetFt: number;
}

/** Plausible-physical-size window (ft) for a sprinkler part body. A real head is
 * ~0.2-0.3 ft; the largest fitting/valve bodies stay under ~3 ft. Outside this
 * window the bbox cannot be a real part at real scale (wrong STEP units or a
 * degenerate box), so the contract falls back — and says so. */
export const PHYSICAL_MIN_FT = 0.15;
export const PHYSICAL_MAX_FT = 3;

/** Horizontality threshold on the unit y component — matches the 0.01 cutoff
 * fitting-orient's requireHorizontal enforces, so dirs that pass here never
 * throw on horizontality there. */
const HORIZONTAL_Y_MAX = 0.01;

/**
 * Normalized directions of every segment touching `nodeId`, each pointing AWAY
 * from the node (regardless of the segment's from/to storage order).
 * Zero-length segments (coincident endpoints) and segments referencing missing
 * nodes are skipped. An unknown nodeId yields [] (no fabricated directions).
 */
export function attachedDirections(
  nodeId: string,
  nodes: Array<{ id: string; pos: { x: number; y: number; z: number } }>,
  segments: Array<{ from: string; to: string }>,
): AttachedDir[] {
  const byId = new Map<string, { x: number; y: number; z: number }>();
  for (const n of nodes) byId.set(n.id, n.pos);
  const origin = byId.get(nodeId);
  if (!origin) return [];

  const dirs: AttachedDir[] = [];
  for (const s of segments) {
    let otherId: string | null = null;
    if (s.from === nodeId) otherId = s.to;
    else if (s.to === nodeId) otherId = s.from;
    if (otherId === null) continue;
    const other = byId.get(otherId);
    if (!other) continue;
    const dx = other.x - origin.x;
    const dy = other.y - origin.y;
    const dz = other.z - origin.z;
    const len = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(len) || len < 1e-9) continue; // zero-length: skip honestly
    dirs.push({ x: dx / len, y: dy / len, z: dz / len });
  }
  return dirs;
}

/** Dot product of two AttachedDirs. */
function dot(a: AttachedDir, b: AttachedDir): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * The contracted placement (rotation + orientation + size) for one part.
 * Throws on non-finite inputs — corrupt data must fail loudly, never render
 * silently wrong.
 */
export function placementFor(
  nodeType: string,
  dirs: AttachedDir[],
  opts: PlacementOpts,
): PartPlacement {
  if (!Number.isFinite(opts.nominalTargetFt) || opts.nominalTargetFt <= 0) {
    throw new Error(`placementFor: non-finite/non-positive nominalTargetFt (${opts.nominalTargetFt})`);
  }
  if (opts.bboxMaxFt !== null && !Number.isFinite(opts.bboxMaxFt)) {
    throw new Error(`placementFor: non-finite bboxMaxFt (${opts.bboxMaxFt})`);
  }
  for (const d of dirs) {
    if (!Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.z)) {
      throw new Error(`placementFor: non-finite attached direction (${d.x}, ${d.y}, ${d.z})`);
    }
  }

  // --- SIZING CONTRACT ---
  const bbox = opts.bboxMaxFt;
  let sizeMode: PartPlacement['sizeMode'];
  let scale: number;
  if (bbox !== null && bbox >= PHYSICAL_MIN_FT && bbox <= PHYSICAL_MAX_FT) {
    sizeMode = 'physical';
    scale = 1; // the body is already real-size
  } else {
    sizeMode = 'nominal-fallback';
    // A null/zero/negative bbox carries no size information -> scale 1 against
    // the target (nominalTargetFt / nominalTargetFt). The scale is ALWAYS > 0.
    scale = opts.nominalTargetFt / (bbox !== null && bbox > 0 ? bbox : opts.nominalTargetFt);
  }

  // --- ROTATION + ORIENTATION ---
  // Re-normalize each dir ("unit-ish" in) and keep only horizontal ones; this is
  // the same horizontality window fitting-orient enforces.
  const horiz: AttachedDir[] = [];
  for (const d of dirs) {
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1e-9) continue;
    const u = { x: d.x / len, y: d.y / len, z: d.z / len };
    if (Math.abs(u.y) < HORIZONTAL_Y_MAX) horiz.push(u);
  }

  const type = nodeType.toUpperCase();
  let rotationY = 0;
  let deflectorDown = false;

  if (type === 'HEAD') {
    deflectorDown = true; // rotation stays 0; the viewer flips deflector-down
  } else if ((type === 'TEE' || type === 'CROSS') && horiz.length >= 2) {
    // Run = the pair of horizontal dirs closest to collinear (|dot| -> 1);
    // branch = the horizontal dir most orthogonal to the run.
    let runI = 0;
    let pairJ = 1;
    let bestPair = -Infinity;
    for (let i = 0; i < horiz.length; i += 1) {
      for (let j = i + 1; j < horiz.length; j += 1) {
        const a = Math.abs(dot(horiz[i], horiz[j]));
        if (a > bestPair) {
          bestPair = a;
          runI = i;
          pairJ = j;
        }
      }
    }
    const run = horiz[runI];
    let branch = horiz[pairJ];
    let bestOrth = Math.abs(dot(run, branch));
    for (let k = 0; k < horiz.length; k += 1) {
      if (k === runI) continue;
      const a = Math.abs(dot(run, horiz[k]));
      if (a < bestOrth) {
        bestOrth = a;
        branch = horiz[k];
      }
    }
    try {
      rotationY = teeRotationY(run, branch);
    } catch {
      rotationY = 0; // contract fallback: no orientable branch -> unrotated
    }
  } else if (type === 'ELBOW' && horiz.length >= 2) {
    try {
      rotationY = elbowRotationY(horiz[0], horiz[1]);
    } catch {
      rotationY = 0;
    }
  } else if ((type === 'VALVE' || type === 'SOURCE' || type === 'REDUCER') && horiz.length >= 1) {
    // Align the body's +X with the first horizontal attached dir.
    rotationY = Math.atan2(-horiz[0].z, horiz[0].x);
  }

  return { rotationY, sizeMode, scale, deflectorDown };
}
