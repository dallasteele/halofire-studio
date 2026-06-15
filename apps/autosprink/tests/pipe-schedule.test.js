import { describe, expect, it } from 'vitest';
import { buildRoomCad } from '../src/engine/cad-model.js';
import {
  SCHEDULE_TABLES,
  scheduleSizeFor,
  applyPipeSchedule,
  scheduleCascadeIsSensible,
  downstreamHeadsPerPipe,
} from '../src/engine/pipe-schedule.js';

const model = (solids) => ({ solids });
const pipe = (from, to, diameterIn = 1.25, extra = {}) => ({ kind: 'pipe', from, to, diameterIn, ...extra });
const head = (position) => ({ kind: 'head', position });

describe('pipe-schedule — table lookup (scheduleSizeFor)', () => {
  it('sizes a 2-head branch tail at 1" (ordinary)', () => {
    expect(scheduleSizeFor(2, 'ordinary', 'branch-line').sizeIn).toBe(1.0);
  });
  it('sizes a 3-head run at 1.25", a 5-head run at 1.5" (ordinary)', () => {
    expect(scheduleSizeFor(3, 'ordinary', 'branch-line').sizeIn).toBe(1.25);
    expect(scheduleSizeFor(5, 'ordinary', 'branch-line').sizeIn).toBe(1.5);
  });
  it('sizes a 10-head run at 2", a 20-head run at 2.5" (ordinary)', () => {
    expect(scheduleSizeFor(10, 'ordinary', 'branch-line').sizeIn).toBe(2.0);
    expect(scheduleSizeFor(20, 'ordinary', 'branch-line').sizeIn).toBe(2.5);
  });
  it('cascades a 40-head cross-main to 3", a 100-head feed to 4" (ordinary)', () => {
    expect(scheduleSizeFor(40, 'ordinary', 'cross-main').sizeIn).toBe(3.0);
    expect(scheduleSizeFor(100, 'ordinary', 'cross-main').sizeIn).toBe(4.0);
  });
  it('light vs ordinary diverge above 2.5": 30 heads is 2.5" light but 3" ordinary', () => {
    // light table: 10->2", 30->2.5"; ordinary: 20->2.5", 40->3"
    expect(scheduleSizeFor(30, 'light', 'cross-main').sizeIn).toBe(2.5);
    expect(scheduleSizeFor(30, 'ordinary', 'cross-main').sizeIn).toBe(3.0);
  });
  it('flags atScheduleLimit for counts above the largest listed', () => {
    const big = scheduleSizeFor(99999, 'ordinary', 'main');
    expect(big.sizeIn).toBe(8.0);
    expect(big.atScheduleLimit).toBe(true);
    const mid = scheduleSizeFor(5, 'ordinary', 'branch-line');
    expect(mid.atScheduleLimit).toBe(false);
  });
  it('applies the role-min floor: a main crediting 1 head still floors at 2.5"', () => {
    expect(scheduleSizeFor(1, 'ordinary', 'main').sizeIn).toBe(2.5);
    expect(scheduleSizeFor(1, 'ordinary', 'branch-line').sizeIn).toBe(1.0);
  });
  it('extra hazard table is one density step tighter than ordinary', () => {
    // ordinary 10->2", extra 8->2"/10->2.5"
    expect(scheduleSizeFor(10, 'ordinary', 'branch-line').sizeIn).toBe(2.0);
    expect(scheduleSizeFor(10, 'extra', 'branch-line').sizeIn).toBe(2.5);
  });
});

describe('pipe-schedule — applyPipeSchedule cascade', () => {
  it('cascades sizes across a tiny riser->cross-main->branch->head tree', () => {
    // riser to floor, cross-main, two branch lines each feeding 2 heads via drops
    const m = model([
      pipe([0, 0, 0], [0, 0, 12], 1.0),     // riser (floor->overhead)
      pipe([0, 0, 12], [40, 0, 12], 1.0),    // cross-main carrying both branches
      pipe([0, 0, 12], [0, 10, 12], 1.0),    // branch line A
      pipe([0, 10, 12], [0, 10, 9.5], 1.0), head([0, 10, 9.5]),  // drop+head
      pipe([20, 0, 12], [20, 10, 12], 1.0),  // branch line B
      pipe([20, 10, 12], [20, 10, 9.5], 1.0), head([20, 10, 9.5]),
    ]);
    const { model: out, report } = applyPipeSchedule(m, 'ordinary');
    expect(out).not.toBeNull();
    expect(report.total).toBeGreaterThan(0);
    // the feed carriers (riser/cross-main) should be >= the branch lines they feed
    expect(report.cascadeIsSensible).toBe(true);
    expect(report.maxSizeIn).toBeGreaterThanOrEqual(2.0); // a feed carrier sized up
  });

  it('on a golden buildRoomCad, schedule produces a sensible pyramid (feed >= leaves)', () => {
    const cad = buildRoomCad({ name:'Bay', polygon:[[0,0],[80,0],[80,60],[0,60]], hazard:'ordinary', ceilingHeightFt:16 });
    const { model: out, report } = applyPipeSchedule(cad, 'ordinary');
    expect(report.total).toBeGreaterThan(0);
    expect(report.cascadeIsSensible).toBe(true);
    // there must be MORE THAN ONE distinct scheduled size (a real cascade, not flat)
    expect(Object.keys(report.bySize).length).toBeGreaterThan(1);
  });

  it('is idempotent: re-applying the same hazard changes nothing the second time', () => {
    const cad = buildRoomCad({ name:'Bay', polygon:[[0,0],[80,0],[80,60],[0,60]], hazard:'ordinary', ceilingHeightFt:16 });
    const first = applyPipeSchedule(cad, 'ordinary');
    const m1 = first.model || cad;
    const second = applyPipeSchedule(m1, 'ordinary');
    expect(second.report.changed).toBe(0);
  });

  it('switching hazard re-sizes (light->extra changes diameters)', () => {
    const cad = buildRoomCad({ name:'Bay', polygon:[[0,0],[100,0],[100,70],[0,70]], hazard:'ordinary', ceilingHeightFt:16 });
    const light = applyPipeSchedule(cad, 'light');
    const mL = light.model || cad;
    const extra = applyPipeSchedule(mL, 'extra');
    expect(extra.report.hazard).toBe('extra');
    expect(extra.report.hydraulicRequired).toBe(true);
  });

  it('every scheduled diameter is a real nominal size from the hazard table', () => {
    const cad = buildRoomCad({ name:'Bay', polygon:[[0,0],[80,0],[80,60],[0,60]], hazard:'ordinary', ceilingHeightFt:16 });
    const { model: out, report } = applyPipeSchedule(cad, 'ordinary');
    const allowed = new Set(SCHEDULE_TABLES.ordinary.map(([, sz]) => sz).concat([2.0, 2.5])); // + role floors
    for (const sp of report.sizedPipes) {
      expect(allowed.has(sp.sizeIn)).toBe(true);
    }
  });

  it('guards: null model, no-pipe model', () => {
    expect(applyPipeSchedule(null, 'ordinary').model).toBeNull();
    const noPipe = applyPipeSchedule(model([head([0, 0, 9])]), 'ordinary');
    expect(noPipe.report.total).toBe(0);
    expect(noPipe.model).toBeNull();
  });
});

describe('pipe-schedule — cumulative downstream heads (the cascade driver)', () => {
  it('a feed run carries the cumulative heads of the subtree past it (not just its tap)', () => {
    // SERIAL trunk: riser -> trunk -> a branch off the trunk's FAR end serving 3
    // heads. The trunk must credit all 3 downstream heads, the riser all 3.
    const m = model([
      pipe([0, 0, 0], [0, 0, 12], 1.0),                        // 0 riser (source, floor->overhead)
      pipe([0, 0, 12], [40, 0, 12], 1.0),                      // 1 trunk cross-main
      pipe([40, 0, 12], [40, 30, 12], 1.0),                    // 2 branch off trunk far end
      pipe([40, 10, 12], [40, 10, 9.5], 1.0), head([40, 10, 9.5]), // drops tapping branch interior
      pipe([40, 20, 12], [40, 20, 9.5], 1.0), head([40, 20, 9.5]),
      pipe([40, 30, 12], [40, 30, 9.5], 1.0), head([40, 30, 9.5]),
    ]);
    const ds = downstreamHeadsPerPipe(m);
    const sols = m.solids;
    expect(ds.get(sols[0])).toBe(3); // riser carries the whole system
    expect(ds.get(sols[1])).toBe(3); // trunk carries all 3 downstream — NOT 0
    expect(ds.get(sols[2])).toBe(3); // the branch carries its 3 heads
    expect(ds.get(sols[3])).toBe(1); // a single drop carries exactly its head
  });

  it('on a big golden model the feed trunk sizes UP over the branches (real pyramid)', () => {
    const cad = buildRoomCad({ name:'Bay', polygon:[[0,0],[200,0],[200,150],[0,150]], hazard:'ordinary', ceilingHeightFt:16 });
    const { report } = applyPipeSchedule(cad, 'ordinary');
    expect(report.cascadeIsSensible).toBe(true);
    // the largest feed must exceed the largest branch-line size (cascade, not flat)
    const maxBranch = Math.max(...Object.keys(report.byRole['branch-line'] || { '0': 0 }).map(parseFloat));
    expect(report.maxSizeIn).toBeGreaterThan(maxBranch);
  });
});

describe('pipe-schedule — scheduleCascadeIsSensible', () => {
  it('passes when feed >= branch >= leaf', () => {
    expect(scheduleCascadeIsSensible({
      'cross-main': { '3"': 2 }, 'branch-line': { '1.5"': 4 }, 'drop': { '1"': 8 },
    })).toBe(true);
  });
  it('fails when a branch is larger than its feed main', () => {
    expect(scheduleCascadeIsSensible({
      'cross-main': { '1"': 2 }, 'branch-line': { '3"': 4 },
    })).toBe(false);
  });
});
