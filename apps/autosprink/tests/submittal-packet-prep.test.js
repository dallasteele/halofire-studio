import { describe, it, expect } from 'vitest';
import { prepareSubmittalPacket } from '../src/autobid/submittal-packet-prep.js';

describe('prepareSubmittalPacket', () => {
  const mockProject = { id: 'proj-123', name: 'Test Project' };

  it('should prepare AHJ packet and flag residual approval', () => {
    const result = prepareSubmittalPacket('AHJ_APPROVAL_MISSING', mockProject);
    expect(result.gateCode).toBe('AHJ_APPROVAL_MISSING');
    expect(result.preparedArtifacts).toContain('permit submittal index');
    expect(result.verificationStatus).toBe('needs-verification');
    expect(result.residual).toBe('AHJ authority approval');
    expect(result.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('should prepare Professional Review packet and flag residual signoff', () => {
    const result = prepareSubmittalPacket('PROFESSIONAL_REVIEW_MISSING', mockProject);
    expect(result.gateCode).toBe('PROFESSIONAL_REVIEW_MISSING');
    expect(result.preparedArtifacts).toContain('automated NFPA design-check summary');
    expect(result.verificationStatus).toBe('needs-verification');
    expect(result.residual).toBe('licensed PE signoff');
    expect(result.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('should prepare AutoSprink packet and flag residual export', () => {
    const result = prepareSubmittalPacket('AUTOSPRINK_EVIDENCE_MISSING', mockProject);
    expect(result.gateCode).toBe('AUTOSPRINK_EVIDENCE_MISSING');
    expect(result.preparedArtifacts).toContain('best-effort engine export manifest');
    expect(result.verificationStatus).toBe('needs-verification');
    expect(result.residual).toBe('AutoSprink-verified export');
    expect(result.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('should throw RangeError for unknown gateCode', () => {
    expect(() => prepareSubmittalPacket('UNKNOWN_GATE', mockProject)).toThrow(RangeError);
  });
});