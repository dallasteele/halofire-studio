// W2D selection-set — multi-select + window/crossing marquee.

import { describe, expect, it } from 'vitest';
import {
  emptySelection,
  marqueeSelect,
  normalizeRect,
  pointInRect,
  segmentInRect,
  segmentIntersectsRect,
  selectionCount,
  togglePick,
  type MarqueeItems,
} from '../src/lib/selection-set';

const RECT = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

describe('togglePick', () => {
  it('non-additive replaces the whole selection across kinds', () => {
    const sel = { nodeIds: ['n1'], segmentIds: ['s1'], roomIds: ['r1'] };
    expect(togglePick(sel, 'node', 'n2', false)).toEqual({ nodeIds: ['n2'], segmentIds: [], roomIds: [] });
  });

  it('additive add then remove round-trips', () => {
    const sel = emptySelection();
    const add = togglePick(sel, 'node', 'n2', true);
    expect(add.nodeIds).toEqual(['n2']);
    expect(togglePick(add, 'node', 'n2', true)).toEqual(emptySelection());
  });

  it('additive keeps other kinds and stays sorted', () => {
    const sel = { nodeIds: ['n2', 'n1'], segmentIds: ['s1'], roomIds: [] };
    const r = togglePick(sel, 'node', 'n3', true);
    expect(r.nodeIds).toEqual(['n1', 'n2', 'n3']);
    expect(r.segmentIds).toEqual(['s1']);
  });

  it('throws on an empty id', () => {
    expect(() => togglePick(emptySelection(), 'node', '', false)).toThrow();
  });
});

describe('selectionCount + rect helpers', () => {
  it('counts across kinds', () => {
    expect(selectionCount({ nodeIds: ['a', 'b'], segmentIds: ['c'], roomIds: [] })).toBe(3);
  });
  it('normalizeRect from any corner pair', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 1, y: 1 })).toEqual({ minX: 1, minY: 1, maxX: 5, maxY: 5 });
  });
  it('pointInRect inclusive bounds', () => {
    expect(pointInRect({ x: 0, y: 0 }, RECT)).toBe(true);
    expect(pointInRect({ x: 10, y: 10 }, RECT)).toBe(true);
    expect(pointInRect({ x: -1, y: 5 }, RECT)).toBe(false);
  });
});

describe('segment hit tests', () => {
  it('fully inside is in-rect (window)', () => {
    expect(segmentInRect({ x: 1, y: 1 }, { x: 9, y: 9 }, RECT)).toBe(true);
    expect(segmentInRect({ x: -1, y: -1 }, { x: 1, y: 1 }, RECT)).toBe(false);
  });
  it('crossing one edge intersects but is not fully contained', () => {
    expect(segmentIntersectsRect({ x: 5, y: -1 }, { x: 5, y: 1 }, RECT)).toBe(true);
    expect(segmentInRect({ x: 5, y: -1 }, { x: 5, y: 1 }, RECT)).toBe(false);
  });
  it('collinear along an edge counts as crossing', () => {
    expect(segmentIntersectsRect({ x: 0, y: 0 }, { x: 10, y: 0 }, RECT)).toBe(true);
  });
  it('fully outside never intersects', () => {
    expect(segmentIntersectsRect({ x: -10, y: -10 }, { x: -5, y: -5 }, RECT)).toBe(false);
  });
});

describe('marqueeSelect', () => {
  const items: MarqueeItems = {
    nodes: [{ id: 'n1', at: { x: 5, y: 5 } }, { id: 'n2', at: { x: 15, y: 15 } }],
    segments: [
      { id: 's1', a: { x: 1, y: 1 }, b: { x: 9, y: 9 } },
      { id: 's2', a: { x: 11, y: 11 }, b: { x: 19, y: 19 } },
    ],
  };

  it('window selects only fully-contained items, sorted, no rooms', () => {
    expect(marqueeSelect(items, { x: 0, y: 0 }, { x: 10, y: 10 }, 'window'))
      .toEqual({ nodeIds: ['n1'], segmentIds: ['s1'], roomIds: [] });
  });

  it('crossing also catches edge-crossers', () => {
    const withEdge: MarqueeItems = {
      nodes: items.nodes,
      segments: [...items.segments, { id: 's3', a: { x: 5, y: -1 }, b: { x: 5, y: 1 } }],
    };
    expect(marqueeSelect(withEdge, { x: 0, y: 0 }, { x: 10, y: 10 }, 'crossing'))
      .toEqual({ nodeIds: ['n1'], segmentIds: ['s1', 's3'], roomIds: [] });
  });
});
