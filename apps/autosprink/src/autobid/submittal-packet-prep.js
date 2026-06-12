/**
 * @typedef {Object} SubmittalPacket
 * @property {string} gateCode - The code of the gate being processed.
 * @property {string[]} preparedArtifacts - Documents auto-assembled for this gate.
 * @property {'needs-verification' | 'cleared'} verificationStatus - Status indicating if human review is required.
 * @property {string} residual - Description of the remaining human step required.
 * @property {'no_claims_cleared' | 'claims_cleared'} claim_gate_effect - Indicates whether this operation claims to have satisfied the gate requirements.
 */

/**
 * Prepares a best-effort submittal packet for specific manual review gates.
 * Note: This function does NOT manufacture approvals; it only assembles documentation
 * and flags the remaining human requirement.
 *
 * @param {string} gateCode - The identifier for the signoff gate (AHJ_APPROVAL_MISSING, PROFESSIONAL_REVIEW_MISSING, or AUTOSPRINK_EVIDENCE_MISSING).
 * @param {Object} project - The project object containing metadata.
 * @returns {SubmittalPacket}
 * @throws {RangeError} If the provided gateCode is not recognized.
 */
export function prepareSubmittalPacket(gateCode, project) {
  if (gateCode === 'AHJ_APPROVAL_MISSING') {
    return {
      gateCode,
      preparedArtifacts: ['permit submittal index'],
      verificationStatus: 'needs-verification',
      residual: 'AHJ authority approval',
      claim_gate_effect: 'no_claims_cleared'
    };
  }

  if (gateCode === 'PROFESSIONAL_REVIEW_MISSING') {
    return {
      gateCode,
      preparedArtifacts: ['automated NFPA design-check summary'],
      verificationStatus: 'needs-verification',
      residual: 'licensed PE signoff',
      claim_gate_effect: 'no_claims_cleared'
    };
  }

  if (gateCode === 'AUTOSPRINK_EVIDENCE_MISSING') {
    return {
      gateCode,
      preparedArtifacts: ['best-effort engine export manifest'],
      verificationStatus: 'needs-verification',
      residual: 'AutoSprink-verified export',
      claim_gate_effect: 'no_claims_cleared'
    };
  }

  throw new RangeError(`Unknown gateCode: ${gateCode}`);
}