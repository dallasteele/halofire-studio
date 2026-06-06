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
import { coverageReport } from '../lib/head-layout';
import { colors, spacing, typeScale } from '../lib/tokens';

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
  ELBOW: 'L',
  REDUCER: 'R',
  SOURCE: '◈', // riser diamond
};

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
  const select = useCadStore((s) => s.select);
  const selectedNodeId = useCadStore((s) => s.selection.selectedNodeId);
  const selectedSegmentId = useCadStore((s) => s.selection.selectedSegmentId);
  const selectedRoomId = useCadStore((s) => s.selection.selectedRoomId);
  const activeHeadSku = useCadStore((s) => s.activeHeadSku);

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
  const [hazard, setHazard] = useState<HazardClass>('ORDINARY_1');
  const [cursor, setCursor] = useState<Point2 | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

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
  }, [activeTool]);

  // Delete / Backspace removes the selected head (ignored while typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
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
  }, [selectedNodeId, project.network.nodes, deleteHead]);

  const ready = size.w > 0 && size.h > 0;
  const grid = ready ? buildGridLines(size) : { minor: [], major: [] };

  // Compute the view transform from the underlay bounds (or building geometry).
  const xform = useMemo<ViewXform>(() => {
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

  function onStageMouseMove(e: Konva.KonvaEventObject<MouseEvent>): void {
    if (activeTool === 'set-scale' || activeTool === 'wall' || activeTool === 'room') {
      setCursor(pointerPlan(e));
    }
  }

  function onStageClick(e: Konva.KonvaEventObject<MouseEvent>): void {
    const p = pointerPlan(e);
    if (!p) return;

    if (activeTool === 'set-scale') {
      const next = [...scalePts, p];
      if (next.length < 2) {
        setScalePts(next);
        return;
      }
      // Two points captured — prompt for the known real distance in feet.
      const [a, b] = next;
      const answer =
        typeof window !== 'undefined'
          ? window.prompt(
              'Known real distance between the two points, in FEET\n' +
                '(read it off a dimension string, grid line, or the scale bar):',
              '',
            )
          : null;
      setScalePts([]);
      setCursor(null);
      if (answer == null) return;
      const knownFeet = Number(answer.trim());
      try {
        const ft = setScaleFromTwoPoints(a, b, knownFeet);
        setScale(ft, building.source === 'none' ? 'manual' : undefined);
        setStatusMsg(`scale set: ${ft.toFixed(4)} ft/unit`);
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : 'invalid scale input');
      }
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
              const isSel = seg.id === selectedSegmentId;
              return (
                <Line
                  key={seg.id}
                  points={[pa.sx, pa.sy, pc.sx, pc.sy]}
                  stroke={isSel ? colors.warn : roleColor(seg.role)}
                  strokeWidth={widthForDiameter(seg.diameterIn) + (isSel ? 2 : 0)}
                  lineCap="round"
                  hitStrokeWidth={12}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    select('segment', seg.id);
                  }}
                />
              );
            })}

            {/* fitting markers (tees/elbows/reducers/riser) */}
            {fittings.map((f) => {
              const s = toScreen({ x: f.pos.x / scale, y: f.pos.z / scale });
              const isSel = f.id === selectedNodeId;
              const isRiser = f.type === 'SOURCE';
              return (
                <Rect
                  key={f.id}
                  x={s.sx - (isSel ? 6 : 4)}
                  y={s.sy - (isSel ? 6 : 4)}
                  width={isSel ? 12 : 8}
                  height={isSel ? 12 : 8}
                  rotation={45}
                  offsetX={isSel ? 6 : 4}
                  offsetY={isSel ? 6 : 4}
                  fill={isRiser ? '#c062d0' : isSel ? colors.warn : '#cdd6e0'}
                  stroke={isSel ? colors.warn : colors.accentText}
                  strokeWidth={1}
                  draggable
                  onClick={(e) => {
                    e.cancelBubble = true;
                    select('node', f.id);
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    select('node', f.id);
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    const plan = toPlan(e.target.x(), e.target.y());
                    moveNode(f.id, { x: plan.x * scale, y: f.pos.y, z: plan.y * scale });
                  }}
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
                  x={s.sx + 6}
                  y={s.sy - 12}
                  fill={colors.textMuted}
                  fontSize={9}
                  listening={false}
                  fontFamily="var(--hf-font-mono)"
                />
              );
            })}
          </Layer>

          {/* heads layer — INTERACTIVE: click to select, drag to move. Heads are in
              FEET; convert to plan units (feet / scale) then to screen. */}
          <Layer>
            {heads.map((h) => {
              const planPt: Point2 = { x: h.pos.x / scale, y: h.pos.z / scale };
              const s = toScreen(planPt);
              const isSel = h.id === selectedNodeId;
              return (
                <Circle
                  key={h.id}
                  x={s.sx}
                  y={s.sy}
                  radius={isSel ? 7 : 5}
                  fill={isSel ? colors.warn : colors.interactiveText}
                  stroke={isSel ? colors.warn : colors.accentText}
                  strokeWidth={isSel ? 2 : 1}
                  draggable
                  onClick={(e) => {
                    e.cancelBubble = true;
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
          </Layer>
        </Stage>
      ) : null}

      {/* Tool HUD: instructions + live readouts + hazard picker. */}
      {hasContent && (
        <div style={hudStyle}>
          <div style={hudRowStyle}>
            <span style={hudBadgeStyle}>{`scale: ${ftPerUnit} ft/unit`}</span>
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
