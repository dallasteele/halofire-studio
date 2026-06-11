// Inspector part-viewer render test (jsdom): selecting a HEAD node shows the
// PartViewer3D block with its HONEST provenance badge ('dimensioned parametric —
// NOT manufacturer-exact' when the part resolves to a verified build123d body),
// and — since jsdom has no WebGL — the honest 'WebGL unavailable' fallback div
// instead of an R3F Canvas (no crash). Selecting a SEGMENT shows the pipe spec
// rows plus the diameter-true parametric-cylinder caption (a parametric cylinder
// IS the real geometry of pipe).
//
// The manifests hook is mocked with a minimal verified build123d manifest so the
// resolver path (resolvePartModel -> tier) is exercised deterministically without
// network fetches.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('../src/lib/use-manifests', () => ({
  useManifests: () => ({
    build123d: {
      entries: [
        {
          key: 'head_pendent',
          source: 'build123d',
          productCode: 'B123D-HEAD-PEND-050',
          stepUrl: '/parts/build123d/head_pendent.step',
          sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        },
      ],
    },
    manufacturerStep: { entries: [] },
  }),
}));

const { RightInspector } = await import('../src/components/RightInspector');
const { provenanceBadge } = await import('../src/components/PartViewer3D');
const { useCadStore, EMPTY_SELECTION } = await import('../src/store');
const { emptyProject } = await import('../src/lib/model');
type Project = import('../src/lib/model').Project;
type Node = import('../src/lib/model').Node;
type Segment = import('../src/lib/model').Segment;

/** A tiny real network: one source, one head, one branch pipe between them. */
function fixtureProject(): Project {
  const p = emptyProject('Inspector fixture');
  const nodes: Node[] = [
    { id: 'src1', type: 'SOURCE', pos: { x: 0, y: 0, z: 0 } },
    { id: 'h1', type: 'HEAD', pos: { x: 5, y: 9, z: 5 } },
  ];
  const segments: Segment[] = [
    {
      id: 'seg1',
      from: 'src1',
      to: 'h1',
      diameterIn: 1.25,
      lengthFt: 10,
      role: 'BRANCH',
      material: 'STEEL_SCH40',
    },
  ];
  return { ...p, network: { ...p.network, nodes, segments } };
}

function selectInStore(
  kind: 'node' | 'segment',
  id: string,
): void {
  act(() => {
    useCadStore.setState({
      project: fixtureProject(),
      selection: {
        ...EMPTY_SELECTION,
        selectedNodeId: kind === 'node' ? id : null,
        selectedSegmentId: kind === 'segment' ? id : null,
      },
    });
  });
}

afterEach(() => {
  cleanup();
  act(() => {
    useCadStore.setState({ project: emptyProject(), selection: { ...EMPTY_SELECTION } });
  });
});

describe('Inspector part viewer (jsdom — no WebGL)', () => {
  it('selected HEAD: shows the dimensioned-parametric provenance badge and the honest WebGL fallback (no crash)', () => {
    selectInStore('node', 'h1');
    render(<RightInspector />);

    // The badge text is the honest tier label — never manufacturer-exact for build123d.
    expect(
      screen.getByText('dimensioned parametric — NOT manufacturer-exact'),
    ).toBeTruthy();
    // jsdom has no WebGL -> the mini viewer renders the honest fallback div.
    expect(screen.getByText(/WebGL unavailable/)).toBeTruthy();
    // Canonical orientation note for a head: deflector down.
    expect(screen.getByText(/deflector down/)).toBeTruthy();
    // The part body caption names the resolved build123d key (also in the
    // ModelProvenance Key row — both are present).
    expect(screen.getAllByText(/head_pendent/).length).toBeGreaterThan(0);
  });

  it('selected SEGMENT: shows the pipe spec rows and the diameter-true parametric-cylinder caption', () => {
    selectInStore('segment', 'seg1');
    render(<RightInspector />);

    // Pipe spec: diameter / material / role / length rows.
    expect(screen.getByText('Ø (in)')).toBeTruthy();
    expect(screen.getByText('1.25')).toBeTruthy();
    expect(screen.getByText('STEEL_SCH40')).toBeTruthy();
    expect(screen.getByText('BRANCH')).toBeTruthy();
    expect(screen.getByText('10.00')).toBeTruthy();
    // The cylinder is labeled honestly as the REAL geometry of pipe.
    expect(screen.getByText(/REAL geometry of pipe/)).toBeTruthy();
    // jsdom has no WebGL -> honest fallback, no crash.
    expect(screen.getByText(/WebGL unavailable/)).toBeTruthy();
    // Pipe preview carries the dimensioned-parametric badge (parametric cylinder).
    expect(
      screen.getByText('dimensioned parametric — NOT manufacturer-exact'),
    ).toBeTruthy();
  });

  it('provenanceBadge maps every tier to its honest label', () => {
    expect(provenanceBadge('manufacturer_verified').text).toBe('manufacturer verified');
    expect(provenanceBadge('dimensioned_parametric').text).toBe(
      'dimensioned parametric — NOT manufacturer-exact',
    );
    expect(provenanceBadge(null).text).toBe('proxy — no real body');
    expect(provenanceBadge('proxy').text).toBe('proxy — no real body');
  });
});
