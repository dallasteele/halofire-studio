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
  const activeHeadSku = useCadStore((s) => s.activeHeadSku);
  const supply = useCadStore((s) => s.supply);
  const designAreaSqFt = useCadStore((s) => s.designAreaSqFt);

  // Publish the preview-verification handle whenever the relevant state changes.
  // Includes the W5 live hydraulics (demand/riser psi/adequacy) so the handle
  // recomputes on every network OR supply OR design-area edit (live recalc).
  useEffect(() => {
    publishCadWindow(
      cadWindowSnapshot(project, viewMode, TOOL_COUNT, activeHeadSku, supply, designAreaSqFt),
    );
  }, [project, viewMode, activeHeadSku, supply, designAreaSqFt]);

  // DEV-only: expose the store getState for the preview/E2E harness to drive the app
  // (seed a building + heads, route pipe) without faking the UI. Stripped from prod.
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as unknown as { __cadStore?: typeof useCadStore }).__cadStore = useCadStore;
    }
  }, []);

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
