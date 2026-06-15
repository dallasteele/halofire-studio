/**
 * Golden known-answer tests for the WATER SUPPLIES engine (Phase 3).
 *
 * Every expected value is hand-computed from the published formula (NFPA-13/AWWA
 * N^1.85 flow-test law, NFPA-20 three-point pump quadratic, margin arithmetic),
 * NOT read back from the module. If the module disagrees with the hand calc, the
 * SUPPLY MODEL IS WRONG — fix it, never the test's hand value.
 */
import { describe, it, expect } from 'vitest';
import {
  flowTestAvailablePsi,
  flowTestFlowAtPsi,
  pumpBoostPsi,
  buildSupply,
  evaluateSupply,
  evaluateSupplies,
  supplyDemandCurve,
} from '../src/engine/supplies.js';

const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

describe('city-water flow-test N^1.85 law', () => {
  const test = { staticPsi: 74, residualPsi: 58, testFlowGpm: 1200 };

  it('static pressure at zero flow', () => {
    expect(flowTestAvailablePsi(test, 0)).toBe(74);
  });

  it('residual pressure at the test flow (by definition)', () => {
    // P(Q_test) = Ps − (Ps−Pr)·(1)^1.85 = Pr exactly
    expect(near(flowTestAvailablePsi(test, 1200), 58)).toBe(true);
  });

  it('half the test flow: hand calc 74 − 16·(0.5)^1.85 = 69.562 psi', () => {
    // (0.5)^1.85 = 2^-1.85 = 0.277385; drop = 16·0.277385 = 4.4382; 74−4.4382 = 69.5618
    const got = flowTestAvailablePsi(test, 600);
    expect(near(got, 69.562, 0.01)).toBe(true);
  });

  it('1.5× test flow extrapolates below residual: 74 − 16·(1.5)^1.85 = 40.18 psi', () => {
    // (1.5)^1.85 = e^(1.85·ln1.5) = e^(0.75017) = 2.1174; drop = 16·2.1174 = 33.878; 74−33.878 = 40.122
    const got = flowTestAvailablePsi(test, 1800);
    expect(near(got, 40.12, 0.05)).toBe(true);
  });

  it('clamps at 0 — cannot deliver negative pressure', () => {
    expect(flowTestAvailablePsi(test, 100000)).toBe(0);
  });

  it('inverse: flow deliverable at the residual pressure equals the test flow', () => {
    // Preq = Pr → Q = Qt·((Ps−Pr)/(Ps−Pr))^(1/1.85) = Qt
    expect(near(flowTestFlowAtPsi(test, 58), 1200, 0.5)).toBe(true);
  });

  it('inverse: flow at 69.562 psi round-trips to 600 gpm', () => {
    expect(near(flowTestFlowAtPsi(test, 69.562), 600, 1)).toBe(true);
  });

  it('inverse: at static pressure, deliverable flow is 0', () => {
    expect(flowTestFlowAtPsi(test, 74)).toBe(0);
  });
});

describe('pump three-point quadratic (NFPA-20)', () => {
  // churn 100 psi @ 0, rated 75 psi @ 1000 gpm, overload 48.75 psi @ 1500 gpm
  const pump = { churnPsi: 100, ratedFlowGpm: 1000, ratedPsi: 75, overloadPsi: 48.75 };

  it('boost at churn (0 gpm) equals churn pressure', () => {
    expect(near(pumpBoostPsi(pump, 0), 100)).toBe(true);
  });
  it('boost at rated flow equals rated pressure (fitted point)', () => {
    expect(near(pumpBoostPsi(pump, 1000), 75)).toBe(true);
  });
  it('boost at 150% rated equals overload pressure (fitted point)', () => {
    expect(near(pumpBoostPsi(pump, 1500), 48.75)).toBe(true);
  });
  it('boost at 500 gpm (interpolated): hand-fit quadratic = 92.0833 psi', () => {
    // Fit through (0,100),(1000,75),(1500,48.75). c = 100, and the 2×2 system
    //   1e6·a + 1000·b = -25      (rated point minus c)
    //   2.25e6·a + 1500·b = -51.25 (overload point minus c)
    // Cramer: det = 1e6·1500 − 1000·2.25e6 = 1.5e9 − 2.25e9 = -0.75e9
    //   a = (-25·1500 − 1000·-51.25)/det = (-37500 + 51250)/-0.75e9 = 13750/-0.75e9 = -1.83333e-5
    //   b = (1e6·-51.25 − -25·2.25e6)/det = (-51.25e6 + 56.25e6)/-0.75e9 = 5e6/-0.75e9 = -6.66667e-3
    //   P(500) = -1.83333e-5·250000 + -6.66667e-3·500 + 100 = -4.58333 -3.33333 +100 = 92.0833
    const got = pumpBoostPsi(pump, 500);
    expect(near(got, 92.0833, 0.01)).toBe(true);
  });
});

describe('buildSupply + evaluateSupply', () => {
  it('city-water supply meets a demand below its curve', () => {
    const sup = buildSupply({ kind: 'cityWater', name: 'City', staticPsi: 74, residualPsi: 58, testFlowGpm: 1200 });
    const e = evaluateSupply(sup, { demandGpm: 600, requiredPsi: 55 });
    // available at 600 gpm = 69.562; margin = 69.562 − 55 = 14.562; met
    expect(near(e.availablePsi, 69.562, 0.02)).toBe(true);
    expect(near(e.marginPsi, 14.562, 0.02)).toBe(true);
    expect(e.demandMet).toBe(true);
  });

  it('city-water supply FAILS a demand above its curve', () => {
    const sup = buildSupply({ kind: 'cityWater', staticPsi: 74, residualPsi: 58, testFlowGpm: 1200 });
    const e = evaluateSupply(sup, { demandGpm: 600, requiredPsi: 80 });
    expect(e.demandMet).toBe(false);
    expect(e.marginPsi).toBeLessThan(0);
  });

  it('pump supply adds boost over suction', () => {
    const e = evaluateSupply({ kind: 'pump', name: 'FP', ratedFlowGpm: 1000, ratedPsi: 75, churnPsi: 100, overloadPsi: 48.75, suctionPsi: 20 }, { demandGpm: 1000, requiredPsi: 90 });
    // available = suction 20 + boost 75 = 95; margin = 95 − 90 = 5; met
    expect(near(e.availablePsi, 95, 0.05)).toBe(true);
    expect(near(e.marginPsi, 5, 0.05)).toBe(true);
    expect(e.demandMet).toBe(true);
  });

  it('tank supply reports flat pressure + drawdown duration', () => {
    const e = evaluateSupply({ kind: 'tank', name: 'Tank', availablePsi: 60, capacityGal: 3000 }, { demandGpm: 300, requiredPsi: 50 });
    expect(e.availablePsi).toBe(60);
    expect(e.demandMet).toBe(true);
    expect(e.durationMin).toBe(10); // 3000 gal / 300 gpm
  });
});

describe('evaluateSupplies — binding (governing) supply', () => {
  it('picks the least-margin supply as binding', () => {
    const demand = { demandGpm: 600, requiredPsi: 60 };
    const res = evaluateSupplies([
      { kind: 'cityWater', name: 'City', staticPsi: 74, residualPsi: 58, testFlowGpm: 1200 }, // avail 69.56 → margin 9.56
      { kind: 'tank', name: 'Tank', availablePsi: 65, capacityGal: 5000 },                    // avail 65 → margin 5
    ], demand);
    expect(res.bindingName).toBe('Tank');
    expect(near(res.marginPsi, 5, 0.05)).toBe(true);
    expect(res.demandMet).toBe(true);
    expect(res.supplies).toHaveLength(2);
  });

  it('binding supply failing makes the whole system fail', () => {
    const demand = { demandGpm: 600, requiredPsi: 68 };
    const res = evaluateSupplies([
      { kind: 'cityWater', name: 'City', staticPsi: 74, residualPsi: 58, testFlowGpm: 1200 }, // avail 69.56 → margin 1.56 (met)
      { kind: 'tank', name: 'Tank', availablePsi: 65, capacityGal: 5000 },                    // avail 65 → margin -3 (FAIL)
    ], demand);
    expect(res.bindingName).toBe('Tank');
    expect(res.demandMet).toBe(false);
  });

  it('empty supply list is honest (null binding)', () => {
    const res = evaluateSupplies([], { demandGpm: 600, requiredPsi: 60 });
    expect(res.binding).toBe(null);
    expect(res.demandMet).toBe(null);
  });
});

describe('supplyDemandCurve — graph data + operating point', () => {
  const sup = { kind: 'cityWater', name: 'City', staticPsi: 74, residualPsi: 58, testFlowGpm: 1200 };

  it('supply curve passes through static at Q=0', () => {
    const g = supplyDemandCurve(sup, { demandGpm: 600, requiredPsi: 60 }, { samples: 12, maxFlowGpm: 1200 });
    expect(g.supplyCurve[0].flowGpm).toBe(0);
    expect(g.supplyCurve[0].psi).toBe(74);
  });

  it('demand curve passes through the design point (Q_d, P_req)', () => {
    const g = supplyDemandCurve(sup, { demandGpm: 600, requiredPsi: 60 }, { samples: 24, maxFlowGpm: 1200 });
    // at Q = 600 (i=12 of 24 over 0..1200), demand psi = 60·(600/600)^1.85 = 60
    const at600 = g.demandCurve.find((p) => Math.abs(p.flowGpm - 600) < 1);
    expect(near(at600.psi, 60, 0.1)).toBe(true);
  });

  it('operating point is where supply meets demand (supply≥demand at design here)', () => {
    // design point 600 gpm @ 60 psi; supply at 600 = 69.56 > 60 → operating point
    // is at a HIGHER flow where the rising demand curve crosses the falling supply.
    const g = supplyDemandCurve(sup, { demandGpm: 600, requiredPsi: 60 }, { samples: 40, maxFlowGpm: 1500 });
    expect(g.operatingPoint).not.toBe(null);
    expect(g.operatingPoint.flowGpm).toBeGreaterThan(600);
    // at the operating point, supply psi ≈ demand psi
    const dem = 60 * Math.pow(g.operatingPoint.flowGpm / 600, 1.85);
    expect(near(g.operatingPoint.psi, dem, 0.5)).toBe(true);
  });
});
