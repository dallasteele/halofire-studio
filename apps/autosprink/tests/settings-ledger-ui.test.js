import { describe, it, expect } from 'vitest';
import { renderLedgerLine } from '../src/autobid/ledger-view.js';

describe('renderLedgerLine', () => {
  it('renders the ledger summary + models-built line for a ledger response', () => {
    const line = renderLedgerLine({
      status: 'ledger',
      usable: true,
      ledger: { total: 155, humanVerified: 12, needsVerification: 143, coveragePct: 7.7 },
      ledgerSummary: '12 of 155 human-verified (7.7 percent), 143 need verification',
      modelsBuilt: 29,
    });
    expect(line).toContain('12 of 155 human-verified');
    expect(line).toContain('models built 29 of 155');
    expect(line).toContain('usable now');
    expect(line).not.toMatch(/blocked/i);
  });

  it('falls back to a usable line for a legacy no-ledger response', () => {
    const line = renderLedgerLine({ gate: { status: 'blocked' } });
    expect(line).toContain('usable best-effort');
    expect(line).not.toMatch(/\bBLOCKED\b/);
  });
});
