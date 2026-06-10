// H6 Flow Calculator — solve any of {Q, K, P} from the other two via Q = K·√P.

import { describe, expect, it } from 'vitest';
import { solveFlow } from '../src/lib/flow-calculator';

describe('solveFlow — each unknown (K=5.6, P=25 -> Q=28 exactly)', () => {
  it('solves flow from K and P', () => {
    const r = solveFlow({ kFactor: 5.6, pressurePsi: 25 });
    expect(r.flowGpm).toBe(28); // 5.6 * sqrt(25) = 28 exactly
    expect(r.solvedFor).toBe('flowGpm');
    expect(r.formula).toBe('Q = K * sqrt(P)');
  });

  it('solves K from Q and P', () => {
    const r = solveFlow({ flowGpm: 28, pressurePsi: 25 });
    expect(r.kFactor).toBeCloseTo(5.6, 10);
    expect(r.solvedFor).toBe('kFactor');
  });

  it('solves P from Q and K', () => {
    const r = solveFlow({ flowGpm: 28, kFactor: 5.6 });
    expect(r.pressurePsi).toBeCloseTo(25, 10);
    expect(r.solvedFor).toBe('pressurePsi');
  });
});

describe('solveFlow — round-trip consistency', () => {
  it('derived value feeds back to reproduce the inputs', () => {
    const a = solveFlow({ kFactor: 8.0, pressurePsi: 16 }); // Q = 32
    const b = solveFlow({ flowGpm: a.flowGpm, kFactor: 8.0 });
    expect(b.pressurePsi).toBeCloseTo(16, 10);
    const c = solveFlow({ flowGpm: a.flowGpm, pressurePsi: 16 });
    expect(c.kFactor).toBeCloseTo(8.0, 10);
  });
});

describe('solveFlow — error cases', () => {
  it('throws on 0, 1, or 3 given fields', () => {
    expect(() => solveFlow({})).toThrow();
    expect(() => solveFlow({ kFactor: 5.6 })).toThrow();
    expect(() => solveFlow({ flowGpm: 28, kFactor: 5.6, pressurePsi: 25 })).toThrow();
  });

  it('throws on non-finite or non-positive values', () => {
    expect(() => solveFlow({ kFactor: -5.6, pressurePsi: 25 })).toThrow();
    expect(() => solveFlow({ kFactor: 0, pressurePsi: 25 })).toThrow();
    expect(() => solveFlow({ kFactor: 5.6, pressurePsi: Number.NaN })).toThrow();
    expect(() => solveFlow({ flowGpm: Number.POSITIVE_INFINITY, kFactor: 5.6 })).toThrow();
  });
});
