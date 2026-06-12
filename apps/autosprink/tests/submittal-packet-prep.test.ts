import { AHJ_APPROVAL_MISSING, PROFESSIONAL_REVIEW_MISSING, AUTOSPRINK_EVIDENCE_MISSING } from '../src/types/gate-codes';
import { prepareSubmittalPacket } from '../src/autobid/submittal-packet-prep';

describe('prepareSubmittalPacket', () => {
  const mockProject = {};

  it('prepares for AHJ_APPROVAL_MISSING', () => {
    const result = prepareSubmittalPacket(AHJ_APPROVAL_MISSING, mockProject);
    expect(result.gateCode).toBe(AHJ_APPROVAL_MISSING);
    expect(result.preparedArtifacts).toEqual(['permit submittal index']);
    expect(result.verificationStatus).toBe('needs-verification');
    expect(result.residual).toBe('AHJ authority approval');
    expect(result.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('prepares for PROFESSIONAL_REVIEW_MISSING', () => {
    const result = prepareSubmittalPacket(PROFESSIONAL_REVIEW_MISSING, mockProject);
    expect(result.gateCode).toBe(PROFESSIONAL_REVIEW_MISSING);
    expect(result.preparedArtifacts).toEqual(['automated NFPA design-check summary']);
    expect(result.verificationStatus).toBe('needs-verification');
    expect(result.residual).toBe('licensed PE signoff');
    expect(result.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('prepares for AUTOSPRINK_EVIDENCE_MISSING', () => {
    const result = prepareSubmittalPacket(AUTOSPRINK_EVIDENCE_MISSING, mockProject);
    expect(result.gateCode).toBe(AUTOSPRINK_EVIDENCE_MISSING);
    expect(result.preparedArtifacts).toEqual(['best-effort engine export manifest']);
    expect(result.verificationStatus).toBe('needs-verification');
    expect(result.residual).toBe('AutoSprink-verified export');
    expect(result.claim_gate_effect).toBe('no_claims_cleared');
  });

  it('throws for unknown gateCode', () => {
    expect(() => prepareSubmittalPacket('UNKNOWN_GATE', mockProject)).toThrow(RangeError);
  });
});