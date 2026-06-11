// flow-gradient — PURE gradient color-stop + per-vertex color math for the
// continuous ("fluid dynamics") pressure heatmap. The stops and vertex colors
// must come ONLY from hydraulics.pressureColor (one shared scale) and the
// vertex buffer must be finite, in [0,1], and exactly 3 floats per vertex.

import { describe, expect, it } from 'vitest';
import {
  konvaColorStops,
  parseRgb01,
  segmentVertexColors,
  stopsForSegment,
} from '../src/lib/flow-gradient';
import { pressureColor } from '../src/lib/hydraulics';

describe('parseRgb01', () => {
  it('parses the exact rgb() format pressureColor emits into [0,1] floats', () => {
    expect(parseRgb01('rgb(255, 0, 0)')).toEqual([1, 0, 0]);
    expect(parseRgb01('rgb(0, 255, 0)')).toEqual([0, 1, 0]);
    const [r, g, b] = parseRgb01(pressureColor(50, 0, 100));
    for (const v of [r, g, b]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('returns a deterministic neutral gray for an unparseable string (never NaN)', () => {
    expect(parseRgb01('#ff0000')).toEqual([0.5, 0.5, 0.5]);
    expect(parseRgb01('')).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('stopsForSegment', () => {
  it('returns exactly t=0 (from) and t=1 (to) colored by pressureColor on the shared scale', () => {
    const stops = stopsForSegment(20, 80, 0, 100);
    expect(stops).toHaveLength(2);
    expect(stops[0].t).toBe(0);
    expect(stops[1].t).toBe(1);
    expect(stops[0].color).toBe(pressureColor(20, 0, 100));
    expect(stops[1].color).toBe(pressureColor(80, 0, 100));
  });

  it('low pressure maps blue-ish, high pressure red-ish (blue->red scale honored)', () => {
    const stops = stopsForSegment(0, 100, 0, 100);
    const [rLo, , bLo] = parseRgb01(stops[0].color);
    const [rHi, , bHi] = parseRgb01(stops[1].color);
    expect(bLo).toBeGreaterThan(rLo); // low end: blue dominates
    expect(rHi).toBeGreaterThan(bHi); // high end: red dominates
  });

  it('a flat segment (fromPsi == toPsi) yields two identical stops', () => {
    const stops = stopsForSegment(42, 42, 0, 100);
    expect(stops[0].color).toBe(stops[1].color);
  });
});

describe('konvaColorStops', () => {
  it('flattens stops into [t0, color0, t1, color1] (konva contract)', () => {
    const flat = konvaColorStops(stopsForSegment(20, 80, 0, 100));
    expect(flat).toHaveLength(4);
    expect(flat[0]).toBe(0);
    expect(flat[1]).toBe(pressureColor(20, 0, 100));
    expect(flat[2]).toBe(1);
    expect(flat[3]).toBe(pressureColor(80, 0, 100));
  });
});

describe('segmentVertexColors', () => {
  it('returns a Float32Array of EXACTLY 3 floats per vertex, all finite in [0,1]', () => {
    const axisT = [0, 0.25, 0.5, 0.75, 1];
    const out = segmentVertexColors(axisT, 10, 90, 0, 100);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(axisT.length * 3);
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('endpoint vertices match pressureColor of the endpoint pressures exactly', () => {
    const out = segmentVertexColors([0, 1], 10, 90, 0, 100);
    const from = parseRgb01(pressureColor(10, 0, 100));
    const to = parseRgb01(pressureColor(90, 0, 100));
    for (let c = 0; c < 3; c++) {
      expect(out[c]).toBeCloseTo(from[c], 5);
      expect(out[3 + c]).toBeCloseTo(to[c], 5);
    }
  });

  it('mid-axis vertex equals pressureColor of the LINEARLY lerped psi (continuous ramp)', () => {
    const out = segmentVertexColors([0.5], 10, 90, 0, 100);
    const mid = parseRgb01(pressureColor(50, 0, 100)); // 10 + 0.5*(90-10)
    for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(mid[c], 5);
  });

  it('clamps out-of-range t and treats non-finite t as mid-pipe — never NaN output', () => {
    const out = segmentVertexColors([-1, 2, NaN, Infinity], 10, 90, 0, 100);
    expect(out.length).toBe(12);
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // t=-1 clamps to the from color; t=2 clamps to the to color.
    const from = parseRgb01(pressureColor(10, 0, 100));
    const to = parseRgb01(pressureColor(90, 0, 100));
    for (let c = 0; c < 3; c++) {
      expect(out[c]).toBeCloseTo(from[c], 5);
      expect(out[3 + c]).toBeCloseTo(to[c], 5);
    }
  });

  it('degenerate scale (min == max) still yields finite colors (pressureColor mid)', () => {
    const out = segmentVertexColors([0, 0.5, 1], 50, 50, 50, 50);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });

  it('empty input yields an empty buffer', () => {
    expect(segmentVertexColors([], 10, 90, 0, 100).length).toBe(0);
  });
});
