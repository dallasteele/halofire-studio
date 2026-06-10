// W4C — fitting orientation at junctions (PURE quaternion-free Y-rotation math).
//
// Fitting STEP bodies are modeled with the primary run along +X and the branch
// along +Z. For horizontal pipe runs (the wet-system common case) the placement
// rotation is a single rotation about world Y. Vertical/sloped runs are the
// documented follow-up (full quaternion alignment).

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Normalize a vector; throws on (near-)zero length. */
export function normalize(v: V3): V3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!Number.isFinite(len) || len < 1e-9) {
    throw new Error(`normalize: zero-length or non-finite vector (${v.x}, ${v.y}, ${v.z})`);
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function requireHorizontal(v: V3, label: string): V3 {
  const n = normalize(v);
  if (Math.abs(n.y) >= 0.01) {
    throw new Error(`${label}: non-horizontal direction (y component ${n.y.toFixed(3)})`);
  }
  return n;
}

/**
 * Rotation about world Y (radians) aligning an elbow's +X leg with dirA.
 * dirB is accepted for signature symmetry/validation (must also be horizontal).
 */
export function elbowRotationY(dirA: V3, dirB: V3): number {
  const a = requireHorizontal(dirA, 'elbowRotationY dirA');
  requireHorizontal(dirB, 'elbowRotationY dirB');
  return Math.atan2(-a.z, a.x);
}

/**
 * Rotation about world Y (radians) aligning a tee's run (+X) with runDir.
 * Throws when branchDir is parallel to runDir (no tee geometry possible).
 */
export function teeRotationY(runDir: V3, branchDir: V3): number {
  const run = requireHorizontal(runDir, 'teeRotationY runDir');
  const branch = requireHorizontal(branchDir, 'teeRotationY branchDir');
  const dot = run.x * branch.x + run.y * branch.y + run.z * branch.z;
  if (Math.abs(dot) > 0.99) {
    throw new Error('teeRotationY: branchDir is parallel to runDir');
  }
  return Math.atan2(-run.z, run.x);
}

/** True when the angle between a and b is within tolDeg of 90°. */
export function isOrthogonal(a: V3, b: V3, tolDeg = 5): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  const dot = na.x * nb.x + na.y * nb.y + na.z * nb.z;
  const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
  return Math.abs(angleDeg - 90) <= tolDeg;
}
