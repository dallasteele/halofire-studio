import { describe, expect, test } from 'vitest';

import {
  buildHomeDepotEvidenceRows,
  buildHomeDepotClaimGates,
  getBlockedClaimCodes,
} from '../src/data/evidence-gates.js';

expect.extend({
  toContainGate(gates, code) {
    const pass = gates.some((gate) => gate.code === code);
    return {
      pass,
      message: () => `expected claim gates to contain ${code}`,
    };
  },
});

describe('Home Depot Rexburg evidence and claim gates', () => {
  test('declares every required fail-closed gate with explicit blocked claims', () => {
    const gates = buildHomeDepotClaimGates();

    expect(gates).toContainGate('AUTOSPRINK_EVIDENCE_MISSING');
    expect(gates).toContainGate('AHJ_APPROVAL_MISSING');
    expect(gates).toContainGate('PROFESSIONAL_REVIEW_MISSING');
    expect(gates).toContainGate('MANUFACTURER_MODEL_APPROVAL_MISSING');
    expect(gates).toContainGate('BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL');

    expect(gates.find((gate) => gate.code === 'AUTOSPRINK_EVIDENCE_MISSING').blockedClaims)
      .toContain('AutoSprink parity');
    expect(gates.find((gate) => gate.code === 'AHJ_APPROVAL_MISSING').blockedClaims)
      .toContain('AHJ-approved');
    expect(gates.find((gate) => gate.code === 'PROFESSIONAL_REVIEW_MISSING').blockedClaims)
      .toContain('professionally reviewed');
    expect(gates.find((gate) => gate.code === 'MANUFACTURER_MODEL_APPROVAL_MISSING').blockedClaims)
      .toContain('manufacturer-approved model');
  });

  test('documents the Home Depot sqft discrepancy as a truthful warning gate', () => {
    const gates = buildHomeDepotClaimGates();
    const sqftGate = gates.find((gate) => gate.code === 'BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL');

    expect(sqftGate).toMatchObject({
      severity: 'warning',
      status: 'blocked',
      missingArtifact: 'Resolved square-footage source-of-truth decision',
      bidLogSqft: 135000,
      proposalSqft: 121500,
    });
    expect(sqftGate.blockedClaims).toContain('final sqft-based pricing');
    expect(sqftGate.nextAction).toContain('bid log shows 135000 sqft');
    expect(sqftGate.nextAction).toContain('proposal shows 121500 sqft');
  });

  test('keeps present evidence separate from blocked approval claims', () => {
    const evidence = buildHomeDepotEvidenceRows();

    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceType: 'proposal_workbook',
        sourceFile: 'Proposal- Home Depot - Rexburg ID.xlsx',
        status: 'present',
      }),
      expect.objectContaining({
        evidenceType: 'bid_log_row',
        sourceFile: '01-Bid Log.xlsx',
        sourceRef: 'Bid Log row 238',
        status: 'present',
      }),
      expect.objectContaining({
        evidenceType: 'argco_pricebook_workbook',
        sourceFile: 'Halo FIre Pricebook ARGCO 2026.xlsx',
        status: 'present',
      }),
      expect.objectContaining({
        evidenceType: 'fff_pricebook_workbook',
        sourceFile: 'Halo Fire Pricebook FFF 2026.xlsx',
        status: 'present',
      }),
      expect.objectContaining({
        evidenceType: 'victaulic_pricebook_workbook',
        sourceFile: 'Halo Fire Pricebook Victaulic 2026.xlsx',
        status: 'present',
      }),
    ]));

    expect(evidence.every((row) => row.projectName === 'Home Depot - Rexburg ID')).toBe(true);
  });

  test('exports only explicit blocked claim codes for persistence/API callers', () => {
    const blockedCodes = getBlockedClaimCodes(buildHomeDepotClaimGates());

    expect(blockedCodes).toEqual([
      'AUTOSPRINK_EVIDENCE_MISSING',
      'AHJ_APPROVAL_MISSING',
      'PROFESSIONAL_REVIEW_MISSING',
      'MANUFACTURER_MODEL_APPROVAL_MISSING',
      'BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL',
    ]);
  });
});
