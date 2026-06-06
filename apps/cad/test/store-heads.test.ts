// store.ts head-action tests (W3): addHead / moveHead / deleteHead / autoLayoutRoom
// and the active head SKU. Heads live in project.network.nodes (type HEAD) and map
// 1:1 to the store — no fabrication.

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/lib/model';
import { EMPTY_SELECTION, useCadStore } from '../src/store';

function reset(): void {
  useCadStore.setState({
    project: emptyProject(),
    selection: { ...EMPTY_SELECTION },
    viewMode: 'split',
    activeTool: 'select',
    underlay: null,
    activeHeadSku: null,
  });
}

function heads() {
  return useCadStore.getState().project.network.nodes.filter((n) => n.type === 'HEAD');
}

describe('active head SKU', () => {
  beforeEach(reset);

  it('setActiveHeadSku sets and clears the active SKU', () => {
    useCadStore.getState().setActiveHeadSku('tyco-ty3331');
    expect(useCadStore.getState().activeHeadSku).toBe('tyco-ty3331');
    useCadStore.getState().setActiveHeadSku(null);
    expect(useCadStore.getState().activeHeadSku).toBeNull();
  });
});

describe('addHead', () => {
  beforeEach(reset);

  it('adds a HEAD node at the given position and returns its id', () => {
    const id = useCadStore.getState().addHead({ x: 5, y: 10, z: 7 });
    const node = useCadStore.getState().project.network.nodes.find((n) => n.id === id);
    expect(node).toBeDefined();
    expect(node?.type).toBe('HEAD');
    expect(node?.pos).toEqual({ x: 5, y: 10, z: 7 });
    expect(heads().length).toBe(1);
  });

  it('uses the explicit sku, else the active sku', () => {
    useCadStore.getState().setActiveHeadSku('active-sku');
    const a = useCadStore.getState().addHead({ x: 0, y: 0, z: 0 });
    const b = useCadStore.getState().addHead({ x: 1, y: 0, z: 0 }, 'explicit-sku');
    const nodes = useCadStore.getState().project.network.nodes;
    expect(nodes.find((n) => n.id === a)?.sku).toBe('active-sku');
    expect(nodes.find((n) => n.id === b)?.sku).toBe('explicit-sku');
  });
});

describe('moveHead', () => {
  beforeEach(reset);

  it('moves an existing head', () => {
    const id = useCadStore.getState().addHead({ x: 0, y: 8, z: 0 });
    useCadStore.getState().moveHead(id, { x: 3, y: 8, z: 4 });
    const node = useCadStore.getState().project.network.nodes.find((n) => n.id === id);
    expect(node?.pos).toEqual({ x: 3, y: 8, z: 4 });
  });

  it('is a no-op for an unknown id', () => {
    useCadStore.getState().addHead({ x: 0, y: 8, z: 0 });
    const before = useCadStore.getState().project;
    useCadStore.getState().moveHead('nope', { x: 9, y: 9, z: 9 });
    expect(useCadStore.getState().project).toBe(before);
  });
});

describe('deleteHead', () => {
  beforeEach(reset);

  it('removes the head and clears selection when it was selected', () => {
    const id = useCadStore.getState().addHead({ x: 0, y: 8, z: 0 });
    useCadStore.getState().select('node', id);
    useCadStore.getState().deleteHead(id);
    expect(heads().length).toBe(0);
    expect(useCadStore.getState().selection).toEqual(EMPTY_SELECTION);
  });

  it('is a no-op for an unknown id', () => {
    useCadStore.getState().addHead({ x: 0, y: 8, z: 0 });
    const before = useCadStore.getState().project;
    useCadStore.getState().deleteHead('nope');
    expect(useCadStore.getState().project).toBe(before);
  });
});

describe('autoLayoutRoom', () => {
  beforeEach(reset);

  it('lays the NFPA grid of heads inside a 30x40 ordinary_1 room (scale 1)', () => {
    // Room polygon in plan UNITS == feet (scale 1 by default).
    const roomId = useCadStore.getState().addRoom(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
        { x: 0, y: 40 },
      ],
      'ORDINARY_1',
      { ceilingHt: 12 },
    );
    const ids = useCadStore.getState().autoLayoutRoom(roomId, 'tyco-ty3331');
    // Effective spacing min(15, sqrt(130)=11.40)=11.40 ft -> 3 cols x 4 rows.
    expect(ids.length).toBe(12);
    const placed = heads();
    expect(placed.length).toBe(12);
    // Heads carry the SKU and sit at the room ceiling height (y up).
    expect(placed.every((n) => n.sku === 'tyco-ty3331')).toBe(true);
    expect(placed.every((n) => n.pos.y === 12)).toBe(true);
  });

  it('re-running replaces that room\'s auto heads (no duplication)', () => {
    const roomId = useCadStore.getState().addRoom(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
        { x: 0, y: 40 },
      ],
      'ORDINARY_1',
    );
    useCadStore.getState().autoLayoutRoom(roomId);
    const first = heads().length;
    useCadStore.getState().autoLayoutRoom(roomId);
    expect(heads().length).toBe(first);
  });

  it('respects scaleFtPerUnit when converting the polygon to feet', () => {
    // Polygon spans 60 plan units; at 0.5 ft/unit that is 30 ft -> 2 columns.
    useCadStore.getState().setScale(0.5, 'manual');
    const roomId = useCadStore.getState().addRoom(
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 80 },
        { x: 0, y: 80 },
      ],
      'ORDINARY_1',
    );
    const ids = useCadStore.getState().autoLayoutRoom(roomId);
    // 30 ft x 40 ft, effective spacing ~11.40 ft -> 3 x 4 = 12 heads.
    expect(ids.length).toBe(12);
  });

  it('is a no-op for an unknown room id', () => {
    const before = useCadStore.getState().project;
    const ids = useCadStore.getState().autoLayoutRoom('nope');
    expect(ids).toEqual([]);
    expect(useCadStore.getState().project).toBe(before);
  });

  it('does not disturb a manually-placed head in another room', () => {
    const manual = useCadStore.getState().addHead({ x: 100, y: 8, z: 100 });
    const roomId = useCadStore.getState().addRoom(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
        { x: 0, y: 40 },
      ],
      'ORDINARY_1',
    );
    useCadStore.getState().autoLayoutRoom(roomId);
    expect(
      useCadStore.getState().project.network.nodes.some((n) => n.id === manual),
    ).toBe(true);
  });
});
