// W2D multi-selection engine — store integration. setMulti mirrors a single-node
// pick into the legacy single selection (RightInspector contract); togglePickMulti
// wraps the pure togglePick fail-soft; deleteSelected removes heads + segments +
// orphaned fittings as ONE undo step, never deletes SOURCE, and records nothing
// on a no-op.

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject, type Node, type Segment } from '../src/lib/model';
import { EMPTY_SELECTION, useCadStore, type DocSnapshot } from '../src/store';
import { emptyHistory } from '../src/lib/history';
import { emptySelection, type SelectionSet } from '../src/lib/selection-set';

function reset(): void {
  useCadStore.setState({
    project: emptyProject(),
    selection: { ...EMPTY_SELECTION },
    multi: emptySelection(),
    viewMode: 'split',
    activeTool: 'select',
    underlay: null,
    activeHeadSku: null,
    history: emptyHistory<DocSnapshot>(),
    supplyPoint: null,
    supply: null,
    designAreaSqFt: null,
  });
}

function s() {
  return useCadStore.getState();
}

/** Seed a tiny routed network: source -> tee -> two heads (3 segments). */
function seedNetwork(): void {
  const nodes: Node[] = [
    { id: 'src', type: 'SOURCE', pos: { x: 0, y: 0, z: 0 } },
    { id: 't1', type: 'TEE', pos: { x: 5, y: 10, z: 0 } },
    { id: 'h1', type: 'HEAD', pos: { x: 10, y: 10, z: 0 } },
    { id: 'h2', type: 'HEAD', pos: { x: 5, y: 10, z: 5 } },
  ];
  const segments: Segment[] = [
    { id: 'sA', from: 'src', to: 't1', diameterIn: 2, lengthFt: 11, role: 'MAIN', material: 'STEEL_SCH40' },
    { id: 'sB', from: 't1', to: 'h1', diameterIn: 1, lengthFt: 5, role: 'BRANCH', material: 'STEEL_SCH40' },
    { id: 'sC', from: 't1', to: 'h2', diameterIn: 1, lengthFt: 5, role: 'BRANCH', material: 'STEEL_SCH40' },
  ];
  const base = emptyProject();
  useCadStore.setState({
    project: { ...base, network: { ...base.network, nodes, segments } },
    history: emptyHistory<DocSnapshot>(),
  });
}

function sel(partial: Partial<SelectionSet>): SelectionSet {
  return { nodeIds: [], segmentIds: [], roomIds: [], ...partial };
}

describe('setMulti — single selection mirroring', () => {
  beforeEach(reset);

  it('a single-node set mirrors into selection.selectedNodeId', () => {
    seedNetwork();
    s().setMulti(sel({ nodeIds: ['h1'] }));
    expect(s().multi.nodeIds).toEqual(['h1']);
    expect(s().selection.selectedNodeId).toBe('h1');
    expect(s().selection.selectedSegmentId).toBeNull();
    expect(s().selection.selectedRoomId).toBeNull();
  });

  it('a multi-node set clears the single selection entirely', () => {
    seedNetwork();
    s().select('segment', 'sB'); // a prior single pick
    s().setMulti(sel({ nodeIds: ['h1', 'h2'] }));
    expect(s().selection).toEqual(EMPTY_SELECTION);
  });

  it('a segment-only set clears the single selection (no node to mirror)', () => {
    seedNetwork();
    s().select('node', 'h1');
    s().setMulti(sel({ segmentIds: ['sB', 'sC'] }));
    expect(s().selection).toEqual(EMPTY_SELECTION);
    expect(s().multi.segmentIds).toEqual(['sB', 'sC']);
  });

  it('an empty set leaves the existing single selection alone', () => {
    seedNetwork();
    s().select('node', 'h1');
    s().setMulti(emptySelection());
    expect(s().selection.selectedNodeId).toBe('h1');
  });

  it('setMulti is UI-only — it never records undo history', () => {
    seedNetwork();
    s().setMulti(sel({ nodeIds: ['h1', 'h2'] }));
    expect(s().canUndo()).toBe(false);
  });
});

describe('togglePickMulti — additive shift-pick', () => {
  beforeEach(reset);

  it('additive toggles add then remove ids (sorted)', () => {
    seedNetwork();
    s().togglePickMulti('node', 'h2', true);
    expect(s().multi.nodeIds).toEqual(['h2']);
    s().togglePickMulti('node', 'h1', true);
    expect(s().multi.nodeIds).toEqual(['h1', 'h2']);
    s().togglePickMulti('segment', 'sB', true);
    expect(s().multi.segmentIds).toEqual(['sB']);
    expect(s().multi.nodeIds).toEqual(['h1', 'h2']); // other kinds kept
    s().togglePickMulti('node', 'h2', true); // toggle OFF
    expect(s().multi.nodeIds).toEqual(['h1']);
  });

  it('the single-node mirror applies when a toggle leaves exactly one node', () => {
    seedNetwork();
    s().togglePickMulti('node', 'h1', true);
    expect(s().selection.selectedNodeId).toBe('h1');
  });

  it('an empty id is a fail-soft no-op (the pure throw is caught)', () => {
    seedNetwork();
    s().togglePickMulti('node', 'h1', true);
    expect(() => s().togglePickMulti('node', '', true)).not.toThrow();
    expect(s().multi.nodeIds).toEqual(['h1']); // unchanged
  });
});

describe('deleteSelected — one undoable bulk delete', () => {
  beforeEach(reset);

  it('removes picked heads + picked segments + orphaned fittings in ONE undo step', () => {
    seedNetwork();
    // Pick everything: both heads, the tee, the source, and all three segments.
    s().setMulti(
      sel({ nodeIds: ['h1', 'h2', 'src', 't1'], segmentIds: ['sA', 'sB', 'sC'] }),
    );
    s().deleteSelected();

    const net = s().project.network;
    expect(net.segments).toEqual([]); // all picked segments gone
    // Heads gone; the tee is orphaned (degree 0) and swept; SOURCE survives.
    expect(net.nodes.map((n) => n.id)).toEqual(['src']);
    // Selection state fully cleared.
    expect(s().multi).toEqual(emptySelection());
    expect(s().selection).toEqual(EMPTY_SELECTION);

    // ONE undo restores everything at once.
    expect(s().canUndo()).toBe(true);
    s().undo();
    const restored = s().project.network;
    expect(restored.nodes.map((n) => n.id).sort()).toEqual(['h1', 'h2', 'src', 't1']);
    expect(restored.segments.map((g) => g.id).sort()).toEqual(['sA', 'sB', 'sC']);
    expect(s().canUndo()).toBe(false); // it really was a single history entry
  });

  it('never deletes a SOURCE node, even when explicitly picked and orphaned', () => {
    seedNetwork();
    s().setMulti(sel({ nodeIds: ['src'], segmentIds: ['sA'] }));
    s().deleteSelected();
    const ids = s().project.network.nodes.map((n) => n.id);
    expect(ids).toContain('src');
    // sA removed; the tee keeps degree > 0 via sB/sC so it stays too.
    expect(s().project.network.segments.map((g) => g.id).sort()).toEqual(['sB', 'sC']);
    expect(ids).toContain('t1');
  });

  it('keeps a fitting that still has a segment touching it', () => {
    seedNetwork();
    s().setMulti(sel({ nodeIds: ['h1'], segmentIds: ['sB'] }));
    s().deleteSelected();
    const net = s().project.network;
    expect(net.nodes.map((n) => n.id).sort()).toEqual(['h2', 'src', 't1']);
    expect(net.segments.map((g) => g.id).sort()).toEqual(['sA', 'sC']);
  });

  it('a picked fitting alone is NOT directly deleted (pipe-owned)', () => {
    seedNetwork();
    s().setMulti(sel({ nodeIds: ['t1'] }));
    s().deleteSelected();
    // Nothing deletable: tee still has segments touching it -> full no-op.
    expect(s().project.network.nodes.length).toBe(4);
    expect(s().canUndo()).toBe(false);
  });

  it('no-op when the multi-set is empty or matches nothing — records no history', () => {
    seedNetwork();
    s().deleteSelected(); // empty multi
    expect(s().canUndo()).toBe(false);
    s().setMulti(sel({ nodeIds: ['ghost'], segmentIds: ['nope'] }));
    s().deleteSelected(); // unknown ids
    expect(s().project.network.nodes.length).toBe(4);
    expect(s().project.network.segments.length).toBe(3);
    expect(s().canUndo()).toBe(false);
  });

  it('undo/redo clears the multi-set so it never points at changed ids', () => {
    seedNetwork();
    s().addHead({ x: 20, y: 10, z: 20 });
    s().setMulti(sel({ nodeIds: ['h1', 'h2'] }));
    s().undo();
    expect(s().multi).toEqual(emptySelection());
  });
});
