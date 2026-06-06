// HaloFire CAD — PlanCanvas (2D). A react-konva Stage that draws a CAD grid
// (minor + major lines) and, when no plan is loaded, an honest centered empty
// state ("No plan loaded — import a DXF or PDF (W1)"). It measures its container
// so the Stage fills the available space. When the project has building
// geometry this is where walls/rooms render — until then it is grid + empty
// state only. Nothing fake is drawn.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { Stage, Layer, Line, Text, Rect } from 'react-konva';
import { useCadStore } from '../store';
import { hasBuilding } from '../lib/model';
import { colors, spacing, typeScale } from '../lib/tokens';

/** Spacing between minor grid lines, in px (1 ft @ default zoom). */
const MINOR = 24;
/** Every Nth minor line is a major line. */
const MAJOR_EVERY = 5;

interface Size {
  w: number;
  h: number;
}

function buildGridLines(size: Size): {
  minor: number[][];
  major: number[][];
} {
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

export function PlanCanvas(): ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const project = useCadStore((s) => s.project);
  const loaded = hasBuilding(project);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () =>
      setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const ready = size.w > 0 && size.h > 0;
  const grid = ready ? buildGridLines(size) : { minor: [], major: [] };

  return (
    <div ref={wrapRef} style={wrapStyle} aria-label="2D plan canvas">
      {ready ? (
        <Stage width={size.w} height={size.h}>
          <Layer listening={false}>
            <Rect x={0} y={0} width={size.w} height={size.h} fill={colors.canvasBg} />
            {grid.minor.map((pts, idx) => (
              <Line key={`mi-${idx}`} points={pts} stroke={colors.gridMinor} strokeWidth={1} />
            ))}
            {grid.major.map((pts, idx) => (
              <Line key={`ma-${idx}`} points={pts} stroke={colors.gridMajor} strokeWidth={1} />
            ))}
            {!loaded && (
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
        </Stage>
      ) : null}

      {/* DOM overlay label so the empty state is present even before Stage measures
          (and so screen readers get real text, not canvas pixels). */}
      {!loaded && (
        <div style={overlayStyle} aria-hidden={ready}>
          <div style={overlayBadgeStyle}>2D PLAN</div>
          <div style={overlayTitleStyle}>No plan loaded</div>
          <div style={overlayBodyStyle}>
            Import a DXF or PDF floor plan to begin (W1).
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
