import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluatePolarisManufacturerDimensionSchedule,
  verifyPolarisManufacturerDimensionAdversarialLoop,
} from '../src/engine/polaris-manufacturer-dimension-schedule.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const schedule = read('polaris-victaulic-primary-dimensions.json');
const calibration = read('polaris-pitched-pipe-xyz-calibration.json');

describe('Polaris primary manufacturer dimension schedule', () => {
  it('binds official dimensions for 22 identified Victaulic fittings without claiming applied takeout', () => {
    const result = evaluatePolarisManufacturerDimensionSchedule(schedule, calibration);
    expect(result.status).toBe('passed');
    expect(result.metrics).toEqual({
      rigidFittingCount: 28,
      identifiedVictaulicInstanceCount: 22,
      genericUnresolvedInstanceCount: 6,
      primaryDimensionRecordCount: 9,
    });
    expect(result.primaryDimensionScheduleReady).toBe(true);
    expect(result.sourceInsertOriginToPortOffsetReady).toBe(false);
    expect(result.manufacturerExactTakeoutReady).toBe(false);
    expect(result.properPipeLayoutReady).toBe(false);
    expect(result.fabricationReady).toBe(false);
  });

  it('keeps coupling layout separation distinct from center-to-end takeout', () => {
    const coupling = schedule.dimensions.find((entry) => entry.id === 'style009n-3');
    const elbow = schedule.dimensions.find((entry) => entry.id === 'no001-3');
    expect(coupling).toMatchObject({
      dimensionKind: 'layout-separation-and-envelope',
      allowablePipeEndSeparationInches: 0.12,
    });
    expect(coupling.valueInches).toBeUndefined();
    expect(elbow).toMatchObject({ dimensionKind: 'center-to-end', valueInches: 3.38 });
  });

  it('rejects source, value, tally, envelope, takeout, and layout promotion attacks', () => {
    const loop = verifyPolarisManufacturerDimensionAdversarialLoop(schedule, calibration);
    expect(loop.status).toBe('passed');
    expect(loop.rejectedCases).toHaveLength(6);
    expect(loop.rejectedCases.every((entry) => entry.rejected)).toBe(true);
  });
});
