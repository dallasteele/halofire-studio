import { describe, expect, it } from 'vitest';
import { buildRoomCad } from '../src/engine/cad-model.js';
import {
  PIPE_ROLES,
  classifyPipes,
  tagPipeRoles,
  distributionIsSensible,
} from '../src/engine/smart-pipe.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

// Helper to build a minimal model from raw solids.
const model = (solids) => ({ solids });
const pipe = (from, to, diameterIn = 1.25, extra = {}) => ({ kind: 'pipe', from, to, diameterIn, ...extra });
const head = (position) => ({ kind: 'head', position });

describe('smart-pipe — role taxonomy', () => {
  it('exposes the AutoSPRINK role set', () => {
    expect(PIPE_ROLES).toEqual([
      'riser', 'main', 'cross-main', 'branch-line', 'arm-over', 'drop', 'sprig',
    ]);
  });
});

describe('smart-pipe — isolated topology fixtures', () => {
  it('classifies a vertical run reaching the floor as a riser', () => {
    const r = classifyPipes(model([
      pipe([0, 0, 0], [0, 0, 12], 3.0), // floor -> overhead = riser
      pipe([0, 0, 12], [40, 0, 12], 3.0), // long horizontal carrier
    ]));
    const roles = [...r.roles.values()];
    expect(roles).toContain('riser');
  });

  it('classifies a short vertical run DOWN to a pendent head as a drop', () => {
    const r = classifyPipes(model([
      pipe([10, 5, 12], [10, 5, 9.5], 1.0), // branch elev 12 -> head elev 9.5
      head([10, 5, 9.5]),
    ]));
    const dropPipe = r.pipes.find((p) => p.orientation === 'vertical');
    expect(dropPipe.role).toBe('drop');
  });

  it('classifies a short vertical run UP to an upright head as a sprig', () => {
    const r = classifyPipes(model([
      pipe([10, 5, 12], [10, 5, 13.5], 1.0), // branch elev 12 -> head ABOVE 13.5
      head([10, 5, 13.5]),
    ]));
    const sprig = r.pipes.find((p) => p.orientation === 'vertical');
    expect(sprig.role).toBe('sprig');
  });

  it('classifies a short horizontal leaf feeding ONE head as an arm-over', () => {
    const r = classifyPipes(model([
      // branch line along X with several heads
      pipe([0, 0, 12], [30, 0, 12], 1.25),
      // short horizontal offset off the branch end to a single head
      pipe([30, 0, 12], [32, 0, 12], 1.0),
      head([32, 0, 12]),
    ]));
    const armPipe = r.pipes.find((p) => p.length <= 3 && p.orientation === 'horizontal');
    expect(armPipe.role).toBe('arm-over');
  });

  it('classifies a horizontal run serving a row of heads as a branch-line', () => {
    const solids = [pipe([0, 0, 12], [40, 0, 12], 1.25)];
    // 5 drops + heads hanging off the branch
    for (let i = 1; i <= 5; i += 1) {
      const x = i * 6;
      solids.push(pipe([x, 0, 12], [x, 0, 9.5], 1.0));
      solids.push(head([x, 0, 9.5]));
    }
    const r = classifyPipes(model(solids));
    const branch = r.pipes.find((p) => p.orientation === 'horizontal' && p.length > 30);
    expect(branch.role).toBe('branch-line');
    expect(branch.headsServed).toBe(5);
  });

  it('classifies a horizontal run feeding multiple branch-lines as a cross-main', () => {
    const solids = [];
    // cross-main along Y feeding 4 branch lines along X
    solids.push(pipe([0, 0, 12], [0, 60, 12], 3.0)); // cross-main (Y axis)
    for (let b = 0; b < 4; b += 1) {
      const y = 10 + b * 12;
      solids.push(pipe([0, y, 12], [40, y, 12], 1.25)); // branch (X axis)
      // heads on each branch
      for (let i = 1; i <= 4; i += 1) {
        const x = i * 8;
        solids.push(pipe([x, y, 12], [x, y, 9.5], 1.0));
        solids.push(head([x, y, 9.5]));
      }
    }
    const r = classifyPipes(model(solids));
    const cm = r.pipes.find((p) => p.orientation === 'horizontal' && p.diameterIn === 3.0);
    expect(cm.role).toBe('cross-main');
  });
});

describe('smart-pipe — main emerges above multiple cross-mains', () => {
  it('classifies a feed trunk above 2 cross-mains as a main (3-tier tree)', () => {
    const sol = [];
    sol.push(pipe([0, 0, 18], [80, 0, 18], 6.0, { name: 'main' })); // main along X
    for (let c = 0; c < 2; c += 1) {
      const x = 20 + c * 40;
      sol.push(pipe([x, 0, 18], [x, 60, 18], 4.0, { name: `cm${c}` })); // cross-main along Y
      for (let b = 0; b < 3; b += 1) {
        const y = 10 + b * 18;
        sol.push(pipe([x, y, 18], [x + 18, y, 18], 1.5)); // branch along X
        for (let h = 1; h <= 3; h += 1) {
          const hx = x + h * 4;
          sol.push(pipe([hx, y, 18], [hx, y, 15], 1.0));
          sol.push(head([hx, y, 15]));
        }
      }
    }
    const r = classifyPipes(model(sol));
    expect(r.roles.get(sol[0])).toBe('main');
    expect(r.roleCounts.main).toBe(1);
    expect(r.roleCounts['cross-main']).toBe(2);
    expect(r.roleCounts['branch-line']).toBe(6);
    expect(r.roleCounts.drop).toBe(18);
    // pyramid: mains < cross-mains < branch-lines < drops
    expect(r.roleCounts.main).toBeLessThan(r.roleCounts['cross-main']);
    expect(r.roleCounts['cross-main']).toBeLessThan(r.roleCounts['branch-line']);
    expect(r.roleCounts['branch-line']).toBeLessThan(r.roleCounts.drop);
    expect(distributionIsSensible(r.roleCounts)).toBe(true);
  });
});

describe('smart-pipe — golden full model (buildRoomCad)', () => {
  const room = { name: 'Bay', polygon: rect(80, 60), hazard: 'ordinary', ceilingHeightFt: 16 };
  const cad = buildRoomCad(room);
  const result = classifyPipes(cad);

  it('classifies EVERY pipe (no unknowns)', () => {
    const pipeCount = cad.solids.filter((s) => s.kind === 'pipe').length;
    expect(result.pipes).toHaveLength(pipeCount);
    expect(result.unknownCount).toBe(0);
  });

  it('produces a SENSIBLE tree distribution (not all-one-role, not random)', () => {
    const rc = result.roleCounts;
    // there must be drops (one per head) and branch-lines and a cross-main/main
    expect(rc.drop).toBeGreaterThan(0);
    expect(rc['branch-line']).toBeGreaterThan(0);
    expect((rc['cross-main'] || 0) + (rc.main || 0)).toBeGreaterThan(0);
    // pyramid: head leaves are the most numerous tier; feed carriers a minority
    const leaves = rc.drop + (rc['arm-over'] || 0) + (rc.sprig || 0);
    const feed = (rc['cross-main'] || 0) + (rc.main || 0);
    expect(leaves).toBeGreaterThan(rc['branch-line']);
    expect(leaves).toBeGreaterThan(feed);
    expect(distributionIsSensible(rc)).toBe(true);
  });

  it('drops account for one head each (heads-served conservation)', () => {
    const headCount = cad.solids.filter((s) => s.kind === 'head').length;
    // every head is served by exactly one drop -> drop role serves headCount heads
    expect(result.headsServed.drop).toBe(headCount);
    // branch-lines collectively serve every head too (carrier credit)
    expect(result.headsServed['branch-line']).toBe(headCount);
  });

  it('does NOT collapse to a single role', () => {
    const distinct = PIPE_ROLES.filter((role) => (result.roleCounts[role] || 0) > 0);
    expect(distinct.length).toBeGreaterThanOrEqual(3);
  });
});

describe('smart-pipe — tagging + idempotence', () => {
  it('tagPipeRoles stamps solid.smartRole and is deterministic', () => {
    const room = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };
    const cad = buildRoomCad(room);
    const a = tagPipeRoles(cad);
    const b = classifyPipes(cad);
    // re-running yields identical counts (pure)
    expect(b.roleCounts).toEqual(a.roleCounts);
    const taggedPipes = cad.solids.filter((s) => s.kind === 'pipe' && typeof s.smartRole === 'string');
    expect(taggedPipes.length).toBe(cad.solids.filter((s) => s.kind === 'pipe').length);
    expect(PIPE_ROLES).toContain(taggedPipes[0].smartRole);
  });
});

describe('smart-pipe — guards', () => {
  it('handles an empty / pipe-less model without throwing', () => {
    expect(classifyPipes(model([])).unknownCount).toBe(0);
    expect(classifyPipes(model([head([0, 0, 0])])).pipes).toHaveLength(0);
    expect(distributionIsSensible({})).toBe(false);
  });
});
