// takeoff.ts (W6) PURE tests: head count by SKU, pipe length summed by diameter,
// fitting counts by type, BOM grouping + determinism, stock-length round-up.
//
// Quantities map 1:1 to the network nodes + segments — no fabrication.

import { describe, expect, it } from 'vitest';
import { routeSystem } from '../src/lib/pipe-routing';
import type { Node, Segment, SprinklerNetwork } from '../src/lib/model';
import {
  BOM_CATEGORIES,
  computeTakeoff,
  formatNominalSize,
  roundUpToStock,
} from '../src/lib/takeoff';

function head(id: string, x: number, z: number, sku?: string, y = 10): Node {
  return { id, type: 'HEAD', pos: { x, y, z }, ...(sku ? { sku } : {}) };
}

/** Build a routed network from a set of heads. */
function routedFrom(heads: Node[]): SprinklerNetwork {
  const routed = routeSystem({ nodes: heads, segments: [], remoteAreas: [] });
  return { nodes: routed.nodes, segments: routed.segments, remoteAreas: [] };
}

describe('computeTakeoff — heads grouped by SKU', () => {
  it('groups heads by SKU and counts each', () => {
    const net: SprinklerNetwork = {
      nodes: [
        head('h1', 0, 0, 'VK-A'),
        head('h2', 10, 0, 'VK-A'),
        head('h3', 20, 0, 'VK-B'),
      ],
      segments: [],
      remoteAreas: [],
    };
    const t = computeTakeoff(net);
    const headLines = t.lines.filter((l) => l.category === 'head');
    const byKey = Object.fromEntries(headLines.map((l) => [l.sku, l.qty]));
    expect(byKey['VK-A']).toBe(2);
    expect(byKey['VK-B']).toBe(1);
    expect(t.headCount).toBe(3);
  });

  it('groups SKU-less heads under a single unspecified line (never invents a SKU)', () => {
    const net: SprinklerNetwork = {
      nodes: [head('h1', 0, 0), head('h2', 10, 0)],
      segments: [],
      remoteAreas: [],
    };
    const t = computeTakeoff(net);
    const headLines = t.lines.filter((l) => l.category === 'head');
    expect(headLines).toHaveLength(1);
    expect(headLines[0].sku).toBeUndefined();
    expect(headLines[0].qty).toBe(2);
    expect(headLines[0].description).toMatch(/unspecified/i);
  });
});

describe('computeTakeoff — pipe summed by diameter', () => {
  it('sums segment lengths grouped by nominal diameter', () => {
    const segments: Segment[] = [
      { id: 's1', from: 'a', to: 'b', diameterIn: 1, lengthFt: 10, role: 'BRANCH', material: 'STEEL_SCH40' },
      { id: 's2', from: 'b', to: 'c', diameterIn: 1, lengthFt: 5, role: 'BRANCH', material: 'STEEL_SCH40' },
      { id: 's3', from: 'c', to: 'd', diameterIn: 2, lengthFt: 8, role: 'CROSS_MAIN', material: 'STEEL_SCH40' },
    ];
    const net: SprinklerNetwork = { nodes: [], segments, remoteAreas: [] };
    const t = computeTakeoff(net);
    const pipe = t.lines.filter((l) => l.category === 'pipe');
    const byDia = Object.fromEntries(pipe.map((l) => [l.diameterIn, l.qty]));
    expect(byDia[1]).toBe(15);
    expect(byDia[2]).toBe(8);
    expect(t.totalPipeFt).toBe(23);
  });

  it('matches the total of every routed segment length (1:1 with the network)', () => {
    const net = routedFrom([head('h1', 0, 0), head('h2', 10, 0), head('h3', 20, 0)]);
    const t = computeTakeoff(net);
    const sumSegs = net.segments.reduce((s, seg) => s + seg.lengthFt, 0);
    expect(t.totalPipeFt).toBeCloseTo(Math.round(sumSegs * 100) / 100, 1);
  });
});

describe('computeTakeoff — fittings grouped by type + size', () => {
  it('counts tees / elbows / reducers by type', () => {
    const net = routedFrom([
      head('h1', 0, 0),
      head('h2', 10, 0),
      head('h3', 20, 0),
      head('h4', 0, 10),
      head('h5', 10, 10),
    ]);
    const t = computeTakeoff(net);
    const fittingLines = t.lines.filter((l) => l.category === 'fitting');
    const fittingNodeCount = net.nodes.filter(
      (n) => n.type === 'TEE' || n.type === 'ELBOW' || n.type === 'REDUCER',
    ).length;
    const summed = fittingLines.reduce((s, l) => s + l.qty, 0);
    expect(summed).toBe(fittingNodeCount);
    expect(t.fittingCount).toBe(fittingNodeCount);
    // At least one tee line exists for a multi-head, multi-row layout.
    expect(fittingLines.some((l) => l.fittingType === 'TEE')).toBe(true);
  });
});

describe('computeTakeoff — riser + grouping + determinism', () => {
  it('emits one riser line for the routed source node', () => {
    const net = routedFrom([head('h1', 0, 0), head('h2', 10, 0)]);
    const t = computeTakeoff(net);
    const riser = t.lines.filter((l) => l.category === 'riser');
    expect(riser).toHaveLength(1);
    expect(riser[0].qty).toBe(1);
    expect(t.riserCount).toBe(1);
  });

  it('is deterministic (same network -> identical BOM) and category-ordered', () => {
    const net = routedFrom([head('h1', 0, 0), head('h2', 10, 0), head('h3', 0, 10)]);
    const a = computeTakeoff(net);
    const b = computeTakeoff(net);
    expect(a).toEqual(b);
    // Categories appear in BOM_CATEGORIES order.
    const order = a.lines.map((l) => BOM_CATEGORIES.indexOf(l.category));
    for (let i = 1; i < order.length; i += 1) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
  });

  it('an empty network yields an empty BOM', () => {
    const t = computeTakeoff({ nodes: [], segments: [], remoteAreas: [] });
    expect(t.lines).toHaveLength(0);
    expect(t.headCount).toBe(0);
    expect(t.totalPipeFt).toBe(0);
    expect(t.fittingCount).toBe(0);
    expect(t.riserCount).toBe(0);
  });
});

describe('formatNominalSize + roundUpToStock', () => {
  it('formats nominal sizes', () => {
    expect(formatNominalSize(2)).toBe('2"');
    expect(formatNominalSize(2.5)).toBe('2-1/2"');
    expect(formatNominalSize(1.25)).toBe('1-1/4"');
    expect(formatNominalSize(0.5)).toBe('1/2"');
  });

  it('rounds footage up to the next stock multiple (opt-in)', () => {
    expect(roundUpToStock(10, 21)).toBe(21);
    expect(roundUpToStock(21, 21)).toBe(21);
    expect(roundUpToStock(22, 21)).toBe(42);
    expect(roundUpToStock(0, 21)).toBe(0);
    // Non-positive stock returns the rounded input unchanged.
    expect(roundUpToStock(13.333, 0)).toBe(13.33);
  });
});
