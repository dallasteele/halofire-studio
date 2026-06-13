/**
 * Plain-JS port of the parametric OpenSCAD source emitters (AS-3).
 *
 * CANONICAL SOURCE: apps/cad/src/lib/scad-emitters.ts (W13A) — this file is an
 * EXACT port of that TypeScript module so the autosprink server can emit the
 * same deterministic OpenSCAD without a TS build step. If the canonical file
 * changes, re-port it here (the scad-emitters-port parity test pins emitTee).
 *
 * Each emitter returns a complete, deterministic OpenSCAD source string for a
 * best-effort fitting body. Doctrine: these are dimensioned-parametric models,
 * NOT manufacturer-exact — the honesty comment says so in every file, and the
 * part inspector flags them needs-verification. All emitted dimensions are in
 * millimeters (inches * 25.4, 3 decimals).
 */

const MM_PER_IN = 25.4;
const HONESTY = '// Dimensioned parametric, not manufacturer-exact — verify against the cut sheet.';

function mm(inches) {
  return (inches * MM_PER_IN).toFixed(3);
}

function requirePositive(label, ...values) {
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new RangeError(`${label} must be a finite positive number`);
    }
  }
}

/** Straight pipe: hollow cylinder (OD bore minus 2*wall). */
export function emitPipe(opts) {
  const { nominalIn, lengthIn, odIn, wallIn } = opts;
  requirePositive('pipe dims', nominalIn, lengthIn, odIn, wallIn);
  if (odIn <= 2 * wallIn) {
    throw new Error('pipe odIn must be greater than 2 * wallIn');
  }
  const h = mm(lengthIn);
  const rOuter = mm(odIn / 2);
  const rInner = mm(odIn / 2 - wallIn);
  return [
    HONESTY,
    `// pipe nominal ${nominalIn}in, length ${lengthIn}in, OD ${odIn}in`,
    '$fn=64;',
    'difference() {',
    `  cylinder(h=${h}, r=${rOuter}, center=true);`,
    `  cylinder(h=${h} + 1, r=${rInner}, center=true);`,
    '}',
    '',
  ].join('\n');
}

/** 90-degree elbow: two runs meeting at the origin, rotated 90 apart. */
export function emitElbow90(opts) {
  const { nominalIn, odIn, centerToEndIn } = opts;
  requirePositive('elbow dims', nominalIn, odIn, centerToEndIn);
  const r = mm(odIn / 2);
  const run = mm(centerToEndIn);
  return [
    HONESTY,
    `// 90 elbow nominal ${nominalIn}in, OD ${odIn}in, center-to-end ${centerToEndIn}in`,
    '$fn=64;',
    'union() {',
    `  cylinder(h=${run}, r=${r});`,
    `  rotate([0, 90, 0]) cylinder(h=${run}, r=${r});`,
    '}',
    '',
  ].join('\n');
}

/** Tee: a run along Z (both directions) with a branch along X. */
export function emitTee(opts) {
  const { nominalIn, odIn, centerToEndIn, branchCenterToEndIn } = opts;
  requirePositive('tee dims', nominalIn, odIn, centerToEndIn, branchCenterToEndIn);
  const r = mm(odIn / 2);
  const run = mm(2 * centerToEndIn);
  const branch = mm(branchCenterToEndIn);
  return [
    HONESTY,
    `// tee nominal ${nominalIn}in, OD ${odIn}in, run ${centerToEndIn}in, branch ${branchCenterToEndIn}in`,
    '$fn=64;',
    'union() {',
    `  cylinder(h=${run}, r=${r}, center=true);`,
    `  rotate([0, 90, 0]) cylinder(h=${branch}, r=${r});`,
    '}',
    '',
  ].join('\n');
}

/** Coupling: a short solid sleeve (OD cylinder). */
export function emitCoupling(opts) {
  const { nominalIn, odIn, lengthIn } = opts;
  requirePositive('coupling dims', nominalIn, odIn, lengthIn);
  const h = mm(lengthIn);
  const r = mm(odIn / 2);
  return [
    HONESTY,
    `// coupling nominal ${nominalIn}in, OD ${odIn}in, length ${lengthIn}in`,
    '$fn=64;',
    `cylinder(h=${h}, r=${r}, center=true);`,
    '',
  ].join('\n');
}
