import { describe, expect, it } from 'vitest';
import { suggestWalls } from '../src/lib/pdf-trace-assist';
import type { RawStroke } from '../src/lib/pdf-line-cluster';

const stroke = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  widthPt: number,
): RawStroke => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, widthPt });

// Synthetic page: two long thick parallel wall strokes + short thin noise.
// Scale: 0.05 ft per PDF point (200 pt = 10 ft walls; 10 pt = 0.5 ft noise).
const SCALE = 0.05;
const page: RawStroke[] = [
  stroke(0, 0, 200, 0, 2),
  stroke(0, 100, 200, 100, 2),
  stroke(20, 30, 30, 30, 0.5),
  stroke(50, 60, 60, 60, 0.5),
  stroke(80, 20, 90, 20, 0.5),
];

describe('suggestWalls', () => {
  it('yields exactly the two wall suggestions, converted to feet', () => {
    const out = suggestWalls(page, SCALE);
    expect(out).toHaveLength(2);
    for (const s of out) {
      const lenFt = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      expect(lenFt).toBeCloseTo(10, 6);
      expect(s.scoreInfo.score).toBeGreaterThanOrEqual(0.6);
    }
    // Feet coordinates, not PDF points.
    expect(out.some((s) => s.a.y === 100 * SCALE || s.b.y === 100 * SCALE)).toBe(true);
  });

  it('returns empty on empty input without throwing', () => {
    expect(suggestWalls([], SCALE)).toEqual([]);
  });

  it('minScore override widens the accepted set', () => {
    const strict = suggestWalls(page, SCALE);
    const loose = suggestWalls(page, SCALE, { minScore: 0.1 });
    expect(loose.length).toBeGreaterThan(strict.length);
  });
});
