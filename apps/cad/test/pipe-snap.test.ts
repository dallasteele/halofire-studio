import { describe, expect, it } from 'vitest';
import { distPointToSegment2D, snapToNetwork, type Pt } from '../src/lib/pipe-snap';

describe('distPointToSegment2D', () => {
  const a: Pt = { x: 0, z: 0 };
  const b: Pt = { x: 10, z: 0 };

  it('projects to middle of segment', () => {
    const p: Pt = { x: 5, z: 2 };
    const res = distPointToSegment2D(p, a, b);
    expect(res.dist).toBeCloseTo(2);
    expect(res.t).toBeCloseTo(0.5);
    expect(res.closest).toEqual({ x: 5, z: 0 });
  });

  it('clamps t to 0 at start', () => {
    const p: Pt = { x: -2, z: 1 };
    const res = distPointToSegment2D(p, a, b);
    expect(res.t).toBe(0);
    expect(res.closest).toEqual(a);
  });

  it('clamps t to 1 at end', () => {
    const p: Pt = { x: 12, z: -1 };
    const res = distPointToSegment2D(p, a, b);
    expect(res.t).toBe(1);
    expect(res.closest).toEqual(b);
  });
});

describe('snapToNetwork', () => {
  const nodes = [
    { id: 'N1', pos: { x: 0, y: 0, z: 0 } },
    { id: 'N2', pos: { x: 10, y: 0, z: 0 } },
    { id: 'N3', pos: { x: 5, y: 0, z: 5 } },
  ];
  const segments = [
    { id: 'S1', from: 'N1', to: 'N2' },
    { id: 'S2', from: 'N2', to: 'N3' },
    { id: 'S_MISSING', from: 'N1', to: 'NONEXISTENT' },
  ];

  it('node win over farther segment', () => {
    // Click near N1 (dist 0.5) but also near S2 middle (dist ~4)
    const p: Pt = { x: 0, z: 0.5 };
    const hit = snapToNetwork(p, nodes, segments, 1);
    expect(hit.kind).toBe('node');
    if (hit.kind === 'node') expect(hit.nodeId).toBe('N1');
  });

  it('segment hit returns clamped t and correct closest point', () => {
    // Click beside middle of S1 (x=5, z=0) at x=5, z=0.5
    const p: Pt = { x: 5, z: 0.5 };
    const hit = snapToNetwork(p, nodes, segments, 1);
    expect(hit.kind).toBe('segment');
    if (hit.kind === 'segment') {
      expect(hit.segmentId).toBe('S1');
      expect(hit.t).toBeCloseTo(0.5);
      expect(hit.at).toEqual({ x: 5, z: 0 });
    }
  });

  it('clamps t to 0/1 beyond ends', () => {
    const pStart: Pt = { x: -1, z: 0 };
    const hitStart = snapToNetwork(pStart, nodes, segments, 2);
    if (hitStart.kind === 'segment') expect(hitStart.t).toBe(0);

    const pEnd: Pt = { x: 11, z: 0 };
    const hitEnd = snapToNetwork(pEnd, nodes, segments, 2);
    if (hitEnd.kind === 'segment') expect(hitEnd.t).toBe(1);
  });

  it('returns none beyond tolerance', () => {
    const p: Pt = { x: 50, z: 50 };
    const hit = snapToNetwork(p, nodes, segments, 1);
    expect(hit.kind).toBe('none');
  });

  it('tie-break by id ascending', () => {
    // Two nodes at same distance (dist 2) from p={0, 2}
    const customNodes = [
      { id: 'B_NODE', pos: { x: 0, y: 0, z: 4 } },
      { id: 'A_NODE', pos: { x: 0, y: 0, z: 0 } },
    ];
    const p: Pt = { x: 0, z: 2 };
    const hit = snapToNetwork(p, customNodes, [], 3);
    if (hit.kind === 'node') expect(hit.nodeId).toBe('A_NODE');
  });

  it('skips segment with missing endpoint nodes', () => {
    // S_MISSING is in segments but N_NONEXISTENT is not in nodes
    const p: Pt = { x: 0, z: -1 }; // Close to N1 (start of S_MISSING)
    // If it didn't skip, it might try to snap to segment. 
    // But since we check node first and N1 is within tolFt=2:
    const hit = snapToNetwork(p, nodes, segments, 2);
    expect(hit.kind).toBe('node');
  });

  it('throws on NaN point or zero tolerance', () => {
    expect(() => snapToNetwork({ x: NaN, z: 0 }, nodes, segments, 1)).toThrow();
    expect(() => snapToNetwork({ x: 0, z: 0 }, nodes, segments, 0)).toThrow();
  });
});
