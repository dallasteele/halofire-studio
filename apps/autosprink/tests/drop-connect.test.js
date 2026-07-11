import { describe, expect, it } from 'vitest';
import { buildRoomCad } from '../src/engine/cad-model.js';
import { analyzeDrops, buildDropConnections } from '../src/engine/drop-connect.js';

const model = (solids) => ({ solids });
const pipe = (from, to, diameterIn = 1.25, extra = {}) => ({ kind: 'pipe', from, to, diameterIn, ...extra });
const head = (position, name, extra = {}) => ({ kind: 'head', position, name, ...extra });

const Z = 12;     // branch elevation
const HZ = 9.5;   // pendent head elevation (below branch)
const UZ = 14.0;  // upright head elevation (above branch)

// A branch line along X at z=Z with a single head. The head's xy + z determine
// what connection it needs.
function oneBranch(headPos, headExtra = {}) {
  return model([
    pipe([0, 0, 0], [0, 0, Z], 2.0, { name: 'riser' }),
    pipe([0, 0, Z], [40, 0, Z], 1.5, { name: 'branch', role: 'branch' }),
    head(headPos, 'h1', headExtra),
  ]);
}

describe('drop-connect — analyze (classification, read-only)', () => {
  it('classifies an existing in-line DROP (vertical, head below branch)', () => {
    const m = model([
      pipe([0, 0, Z], [40, 0, Z], 1.5, { name: 'branch', role: 'branch' }),
      pipe([20, 0, Z], [20, 0, HZ], 1.0, { name: 'drop', role: 'drop' }),
      head([20, 0, HZ], 'h'),
    ]);
    const a = analyzeDrops(m);
    expect(a.drops).toBe(1);
    expect(a.sprigs).toBe(0);
    expect(a.armOvers).toBe(0);
    expect(a.headsConnected).toBe(1);
  });

  it('classifies an existing SPRIG (vertical, head above branch)', () => {
    const m = model([
      pipe([0, 0, Z], [40, 0, Z], 1.5, { name: 'branch', role: 'branch' }),
      pipe([20, 0, Z], [20, 0, UZ], 1.0, { name: 'sprig' }),
      head([20, 0, UZ], 'h', { orientation: 'upright' }),
    ]);
    const a = analyzeDrops(m);
    expect(a.sprigs).toBe(1);
    expect(a.drops).toBe(0);
    expect(a.headsConnected).toBe(1);
  });

  it('classifies an existing ARM-OVER (offset head: horizontal leg + drop nipple)', () => {
    // head offset +4ft in Y from the branch axis: arm-over Y, then drop Z.
    const m = model([
      pipe([0, 0, Z], [40, 0, Z], 1.5, { name: 'branch', role: 'branch' }),
      pipe([20, 0, Z], [20, 4, Z], 1.25, { name: 'armover', connKind: 'arm-over' }),
      pipe([20, 4, Z], [20, 4, HZ], 1.0, { name: 'nipple', connKind: 'drop' }),
      head([20, 4, HZ], 'h'),
    ]);
    const a = analyzeDrops(m);
    expect(a.armOvers).toBe(1);
    expect(a.drops).toBe(1);
    expect(a.headsConnected).toBe(1);
  });

  it('flags a head needing an arm-over when it is laterally offset and unconnected', () => {
    const m = oneBranch([20, 5, HZ]); // 5ft off the branch axis, below, no connection
    const a = analyzeDrops(m);
    expect(a.headsConnected).toBe(0);
    expect(a.needArmOver).toBe(1);
    expect(a.needDrop).toBe(1);
    expect(a.needSprig).toBe(0);
    const ph = a.perHead.find((p) => p.name === 'h1');
    expect(ph.armOver).toBe(true);
    expect(ph.type).toBe('drop');
    expect(ph.offset).toBeCloseTo(5, 3);
  });

  it('flags a head needing a straight drop (in-line, below) with NO arm-over', () => {
    const a = analyzeDrops(oneBranch([20, 0, HZ]));
    expect(a.needArmOver).toBe(0);
    expect(a.needDrop).toBe(1);
    const ph = a.perHead[0];
    expect(ph.armOver).toBe(false);
    expect(ph.type).toBe('drop');
  });

  it('flags a head needing a sprig (in-line, above)', () => {
    const a = analyzeDrops(oneBranch([20, 0, UZ], { orientation: 'upright' }));
    expect(a.needSprig).toBe(1);
    expect(a.needDrop).toBe(0);
    expect(a.perHead[0].type).toBe('sprig');
  });
});

describe('drop-connect — build (synthesize missing connections)', () => {
  it('builds an ARM-OVER + drop nipple + elbows/reducer for an offset head', () => {
    const m = oneBranch([20, 5, HZ]);
    const r = buildDropConnections(m);
    expect(r.armOversAdded).toBe(1);
    expect(r.dropsAdded).toBe(1);
    expect(r.sprigsAdded).toBe(0);
    // the arm-over runs along Y from the branch axis (y=0) to the head column (y=5)
    const arm = r.added.find((s) => s.connKind === 'arm-over');
    expect(arm).toBeTruthy();
    expect(arm.from[1]).toBeCloseTo(0, 3);
    expect(arm.to[1]).toBeCloseTo(5, 3);
    expect(arm.from[2]).toBeCloseTo(Z, 3);
    expect(arm.to[2]).toBeCloseTo(Z, 3);
    // The nipple stops at the reducer's pipe port; the reducer then reaches the head.
    const nip = r.added.find((s) => s.connKind === 'drop');
    const reducer = r.added.find((s) => s.componentKey === 'fitting_reducer');
    expect(nip.from[2]).toBeCloseTo(Z, 3);
    expect(nip.to).toEqual(reducer.pipePort);
    expect(reducer.headPort[2]).toBeCloseTo(HZ, 3);
    // fitting markers present
    expect(r.added.some((s) => s.componentKey === 'fitting_elbow_90')).toBe(true);
    expect(r.added.some((s) => s.componentKey === 'fitting_reducer')).toBe(true);
    // re-analysis sees the new arm-over + drop and the head is now connected
    expect(r.analysisAfter.armOvers).toBe(1);
    expect(r.analysisAfter.drops).toBe(1);
    expect(r.analysisAfter.headsConnected).toBe(1);
  });

  it('builds a straight DROP (no arm-over) for an in-line head below the branch', () => {
    const m = oneBranch([20, 0, HZ]);
    const r = buildDropConnections(m);
    expect(r.armOversAdded).toBe(0);
    expect(r.dropsAdded).toBe(1);
    const nip = r.added.find((s) => s.connKind === 'drop');
    const reducer = r.added.find((s) => s.componentKey === 'fitting_reducer');
    expect(nip.from).toEqual([20, 0, Z]);
    expect(nip.to).toEqual(reducer.pipePort);
    expect(reducer.headPort).toEqual([20, 0, HZ]);
    expect(r.analysisAfter.headsConnected).toBe(1);
  });

  it('builds a SPRIG (up) for an in-line head above the branch', () => {
    const m = oneBranch([20, 0, UZ], { orientation: 'upright' });
    const r = buildDropConnections(m);
    expect(r.sprigsAdded).toBe(1);
    expect(r.dropsAdded).toBe(0);
    const nip = r.added.find((s) => s.connKind === 'sprig');
    const reducer = r.added.find((s) => s.componentKey === 'fitting_reducer');
    expect(nip.to).toEqual(reducer.pipePort);
    expect(reducer.headPort[2]).toBeCloseTo(UZ, 3);
    expect(r.analysisAfter.sprigs).toBe(1);
  });

  it('builds an arm-over + SPRIG for an offset head above the branch', () => {
    const m = oneBranch([20, 6, UZ], { orientation: 'upright' });
    const r = buildDropConnections(m);
    expect(r.armOversAdded).toBe(1);
    expect(r.sprigsAdded).toBe(1);
    const nip = r.added.find((s) => s.connKind === 'sprig');
    const reducer = r.added.find((s) => s.componentKey === 'fitting_reducer');
    expect(nip.from[2]).toBeCloseTo(Z, 3);
    expect(nip.to).toEqual(reducer.pipePort);
    expect(reducer.headPort[2]).toBeCloseTo(UZ, 3);
  });

  it('is idempotent: a head that already has a connection gets nothing added', () => {
    const m = model([
      pipe([0, 0, Z], [40, 0, Z], 1.5, { name: 'branch', role: 'branch' }),
      pipe([20, 0, Z], [20, 0, HZ], 1.0, { name: 'drop', role: 'drop' }),
      head([20, 0, HZ], 'h'),
    ]);
    const r = buildDropConnections(m);
    expect(r.added.length).toBe(0);
    expect(r.armOversAdded).toBe(0);
    // a second pass also adds nothing
    const r2 = buildDropConnections(r.model);
    expect(r2.added.length).toBe(0);
  });

  it('connects MANY offset heads in one pass', () => {
    const solids = [
      pipe([0, 0, 0], [0, 0, Z], 2.0, { name: 'riser' }),
      pipe([0, 0, Z], [60, 0, Z], 1.5, { name: 'branch', role: 'branch' }),
    ];
    for (let i = 1; i <= 5; i += 1) solids.push(head([i * 10, 3, HZ], `h${i}`)); // all offset +3
    const m = model(solids);
    const r = buildDropConnections(m);
    expect(r.armOversAdded).toBe(5);
    expect(r.dropsAdded).toBe(5);
    expect(r.analysisAfter.headsConnected).toBe(5);
    expect(r.analysisAfter.headsNeedingWork).toBe(0);
  });
});

describe('drop-connect — golden generated model', () => {
  const room = { name: 'Bay', polygon: [[0, 0], [80, 0], [80, 60], [0, 60]], hazard: 'ordinary', ceilingHeightFt: 16 };

  it('every generated head already has a drop connection (build is a no-op)', () => {
    const cad = buildRoomCad(room);
    const before = analyzeDrops(cad);
    expect(before.totalHeads).toBeGreaterThan(0);
    expect(before.headsConnected).toBe(before.totalHeads);
    expect(before.drops).toBeGreaterThan(0); // generated heads hang on real drops
    const r = buildDropConnections(buildRoomCad(room));
    expect(r.added.length).toBe(0); // idempotent on a complete generated model
  });
});

describe('drop-connect — guards', () => {
  it('handles empty / headless / branchless models without throwing', () => {
    expect(analyzeDrops({ solids: [] }).totalHeads).toBe(0);
    expect(analyzeDrops({ solids: [head([0, 0, 0], 'h')] }).totalHeads).toBe(1);
    const r = buildDropConnections({ solids: [] });
    expect(r.added.length).toBe(0);
    // a head with no branch in reach is left for branch-connect (no connection built)
    const r2 = buildDropConnections({ solids: [head([0, 0, 9], 'far')] });
    expect(r2.added.length).toBe(0);
  });
});
