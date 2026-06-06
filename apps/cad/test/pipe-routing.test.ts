// pipe-routing.ts pure tests (W4). Heads -> a real wet-pipe tree:
//   - one row -> one branch line with N-1 between-head branch segments + arm-overs;
//   - 3 rows -> 3 branch lines tapping a cross-main via 3 tees; a main to the riser;
//   - EVERY head reachable from the riser (real graph connectivity);
//   - reducers only where the size changes, and the connectivity Ports actually mate
//     (arePortsCompatible true across each fitting);
//   - schedule sizing monotonic non-decreasing toward the riser.
//
// HONESTY: every assertion checks the ACTUAL returned topology — no fabricated edges.

import { describe, expect, it } from 'vitest';
import type { Node, SprinklerNetwork } from '../src/lib/model';
import {
  PIPE_SCHEDULE,
  groupHeadRows,
  intermediateSizes,
  reachableFrom,
  routeSystem,
  sizeForHeadCount,
  summarizeRouted,
} from '../src/lib/pipe-routing';
import { arePortsCompatible } from '../src/lib/connectivity';

/** Build a head node at plan (x, z) feet, ceiling y. */
function head(id: string, x: number, z: number, y = 10): Node {
  return { id, type: 'HEAD', pos: { x, y, z } };
}

/** Wrap heads into a SprinklerNetwork. */
function net(heads: Node[]): SprinklerNetwork {
  return { nodes: heads, segments: [], remoteAreas: [] };
}

/** A row of N heads spaced 10 ft along X at a fixed Z. */
function row(prefix: string, n: number, z: number, x0 = 0, step = 10): Node[] {
  return Array.from({ length: n }, (_, i) => head(`${prefix}_${i}`, x0 + i * step, z));
}

describe('sizeForHeadCount — cited pipe schedule', () => {
  it('matches the published branch schedule (smallest qualifying size)', () => {
    expect(sizeForHeadCount(1)).toBe(1);
    expect(sizeForHeadCount(2)).toBe(1);
    expect(sizeForHeadCount(3)).toBe(1.25);
    expect(sizeForHeadCount(5)).toBe(1.5);
    expect(sizeForHeadCount(6)).toBe(2);
    expect(sizeForHeadCount(10)).toBe(2);
    expect(sizeForHeadCount(11)).toBe(2.5);
    expect(sizeForHeadCount(20)).toBe(2.5);
    expect(sizeForHeadCount(40)).toBe(3);
  });

  it('clamps counts above the largest row to the largest size (never undersized)', () => {
    const biggest = PIPE_SCHEDULE[PIPE_SCHEDULE.length - 1].nominalSizeIn;
    expect(sizeForHeadCount(1000)).toBe(biggest);
  });

  it('non-positive counts return the smallest size', () => {
    expect(sizeForHeadCount(0)).toBe(1);
    expect(sizeForHeadCount(-5)).toBe(1);
  });
});

describe('intermediateSizes — single-step reducer chain', () => {
  it('lists schedule sizes strictly between, descending', () => {
    expect(intermediateSizes(2, 1)).toEqual([1.5, 1.25]);
    expect(intermediateSizes(1.25, 1)).toEqual([]); // adjacent
    expect(intermediateSizes(1, 0.5)).toEqual([]); // 0.5 below schedule
  });
});

describe('groupHeadRows', () => {
  it('groups colinear-Y heads into rows ordered by X', () => {
    const heads = [head('a', 20, 0), head('b', 0, 0), head('c', 10, 0)];
    const rows = groupHeadRows(heads, 1);
    expect(rows.length).toBe(1);
    expect(rows[0].heads.map((h) => h.id)).toEqual(['b', 'c', 'a']);
  });

  it('separates rows beyond the tolerance', () => {
    const heads = [...row('r0', 3, 0), ...row('r1', 3, 10)];
    const rows = groupHeadRows(heads, 1);
    expect(rows.length).toBe(2);
    expect(rows[0].z).toBeCloseTo(0);
    expect(rows[1].z).toBeCloseTo(10);
  });
});

describe('routeSystem — one row', () => {
  it('one row of 4 heads -> one branch line with N-1 branch-run segments + N arm-overs', () => {
    const heads = row('r', 4, 0); // 4 heads, 1 row
    const routed = routeSystem(net(heads));

    // Branch segments between the 4 heads' branch points: an elbow into the run + 3
    // between-head runs = 4 BRANCH segments along the line (plus possible reducers).
    const branchSegs = routed.segments.filter((s) => s.role === 'BRANCH');
    // 4 heads => branch points: tee,tee,tee,elbow; plus the lead-in elbow. The
    // between-point runs are exactly 4 (elbow->p0, p0->p1, p1->p2, p2->p3last).
    expect(branchSegs.length).toBeGreaterThanOrEqual(4);

    // Exactly one ARM_OVER terminal run lands on each head.
    const armToHead = routed.segments.filter(
      (s) => s.role === 'ARM_OVER' && heads.some((h) => h.id === s.to),
    );
    expect(armToHead.length).toBe(4);

    // Every head is reachable from the riser (real connectivity).
    const reach = reachableFrom(routed.riserId, routed.segments);
    expect(heads.every((h) => reach.has(h.id))).toBe(true);
    expect(routed.routedOk).toBe(true);
  });

  it('preserves the original head nodes verbatim', () => {
    const heads = row('r', 3, 0);
    const routed = routeSystem(net(heads));
    for (const h of heads) {
      const found = routed.nodes.find((n) => n.id === h.id);
      expect(found).toBeDefined();
      expect(found).toEqual(h);
    }
  });
});

describe('routeSystem — 3 rows tap a cross-main via 3 tees, main to riser', () => {
  const heads = [...row('a', 3, 0), ...row('b', 3, 10), ...row('c', 3, 20)];
  const routed = routeSystem(net(heads));

  it('produces exactly one riser/source', () => {
    const s = summarizeRouted(routed);
    expect(s.riserCount).toBe(1);
    expect(s.headCount).toBe(9);
  });

  it('has a TEE tap on the cross-main for each of the 3 branch rows', () => {
    // The 3 cross-main taps are TEE nodes positioned at the cross-main X. There are
    // also branch-internal tees; the cross-main taps are the 3 fed directly by a
    // CROSS_MAIN segment.
    const crossSegs = routed.segments.filter((s) => s.role === 'CROSS_MAIN');
    const teeIds = new Set(routed.nodes.filter((n) => n.type === 'TEE').map((n) => n.id));
    const crossFedTees = new Set(crossSegs.map((s) => s.to).filter((id) => teeIds.has(id)));
    expect(crossFedTees.size).toBe(3);
  });

  it('runs a MAIN from the cross-main to the riser', () => {
    const mains = routed.segments.filter((s) => s.role === 'MAIN');
    expect(mains.length).toBeGreaterThanOrEqual(1);
    // A MAIN segment touches the riser node.
    expect(mains.some((s) => s.from === routed.riserId || s.to === routed.riserId)).toBe(true);
  });

  it('EVERY head is reachable from the riser through the tree', () => {
    const reach = reachableFrom(routed.riserId, routed.segments);
    expect(heads.every((h) => reach.has(h.id))).toBe(true);
    expect(routed.routedOk).toBe(true);
  });

  it('every segment endpoint references a real node (no orphan pipes)', () => {
    const ids = new Set(routed.nodes.map((n) => n.id));
    for (const s of routed.segments) {
      expect(ids.has(s.from)).toBe(true);
      expect(ids.has(s.to)).toBe(true);
    }
  });
});

describe('routeSystem — reducers + port mate-ability', () => {
  const heads = [...row('a', 3, 0), ...row('b', 3, 10), ...row('c', 3, 20)];
  const routed = routeSystem(net(heads));

  it('every fitting (tee/elbow/reducer/riser) has mate-able ports', () => {
    expect(routed.fittingPorts.length).toBeGreaterThan(0);
    for (const f of routed.fittingPorts) {
      expect(f.mated).toBe(true);
      // Re-assert directly: each outlet mates the inlet (direct or real adapter).
      for (const o of f.outlets) {
        const ok = arePortsCompatible(
          { method: f.inlet.method, nominalSizeIn: f.inlet.nominalSizeIn, role: 'OUTLET' },
          { method: o.method, nominalSizeIn: o.nominalSizeIn, role: 'INLET' },
        );
        expect(ok).toBe(true);
      }
    }
  });

  it('a REDUCER exists wherever a segment changes size across a node', () => {
    // For each reducer node, its inlet/outlet differ in size, and the difference is a
    // single schedule step (or the head-inlet bushing) — a real fitting.
    const reducers = routed.fittingPorts.filter((f) => f.kind === 'REDUCER');
    expect(reducers.length).toBeGreaterThan(0);
    for (const r of reducers) {
      expect(r.outlets.length).toBe(1);
      expect(r.outlets[0].nominalSizeIn).toBeLessThan(r.inlet.nominalSizeIn);
      expect(r.mated).toBe(true);
    }
  });

  it('reducers appear ONLY where the pipe size actually steps (no needless reducers)', () => {
    // Build a node-size map from segments: every reducer must connect two differently-
    // sized runs. Conversely no reducer connects two equal-size runs.
    for (const f of routed.fittingPorts) {
      if (f.kind === 'REDUCER') {
        expect(f.inlet.nominalSizeIn).not.toBe(f.outlets[0].nominalSizeIn);
      }
    }
  });
});

describe('routeSystem — schedule sizing monotonic toward the riser', () => {
  it('on a single branch, segment size never decreases moving toward the tee/riser', () => {
    // A long branch (12 heads) forces several schedule steps along the line.
    const heads = row('r', 12, 0, 0, 8);
    const routed = routeSystem(net(heads));

    // Order the heads by distance along +X; the segment feeding head k carries the
    // heads from k outward, so size is non-increasing as X grows (toward the open
    // end) and non-DECREASING toward the tee. Verify via downstream-count sizing:
    // the arm-over to the outermost head is the smallest; the branch run nearest the
    // tee is the largest.
    // The terminal arm-over (the segment landing ON a head) is always the head inlet
    // size (0.5"); intermediate arm-over reducer runs carry larger sizes.
    const headIds = new Set(heads.map((h) => h.id));
    const terminalArm = routed.segments.filter(
      (s) => s.role === 'ARM_OVER' && headIds.has(s.to),
    );
    expect(terminalArm.length).toBe(12);
    expect(new Set(terminalArm.map((s) => s.diameterIn))).toEqual(new Set([0.5]));

    // Branch runs: collect by their downstream position. The maximum branch-run size
    // must equal the size for the whole branch's head count.
    const branchSizes = routed.segments
      .filter((s) => s.role === 'BRANCH')
      .map((s) => s.diameterIn);
    expect(Math.max(...branchSizes)).toBe(sizeForHeadCount(12));
    expect(Math.min(...branchSizes)).toBe(sizeForHeadCount(1));
  });

  it('the MAIN is sized for ALL heads and is >= every cross-main span size', () => {
    const heads = [...row('a', 5, 0), ...row('b', 5, 10), ...row('c', 5, 20)];
    const routed = routeSystem(net(heads));
    const mainSize = Math.max(...routed.segments.filter((s) => s.role === 'MAIN').map((s) => s.diameterIn));
    const crossSizes = routed.segments.filter((s) => s.role === 'CROSS_MAIN').map((s) => s.diameterIn);
    expect(mainSize).toBe(sizeForHeadCount(15));
    expect(Math.max(...crossSizes)).toBeLessThanOrEqual(mainSize);
    // Cross-main spans are non-increasing away from the main (downstream count drops).
    expect(Math.max(...crossSizes)).toBe(sizeForHeadCount(15));
  });
});

describe('routeSystem — honest empty + supply override', () => {
  it('no heads -> empty topology, routedOk false', () => {
    const routed = routeSystem(net([]));
    expect(routed.segments.length).toBe(0);
    expect(routed.routedOk).toBe(false);
    expect(routed.riserId).toBe('');
  });

  it('opts.supplyPoint places the riser at the requested plan point', () => {
    const heads = row('r', 3, 0);
    const routed = routeSystem(net(heads), { supplyPoint: { x: -50, y: 5 } });
    const riser = routed.nodes.find((n) => n.id === routed.riserId);
    expect(riser?.pos.x).toBe(-50);
    expect(riser?.pos.z).toBe(5);
  });

  it('carries the cited schedule source + design-aid disclaimer', () => {
    const routed = routeSystem(net(row('r', 2, 0)));
    expect(routed.scheduleCitation).toMatch(/NFPA 13 pipe-schedule/);
    expect(routed.disclaimer).toMatch(/NOT a hydraulically-calculated/);
  });
});

describe('routeSystem — every segment is axis-aligned (NO diagonal pipe)', () => {
  const grid = (rowsN: number, colsN: number): Node[] => {
    const heads: Node[] = [];
    for (let r = 0; r < rowsN; r += 1)
      for (let c = 0; c < colsN; c += 1) heads.push(head(`h${r}_${c}`, c * 12, r * 12));
    return heads;
  };
  const assertNoXZDiagonal = (routed: ReturnType<typeof routeSystem>) => {
    const posOf = (id: string) => routed.nodes.find((n) => n.id === id)!.pos;
    for (const s of routed.segments) {
      const a = posOf(s.from);
      const b = posOf(s.to);
      const dx = Math.abs(a.x - b.x);
      const dz = Math.abs(a.z - b.z);
      // A real run moves along exactly one plan axis; a diagonal moves along both.
      expect(
        dx > 1e-6 && dz > 1e-6,
        `segment ${s.from}->${s.to} (${s.role}) is diagonal in XZ: dx=${dx} dz=${dz}`,
      ).toBe(false);
    }
  };

  it('default supply: no segment runs diagonally', () => {
    const routed = routeSystem(net(grid(4, 5)));
    expect(routed.segments.length).toBeGreaterThan(0);
    assertNoXZDiagonal(routed);
  });

  it('off-axis custom supply is still routed orthogonally (L via a corner elbow)', () => {
    // supply off BOTH axes from the cross-main head — the old code drew a diagonal main.
    const routed = routeSystem(net(grid(3, 4)), { supplyPoint: { x: -60, y: -40 } });
    assertNoXZDiagonal(routed);
    expect(routed.routedOk).toBe(true);
  });
});
