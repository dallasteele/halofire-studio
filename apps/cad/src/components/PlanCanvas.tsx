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
import { HAZARD_CLASSES, makeId, type HazardClass, type Point2 } from '../lib/model';
import { measureFeet, polygonAreaSqFt, setScaleFromTwoPoints } from '../lib/scale';
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

export function PlanCanvas(): ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  const project = useCadStore((s) => s.project);
  const underlay = useCadStore((s) => s.underlay);
  const activeTool = useCadStore((s) => s.activeTool);
  const setScale = useCadStore((s) => s.setScale);
  const addWall = useCadStore((s) => s.addWall);
  const addRoom = useCadStore((s) => s.addRoom);

  const building = project.building;
  const ftPerUnit = building.scaleFtPerUnit;
  const hasContent = building.rooms.length > 0 || building.walls.length > 0 || underlay !== null;

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
    return IDENTITY_XFORM;
  }, [ready, underlay, size]);

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
          </div>

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
