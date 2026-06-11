import { describe, it, expect } from 'vitest';
import { buildLedger, ledgerSummary } from '../src/autobid/verification-ledger.js';

describe('verification-ledger', () => {
  describe('buildLedger', () => {
    it('calculates mixed list math correctly', () => {
      const items = [
        { verificationStatus: 'human-verified' },
        { verificationStatus: 'needs-verification' },
        { verificationStatus: 'human-verified' },
        { verificationStatus: 'needs-verification' },
        { verificationStatus: 'human-verified' },
      ];
      const ledger = buildLedger(items);
      expect(ledger.total).toBe(5);
      expect(ledger.humanVerified).toBe(3);
      expect(ledger.needsVerification).toBe(2);
      // 3/5 = 0.6 -> 60
      expect(ledger.coveragePct).toBe(60);
    });

    it('handles empty list', () => {
      const ledger = buildLedger([]);
      expect(ledger.total).toBe(0);
      expect(ledger.humanVerified).toBe(0);
      expect(ledger.needsVerification).toBe(0);
      expect(ledger.coveragePct).toBe(0);
    });

    it('rounds coverage percentage to 1 decimal place', () => {
      // 1/3 = 0.3333... -> 33.3
      const items = [
        { verificationStatus: 'human-verified' },
        { verificationStatus: 'needs-verification' },
        { verificationStatus: 'needs-verification' },
      ];
      const ledger = buildLedger(items);
      expect(ledger.coveragePct).toBe(33.3);
    });
  });

  describe('ledgerSummary', () => {
    it('returns correct summary for mixed list', () => {
      const ledger = {
        total: 155,
        humanVerified: 12,
        needsVerification: 143,
        coveragePct: 7.7
      };
      expect(ledgerSummary(ledger)).toBe('12 of 155 human-verified (7.7 percent), 143 need verification');
    });

    it('returns zero summary for empty list', () => {
      const ledger = {
        total: 0,
        humanVerified: 0,
        needsVerification: 0,
        coveragePct: 0
      };
      expect(ledgerSummary(ledger)).toBe('0 of 0 human-verified (0 percent), 0 need verification');
    });
  });
});