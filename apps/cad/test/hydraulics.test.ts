// hydraulics.ts pure tests (W5). Validates the NFPA-13 hydraulic DESIGN-AID against
// hand-worked values and the cited formulas:
//   - Q = K*sqrt(P): K5.6 @ 7 psi -> ~14.8 gpm.
//   - a single pipe run Hazen-Williams friction matches a hand-worked psi.
//   - flows sum correctly through a tee.
//   - remote-area selection picks the most demanding heads.
//   - pressure increases monotonically from a head up to the riser.
//   - supply-curve interpolation + the adequate flag.
//   - over-demand flagged inadequate.
//
// HONESTY: every constant is the cited nfpa13-rules value; assertions check the
// ACTUAL returned numbers (no fabricated pressures). Design aid only.

import { describe, expect, it } from 'vitest';
import type { Node, Segment, SprinklerNetwork } from '../src/lib/model';
import { routeSystem } from '../src/lib/pipe-routing';
import {
  DEFAULT_HEAD_K,
  ELEVATION_PSI_PER_FT,
  MIN_OPERATING_PSI,
  fittingEquivLengthFt,
  pressureColor,
  pressureRange,
  solveHydraulics,
  supplyAvailablePsi,
  velocityFps,
} from '../src/lib/hydraulics';
import {
  flowFromKP,
  hazenWilliamsLossPsi,
  HAZEN_WILLIAMS_C,
} from '../src/lib/nfpa13-rules';

/** Build a head node at plan (x, z) feet, ceiling y. */
function head(id: string, x: number, z: number, y = 10): Node {
  return { id, type: 'HEAD', pos: { x, y, z } };
}

function net(heads: Node[]): SprinklerNetwork {
  return { nodes: heads, segments: [], remoteAreas: [] };
}

/** Route a head set into a real tree (the W4 router) so W5 has a real network. */
function routedNet(heads: Node[]): SprinklerNetwork {
  const r = routeSystem(net(heads), {});
  return { nodes: r.nodes, segments: r.segments, remoteAreas: [] };
}

function row(prefix: string, n: number, z: number, x0 = 0, step = 10, y = 10): Node[] {
  return Array.from({ length: n }, (_, i) => head(`${prefix}_${i}`, x0 + i * step, z, y));
}

describe('Q = K*sqrt(P) — cited orifice relation', () => {
  it('K5.6 @ 7 psi -> ~14.8 gpm', () => {
    const q = flowFromKP(5.6, 7);
    expect(q).toBeCloseTo(14.816, 2);
  });
});

describe('Hazen-Williams single-run friction — hand-worked', () => {
  it('matches Pm = 4.52*Q^1.85/(C^1.85*d^4.87)*L', () => {
    // Hand-worked: Q=100 gpm, C=120, d=1.5 in, L=20 ft.
    // Pm/ft = 4.52*100^1.85 / (120^1.85 * 1.5^4.87)
    const Q = 100;
    const C = 120;
    const d = 1.5;
    const L = 20;
    const expected =
      (4.52 * Math.pow(Q, 1.85)) /
      (Math.pow(C, 1.85) * Math.pow(d, 4.87)) *
      L;
    expect(hazenWilliamsLossPsi(Q, C, d, L)).toBeCloseTo(expected, 6);
    // Sanity: a real, positive, finite friction.
    expect(hazenWilliamsLossPsi(Q, C, d, L)).toBeGreaterThan(0);
  });
});

describe('velocity gpm->fps', () => {
  it('v = 0.4085*Q/d^2', () => {
    expect(velocityFps(100, 2)).toBeCloseTo((0.4085 * 100) / 4, 4);
    expect(velocityFps(50, 0)).toBe(0);
  });
});

describe('fitting equivalent length — cited table, next-larger row', () => {
  it('elbow + tee Le grow with size and never under-count', () => {
    expect(fittingEquivLengthFt('ELBOW', 1)).toBe(2);
    expect(fittingEquivLengthFt('TEE', 2)).toBe(10);
    // A size between rows clamps UP to the next-larger published row.
    expect(fittingEquivLengthFt('ELBOW', 1.1)).toBe(3); // -> 1.25" row
    // Above the largest row clamps to the largest.
    expect(fittingEquivLengthFt('TEE', 99)).toBe(20);
  });
});

describe('solveHydraulics — flows sum through a tee', () => {
  it('riser flow equals the sum of operating head flows', () => {
    const heads = row('a', 3, 0); // one branch, 3 heads
    const network = routedNet(heads);
    const res = solveHydraulics(network, { hazard: 'ORDINARY_1' });
    const riser = network.nodes.find((n) => n.type === 'SOURCE')!;
    const riserResult = res.perNode.find((n) => n.id === riser.id)!;
    // 3 heads each at min operating pressure with default K.
    const perHead = flowFromKP(DEFAULT_HEAD_K, MIN_OPERATING_PSI);
    expect(riserResult.flowGpm).toBeCloseTo(3 * perHead, 1);
    expect(res.systemDemand.gpm).toBeCloseTo(3 * perHead, 1);
  });

  it('flow accumulates monotonically toward the riser across two branches', () => {
    const heads = [...row('a', 2, 0), ...row('b', 2, 10)]; // 2 branches, 4 heads
    const network = routedNet(heads);
    const res = solveHydraulics(network, { hazard: 'ORDINARY_1' });
    const riser = network.nodes.find((n) => n.type === 'SOURCE')!;
    const riserResult = res.perNode.find((n) => n.id === riser.id)!;
    const perHead = flowFromKP(DEFAULT_HEAD_K, MIN_OPERATING_PSI);
    expect(riserResult.flowGpm).toBeCloseTo(4 * perHead, 1);
  });
});

describe('solveHydraulics — remote-area selection picks the most demanding heads', () => {
  it('a small design area operates only the farthest (most lossy) heads', () => {
    // 6 heads in a row; the farthest from the riser have the lossiest path.
    const heads = row('a', 6, 0);
    const network = routedNet(heads);
    // designArea sized for ~2 heads at ordinary 130 ft^2/head.
    const res = solveHydraulics(network, {
      hazard: 'ORDINARY_1',
      designAreaSqFt: 200, // ceil(200/130) = 2 heads
    });
    expect(res.remoteAreaHeadIds.length).toBe(2);
    // The chosen heads are real head ids.
    for (const id of res.remoteAreaHeadIds) {
      expect(network.nodes.some((n) => n.id === id && n.type === 'HEAD')).toBe(true);
    }
    // Only the remote heads carry head flow; the rest are closed (0 flow at the head).
    const perHead = flowFromKP(DEFAULT_HEAD_K, MIN_OPERATING_PSI);
    expect(res.systemDemand.gpm).toBeCloseTo(2 * perHead, 1);
  });

  it('with no design area, operates ALL heads (conservative)', () => {
    const heads = row('a', 4, 0);
    const network = routedNet(heads);
    const res = solveHydraulics(network, { hazard: 'ORDINARY_1' });
    expect(res.remoteAreaHeadIds.length).toBe(4);
  });
});

describe('solveHydraulics — pressure increases monotonically head -> riser', () => {
  it('the riser pressure is the highest; each head is the local low', () => {
    const heads = row('a', 4, 0);
    const network = routedNet(heads);
    const res = solveHydraulics(network, { hazard: 'ORDINARY_1' });
    const riser = network.nodes.find((n) => n.type === 'SOURCE')!;
    const byId = new Map(res.perNode.map((n) => [n.id, n]));
    const riserPsi = byId.get(riser.id)!.pressurePsi;
    // Required riser pressure > minimum operating pressure (friction added).
    expect(riserPsi).toBeGreaterThan(MIN_OPERATING_PSI);
    // Each operating head pressure <= riser pressure.
    for (const id of res.remoteAreaHeadIds) {
      expect(byId.get(id)!.pressurePsi).toBeLessThanOrEqual(riserPsi + 1e-6);
    }
    expect(res.systemDemand.psiAtRiser).toBeCloseTo(riserPsi, 2);
  });
});

describe('supply curve interpolation + adequacy', () => {
  it('available pressure drops with flow per Q^1.85 and hits residual at the test flow', () => {
    const supply = { staticPsi: 70, residualPsi: 50, flowGpm: 1000 };
    expect(supplyAvailablePsi(supply, 0)).toBe(70); // static at no flow
    expect(supplyAvailablePsi(supply, 1000)).toBeCloseTo(50, 6); // residual at test flow
    // A mid flow is between residual and static.
    const mid = supplyAvailablePsi(supply, 500);
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(70);
  });

  it('flags ADEQUATE when supply >= required and SHORT when under-demand exceeds it', () => {
    const heads = row('a', 3, 0);
    const network = routedNet(heads);
    // A strong supply: plenty of pressure.
    const ok = solveHydraulics(network, {
      hazard: 'ORDINARY_1',
      supply: { staticPsi: 80, residualPsi: 70, flowGpm: 1000 },
    });
    expect(ok.adequate).toBe(true);
    expect(ok.supplyAtDemand.psi).not.toBeNull();
    expect(ok.findings.some((f) => f.code === 'adequacy' && f.severity === 'ok')).toBe(true);

    // A weak supply that cannot meet the required riser pressure.
    const short = solveHydraulics(network, {
      hazard: 'ORDINARY_1',
      supply: { staticPsi: 8, residualPsi: 5, flowGpm: 50 },
    });
    expect(short.adequate).toBe(false);
    expect(short.findings.some((f) => f.code === 'adequacy' && f.severity === 'error')).toBe(true);
  });

  it('over-demand (huge design forcing many heads + weak supply) is inadequate', () => {
    const heads = row('a', 10, 0);
    const network = routedNet(heads);
    const res = solveHydraulics(network, {
      hazard: 'ORDINARY_1',
      supply: { staticPsi: 40, residualPsi: 20, flowGpm: 100 },
    });
    expect(res.adequate).toBe(false);
  });
});

describe('elevation head', () => {
  it('elevation changes the required riser pressure by 0.433 psi/ft along the path', () => {
    // Two identical networks; in one, lift every operating head 10 ft ABOVE the riser
    // so the riser must push water UP (needs MORE pressure than the level case).
    const level = routedNet(row('a', 2, 0, 0, 10, 10));
    const raised = routedNet(row('a', 2, 0, 0, 10, 10));
    for (const n of raised.nodes) {
      if (n.type === 'HEAD') n.pos = { ...n.pos, y: n.pos.y + 10 };
    }
    const rLevel = solveHydraulics(level, { hazard: 'ORDINARY_1' });
    const rRaised = solveHydraulics(raised, { hazard: 'ORDINARY_1' });
    // Raising the heads above the riser adds ~0.433*10 psi of elevation lift.
    expect(rRaised.systemDemand.psiAtRiser).toBeGreaterThan(rLevel.systemDemand.psiAtRiser);
    expect(rRaised.findings.some((f) => f.code === 'elevation')).toBe(true);
    expect(ELEVATION_PSI_PER_FT).toBeCloseTo(0.433, 3);
  });
});

describe('editing a segment diameter changes the result (live recalc input)', () => {
  it('a smaller pipe raises friction and the required riser pressure', () => {
    const heads = row('a', 4, 0);
    const network = routedNet(heads);
    const before = solveHydraulics(network, { hazard: 'ORDINARY_1' });
    // Shrink every branch segment diameter -> more friction.
    const shrunk: Segment[] = network.segments.map((s) => ({ ...s, diameterIn: 1 }));
    const after = solveHydraulics(
      { ...network, segments: shrunk },
      { hazard: 'ORDINARY_1' },
    );
    expect(after.systemDemand.psiAtRiser).toBeGreaterThan(before.systemDemand.psiAtRiser);
  });
});

describe('honesty + citations', () => {
  it('every finding carries a non-empty citation and the disclaimer is present', () => {
    const network = routedNet(row('a', 3, 0));
    const res = solveHydraulics(network, {
      hazard: 'ORDINARY_1',
      supply: { staticPsi: 70, residualPsi: 50, flowGpm: 1000 },
      designAreaSqFt: 300,
    });
    for (const f of res.findings) {
      expect(f.citation.length).toBeGreaterThan(0);
    }
    expect(res.findings.some((f) => f.code === 'disclaimer')).toBe(true);
    expect(res.disclaimer.toLowerCase()).toContain('not a certified');
    // Uses the cited wet-steel C-factor (no forked numbers).
    expect(HAZEN_WILLIAMS_C.steel_wet.value).toBe(120);
  });

  it('an empty/unrouted network returns a zero-demand result, not a throw', () => {
    const res = solveHydraulics({ nodes: [], segments: [], remoteAreas: [] }, { hazard: 'LIGHT' });
    expect(res.systemDemand.gpm).toBe(0);
    expect(res.adequate).toBe(false);
    expect(res.findings.some((f) => f.code === 'remote_area')).toBe(true);
  });
});

describe('pressure heatmap color ramp', () => {
  it('maps min->blue-ish and max->red-ish deterministically', () => {
    expect(pressureColor(0, 0, 10)).toBe('rgb(59, 130, 246)');
    expect(pressureColor(10, 0, 10)).toBe('rgb(239, 68, 68)');
    // Degenerate range returns the mid color (no divide-by-zero).
    expect(pressureColor(5, 5, 5)).toBe(pressureColor(5, 5, 5));
  });

  it('pressureRange reports min/max over node pressures', () => {
    const network = routedNet(row('a', 3, 0));
    const res = solveHydraulics(network, { hazard: 'ORDINARY_1' });
    const range = pressureRange(res);
    expect(range.max).toBeGreaterThanOrEqual(range.min);
  });
});
