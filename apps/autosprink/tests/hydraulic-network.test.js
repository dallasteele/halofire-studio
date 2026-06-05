import { describe, expect, it } from 'vitest';
import {
  kFactorFlow,
  balanceNetwork,
} from '../src/engine/hydraulic-network.js';
import {
  hazenWilliamsLossPsiPerFt,
  requiredPressureAtRiser,
} from '../src/engine/hydraulics.js';
import { buildRoomCad } from '../src/engine/cad-model.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

// --- K-factor head discharge: Q = K * sqrt(P) -----------------------------
describe('kFactorFlow (Q = K * sqrt(P))', () => {
  it('K=5.6 at 7 psi -> 14.81 gpm (hand-computed: 5.6*sqrt(7))', () => {
    // 5.6 * sqrt(7) = 5.6 * 2.6457513110645907 = 14.816207...
    expect(kFactorFlow(5.6, 7)).toBeCloseTo(14.81620734, 7);
  });

  it('K=5.6 at 20 psi -> 25.04 gpm (5.6*sqrt(20))', () => {
    // 5.6 * sqrt(20) = 5.6 * 4.47213595... = 25.04396135
    expect(kFactorFlow(5.6, 20)).toBeCloseTo(25.04396135, 7);
  });

  it('K=8.0 at 7 psi -> 21.16 gpm (8*sqrt(7))', () => {
    expect(kFactorFlow(8.0, 7)).toBeCloseTo(21.16601, 5);
  });

  it('is zero at zero pressure and rises with pressure', () => {
    expect(kFactorFlow(5.6, 0)).toBe(0);
    expect(kFactorFlow(5.6, 50)).toBeGreaterThan(kFactorFlow(5.6, 20));
  });

  it('rejects non-positive K-factor', () => {
    expect(() => kFactorFlow(0, 7)).toThrow();
  });

  it('treats negative pressure as no flow (0)', () => {
    expect(kFactorFlow(5.6, -3)).toBe(0);
  });
});

// --- single head, single segment ------------------------------------------
describe('balanceNetwork — single head', () => {
  // One head, K=5.6, sitting at 7 psi on a stub of negligible friction and
  // no elevation. Q = 5.6*sqrt(7) = 14.816 gpm; required source psi = 7 (no
  // friction, no elevation), totalDemand = the single head flow.
  const network = {
    headZ: 0,
    branchZ: 0,
    mainZ: 0,
    mainX: 0,
    branchLines: [
      // a single head at x=0; zero-length branch -> no friction
      { row: 0, y: 0, startX: 0, endX: 0, headCount: 1, diameterIn: 1.0, heads: [{ x: 0, y: 0 }] },
    ],
  };

  it('discharges Q=K*sqrt(P)=14.81 gpm at the remote head', () => {
    const r = balanceNetwork({ network, hazard: 'light', kFactor: 5.6, minHeadPressurePsi: 7 });
    expect(r.heads).toHaveLength(1);
    expect(r.heads[0].flowGpm).toBeCloseTo(14.816, 2);
    expect(r.heads[0].pressurePsi).toBeCloseTo(7, 6);
  });

  it('total demand equals the single head flow', () => {
    const r = balanceNetwork({ network, hazard: 'light', kFactor: 5.6, minHeadPressurePsi: 7 });
    expect(r.totalDemandGpm).toBeCloseTo(14.816, 2);
  });

  it('required source psi = remote head pressure with no friction or elevation', () => {
    const r = balanceNetwork({ network, hazard: 'light', kFactor: 5.6, minHeadPressurePsi: 7 });
    // no friction (zero-length), no elevation (headZ 0) -> source psi == 7
    expect(r.requiredSourcePsi).toBeCloseTo(7, 4);
  });

  it('labels the result a best-effort estimate, NOT a stamped calc', () => {
    const r = balanceNetwork({ network, hazard: 'light', kFactor: 5.6 });
    expect(typeof r.disclaimer).toBe('string');
    expect(r.disclaimer.toLowerCase()).toContain('not');
    expect(r.balanced).toBe(true);
  });
});

// --- two heads on a branch: demand sums, downstream pressure rises ---------
describe('balanceNetwork — two-head branch', () => {
  // Two heads, K=5.6. Remote head starts at 7 psi -> 14.816 gpm.
  // Segment from the next head to the remote head carries 14.816 gpm over a
  // pipe; the upstream head sees a HIGHER pressure (7 + friction over that
  // segment), so it flows MORE. Total demand = sum of the two head flows.
  const segLenFt = 10;
  const dia = 1.049; // 1" sch40 ID
  const C = 120;
  const network = {
    headZ: 0,
    branchZ: 0,
    mainZ: 0,
    mainX: 0,
    branchLines: [
      {
        row: 0,
        y: 0,
        startX: 0,
        endX: segLenFt,
        headCount: 2,
        diameterIn: dia,
        heads: [{ x: 0, y: 0 }, { x: segLenFt, y: 0 }],
      },
    ],
  };

  it('the upstream head flows more than the remote head', () => {
    const r = balanceNetwork({ network, hazard: 'light', kFactor: 5.6, C, minHeadPressurePsi: 7 });
    expect(r.heads).toHaveLength(2);
    const remote = r.heads[0];
    const upstream = r.heads[1];
    expect(remote.pressurePsi).toBeCloseTo(7, 6);
    expect(upstream.pressurePsi).toBeGreaterThan(7);
    expect(upstream.flowGpm).toBeGreaterThan(remote.flowGpm);
  });

  it('total demand = sum of the per-head flows (hand-checked)', () => {
    const r = balanceNetwork({ network, hazard: 'light', kFactor: 5.6, C, minHeadPressurePsi: 7 });
    // Remote head: Q1 = 5.6*sqrt(7) = 14.81620734 gpm.
    const q1 = 5.6 * Math.sqrt(7);
    // Friction over the 10 ft, 1.049" pipe carrying q1 gpm:
    const dp = hazenWilliamsLossPsiPerFt(q1, dia, C) * segLenFt;
    const p2 = 7 + dp; // upstream head pressure (no elevation)
    const q2 = 5.6 * Math.sqrt(p2);
    const expectedTotal = q1 + q2;
    expect(r.totalDemandGpm).toBeCloseTo(expectedTotal, 3);
    expect(r.heads[0].flowGpm).toBeCloseTo(q1, 3);
    expect(r.heads[1].flowGpm).toBeCloseTo(q2, 3);
  });

  it('required source psi = remote head pressure + cumulative friction (no elevation here)', () => {
    const r = balanceNetwork({ network, hazard: 'light', kFactor: 5.6, C, minHeadPressurePsi: 7 });
    // Source sees the most-upstream node pressure. With both heads on one
    // branch and the source tie at the upstream head, source psi == p2.
    const q1 = 5.6 * Math.sqrt(7);
    const dp = hazenWilliamsLossPsiPerFt(q1, dia, C) * segLenFt;
    const p2 = 7 + dp;
    expect(r.requiredSourcePsi).toBeCloseTo(p2, 3);
  });
});

// --- elevation adds 0.433 psi/ft to the required source pressure ----------
describe('balanceNetwork — elevation', () => {
  // mainZ/branchZ at 0 (no riser/main-tie friction) isolates the head
  // elevation lift; the single zero-length head branch has no branch friction.
  const network = {
    headZ: 12,
    branchZ: 0,
    mainZ: 0,
    mainX: 0,
    branchLines: [
      { row: 0, y: 0, startX: 0, endX: 0, headCount: 1, diameterIn: 1.0, heads: [{ x: 0, y: 0 }] },
    ],
  };

  it('required source psi includes 0.433 psi/ft of head elevation', () => {
    const r = balanceNetwork({ network, hazard: 'light', kFactor: 5.6, minHeadPressurePsi: 7 });
    // 7 psi at the head + 0.433*12 ft of lift to the head = 7 + 5.196 = 12.196
    expect(r.requiredSourcePsi).toBeCloseTo(7 + 0.433 * 12, 2);
  });
});

// --- works off a real cadModel and stays consistent with the single-path est ---
describe('balanceNetwork — real cadModel', () => {
  const room = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };
  const cad = buildRoomCad(room);

  it('accepts a cadModel and returns per-head node flows', () => {
    const r = balanceNetwork({ cadModel: cad, hazard: 'light', kFactor: 5.6 });
    expect(r.heads.length).toBeGreaterThan(0);
    expect(r.totalDemandGpm).toBeGreaterThan(0);
    expect(r.requiredSourcePsi).toBeGreaterThan(0);
    for (const h of r.heads) {
      expect(h.flowGpm).toBeGreaterThan(0);
      expect(h.pressurePsi).toBeGreaterThan(0);
      expect(typeof h.node).toBe('string');
    }
  });

  it('segments carry node-by-node accumulated flow', () => {
    const r = balanceNetwork({ cadModel: cad, hazard: 'light', kFactor: 5.6 });
    expect(Array.isArray(r.segments)).toBe(true);
    expect(r.segments.length).toBeGreaterThan(0);
    for (const s of r.segments) {
      expect(s.flowGpm).toBeGreaterThanOrEqual(0);
    }
  });

  it('required source psi is at least the most-remote head operating pressure', () => {
    const r = balanceNetwork({ cadModel: cad, hazard: 'light', kFactor: 5.6, minHeadPressurePsi: 7 });
    expect(r.requiredSourcePsi).toBeGreaterThanOrEqual(7);
  });
});

// --- backward compat: T2 single-path API is untouched ---------------------
describe('backward compat — requiredPressureAtRiser still works', () => {
  const room = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };
  const cad = buildRoomCad(room);
  it('single-path estimate unchanged', () => {
    const r = requiredPressureAtRiser({ cadModel: cad, hazard: 'light' });
    expect(r.requiredFlowGpm).toBeCloseTo(150, 6);
    expect(r.segments.length).toBeGreaterThan(0);
  });
});
