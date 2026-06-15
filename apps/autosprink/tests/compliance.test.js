import { describe, it, expect } from 'vitest';
import C, { designBasis, coverage, pipeScheduleMax, fittingLe, hazardForOccupancy, flowingHeadCount, minHeadFlowGpm, complianceMeta } from '../src/engine/compliance.js';

describe('NFPA-13 compliance knowledge base', () => {
  it('carries the engineering-reference disclaimer + free-access legal note', () => {
    const m = complianceMeta();
    expect(m.disclaimer).toMatch(/NOT a substitute/i);
    expect(m.legal).toMatch(/nfpa\.org/i);          // points to the legitimate free-access source
    expect(m.legal).toMatch(/does NOT reproduce/i); // explicit: no copied standard text
  });

  it('density/area design basis by hazard', () => {
    expect(designBasis('light').densityGpmFt2).toBe(0.10);
    expect(designBasis('ordinary_1').densityGpmFt2).toBe(0.15);
    expect(designBasis('ordinary_2').densityGpmFt2).toBe(0.20);
    expect(designBasis('extra_1').densityGpmFt2).toBe(0.30);
    expect(designBasis('extra_2').densityGpmFt2).toBe(0.40);
  });

  it('max coverage + spacing by hazard (standard spray)', () => {
    expect(coverage('light').maxAreaFt2).toBe(225);
    expect(coverage('ordinary_1').maxAreaFt2).toBe(130);
    expect(coverage('extra_1').maxAreaFt2).toBe(100);
    expect(coverage('light').maxSpacingFt).toBe(15);
    expect(coverage('extra_1').maxSpacingFt).toBe(12);
    expect(coverage('light').minSpacingFt).toBe(6);
  });

  it('pipe schedule (light/ordinary); extra hazard -> null (hydraulic required)', () => {
    expect(pipeScheduleMax('light', 2)).toBe(10);
    expect(pipeScheduleMax('ordinary_1', 2.5)).toBe(20);
    expect(pipeScheduleMax('ordinary_1', 4)).toBe(100);
    expect(pipeScheduleMax('extra_1', 2)).toBeNull();
  });

  it('fitting equivalent length with C-factor correction', () => {
    expect(fittingLe('elbow_90', 2, 120)).toBe(5);       // base C=120
    expect(fittingLe('tee_branch', 2, 120)).toBe(10);
    // C=100 correction: 5 * (100/120)^1.85 ≈ 3.57
    expect(fittingLe('elbow_90', 2, 100)).toBeCloseTo(3.57, 1);
  });

  it('occupancy -> hazard classification (best-effort)', () => {
    expect(hazardForOccupancy('corporate offices')).toBe('light');
    expect(hazardForOccupancy('retail mercantile store')).toBe('ordinary_2');
  });

  it('derives design head count + min head flow (drives bid accuracy)', () => {
    // light: 1500 ft^2 / 225 ft^2 per head -> 7 heads worst case
    expect(flowingHeadCount('light')).toBe(7);
    // light min head flow = 0.10 gpm/ft^2 * 225 ft^2 = 22.5 gpm
    expect(minHeadFlowGpm('light')).toBe(22.5);
    // ordinary_1 = 0.15 * 130 = 19.5 gpm
    expect(minHeadFlowGpm('ordinary_1')).toBe(19.5);
  });
});
