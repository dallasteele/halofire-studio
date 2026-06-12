import { describe, it, expect } from 'vitest';
import { gateFlag, gatesSummary } from '../src/autobid/claim-gate-flag.js';

const blockedAhj = {
  code: 'AHJ_APPROVAL_MISSING',
  status: 'blocked',
  missing_artifact: 'AHJ approval record',
  next_action: 'Record the AHJ approval artifact before showing any AHJ-approved status.',
};

describe('gateFlag', () => {
  it('maps a blocked AHJ gate to needs-verification, usable, with the residual', () => {
    const f = gateFlag(blockedAhj);
    expect(f.verificationStatus).toBe('needs-verification');
    expect(f.usable).toBe(true);
    expect(f.label).toContain('NEEDS VERIFICATION');
    expect(f.residual).toBe('AHJ approval record');
    expect(f.note).toContain('AHJ approval record');
    expect(f.note).toContain('Record the AHJ approval artifact');
  });

  it('maps a resolved gate to human-verified with empty residual', () => {
    const f = gateFlag({ ...blockedAhj, status: 'resolved', resolved_by: 'dallas' });
    expect(f.verificationStatus).toBe('human-verified');
    expect(f.usable).toBe(true);
    expect(f.label).toContain('VERIFIED');
    expect(f.residual).toBe('');
  });

  it('treats resolved_by alone as verified', () => {
    expect(gateFlag({ ...blockedAhj, resolved_by: 'wade' }).verificationStatus).toBe('human-verified');
  });

  it('throws TypeError on non-object input', () => {
    expect(() => gateFlag(null)).toThrow(TypeError);
    expect(() => gateFlag('gate')).toThrow(TypeError);
    expect(() => gateFlag([blockedAhj])).toThrow(TypeError);
  });
});

describe('gatesSummary', () => {
  it('counts verified vs needs-verification with a human summary', () => {
    const s = gatesSummary([
      blockedAhj,
      { ...blockedAhj, code: 'PROFESSIONAL_REVIEW_MISSING' },
      { ...blockedAhj, code: 'AUTOSPRINK_EVIDENCE_MISSING', status: 'resolved', resolved_by: 'dallas' },
    ]);
    expect(s).toEqual({
      total: 3,
      verified: 1,
      needsVerification: 2,
      summary: '1 of 3 verified, 2 need verification',
    });
  });

  it('handles an empty list and throws on non-array', () => {
    expect(gatesSummary([]).summary).toBe('0 of 0 verified, 0 need verification');
    expect(() => gatesSummary('gates')).toThrow(TypeError);
  });
});
