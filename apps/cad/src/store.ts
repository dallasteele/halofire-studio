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
  type Node,
  type Point3,
  type Project,
  type Room,
  type Wall,
} from './lib/model';
import { autoLayoutHeads } from './lib/head-layout';
import {
  routeSystem,
  type RouteOpts,
  type SupplyPoint,
} from './lib/pipe-routing';
import {
  solveHydraulics,
  type HydraulicsResult,
  type WaterSupply,
} from './lib/hydraulics';
import { computeTakeoff, type Takeoff } from './lib/takeoff';
import { buildPricedBid, type PricedBid } from './lib/priced-bid';
import {
  loadPricebook,
  resolvePriceTable,
  type PriceTable,
} from './lib/bid';
import { buildSampleProject } from './lib/sample-project';
import type { WaterSupply as Supply } from './lib/hydraulics';
import {
  emptyHistory,
  record as recordHistory,
  undo as historyUndo,
  redo as historyRedo,
  canUndo as historyCanUndo,
  canRedo as historyCanRedo,
  type History,
} from './lib/history';

/**
 * The real catalog head SKU id the sample project lays out with. This is the only
 * head in the ingested manufacturer catalog that carries a K-factor (Tyco TY-FRB,
 * K=5.6), so the sample uses a REAL part — never a fabricated SKU.
 */
export const SAMPLE_HEAD_SKU = 'tyco-ty3331';

/**
 * A representative water-supply flow test for the sample project (static / residual
 * @ flow). Operator-typical figures so the sample exercises the hydraulics adequacy
 * check; the operator overrides these with their real flow test for a real job.
 */
export const SAMPLE_SUPPLY: Supply = {
  staticPsi: 70,
  residualPsi: 50,
  flowGpm: 1000,
};

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

/* --------------------------------------------------------------- history */

/**
 * The undoable DOCUMENT slice of the store. Undo/redo restores the drawing — the
 * project (building + sprinkler network) and the supply/riser entry point that
 * shapes routing. UI state (selection, active tool, view mode, underlay, heatmap,
 * price table) and pure analysis knobs (supply flow test, design area) are NOT
 * undoable: they recompute live and are cheap to re-set, matching how a CAD undo
 * affects the drawing, not the view.
 */
export interface DocSnapshot {
  project: Project;
  supplyPoint: SupplyPoint | null;
}

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
  /**
   * The currently-selected head SKU id (a real catalog head id). Used as the SKU
   * for newly-placed and auto-laid-out heads. null until the operator picks one.
   */
  activeHeadSku: string | null;

  /**
   * The undo/redo history of document snapshots (E0). Every model-mutating action
   * records the PRE-mutation document before applying its change, so the edit is
   * reversible. UI-only actions do not touch this.
   */
  history: History<DocSnapshot>;

  /** Undo the last document edit (no-op when there is nothing to undo). Clears selection. */
  undo: () => void;
  /** Redo the last undone document edit (no-op when there is nothing to redo). Clears selection. */
  redo: () => void;
  /** True when there is a document edit to undo. */
  canUndo: () => boolean;
  /** True when there is an undone edit to redo. */
  canRedo: () => boolean;

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

  /** Set the active head SKU id used for placement / auto-layout (null clears it). */
  setActiveHeadSku: (sku: string | null) => void;
  /**
   * Add one sprinkler head node at a building-space position (ft). When `sku` is
   * omitted the current activeHeadSku is used. Returns the new node id.
   */
  addHead: (pos: Point3, sku?: string) => string;
  /** Move a head node to a new position (ft). No-op if the id is not a HEAD node. */
  moveHead: (id: string, pos: Point3) => void;
  /** Delete a head node by id (and clear selection if it was selected). */
  deleteHead: (id: string) => void;
  /**
   * Auto-layout heads inside a room at the room's hazard MAX spacing (cited
   * nfpa13-rules), clipping to the room polygon. REPLACES any heads previously
   * auto-placed in that room. Uses `sku` (or activeHeadSku). The head Z is the
   * room's ceiling height. Returns the ids of the heads placed.
   */
  autoLayoutRoom: (roomId: string, sku?: string) => string[];

  /* ----------------------------------------------------------- W4 pipe routing */

  /**
   * The supply/riser entry point in plan FEET (x = plan-X, y = plan-Y/floor), or
   * null to let routeSystem default it to an edge point. Editable via setSupplyPoint.
   */
  supplyPoint: SupplyPoint | null;

  /**
   * Generate a real wet-pipe TREE from the current heads (pipe-routing.routeSystem):
   * branch lines, cross-main(s), a main, a riser, and the fittings (tees/elbows/
   * reducers) with schedule-sized segments. REPLACES any prior auto-routed pipe
   * (every non-HEAD node + every segment); HEADS are preserved. Uses supplyPoint
   * (or opts.supplyPoint). Clears any selection that pointed at removed pipe. A no-op
   * (clears pipe only) when there are no heads.
   */
  routeSystem: (opts?: RouteOpts) => void;

  /** Set the supply/riser entry point (plan feet), or null to clear it. */
  setSupplyPoint: (point: SupplyPoint | null) => void;

  /**
   * Move ANY non-head network node (fitting/riser) to a new building-space position
   * (ft). Heads use moveHead. No-op for an unknown id or a HEAD node.
   */
  moveNode: (id: string, pos: Point3) => void;

  /** Delete one pipe segment by id (clears selection if it was selected). No-op if absent. */
  deleteSegment: (id: string) => void;

  /**
   * Set a pipe segment's nominal diameter (in). No-op for an unknown id or a
   * non-positive diameter. This is an operator override of the schedule size.
   */
  setSegmentDiameter: (id: string, diameterIn: number) => void;

  /* ----------------------------------------------------------- W5 hydraulics */

  /**
   * The operator water supply (flow test: static / residual @ flow), or null until
   * one is entered. Drives the hydraulic adequacy check.
   */
  supply: WaterSupply | null;

  /**
   * The remote DESIGN AREA in ft^2 (NFPA-13 density/area), or null to operate ALL
   * heads (conservative whole-system demand). The head COUNT is derived from this
   * via the cited max-protection-area-per-head — the magnitude itself is operator-
   * supplied (not a single cited constant), surfaced honestly in the findings.
   */
  designAreaSqFt: number | null;

  /** Set the water supply (static / residual @ flow), or null to clear it. */
  setSupply: (supply: WaterSupply | null) => void;

  /** Set the remote design area (ft^2), or null to operate all heads. */
  setDesignArea: (sqft: number | null) => void;

  /** When true, the 2D + 3D views color heads/segments by hydraulic pressure. */
  pressureHeatmap: boolean;
  /** Toggle the pressure heatmap on/off (shared 2D + 3D). */
  setPressureHeatmap: (on: boolean) => void;

  /* ----------------------------------------------------------- W6 takeoff + bid */

  /**
   * The resolved pricing table (REAL pricebook medians preferred). null until
   * ensurePricebookLoaded resolves it; the bid then falls back to representative
   * figures. NEVER fabricated — comes from the studio loadPricebook/resolvePriceTable.
   */
  priceTable: PriceTable | null;

  /**
   * Best-effort load the REAL pricebook medians (apps/cad/public/parts/
   * pricebook-medians.json, copied from the studio) and resolve the price table.
   * Fail-soft: on any failure the table resolves to the representative fallback so
   * the bid still prices (honestly labelled). Idempotent-friendly (callers may
   * invoke once on mount).
   */
  ensurePricebookLoaded: (fetchImpl?: typeof fetch) => Promise<void>;

  /* ----------------------------------------------------------- W7 UX polish */

  /**
   * Load the CLEARLY-LABELLED example/sample project and drive the WHOLE vertical
   * in one call: set the sample building, auto-layout heads in every room with a
   * REAL catalog head SKU, route a wet-pipe tree, set a default supply (flow test),
   * and best-effort load the real pricebook so the bid prices. After this the heads,
   * pipe, hydraulics, and bid are all populated.
   *
   * HONESTY: the project is EXAMPLE data (names say "Sample"/"example"); heads use a
   * real SKU and the bid uses the real pricebook (or the honest representative
   * fallback). Nothing about the geometry or prices is fabricated.
   */
  loadSampleProject: (fetchImpl?: typeof fetch) => Promise<void>;
}

/**
 * PURE selector: the live quantity TAKEOFF for the current routed network. Recomputed
 * from computeTakeoff whenever the network changes — the live-recalc source for the
 * BOM. Pure, no fabrication; quantities map 1:1 to nodes + segments.
 */
export function selectTakeoff(state: CadState): Takeoff {
  return computeTakeoff(state.project.network);
}

/**
 * PURE selector: the live PRICED BID for the current takeoff + resolved price table.
 * Recomputed whenever the network or the price table changes. Uses the studio bid
 * math VERBATIM (buildPricedBid -> buildBidEstimate); materials use ONLY real
 * pricebook medians (or the representative fallback), unpriced lines honestly 0.
 */
export function selectPricedBid(state: CadState): PricedBid {
  const takeoff = computeTakeoff(state.project.network);
  const table = state.priceTable ?? resolvePriceTable(null);
  return buildPricedBid(takeoff, table);
}

/**
 * PURE selector: the live hydraulic design-aid result for the current project +
 * supply + design area. Recomputed from solveHydraulics whenever the inputs change
 * (the network, supply, design area, or hazard default). This is the LIVE-RECALC
 * source: a selector over the store, so editing a segment diameter, re-routing, or
 * changing the supply produces a fresh result. Pure — no fabrication.
 */
export function selectHydraulics(state: CadState): HydraulicsResult {
  return solveHydraulics(state.project.network, {
    hazard: state.project.hazardDefaults.defaultClass,
    supply: state.supply ?? undefined,
    designAreaSqFt: state.designAreaSqFt ?? undefined,
  });
}

/** True when a node is part of the auto-routed pipe (not a head). */
function isRoutedFitting(node: Node): boolean {
  return node.type !== 'HEAD';
}

/** A head node carries a room-tag in its id prefix so room auto-layout can replace
 * the prior set for that room without touching manually-placed heads elsewhere. We
 * track room ownership via a Map kept on the node id convention `head_<roomId>_*`
 * for auto-laid heads, and `head_*` for free-placed heads. */
function isHeadOfRoom(node: Node, roomId: string): boolean {
  return node.type === 'HEAD' && node.id.startsWith(`head_${roomId}_`);
}

/** The undoable document slice of the current state. */
function docOf(s: CadState): DocSnapshot {
  return { project: s.project, supplyPoint: s.supplyPoint };
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

export const useCadStore = create<CadState>((set, get) => {
  /**
   * Apply a model-mutating recipe while recording the PRE-mutation document for
   * undo (E0). A recipe that returns the SAME state reference is treated as a
   * no-op: no history entry is recorded. This is the single path every undoable
   * action goes through, so history is consistent without per-action bookkeeping.
   */
  const mutate = (recipe: (s: CadState) => Partial<CadState> | CadState) =>
    set((s) => {
      const next = recipe(s);
      if (next === s) return s; // no-op: leave history untouched
      const history = recordHistory(s.history, docOf(s));
      return { ...next, history };
    });

  return {
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
  pressureHeatmap: false,
  priceTable: null,

  undo: () =>
    set((s) => {
      const move = historyUndo(s.history, docOf(s));
      if (!move) return s;
      return {
        ...move.present,
        history: move.history,
        selection: { ...EMPTY_SELECTION },
      };
    }),
  redo: () =>
    set((s) => {
      const move = historyRedo(s.history, docOf(s));
      if (!move) return s;
      return {
        ...move.present,
        history: move.history,
        selection: { ...EMPTY_SELECTION },
      };
    }),
  canUndo: () => historyCanUndo(get().history),
  canRedo: () => historyCanRedo(get().history),

  setProject: (project) =>
    mutate(() => ({ project, selection: { ...EMPTY_SELECTION } })),
  select: (kind, id) => set({ selection: selectionFor(kind, id) }),
  clearSelection: () => set({ selection: { ...EMPTY_SELECTION } }),
  setTool: (activeTool) => set({ activeTool }),
  setViewMode: (viewMode) => set({ viewMode }),
  setUnderlay: (underlay) => set({ underlay }),

  setBuilding: (building) =>
    mutate((s) => ({ project: { ...s.project, building } })),

  setScale: (ftPerUnit, source) =>
    mutate((s) => {
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
    mutate((s) => {
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
    mutate((s) => {
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

  setActiveHeadSku: (sku) => set({ activeHeadSku: sku }),

  addHead: (pos, sku) => {
    const id = makeId('head');
    mutate((s) => {
      const resolvedSku = sku ?? s.activeHeadSku ?? undefined;
      const node: Node = {
        id,
        type: 'HEAD',
        pos,
        ...(resolvedSku ? { sku: resolvedSku } : {}),
      };
      const network = {
        ...s.project.network,
        nodes: [...s.project.network.nodes, node],
      };
      return { project: { ...s.project, network } };
    });
    return id;
  },

  moveHead: (id, pos) =>
    mutate((s) => {
      const nodes = s.project.network.nodes;
      let changed = false;
      const next = nodes.map((n) => {
        if (n.id === id && n.type === 'HEAD') {
          changed = true;
          return { ...n, pos };
        }
        return n;
      });
      if (!changed) return s;
      return {
        project: { ...s.project, network: { ...s.project.network, nodes: next } },
      };
    }),

  deleteHead: (id) =>
    mutate((s) => {
      const nodes = s.project.network.nodes;
      const next = nodes.filter((n) => !(n.id === id && n.type === 'HEAD'));
      if (next.length === nodes.length) return s;
      const selection =
        s.selection.selectedNodeId === id ? { ...EMPTY_SELECTION } : s.selection;
      return {
        project: { ...s.project, network: { ...s.project.network, nodes: next } },
        selection,
      };
    }),

  autoLayoutRoom: (roomId, sku) => {
    const placedIds: string[] = [];
    mutate((s) => {
      const room = s.project.building.rooms.find((r) => r.id === roomId);
      if (!room) return s;
      const resolvedSku = sku ?? s.activeHeadSku ?? undefined;
      // The room polygon is in plan-space UNITS; convert to FEET (the unit the
      // cited NFPA-13 spacing/area rules are expressed in) before laying heads.
      const scale =
        s.project.building.scaleFtPerUnit > 0 ? s.project.building.scaleFtPerUnit : 1;
      const polyFt = room.polygon.map((p) => ({ x: p.x * scale, y: p.y * scale }));
      const laid = autoLayoutHeads(polyFt, room.hazard, { sku: resolvedSku });
      const z = room.ceilingHt;
      const newNodes: Node[] = laid.map((h, i) => {
        const id = `head_${roomId}_${i}`;
        placedIds.push(id);
        return {
          id,
          type: 'HEAD',
          pos: { x: h.x, y: z, z: h.y },
          ...(resolvedSku ? { sku: resolvedSku } : {}),
        };
      });
      // Replace only the heads previously auto-laid for THIS room; keep all other
      // heads (other rooms' auto heads + manually placed heads) untouched.
      const kept = s.project.network.nodes.filter((n) => !isHeadOfRoom(n, roomId));
      const network = { ...s.project.network, nodes: [...kept, ...newNodes] };
      return { project: { ...s.project, network } };
    });
    return placedIds;
  },

  /* ----------------------------------------------------------- W4 pipe routing */

  setSupplyPoint: (point) => mutate(() => ({ supplyPoint: point })),

  routeSystem: (opts) =>
    mutate((s) => {
      const heads = s.project.network.nodes.filter((n) => n.type === 'HEAD');
      // Strip any prior auto-routed pipe (every non-head node + ALL segments); keep heads.
      if (heads.length === 0) {
        const network = {
          ...s.project.network,
          nodes: s.project.network.nodes.filter((n) => !isRoutedFitting(n)),
          segments: [],
        };
        // Clear any selection that pointed at removed pipe.
        const selection =
          s.selection.selectedSegmentId ||
          (s.selection.selectedNodeId &&
            s.project.network.nodes.find((n) => n.id === s.selection.selectedNodeId)?.type !== 'HEAD')
            ? { ...EMPTY_SELECTION }
            : s.selection;
        return { project: { ...s.project, network }, selection };
      }

      const ceilingHt = s.project.hazardDefaults.defaultCeilingHt;
      const routeOpts: RouteOpts = {
        ceilingHt: heads[0].pos.y || ceilingHt,
        ...opts,
        ...(opts?.supplyPoint
          ? { supplyPoint: opts.supplyPoint }
          : s.supplyPoint
            ? { supplyPoint: s.supplyPoint }
            : {}),
      };
      // routeSystem returns heads + new fittings + riser; we replace the network
      // nodes/segments with that result wholesale (heads are inside it verbatim).
      const headNetwork = {
        nodes: heads,
        segments: [],
        remoteAreas: s.project.network.remoteAreas,
      };
      const routed = routeSystem(headNetwork, routeOpts);
      const network = {
        ...s.project.network,
        nodes: routed.nodes,
        segments: routed.segments,
      };
      // A re-route invalidates a selected segment/fitting id; clear it.
      const selection = { ...EMPTY_SELECTION };
      return { project: { ...s.project, network }, selection };
    }),

  moveNode: (id, pos) =>
    mutate((s) => {
      const nodes = s.project.network.nodes;
      let changed = false;
      const next = nodes.map((n) => {
        if (n.id === id && n.type !== 'HEAD') {
          changed = true;
          return { ...n, pos };
        }
        return n;
      });
      if (!changed) return s;
      return {
        project: { ...s.project, network: { ...s.project.network, nodes: next } },
      };
    }),

  deleteSegment: (id) =>
    mutate((s) => {
      const segments = s.project.network.segments;
      const next = segments.filter((seg) => seg.id !== id);
      if (next.length === segments.length) return s;
      const selection =
        s.selection.selectedSegmentId === id ? { ...EMPTY_SELECTION } : s.selection;
      return {
        project: { ...s.project, network: { ...s.project.network, segments: next } },
        selection,
      };
    }),

  setSegmentDiameter: (id, diameterIn) =>
    mutate((s) => {
      if (!Number.isFinite(diameterIn) || diameterIn <= 0) return s;
      const segments = s.project.network.segments;
      let changed = false;
      const next = segments.map((seg) => {
        if (seg.id === id) {
          changed = true;
          return { ...seg, diameterIn };
        }
        return seg;
      });
      if (!changed) return s;
      return {
        project: { ...s.project, network: { ...s.project.network, segments: next } },
      };
    }),

  /* ----------------------------------------------------------- W5 hydraulics */

  setSupply: (supply) => set({ supply }),
  setDesignArea: (sqft) =>
    set({ designAreaSqFt: sqft != null && sqft > 0 ? sqft : null }),
  setPressureHeatmap: (on) => set({ pressureHeatmap: on }),

  /* ----------------------------------------------------------- W6 takeoff + bid */

  ensurePricebookLoaded: async (fetchImpl) => {
    const impl =
      fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    // loadPricebook fail-softs to null; resolvePriceTable(null) -> representative.
    const book = await loadPricebook(impl);
    set({ priceTable: resolvePriceTable(book) });
  },

  /* ----------------------------------------------------------- W7 UX polish */

  loadSampleProject: async (fetchImpl) => {
    const sample = buildSampleProject();
    // 1) Seed the example building (clears selection + any prior network).
    get().setProject(sample);
    // 2) Use the real catalog head SKU for the laid heads.
    get().setActiveHeadSku(SAMPLE_HEAD_SKU);
    // 3) Auto-layout heads in EVERY room at its hazard spacing, with the real SKU.
    for (const room of sample.building.rooms) {
      get().autoLayoutRoom(room.id, SAMPLE_HEAD_SKU);
    }
    // 4) Route the laid heads into a wet-pipe tree (branches -> cross-main -> riser).
    get().routeSystem();
    // 5) Seed a default supply so the hydraulics adequacy check has inputs.
    get().setSupply(SAMPLE_SUPPLY);
    // 6) Best-effort load the real pricebook so the bid prices off real medians.
    await get().ensurePricebookLoaded(fetchImpl);
  },
  };
});
