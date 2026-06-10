// Hydraulics tab calculators — pure helpers behind HydraulicsPanel:
//   - buildReportInput maps the LIVE HydraulicsResult into the calc-summary
//     ReportInput (demand / supply / rows / citations / disclaimer) without
//     fabricating any number.
//   - safePipeVolumes is the fail-soft pipe-volume readout (odd kernel-imported
//     nominal sizes -> null, never a crash).
//
// HONESTY: assertions compare against the solver's ACTUAL returned values and
// the published-table volume formula — no hand-authored hydraulic numbers.

import { describe, expect, it } from 'vitest';
import type { Node, SprinklerNetwork } from '../src/lib/model';
import { solveHydraulics, type WaterSupply } from '../src/lib/hydraulics';
import { formatHydraulicReport, REPORT_HEADER } from '../src/lib/hydraulic-report';
import { buildReportInput, safePipeVolumes } from '../src/lib/report-from-result';
import {
  GALLONS_PER_CUBIC_FOOT,
  internalDiameterIn,
  pipeVolumes,
} from '../src/lib/pipe-volume';

/** Tiny synthetic routed network: riser SOURCE -> one head, one 2" steel run. */
function tinyNetwork(): SprinklerNetwork {
  const nodes: Node[] = [
    { id: 'src', type: 'SOURCE', pos: { x: 0, y: 10, z: 0 } },
    { id: 'h1', type: 'HEAD', pos: { x: 20, y: 10, z: 0 } },
  ];
  return {
    nodes,
    segments: [
      {
        id: 'p1',
        from: 'src',
        to: 'h1',
        diameterIn: 2,
        lengthFt: 20,
        role: 'BRANCH',
        material: 'STEEL_SCH40',
      },
    ],
    remoteAreas: [],
  };
}

const SUPPLY: WaterSupply = { staticPsi: 70, residualPsi: 55, flowGpm: 1000 };

describe('buildReportInput — HydraulicsResult -> ReportInput mapping', () => {
  it('maps demand, supply, rows, citations and disclaimer from the live result', () => {
    const result = solveHydraulics(tinyNetwork(), { hazard: 'LIGHT', supply: SUPPLY });
    const input = buildReportInput({
      projectName: 'Tiny',
      hazard: 'LIGHT',
      result,
      supply: SUPPLY,
    });

    // Demand maps from systemDemand (the solver's actual field names/values).
    expect(input.demandGpm).toBe(result.systemDemand.gpm);
    expect(input.demandPsiAtRiser).toBe(result.systemDemand.psiAtRiser);
    expect(input.demandGpm).toBeGreaterThan(0);

    // Supply maps the operator test + the result's supply-check fields.
    expect(input.supply).toBeDefined();
    expect(input.supply!.staticPsi).toBe(SUPPLY.staticPsi);
    expect(input.supply!.residualPsi).toBe(SUPPLY.residualPsi);
    expect(input.supply!.flowGpm).toBe(SUPPLY.flowGpm);
    expect(input.supply!.availablePsiAtDemand).toBe(result.supplyAtDemand.psi);
    expect(input.supply!.adequate).toBe(result.adequate);

    // Per-node / per-segment rows map 1:1.
    expect(input.nodes).toHaveLength(result.perNode.length);
    expect(input.segments).toHaveLength(result.perSegment.length);
    const seg = input.segments.find((s) => s.id === 'p1')!;
    const solverSeg = result.perSegment.find((s) => s.id === 'p1')!;
    expect(seg.flowGpm).toBe(solverSeg.flowGpm);
    expect(seg.frictionPsi).toBe(solverSeg.frictionPsi);
    expect(seg.velocityFps).toBe(solverSeg.velocityFps);

    // Citations are non-empty and include Hazen-Williams; disclaimer non-empty.
    expect(input.citations.length).toBeGreaterThan(0);
    expect(input.citations.some((c) => c.includes('Hazen-Williams'))).toBe(true);
    expect(input.citations.every((c) => c.length > 0)).toBe(true);
    expect(input.disclaimer.length).toBeGreaterThan(0);
    expect(input.disclaimer).toBe(result.disclaimer);

    // The formatter's fail-closed gates accept it.
    const text = formatHydraulicReport(input);
    expect(text).toContain(REPORT_HEADER);
    expect(text).toContain('Project: Tiny');
  });

  it('omits the supply block when no supply is set (demand-only)', () => {
    const result = solveHydraulics(tinyNetwork(), { hazard: 'LIGHT' });
    const input = buildReportInput({ projectName: 'T', hazard: 'LIGHT', result, supply: null });
    expect(input.supply).toBeUndefined();
    expect(formatHydraulicReport(input)).toContain('SUPPLY: none provided');
  });

  it('still guarantees a non-empty Hazen-Williams citation on an EMPTY network', () => {
    const empty: SprinklerNetwork = { nodes: [], segments: [], remoteAreas: [] };
    const result = solveHydraulics(empty, { hazard: 'LIGHT' });
    const input = buildReportInput({ projectName: 'E', hazard: 'LIGHT', result });
    expect(input.citations.length).toBeGreaterThan(0);
    expect(input.citations.some((c) => c.includes('Hazen-Williams'))).toBe(true);
    // Fail-soft end to end: the formatter still renders.
    expect(formatHydraulicReport(input)).toContain(REPORT_HEADER);
  });
});

describe('pipe volumes — published-ID table + fail-soft wrapper', () => {
  it('computes the 2" Sch40 volume from the published internal diameter', () => {
    const res = pipeVolumes([
      { id: 'p1', diameterIn: 2, lengthFt: 20, material: 'STEEL_SCH40' },
    ]);
    const id = internalDiameterIn('STEEL_SCH40', 2); // 2.067 published
    const expected = (Math.PI / 4) * (id / 12) ** 2 * 20 * GALLONS_PER_CUBIC_FOOT;
    expect(res.totalGallons).toBeCloseTo(expected, 10);
    expect(res.perSegment).toHaveLength(1);
    expect(res.citation.length).toBeGreaterThan(0);
  });

  it('THROWS on an odd (non-schedule) nominal size', () => {
    expect(() =>
      pipeVolumes([{ id: 'odd', diameterIn: 1.337, lengthFt: 5, material: 'STEEL_SCH40' }]),
    ).toThrow(/no published internal diameter/);
  });

  it('safePipeVolumes returns null on odd diameters (the panel "n/a" path)', () => {
    const res = safePipeVolumes([
      { id: 'ok', diameterIn: 2, lengthFt: 10, material: 'STEEL_SCH40' },
      { id: 'odd', diameterIn: 1.337, lengthFt: 5, material: 'STEEL_SCH40' },
    ]);
    expect(res).toBeNull();
  });

  it('safePipeVolumes sums an all-known network (fail-soft happy path)', () => {
    const res = safePipeVolumes([
      { id: 'a', diameterIn: 1, lengthFt: 10, material: 'STEEL_SCH40' },
      { id: 'b', diameterIn: 1.25, lengthFt: 10, material: 'STEEL_SCH10' },
      // The W4 router's head arm-over nipple is 0.5" Sch40 — must be in the table
      // (a routed network would otherwise always read "n/a").
      { id: 'c', diameterIn: 0.5, lengthFt: 2, material: 'STEEL_SCH40' },
    ]);
    expect(res).not.toBeNull();
    expect(res!.totalGallons).toBeGreaterThan(0);
    expect(res!.perSegment).toHaveLength(3);
  });
});
