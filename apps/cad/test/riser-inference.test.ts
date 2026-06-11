import { describe, expect, it } from 'vitest';
import {
  inferRiser,
  orientFlow,
  solvableFraction,
  type RiserNode,
  type RiserSegment,
} from '../src/lib/riser-inference';

const node = (id: string, x: number, y: number, type = 'JUNCTION'): RiserNode => ({
  id,
  type,
  pos: { x, y },
});
const seg = (
  id: string,
  from: string,
  to: string,
  diameterIn: number,
  lengthFt: number,
): RiserSegment => ({ id, from, to, diameterIn, lengthFt });

/**
 * Tree with the fat 4in segment at the root. The root sits on the bounding
 * box edge with top-decile degree, so it uniquely outscores j1 (interior).
 */
const treeNodes: RiserNode[] = [
  node('root', 0, 10),
  node('j1', 10, 10),
  node('j2', 0, 0),
  node('h0', 0, 18, 'HEAD'),
  node('h1', 20, 10, 'HEAD'),
  node('h2', 10, 20, 'HEAD'),
  node('h3', 0, -10, 'HEAD'),
];
const treeSegs: RiserSegment[] = [
  seg('s1', 'root', 'j1', 4, 10),
  seg('s2', 'root', 'j2', 1, 10),
  seg('s6', 'root', 'h0', 1, 8),
  seg('s3', 'j1', 'h1', 1, 10),
  seg('s4', 'j1', 'h2', 1, 10),
  seg('s5', 'j2', 'h3', 1, 10),
];

describe('inferRiser', () => {
  it('picks the node touching the max-diameter segment with the max-diameter reason', () => {
    const c = inferRiser(treeNodes, treeSegs);
    expect(c.nodeId).toBe('root');
    expect(c.reasons).toContain('max-diameter');
    expect(c.score).toBeGreaterThan(0);
  });

  it('throws when every node is a HEAD', () => {
    const heads = [node('h1', 0, 0, 'HEAD'), node('h2', 1, 1, 'HEAD')];
    expect(() => inferRiser(heads, [])).toThrowError('no non-head nodes');
  });

  it('throws on empty node list', () => {
    expect(() => inferRiser([], [])).toThrowError('no non-head nodes');
  });

  it('breaks score ties by lowest nodeId (alpha wins over beta)', () => {
    // Two identical isolated non-head nodes: same score, tie broken lexically.
    const twins = [node('alpha', 0, 0), node('beta', 0, 0)];
    const c = inferRiser(twins, []);
    expect(c.nodeId).toBe('alpha');
  });
});

describe('orientFlow', () => {
  it('points every from toward the riser side of the tree', () => {
    const oriented = orientFlow(treeNodes, treeSegs, 'root');
    expect(oriented.size).toBe(6);
    expect(oriented.get('s1')).toEqual({ from: 'root', to: 'j1' });
    expect(oriented.get('s2')).toEqual({ from: 'root', to: 'j2' });
    expect(oriented.get('s6')).toEqual({ from: 'root', to: 'h0' });
    expect(oriented.get('s3')).toEqual({ from: 'j1', to: 'h1' });
    expect(oriented.get('s4')).toEqual({ from: 'j1', to: 'h2' });
    expect(oriented.get('s5')).toEqual({ from: 'j2', to: 'h3' });
  });

  it('re-orients a segment stored pointing at the riser', () => {
    const flipped = [seg('s1', 'j1', 'root', 4, 10)];
    const oriented = orientFlow(treeNodes, flipped, 'root');
    expect(oriented.get('s1')).toEqual({ from: 'root', to: 'j1' });
  });

  it('excludes segments on a disconnected island (honest partial result)', () => {
    const withIsland = [
      ...treeSegs,
      seg('iso1', 'islandA', 'islandB', 1, 5),
    ];
    const nodesWithIsland = [
      ...treeNodes,
      node('islandA', 100, 100),
      node('islandB', 110, 100),
    ];
    const oriented = orientFlow(nodesWithIsland, withIsland, 'root');
    expect(oriented.has('iso1')).toBe(false);
    expect(oriented.size).toBe(6);
    expect(solvableFraction(withIsland, oriented)).toBeCloseTo(6 / 7, 10);
  });
});

describe('solvableFraction', () => {
  it('returns 0 when there are no segments', () => {
    expect(solvableFraction([], new Map())).toBe(0);
  });

  it('returns 1 when every segment is oriented', () => {
    const oriented = orientFlow(treeNodes, treeSegs, 'root');
    expect(solvableFraction(treeSegs, oriented)).toBe(1);
  });
});
