import { describe, expect, it } from 'vitest';
import { demoTimeline, easeInOut } from '../src/engine/demo-timeline.js';

// V2: the demo rise timeline must (1) raise the structure first, (2) only start
// the sprinkler system after the walls finish + a gap, (3) ease the camera over
// the whole run, and (4) report done at the end — all clamped + monotonic.
describe('easeInOut', () => {
  it('clamps and hits the endpoints', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
  });
  it('is monotonic non-decreasing', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) { const v = easeInOut(t); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });
});

describe('demoTimeline', () => {
  const o = { wallsMs: 1000, systemMs: 1000, gapMs: 200 }; // total 2200

  it('at t=0 nothing has risen and it is not done', () => {
    const f = demoTimeline(0, o);
    expect(f.wallsT).toBe(0);
    expect(f.systemT).toBe(0);
    expect(f.done).toBe(false);
    expect(f.totalMs).toBe(2200);
  });

  it('raises the structure before the system starts', () => {
    const mid = demoTimeline(500, o); // halfway through walls, system not started
    expect(mid.wallsT).toBeGreaterThan(0);
    expect(mid.systemT).toBe(0); // system starts at wallsMs+gapMs = 1200
  });

  it('walls finish (~1) before the system begins rising', () => {
    const atWallsEnd = demoTimeline(1000, o);
    expect(atWallsEnd.wallsT).toBeCloseTo(1, 6);
    expect(atWallsEnd.systemT).toBe(0);
    const afterGap = demoTimeline(1700, o); // 500ms into the 1000ms system phase
    expect(afterGap.systemT).toBeGreaterThan(0);
    expect(afterGap.systemT).toBeLessThan(1);
  });

  it('completes at totalMs with everything risen', () => {
    const end = demoTimeline(2200, o);
    expect(end.wallsT).toBeCloseTo(1, 6);
    expect(end.systemT).toBeCloseTo(1, 6);
    expect(end.cameraT).toBeCloseTo(1, 6);
    expect(end.done).toBe(true);
  });

  it('defaults to a sane ~2.55s timeline', () => {
    expect(demoTimeline(0).totalMs).toBe(1200 + 150 + 1200);
  });
});
