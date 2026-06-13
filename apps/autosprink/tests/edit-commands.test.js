import { describe, expect, it } from 'vitest';
import {
  createCommandStack, cloneModel, resolveSolidIndex,
  moveSolid, deleteSolid, copySolid, rotateSolid, mirrorSolid, addSolid, setSolidFields,
} from '../src/engine/edit-commands.js';

// HF-W1-CMD — the snapshot command stack + pure cadModel edit ops. The stack
// mirrors apps/cad/src/lib/history.ts (record/undo/redo/limit) and store.ts
// (mutator-returns-null = no-op records nothing); edits operate on the
// autosprink cadModel {solids:[...], counts}.

function sampleModel() {
  return {
    solids: [
      { kind: 'pipe', role: 'main', from: [0, 0, 9], to: [10, 0, 9], diameterIn: 6 },
      { kind: 'pipe', role: 'branch', from: [0, 0, 9], to: [0, 8, 9], diameterIn: 1.25 },
      { kind: 'pipe', role: 'drop', from: [5, 4, 9], to: [5, 4, 8], diameterIn: 1 },
      { kind: 'head', position: [5, 4, 8] },
      { kind: 'wall', center: [5, 0], a: [0, 0], b: [10, 0], lengthFt: 10, heightFt: 9, thicknessFt: 0.5, rotationY: 0, type: 'exterior' },
      { kind: 'column', x: 2, y: 2, sizeFt: 1, heightFt: 9 },
    ],
    counts: { walls: 1, pipes: 3, heads: 1, columns: 1, components: 0 },
  };
}

function harness(model0) {
  let model = model0;
  const stack = createCommandStack({ getModel: () => model, setModel: (m) => { model = m; }, limit: 5 });
  return { stack, get: () => model };
}

describe('createCommandStack', () => {
  it('apply commits a new model, records PRE, clears redo', () => {
    const h = harness(sampleModel());
    const ok = h.stack.apply('move', (m) => moveSolid(m, { kind: 'head', index: 0 }, [1, 0, 0]));
    expect(ok).toBe(true);
    expect(h.get().solids[3].position).toEqual([6, 4, 8]);
    expect(h.stack.canUndo()).toBe(true);
    expect(h.stack.canRedo()).toBe(false);
  });

  it('undo restores the exact PRE snapshot; redo re-applies', () => {
    const h = harness(sampleModel());
    h.stack.apply('move', (m) => moveSolid(m, { kind: 'head', index: 0 }, [1, 0, 0]));
    h.stack.undo();
    expect(h.get().solids[3].position).toEqual([5, 4, 8]);
    expect(h.stack.canRedo()).toBe(true);
    h.stack.redo();
    expect(h.get().solids[3].position).toEqual([6, 4, 8]);
  });

  it('a mutator returning null is a no-op (records nothing) — store.ts discipline', () => {
    const h = harness(sampleModel());
    const ok = h.stack.apply('noop', () => null);
    expect(ok).toBe(false);
    expect(h.stack.canUndo()).toBe(false);
  });

  it('a no-delta move returns null -> no history entry', () => {
    const h = harness(sampleModel());
    expect(h.stack.apply('move0', (m) => moveSolid(m, { kind: 'head', index: 0 }, [0, 0, 0]))).toBe(false);
    expect(h.stack.canUndo()).toBe(false);
  });

  it('honors the limit (oldest past dropped)', () => {
    const h = harness(sampleModel());
    for (let i = 0; i < 8; i += 1) h.stack.apply('m', (m) => moveSolid(m, { kind: 'head', index: 0 }, [1, 0, 0]));
    expect(h.stack._stacks().past.length).toBe(5); // limit
    expect(h.stack.depth()).toBe(5);
  });

  it('a new edit after undo invalidates the redo future', () => {
    const h = harness(sampleModel());
    h.stack.apply('a', (m) => moveSolid(m, { kind: 'head', index: 0 }, [1, 0, 0]));
    h.stack.undo();
    expect(h.stack.canRedo()).toBe(true);
    h.stack.apply('b', (m) => moveSolid(m, { kind: 'head', index: 0 }, [0, 1, 0]));
    expect(h.stack.canRedo()).toBe(false);
  });

  it('undo/redo never share references with the live model (deep snapshots)', () => {
    const h = harness(sampleModel());
    h.stack.apply('move', (m) => moveSolid(m, { kind: 'head', index: 0 }, [1, 0, 0]));
    const before = h.get();
    h.stack.undo();
    h.get().solids[3].position[0] = 999; // mutate restored
    h.stack.redo();
    expect(h.get().solids[3].position).toEqual([6, 4, 8]); // redo snapshot untouched
    expect(before).not.toBe(h.get());
  });
});

describe('resolveSolidIndex', () => {
  const m = sampleModel();
  it('resolves kind+index across the kind-filtered order', () => {
    expect(resolveSolidIndex(m, { kind: 'head', index: 0 })).toBe(3);
    expect(resolveSolidIndex(m, { kind: 'drop', index: 0 })).toBe(2);
    expect(resolveSolidIndex(m, { kind: 'pipe', index: 0 })).toBe(0); // main (not the drop)
    expect(resolveSolidIndex(m, { kind: 'pipe', index: 1 })).toBe(1); // branch
    expect(resolveSolidIndex(m, { kind: 'wall', index: 0 })).toBe(4);
  });
  it('resolves a direct solidIndex', () => {
    expect(resolveSolidIndex(m, { solidIndex: 2 })).toBe(2);
    expect(resolveSolidIndex(m, { solidIndex: 99 })).toBe(-1);
  });
});

describe('edit ops (pure)', () => {
  it('moveSolid translates from/to/position/center/a/b/x/y', () => {
    const m = moveSolid(sampleModel(), { kind: 'pipe', index: 0 }, [2, 3, 0]);
    expect(m.solids[0].from).toEqual([2, 3, 9]);
    expect(m.solids[0].to).toEqual([12, 3, 9]);
    expect(m.solids[0].hfEdited).toBe('moved');
  });

  it('deleteSolid removes + recounts', () => {
    const m = deleteSolid(sampleModel(), { kind: 'head', index: 0 });
    expect(m.solids.length).toBe(5);
    expect(m.counts.heads).toBe(0);
    expect(m.solids.find((s) => s.kind === 'head')).toBeUndefined();
  });

  it('copySolid duplicates with offset + recounts', () => {
    const m = copySolid(sampleModel(), { kind: 'head', index: 0 }, [3, 0, 0]);
    expect(m.counts.heads).toBe(2);
    const heads = m.solids.filter((s) => s.kind === 'head');
    expect(heads[1].position).toEqual([8, 4, 8]);
    expect(heads[1].hfEdited).toBe('copied');
  });

  it('rotateSolid 90deg about a head pivot rotates a pipe run in plan', () => {
    const m = rotateSolid(sampleModel(), { kind: 'pipe', index: 0 }, Math.PI / 2, [0, 0]);
    // [10,0] rotated +90 about origin -> [0,10]
    expect(m.solids[0].to[0]).toBeCloseTo(0, 6);
    expect(m.solids[0].to[1]).toBeCloseTo(10, 6);
    expect(m.solids[0].to[2]).toBe(9); // Z preserved
  });

  it('mirrorSolid across plan-Y reflects X about the pivot', () => {
    const m = mirrorSolid(sampleModel(), { kind: 'pipe', index: 0 }, 'y', [0, 0]);
    expect(m.solids[0].to).toEqual([-10, 0, 9]);
  });

  it('addSolid appends a drawn solid + recounts + flags edited', () => {
    const m = addSolid(sampleModel(), { kind: 'pipe', role: 'branch', from: [0, 0, 9], to: [4, 0, 9], diameterIn: 1.25 });
    expect(m.counts.pipes).toBe(4);
    expect(m.solids[m.solids.length - 1].hfEdited).toBe('drawn');
  });

  it('setSolidFields commits changed fields only; no-op when unchanged', () => {
    const m = setSolidFields(sampleModel(), { kind: 'pipe', index: 0 }, { diameterIn: 8 });
    expect(m.solids[0].diameterIn).toBe(8);
    expect(m.solids[0].hfEdited).toBe('fields-edited');
    expect(setSolidFields(sampleModel(), { kind: 'pipe', index: 0 }, { diameterIn: 6 })).toBeNull();
  });

  it('ops on a missing ref return null (no-op)', () => {
    expect(moveSolid(sampleModel(), { kind: 'head', index: 9 }, [1, 0, 0])).toBeNull();
    expect(deleteSolid(sampleModel(), { solidIndex: 99 })).toBeNull();
  });

  it('cloneModel deep-copies (no shared refs)', () => {
    const a = sampleModel();
    const b = cloneModel(a);
    b.solids[0].from[0] = 99;
    expect(a.solids[0].from[0]).toBe(0);
  });
});
