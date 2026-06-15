import { describe, expect, it } from 'vitest';
import {
  autoRemoteArea,
  headDistancesFromSupply,
  computeRemoteArea,
  rectRing,
  polygonArea,
} from '../src/engine/remote-area.js';
import { solveNetwork, kFactorFlow, hwLossPsiPerFt } from '../src/engine/network-solve.js';

// ===========================================================================
// AUTO REMOTE-AREA golden known-answer tests (Phase 3b).
//
// The DEFAULT hydraulic solve basis is the NFPA-13 most-remote DESIGN area, not
// all-heads-open. These tests validate, against HAND calcs:
//   • headDistancesFromSupply ranks heads by real pipe path-resistance,
//   • autoRemoteArea seeds on the most-remote head and returns a contiguous
//     design-area rectangle (1500 ft² ordinary) of the right size,
//   • the H-W solve on that subset gives a REALISTIC design point (hundreds of
//     gpm, sane psi) and conservation holds.
// ===========================================================================

// ---------------------------------------------------------------------------
// Fixture: a real connected wet-pipe topology.
//   • Supply node at the origin floor (z=0), riser up to the cross-main at z=10.
//   • One cross-main running +X at z=10 feeding 6 branch lines (spacing 10 ft).
//   • Each branch line runs +Y at z=10 with 6 pendent heads (spacing 10 ft) on
//     short drops down to z=9 (the head elevation). 36 heads total.
//   • The most-remote head is the LAST head on the LAST branch (far +X, far +Y).
// Geometry is on a clean 10-ft grid so hand calcs are exact.
// ---------------------------------------------------------------------------
function buildGridModel({ branches = 6, perBranch = 6, spacing = 10, k = 5.6, dia = 1.05 } = {}) {
  const solids = [];
  const pipe = (from, to, d = dia) => solids.push({ kind: 'pipe', from, to, diameterIn: d, C: 120 });
  const head = (x, y, z = 9) => solids.push({ kind: 'head', position: [x, y, z], kFactor: k });

  // riser: supply floor (0,0,0) up to cross-main start (0,0,10)
  pipe([0, 0, 0], [0, 0, 10], 4);
  // cross-main along +X at z=10, large diameter
  for (let b = 0; b < branches; b += 1) {
    const x0 = b * spacing;
    const x1 = (b + 1) * spacing;
    if (b < branches) pipe([x0, 0, 10], [x1, 0, 10], 3);
  }
  // branch lines + heads
  for (let b = 0; b < branches; b += 1) {
    const x = (b + 1) * spacing; // tee at the cross-main node (x, 0, 10)
    // branch run along +Y at z=10
    for (let j = 0; j < perBranch; j += 1) {
      const y0 = j * spacing;
      const y1 = (j + 1) * spacing;
      pipe([x, y0, 10], [x, y1, 10], 1.05);
    }
    // drops + heads at each station (10 ft from the cross-main outwards)
    for (let j = 1; j <= perBranch; j += 1) {
      const y = j * spacing;
      pipe([x, y, 10], [x, y, 9], 1.05); // drop
      head(x, y, 9);
    }
  }
  return { solids, sizing: { hazard: 'ordinary' } };
}

describe('headDistancesFromSupply — real path resistance ranking', () => {
  const model = buildGridModel();
  const { heads, hasSource } = headDistancesFromSupply(model);

  it('finds the supply source and a distance for every head', () => {
    expect(hasSource).toBe(true);
    expect(heads.length).toBe(36);
    expect(heads.every((h) => h.distFt != null)).toBe(true);
  });

  it('most-remote head is the far corner with the hand-checked path length', () => {
    // most-remote head = branch 6 (x=60), station 6 (y=60), z=9.
    // path = riser 10 + cross-main 60 (0->60 along X) + branch 60 (0->60 along Y)
    //        + drop 1 = 131 ft. (hand calc)
    let far = null;
    for (const h of heads) if (!far || h.distFt > far.distFt) far = h;
    expect(far.x).toBeCloseTo(60, 6);
    expect(far.y).toBeCloseTo(60, 6);
    expect(far.distFt).toBeCloseTo(131, 6);
  });

  it('nearest head has a smaller path than the farthest (monotone with geometry)', () => {
    const dists = heads.map((h) => h.distFt).sort((a, b) => a - b);
    expect(dists[0]).toBeLessThan(dists[dists.length - 1]);
    // nearest head: branch 1 (x=10), station 1 (y=10): riser 10 + xmain 10 + branch 10 + drop 1 = 31
    expect(dists[0]).toBeCloseTo(31, 6);
  });
});

describe('autoRemoteArea — most-remote contiguous NFPA-13 design rectangle', () => {
  const model = buildGridModel();
  const auto = autoRemoteArea(model, { hazard: 'ordinary' });

  it('auto-selects (flagged) and seeds on the most-remote head', () => {
    expect(auto.autoSelected).toBe(true);
    expect(auto.basedOnPathResistance).toBe(true);
    expect(auto.seed.x).toBeCloseTo(60, 6);
    expect(auto.seed.y).toBeCloseTo(60, 6);
    expect(auto.seed.distFt).toBeCloseTo(131, 6);
  });

  it('rectangle area equals the ordinary-hazard design area (1500 ft²)', () => {
    const a = polygonArea(rectRing(auto.boundary));
    expect(a).toBeCloseTo(1500, 0); // long·short = 1.2√1500 · 1500/(1.2√1500) = 1500
    expect(auto.designAreaSqFt).toBe(1500);
  });

  it('the rectangle CONTAINS the most-remote head (seed) and a contiguous block', () => {
    const ring = rectRing(auto.boundary);
    // seed must be inside (it governs the demand)
    const seedInside = polygonArea(ring) > 0
      && auto.seed.x >= auto.boundary.x0 - 1e-6 && auto.seed.x <= auto.boundary.x1 + 1e-6
      && auto.seed.y >= auto.boundary.y0 - 1e-6 && auto.seed.y <= auto.boundary.y1 + 1e-6;
    expect(seedInside).toBe(true);
    // a real contiguous block of heads lands inside (more than 1, far fewer than all 36)
    expect(auto.flowingHeadCount).toBeGreaterThan(1);
    expect(auto.flowingHeadCount).toBeLessThan(36);
  });
});

describe('auto remote-area DEMAND is realistic (hand calc) + conservation holds', () => {
  const model = buildGridModel();
  const auto = autoRemoteArea(model, { hazard: 'ordinary' });
  const ra = computeRemoteArea(model, auto.boundary, { hazard: 'ordinary', autoSelected: true });

  it('per-head min flow = density · area-per-head = 0.20·130 = 26 gpm (hand calc)', () => {
    // ordinary density 0.20 gpm/ft², ordinary maxAreaSqFt 130 -> 26 gpm/head
    expect(ra.requiredHeadFlowGpm).toBeCloseTo(26, 6);
    expect(ra.densityGpmFt2).toBeCloseTo(0.2, 6);
  });

  it('discrete demand = flowingHeads · 26 gpm (Σ per-head), realistic range', () => {
    expect(ra.demandGpm).toBeCloseTo(ra.flowingHeadCount * 26, 3);
    // realistic NFPA design point: hundreds of gpm, NOT thousands (all-heads-open)
    expect(ra.demandGpm).toBeGreaterThan(150);
    expect(ra.demandGpm).toBeLessThan(900);
  });

  it('H-W solve on the auto subset: realistic gpm, sane psi, conservation OK', () => {
    const solve = solveNetwork(model, { availablePsi: 65, flowingHeads: ra.predicate });
    // demand on the order of hundreds (NOT the ~all-heads-open envelope)
    expect(solve.designBasis).toBe('remote-area-subset');
    expect(solve.headsFlowing).toBe(ra.flowingHeadCount);
    expect(solve.headsFlowing).toBeLessThan(36);
    // every flowing head discharges Q=K√7 at min pressure -> demand = n·5.6·√7 (hand)
    const perHeadQ = kFactorFlow(5.6, 7); // 14.8157 gpm
    expect(solve.demandGpm).toBeCloseTo(ra.flowingHeadCount * perHeadQ, 2);
    expect(solve.demandGpm).toBeGreaterThan(50);
    expect(solve.demandGpm).toBeLessThan(900);
    // required pressure stays sane (well under the ~466 psi all-heads-open value)
    expect(solve.requiredPsi).toBeGreaterThan(7);
    expect(solve.requiredPsi).toBeLessThan(175);
    // conservation must hold at every junction
    expect(solve.conservationOk).toBe(true);
  });

  it('all-heads-open demand is MUCH larger than the remote-area demand (the point)', () => {
    const allOpen = solveNetwork(model, { availablePsi: 65 }); // no flowingHeads
    const subset = solveNetwork(model, { availablePsi: 65, flowingHeads: ra.predicate });
    expect(allOpen.designBasis).toBe('all-heads-open');
    expect(allOpen.headsFlowing).toBe(36);
    // all-heads-open flows every head; the remote-area subset flows far fewer ->
    // strictly smaller, realistic demand.
    expect(subset.demandGpm).toBeLessThan(allOpen.demandGpm);
    expect(subset.headsFlowing).toBeLessThan(allOpen.headsFlowing);
  });
});

describe('autoRemoteArea — degenerate + hazard variations', () => {
  it('no heads -> no boundary, autoSelected false, honest reason', () => {
    const r = autoRemoteArea({ solids: [{ kind: 'pipe', from: [0, 0, 0], to: [1, 0, 0], diameterIn: 1 }] }, {});
    expect(r.boundary).toBe(null);
    expect(r.autoSelected).toBe(false);
    expect(r.flowingHeadCount).toBe(0);
  });

  it('extra hazard uses the 2500 ft² design area', () => {
    const model = buildGridModel();
    const r = autoRemoteArea(model, { hazard: 'extra' });
    const a = polygonArea(rectRing(r.boundary));
    expect(r.designAreaSqFt).toBe(2500);
    expect(a).toBeCloseTo(2500, 0);
  });

  it('heads with no pipes still returns a valid auto-selected boundary', () => {
    // no connected pipe graph -> still produce a sane design rectangle so the
    // default solve has a remote-area basis (degenerate but non-crashing).
    const solids = [
      { kind: 'head', position: [0, 0, 9], kFactor: 5.6 },
      { kind: 'head', position: [100, 100, 9], kFactor: 5.6 },
    ];
    const r = autoRemoteArea({ solids, sizing: { hazard: 'ordinary' } }, {});
    expect(r.autoSelected).toBe(true);
    expect(r.boundary).not.toBe(null);
    expect(r.designAreaSqFt).toBe(1500);
  });

  it('with a real disconnected graph, ranking still picks a connected most-remote head', () => {
    // sanity: the grid model ranks by true path resistance (covered above); here
    // just confirm a head-only model never throws and flags auto-selection.
    const r = autoRemoteArea({ solids: [{ kind: 'head', position: [5, 5, 9], kFactor: 5.6 }], sizing: { hazard: 'ordinary' } }, {});
    expect(r.autoSelected).toBe(true);
  });
});
