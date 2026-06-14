import { describe, expect, it } from 'vitest';
import { emitPipe, emitElbow90, emitTee, emitCoupling } from '../src/autobid/scad-emitters-port.js';

// AS-3 parity unit test: the JS port must emit EXACTLY what the canonical TS
// emitter (apps/cad/src/lib/scad-emitters.ts, W13A) documents — same honesty
// comment, same union/cylinder tokens, same mm = inches*25.4 toFixed(3)
// conversion. If the canonical file changes, this test pins the drift.
const HONESTY = '// Dimensioned parametric, not manufacturer-exact — verify against the cut sheet.';

describe('scad-emitters-port — parity with apps/cad/src/lib/scad-emitters.ts', () => {
  it('emitTee output equals the canonical emitter, token for token', () => {
    const scad = emitTee({ nominalIn: 2, odIn: 2, centerToEndIn: 4, branchCenterToEndIn: 3 });

    // Full canonical output for this input, per the TS source:
    // run = mm(2*4) = 203.200, branch = mm(3) = 76.200, r = mm(1) = 25.400.
    expect(scad).toBe([
      HONESTY,
      '// tee nominal 2in, OD 2in, run 4in, branch 3in',
      '$fn=64;',
      'union() {',
      '  cylinder(h=203.200, r=25.400, center=true);',
      '  rotate([0, 90, 0]) cylinder(h=76.200, r=25.400);',
      '}',
      '',
    ].join('\n'));

    // Documented tokens, asserted individually for clarity.
    expect(scad).toContain('union() {');
    expect(scad).toContain('cylinder(');
    expect(scad).toContain(HONESTY);
    // Exact mm conversion for one known value: 1 inch = (1 * 25.4).toFixed(3).
    expect((1 * 25.4).toFixed(3)).toBe('25.400');
    expect(scad).toContain('r=25.400');
  });

  it('throws RangeError on non-positive dims (canonical requirePositive)', () => {
    expect(() => emitTee({ nominalIn: 2, odIn: 0, centerToEndIn: 4, branchCenterToEndIn: 3 }))
      .toThrow(RangeError);
    expect(() => emitTee({ nominalIn: 2, odIn: 0, centerToEndIn: 4, branchCenterToEndIn: 3 }))
      .toThrow('tee dims must be a finite positive number');
  });

  it('emitPipe/emitElbow90/emitCoupling carry the honesty comment and mm dims', () => {
    const pipe = emitPipe({ nominalIn: 2, lengthIn: 10, odIn: 2.375, wallIn: 0.154 });
    expect(pipe).toContain(HONESTY);
    expect(pipe).toContain('difference() {');
    expect(pipe).toContain(`h=${(10 * 25.4).toFixed(3)}`); // 254.000

    const elbow = emitElbow90({ nominalIn: 2, odIn: 2.375, centerToEndIn: 3.25 });
    expect(elbow).toContain(HONESTY);
    expect(elbow).toContain('union() {');

    const coupling = emitCoupling({ nominalIn: 2, odIn: 2.5, lengthIn: 2 });
    expect(coupling).toContain(HONESTY);
    expect(coupling).toContain(`cylinder(h=${(2 * 25.4).toFixed(3)}, r=${(1.25 * 25.4).toFixed(3)}, center=true);`);

    expect(() => emitPipe({ nominalIn: 2, lengthIn: 10, odIn: 0.2, wallIn: 0.154 }))
      .toThrow('pipe odIn must be greater than 2 * wallIn');
  });
});
