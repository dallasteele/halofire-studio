import { AHJ_APPROVAL_MISSING, PROFESSIONAL_REVIEW_MISSING, AUTOSPRINK_EVIDENCE_MISSING } from '../types/gate-codes';

/**
 * Prepares the best-effort submittal packet for a gate requiring human signoff.
 * Never claims approval exists; only prepares and flags the residual step.
 *
 * @param gateCode - The gate code indicating the missing human step.
 * @param project - The project data (unused in this function).
 * @returns An object with the prepared artifacts, verification status, and residual step.
 * @throws {RangeError} If an unknown gateCode is provided.
 */
export function prepareSubmittalPacket(gateCode: string, project: any): {
  gateCode: string;
  preparedArtifacts: string[];
  verificationStatus: 'needs-verification';
  residual: string;
  claim_gate_effect: 'no_claims_cleared';
} {
  switch (gateCode) {
    case AHJ_APPROVAL_MISSING:
      return {
        gateCode,
        preparedArtifacts: ['permit submittal index'],
        verificationStatus: 'needs-verification',
        residual: 'AHJ authority approval',
        claim_gate_effect: 'no_claims_cleared'
      };
    case PROFESSIONAL_REVIEW_MISSING:
      return {
        gateCode,
        preparedArtifacts: ['automated NFPA design-check summary'],
        verificationStatus: 'needs-verification',
        residual: 'licensed PE signoff',
        claim_gate_effect: 'no_claims_cleared'
      };
    case AUTOSPRINK_EVIDENCE_MISSING:
      return {
        gateCode,
        preparedArtifacts: ['best-effort engine export manifest'],
        verificationStatus: 'needs-verification',
        residual: 'AutoSprink-verified export',
        claim_gate_effect: 'no_claims_cleared'
      };
    default:
      throw new RangeError(`Unknown gateCode: ${gateCode}`);
  }
}