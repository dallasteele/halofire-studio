/**
 * Claim-gate flag model (W16A).
 *
 * Doctrine: flag-don't-gate. A claim gate never presents as a hard block — it
 * presents as a usable item flagged needs-verification, carrying what is still
 * required (the residual). Resolved gates read human-verified. Honesty holds:
 * we never claim AHJ/PE/manufacturer approval exists — the residual IS the flag.
 */

/** Maps one claim-gate row to a verification flag. Never a wall. */
export function gateFlag(gate) {
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    throw new TypeError('gateFlag: gate must be an object');
  }
  const resolved = gate.status === 'resolved' || Boolean(gate.resolved_by);
  const verificationStatus = resolved ? 'human-verified' : 'needs-verification';
  const missing = String(gate.missing_artifact || '').trim();
  const next = String(gate.next_action || '').trim();
  return {
    code: gate.code,
    verificationStatus,
    usable: true, // usability NEVER depends on verification
    label: resolved
      ? `VERIFIED: ${gate.code}`
      : `NEEDS VERIFICATION: ${missing || gate.code}`,
    note: [missing, next].filter(Boolean).join(' — '),
    residual: resolved ? '' : missing,
  };
}

/** Rolls a gate list up into counts + a short human summary. */
export function gatesSummary(gates) {
  if (!Array.isArray(gates)) {
    throw new TypeError('gatesSummary: gates must be an array');
  }
  let verified = 0;
  for (const g of gates) {
    if (gateFlag(g).verificationStatus === 'human-verified') verified += 1;
  }
  const total = gates.length;
  const needsVerification = total - verified;
  return {
    total,
    verified,
    needsVerification,
    summary: `${verified} of ${total} verified, ${needsVerification} need verification`,
  };
}
