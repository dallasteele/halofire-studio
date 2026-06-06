// HaloFire CAD — the shared workspace store (zustand). This single store is the
// state shared by the 2D plan editor and the 3D viewer: the Project document,
// the current selection, the view mode, and the active tool. 2D and 3D read the
// SAME selection so they stay in sync (select a head in plan, it lights up in 3D).
//
// This is a SHELL store: it holds and mutates state but ships no geometry. The
// tools are declared so the ribbon/left-panel can render and wire to setTool;
// their actual editing behavior arrives in W1-W6.

import { create } from 'zustand';
import {
  emptyProject,
  makeId,
  type Building,
  type BuildingSource,
  type HazardClass,
  type Project,
  type Room,
  type Wall,
} from './lib/model';

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
  | 'set-scale'
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
  { id: 'import-plan', label: 'Import Plan', group: 'plan', hint: 'Import a DXF (auto walls + scale) or PDF (underlay to trace)' },
  { id: 'set-scale', label: 'Set Scale', group: 'plan', hint: 'Click two points of a known real distance to set ft/unit' },
  { id: 'wall', label: 'Trace Wall', group: 'plan', hint: 'Click to draw a wall polyline over the underlay' },
  { id: 'room', label: 'Room', group: 'plan', hint: 'Click a closed room polygon and pick a hazard class' },
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

/* ------------------------------------------------------------- underlay */

/**
 * The plan-space underlay the operator traces over. A DXF underlay carries true
 * vector linework (and a real scale); a PDF underlay is a rendered raster used for
 * VISUAL tracing only — its scale comes from the operator's set-scale, never the PDF.
 * `null` = no underlay loaded. This is UI/import state, kept out of the saved model.
 */
export type Underlay =
  | {
      kind: 'dxf';
      /** DXF lines in plan-space (model units). */
      lines: { x1: number; y1: number; x2: number; y2: number }[];
      bounds: { minX: number; minY: number; maxX: number; maxY: number };
      label: string;
    }
  | {
      kind: 'pdf';
      /** Rendered page raster (HTMLCanvasElement) for a konva Image. */
      canvas: HTMLCanvasElement;
      widthPx: number;
      heightPx: number;
      pageNumber: number;
      numPages: number;
      label: string;
    };

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
  /** The plan underlay being traced over, or null when none is loaded. */
  underlay: Underlay | null;

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
  /** Set the trace underlay (DXF vector or PDF raster), or null to clear it. */
  setUnderlay: (underlay: Underlay | null) => void;
  /** Replace the whole building shell (walls/rooms/scale/source) at once. */
  setBuilding: (building: Building) => void;
  /** Set the plan-to-feet scale (operator-supplied or DXF-derived). */
  setScale: (ftPerUnit: number, source?: BuildingSource) => void;
  /** Append one wall to the building (sets source if it was 'none'). */
  addWall: (wall: Wall) => void;
  /**
   * Append a room polygon with a hazard class (and optional ceiling height/name).
   * Uses the project hazard default ceiling height when none is given. Returns the
   * new room id.
   */
  addRoom: (
    polygon: Room['polygon'],
    hazard: HazardClass,
    extra?: { ceilingHt?: number; name?: string },
  ) => string;
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
  underlay: null,

  setProject: (project) =>
    set({ project, selection: { ...EMPTY_SELECTION } }),
  select: (kind, id) => set({ selection: selectionFor(kind, id) }),
  clearSelection: () => set({ selection: { ...EMPTY_SELECTION } }),
  setTool: (activeTool) => set({ activeTool }),
  setViewMode: (viewMode) => set({ viewMode }),
  setUnderlay: (underlay) => set({ underlay }),

  setBuilding: (building) =>
    set((s) => ({ project: { ...s.project, building } })),

  setScale: (ftPerUnit, source) =>
    set((s) => {
      if (!Number.isFinite(ftPerUnit) || ftPerUnit <= 0) return s;
      const building: Building = {
        ...s.project.building,
        scaleFtPerUnit: ftPerUnit,
      };
      // A scale alone does not constitute geometry; only promote source when the
      // caller explicitly supplies one (e.g. 'manual' once the operator begins).
      if (source) building.source = source;
      return { project: { ...s.project, building } };
    }),

  addWall: (wall) =>
    set((s) => {
      const b = s.project.building;
      const building: Building = {
        ...b,
        walls: [...b.walls, wall],
        source: b.source === 'none' ? 'manual' : b.source,
      };
      return { project: { ...s.project, building } };
    }),

  addRoom: (polygon, hazard, extra) => {
    const id = makeId('room');
    set((s) => {
      const b = s.project.building;
      const room: Room = {
        id,
        polygon,
        hazard,
        ceilingHt: extra?.ceilingHt ?? s.project.hazardDefaults.defaultCeilingHt,
        ...(extra?.name ? { name: extra.name } : {}),
      };
      const building: Building = {
        ...b,
        rooms: [...b.rooms, room],
        source: b.source === 'none' ? 'manual' : b.source,
      };
      return { project: { ...s.project, building } };
    });
    return id;
  },
}));
