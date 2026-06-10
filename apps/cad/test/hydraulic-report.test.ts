// W2F hydraulic-report — golden text formatter, fail-closed on missing citations.

import { describe, expect, it } from 'vitest';
import {
  formatHydraulicReport,
  formatNumber,
  REPORT_HEADER,
  type ReportInput,
} from '../src/lib/hydraulic-report';

function baseInput(): ReportInput {
  return {
    projectName: 'Demo',
    hazard: 'ORDINARY_1',
    demandGpm: 250,
    demandPsiAtRiser: 62.5,
    supply: { staticPsi: 70, residualPsi: 55, flowGpm: 1000, availablePsiAtDemand: 64, adequate: true },
    nodes: [
      { id: 'h1', pressurePsi: 12.12, flowGpm: 19.5 },
      { id: 'src', pressurePsi: 64, flowGpm: 250 },
    ],
    segments: [{ id: 'p1', flowGpm: 250, frictionPsi: 1.234, velocityFps: 9.87 }],
    disclaimer: 'Design aid only — not an AHJ/PE-stamped calculation.',
    citations: ['NFPA 13 Hazen-Williams. Verify adopted edition.'],
  };
}

describe('formatNumber', () => {
  it('matches toFixed semantics', () => {
    expect(formatNumber(19.5, 1)).toBe('19.5');
    expect(formatNumber(1.005, 2)).toBe((1.005).toFixed(2)); // no invented rounding
    expect(formatNumber(64, 1)).toBe('64.0');
  });
  it('throws on non-finite or bad decimals', () => {
    expect(() => formatNumber(Number.NaN, 2)).toThrow();
    expect(() => formatNumber(1, -1)).toThrow();
    expect(() => formatNumber(1, 1.5)).toThrow();
  });
});

describe('formatHydraulicReport — golden', () => {
  it('renders the exact report for a 2-node/1-segment input with supply', () => {
    const expected = [
      REPORT_HEADER,
      'Project: Demo',
      'Hazard: ORDINARY_1',
      '',
      'SYSTEM DEMAND: 250.0 gpm @ 62.5 psi at riser',
      'SUPPLY: static 70.0 psi, residual 55.0 psi @ 1000.0 gpm',
      'AVAILABLE @ DEMAND: 64.0 psi -> ADEQUATE',
      '',
      'NODES (2)',
      '  h1                P=12.12 psi  Q=19.50 gpm',
      '  src               P=64.00 psi  Q=250.00 gpm',
      '',
      'SEGMENTS (1)',
      '  p1                Q=250.00 gpm  dP=1.234 psi  v=9.87 ft/s',
      '',
      'CITATIONS:',
      '  - NFPA 13 Hazen-Williams. Verify adopted edition.',
      '',
      'Design aid only — not an AHJ/PE-stamped calculation.',
    ].join('\n');
    expect(formatHydraulicReport(baseInput())).toBe(expected);
  });

  it('demand-only when supply is absent', () => {
    const i = baseInput();
    delete i.supply;
    expect(formatHydraulicReport(i)).toContain('SUPPLY: none provided (demand-only result)');
  });

  it('renders INADEQUATE when supply.adequate is false', () => {
    const i = baseInput();
    i.supply!.adequate = false;
    expect(formatHydraulicReport(i)).toContain('-> INADEQUATE');
  });

  it('pads long ids without truncation', () => {
    const i = baseInput();
    i.nodes = [{ id: 'a-very-long-node-id-2026', pressurePsi: 1, flowGpm: 2 }];
    expect(formatHydraulicReport(i)).toContain('  a-very-long-node-id-2026  P=1.00 psi');
  });

  it('fail-closed: throws on empty disclaimer or empty citations', () => {
    expect(() => formatHydraulicReport({ ...baseInput(), disclaimer: '' })).toThrow();
    expect(() => formatHydraulicReport({ ...baseInput(), citations: [] })).toThrow();
  });
});
