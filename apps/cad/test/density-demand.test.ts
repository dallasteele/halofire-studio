// W2A density-demand — NFPA-13 density/area per-head demand floor.

import { describe, expect, it } from 'vitest';
import {
  DESIGN_DENSITY_GPM_SQFT,
  MIN_REMOTE_AREA_SQFT,
  PER_HEAD_AREA_SQFT,
  densityFloorGpm,
  effectiveHeadDemand,
  pressureForFlow,
  type HazardClass,
} from '../src/lib/density-demand';

const HAZARDS: HazardClass[] = ['LIGHT', 'ORDINARY_1', 'ORDINARY_2', 'EXTRA_1', 'EXTRA_2'];

describe('cited constants', () => {
  it('every cited number carries the edition caveat', () => {
    for (const tbl of [DESIGN_DENSITY_GPM_SQFT, PER_HEAD_AREA_SQFT, MIN_REMOTE_AREA_SQFT]) {
      for (const h of HAZARDS) {
        expect(tbl[h].citation).toContain('Verify adopted edition');
        expect(tbl[h].value).toBeGreaterThan(0);
      }
    }
  });
  it('values match the spec', () => {
    expect(DESIGN_DENSITY_GPM_SQFT.ORDINARY_1.value).toBe(0.15);
    expect(PER_HEAD_AREA_SQFT.LIGHT.value).toBe(225);
    expect(MIN_REMOTE_AREA_SQFT.EXTRA_1.value).toBe(2500);
  });
});

describe('densityFloorGpm', () => {
  it('density × per-head area', () => {
    expect(densityFloorGpm('ORDINARY_1')).toBeCloseTo(19.5, 6); // 0.15*130
    expect(densityFloorGpm('LIGHT')).toBeCloseTo(22.5, 6); // 0.10*225
  });
  it('override scales linearly', () => {
    expect(densityFloorGpm('ORDINARY_1', 100)).toBeCloseTo(15, 6); // 0.15*100
  });
  it('throws on bad override', () => {
    expect(() => densityFloorGpm('LIGHT', 0)).toThrow();
    expect(() => densityFloorGpm('LIGHT', -5)).toThrow();
    expect(() => densityFloorGpm('LIGHT', Number.NaN)).toThrow();
  });
});

describe('pressureForFlow', () => {
  it('(Q/K)^2', () => {
    expect(pressureForFlow(28, 5.6)).toBeCloseTo(25, 9);
  });
  it('throws on K<=0 or Q<0', () => {
    expect(() => pressureForFlow(10, 0)).toThrow();
    expect(() => pressureForFlow(-1, 5.6)).toThrow();
  });
});

describe('effectiveHeadDemand — greater of min-pressure vs density floor', () => {
  it('ORDINARY_1 K=5.6 @ 7psi → density floor governs', () => {
    const d = effectiveHeadDemand(5.6, 7, 'ORDINARY_1');
    expect(d.governedBy).toBe('density-floor');
    expect(d.flowGpm).toBeCloseTo(19.5, 4);
    expect(d.pressurePsi).toBeCloseTo(12.1249, 3); // (19.5/5.6)^2
    expect(d.citation).toContain('Verify adopted edition');
  });
  it('LIGHT K=5.6 @ 7psi → density floor governs (qFloor 22.5 > qMin 14.82)', () => {
    expect(effectiveHeadDemand(5.6, 7, 'LIGHT').governedBy).toBe('density-floor');
  });
  it('LIGHT K=8.0 @ 16psi → min-pressure governs (qMin 32 > 22.5)', () => {
    const d = effectiveHeadDemand(8.0, 16, 'LIGHT');
    expect(d.governedBy).toBe('min-pressure');
    expect(d.flowGpm).toBeCloseTo(32, 6);
    expect(d.pressurePsi).toBe(16);
  });
  it('throws on non-positive kFactor or minOperatingPsi', () => {
    expect(() => effectiveHeadDemand(0, 7, 'LIGHT')).toThrow();
    expect(() => effectiveHeadDemand(5.6, 0, 'LIGHT')).toThrow();
  });
});
