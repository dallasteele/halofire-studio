// HaloFire CAD — PlanCanvas (2D). A react-konva Stage that draws the CAD grid and,
// in W1, the import + trace toolset:
//   - UNDERLAY layer: a PDF raster OR DXF vector linework beneath the grid.
//   - SET-SCALE tool: click two points, type the known real feet -> store ftPerUnit
//     ("scale set: X ft/unit"). This is the operator-verifiable scale that replaces
//     the blind magic factor (the old vector path overshot real sets 4.62x).
//   - TRACE-WALL tool: click to draw a wall polyline; each segment persists as a Wall.
//   - ROOM tool: click a closed polygon, pick a hazard class -> persists as a Room
//     with a live area readout (sq ft) computed from the verified scale.
//
// Coordinate model: plan-space = the underlay's own units (DXF units, or PDF pixels
// for a raster). A fit transform maps plan-space <-> screen so a click inverts to
// real plan coordinates before it is stored. When no underlay is loaded the canvas
// is grid + honest empty state — nothing fake is drawn.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { Stage, Layer, Line, Text, Rect, Image as KonvaImage, Circle } from 'react-konva';
import type Konva from 'konva';
import { useCadStore } from '../store';
import {
  HAZARD_CLASSES,
  makeId,
  type HazardClass,
  type Node,
  type Point2,
  type SegmentRole,
} from '../lib/model';
import { measureFeet, polygonAreaSqFt, setScaleFromTwoPoints } from '../lib/scale';
import { panXform, zoomXformAt, zoomPercent, ZOOM_STEP } from '../lib/viewport';
import {
  makeCircle,
  makeLine,
  makePoint,
  makePolyline,
  makeRectangle,
  type DrawingElement,
} from '../lib/drawing-elements';
import { SAMPLE_PROJECT_NAME } from '../lib/sample-project';
import {
  emptySelection,
  marqueeSelect,
  selectionCount,
  type MarqueeItems,
} from '../lib/selection-set';
import { coverageReport } from '../lib/head-layout';
import { pressureColor, pressureRange, type HydraulicsResult } from '../lib/hydraulics';
import { selectHydraulics } from '../store';
import { colors, radii, spacing, typeScale } from '../lib/tokens';

/** Spacing between minor grid lines, in px. */
const MINOR = 24;
/** Every Nth minor line is a major line. */
const MAJOR_EVERY = 5;

interface Size {
  w: number;
  h: number;
}

/** A plan-space <-> screen transform: screen = (plan - origin) * scale + pad. */
interface ViewXform {
  scale: number;
  originX: number;
  originY: number;
  padX: number;
  padY: number;
}

const IDENTITY_XFORM: ViewXform = {
  scale: 1,
  originX: 0,
  originY: 0,
  padX: 0,
  padY: 0,
};

function buildGridLines(size: Size): { minor: number[][]; major: number[][] } {
  const minor: number[][] = [];
  const major: number[][] = [];
  let i = 0;
  for (let x = 0; x <= size.w; x += MINOR, i++) {
    (i % MAJOR_EVERY === 0 ? major : minor).push([x, 0, x, size.h]);
  }
  i = 0;
  for (let y = 0; y <= size.h; y += MINOR, i++) {
    (i % MAJOR_EVERY === 0 ? major : minor).push([0, y, size.w, y]);
  }
  return { minor, major };
}

/** Fit the given plan-space bounds into the canvas with a margin. */
function fitBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  size: Size,
): ViewXform {
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  if (bw <= 0 || bh <= 0 || size.w <= 0 || size.h <= 0) return IDENTITY_XFORM;
  const margin = 0.92;
  const scale = Math.min((size.w / bw) * margin, (size.h / bh) * margin);
  // Center the fitted content.
  const drawnW = bw * scale;
  const drawnH = bh * scale;
  return {
    scale,
    originX: bounds.minX,
    // DXF y is up; screen y is down. We flip Y so the plan reads right-side up.
    originY: bounds.maxY,
    padX: (size.w - drawnW) / 2,
    padY: (size.h - drawnH) / 2,
  };
}

function planToScreen(p: Point2, x: ViewXform): { sx: number; sy: number } {
  return {
    sx: (p.x - x.originX) * x.scale + x.padX,
    sy: (x.originY - p.y) * x.scale + x.padY,
  };
}

function screenToPlan(sx: number, sy: number, x: ViewXform): Point2 {
  if (x.scale === 0) return { x: 0, y: 0 };
  return {
    x: (sx - x.padX) / x.scale + x.originX,
    y: x.originY - (sy - x.padY) / x.scale,
  };
}

const HAZARD_LABEL: Record<HazardClass, string> = {
  LIGHT: 'Light',
  ORDINARY_1: 'Ordinary 1',
  ORDINARY_2: 'Ordinary 2',
  EXTRA_1: 'Extra 1',
  EXTRA_2: 'Extra 2',
};

/** Pipe color by role (W4). Visual legend only — not a code color requirement. */
const ROLE_COLOR: Record<SegmentRole, string> = {
  MAIN: '#e06c4f',
  CROSS_MAIN: '#f0a868',
  BRANCH: '#6fb3ff',
  ARM_OVER: '#9fc7ff',
  RISER: '#c062d0',
  DROP: '#9fc7ff',
};

function roleColor(role: SegmentRole): string {
  return ROLE_COLOR[role] ?? colors.interactiveText;
}

/** Screen stroke width (px) from a nominal pipe diameter (in). Bigger pipe = wider. */
function widthForDiameter(diameterIn: number): number {
  return Math.max(1.5, Math.min(8, 1 + diameterIn * 1.6));
}

/** A short glyph per fitting type for the 2D symbol. */
const FITTING_GLYPH: Record<string, string> = {
  TEE: 'T',
  CROSS: 'X',
  ELBOW: 'L',
  REDUCER: 'R',
  VALVE: 'V',
  SOURCE: '◈', // riser diamond
};

/** Screen-space corner loop for a rectangle preview given two opposite corners. */
function rectScreenPoints(
  a: Point2,
  b: Point2,
  toScreen: (p: Point2) => { sx: number; sy: number },
): number[] {
  const corners: Point2[] = [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
  return corners.flatMap((c) => {
    const s = toScreen(c);
    return [s.sx, s.sy];
  });
}

/**
 * Render one committed annotation element (T29-T34) in screen space. Circles
 * stay true circles because the fit transform is uniform; arcs are sampled as
 * polylines so they are exact under the y-flip without konva angle gymnastics.
 */
function renderAnnotation(
  el: DrawingElement,
  toScreen: (p: Point2) => { sx: number; sy: number },
  pxPerUnit: number,
): ReactElement | null {
  const stroke = colors.accentText;
  switch (el.kind) {
    case 'line': {
      const a = toScreen(el.a);
      const b = toScreen(el.b);
      return <Line key={el.id} points={[a.sx, a.sy, b.sx, b.sy]} stroke={stroke} strokeWidth={1.5} />;
    }
    case 'polyline': {
      const pts = el.points.flatMap((p) => {
        const s = toScreen(p);
        return [s.sx, s.sy];
      });
      return <Line key={el.id} points={pts} stroke={stroke} strokeWidth={1.5} />;
    }
    case 'circle': {
      const c = toScreen(el.center);
      return (
        <Circle key={el.id} x={c.sx} y={c.sy} radius={el.radiusFt * pxPerUnit} stroke={stroke} strokeWidth={1.5} />
      );
    }
    case 'rectangle': {
      const a = el.corner;
      const b = { x: a.x + el.widthFt, y: a.y + el.heightFt };
      return <Line key={el.id} points={rectScreenPoints(a, b, toScreen)} closed stroke={stroke} strokeWidth={1.5} />;
    }
    case 'arc': {
      // Sample the arc into a polyline — exact under any uniform transform/flip.
      const sweep = (el.endDeg - el.startDeg + 360) % 360;
      const steps = 32;
      const pts: number[] = [];
      for (let i = 0; i <= steps; i++) {
        const deg = el.startDeg + (sweep * i) / steps;
        const rad = (deg * Math.PI) / 180;
        const s = toScreen({
          x: el.center.x + el.radiusFt * Math.cos(rad),
          y: el.center.y + el.radiusFt * Math.sin(rad),
        });
        pts.push(s.sx, s.sy);
      }
      return <Line key={el.id} points={pts} stroke={stroke} strokeWidth={1.5} />;
    }
    case 'point': {
      const s = toScreen(el.at);
      return <Circle key={el.id} x={s.sx} y={s.sy} radius={3} fill={stroke} />;
    }
    default:
      return null;
  }
}

export function PlanCanvas(): ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  const project = useCadStore((s) => s.project);
  const underlay = useCadStore((s) => s.underlay);
  const activeTool = useCadStore((s) => s.activeTool);
  const setScale = useCadStore((s) => s.setScale);
  const addWall = useCadStore((s) => s.addWall);
  const addRoom = useCadStore((s) => s.addRoom);
  const addHead = useCadStore((s) => s.addHead);
  const moveHead = useCadStore((s) => s.moveHead);
  const deleteHead = useCadStore((s) => s.deleteHead);
  const autoLayoutRoom = useCadStore((s) => s.autoLayoutRoom);
  const routeSystem = useCadStore((s) => s.routeSystem);
  const moveNode = useCadStore((s) => s.moveNode);
  const addAnnotation = useCadStore((s) => s.addAnnotation);
  const select = useCadStore((s) => s.select);
  const multi = useCadStore((s) => s.multi);
  const setMulti = useCadStore((s) => s.setMulti);
  const togglePickMulti = useCadStore((s) => s.togglePickMulti);
  const deleteSelected = useCadStore((s) => s.deleteSelected);
  const selectedNodeId = useCadStore((s) => s.selection.selectedNodeId);
  const selectedSegmentId = useCadStore((s) => s.selection.selectedSegmentId);
  const selectedRoomId = useCadStore((s) => s.selection.selectedRoomId);
  const activeHeadSku = useCadStore((s) => s.activeHeadSku);
  const pressureHeatmap = useCadStore((s) => s.pressureHeatmap);
  const supply = useCadStore((s) => s.supply);
  const designAreaSqFt = useCadStore((s) => s.designAreaSqFt);
  const loadSampleProject = useCadStore((s) => s.loadSampleProject);

  // True when the loaded project is the labelled example/sample data. Drives the
  // "SAMPLE" badge so the operator never mistakes it for their real plan.
  const isSample = project.name === SAMPLE_PROJECT_NAME;

  const building = project.building;
  const ftPerUnit = building.scaleFtPerUnit;
  const scale = ftPerUnit > 0 ? ftPerUnit : 1;
  const heads = useMemo(
    () => project.network.nodes.filter((n) => n.type === 'HEAD'),
    [project.network.nodes],
  );
  // W4: pipe fittings + a node lookup so segments can resolve their endpoints.
  const fittings = useMemo(
    () => project.network.nodes.filter((n) => n.type !== 'HEAD'),
    [project.network.nodes],
  );
  const nodeById = useMemo(() => {
    const m = new Map<string, Node>();
    for (const n of project.network.nodes) m.set(n.id, n);
    return m;
  }, [project.network.nodes]);
  const segments = project.network.segments;

  // Multi-selection lookups (W2D engine): O(1) id membership for highlight strokes.
  const multiNodeSet = useMemo(() => new Set(multi.nodeIds), [multi.nodeIds]);
  const multiSegSet = useMemo(() => new Set(multi.segmentIds), [multi.segmentIds]);
  const multiCount = selectionCount(multi);

  // W5 pressure heatmap: compute the live hydraulics ONLY when the heatmap is on, then
  // map node/segment ids to a shared blue->red pressure color (legend below).
  const hydraulics = useMemo<HydraulicsResult | null>(() => {
    if (!pressureHeatmap) return null;
    return selectHydraulics(useCadStore.getState());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressureHeatmap, project.network, supply, designAreaSqFt, project.hazardDefaults.defaultClass]);
  const pRange = useMemo(
    () => (hydraulics ? pressureRange(hydraulics) : null),
    [hydraulics],
  );
  const nodePsi = useMemo(() => {
    const m = new Map<string, number>();
    if (hydraulics) for (const n of hydraulics.perNode) m.set(n.id, n.pressurePsi);
    return m;
  }, [hydraulics]);
  const segPsi = useMemo(() => {
    // A segment's heatmap pressure = the mean of its two endpoint node pressures.
    const m = new Map<string, number>();
    if (hydraulics) {
      for (const seg of project.network.segments) {
        const a = nodePsi.get(seg.from);
        const b = nodePsi.get(seg.to);
        if (a != null && b != null) m.set(seg.id, (a + b) / 2);
      }
    }
    return m;
  }, [hydraulics, project.network.segments, nodePsi]);

  const selectedRoom = selectedRoomId
    ? building.rooms.find((r) => r.id === selectedRoomId) ?? null
    : null;
  const hasContent =
    building.rooms.length > 0 ||
    building.walls.length > 0 ||
    underlay !== null ||
    heads.length > 0 ||
    segments.length > 0;

  // In-progress interactions.
  const [scalePts, setScalePts] = useState<Point2[]>([]);
  const [wallPts, setWallPts] = useState<Point2[]>([]);
  const [roomPts, setRoomPts] = useState<Point2[]>([]);
  // T29-T34 draw tools: first click of a 2-click tool (line/circle/rect), and the
  // accumulated polyline points (double-click commits).
  const [drawPt, setDrawPt] = useState<Point2 | null>(null);
  const [polyPts, setPolyPts] = useState<Point2[]>([]);
  const [hazard, setHazard] = useState<HazardClass>('ORDINARY_1');
  const [cursor, setCursor] = useState<Point2 | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  // Marquee drag (select tool): screen-space corners of the in-progress rectangle.
  // Direction encodes the AutoCAD convention — left-to-right = window (fully
  // contained), right-to-left = crossing (anything touching).
  const [marquee, setMarquee] = useState<{
    sx: number;
    sy: number;
    ex: number;
    ey: number;
  } | null>(null);
  // True right after a marquee commit, so the synthetic click that follows the
  // mouse-up does not clear the fresh multi-selection.
  const didMarquee = useRef(false);
  // In-app inline set-scale popover: holds the two captured plan points + the screen
  // position to anchor the input near the second click. Replaces window.prompt().
  const [scalePrompt, setScalePrompt] = useState<{
    a: Point2;
    b: Point2;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [scaleInput, setScaleInput] = useState('');

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Reset in-progress paths when the tool changes.
  useEffect(() => {
    setScalePts([]);
    setWallPts([]);
    setRoomPts([]);
    setDrawPt(null);
    setPolyPts([]);
    setScalePrompt(null);
    setScaleInput('');
    setMarquee(null);
  }, [activeTool]);

  // Delete / Backspace: when a multi-selection exists, delete everything deletable
  // in it as ONE undo step; otherwise keep the single-selected-head fallback.
  // Ignored while typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (selectionCount(multi) > 0) {
        e.preventDefault();
        // Count by diffing the store before/after so the message is exact
        // (includes orphan-swept fittings, excludes undeletable picks).
        const before = useCadStore.getState().project.network;
        deleteSelected();
        const after = useCadStore.getState().project.network;
        const removed =
          before.nodes.length - after.nodes.length +
          (before.segments.length - after.segments.length);
        setStatusMsg(
          removed > 0
            ? `deleted ${removed} selected element(s)`
            : 'nothing deletable in selection (source/fittings are pipe-owned)',
        );
        return;
      }
      if (!selectedNodeId) return;
      const node = project.network.nodes.find((n) => n.id === selectedNodeId);
      if (node?.type !== 'HEAD') return;
      e.preventDefault();
      deleteHead(selectedNodeId);
      setStatusMsg('head deleted');
    }
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, project.network.nodes, deleteHead, multi, deleteSelected]);

  const ready = size.w > 0 && size.h > 0;
  const grid = ready ? buildGridLines(size) : { minor: [], major: [] };

  // Compute the FIT view transform from the underlay bounds (or building geometry).
  const fitXform = useMemo<ViewXform>(() => {
    if (!ready) return IDENTITY_XFORM;
    if (underlay?.kind === 'dxf') {
      return fitBounds(underlay.bounds, size);
    }
    if (underlay?.kind === 'pdf') {
      // PDF raster plan-space is pixel space (origin top-left, y DOWN). Use a
      // non-flipping fit so the raster and overlays share the same frame.
      const bw = underlay.widthPx;
      const bh = underlay.heightPx;
      const margin = 0.92;
      const scale = Math.min((size.w / bw) * margin, (size.h / bh) * margin);
      return {
        scale,
        originX: 0,
        originY: 0, // top-left origin, no Y flip for raster
        padX: (size.w - bw * scale) / 2,
        padY: (size.h - bh * scale) / 2,
      };
    }
    // No underlay: fit the traced/laid geometry (rooms + heads + pipe nodes) so the
    // plan frames what exists. Rooms are in plan units; heads/pipe nodes are in FEET,
    // so convert them to plan units (ft / scale). This makes W3/W4 geometry visible
    // even with no imported underlay. Falls back to identity when there's nothing.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const extend = (px: number, py: number): void => {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    };
    for (const r of building.rooms) for (const p of r.polygon) extend(p.x, p.y);
    for (const w of building.walls) {
      extend(w.start.x, w.start.y);
      extend(w.end.x, w.end.y);
    }
    for (const n of project.network.nodes) extend(n.pos.x / scale, n.pos.z / scale);
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
      return IDENTITY_XFORM;
    }
    // Pad the bounds a little so geometry isn't flush to the canvas edge.
    const padFt = Math.max(2, (maxX - minX + maxY - minY) * 0.05);
    return fitBounds(
      { minX: minX - padFt, minY: minY - padFt, maxX: maxX + padFt, maxY: maxY + padFt },
      size,
    );
  }, [ready, underlay, size, building.rooms, building.walls, project.network.nodes, scale]);

  // M1.1 pan/zoom: an interactive override of the fit transform. Wheel zooms
  // about the cursor; the Pan tool drags. Cleared when the underlay changes
  // (new plan -> re-fit) or via the Fit button.
  const [vpOverride, setVpOverride] = useState<ViewXform | null>(null);
  const panDrag = useRef<{ sx: number; sy: number } | null>(null);
  useEffect(() => {
    setVpOverride(null);
  }, [underlay]);
  const xform = vpOverride ?? fitXform;

  function onStageWheel(e: Konva.KonvaEventObject<WheelEvent>): void {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const factor = e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setVpOverride(zoomXformAt(xform, pos.x, pos.y, factor));
  }

  // For a PDF underlay, plan-space y grows DOWN, so screen mapping differs.
  const isRaster = underlay?.kind === 'pdf';
  const toScreen = (p: Point2): { sx: number; sy: number } =>
    isRaster
      ? { sx: p.x * xform.scale + xform.padX, sy: p.y * xform.scale + xform.padY }
      : planToScreen(p, xform);
  const toPlan = (sx: number, sy: number): Point2 =>
    isRaster
      ? { x: (sx - xform.padX) / xform.scale, y: (sy - xform.padY) / xform.scale }
      : screenToPlan(sx, sy, xform);

  function pointerPlan(e: Konva.KonvaEventObject<MouseEvent>): Point2 | null {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return null;
    return toPlan(pos.x, pos.y);
  }

  const isDrawTool =
    activeTool === 'draw-line' ||
    activeTool === 'draw-polyline' ||
    activeTool === 'draw-circle' ||
    activeTool === 'draw-rect' ||
    activeTool === 'draw-point';

  function onStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>): void {
    if (activeTool === 'pan') {
      const pos = e.target.getStage()?.getPointerPosition();
      if (pos) panDrag.current = { sx: pos.x, sy: pos.y };
      return;
    }
    // Select tool: a mouse-down on EMPTY canvas (the stage itself, not a shape)
    // starts a marquee drag. Shape hits keep their own click/drag handlers.
    if (activeTool === 'select' && e.target === e.target.getStage()) {
      const pos = e.target.getStage()?.getPointerPosition();
      if (pos) {
        setMarquee({ sx: pos.x, sy: pos.y, ex: pos.x, ey: pos.y });
        didMarquee.current = false;
      }
    }
  }

  function onStageMouseUp(): void {
    panDrag.current = null;
    if (!marquee) return;
    const dragPx = Math.hypot(marquee.ex - marquee.sx, marquee.ey - marquee.sy);
    if (dragPx > 4) {
      // Build the hit-test items from the CURRENT plan-space positions, mapped
      // exactly like the rendering does (nodes in feet -> plan units via /scale).
      const items: MarqueeItems = {
        nodes: project.network.nodes.map((n) => ({
          id: n.id,
          at: { x: n.pos.x / scale, y: n.pos.z / scale },
        })),
        segments: project.network.segments.flatMap((seg) => {
          const a = nodeById.get(seg.from);
          const b = nodeById.get(seg.to);
          if (!a || !b) return []; // orphan pipe is never hit-tested
          return [
            {
              id: seg.id,
              a: { x: a.pos.x / scale, y: a.pos.z / scale },
              b: { x: b.pos.x / scale, y: b.pos.z / scale },
            },
          ];
        }),
      };
      // AutoCAD convention: drag left-to-right = window (fully contained only),
      // right-to-left = crossing (anything touching the rect).
      const mode = marquee.ex >= marquee.sx ? 'window' : 'crossing';
      const result = marqueeSelect(
        items,
        toPlan(marquee.sx, marquee.sy),
        toPlan(marquee.ex, marquee.ey),
        mode,
      );
      setMulti(result);
      didMarquee.current = true;
      setStatusMsg(`${selectionCount(result)} selected (${mode} marquee)`);
    }
    setMarquee(null);
  }

  function onStageMouseMove(e: Konva.KonvaEventObject<MouseEvent>): void {
    if (activeTool === 'pan' && panDrag.current) {
      const pos = e.target.getStage()?.getPointerPosition();
      if (pos) {
        setVpOverride(panXform(xform, pos.x - panDrag.current.sx, pos.y - panDrag.current.sy));
        panDrag.current = { sx: pos.x, sy: pos.y };
      }
      return;
    }
    if (activeTool === 'select' && marquee) {
      const pos = e.target.getStage()?.getPointerPosition();
      if (pos) setMarquee({ ...marquee, ex: pos.x, ey: pos.y });
      return;
    }
    if (activeTool === 'set-scale' || activeTool === 'wall' || activeTool === 'room' || isDrawTool) {
      setCursor(pointerPlan(e));
    }
  }

  function onStageClick(e: Konva.KonvaEventObject<MouseEvent>): void {
    if (activeTool === 'select') {
      // The click that follows a marquee mouse-up must not clear the fresh picks.
      if (didMarquee.current) {
        didMarquee.current = false;
        return;
      }
      // A plain click on empty canvas clears the multi-selection (single-pick
      // clicks on shapes are handled by the shapes themselves and never bubble).
      if (e.target === e.target.getStage() && multiCount > 0) {
        setMulti(emptySelection());
      }
      return;
    }

    const p = pointerPlan(e);
    if (!p) return;

    if (activeTool === 'set-scale') {
      const next = [...scalePts, p];
      if (next.length < 2) {
        setScalePts(next);
        return;
      }
      // Two points captured — open the IN-APP inline popover near the second click
      // for the known real distance (no window.prompt). The screen position anchors
      // the input; Apply/Cancel live in the popover (see scalePrompt render below).
      const [a, b] = next;
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      setScalePts(next);
      setScalePrompt({
        a,
        b,
        screenX: pos?.x ?? size.w / 2,
        screenY: pos?.y ?? size.h / 2,
      });
      setScaleInput('');
      return;
    }

    if (activeTool === 'wall') {
      setWallPts((prev) => [...prev, p]);
      return;
    }

    if (activeTool === 'room') {
      setRoomPts((prev) => [...prev, p]);
      return;
    }

    if (activeTool === 'draw-point') {
      addAnnotation(makePoint(makeId('ann'), p));
      setStatusMsg(`point placed at ${(p.x * scale).toFixed(1)}, ${(p.y * scale).toFixed(1)} ft`);
      return;
    }

    if (activeTool === 'draw-polyline') {
      setPolyPts((prev) => [...prev, p]);
      return;
    }

    if (activeTool === 'draw-line' || activeTool === 'draw-circle' || activeTool === 'draw-rect') {
      if (!drawPt) {
        setDrawPt(p);
        return;
      }
      // Second click — commit via the validated drawing-elements constructor.
      // Constructors throw on degenerate input (zero-length line, zero radius,
      // zero-area rect); surface that honestly in the status bar instead of crashing.
      try {
        let el: DrawingElement;
        if (activeTool === 'draw-line') {
          el = makeLine(makeId('ann'), drawPt, p);
        } else if (activeTool === 'draw-circle') {
          const r = Math.hypot(p.x - drawPt.x, p.y - drawPt.y);
          el = makeCircle(makeId('ann'), drawPt, r);
        } else {
          const corner = { x: Math.min(drawPt.x, p.x), y: Math.min(drawPt.y, p.y) };
          el = makeRectangle(
            makeId('ann'),
            corner,
            Math.abs(p.x - drawPt.x),
            Math.abs(p.y - drawPt.y),
          );
        }
        addAnnotation(el);
        setStatusMsg(`${el.kind} added`);
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : String(err));
      }
      setDrawPt(null);
      return;
    }

    if (activeTool === 'place-head') {
      // Convert the plan-space click (units) into building-space FEET. Heads live in
      // feet; the head Z (height) is the selected room's ceiling, else the project
      // default ceiling height. plan x -> feet x; plan y -> feet z (floor plane).
      const fx = p.x * scale;
      const fz = p.y * scale;
      const ceilingHt = selectedRoom?.ceilingHt ?? project.hazardDefaults.defaultCeilingHt;
      const id = addHead(
        { x: fx, y: ceilingHt, z: fz },
        activeHeadSku ?? undefined,
      );
      select('node', id);
      setStatusMsg(
        `head placed at ${fx.toFixed(1)}, ${fz.toFixed(1)} ft` +
          (activeHeadSku ? ` (${activeHeadSku})` : ' (no SKU selected)'),
      );
      return;
    }
  }

  function onStageDblClick(): void {
    if (activeTool === 'draw-polyline' && polyPts.length >= 2) {
      try {
        addAnnotation(makePolyline(makeId('ann'), polyPts));
        setStatusMsg(`polyline added (${polyPts.length} points)`);
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : String(err));
      }
      setPolyPts([]);
      return;
    }
    if (activeTool === 'wall' && wallPts.length >= 2) {
      // Commit each consecutive segment as a Wall.
      for (let i = 0; i < wallPts.length - 1; i++) {
        addWall({
          id: makeId('wall'),
          start: wallPts[i],
          end: wallPts[i + 1],
        });
      }
      setStatusMsg(`traced ${wallPts.length - 1} wall segment(s)`);
      setWallPts([]);
      return;
    }
    if (activeTool === 'room' && roomPts.length >= 3) {
      const id = addRoom(roomPts, hazard);
      const area = polygonAreaSqFt(roomPts, ftPerUnit);
      setStatusMsg(
        `room added (${HAZARD_LABEL[hazard]}) — ${
          area > 0 ? `${area.toFixed(0)} sq ft` : 'set scale for area'
        } [${id}]`,
      );
      setRoomPts([]);
      return;
    }
  }

  // Apply the inline set-scale popover: compute ft/unit from the two captured points
  // + the typed known distance, call setScale, then clear the in-progress state.
  function applyScalePrompt(): void {
    if (!scalePrompt) return;
    const knownFeet = Number(scaleInput.trim());
    try {
      const ft = setScaleFromTwoPoints(scalePrompt.a, scalePrompt.b, knownFeet);
      setScale(ft, building.source === 'none' ? 'manual' : undefined);
      setStatusMsg(`scale set: ${ft.toFixed(4)} ft/unit`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'invalid scale input');
    }
    setScalePrompt(null);
    setScaleInput('');
    setScalePts([]);
    setCursor(null);
  }

  function cancelScalePrompt(): void {
    setScalePrompt(null);
    setScaleInput('');
    setScalePts([]);
    setCursor(null);
  }

  // Live readouts for the in-progress interaction.
  const liveScaleFeet =
    activeTool === 'set-scale' && scalePts.length === 1 && cursor
      ? measureFeet(scalePts[0], cursor, ftPerUnit)
      : null;
  const liveRoomArea =
    activeTool === 'room' && roomPts.length >= 2
      ? polygonAreaSqFt(cursor ? [...roomPts, cursor] : roomPts, ftPerUnit)
      : null;

  return (
    <div ref={wrapRef} style={wrapStyle} aria-label="2D plan canvas">
      {ready ? (
        <Stage
          width={size.w}
          height={size.h}
          onMouseMove={onStageMouseMove}
          onMouseDown={onStageMouseDown}
          onMouseUp={onStageMouseUp}
          onWheel={onStageWheel}
          onClick={onStageClick}
          onDblClick={onStageDblClick}
        >
          {/* grid + underlay layer */}
          <Layer listening={false}>
            <Rect x={0} y={0} width={size.w} height={size.h} fill={colors.canvasBg} />

            {/* UNDERLAY beneath the grid */}
            {underlay?.kind === 'pdf' && (
              <KonvaImage
                image={underlay.canvas}
                x={xform.padX}
                y={xform.padY}
                width={underlay.widthPx * xform.scale}
                height={underlay.heightPx * xform.scale}
                opacity={0.85}
                listening={false}
              />
            )}

            {grid.minor.map((pts, idx) => (
              <Line key={`mi-${idx}`} points={pts} stroke={colors.gridMinor} strokeWidth={1} />
            ))}
            {grid.major.map((pts, idx) => (
              <Line key={`ma-${idx}`} points={pts} stroke={colors.gridMajor} strokeWidth={1} />
            ))}

            {/* DXF vector underlay drawn ON TOP of grid so faint linework is visible */}
            {underlay?.kind === 'dxf' &&
              underlay.lines.map((l, idx) => {
                const a = toScreen({ x: l.x1, y: l.y1 });
                const b = toScreen({ x: l.x2, y: l.y2 });
                return (
                  <Line
                    key={`dxf-${idx}`}
                    points={[a.sx, a.sy, b.sx, b.sy]}
                    stroke={colors.accentText}
                    strokeWidth={1}
                    opacity={0.5}
                  />
                );
              })}

            {!hasContent && (
              <Text
                text={'No plan loaded — import a DXF or PDF (W1)'}
                x={0}
                y={size.h / 2 - 10}
                width={size.w}
                align="center"
                fill={colors.textSecondary}
                fontSize={15}
                fontFamily="Inter Variable, Inter, system-ui, sans-serif"
              />
            )}
          </Layer>

          {/* committed geometry + in-progress interaction layer */}
          <Layer listening={false}>
            {/* committed walls */}
            {building.walls.map((w) => {
              const a = toScreen(w.start);
              const b = toScreen(w.end);
              return (
                <Line
                  key={w.id}
                  points={[a.sx, a.sy, b.sx, b.sy]}
                  stroke={colors.interactiveText}
                  strokeWidth={2}
                />
              );
            })}

            {/* committed rooms */}
            {building.rooms.map((r) => {
              const pts = r.polygon.flatMap((p) => {
                const s = toScreen(p);
                return [s.sx, s.sy];
              });
              return (
                <Line
                  key={r.id}
                  points={pts}
                  closed
                  stroke={colors.accent}
                  strokeWidth={2}
                  fill={'rgba(240,168,104,0.12)'}
                />
              );
            })}

            {/* committed annotations (T29-T34 drawing primitives, plan units) */}
            {(project.annotations ?? []).map((el) => renderAnnotation(el, toScreen, xform.scale))}

            {/* in-progress draw-tool previews */}
            {drawPt && cursor && activeTool === 'draw-line' && (
              <Line
                points={[toScreen(drawPt).sx, toScreen(drawPt).sy, toScreen(cursor).sx, toScreen(cursor).sy]}
                stroke={colors.accentText}
                strokeWidth={1.5}
                dash={[6, 4]}
              />
            )}
            {drawPt && cursor && activeTool === 'draw-circle' && (
              <Circle
                x={toScreen(drawPt).sx}
                y={toScreen(drawPt).sy}
                radius={Math.hypot(cursor.x - drawPt.x, cursor.y - drawPt.y) * xform.scale}
                stroke={colors.accentText}
                strokeWidth={1.5}
                dash={[6, 4]}
              />
            )}
            {drawPt && cursor && activeTool === 'draw-rect' && (
              <Line
                points={rectScreenPoints(drawPt, cursor, toScreen)}
                closed
                stroke={colors.accentText}
                strokeWidth={1.5}
                dash={[6, 4]}
              />
            )}
            {polyPts.length > 0 && activeTool === 'draw-polyline' && (
              <Line
                points={[...polyPts, ...(cursor ? [cursor] : [])].flatMap((p) => {
                  const s = toScreen(p);
                  return [s.sx, s.sy];
                })}
                stroke={colors.accentText}
                strokeWidth={1.5}
                dash={[6, 4]}
              />
            )}

            {/* in-progress set-scale */}
            {scalePts.map((p, i) => {
              const s = toScreen(p);
              return <Circle key={`sp-${i}`} x={s.sx} y={s.sy} radius={4} fill={colors.warn} />;
            })}
            {scalePts.length === 1 && cursor && (
              <Line
                points={[
                  toScreen(scalePts[0]).sx,
                  toScreen(scalePts[0]).sy,
                  toScreen(cursor).sx,
                  toScreen(cursor).sy,
                ]}
                stroke={colors.warn}
                strokeWidth={1.5}
                dash={[6, 4]}
              />
            )}

            {/* in-progress wall */}
            {wallPts.length > 0 && (
              <Line
                points={[...wallPts, ...(cursor ? [cursor] : [])].flatMap((p) => {
                  const s = toScreen(p);
                  return [s.sx, s.sy];
                })}
                stroke={colors.interactiveText}
                strokeWidth={2}
                dash={[8, 4]}
              />
            )}

            {/* in-progress room */}
            {roomPts.length > 0 && (
              <Line
                points={[...roomPts, ...(cursor ? [cursor] : [])].flatMap((p) => {
                  const s = toScreen(p);
                  return [s.sx, s.sy];
                })}
                closed={roomPts.length >= 2}
                stroke={colors.accent}
                strokeWidth={1.5}
                dash={[8, 4]}
                fill={'rgba(240,168,104,0.08)'}
              />
            )}

            {/* in-progress marquee (select tool, screen-space). AutoCAD-style:
                left-to-right = WINDOW (solid, accent); right-to-left = CROSSING
                (dashed, warn). */}
            {marquee &&
              Math.hypot(marquee.ex - marquee.sx, marquee.ey - marquee.sy) > 4 && (
                <Rect
                  x={Math.min(marquee.sx, marquee.ex)}
                  y={Math.min(marquee.sy, marquee.ey)}
                  width={Math.abs(marquee.ex - marquee.sx)}
                  height={Math.abs(marquee.ey - marquee.sy)}
                  stroke={marquee.ex >= marquee.sx ? colors.accent : colors.warn}
                  strokeWidth={1}
                  dash={marquee.ex >= marquee.sx ? undefined : [6, 4]}
                  fill={
                    marquee.ex >= marquee.sx
                      ? 'rgba(240,168,104,0.06)'
                      : 'rgba(240,196,90,0.06)'
                  }
                />
              )}
          </Layer>

          {/* W4 pipe layer — segments styled by role + width by diameter; fittings as
              symbols. Pipe nodes live in FEET; convert to plan units then to screen.
              Segments are click-selectable; fittings are draggable + selectable. */}
          <Layer>
            {segments.map((seg) => {
              const a = nodeById.get(seg.from);
              const c = nodeById.get(seg.to);
              if (!a || !c) return null; // never draw an orphan pipe
              const pa = toScreen({ x: a.pos.x / scale, y: a.pos.z / scale });
              const pc = toScreen({ x: c.pos.x / scale, y: c.pos.z / scale });
              const isSel = seg.id === selectedSegmentId || multiSegSet.has(seg.id);
              const heatPsi = pRange && segPsi.has(seg.id) ? segPsi.get(seg.id)! : null;
              const stroke = isSel
                ? colors.warn
                : heatPsi != null && pRange
                  ? pressureColor(heatPsi, pRange.min, pRange.max)
                  : roleColor(seg.role);
              return (
                <Line
                  key={seg.id}
                  points={[pa.sx, pa.sy, pc.sx, pc.sy]}
                  stroke={stroke}
                  strokeWidth={widthForDiameter(seg.diameterIn) + (isSel ? 2 : 0)}
                  lineCap="round"
                  hitStrokeWidth={12}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    if (e.evt.shiftKey) {
                      // Shift-click: toggle in/out of the multi-set, keep other picks.
                      togglePickMulti('segment', seg.id, true);
                      return;
                    }
                    // Single pick: mirror into multi FIRST (setMulti clears the
                    // single selection), then restore the single-pick contract.
                    setMulti({ nodeIds: [], segmentIds: [seg.id], roomIds: [] });
                    select('segment', seg.id);
                  }}
                />
              );
            })}

            {/* fitting markers — distinct STANDARD-style 2D symbols per fitting type:
                  TEE     — a filled circle joint with a perpendicular branch stub (the
                            classic tee glyph)
                  ELBOW   — a small filled circle (a turn joint)
                  REDUCER — a concentric reducer: two stacked triangles meeting at a point
                  SOURCE  — the riser diamond
                The riser/source keeps its magenta diamond. All are draggable + selectable. */}
            {fittings.map((f) => {
              const s = toScreen({ x: f.pos.x / scale, y: f.pos.z / scale });
              const isSel = f.id === selectedNodeId || multiNodeSet.has(f.id);
              const stroke = isSel ? colors.warn : colors.accentText;
              const common = {
                draggable: true,
                onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
                  e.cancelBubble = true;
                  if (e.evt.shiftKey) {
                    togglePickMulti('node', f.id, true);
                    return;
                  }
                  setMulti({ nodeIds: [f.id], segmentIds: [], roomIds: [] });
                  select('node', f.id);
                },
                onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => {
                  e.cancelBubble = true;
                  select('node', f.id);
                },
                onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                  e.cancelBubble = true;
                  const plan = toPlan(e.target.x(), e.target.y());
                  moveNode(f.id, { x: plan.x * scale, y: f.pos.y, z: plan.y * scale });
                },
              };

              if (f.type === 'SOURCE') {
                const half = isSel ? 7 : 5;
                return (
                  <Rect
                    key={f.id}
                    x={s.sx}
                    y={s.sy}
                    width={half * 2}
                    height={half * 2}
                    rotation={45}
                    offsetX={half}
                    offsetY={half}
                    fill="#c062d0"
                    stroke={stroke}
                    strokeWidth={1.5}
                    {...common}
                  />
                );
              }

              if (f.type === 'TEE' || f.type === 'CROSS') {
                const r = isSel ? 5 : 3.5;
                return (
                  <Circle
                    key={f.id}
                    x={s.sx}
                    y={s.sy}
                    radius={r}
                    fill={isSel ? colors.warn : '#cdd6e0'}
                    stroke={stroke}
                    strokeWidth={1.25}
                    {...common}
                  />
                );
              }

              if (f.type === 'REDUCER') {
                // Concentric reducer glyph: a bow-tie of two triangles meeting at center.
                const w = isSel ? 7 : 5;
                const h = isSel ? 5 : 3.5;
                return (
                  <Line
                    key={f.id}
                    x={s.sx}
                    y={s.sy}
                    points={[-w, -h, 0, 0, -w, h, w, -h, 0, 0, w, h]}
                    closed
                    fill={isSel ? colors.warn : '#cdd6e0'}
                    stroke={stroke}
                    strokeWidth={1.25}
                    {...common}
                  />
                );
              }

              // ELBOW (and any other) — a small filled circle turn joint.
              const r = isSel ? 5 : 3.5;
              return (
                <Circle
                  key={f.id}
                  x={s.sx}
                  y={s.sy}
                  radius={r}
                  fill={isSel ? colors.warn : '#9fb0c2'}
                  stroke={stroke}
                  strokeWidth={1.25}
                  {...common}
                />
              );
            })}

            {/* TEE branch stubs (non-interactive): a short perpendicular tick marking the
                branch leg, distinguishing a tee from an elbow at a glance. */}
            {fittings.map((f) => {
              if (f.type !== 'TEE' && f.type !== 'CROSS') return null;
              const s = toScreen({ x: f.pos.x / scale, y: f.pos.z / scale });
              const isSel = f.id === selectedNodeId || multiNodeSet.has(f.id);
              const stroke = isSel ? colors.warn : colors.accentText;
              const L = isSel ? 8 : 6;
              const pts =
                f.type === 'CROSS'
                  ? [s.sx - L, s.sy, s.sx + L, s.sy, s.sx, s.sy, s.sx, s.sy - L, s.sx, s.sy + L]
                  : [s.sx - L, s.sy, s.sx + L, s.sy, s.sx, s.sy, s.sx, s.sy + L];
              return (
                <Line
                  key={`ts-${f.id}`}
                  points={pts}
                  stroke={stroke}
                  strokeWidth={1.25}
                  listening={false}
                  lineCap="round"
                />
              );
            })}

            {/* fitting glyph labels (non-interactive) */}
            {fittings.map((f) => {
              const s = toScreen({ x: f.pos.x / scale, y: f.pos.z / scale });
              return (
                <Text
                  key={`g-${f.id}`}
                  text={FITTING_GLYPH[f.type] ?? ''}
                  x={s.sx + 7}
                  y={s.sy - 13}
                  fill={colors.textMuted}
                  fontSize={9}
                  listening={false}
                  fontFamily="var(--hf-font-mono)"
                />
              );
            })}
          </Layer>

          {/* heads layer — INTERACTIVE: click to select, drag to move. Heads are in
              FEET; convert to plan units (feet / scale) then to screen. Each head is
              a STANDARD sprinkler symbol: a circle with an inscribed cross (the common
              plan glyph for a sprinkler), not a plain dot. The interactive (draggable)
              circle carries the hit area; the cross lines are decorative overlays. */}
          <Layer>
            {heads.map((h) => {
              const planPt: Point2 = { x: h.pos.x / scale, y: h.pos.z / scale };
              const s = toScreen(planPt);
              const isSel = h.id === selectedNodeId || multiNodeSet.has(h.id);
              const heatPsi = pRange && nodePsi.has(h.id) ? nodePsi.get(h.id)! : null;
              const headColor = isSel
                ? colors.warn
                : heatPsi != null && pRange
                  ? pressureColor(heatPsi, pRange.min, pRange.max)
                  : colors.interactiveText;
              const r = isSel ? 8 : 6;
              return (
                <Circle
                  key={h.id}
                  x={s.sx}
                  y={s.sy}
                  radius={r}
                  // Hollow circle outline (standard head symbol body).
                  fill={colors.canvasBg}
                  stroke={headColor}
                  strokeWidth={isSel ? 2.5 : 1.75}
                  draggable
                  onClick={(e) => {
                    e.cancelBubble = true;
                    if (e.evt.shiftKey) {
                      togglePickMulti('node', h.id, true);
                      return;
                    }
                    setMulti({ nodeIds: [h.id], segmentIds: [], roomIds: [] });
                    select('node', h.id);
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    select('node', h.id);
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    const sx = e.target.x();
                    const sy = e.target.y();
                    const plan = toPlan(sx, sy);
                    moveHead(h.id, { x: plan.x * scale, y: h.pos.y, z: plan.y * scale });
                  }}
                />
              );
            })}
            {/* Cross overlays for each head (the "+" inside the circle). Non-interactive
                so the underlying draggable circle keeps the hit/drag behavior. */}
            {heads.map((h) => {
              const s = toScreen({ x: h.pos.x / scale, y: h.pos.z / scale });
              const isSel = h.id === selectedNodeId || multiNodeSet.has(h.id);
              const heatPsi = pRange && nodePsi.has(h.id) ? nodePsi.get(h.id)! : null;
              const headColor = isSel
                ? colors.warn
                : heatPsi != null && pRange
                  ? pressureColor(heatPsi, pRange.min, pRange.max)
                  : colors.interactiveText;
              const r = isSel ? 8 : 6;
              return (
                <Line
                  key={`hx-${h.id}`}
                  points={[s.sx - r, s.sy, s.sx + r, s.sy, s.sx, s.sy, s.sx, s.sy - r, s.sx, s.sy + r]}
                  stroke={headColor}
                  strokeWidth={isSel ? 1.75 : 1.25}
                  listening={false}
                  lineCap="round"
                />
              );
            })}
          </Layer>
        </Stage>
      ) : null}

      {/* In-app inline SET-SCALE popover (replaces window.prompt). Anchored near the
          second click; a numeric "known distance (ft)" field + Apply/Cancel. */}
      {scalePrompt && (
        <div
          style={{
            ...scalePopoverStyle,
            left: Math.min(Math.max(scalePrompt.screenX + 12, 8), Math.max(8, size.w - 240)),
            top: Math.min(Math.max(scalePrompt.screenY + 12, 8), Math.max(8, size.h - 120)),
          }}
          aria-label="Set scale"
          role="dialog"
        >
          <div style={scalePopoverTitleStyle}>Set scale</div>
          <label style={scalePopoverLabelStyle}>
            Known distance (ft)
            <input
              type="number"
              autoFocus
              value={scaleInput}
              min={0}
              step="any"
              placeholder="e.g. 20"
              onChange={(ev) => setScaleInput(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') applyScalePrompt();
                else if (ev.key === 'Escape') cancelScalePrompt();
              }}
              style={scalePopoverInputStyle}
              aria-label="Known real distance between the two points, in feet"
            />
          </label>
          <div style={scalePopoverHintStyle}>
            Read it off a dimension string, grid line, or the scale bar.
          </div>
          <div style={scalePopoverBtnRowStyle}>
            <button type="button" style={scalePopoverApplyStyle} onClick={applyScalePrompt}>
              Apply
            </button>
            <button type="button" style={scalePopoverCancelStyle} onClick={cancelScalePrompt}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tool HUD: instructions + live readouts + hazard picker. */}
      {hasContent && (
        <div style={hudStyle}>
          <div style={hudRowStyle}>
            {isSample && (
              <span style={sampleBadgeStyle} title="Example/sample data — not your real plan or a real building.">
                SAMPLE
              </span>
            )}
            <span style={hudBadgeStyle}>{`scale: ${ftPerUnit} ft/unit`}</span>
            <span style={hudBadgeStyle} data-cad-zoom>
              {`zoom: ${fitXform.scale > 0 ? zoomPercent(xform, fitXform.scale) : 100}%`}
            </span>
            {multiCount > 0 && (
              <span style={hudBadgeStyle} data-cad-multi>
                {`${multiCount} selected`}
              </span>
            )}
            {vpOverride && (
              <button
                type="button"
                style={hudFitBtnStyle}
                onClick={() => setVpOverride(null)}
                title="Reset to fit view"
                data-cad-fit
              >
                Fit
              </button>
            )}
            {activeTool === 'set-scale' && (
              <span style={hudHintStyle}>
                {scalePts.length === 0
                  ? 'Click the first reference point'
                  : 'Click the second point, then enter the known feet'}
                {liveScaleFeet != null && ftPerUnit > 0
                  ? ` — ${liveScaleFeet.toFixed(2)} ft at current scale`
                  : ''}
              </span>
            )}
            {activeTool === 'wall' && (
              <span style={hudHintStyle}>Click to add wall points; double-click to finish</span>
            )}
            {activeTool === 'room' && (
              <span style={hudHintStyle}>
                Click a closed room; double-click to finish
                {liveRoomArea != null && liveRoomArea > 0
                  ? ` — ${liveRoomArea.toFixed(0)} sq ft`
                  : ''}
              </span>
            )}
            {activeTool === 'place-head' && (
              <span style={hudHintStyle}>
                Click the plan to place a head
                {activeHeadSku
                  ? ` (${activeHeadSku})`
                  : ' — pick a head SKU in the left panel first'}
                . Drag to move; Delete removes the selected head.
              </span>
            )}
            {activeTool === 'route-pipe' && (
              <span style={hudHintStyle}>
                Generate a wet-pipe tree from the laid heads, then drag fittings or
                edit a selected pipe in the inspector.
              </span>
            )}
          </div>

          {/* W4: route the laid heads into a real pipe tree (branches -> cross-main
              -> main -> riser). Available whenever heads exist. */}
          {heads.length > 0 && (
            <div style={headBarStyle}>
              <button
                type="button"
                style={autoLayoutBtnStyle}
                onClick={() => {
                  routeSystem();
                  setStatusMsg(`routed ${heads.length} head(s) into a pipe tree`);
                }}
              >
                Route pipe
              </button>
              {segments.length > 0 && (
                <span style={hudBadgeStyle}>
                  {`${segments.length} pipe(s), ${fittings.length} fitting(s)`}
                </span>
              )}
            </div>
          )}

          {/* Per-room auto-layout (uses current SKU + the room's hazard) + a live
              cited coverage readout for the selected room. */}
          {selectedRoom && (
            <div style={headBarStyle}>
              <button
                type="button"
                style={autoLayoutBtnStyle}
                onClick={() => {
                  const ids = autoLayoutRoom(selectedRoom.id, activeHeadSku ?? undefined);
                  setStatusMsg(
                    `auto-laid ${ids.length} head(s) in ${
                      selectedRoom.name ?? selectedRoom.id
                    } (${selectedRoom.hazard})` +
                      (activeHeadSku ? ` with ${activeHeadSku}` : ' — no SKU selected'),
                  );
                }}
              >
                Auto-layout heads
              </button>
              <RoomCoverageBadge
                roomPolygonUnits={selectedRoom.polygon}
                hazard={selectedRoom.hazard}
                scale={scale}
                heads={heads.map((h) => ({ x: h.pos.x, y: h.pos.z }))}
              />
            </div>
          )}

          {activeTool === 'room' && (
            <label style={hazardLabelStyle}>
              Hazard
              <select
                value={hazard}
                onChange={(e) => setHazard(e.target.value as HazardClass)}
                style={hazardSelectStyle}
              >
                {HAZARD_CLASSES.map((h) => (
                  <option key={h} value={h}>
                    {HAZARD_LABEL[h]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* W5 pressure heatmap legend (only when the heatmap is on + there is range). */}
          {pressureHeatmap && pRange && pRange.max > pRange.min && (
            <div style={headBarStyle}>
              <span style={hudBadgeStyle}>Pressure heatmap (psi)</span>
              <span style={legendGradientStyle} aria-hidden="true" />
              <span style={hudHintStyle}>
                {`${pRange.min.toFixed(0)} (low) → ${pRange.max.toFixed(0)} (high) psi — design aid estimate`}
              </span>
            </div>
          )}

          {statusMsg && <div style={statusMsgStyle}>{statusMsg}</div>}
        </div>
      )}

      {/* DOM empty-state overlay (screen-reader text + pre-measure state). */}
      {!hasContent && (
        <div style={overlayStyle} aria-hidden={ready}>
          <div style={overlayBadgeStyle}>2D PLAN</div>
          <div style={overlayTitleStyle}>No plan loaded</div>
          <div style={overlayBodyStyle}>
            Import a DXF (auto walls + scale) or a PDF (raster to trace) — W1.
          </div>
          <div style={overlayCtaWrapStyle}>
            <button
              type="button"
              style={overlayCtaBtnStyle}
              onClick={() => {
                void loadSampleProject();
              }}
            >
              Load sample project
            </button>
            <div style={overlayCtaNoteStyle}>
              Loads CLEARLY-LABELLED example data (not your plan, not a real building)
              so you can try the whole flow: heads → pipe → hydraulics → bid.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A compact, CITED coverage badge for the selected room. Converts the room polygon
 * to feet, evaluates coverageReport against the heads that fall inside it, and shows
 * covered/uncovered + the first failing cited finding. Numbers come ONLY from the
 * cited nfpa13-rules via coverageReport — never forked here.
 */
function RoomCoverageBadge({
  roomPolygonUnits,
  hazard,
  scale,
  heads,
}: {
  roomPolygonUnits: Point2[];
  hazard: HazardClass;
  scale: number;
  heads: Point2[];
}): ReactElement {
  const polyFt = roomPolygonUnits.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  // Only heads inside this room count toward its coverage.
  const inRoom = heads.filter((h) => pointInPolygonFt(h, polyFt));
  const rep = coverageReport(polyFt, inRoom, hazard);
  const firstFail = rep.findings.find((f) => !f.ok);
  return (
    <span
      style={{
        ...coverageBadgeStyle,
        color: rep.covered ? colors.accentText : colors.danger,
        borderColor: rep.covered ? colors.border : colors.danger,
      }}
      title={firstFail?.citation ?? rep.disclaimer}
    >
      {rep.covered
        ? `coverage OK — ${rep.headCount} head(s), <= ${rep.maxAllowedAreaPerHead} ft^2/head`
        : `coverage FAIL — ${firstFail?.message ?? 'not covered'}`}
    </span>
  );
}

/** Ray-cast point-in-polygon for feet-space points (no turf dependency in render). */
function pointInPolygonFt(pt: Point2, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/* --------------------------------------------------------------- styles */

const wrapStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  background: colors.canvasBg,
  overflow: 'hidden',
};

const hudStyle: CSSProperties = {
  position: 'absolute',
  top: spacing[2],
  left: spacing[2],
  right: spacing[2],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
  pointerEvents: 'none',
};

const hudRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[2],
  flexWrap: 'wrap',
};

const hudBadgeStyle: CSSProperties = {
  background: colors.bgInset,
  border: `1px solid ${colors.border}`,
  borderRadius: 999,
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  padding: `${spacing[0.5]} ${spacing[2]}`,
  fontFamily: 'var(--hf-font-mono)',
};

const hudHintStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
};

const hudFitBtnStyle: CSSProperties = {
  background: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: 999,
  color: colors.textPrimary,
  fontSize: typeScale.xs.size,
  padding: `${spacing[0.5]} ${spacing[2]}`,
  cursor: 'pointer',
};

const hazardLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: spacing[1],
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
  pointerEvents: 'auto',
};

const hazardSelectStyle: CSSProperties = {
  background: colors.surfaceRaised,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  padding: `2px 6px`,
  fontSize: typeScale.xs.size,
};

const statusMsgStyle: CSSProperties = {
  color: colors.accentText,
  fontSize: typeScale.xs.size,
  fontFamily: 'var(--hf-font-mono)',
};

const headBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing[2],
  flexWrap: 'wrap',
  pointerEvents: 'auto',
};

const autoLayoutBtnStyle: CSSProperties = {
  background: colors.interactiveActive,
  color: '#ffffff',
  border: `1px solid ${colors.interactive}`,
  borderRadius: 6,
  padding: `4px 10px`,
  fontSize: typeScale.xs.size,
  fontWeight: 600,
  cursor: 'pointer',
};

const legendGradientStyle: CSSProperties = {
  display: 'inline-block',
  width: 120,
  height: 10,
  borderRadius: 999,
  // The same blue->red ramp pressureColor produces (5 stops).
  background:
    'linear-gradient(90deg, rgb(59,130,246), rgb(34,211,238), rgb(74,222,128), rgb(250,204,21), rgb(239,68,68))',
  border: `1px solid ${colors.border}`,
};

const coverageBadgeStyle: CSSProperties = {
  background: colors.bgInset,
  border: `1px solid ${colors.border}`,
  borderRadius: 999,
  fontSize: typeScale.xs.size,
  padding: `${spacing[0.5]} ${spacing[2]}`,
  fontFamily: 'var(--hf-font-mono)',
};

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: spacing[2],
  pointerEvents: 'none',
};

const overlayBadgeStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  letterSpacing: '0.12em',
  fontWeight: 600,
  border: `1px solid ${colors.border}`,
  borderRadius: 999,
  padding: `${spacing[0.5]} ${spacing[3]}`,
  background: colors.bgInset,
};

const overlayTitleStyle: CSSProperties = {
  color: colors.textSecondary,
  fontSize: typeScale.lg.size,
  fontWeight: 600,
};

const overlayBodyStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.sm.size,
};

const overlayCtaWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: spacing[1],
  pointerEvents: 'auto',
  maxWidth: 360,
  marginTop: spacing[2],
};

const overlayCtaBtnStyle: CSSProperties = {
  background: colors.interactiveActive,
  color: '#ffffff',
  border: `1px solid ${colors.interactive}`,
  borderRadius: radii.md,
  padding: `${spacing[2]} ${spacing[4]}`,
  fontSize: typeScale.sm.size,
  fontWeight: 600,
  cursor: 'pointer',
};

const overlayCtaNoteStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
  textAlign: 'center',
};

const sampleBadgeStyle: CSSProperties = {
  background: colors.warn,
  color: '#1a1206',
  border: `1px solid ${colors.warn}`,
  borderRadius: 999,
  fontSize: typeScale.xs.size,
  fontWeight: 700,
  letterSpacing: '0.08em',
  padding: `${spacing[0.5]} ${spacing[2]}`,
  pointerEvents: 'auto',
};

const scalePopoverStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 10,
  background: colors.surfaceRaised,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radii.lg,
  padding: spacing[3],
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
  width: 220,
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
  pointerEvents: 'auto',
};

const scalePopoverTitleStyle: CSSProperties = {
  color: colors.textPrimary,
  fontSize: typeScale.sm.size,
  fontWeight: 600,
};

const scalePopoverLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[1],
  color: colors.textSecondary,
  fontSize: typeScale.xs.size,
};

const scalePopoverInputStyle: CSSProperties = {
  background: colors.surface,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: `${spacing[1]} ${spacing[2]}`,
  fontSize: typeScale.sm.size,
  fontFamily: 'var(--hf-font-mono)',
};

const scalePopoverHintStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  lineHeight: 1.4,
};

const scalePopoverBtnRowStyle: CSSProperties = {
  display: 'flex',
  gap: spacing[2],
};

const scalePopoverApplyStyle: CSSProperties = {
  background: colors.interactiveActive,
  color: '#ffffff',
  border: `1px solid ${colors.interactive}`,
  borderRadius: radii.md,
  padding: `${spacing[1]} ${spacing[3]}`,
  fontSize: typeScale.xs.size,
  fontWeight: 600,
  cursor: 'pointer',
};

const scalePopoverCancelStyle: CSSProperties = {
  background: colors.surfaceRaised,
  color: colors.textSecondary,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: `${spacing[1]} ${spacing[3]}`,
  fontSize: typeScale.xs.size,
  fontWeight: 500,
  cursor: 'pointer',
};
