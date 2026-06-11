import { describe, expect, it } from 'vitest';
import { issueMarkers } from '../src/lib/clearance-overlay';
import type { Building, SprinklerNetwork } from '../src/lib/model';

const building = (walls: Array<[number, number, number, number]>): Building =>
  ({
    walls: walls.map(([x1, y1, x2, y2], i) => ({
      id: `w${i}`,
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
    })),
    rooms: [],
    scaleFtPerUnit: 1,
    source: 'traced',
  }) as unknown as Building;

const networkWithHeads = (
  heads: Array<[string, number, number]>,
): SprinklerNetwork =>
  ({
    nodes: heads.map(([id, x, z]) => ({
      id,
      type: 'HEAD',
      pos: { x, y: 10, z },
    })),
    segments: [],
  }) as unknown as SprinklerNetwork;

describe('issueMarkers', () => {
  it('marks a head 0.2 ft from a wall as too-close with the citation hedge', () => {
    const markers = issueMarkers(
      building([[0, 0, 0, 20]]),
      networkWithHeads([['h1', 0.2, 10]]),
      'LIGHT',
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].headId).toBe('h1');
    expect(markers[0].kind).toBe('too-close-to-wall');
    expect(markers[0].x).toBe(0.2);
    expect(markers[0].y).toBe(10);
    expect(markers[0].message).toContain('Verify adopted edition');
  });

  it('yields no markers for a compliant head', () => {
    // 5 ft from the wall: beyond min clearance, within half of LIGHT 15 ft.
    const markers = issueMarkers(
      building([[0, 0, 0, 20]]),
      networkWithHeads([['h1', 5, 10]]),
      'LIGHT',
    );
    expect(markers).toEqual([]);
  });

  it('yields no markers when there are no walls (honest skip)', () => {
    const markers = issueMarkers(
      building([]),
      networkWithHeads([['h1', 0.1, 0.1]]),
      'LIGHT',
    );
    expect(markers).toEqual([]);
  });
});
