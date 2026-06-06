// HaloFire CAD — the shared workspace store (zustand). This single store is the
// state shared by the 2D plan editor and the 3D viewer: the Project document,
// the current selection, the view mode, and the active tool. 2D and 3D read the
// SAME selection so they stay in sync (select a head in plan, it lights up in 3D).
//
// This is a SHELL store: it holds and mutates state but ships no geometry. The
// tools are declared so the ribbon/left-panel can render and wire to setTool;
// their actual editing behavior arrives in W1-W6.

import { create } from 'zustand';
import { emptyProject, type Project } from './lib/model';

/* --------------------------------------------------------------- view mode */

/** How the center stage is presented. `split` shows plan + 3d side by side. */
export type ViewMode = 'plan' | '3d' | 'split';

export const VIEW_MODES: readonly ViewMode[] = ['plan', '3d', 'split'] as const;

/* ------------------------------------------------------------------- tools */

/** Identifier for an active workspace tool. Behavior lands in later W-slices. */
export type ToolId =
  | 'select'
  | 'pan'
  | 'measure'
  | 'wall'
  | 'room'
  | 'place-head'
  | 'route-pipe'
  | 'import-plan';

/** A tool definition surfaced in the ribbon / left tool list. */
export interface ToolDef {
  id: ToolId;
  /** Short label shown on the button. */
  label: string;
  /** Which ribbon group this belongs to (used for layout). */
  group: 'edit' | 'plan' | 'layout' | 'pipe';
  /** One-line tooltip / aria description. */
  hint: string;
}

/**
 * The shell's tool catalog. Every entry is wired to `setTool`; the ones whose
 * editing logic is not yet implemented are still HONEST buttons — they set the
 * active tool, and their canvases show the "no plan / no building" empty states
 * rather than faking an action.
 */
export const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Select', group: 'edit', hint: 'Select and inspect elements' },
  { id: 'pan', label: 'Pan', group: 'edit', hint: 'Pan the drawing canvas' },
  { id: 'measure', label: 'Measure', group: 'edit', hint: 'Measure a distance in feet' },
  { id: 'import-plan', label: 'Import Plan', group: 'plan', hint: 'Import a DXF or PDF floor plan (W1)' },
  { id: 'wall', label: 'Wall', group: 'plan', hint: 'Draw a wall (W2)' },
  { id: 'room', label: 'Room', group: 'plan', hint: 'Define a room polygon and hazard (W2)' },
  { id: 'place-head', label: 'Place Head', group: 'layout', hint: 'Place a sprinkler head (W3)' },
  { id: 'route-pipe', label: 'Route Pipe', group: 'pipe', hint: 'Route a pipe segment (W4)' },
] as const;

/** Total number of tools the workspace exposes (for the preview handle). */
export const TOOL_COUNT = TOOLS.length;

/* ------------------------------------------------------------- selection */

/**
 * The current selection. At most one of each kind is set; clearing selection
 * sets all to null. 2D and 3D both read these ids.
 */
export interface Selection {
  selectedNodeId: string | null;
  selectedSegmentId: string | null;
  selectedRoomId: string | null;
}

export const EMPTY_SELECTION: Selection = {
  selectedNodeId: null,
  selectedSegmentId: null,
  selectedRoomId: null,
};

/** Kinds of selectable element. */
export type SelectionKind = 'node' | 'segment' | 'room';

/* --------------------------------------------------------------- store */

export interface CadState {
  /** The shared project document. */
  project: Project;
  /** Current selection (shared 2D/3D). */
  selection: Selection;
  /** Center-stage view mode. */
  viewMode: ViewMode;
  /** Active tool id. */
  activeTool: ToolId;

  /** Replace the entire project (e.g. after an import or new-file). Clears selection. */
  setProject: (project: Project) => void;
  /** Select an element by kind+id; selecting one clears the others. Pass null id to clear. */
  select: (kind: SelectionKind, id: string | null) => void;
  /** Clear all selection. */
  clearSelection: () => void;
  /** Set the active tool. */
  setTool: (tool: ToolId) => void;
  /** Set the center-stage view mode. */
  setViewMode: (mode: ViewMode) => void;
}

/** Build the selection object for a single-kind selection. */
function selectionFor(kind: SelectionKind, id: string | null): Selection {
  if (id === null) return { ...EMPTY_SELECTION };
  return {
    selectedNodeId: kind === 'node' ? id : null,
    selectedSegmentId: kind === 'segment' ? id : null,
    selectedRoomId: kind === 'room' ? id : null,
  };
}

export const useCadStore = create<CadState>((set) => ({
  project: emptyProject(),
  selection: { ...EMPTY_SELECTION },
  viewMode: 'split',
  activeTool: 'select',

  setProject: (project) =>
    set({ project, selection: { ...EMPTY_SELECTION } }),
  select: (kind, id) => set({ selection: selectionFor(kind, id) }),
  clearSelection: () => set({ selection: { ...EMPTY_SELECTION } }),
  setTool: (activeTool) => set({ activeTool }),
  setViewMode: (viewMode) => set({ viewMode }),
}));
