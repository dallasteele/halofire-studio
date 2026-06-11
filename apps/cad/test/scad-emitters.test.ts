import { describe, expect, it } from 'vitest';
import {
  emitPipe,
  emitElbow90,
  emitTee,
  emitCoupling,
} from '../src/lib/scad-emitters';

const HONESTY = 'Dimensioned parametric, not manufacturer-exact';

function balanced(src: string, open: string, close: string): boolean {
  let depth = 0;
  for (const ch of src) {
    if (ch === open) depth += 1;
    else if (ch === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe('emitPipe', () => {
  it('emits a hollow cylinder with honest comment and mm conversion', () => {
    const s = emitPipe({ nominalIn: 2, lengthIn: 24, odIn: 2.375, wallIn: 0.154 });
    expect(s).toContain(HONESTY);
    expect(s).toContain('$fn=64;');
    expect(s).toContain('difference()');
    // length 24in -> 609.600 mm
    expect(s).toContain('h=609.600');
    expect(balanced(s, '{', '}')).toBe(true);
    expect(balanced(s, '(', ')')).toBe(true);
  });

  it('throws RangeError on non-positive dims', () => {
    expect(() => emitPipe({ nominalIn: 2, lengthIn: 0, odIn: 2.375, wallIn: 0.154 })).toThrow(RangeError);
    expect(() => emitPipe({ nominalIn: 2, lengthIn: 24, odIn: NaN, wallIn: 0.154 })).toThrow(RangeError);
  });

  it('throws when OD is not greater than 2*wall', () => {
    expect(() => emitPipe({ nominalIn: 2, lengthIn: 24, odIn: 0.3, wallIn: 0.2 })).toThrow(
      'pipe odIn must be greater than 2 * wallIn',
    );
  });
});

describe('emitElbow90', () => {
  it('emits two runs and the rotate token', () => {
    const s = emitElbow90({ nominalIn: 2, odIn: 2.375, centerToEndIn: 2 });
    expect(s).toContain(HONESTY);
    expect(s).toContain('rotate([0, 90, 0])');
    expect((s.match(/cylinder\(/g) || []).length).toBe(2);
    // OD 2.375in -> r 1.1875in -> ~30.16 mm
    expect(s).toContain('r=30.16');
    expect(balanced(s, '(', ')')).toBe(true);
  });

  it('throws RangeError on bad dims', () => {
    expect(() => emitElbow90({ nominalIn: 2, odIn: -1, centerToEndIn: 2 })).toThrow(RangeError);
  });
});

describe('emitTee', () => {
  it('emits a run plus a rotated branch', () => {
    const s = emitTee({ nominalIn: 2, odIn: 2.375, centerToEndIn: 2, branchCenterToEndIn: 2 });
    expect(s).toContain(HONESTY);
    expect(s).toContain('union()');
    expect(s).toContain('rotate([0, 90, 0])');
    expect((s.match(/cylinder\(/g) || []).length).toBe(2);
    expect(balanced(s, '{', '}')).toBe(true);
  });

  it('throws RangeError on bad dims', () => {
    expect(() =>
      emitTee({ nominalIn: 2, odIn: 2.375, centerToEndIn: 0, branchCenterToEndIn: 2 }),
    ).toThrow(RangeError);
  });
});

describe('emitCoupling', () => {
  it('emits a solid sleeve with mm conversion', () => {
    const s = emitCoupling({ nominalIn: 2, odIn: 2.375, lengthIn: 3 });
    expect(s).toContain(HONESTY);
    // length 3in -> 76.200 mm
    expect(s).toContain('h=76.200');
    expect(balanced(s, '(', ')')).toBe(true);
  });

  it('throws RangeError on bad dims', () => {
    expect(() => emitCoupling({ nominalIn: 2, odIn: 2.375, lengthIn: 0 })).toThrow(RangeError);
  });
});
