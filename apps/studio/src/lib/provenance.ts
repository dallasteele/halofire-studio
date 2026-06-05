// PURE provenance + accuracy-badge logic — no React / three imports.
//
// Accuracy spine aligns EXACTLY with packages/halofire-catalog/src/schema.ts
// (CatalogModelStatusSchema). It is an ordered 5-tier enum, low -> high:
//   visual_reference < proxy < dimensioned_parametric < manufacturer_verified < sealed_approved
//
// HONESTY (hard, fail-closed): an AI/placeholder/OpenSCAD-"generated" mesh must
// NEVER be presented as manufacturer-exact, dimensionally-accurate, AHJ, PE, or
// fabrication-ready. We fail SAFE to the lowest tier (visual_reference) on any
// uncertainty and NEVER upgrade provenance on missing/unknown data.

/** Ordered 5-tier accuracy spine, identical to the catalog model_status enum. */
export type ModelStatus =
  | 'visual_reference'
  | 'proxy'
  | 'dimensioned_parametric'
  | 'manufacturer_verified'
  | 'sealed_approved';

/** Ascending accuracy order (index 0 = lowest tier). Monotonic by construction. */
export const MODEL_STATUS_ORDER: readonly ModelStatus[] = [
  'visual_reference',
  'proxy',
  'dimensioned_parametric',
  'manufacturer_verified',
  'sealed_approved',
] as const;

/**
 * Build-plan provenance sources plus the current OpenSCAD "generated" output and
 * the manifest "unknown" fallback. This is the kind of mesh/source we ingested,
 * NOT a claim about accuracy — accuracy is derived from it.
 */
export type PartSource =
  | 'manufacturer-step'
  | 'build123d'
  | 'step.parts'
  | 'ai-placeholder'
  | 'generated'
  | 'unknown';

/**
 * Derive the accuracy tier from a part record's raw source + manufacturerExact.
 *
 * Mapping (fail-SAFE — anything unrecognized collapses to visual_reference):
 *   "generated" (OpenSCAD)      -> visual_reference
 *   "ai-placeholder"            -> visual_reference
 *   "step.parts"                -> proxy
 *   "build123d"                 -> dimensioned_parametric
 *   "manufacturer-step" + manufacturerExact===true -> manufacturer_verified
 *   "manufacturer-step" WITHOUT manufacturerExact===true -> visual_reference (fail-safe)
 *   unknown / missing / undefined -> visual_reference
 *
 * We NEVER upgrade on uncertainty: a manufacturer-step that has not confirmed
 * manufacturerExact stays at the lowest tier, and sealed_approved is never
 * derived here (it requires an out-of-band PE/AHJ seal, not present in-app).
 */
export function deriveModelStatus(rec: {
  source?: string;
  manufacturerExact?: boolean;
}): ModelStatus {
  const source = rec.source;
  switch (source) {
    case 'generated':
    case 'ai-placeholder':
      return 'visual_reference';
    case 'step.parts':
      return 'proxy';
    case 'build123d':
      return 'dimensioned_parametric';
    case 'manufacturer-step':
      // Only an explicit, confirmed manufacturerExact===true earns the upgrade.
      return rec.manufacturerExact === true
        ? 'manufacturer_verified'
        : 'visual_reference';
    default:
      // unknown / missing / undefined / any future source we don't recognize.
      return 'visual_reference';
  }
}

export interface AccuracyBadge {
  modelStatus: ModelStatus;
  /** Short human label for a chip. */
  label: string;
  /** Distinct chip color per tier. */
  color: string;
  /**
   * True ONLY for manufacturer_verified | sealed_approved. visual_reference,
   * proxy, and dimensioned_parametric are NOT engineering-accurate.
   */
  engineeringAccurate: boolean;
  /**
   * True ONLY for dimensioned_parametric | manufacturer_verified | sealed_approved.
   * visual_reference and proxy are NOT dimensionally verified.
   */
  dimensionVerified: boolean;
}

const BADGES: Record<ModelStatus, AccuracyBadge> = {
  visual_reference: {
    modelStatus: 'visual_reference',
    label: 'Visual reference — not dimensional',
    color: '#f0a868', // amber/orange — caution, not engineering-accurate
    engineeringAccurate: false,
    dimensionVerified: false,
  },
  proxy: {
    modelStatus: 'proxy',
    label: 'Proxy — approximate, not dimensional',
    color: '#9aa6b2', // grey
    engineeringAccurate: false,
    dimensionVerified: false,
  },
  dimensioned_parametric: {
    modelStatus: 'dimensioned_parametric',
    label: 'Dimensioned parametric — not manufacturer-exact',
    color: '#3b82f6', // blue
    engineeringAccurate: false,
    dimensionVerified: true,
  },
  manufacturer_verified: {
    modelStatus: 'manufacturer_verified',
    label: 'Manufacturer verified',
    color: '#22c55e', // green
    engineeringAccurate: true,
    dimensionVerified: true,
  },
  sealed_approved: {
    modelStatus: 'sealed_approved',
    label: 'Sealed / PE approved',
    color: '#14b8a6', // teal
    engineeringAccurate: true,
    dimensionVerified: true,
  },
};

/**
 * Pure, deterministic badge for a tier. Every tier maps to exactly one badge.
 *
 * HARD INVARIANT: engineeringAccurate is true ONLY for manufacturer_verified
 * and sealed_approved. There is no code path that flips it true for
 * visual_reference / proxy / dimensioned_parametric.
 */
export function badgeFor(status: ModelStatus): AccuracyBadge {
  return BADGES[status];
}
