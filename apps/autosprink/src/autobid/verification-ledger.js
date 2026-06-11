/**
 * @fileoverview Verification ledger logic for replacing the blocked parity gate.
 * Follow-up wave will wire this into GET /api/parity and settings.html so 
 * the surface shows the ledger instead of a permanent blocked gate.
 */

/**
 * @typedef {
 *   { 'needs-verification' | 'human-verified' } verificationStatus
 * }
 * @typedef {Object} VerificationItem
 * @property {verificationStatus} verificationStatus
 * }
 * @typedef {Object}
 * @property {number} total
 * @property {number} humanVerified
 * @property {number} needsVerification
 * @property {number} coveragePct
 * }
 */

/**
 * Calculates the verification ledger from a list of items.
 * 
 * @param {VerificationItem[]} items - Array of items with verification status.
 * @returns {Object} The calculated ledger metrics.
 */
export function buildLedger(items) {
  let total = 0;
  let humanVerified = 0;
  let needsVerification = 0;

  for (const item of items) {
    total++;
    if (item.verificationStatus === 'human-verified') {
      humanVerified++;
    } else if (item.verificationStatus === 'needs-verification') {
      needsVerification++;
    }
  }

  const coveragePct = total === 0 ? 0 : Math.round((humanVerified / total) * 100 * 10) / 10;

  return {
    total,
    humanVerified,
    needsVerification,
    coveragePct
  };
}

/**
 * Returns a human-readable summary string from a ledger object.
 * 
 * @param {Object} ledger - The ledger object returned by buildLedger.
 * @returns {string} A formatted summary string.
 */
export function ledgerSummary(ledger) {
  const { total, humanVerified, needsVerification, coveragePct } = ledger;

  if (total === 0) {
    return '0 of 0 human-verified (0 percent), 0 need verification';
  }

  // Format: "12 of 155 human-verified (7.7 percent), 143 need verification"
  return `${humanVerified} of ${total} human-verified (${coveragePct} percent), ${needsVerification} need verification`;
}
