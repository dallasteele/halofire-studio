/**
 * Claim-gate settings view helper (W16C).
 *
 * Renders the plain user-facing string for a claim-gate row. Doctrine:
 * flag-don't-gate — amber needs-verification wording, never a red "blocked"
 * wall. The honest residual (what a human must still verify) stays front and
 * center; we never claim an approval exists when it does not.
 */

/** Returns the settings-row string for one gate (flag shape from gateFlag,
 * or a raw gate row with the same fields). */
export function renderGateFlag(gate) {
  const status = gate.verificationStatus
    || ((gate.status === 'resolved' || gate.resolved_by) ? 'human-verified' : 'needs-verification');
  if (status === 'human-verified') {
    return `VERIFIED: ${gate.code}`;
  }
  const artifact = String(gate.residual || gate.missing_artifact || gate.code || '').trim();
  const action = String(gate.next_action || gate.note || '').trim();
  const tail = action ? ` — ${action}` : '';
  return `NEEDS VERIFICATION: ${artifact}${tail} (best-effort prepared, human signoff still required)`;
}
