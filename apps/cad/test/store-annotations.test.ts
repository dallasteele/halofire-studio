// T29-T34 integration — annotations in the store: add/delete drawing elements
// through the validated constructors, undoable via E0, and the Draw tools are
// surfaced in the ribbon tool catalog.

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/lib/model';
import { EMPTY_SELECTION, TOOLS, useCadStore } from '../src/store';
import { emptyHistory } from '../src/lib/history';
import type { DocSnapshot } from '../src/store';
import { makeCircle, makeLine, makePoint } from '../src/lib/drawing-elements';

function reset(): void {
  useCadStore.setState({
    project: emptyProject(),
    selection: { ...EMPTY_SELECTION },
    viewMode: 'split',
    activeTool: 'select',
    underlay: null,
    activeHeadSku: null,
    history: emptyHistory<DocSnapshot>(),
  });
}

function anns() {
  return useCadStore.getState().project.annotations ?? [];
}

describe('Draw tool catalog (T29-T34)', () => {
  it('exposes the five draw tools in the draw group', () => {
    const draw = TOOLS.filter((t) => t.group === 'draw').map((t) => t.id);
    expect(draw).toEqual(['draw-line', 'draw-polyline', 'draw-circle', 'draw-rect', 'draw-point']);
  });
});

describe('addAnnotation / deleteAnnotation', () => {
  beforeEach(reset);

  it('appends validated elements and empty project starts with none', () => {
    expect(anns()).toEqual([]);
    useCadStore.getState().addAnnotation(makeLine('a1', { x: 0, y: 0 }, { x: 3, y: 4 }));
    useCadStore.getState().addAnnotation(makeCircle('a2', { x: 5, y: 5 }, 2));
    expect(anns().map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('deleteAnnotation removes by id; unknown id is a no-op (no undo entry)', () => {
    useCadStore.getState().addAnnotation(makePoint('p1', { x: 1, y: 1 }));
    const undoDepthAfterAdd = useCadStore.getState().history.past.length;
    useCadStore.getState().deleteAnnotation('nope');
    expect(useCadStore.getState().history.past.length).toBe(undoDepthAfterAdd);
    useCadStore.getState().deleteAnnotation('p1');
    expect(anns()).toEqual([]);
  });

  it('annotations are undoable (E0): undo removes the added element, redo restores', () => {
    useCadStore.getState().addAnnotation(makePoint('p1', { x: 1, y: 1 }));
    expect(anns()).toHaveLength(1);
    useCadStore.getState().undo();
    expect(anns()).toHaveLength(0);
    useCadStore.getState().redo();
    expect(anns()).toHaveLength(1);
    expect(anns()[0].id).toBe('p1');
  });
});
