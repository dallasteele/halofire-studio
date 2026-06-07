// E0 store integration — undo/redo over real document edits. Every model-mutating
// store action records the pre-mutation document; UI-only actions do not. We assert
// the round-trip on representative edits (add head, move, delete segment, supply
// point) and that UI actions / no-ops never create undo entries.

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/lib/model';
import { EMPTY_SELECTION, useCadStore } from '../src/store';
import { emptyHistory } from '../src/lib/history';
import type { DocSnapshot } from '../src/store';

function reset(): void {
  useCadStore.setState({
    project: emptyProject(),
    selection: { ...EMPTY_SELECTION },
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
function headCount(): number {
  return s().project.network.nodes.filter((n) => n.type === 'HEAD').length;
}

describe('undo/redo — add head', () => {
  beforeEach(reset);

  it('starts with nothing to undo or redo', () => {
    expect(s().canUndo()).toBe(false);
    expect(s().canRedo()).toBe(false);
  });

  it('undo removes a freshly added head; redo restores it', () => {
    s().addHead({ x: 1, y: 10, z: 2 });
    expect(headCount()).toBe(1);
    expect(s().canUndo()).toBe(true);

    s().undo();
    expect(headCount()).toBe(0); // back to the empty pre-add document
    expect(s().canUndo()).toBe(false);
    expect(s().canRedo()).toBe(true);

    s().redo();
    expect(headCount()).toBe(1); // head restored
    expect(s().canRedo()).toBe(false);
  });

  it('multiple edits undo in LIFO order', () => {
    s().addHead({ x: 0, y: 10, z: 0 });
    s().addHead({ x: 5, y: 10, z: 0 });
    s().addHead({ x: 10, y: 10, z: 0 });
    expect(headCount()).toBe(3);
    s().undo();
    expect(headCount()).toBe(2);
    s().undo();
    expect(headCount()).toBe(1);
    s().undo();
    expect(headCount()).toBe(0);
    expect(s().canUndo()).toBe(false);
  });
});

describe('undo/redo — a new edit clears the redo future', () => {
  beforeEach(reset);

  it('editing after an undo drops the redo stack', () => {
    s().addHead({ x: 0, y: 10, z: 0 }); // A
    s().undo(); // back to empty, redo has A
    expect(s().canRedo()).toBe(true);
    s().addHead({ x: 9, y: 10, z: 0 }); // new edit B
    expect(s().canRedo()).toBe(false); // A redo is gone
    expect(headCount()).toBe(1);
  });
});

describe('undo/redo — move and delete', () => {
  beforeEach(reset);

  it('undo restores a moved head to its prior position', () => {
    const id = s().addHead({ x: 1, y: 10, z: 1 });
    s().moveHead(id, { x: 8, y: 10, z: 8 });
    const moved = s().project.network.nodes.find((n) => n.id === id)!;
    expect(moved.pos.x).toBe(8);
    s().undo();
    const back = s().project.network.nodes.find((n) => n.id === id)!;
    expect(back.pos.x).toBe(1);
    expect(back.pos.z).toBe(1);
  });

  it('undo restores a deleted segment', () => {
    // Build a tiny network with one segment directly.
    const base = emptyProject();
    useCadStore.setState({
      project: {
        ...base,
        network: {
          ...base.network,
          nodes: [
            { id: 'a', type: 'HEAD', pos: { x: 0, y: 10, z: 0 } },
            { id: 'b', type: 'HEAD', pos: { x: 5, y: 10, z: 0 } },
          ],
          segments: [
            {
              id: 'seg1',
              from: 'a',
              to: 'b',
              diameterIn: 1,
              lengthFt: 5,
              role: 'BRANCH',
              material: 'STEEL_SCH40',
            },
          ],
        },
      },
      history: emptyHistory<DocSnapshot>(),
    });
    expect(s().project.network.segments.length).toBe(1);
    s().deleteSegment('seg1');
    expect(s().project.network.segments.length).toBe(0);
    s().undo();
    expect(s().project.network.segments.length).toBe(1);
    expect(s().project.network.segments[0].id).toBe('seg1');
  });
});

describe('undo/redo — supply point is undoable', () => {
  beforeEach(reset);

  it('undo restores the prior supply point', () => {
    s().setSupplyPoint({ x: 2, y: 3 });
    expect(s().supplyPoint).toEqual({ x: 2, y: 3 });
    s().undo();
    expect(s().supplyPoint).toBeNull();
    s().redo();
    expect(s().supplyPoint).toEqual({ x: 2, y: 3 });
  });
});

describe('undo/redo — UI actions and no-ops do NOT record history', () => {
  beforeEach(reset);

  it('changing the active tool is not undoable', () => {
    s().setTool('route-pipe');
    expect(s().canUndo()).toBe(false);
  });

  it('changing the view mode is not undoable', () => {
    s().setViewMode('3d');
    expect(s().canUndo()).toBe(false);
  });

  it('selecting an element is not undoable', () => {
    const id = s().addHead({ x: 0, y: 10, z: 0 }); // 1 undo entry
    s().select('node', id);
    s().undo(); // should undo the ADD, not the selection
    expect(headCount()).toBe(0);
    expect(s().canUndo()).toBe(false);
  });

  it('a no-op edit (move unknown id) records nothing', () => {
    s().moveHead('does-not-exist', { x: 1, y: 1, z: 1 });
    expect(s().canUndo()).toBe(false);
  });

  it('undo with nothing to undo is a safe no-op', () => {
    expect(() => s().undo()).not.toThrow();
    expect(headCount()).toBe(0);
  });
});
