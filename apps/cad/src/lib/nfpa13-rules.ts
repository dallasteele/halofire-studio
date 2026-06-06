// HaloFire CAD — NFPA-13 rules SINGLE-SOURCE re-export.
//
// The CAD app does NOT fork or copy any NFPA-13 numbers. Every cited coverage
// area, max spacing, distance-to-wall, head-to-head minimum, Hazen-Williams
// constant and the Q = K*sqrt(P) formula come from the ONE authored source in
// the studio app:
//
//   apps/studio/src/lib/nfpa13-rules.ts
//
// This module merely re-exports it across the monorepo so head-layout.ts and the
// CAD UI lean on the same cited constants the studio's hydraulic + assembly logic
// uses. If a value is wrong it is wrong in exactly one place. No number is
// duplicated here — this file contains zero numeric code constants.
//
// HONESTY: re-exporting preserves every citation and the design-aid disclaimer.
// This is a design aid built from published values — NOT a certified hydraulic
// calculation, NOT AHJ-approved, NOT PE-sealed. Verify the AHJ-adopted edition.

export * from '../../../studio/src/lib/nfpa13-rules';
export type {
  HazardClass as NfpaHazardClass,
  CodeRule,
  PipeMaterial as NfpaPipeMaterial,
} from '../../../studio/src/lib/nfpa13-rules';
