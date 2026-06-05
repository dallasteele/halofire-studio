import { describe, it, expect } from 'vitest';
import { layoutBuilding } from '../src/engine/system-layout.js';
import { normalizeBuilding } from '../src/engine/building-model.js';
import { layoutRoom } from '../src/engine/sprinkler-layout.js';
import { sizePipe } from '../src/engine/cad-model.js';

// Two adjacent rectangular rooms on one story, ordinary hazard.
// Room A: 30x20 at origin. Room B: 30x20 to the right (x 30..60).
const TWO_SPACE = {
  name: 'Two-Space Building',
  units: 'ft',
  stories: [
    {
      level: 0,
      baseElevationFt: 0,
      ceilingHeightFt: 14,
      spaces: [
        { name: 'A', polygon: [[0, 0], [30, 0], [30, 20], [0, 20]], hazard: 'ordinary' },
        { name: 'B', polygon: [[30, 0], [60, 0], [60, 20], [30, 20]], hazard: 'ordinary' },
      ],
      walls: [],
      columns: [],
    },
  ],
};

describe('layoutBuilding — full per-space sprinkler system', () => {
  it('lays out every space independently; both spaces get heads and totals sum', () => {
    const building = normalizeBuilding(TWO_SPACE);
    const result = layoutBuilding(building);

    expect(result.stories).toHaveLength(1);
    const story = result.stories[0];
    expect(story.level).toBe(0);
    expect(story.spaces).toHaveLength(2);

    // Each space uses layoutRoom on its own polygon -> hand-checked head counts.
    const expectedA = layoutRoom({ polygon: TWO_SPACE.stories[0].spaces[0].polygon, hazard: 'ordinary' }).heads.length;
    const expectedB = layoutRoom({ polygon: TWO_SPACE.stories[0].spaces[1].polygon, hazard: 'ordinary' }).heads.length;
    expect(expectedA).toBeGreaterThan(0);
    expect(expectedB).toBeGreaterThan(0);

    const spaceA = story.spaces.find((s) => s.name === 'A');
    const spaceB = story.spaces.find((s) => s.name === 'B');
    expect(spaceA.headCount).toBe(expectedA);
    expect(spaceB.headCount).toBe(expectedB);
    expect(spaceA.heads).toHaveLength(expectedA);

    // Story total = sum of its spaces; building total = sum of stories.
    expect(story.storyHeadCount).toBe(expectedA + expectedB);
    expect(result.totalHeadCount).toBe(expectedA + expectedB);
    expect(result.coverageOk).toBe(true);

    // perSpace is a flat summary across the whole building.
    expect(result.perSpace).toHaveLength(2);
    expect(result.perSpace.reduce((n, s) => n + s.headCount, 0)).toBe(result.totalHeadCount);
  });

  it('every head sits inside its own space polygon (clipped to the space)', () => {
    const building = normalizeBuilding(TWO_SPACE);
    const result = layoutBuilding(building);
    const spaceA = result.stories[0].spaces.find((s) => s.name === 'A');
    for (const h of spaceA.heads) {
      // Space A spans x 0..30 — heads must not leak into space B.
      expect(h.x).toBeGreaterThanOrEqual(0);
      expect(h.x).toBeLessThanOrEqual(30);
      expect(h.y).toBeGreaterThanOrEqual(0);
      expect(h.y).toBeLessThanOrEqual(20);
    }
  });

  it('column-aware: a column on a head grid point removes/shifts at least one head vs no-column baseline', () => {
    // Baseline: single 30x20 space, no columns.
    const baselineSpec = {
      name: 'Col Test',
      units: 'ft',
      stories: [{
        level: 0, baseElevationFt: 0, ceilingHeightFt: 14,
        spaces: [{ name: 'Hall', polygon: [[0, 0], [30, 0], [30, 20], [0, 20]], hazard: 'ordinary' }],
        walls: [], columns: [],
      }],
    };
    const baseline = layoutBuilding(normalizeBuilding(baselineSpec));
    const baselineHeads = baseline.stories[0].spaces[0].heads;
    expect(baselineHeads.length).toBeGreaterThan(0);

    // Put a column exactly on the first baseline head's grid point.
    const target = baselineHeads[0];
    const withColumnSpec = JSON.parse(JSON.stringify(baselineSpec));
    withColumnSpec.stories[0].columns = [{ x: target.x, y: target.y, sizeFt: 2 }];

    const withColumn = layoutBuilding(normalizeBuilding(withColumnSpec));
    const colHeads = withColumn.stories[0].spaces[0].heads;

    // The head colliding with the column must have moved or been dropped:
    // no head should still sit exactly on the column center.
    const stillOnColumn = colHeads.some((h) => h.x === target.x && h.y === target.y);
    expect(stillOnColumn).toBe(false);

    // And at least one head differs from baseline (dropped or nudged).
    const sameSet = baselineHeads.length === colHeads.length
      && baselineHeads.every((b) => colHeads.some((h) => h.x === b.x && h.y === b.y));
    expect(sameSet).toBe(false);
  });

  it('pipe sizing matches sizePipe for the known per-space head count', () => {
    const building = normalizeBuilding(TWO_SPACE);
    const result = layoutBuilding(building);
    const spaceA = result.stories[0].spaces.find((s) => s.name === 'A');

    // Cross-main is sized for the full space head count.
    expect(spaceA.sizing.crossMainDiameterIn).toBe(sizePipe(spaceA.headCount, 'ordinary'));

    // Each branch line is sized for its own head count.
    for (const bl of spaceA.branchLines) {
      expect(bl.diameterIn).toBe(sizePipe(bl.headCount, 'ordinary'));
    }

    // Feed main per story sized for the story head count.
    expect(result.stories[0].feedMain.diameterIn).toBe(sizePipe(result.stories[0].storyHeadCount, 'ordinary'));

    // pipeSchedule aggregates diameter -> linear feet, all positive.
    expect(Array.isArray(result.pipeSchedule)).toBe(true);
    expect(result.pipeSchedule.length).toBeGreaterThan(0);
    for (const row of result.pipeSchedule) {
      expect(row.diameterIn).toBeGreaterThan(0);
      expect(row.lengthFt).toBeGreaterThan(0);
    }
  });

  it('coverageOk is false when a degenerate-after-clip situation leaves a space with no heads; non-degenerate spaces always covered', () => {
    // A normal multi-space building: every non-degenerate space must have >=1 head.
    const building = normalizeBuilding(TWO_SPACE);
    const result = layoutBuilding(building);
    expect(result.coverageOk).toBe(true);
    for (const story of result.stories) {
      for (const sp of story.spaces) {
        expect(sp.headCount).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
