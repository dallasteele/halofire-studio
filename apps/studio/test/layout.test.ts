import { describe, expect, it } from 'vitest';
import {
  branchLines,
  HAZARD_CLASSES,
  HAZARD_MAX_COVERAGE_SQFT,
  HAZARD_MAX_SPACING_FT,
  LAYOUT_DISCLAIMER,
  layoutHeads,
  type HazardClass,
} from '../src/lib/layout';

describe('layoutHeads — spacing + coverage limits', () => {
  it('respects max spacing AND max coverage for every hazard class', () => {
    for (const hazard of HAZARD_CLASSES) {
      const layout = layoutHeads({ widthFt: 60, lengthFt: 60, hazard });
      expect(layout.spacingFt).toBeLessThanOrEqual(HAZARD_MAX_SPACING_FT[hazard]);
      expect(layout.coveragePerHeadSqft).toBeLessThanOrEqual(
        HAZARD_MAX_COVERAGE_SQFT[hazard],
      );
    }
  });

  it('30x30 ordinary room: spacing<=15, coverage<=130, expected grid', () => {
    const layout = layoutHeads({ widthFt: 30, lengthFt: 30, hazard: 'ordinary' });
    expect(layout.spacingFt).toBeLessThanOrEqual(15);
    expect(layout.coveragePerHeadSqft).toBeLessThanOrEqual(130);
    // ordinary coverage cap (130) => sqrt ~= 11.4ft binds tighter than 15ft.
    // 30 / 11.4 = ceil 3 heads per axis => 3x3 grid, 10ft spacing.
    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(3);
    expect(layout.spacingFt).toBe(10);
    expect(layout.count).toBe(9);
    expect(layout.coveragePerHeadSqft).toBe(100);
  });
});

describe('layoutHeads — grid structure', () => {
  it('count equals rows * cols', () => {
    const layout = layoutHeads({ widthFt: 48, lengthFt: 72, hazard: 'light' });
    expect(layout.count).toBe(layout.rows * layout.cols);
    expect(layout.heads).toHaveLength(layout.count);
  });

  it('heads are centered and symmetric about the origin', () => {
    const layout = layoutHeads({ widthFt: 40, lengthFt: 40, hazard: 'light' });
    const sumX = layout.heads.reduce((a, h) => a + h.x, 0);
    const sumZ = layout.heads.reduce((a, h) => a + h.z, 0);
    // Symmetric grid => coordinate sums cancel to ~0.
    expect(Math.abs(sumX)).toBeLessThan(1e-6);
    expect(Math.abs(sumZ)).toBeLessThan(1e-6);
    // The set of x coordinates is mirror-symmetric.
    const xs = [...new Set(layout.heads.map((h) => h.x))].sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i += 1) {
      expect(xs[i]).toBeCloseTo(-xs[xs.length - 1 - i], 6);
    }
  });

  it('always places at least one head, even for a tiny footprint', () => {
    const layout = layoutHeads({ widthFt: 1, lengthFt: 1, hazard: 'extra' });
    expect(layout.count).toBeGreaterThanOrEqual(1);
    expect(layout.heads.length).toBe(layout.count);
  });
});

describe('layoutHeads — determinism', () => {
  it('same input yields identical output', () => {
    const input = { widthFt: 55, lengthFt: 80, hazard: 'ordinary' as HazardClass };
    expect(layoutHeads(input)).toEqual(layoutHeads(input));
  });
});

describe('layoutHeads — hazard severity ordering', () => {
  it('extra hazard uses tighter spacing than light for the same room', () => {
    const room = { widthFt: 60, lengthFt: 60 };
    const light = layoutHeads({ ...room, hazard: 'light' });
    const extra = layoutHeads({ ...room, hazard: 'extra' });
    expect(extra.spacingFt).toBeLessThan(light.spacingFt);
    // Tighter spacing => more heads.
    expect(extra.count).toBeGreaterThan(light.count);
  });
});

describe('branchLines', () => {
  it('emits one branch line per row plus a single cross-main', () => {
    const layout = layoutHeads({ widthFt: 45, lengthFt: 45, hazard: 'ordinary' });
    const { branches, crossMain } = branchLines(layout);
    expect(branches).toHaveLength(layout.rows);
    expect(crossMain).toHaveLength(1);
  });

  it('each branch line spans the full width at its row z', () => {
    const layout = layoutHeads({ widthFt: 45, lengthFt: 45, hazard: 'ordinary' });
    const { branches } = branchLines(layout);
    const halfWidth = ((layout.cols - 1) / 2) * layout.spacingFt;
    for (const b of branches) {
      expect(b.x1).toBeCloseTo(-halfWidth, 6);
      expect(b.x2).toBeCloseTo(halfWidth, 6);
      expect(b.z1).toBeCloseTo(b.z2, 6); // horizontal run
    }
  });

  it('cross-main runs down the centerline spanning all rows', () => {
    const layout = layoutHeads({ widthFt: 45, lengthFt: 45, hazard: 'ordinary' });
    const { crossMain } = branchLines(layout);
    const main = crossMain[0];
    expect(main.x1).toBe(0);
    expect(main.x2).toBe(0);
    const halfLen = ((layout.rows - 1) / 2) * layout.spacingFt;
    expect(main.z1).toBeCloseTo(-halfLen, 6);
    expect(main.z2).toBeCloseTo(halfLen, 6);
  });

  it('is deterministic', () => {
    const layout = layoutHeads({ widthFt: 33, lengthFt: 51, hazard: 'extra' });
    expect(branchLines(layout)).toEqual(branchLines(layout));
  });
});

describe('LAYOUT_DISCLAIMER honesty', () => {
  it('states it is not hydraulic / AHJ / PE / code-compliant / for construction', () => {
    const d = LAYOUT_DISCLAIMER.toLowerCase();
    expect(d).toContain('not a hydraulically-calculated');
    expect(d).toContain('not ahj');
    expect(d).toContain('not pe-sealed');
    expect(d).toContain('not code-compliant');
    expect(d).toContain('not for construction');
  });
});
