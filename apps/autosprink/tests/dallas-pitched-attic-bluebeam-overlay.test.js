import { describe, expect, it } from 'vitest';
import packet from '../src/data/dallas-pitched-attic-hydraulic-registration.json';
import { buildDallasPitchedAtticBluebeamOverlay, dallasPlanPointToFdf } from '../src/engine/dallas-pitched-attic-bluebeam-overlay.js';

describe('Dallas FP-1.4 Bluebeam overlay', () => {
  it('maps top-left plan coordinates into page-five FDF coordinates', () => {
    expect(dallasPlanPointToFdf([1489, 1049.25])).toEqual([1489, 1110.75]);
    expect(dallasPlanPointToFdf([0, 2160])).toEqual([0, 0]);
  });

  it('emits deterministic page-five A1-A9 and branch markups without promoting compliance', () => {
    const result = buildDallasPitchedAtticBluebeamOverlay(packet); const replay = buildDallasPitchedAtticBluebeamOverlay(packet);
    expect(result.status).toBe('passed');
    expect(result.buffer.subarray(0, 8).toString('ascii')).toBe('%FDF-1.2');
    expect(result.manifest).toMatchObject({ sheetId: 'FP-1.4', pageIndex: 4, annotationCount: 18, registeredHeadCount: 9, registeredPipeCount: 8, wholeBuildingLayoutReady: false, fabricationReady: false, complianceReady: false });
    const raw = result.buffer.toString('ascii');
    expect((raw.match(/\/Subj \(Registered operating sprinkler\)/g) || [])).toHaveLength(9);
    expect((raw.match(/\/Subj \(Registered 2 inch pitched-attic branch\)/g) || [])).toHaveLength(8);
    expect(raw).toContain('A1 / TYCO-TY3180-ATTIC-BB1 / EL 42 ft / K5.6');
    expect(raw).toContain('Not a generated whole-building layout, compliance approval, or fabrication release.');
    expect(replay.buffer.equals(result.buffer)).toBe(true);
  });

  it('rejects false compliance promotion', () => {
    expect(buildDallasPitchedAtticBluebeamOverlay({ ...packet, complianceReady: true }).status).toBe('blocked');
  });
});
