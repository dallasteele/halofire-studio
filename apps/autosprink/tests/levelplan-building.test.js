import { describe, expect, it } from 'vitest';
import { buildingFromLevelPlans } from '../src/engine/levelplan-building.js';

describe('buildingFromLevelPlans', () => {
  it('converts extracted level-plan geometry into the existing building schema', () => {
    const { building, summary } = buildingFromLevelPlans([{
      level: 2,
      elevationFt: 12,
      plan: {
        scaleFtPerUnit: 0.15,
        footprintFt: [[0, 0], [40, 0], [40, 20], [0, 20]],
        wallRuns: [
          { a: [0, 0], b: [40, 0] },
          { a: [40, 0], b: [40, 20] },
          { a: [40, 20], b: [0, 20] },
          { a: [0, 20], b: [0, 0] },
          { a: [20, 0], b: [20, 20] },
        ],
        rooms: [
          { poly: [[0, 0], [20, 0], [20, 20], [0, 20]], label: 'West' },
          { poly: [[20, 0], [40, 0], [40, 20], [20, 20]], label: 'East' },
        ],
        doors: [{ position: [20, 10], width: 3, hostWall: 4 }],
        openings: [{ position: [40, 10], width: 4 }],
        columns: [{ x: 10, y: 10, sizeFt: 2 }],
      },
    }], { name: 'Adapter Test', source: 'vector' });

    expect(building.name).toBe('Adapter Test');
    expect(building.stories).toHaveLength(1);
    expect(building.stories[0].level).toBe(2);
    expect(building.stories[0].baseElevationFt).toBe(12);
    expect(building.stories[0].spaces).toHaveLength(2);
    expect(building.stories[0].columns).toHaveLength(1);
    expect(building.stories[0].walls.some((wall) => wall.type === 'exterior')).toBe(true);
    expect(building.stories[0].walls.some((wall) => wall.type === 'interior')).toBe(true);
    expect(building.stories[0].walls.reduce((n, wall) => n + wall.openings.length, 0)).toBe(2);

    expect(summary.source).toBe('vector');
    expect(summary.levels).toBe(1);
    expect(summary.walls).toBe(5);
    expect(summary.openings).toBe(2);
    expect(summary.columns).toBe(1);
    expect(summary.spaces).toBe(2);
    expect(summary.scaleFtPerUnit).toBe(0.15);
  });
});
