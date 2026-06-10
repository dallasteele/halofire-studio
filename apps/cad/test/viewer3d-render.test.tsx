// Viewer3D (W2) render smoke test (jsdom): the 3D viewer mounts with a fixture
// building without crashing. jsdom has no WebGL, so Viewer3D takes its DOM
// fallback path (no Canvas) — but the PURE meshes are still built and the honest
// window handle (has3DBuilding / buildingBackend / floor+wall counts) is
// published. We assert the empty state for an empty project and the published 3D
// handle for a fixture building. We do NOT assert a GL context (none in jsdom).

import { describe, expect, it, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Viewer3D } from '../src/components/Viewer3D';
import { useCadStore } from '../src/store';
import { emptyProject, type Building, type Project } from '../src/lib/model';
import { EMPTY_SELECTION } from '../src/store';
import { BUILDING_MESH_BACKEND } from '../src/lib/building-mesh';

function fixtureProject(): Project {
  const p = emptyProject('Fixture');
  const building: Building = {
    scaleFtPerUnit: 1,
    source: 'manual',
    rooms: [
      {
        id: 'room-a',
        polygon: [
          { x: 0, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 16 },
          { x: 0, y: 16 },
        ],
        hazard: 'LIGHT',
        ceilingHt: 10,
      },
      {
        id: 'room-b',
        polygon: [
          { x: 12, y: 0 },
          { x: 24, y: 0 },
          { x: 24, y: 16 },
          { x: 12, y: 16 },
        ],
        hazard: 'ORDINARY_1',
        ceilingHt: 10,
      },
    ],
    walls: [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 24, y: 0 } },
      { id: 'w2', start: { x: 24, y: 0 }, end: { x: 24, y: 16 } },
    ],
  };
  return { ...p, building };
}

function setState(project: Project, selectedRoomId: string | null = null): void {
  act(() => {
    useCadStore.setState({
      project,
      selection: { ...EMPTY_SELECTION, selectedRoomId },
    });
  });
}

afterEach(() => {
  cleanup();
  act(() => {
    useCadStore.setState({
      project: emptyProject(),
      selection: { ...EMPTY_SELECTION },
    });
  });
});

describe('Viewer3D render smoke', () => {
  it('mounts with an empty project and shows the honest empty state', () => {
    setState(emptyProject());
    const { getByText, getByLabelText } = render(<Viewer3D />);
    expect(getByLabelText('3D building viewer')).toBeTruthy();
    expect(getByText('No building yet')).toBeTruthy();
    // No building -> no 3D meshes.
    expect(window.__cad?.has3DBuilding).toBe(false);
    expect(window.__cad?.floorCount).toBe(0);
    expect(window.__cad?.wallCount).toBe(0);
  });

  it('mounts with a fixture building and publishes the 3D handle', () => {
    setState(fixtureProject());
    render(<Viewer3D />);
    // Building loaded -> empty state gone.
    expect(() => render(<Viewer3D />)).not.toThrow();
    expect(window.__cad?.has3DBuilding).toBe(true);
    // M-3D.1: the viewer composes via the pure wallSolid/slabSolid path.
    expect(window.__cad?.buildingBackend).toBe(BUILDING_MESH_BACKEND);
    expect(window.__cad?.floorCount).toBe(2);
    expect(window.__cad?.wallCount).toBe(2);
  });

  it('is reactive: adding a room updates the published floor count', () => {
    const project = fixtureProject();
    setState(project);
    render(<Viewer3D />);
    expect(window.__cad?.floorCount).toBe(2);

    const grown: Project = {
      ...project,
      building: {
        ...project.building,
        rooms: [
          ...project.building.rooms,
          {
            id: 'room-c',
            polygon: [
              { x: 0, y: 16 },
              { x: 12, y: 16 },
              { x: 12, y: 32 },
              { x: 0, y: 32 },
            ],
            hazard: 'LIGHT',
            ceilingHt: 10,
          },
        ],
      },
    };
    setState(grown);
    expect(window.__cad?.floorCount).toBe(3);
  });
});
