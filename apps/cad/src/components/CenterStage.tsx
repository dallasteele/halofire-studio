// HaloFire CAD — CenterStage. The main working area. Honors the store viewMode:
//   split → PlanCanvas | Viewer3D side by side (default)
//   plan  → PlanCanvas only
//   3d    → Viewer3D only
// A thin divider labels each pane. Both panes read the SAME shared store, so
// selection/geometry stay in sync once W-slices populate them.

import type { CSSProperties, ReactElement } from 'react';
import { useCadStore } from '../store';
import { PlanCanvas } from './PlanCanvas';
import { Viewer3D } from './Viewer3D';
import { colors, spacing, typeScale } from '../lib/tokens';

function PaneHeader({ label }: { label: string }): ReactElement {
  return (
    <div style={paneHeaderStyle}>
      <span style={paneHeaderLabelStyle}>{label}</span>
    </div>
  );
}

export function CenterStage(): ReactElement {
  const viewMode = useCadStore((s) => s.viewMode);

  const showPlan = viewMode === 'plan' || viewMode === 'split';
  const show3d = viewMode === '3d' || viewMode === 'split';

  return (
    <main style={stageStyle} aria-label="CAD workspace stage">
      {showPlan && (
        <section style={paneStyle}>
          <PaneHeader label="Plan" />
          <div style={paneBodyStyle}>
            <PlanCanvas />
          </div>
        </section>
      )}
      {showPlan && show3d && <div style={dividerStyle} aria-hidden="true" />}
      {show3d && (
        <section style={paneStyle}>
          <PaneHeader label="3D" />
          <div style={paneBodyStyle}>
            <Viewer3D />
          </div>
        </section>
      )}
    </main>
  );
}

/* --------------------------------------------------------------- styles */

const stageStyle: CSSProperties = {
  flex: '1 1 auto',
  display: 'flex',
  minWidth: 0,
  minHeight: 0,
  background: colors.bg,
};

const paneStyle: CSSProperties = {
  flex: '1 1 0',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
};

const paneHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: `${spacing[1]} ${spacing[3]}`,
  background: colors.surface,
  borderBottom: `1px solid ${colors.border}`,
  flex: '0 0 auto',
};

const paneHeaderLabelStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: typeScale.xs.size,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  fontWeight: 600,
};

const paneBodyStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 0,
  position: 'relative',
};

const dividerStyle: CSSProperties = {
  width: 1,
  background: colors.borderStrong,
  flex: '0 0 auto',
};
