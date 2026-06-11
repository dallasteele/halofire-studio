/**
 * Verification status flag model.
 * Product doctrine: build-complete flag-do-not-gate — machine-generated content is allowed everywhere but must be labeled.
 */

/**
 * Verification status types.
 */
export type VerificationStatus = 'needs-verification' | 'human-verified';

/**
 * Verification metadata.
 */
export interface Verification {
  status: VerificationStatus;
  note: string;
  source: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

/**
 * Creates a machine-generated verification object.
 * @param note - The note describing the machine-generated content.
 * @param source - The source of the machine-generated content.
 * @returns A new Verification object with status 'needs-verification'.
 */
export function machineGenerated(note: string, source: string): Verification {
  return {
    status: 'needs-verification',
    note,
    source,
    verifiedBy: null,
    verifiedAt: null,
  };
}

/**
 * Verifies a verification object.
 * @param v - The verification object to verify.
 * @param who - The person who verified the content (must not be empty).
 * @param atIso - The ISO 8601 timestamp of verification (must not be empty).
 * @returns A new Verification object with status 'human-verified'.
 * @throws {TypeError} If `who` or `atIso` is empty.
 */
export function verify(v: Verification, who: string, atIso: string): Verification {
  if (who.trim() === '' || atIso.trim() === '') {
    throw new TypeError('');
  }
  return {
    status: 'human-verified',
    note: v.note,
    source: v.source,
    verifiedBy: who,
    verifiedAt: atIso,
  };
}

/**
 * Checks if a verification object is usable.
 * @param v - The verification object.
 * @returns Always true (usability never depends on verification).
 */
export function isUsable(_v: Verification): boolean {
  return true;
}

/**
 * Checks if a verification object needs attention.
 * @param v - The verification object.
 * @returns True if status is 'needs-verification'.
 */
export function needsAttention(v: Verification): boolean {
  return v.status === 'needs-verification';
}