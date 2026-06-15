/**
 * Golden known-answer tests for the NFPA-format hydraulic report (Phase 3).
 *
 * The report is a PURE transform of a solveNetwork() result — it adds no physics.
 * So the golden discipline here is: (a) run the VALIDATED solver on a hand-buildable
 * network, (b) assert the report rows carry the SAME numbers the solver computed
 * (which are themselves golden-tested in network-solve.test.js against hand calcs),
 * and (c) assert structure (summary present, one node row per node, one pipe row per
 * edge, K only on sprinkler nodes, fitting Le merged from the worst path).
 *
 * If a report number disagrees with the solve it mirrors, the transform is wrong —
 * fix the transform, do not relax the test.
 */
import { describe, expect, it } from 'vitest';
import { solveNetwork, kFactorFlow, hwLossPsiPerFt, velocityFps } from '../src/engine/network-solve.js';
import { buildHydraulicReport, renderReportHtml, REPORT_DISCLAIMER } from '../src/engine/nfpa-report.js';

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// Single vertical riser + one head — fully hand-computable.
// ---------------------------------------------------------------------------
describe('NFPA report: single-riser hand calc', () => {
  const cad = {
    solids: [
      { kind: 'pipe', name: 'riser', from: [0, 0, 0], to: [0, 0, 10], diameterIn: 2.067 },
      { kind: 'head', name: 'H', position: [0, 0, 10], kFactor: 5.6 },
    ],
  };
  const solve = solveNetwork(cad, { minHeadPressurePsi: 7, C: 120, availablePsi: 65 });
  const report = buildHydraulicReport(solve, { hazard: 'ordinary' });
  const Q = kFactorFlow(5.6, 7); // 14.8162 gpm

  it('has a summary sheet', () => {
    expect(report.hasSummary).toBe(true);
    expect(report.summary).toBeTruthy();
  });

  it('summary demand/required/available mirror the solve', () => {
    expect(report.summary.demandGpm).toBe(solve.demandGpm);
    expect(report.summary.requiredPsi).toBe(solve.requiredPsi);
    expect(report.summary.availablePsi).toBe(65);
  });

  it('summary demand = K√7 (single head discharge)', () => {
    expect(near(report.summary.demandGpm, Q, 0.01)).toBe(true); // 14.82 gpm
  });

  it('safety margin = available − required, demandMet flag correct', () => {
    expect(near(report.summary.safetyMarginPsi, 65 - solve.requiredPsi, 0.001)).toBe(true);
    expect(report.summary.demandMet).toBe(65 >= solve.requiredPsi);
  });

  it('one node row per solver node (source + remote head)', () => {
    expect(report.nodeRows).toHaveLength(solve.nodes.length);
    expect(report.nodeRows).toHaveLength(2);
  });

  it('K-factor present ONLY on the sprinkler (remote) node, null at the supply', () => {
    const src = report.nodeRows.find((r) => r.isSource);
    const rem = report.nodeRows.find((r) => r.isRemote);
    expect(src.kFactor).toBeNull();
    expect(rem.kFactor).toBe(5.6);
  });

  it('remote node row pressure = minHead + Pv = solve remote node pressure', () => {
    const rem = report.nodeRows.find((r) => r.isRemote);
    const solveRem = solve.nodes.find((n) => n.isRemote);
    expect(near(rem.pressurePsi, solveRem.pressurePsi, 0.001)).toBe(true);
    expect(near(rem.pressurePsi, 7 + solve.velocityPressurePsi, 0.002)).toBe(true);
  });

  it('remote node elevation = 10 ft (riser top)', () => {
    const rem = report.nodeRows.find((r) => r.isRemote);
    expect(near(rem.elevationFt, 10, 0.001)).toBe(true);
  });

  it('remote node Q = head discharge K√7', () => {
    const rem = report.nodeRows.find((r) => r.isRemote);
    expect(near(rem.flowGpm, Q, 0.01)).toBe(true);
  });

  it('one pipe row per edge; the riser carries the full demand', () => {
    expect(report.pipeRows).toHaveLength(solve.edgeResults.length);
    expect(report.pipeRows).toHaveLength(1);
    const p = report.pipeRows[0];
    expect(near(p.flowGpm, Q, 0.01)).toBe(true);
    expect(near(p.diameterIn, 2.067, 0.001)).toBe(true);
    expect(near(p.lengthFt, 10, 0.001)).toBe(true);
    expect(p.cFactor).toBe(120);
  });

  it('pipe friction loss row = Hazen-Williams hand calc over 10 ft', () => {
    const p = report.pipeRows[0];
    const expectLoss = hwLossPsiPerFt(Q, 2.067, 120) * 10; // ~0.0273 psi
    expect(near(p.frictionLossPsi, expectLoss, 0.002)).toBe(true);
  });

  it('pipe velocity row = 0.4085·Q/d² hand calc', () => {
    const p = report.pipeRows[0];
    expect(near(p.velocityFps, velocityFps(Q, 2.067), 0.01)).toBe(true);
  });

  it('carries the NFPA engineering-aid disclaimer (NOT stamped)', () => {
    expect(report.disclaimer).toBe(REPORT_DISCLAIMER);
    expect(report.disclaimer).toMatch(/NOT a PE-stamped/);
    expect(report.disclaimer).toMatch(/AHJ-approved/);
  });

  it('exposes the contract shape {hasSummary, nodeRows, pipeRows}', () => {
    expect(report).toHaveProperty('hasSummary');
    expect(Array.isArray(report.nodeRows)).toBe(true);
    expect(Array.isArray(report.pipeRows)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Two-head branch with a short leaf leg — exercises fitting-Le merge into the
// pipe-data table from the worst path.
// ---------------------------------------------------------------------------
describe('NFPA report: 2-head branch with fitting Le on the short leaf', () => {
  // A carrier main + a short (< 6 ft) leaf leg to a head: the solver adds a
  // tee-branch + 90° elbow Le on that leaf, which must surface in the pipe row.
  const cad = {
    solids: [
      { kind: 'pipe', name: 'main', from: [0, 0, 0], to: [10, 0, 0], diameterIn: 2.067 },
      { kind: 'pipe', name: 'leaf', from: [10, 0, 0], to: [13, 0, 0], diameterIn: 2.067 },
      { kind: 'head', name: 'H1', position: [10, 0, 0], kFactor: 5.6 },
      { kind: 'head', name: 'H2', position: [13, 0, 0], kFactor: 5.6 },
    ],
  };
  const solve = solveNetwork(cad, { minHeadPressurePsi: 7, C: 120, availablePsi: 80 });
  const report = buildHydraulicReport(solve, { hazard: 'ordinary' });

  it('summary fitting Le matches the solve aggregate (worst path)', () => {
    expect(near(report.summary.fittingLeFt, solve.fittingLe.totalEquivFt, 0.01)).toBe(true);
    expect(report.summary.fittingLeFt).toBeGreaterThan(0);
  });

  it('at least one pipe row carries a non-zero fitting Le (the short leaf)', () => {
    const withLe = report.pipeRows.filter((p) => p.fittingLeFt > 0);
    expect(withLe.length).toBeGreaterThanOrEqual(1);
  });

  it('effectiveLengthFt = lengthFt + fittingLeFt on every pipe row', () => {
    for (const p of report.pipeRows) {
      expect(near(p.effectiveLengthFt, p.lengthFt + p.fittingLeFt, 0.001)).toBe(true);
    }
  });

  it('node count = solver node count; pipe count = edge count', () => {
    expect(report.nodeRows).toHaveLength(solve.nodes.length);
    expect(report.pipeRows).toHaveLength(solve.edgeResults.length);
    expect(report.summary.pipeCount).toBe(solve.pipeCount);
  });

  it('every node flow conserves (summary flag carried up)', () => {
    expect(report.summary.conservationOk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hazard / density metadata + design basis surface in the summary.
// ---------------------------------------------------------------------------
describe('NFPA report: design-context metadata', () => {
  const cad = {
    solids: [
      { kind: 'pipe', from: [0, 0, 0], to: [0, 0, 10], diameterIn: 2.067 },
      { kind: 'head', position: [0, 0, 10], kFactor: 5.6 },
    ],
  };
  const solve = solveNetwork(cad, { minHeadPressurePsi: 7, C: 120, availablePsi: 65 });

  it('hazard label + density + design area pass through to the summary', () => {
    const report = buildHydraulicReport(solve, {
      hazard: 'ordinary-2', densityGpmFt2: 0.2, designAreaSqFt: 1500,
    });
    expect(report.summary.hazard).toBe('ordinary-2');
    expect(report.summary.hazardLabel).toBe('Ordinary Hazard Group 2');
    expect(report.summary.densityGpmFt2).toBe(0.2);
    expect(report.summary.designAreaSqFt).toBe(1500);
    expect(report.meta.hazardLabel).toBe('Ordinary Hazard Group 2');
  });

  it('design basis flag carried from the solve (all-heads-open vs subset)', () => {
    const report = buildHydraulicReport(solve, {});
    expect(report.summary.designBasis).toBe(solve.designBasis);
  });
});

// ---------------------------------------------------------------------------
// Degenerate honesty: empty / no-solve produces an honest empty report.
// ---------------------------------------------------------------------------
describe('NFPA report: degenerate honesty', () => {
  it('null solve -> hasSummary false, empty rows, disclaimer intact', () => {
    const report = buildHydraulicReport(null, {});
    expect(report.hasSummary).toBe(false);
    expect(report.summary).toBeNull();
    expect(report.nodeRows).toEqual([]);
    expect(report.pipeRows).toEqual([]);
    expect(report.disclaimer).toBe(REPORT_DISCLAIMER);
  });

  it('degenerate solve (no heads) -> empty node/pipe rows, no summary crash', () => {
    const solve = solveNetwork({ solids: [] }, { availablePsi: 50 });
    const report = buildHydraulicReport(solve, {});
    expect(report.nodeRows).toEqual([]);
    expect(report.pipeRows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Printable HTML export — disclaimer + tables present, escaped, self-contained.
// ---------------------------------------------------------------------------
describe('NFPA report: printable HTML export', () => {
  const cad = {
    solids: [
      { kind: 'pipe', from: [0, 0, 0], to: [0, 0, 10], diameterIn: 2.067 },
      { kind: 'head', position: [0, 0, 10], kFactor: 5.6 },
    ],
  };
  const solve = solveNetwork(cad, { minHeadPressurePsi: 7, C: 120, availablePsi: 65 });
  const report = buildHydraulicReport(solve, { projectName: 'Test <Project>', hazard: 'ordinary' });
  const html = renderReportHtml(report, { generatedAt: '2026-06-14' });

  it('is a self-contained HTML doc with the disclaimer in the header', () => {
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('NFPA Hydraulic Calculation Report');
    expect(html).toContain('NOT a PE-stamped');
  });

  it('renders the summary, node-analysis, and pipe-data tables', () => {
    expect(html).toContain('Summary');
    expect(html).toContain('Node Analysis');
    expect(html).toContain('Pipe Data');
    expect(html).toMatch(/<th>Ref<\/th>/);
    expect(html).toMatch(/From → To/);
  });

  it('escapes HTML in metadata (no injection)', () => {
    expect(html).toContain('Test &lt;Project&gt;');
    expect(html).not.toContain('Test <Project>');
  });
});
