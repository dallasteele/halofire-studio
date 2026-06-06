// HaloFire CAD — App shell. Semantic-landmark layout:
//   <header> TopRibbon (tabs + tools + Plan/3D/Split control)
//   row: <aside> LeftPanel | <main> CenterStage (Plan ⟂ 3D) | <aside> RightInspector
//   <footer> StatusBar (units/scale/zoom + design-aid disclaimer)
//
// The shell publishes a small honest snapshot to window.__cad for preview
// verification (ready, viewMode, projectLoaded, toolCount). `projectLoaded` is
// false until a real W-slice loads building/network geometry.
//
// HONESTY: this is a SHELL. No plan, building, or heads are drawn — every canvas
// shows its empty state, and the disclaimer states this is a design aid only.

import { useEffect, type CSSProperties, type ReactElement } from 'react';
import { TopRibbon } from './components/TopRibbon';
import { LeftPanel } from './components/LeftPanel';
import { CenterStage } from './components/CenterStage';
import { RightInspector } from './components/RightInspector';
import { StatusBar } from './components/StatusBar';
import { TOOL_COUNT, useCadStore } from './store';
import { cadWindowSnapshot, publishCadWindow } from './lib/cad-window';
import { colors } from './lib/tokens';

export function App(): ReactElement {
  const project = useCadStore((s) => s.project);
  const viewMode = useCadStore((s) => s.viewMode);

  // Publish the preview-verification handle whenever the relevant state changes.
  useEffect(() => {
    publishCadWindow(cadWindowSnapshot(project, viewMode, TOOL_COUNT));
  }, [project, viewMode]);

  return (
    <div style={appStyle}>
      <TopRibbon />
      <div style={bodyRowStyle}>
        <LeftPanel />
        <CenterStage />
        <RightInspector />
      </div>
      <StatusBar />
    </div>
  );
}

/* --------------------------------------------------------------- styles */

const appStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  background: colors.bg,
  color: colors.textPrimary,
  overflow: 'hidden',
};

const bodyRowStyle: CSSProperties = {
  display: 'flex',
  flex: '1 1 auto',
  minHeight: 0,
};
