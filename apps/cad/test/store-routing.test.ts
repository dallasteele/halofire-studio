// store.ts W4 pipe-routing actions: routeSystem / setSupplyPoint / moveNode /
// deleteSegment / setSegmentDiameter. The route is generated from the current heads,
// replaces prior auto-routed pipe, and PRESERVES heads. Editable ops mutate the
// routed network. Everything maps 1:1 to the store — no fabrication.

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/lib/model';
import { EMPTY_SELECTION, useCadStore } from '../src/store';
import { reachableFrom } from '../src/lib/pipe-routing';

function reset(): void {
  useCadStore.setState({
    project: emptyProject(),
    selection: { ...EMPTY_SELECTION },
    viewMode: 'split',
    activeTool: 'select',
    underlay: null,
    activeHeadSku: null,
    supplyPoint: null,
  });
}

function addRow(_prefix: string, n: number, z: number, y = 10): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    ids.push(useCadStore.getState().addHead({ x: i * 10, y, z }));
  }
  return ids;
}

function net() {
  return useCadStore.getState().project.network;
}

describe('routeSystem action', () => {
  beforeEach(reset);

  it('generates a tree from heads, preserves heads, adds fittings + segments', () => {
    const headIds = [...addRow('a', 3, 0), ...addRow('b', 3, 10)];
    useCadStore.getState().routeSystem();
    const n = net();
    // All original heads survive verbatim.
    for (const id of headIds) {
      expect(n.nodes.some((node) => node.id === id && node.type === 'HEAD')).toBe(true);
    }
    // Fittings + a riser were added.
    expect(n.nodes.some((node) => node.type === 'SOURCE')).toBe(true);
    expect(n.nodes.some((node) => node.type === 'TEE')).toBe(true);
    expect(n.segments.length).toBeGreaterThan(0);
    // Every head is reachable from the riser through the segments.
    const riser = n.nodes.find((node) => node.type === 'SOURCE')!;
    const reach = reachableFrom(riser.id, n.segments);
    expect(headIds.every((id) => reach.has(id))).toBe(true);
  });

  it('re-routing replaces prior pipe (no accumulation) and keeps the same heads', () => {
    addRow('a', 4, 0);
    useCadStore.getState().routeSystem();
    const firstSegs = net().segments.length;
    const firstHeads = net().nodes.filter((node) => node.type === 'HEAD').length;
    useCadStore.getState().routeSystem();
    expect(net().segments.length).toBe(firstSegs);
    expect(net().nodes.filter((node) => node.type === 'HEAD').length).toBe(firstHeads);
    // Exactly one riser after a re-route (no duplicates).
    expect(net().nodes.filter((node) => node.type === 'SOURCE').length).toBe(1);
  });

  it('with no heads it clears pipe and adds nothing', () => {
    useCadStore.getState().routeSystem();
    expect(net().segments.length).toBe(0);
    expect(net().nodes.length).toBe(0);
  });

  it('uses the stored supplyPoint when set', () => {
    addRow('a', 2, 0);
    useCadStore.getState().setSupplyPoint({ x: -99, y: 3 });
    useCadStore.getState().routeSystem();
    const riser = net().nodes.find((node) => node.type === 'SOURCE')!;
    expect(riser.pos.x).toBe(-99);
    expect(riser.pos.z).toBe(3);
  });
});

describe('moveNode', () => {
  beforeEach(reset);

  it('moves a fitting node but never a head (heads use moveHead)', () => {
    const headId = useCadStore.getState().addHead({ x: 0, y: 10, z: 0 });
    addRow('a', 2, 0);
    useCadStore.getState().routeSystem();
    const tee = net().nodes.find((node) => node.type === 'TEE')!;
    useCadStore.getState().moveNode(tee.id, { x: 5, y: 9, z: 5 });
    expect(net().nodes.find((node) => node.id === tee.id)?.pos).toEqual({ x: 5, y: 9, z: 5 });
    // moveNode refuses heads.
    const before = useCadStore.getState().project;
    useCadStore.getState().moveNode(headId, { x: 1, y: 1, z: 1 });
    expect(useCadStore.getState().project).toBe(before);
  });

  it('is a no-op for an unknown id', () => {
    addRow('a', 2, 0);
    useCadStore.getState().routeSystem();
    const before = useCadStore.getState().project;
    useCadStore.getState().moveNode('nope', { x: 0, y: 0, z: 0 });
    expect(useCadStore.getState().project).toBe(before);
  });
});

describe('deleteSegment', () => {
  beforeEach(reset);

  it('removes one segment and clears selection if it was selected', () => {
    addRow('a', 3, 0);
    useCadStore.getState().routeSystem();
    const seg = net().segments[0];
    useCadStore.getState().select('segment', seg.id);
    const before = net().segments.length;
    useCadStore.getState().deleteSegment(seg.id);
    expect(net().segments.length).toBe(before - 1);
    expect(useCadStore.getState().selection).toEqual(EMPTY_SELECTION);
  });

  it('is a no-op for an unknown id', () => {
    addRow('a', 2, 0);
    useCadStore.getState().routeSystem();
    const before = useCadStore.getState().project;
    useCadStore.getState().deleteSegment('nope');
    expect(useCadStore.getState().project).toBe(before);
  });
});

describe('setSegmentDiameter', () => {
  beforeEach(reset);

  it('overrides a segment diameter', () => {
    addRow('a', 3, 0);
    useCadStore.getState().routeSystem();
    const seg = net().segments[0];
    useCadStore.getState().setSegmentDiameter(seg.id, 6);
    expect(net().segments.find((sg) => sg.id === seg.id)?.diameterIn).toBe(6);
  });

  it('rejects a non-positive diameter and an unknown id', () => {
    addRow('a', 2, 0);
    useCadStore.getState().routeSystem();
    const seg = net().segments[0];
    const before = useCadStore.getState().project;
    useCadStore.getState().setSegmentDiameter(seg.id, 0);
    useCadStore.getState().setSegmentDiameter('nope', 4);
    expect(useCadStore.getState().project).toBe(before);
  });
});
