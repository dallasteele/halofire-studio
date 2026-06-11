/**
 * Ledger view helper for the Settings page (W14E).
 *
 * Renders the verification ledger line the user sees in place of the old
 * permanent "BLOCKED" parity banner. Doctrine: flag-don't-gate — the system is
 * usable now; best-effort models are flagged for human verification.
 */

/**
 * Returns the plain user-facing string for the GET /api/parity response.
 * Prefers the new ledger; falls back to a usable line for legacy responses.
 *
 * @param {object} parityResponse - the GET /api/parity body.
 * @returns {string}
 */
export function renderLedgerLine(parityResponse) {
  const r = parityResponse || {};
  if (r.ledger && typeof r.ledger.total === 'number') {
    const built = typeof r.modelsBuilt === 'number'
      ? `, models built ${r.modelsBuilt} of ${r.ledger.total}`
      : '';
    const summary = typeof r.ledgerSummary === 'string'
      ? r.ledgerSummary
      : `${r.ledger.humanVerified} of ${r.ledger.total} human-verified`;
    return `Verification: ${summary}${built} — best-effort models are usable now and flagged for human verification.`;
  }
  // Legacy response without a ledger: still present it as usable, not blocked.
  return 'Verification ledger unavailable — components are usable best-effort models, flagged for human verification.';
}
