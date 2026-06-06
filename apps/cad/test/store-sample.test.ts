// store.ts W7: loadSampleProject drives the WHOLE vertical in one call. Proves a
// single action yields >=2 rooms, heads > 0, segments > 0, and a priced bid total
// > 0 — heads + pipe + hydraulics + bid all populated from the example data.
//
// HONESTY: the project is CLEARLY-LABELLED example data; heads use the real catalog
// SKU; the bid prices off the real pricebook (or the honest representative fallback).

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/lib/model';
import {
  EMPTY_SELECTION,
  SAMPLE_HEAD_SKU,
  selectHydraulics,
  selectPricedBid,
  selectTakeoff,
  useCadStore,
} from '../src/store';
import { SAMPLE_PROJECT_NAME } from '../src/lib/sample-project';

// A fetch that fails so ensurePricebookLoaded fail-softs to the representative table
// (deterministic in node — no real /catalog request). The bid still prices.
const failingFetch = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;

function reset(): void {
  useCadStore.setState({
    project: emptyProject(),
    selection: { ...EMPTY_SELECTION },
    viewMode: 'split',
    activeTool: 'select',
    underlay: null,
    activeHeadSku: null,
    supplyPoint: null,
    supply: null,
    designAreaSqFt: null,
    priceTable: null,
  });
}

describe('loadSampleProject — one call populates the whole vertical', () => {
  beforeEach(reset);

  it('yields >=2 rooms, heads > 0, segments > 0, and a priced bid total > 0', async () => {
    await useCadStore.getState().loadSampleProject(failingFetch);
    const s = useCadStore.getState();

    // Building: the labelled example with >= 2 rooms.
    expect(s.project.name).toBe(SAMPLE_PROJECT_NAME);
    expect(s.project.building.rooms.length).toBeGreaterThanOrEqual(2);

    // Heads were auto-laid with the REAL catalog SKU.
    const heads = s.project.network.nodes.filter((n) => n.type === 'HEAD');
    expect(heads.length).toBeGreaterThan(0);
    expect(heads.every((h) => h.sku === SAMPLE_HEAD_SKU)).toBe(true);
    expect(s.activeHeadSku).toBe(SAMPLE_HEAD_SKU);

    // Pipe was routed: segments + a riser exist.
    expect(s.project.network.segments.length).toBeGreaterThan(0);
    expect(s.project.network.nodes.some((n) => n.type === 'SOURCE')).toBe(true);

    // Takeoff maps 1:1 to the network.
    const takeoff = selectTakeoff(s);
    expect(takeoff.headCount).toBe(heads.length);
    expect(takeoff.totalPipeFt).toBeGreaterThan(0);

    // Hydraulics has a supply to compute against.
    expect(s.supply).not.toBeNull();
    const hyd = selectHydraulics(s);
    expect(hyd.perNode.length).toBeGreaterThan(0);

    // Bid is priced (> 0) — proving the bid populated too.
    const bid = selectPricedBid(s);
    expect(bid.bomLines.length).toBeGreaterThan(0);
    expect(bid.estimate.total).toBeGreaterThan(0);
  });

  it('clears any prior project before loading the sample', async () => {
    // Seed a stray head, then load the sample — the prior network must not survive
    // as-is (loadSampleProject calls setProject first, which clears it).
    useCadStore.getState().addHead({ x: 999, y: 10, z: 999 });
    await useCadStore.getState().loadSampleProject(failingFetch);
    const heads = useCadStore.getState().project.network.nodes.filter((n) => n.type === 'HEAD');
    expect(heads.some((h) => h.pos.x === 999 && h.pos.z === 999)).toBe(false);
  });
});
