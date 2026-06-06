// store.ts tests: actions mutate state correctly, selection is single-kind and
// mutually-exclusive, setProject clears selection, and view/tool actions work.

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/lib/model';
import {
  EMPTY_SELECTION,
  TOOL_COUNT,
  TOOLS,
  VIEW_MODES,
  useCadStore,
} from '../src/store';

function reset(): void {
  useCadStore.setState({
    project: emptyProject(),
    selection: { ...EMPTY_SELECTION },
    viewMode: 'split',
    activeTool: 'select',
  });
}

describe('cad store initial state', () => {
  beforeEach(reset);

  it('starts in split view with the select tool and no selection', () => {
    const s = useCadStore.getState();
    expect(s.viewMode).toBe('split');
    expect(s.activeTool).toBe('select');
    expect(s.selection).toEqual(EMPTY_SELECTION);
  });

  it('TOOL_COUNT matches the TOOLS catalog length', () => {
    expect(TOOL_COUNT).toBe(TOOLS.length);
    expect(TOOL_COUNT).toBeGreaterThan(0);
  });
});

describe('setTool / setViewMode', () => {
  beforeEach(reset);

  it('setTool updates the active tool', () => {
    useCadStore.getState().setTool('wall');
    expect(useCadStore.getState().activeTool).toBe('wall');
  });

  it('setViewMode cycles through all valid modes', () => {
    for (const mode of VIEW_MODES) {
      useCadStore.getState().setViewMode(mode);
      expect(useCadStore.getState().viewMode).toBe(mode);
    }
  });
});

describe('selection is single-kind and mutually exclusive', () => {
  beforeEach(reset);

  it('selecting a node clears segment/room', () => {
    useCadStore.getState().select('segment', 'seg-1');
    useCadStore.getState().select('node', 'node-1');
    const sel = useCadStore.getState().selection;
    expect(sel.selectedNodeId).toBe('node-1');
    expect(sel.selectedSegmentId).toBeNull();
    expect(sel.selectedRoomId).toBeNull();
  });

  it('selecting a room clears node/segment', () => {
    useCadStore.getState().select('node', 'node-1');
    useCadStore.getState().select('room', 'room-9');
    const sel = useCadStore.getState().selection;
    expect(sel.selectedRoomId).toBe('room-9');
    expect(sel.selectedNodeId).toBeNull();
    expect(sel.selectedSegmentId).toBeNull();
  });

  it('select(kind, null) clears everything', () => {
    useCadStore.getState().select('node', 'node-1');
    useCadStore.getState().select('node', null);
    expect(useCadStore.getState().selection).toEqual(EMPTY_SELECTION);
  });

  it('clearSelection resets to EMPTY_SELECTION', () => {
    useCadStore.getState().select('segment', 'seg-2');
    useCadStore.getState().clearSelection();
    expect(useCadStore.getState().selection).toEqual(EMPTY_SELECTION);
  });
});

describe('setProject', () => {
  beforeEach(reset);

  it('replaces the project and clears selection', () => {
    useCadStore.getState().select('node', 'node-1');
    const next = emptyProject('Replacement');
    useCadStore.getState().setProject(next);
    const s = useCadStore.getState();
    expect(s.project.name).toBe('Replacement');
    expect(s.selection).toEqual(EMPTY_SELECTION);
  });
});
