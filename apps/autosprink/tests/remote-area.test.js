import { describe, expect, it } from 'vitest';
import {
  polygonArea,
  pointInPolygon,
  rectRing,
  getDensityCurve,
  computeRemoteArea,
  solveRemoteArea,
  DENSITY_CURVES,
} from '../src/engine/remote-area.js';
import { solveNetwork } from '../src/engine/network-solve.js';

// ===========================================================================
// REMOTE-AREA golden known-answer tests. Geometry (shoelace + point-in-polygon)
// and the NFPA-13 density/area demand are validated against hand calcs.
// ===========================================================================

const A = (n) => Math.abs(n);

describe('shoelace polygon area (hand calc)', () => {
  it('30x50 rectangle ring = 1500 ft^2', () => {
    const ring = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 50 }, { x: 0, y: 50 }];
    expect(polygonArea(ring)).toBeCloseTo(1500, 6);
  });

  it('rect helper {x0,y0,x1,y1} 20x10 = 200 ft^2', () => {
    expect(polygonArea(rectRing({ x0: 5, y0: 5, x1: 25, y1: 15 }))).toBeCloseTo(200, 6);
  });

  it('shoelace is orientation-independent (CW == CCW magnitude)', () => {
    const ccw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const cw = [...ccw].reverse();
    expect(polygonArea(cw)).toBeCloseTo(polygonArea(ccw), 9);
  });

  it('right triangle (6,0),(0,8) base*height/2 = 24 ft^2', () => {
    // legs 6 and 8 -> area = 24
    expect(polygonArea([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 8 }])).toBeCloseTo(24, 6);
  });

  it('L-shaped polygon (hand decomposition) = 75 ft^2', () => {
    // 10x10 square minus a 5x5 notch at top-right corner -> 100 - 25 = 75
    const L = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 },
      { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 },
    ];
    expect(polygonArea(L)).toBeCloseTo(75, 6);
  });

  it('accepts [x,y] tuple rings', () => {
    expect(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]])).toBeCloseTo(12, 6);
  });

  it('degenerate ring (< 3 pts) = 0', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
});

describe('point-in-polygon (ray cast, inclusive edges)', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it('interior point inside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
  });
  it('point outside (right)', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });
  it('point outside (below)', () => {
    expect(pointInPolygon({ x: 5, y: -1 }, sq)).toBe(false);
  });
  it('point on edge counts as inside (NFPA inclusive boundary)', () => {
    expect(pointInPolygon({ x: 0, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 10 }, sq)).toBe(true); // corner
  });
  it('concave polygon: notch point is OUTSIDE', () => {
    // L-shape: the cut-out region should test false
    const L = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 },
      { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 7.5, y: 7.5 }, L)).toBe(false); // in the notch
    expect(pointInPolygon({ x: 2.5, y: 7.5 }, L)).toBe(true);  // in the body
  });
});

describe('NFPA-13 density curves', () => {
  it('ordinary hazard density 0.20 gpm/ft^2 @ 1500 ft^2', () => {
    const c = getDensityCurve('ordinary');
    expect(c.densityGpmFt2).toBeCloseTo(0.20, 6);
    expect(c.designAreaSqFt).toBe(1500);
  });
  it('light hazard 0.10 @ 1500', () => {
    expect(getDensityCurve('light').densityGpmFt2).toBeCloseTo(0.10, 6);
  });
  it('extra hazard 0.40 @ 2500', () => {
    const c = getDensityCurve('extra');
    expect(c.densityGpmFt2).toBeCloseTo(0.40, 6);
    expect(c.designAreaSqFt).toBe(2500);
  });
  it('ordinary group 1 = 0.15', () => {
    expect(getDensityCurve('ordinary-1').densityGpmFt2).toBeCloseTo(0.15, 6);
  });
  it('unknown hazard fails soft to ordinary', () => {
    expect(getDensityCurve('zzz').densityGpmFt2).toBeCloseTo(DENSITY_CURVES.ordinary.densityGpmFt2, 6);
  });
});

// --- a small hand-buildable model: a 3x3 grid of heads on 12 ft centers, all
//     ordinary hazard (130 ft^2 max area/head). Plan x in [0,24], y in [0,24]. ---
function gridModel() {
  const solids = [];
  for (let ix = 0; ix < 3; ix += 1) {
    for (let iy = 0; iy < 3; iy += 1) {
      solids.push({ kind: 'head', position: [ix * 12, iy * 12, 10], kFactor: 5.6 });
    }
  }
  return { solids, sizing: { hazard: 'ordinary' } };
}

describe('computeRemoteArea: head identification + demand (hand calc)', () => {
  it('rectangle catching the 4 lower-left heads only', () => {
    // heads at x,y in {0,12,24}. A rect [-1,-1]..[13,13] catches (0,0)(0,12)(12,0)(12,12) = 4 heads.
    const m = gridModel();
    const ra = computeRemoteArea(m, { x0: -1, y0: -1, x1: 13, y1: 13 });
    expect(ra.flowingHeadCount).toBe(4);
    expect(ra.totalHeadCount).toBe(9);
    expect(ra.boundaryKind).toBe('rectangle');
  });

  it('per-head demand = density * per-head coverage area (0.20 * 130 = 26 gpm)', () => {
    const m = gridModel();
    const ra = computeRemoteArea(m, { x0: -1, y0: -1, x1: 13, y1: 13 });
    // ordinary maxAreaSqFt = 130; density 0.20 -> 26 gpm per head
    for (const h of ra.flowingHeads) expect(h.requiredFlowGpm).toBeCloseTo(26, 6);
    expect(ra.requiredHeadFlowGpm).toBeCloseTo(26, 6);
  });

  it('discrete demandGpm = Σ per-head flow = 4 heads * 26 = 104 gpm', () => {
    const m = gridModel();
    const ra = computeRemoteArea(m, { x0: -1, y0: -1, x1: 13, y1: 13 });
    expect(ra.demandGpm).toBeCloseTo(104, 6);
    expect(ra.perHeadFlowSumGpm).toBeCloseTo(104, 6);
  });

  it('areaSqFt = drawn shoelace area (14x14 = 196 ft^2)', () => {
    const m = gridModel();
    const ra = computeRemoteArea(m, { x0: -1, y0: -1, x1: 13, y1: 13 });
    expect(ra.areaSqFt).toBeCloseTo(196, 6);
  });

  it('areaDemandGpm = density * drawn area (0.20 * 196 = 39.2 gpm)', () => {
    const m = gridModel();
    const ra = computeRemoteArea(m, { x0: -1, y0: -1, x1: 13, y1: 13 });
    expect(ra.areaDemandGpm).toBeCloseTo(39.2, 4);
  });

  it('polygon boundary (triangle) catches only the origin head', () => {
    const m = gridModel();
    // triangle around (0,0): (-2,-2),(6,-2),(-2,6) — only head (0,0) inside
    const ra = computeRemoteArea(m, [[-2, -2], [6, -2], [-2, 6]]);
    expect(ra.flowingHeadCount).toBe(1);
    expect(ra.boundaryKind).toBe('polygon');
    expect(ra.flowingHeads[0]._idx).toBe(0); // first head pushed = (0,0)
  });

  it('density override is honored (0.30 instead of hazard curve)', () => {
    const m = gridModel();
    const ra = computeRemoteArea(m, { x0: -1, y0: -1, x1: 13, y1: 13 }, { densityGpmFt2: 0.30 });
    expect(ra.densityGpmFt2).toBeCloseTo(0.30, 6);
    // 0.30 * 130 = 39 gpm/head, 4 heads -> 156
    expect(ra.demandGpm).toBeCloseTo(156, 6);
  });

  it('empty boundary -> 0 flowing heads, area-density fallback demand', () => {
    const m = gridModel();
    const ra = computeRemoteArea(m, { x0: 100, y0: 100, x1: 110, y1: 110 });
    expect(ra.flowingHeadCount).toBe(0);
    // no heads inside -> demand falls back to area-density: 0.20 * 100 = 20
    expect(ra.demandGpm).toBeCloseTo(20, 6);
  });

  it('per-head coverage override on the solid is honored', () => {
    const m = { solids: [{ kind: 'head', position: [0, 0, 10], kFactor: 5.6, coverageAreaSqFt: 100 }], sizing: { hazard: 'ordinary' } };
    const ra = computeRemoteArea(m, { x0: -1, y0: -1, x1: 1, y1: 1 });
    // 0.20 * 100 = 20 gpm
    expect(ra.flowingHeads[0].requiredFlowGpm).toBeCloseTo(20, 6);
  });

  it('honesty disclaimer present', () => {
    const ra = computeRemoteArea(gridModel(), { x0: -1, y0: -1, x1: 13, y1: 13 });
    expect(ra.disclaimer).toMatch(/ENGINEERING AID/);
    expect(ra.disclaimer).toMatch(/NOT AHJ\/PE-stamped/);
  });
});

// --- tie into the real H-W solver: the predicate must restrict the solve to the
//     subset. We compare an all-heads solve vs a remote-area-subset solve over a
//     real connected branch and assert the subset demand < full demand. ---
function branchModel() {
  // a single branch line: supply riser at x=0 down to z=0, cross-main along x at
  // z=10, heads dropped off the main at x=0,6,12,18,24 via short 1ft branch stubs
  // (so every head sits on a true shared-endpoint node — the connected topology
  // Phase 2 builds, where the cross-main is split at each tap and a leg runs to
  // the head). This keeps the whole tree one connected component.
  const solids = [];
  // riser
  solids.push({ kind: 'pipe', from: [0, 0, 0], to: [0, 0, 10], diameterIn: 4, C: 120 });
  // cross-main along x at y=0,z=10
  solids.push({ kind: 'pipe', from: [0, 0, 10], to: [24, 0, 10], diameterIn: 2.5, C: 120 });
  for (let i = 0; i <= 4; i += 1) {
    const x = i * 6;
    // 1 ft branch leg off the main (tap on the main interior) to the head at y=1
    solids.push({ kind: 'pipe', from: [x, 0, 10], to: [x, 1, 10], diameterIn: 1, C: 120 });
    solids.push({ kind: 'head', position: [x, 1, 10], kFactor: 5.6 });
  }
  return { solids, sizing: { hazard: 'ordinary' } };
}

describe('solveRemoteArea: H-W solve restricted to the remote subset', () => {
  it('subset predicate flows ONLY the heads inside the boundary', () => {
    const m = branchModel();
    // boundary catches the 2 most-remote heads (x=18,24)
    const { remoteArea, solve } = solveRemoteArea(
      m, { x0: 15, y0: -1, x1: 30, y1: 1 }, (model, o) => solveNetwork(model, o),
      { availablePsi: 65 },
    );
    expect(remoteArea.flowingHeadCount).toBe(2);
    expect(solve.headsFlowing).toBe(2);
    expect(solve.headsTotal).toBe(5);
    expect(solve.designBasis).toBe('remote-area-subset');
  });

  it('subset demand < all-heads-open demand (fewer heads flow)', () => {
    const m = branchModel();
    const all = solveNetwork(m, { availablePsi: 65 });
    const { solve: subset } = solveRemoteArea(
      m, { x0: 15, y0: -1, x1: 30, y1: 1 }, (model, o) => solveNetwork(model, o),
      { availablePsi: 65 },
    );
    expect(subset.demandGpm).toBeLessThan(all.demandGpm);
    expect(subset.demandGpm).toBeGreaterThan(0);
  });

  it('subset demand conservation: solver demand ~= K*sqrt(minHead) * nFlowing', () => {
    const m = branchModel();
    const { solve } = solveRemoteArea(
      m, { x0: 15, y0: -1, x1: 30, y1: 1 }, (model, o) => solveNetwork(model, o),
      { availablePsi: 65, minHeadPressurePsi: 7 },
    );
    // each head: Q = 5.6*sqrt(7) = 14.817 gpm; 2 heads -> 29.63 gpm (before any
    // pressure-balancing increase on near heads — base solve flows all at minHead)
    const perHead = 5.6 * Math.sqrt(7);
    expect(solve.demandGpm).toBeCloseTo(perHead * 2, 1);
    expect(solve.conservationOk).toBe(true);
  });
});
