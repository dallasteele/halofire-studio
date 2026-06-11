import { describe, expect, it } from 'vitest';
import { clusterColinear, type RawStroke } from '../src/lib/pdf-line-cluster';

const stroke = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  widthPt = 1,
): RawStroke => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, widthPt });

describe('clusterColinear', () => {
  it('merges three collinear horizontal strokes with 2pt gaps into one run', () => {
    const runs = clusterColinear([
      stroke(0, 0, 10, 0, 1),
      stroke(12, 0, 20, 0, 2),
      stroke(22, 0, 30, 0, 1),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].sourceCount).toBe(3);
    expect(runs[0].a).toEqual({ x: 0, y: 0 });
    expect(runs[0].b).toEqual({ x: 30, y: 0 });
    expect(runs[0].widthPt).toBe(2);
  });

  it('does not merge a parallel stroke offset 5pt', () => {
    const runs = clusterColinear([
      stroke(0, 0, 10, 0),
      stroke(0, 5, 10, 5),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.sourceCount === 1)).toBe(true);
  });

  it('never merges a perpendicular stroke', () => {
    const runs = clusterColinear([
      stroke(0, 0, 10, 0),
      stroke(5, 0, 5, 10),
    ]);
    expect(runs).toHaveLength(2);
  });

  it('merges strokes within the 2-degree angle tolerance (1 degree skew)', () => {
    const rad = (1 * Math.PI) / 180;
    const runs = clusterColinear([
      stroke(0, 0, 10, 0),
      stroke(10.5, 0, 10.5 + 8 * Math.cos(rad), 8 * Math.sin(rad)),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].sourceCount).toBe(2);
  });

  it('drops zero-length strokes before clustering', () => {
    const runs = clusterColinear([
      stroke(4, 4, 4, 4),
      stroke(0, 0, 10, 0),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].sourceCount).toBe(1);
  });

  it('returns an empty array on empty input', () => {
    expect(clusterColinear([])).toEqual([]);
  });

  it('sorts deterministically: length descending, then a.x, then a.y ascending', () => {
    const runs = clusterColinear([
      stroke(50, 50, 55, 50), // short, later coords
      stroke(0, 20, 30, 20), // longest
      stroke(0, 40, 5, 40), // short, earlier coords
    ]);
    expect(runs).toHaveLength(3);
    expect(runs[0].a).toEqual({ x: 0, y: 20 });
    // Two 5-length runs: a.x 0 before a.x 50.
    expect(runs[1].a).toEqual({ x: 0, y: 40 });
    expect(runs[2].a).toEqual({ x: 50, y: 50 });
  });

  it('does not mutate input strokes', () => {
    const input = [stroke(0, 0, 10, 0), stroke(12, 0, 20, 0)];
    const snapshot = structuredClone(input);
    clusterColinear(input);
    expect(input).toEqual(snapshot);
  });
});
