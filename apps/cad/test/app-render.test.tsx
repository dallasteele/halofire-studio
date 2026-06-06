// App render smoke test (jsdom): the shell mounts without crashing and renders
// the ribbon, panels, and status bar — including the design-aid disclaimer and
// the honest empty states. We do NOT assert a WebGL/canvas context (none exists
// in jsdom); Viewer3D falls back to its DOM empty-state, and react-konva renders
// against the node-canvas-free Stage. The point is: the chrome is real and honest.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// react-konva's default entry pulls konva's Node build (needs the native
// `canvas` package). In jsdom PlanCanvas never actually mounts the Stage
// (clientWidth is 0), so its konva subtree is dead in this test — we stub the
// react-konva primitives to no-op renderers. This does NOT hide any chrome the
// test asserts: the plan empty state is a DOM overlay, not a konva node.
vi.mock('react-konva', () => {
  const Noop = () => null;
  return {
    Stage: Noop,
    Layer: Noop,
    Line: Noop,
    Text: Noop,
    Rect: Noop,
    Image: Noop,
    Circle: Noop,
  };
});

const { App } = await import('../src/App');
const { DESIGN_AID_DISCLAIMER } = await import('../src/components/StatusBar');
const { TOOL_COUNT } = await import('../src/store');

afterEach(cleanup);

describe('App shell render', () => {
  it('mounts without crashing and shows brand + landmarks', () => {
    render(<App />);
    expect(screen.getByText('HaloFire CAD')).toBeTruthy();
    expect(screen.getByLabelText('Ribbon tabs')).toBeTruthy();
    expect(screen.getByLabelText('Tools and catalog')).toBeTruthy();
    expect(screen.getByLabelText('Inspector')).toBeTruthy();
    expect(screen.getByLabelText('Status bar')).toBeTruthy();
  });

  it('shows the mandatory design-aid disclaimer', () => {
    render(<App />);
    expect(screen.getByText(DESIGN_AID_DISCLAIMER)).toBeTruthy();
  });

  it('shows honest empty states (no plan, no building, nothing selected)', () => {
    render(<App />);
    expect(screen.getByText('No plan loaded')).toBeTruthy();
    expect(screen.getByText('No building yet')).toBeTruthy();
    expect(screen.getByText('Nothing selected')).toBeTruthy();
  });

  it('renders the tool buttons and publishes the preview handle', () => {
    render(<App />);
    // Plan tab is active by default; its tools are present in the ribbon.
    expect(screen.getAllByText('Import Plan').length).toBeGreaterThan(0);
    // window.__cad published with an honest projectLoaded:false.
    expect(window.__cad).toBeTruthy();
    expect(window.__cad?.ready).toBe(true);
    expect(window.__cad?.projectLoaded).toBe(false);
    expect(window.__cad?.toolCount).toBe(TOOL_COUNT);
  });
});
