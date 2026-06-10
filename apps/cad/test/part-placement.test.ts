// Part PLACEMENT CONTRACT (pure) — every rendered part gets a contracted
// rotation, orientation, and size. Rotation math delegates to fitting-orient
// (STEP bodies modeled run=+X, branch=+Z); sizing is the hard physical-vs-
// nominal-fallback contract (fake sizing is never silent).

import { describe, expect, it } from 'vitest';
import {
  attachedDirections,
  placementFor,
  PHYSICAL_MAX_FT,
  PHYSICAL_MIN_FT,
} from '../src/lib/part-placement';
import { elbowRotationY, teeRotationY } from '../src/lib/fitting-orient';

const X = { x: 1, y: 0, z: 0 };
const NX = { x: -1, y: 0, z: 0 };
const Z = { x: 0, y: 0, z: 1 };
const DOWN = { x: 0, y: -1, z: 0 };

const SIZING = { bboxMaxFt: null, nominalTargetFt: 0.8 };

describe('attachedDirections', () => {
  const nodes = [
    { id: 'A', pos: { x: 10, y: 10, z: 5 } },
    { id: 'B', pos: { x: 17, y: 10, z: 5 } }, // +X of A
    { id: 'C', pos: { x: 10, y: 10, z: 14 } }, // +Z of A
    { id: 'D', pos: { x: 10, y: 10, z: 5 } }, // coincident with A (zero-length)
    { id: 'E', pos: { x: 10, y: 4, z: 5 } }, // straight below A
  ];

  it('returns unit directions pointing AWAY from the node regardless of from/to order', () => {
    const segments = [
      { from: 'A', to: 'B' }, // stored away from A
      { from: 'C', to: 'A' }, // stored INTO A — must still point away (toward C)
      { from: 'A', to: 'E' },
    ];
    const dirs = attachedDirections('A', nodes, segments);
    expect(dirs).toHaveLength(3);
    for (const d of dirs) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
    }
    expect(dirs[0]).toEqual({ x: 1, y: 0, z: 0 }); // toward B
    expect(dirs[1]).toEqual({ x: 0, y: 0, z: 1 }); // toward C, away from A
    expect(dirs[2]).toEqual({ x: 0, y: -1, z: 0 }); // straight down toward E
  });

  it('skips zero-length segments and unknown endpoints; unknown node yields []', () => {
    const segments = [
      { from: 'A', to: 'D' }, // coincident -> zero-length, skipped
      { from: 'A', to: 'GHOST' }, // missing endpoint, skipped
      { from: 'B', to: 'C' }, // does not touch A
    ];
    expect(attachedDirections('A', nodes, segments)).toEqual([]);
    expect(attachedDirections('NOPE', nodes, segments)).toEqual([]);
  });
});

describe('placementFor — rotation contract', () => {
  it('TEE with run ±X and branch +Z rotates 0 (matches analytic teeRotationY)', () => {
    const p = placementFor('TEE', [X, NX, Z], SIZING);
    // Run pair = (X, NX); run = X (first of the most-collinear pair); branch = Z.
    expect(p.rotationY).toBeCloseTo(teeRotationY(X, Z), 12);
    expect(p.rotationY).toBeCloseTo(0, 12);
    expect(p.deflectorDown).toBe(false);
  });

  it('TEE picks the most orthogonal HORIZONTAL dir as the branch', () => {
    // Run along Z, branch toward +X: rotation aligns body +X with the Z run.
    const p = placementFor('TEE', [Z, { x: 0, y: 0, z: -1 }, X], SIZING);
    expect(p.rotationY).toBeCloseTo(teeRotationY(Z, X), 12);
    expect(p.rotationY).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('TEE with only a parallel branch candidate falls back to rotation 0', () => {
    // Through-run tee whose branch leg was a zero-length tap: only ±X dirs.
    const p = placementFor('TEE', [X, NX], SIZING);
    expect(p.rotationY).toBe(0);
  });

  it('CROSS uses the same run/branch solve as TEE', () => {
    const p = placementFor('CROSS', [X, NX, Z, { x: 0, y: 0, z: -1 }], SIZING);
    expect(p.rotationY).toBeCloseTo(teeRotationY(X, Z), 12);
  });

  it('ELBOW turning +Z rotates -PI/2 (matches analytic elbowRotationY)', () => {
    const p = placementFor('ELBOW', [Z, NX], SIZING);
    expect(p.rotationY).toBeCloseTo(elbowRotationY(Z, NX), 12);
    expect(p.rotationY).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('ELBOW with fewer than 2 horizontal dirs keeps rotation 0 (vertical out of scope)', () => {
    expect(placementFor('ELBOW', [X, DOWN], SIZING).rotationY).toBe(0);
    expect(placementFor('ELBOW', [DOWN], SIZING).rotationY).toBe(0);
    expect(placementFor('ELBOW', [], SIZING).rotationY).toBe(0);
  });

  it('VALVE / SOURCE / REDUCER align +X to the first horizontal dir', () => {
    for (const t of ['VALVE', 'SOURCE', 'REDUCER']) {
      expect(placementFor(t, [Z], SIZING).rotationY).toBeCloseTo(-Math.PI / 2, 12);
      expect(placementFor(t, [X], SIZING).rotationY).toBeCloseTo(0, 12);
      // Vertical-only attachment -> no horizontal solve -> 0.
      expect(placementFor(t, [DOWN], SIZING).rotationY).toBe(0);
      // First HORIZONTAL dir wins even when a vertical dir comes first.
      expect(placementFor(t, [DOWN, Z], SIZING).rotationY).toBeCloseTo(-Math.PI / 2, 12);
    }
  });

  it('HEAD is deflector-down with rotation 0', () => {
    const p = placementFor('HEAD', [DOWN], SIZING);
    expect(p.deflectorDown).toBe(true);
    expect(p.rotationY).toBe(0);
  });
});

describe('placementFor — SIZING CONTRACT', () => {
  const target = 0.8;

  it('plausible physical bbox renders at REAL size (scale 1, mode physical)', () => {
    for (const bbox of [PHYSICAL_MIN_FT, 0.25, 0.9, PHYSICAL_MAX_FT]) {
      const p = placementFor('TEE', [], { bboxMaxFt: bbox, nominalTargetFt: target });
      expect(p.sizeMode).toBe('physical');
      expect(p.scale).toBe(1);
    }
  });

  it('implausible bbox falls back to the nominal target — and SAYS so', () => {
    const tooSmall = placementFor('TEE', [], { bboxMaxFt: 0.1, nominalTargetFt: target });
    expect(tooSmall.sizeMode).toBe('nominal-fallback');
    expect(tooSmall.scale).toBeCloseTo(target / 0.1, 12);

    const tooBig = placementFor('TEE', [], { bboxMaxFt: 10, nominalTargetFt: target });
    expect(tooBig.sizeMode).toBe('nominal-fallback');
    expect(tooBig.scale).toBeCloseTo(target / 10, 12);
  });

  it('unknown bbox (null / zero) reports fallback with scale 1 — never invents a size', () => {
    const unknown = placementFor('HEAD', [], { bboxMaxFt: null, nominalTargetFt: target });
    expect(unknown.sizeMode).toBe('nominal-fallback');
    expect(unknown.scale).toBe(1);

    const zero = placementFor('HEAD', [], { bboxMaxFt: 0, nominalTargetFt: target });
    expect(zero.sizeMode).toBe('nominal-fallback');
    expect(zero.scale).toBe(1);
  });

  it('scale is always finite and > 0', () => {
    for (const bbox of [null, 0, 0.001, 0.1, 0.5, 2.99, 3, 100]) {
      const p = placementFor('ELBOW', [X, Z], { bboxMaxFt: bbox, nominalTargetFt: target });
      expect(Number.isFinite(p.scale)).toBe(true);
      expect(p.scale).toBeGreaterThan(0);
    }
  });

  it('throws on non-finite inputs (corrupt data fails loudly)', () => {
    expect(() => placementFor('TEE', [], { bboxMaxFt: NaN, nominalTargetFt: target })).toThrow();
    expect(() => placementFor('TEE', [], { bboxMaxFt: Infinity, nominalTargetFt: target })).toThrow();
    expect(() => placementFor('TEE', [], { bboxMaxFt: null, nominalTargetFt: NaN })).toThrow();
    expect(() => placementFor('TEE', [], { bboxMaxFt: null, nominalTargetFt: 0 })).toThrow();
    expect(() => placementFor('TEE', [], { bboxMaxFt: null, nominalTargetFt: -1 })).toThrow();
    expect(() =>
      placementFor('TEE', [{ x: NaN, y: 0, z: 0 }], { bboxMaxFt: null, nominalTargetFt: target }),
    ).toThrow();
  });
});
