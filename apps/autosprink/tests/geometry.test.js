import { describe, expect, it } from 'vitest';
import { buildScene } from '../src/engine/geometry.js';
import { generateSprinklerBid } from '../src/engine/sprinkler-layout.js';
import { homeDepotRexburgFloorPlan } from '../src/data/floorplans.js';

describe('buildScene', () => {
  const plan = {
    name: 'Box',
    units: 'ft',
    rooms: [{ name: 'Room', polygon: [[0, 0], [20, 0], [20, 10], [0, 10]], ceilingHeightFt: 12 }],
  };

  it('builds one wall per polygon edge and a floor per room', () => {
    const scene = buildScene(plan);
    expect(scene.walls).toHaveLength(4);
    expect(scene.floors).toHaveLength(1);
    expect(scene.bounds).toMatchObject({ minX: 0, maxX: 20, minZ: 0, maxZ: 10 });
    // Walls are centered at half ceiling height on +Y.
    expect(scene.walls[0].center[1]).toBe(6);
  });

  it('places head + pipe geometry when a bid is supplied', () => {
    const bid = generateSprinklerBid(plan);
    const scene = buildScene(plan, bid);
    expect(scene.heads.length).toBe(bid.totalHeadCount);
    expect(scene.heads[0].position).toHaveLength(3);
    expect(scene.pipes.length).toBeGreaterThan(0);
  });

  it('renders the Home Depot Rexburg fixture deterministically', () => {
    const plan2 = homeDepotRexburgFloorPlan();
    const bid = generateSprinklerBid(plan2);
    const a = buildScene(plan2, bid);
    const b = buildScene(plan2, bid);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.walls).toHaveLength(4);
    expect(a.heads.length).toBe(bid.totalHeadCount);
    expect(bid.totalAreaSqFt).toBe(121500);
  });

  it('rejects an empty plan', () => {
    expect(() => buildScene({ name: 'x', rooms: [] })).toThrow(/non-empty/);
  });
});
