// PURE manufacturer-STEP ingestion logic — no React / three / network imports.
//
// SCOPE (T44): This module BUILDS THE INFRASTRUCTURE for an OPERATOR to drop
// a real manufacturer-supplied STEP file into the studio and upgrade a part
// from provenance "visual_reference" (OpenSCAD massing) to "manufacturer_verified".
//
// HONESTY (hard, fail-closed):
//   - This module DOES NOT scrape, fetch, or fabricate manufacturer CAD files.
//     The shipped /parts/manufacturer-step.json is intentionally EMPTY.
//   - An entry only counts as operator-verified when BOTH a real stepUrl AND a
//     real sha256 are present. Anything else stays visual_reference.
//   - A key that matches NO record never fabricates a part.
//   - "manufacturer_verified" means "manufacturer-CAD-accurate" — NOT permit-
//     ready, NOT AHJ / PE / fabrication-ready. The Inspector caption preserves
//     this distinction; this module does not weaken provenance.
//
// Aligns with provenance.ts: source="manufacturer-step" + manufacturerExact===true
// is the ONLY combination that derives ModelStatus "manufacturer_verified".

import type { PartRecord } from './parts-manifest';

/**
 * One operator-supplied manufacturer-STEP entry. `key` matches the catalog
 * part key (e.g. "head_pendent"). stepUrl + sha256 are MANDATORY for the entry
 * to count as operator-verified (see isOperatorVerified).
 */
export interface ManufacturerStepEntry {
  /** Catalog part key this entry replaces (e.g. "head_pendent"). */
  key: string;
  /** Manufacturer name, e.g. "Viking", "Tyco", "Victaulic". */
  manufacturer: string;
  /** Manufacturer product code / SKU. */
  productCode: string;
  /** Human-readable model name. */
  modelName: string;
  /**
   * URL or relative path to the STEP file. MUST be https://, file://, or a
   * relative/absolute path. An empty string / missing field disqualifies the
   * entry from operator-verified status (fail-safe).
   */
  stepUrl: string;
  /** Optional glb preview URL for a lightweight fallback render. */
  glbPreviewUrl?: string;
  /** Optional source/citation URL (manufacturer page). */
  sourceUrl?: string;
  /** SHA-256 of the STEP file. REQUIRED for operator-verified status. */
  sha256?: string;
  /** Optional physical attributes captured at ingestion time. */
  dimensions?: {
    uprightOrientation?: string;
    threadSize?: string;
    kFactor?: number;
    deflectorType?: string;
  };
}

export interface ManufacturerStepManifest {
  entries: ManufacturerStepEntry[];
}

/**
 * Operator-verified = BOTH a real stepUrl (https/file/relative path) AND a
 * non-empty sha256. Anything weaker fails CLOSED to visual_reference upstream.
 *
 * This is the only place that grants the upgrade — never bypass it.
 */
export function isOperatorVerified(entry: ManufacturerStepEntry | null | undefined): boolean {
  if (!entry) {
    return false;
  }
  const url = entry.stepUrl;
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }
  // Accept https://, file://, or a relative/absolute filesystem path. Reject
  // bare nonsense like spaces-only or obviously empty strings.
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const looksLikeUrl =
    trimmed.startsWith('https://') ||
    trimmed.startsWith('file://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    // Bare filename or relative path (e.g. "parts/foo.step")
    /^[A-Za-z0-9_./-]+\.(step|stp|STEP|STP)$/.test(trimmed);
  if (!looksLikeUrl) {
    return false;
  }
  const sha = entry.sha256;
  if (typeof sha !== 'string' || sha.trim().length === 0) {
    return false;
  }
  return true;
}

/**
 * Apply a manufacturer-step manifest to a list of PartRecords.
 *
 * For every record whose key matches an operator-verified entry:
 *   - source becomes "manufacturer-step"
 *   - manufacturerExact becomes true
 *   - stepUrl, productCode, manufacturer are written
 *   - modelStatus is recomputed via deriveModelStatus (-> "manufacturer_verified")
 *
 * Records with NO matching entry, or with an entry that is not
 * operator-verified, are returned UNCHANGED. This is the hard honesty
 * invariant: no operator entry, no upgrade.
 */
export function applyManufacturerStep(
  records: PartRecord[],
  manifest: ManufacturerStepManifest | null | undefined,
): PartRecord[] {
  const entries = manifest?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    // Empty / missing manifest: return records UNCHANGED (same array contents).
    return records.map((r) => ({ ...r }));
  }

  // Build a key -> verified-entry index. NON-verified entries are intentionally
  // skipped here so they cannot silently win on a key collision.
  const byKey = new Map<string, ManufacturerStepEntry>();
  for (const e of entries) {
    if (isOperatorVerified(e)) {
      byKey.set(e.key, e);
    }
  }

  return records.map((rec) => {
    const entry = byKey.get(rec.key);
    if (!entry) {
      // No verified entry for this key -> unchanged. Hard invariant.
      return { ...rec };
    }
    return {
      ...rec,
      source: 'manufacturer-step',
      manufacturerExact: true,
      stepUrl: entry.stepUrl,
      productCode: entry.productCode,
      manufacturer: entry.manufacturer,
      // Derived honestly downstream by normalizeManifest's caller-friendly
      // wrapper; we also recompute here so a caller using applyManufacturerStep
      // directly sees the upgraded tier.
      modelStatus: 'manufacturer_verified' as const,
    };
  });
}

/**
 * Fail-soft loader. With NO fetch implementation supplied, or a fetch that
 * fails / returns non-2xx / yields invalid JSON / has no entries array, this
 * returns an EMPTY manifest. This is the honest default — see the shipped
 * /parts/manufacturer-step.json which is also empty.
 */
export async function loadManufacturerStepManifest(
  fetchImpl?: typeof fetch,
): Promise<ManufacturerStepManifest> {
  const empty: ManufacturerStepManifest = { entries: [] };
  if (typeof fetchImpl !== 'function') {
    return empty;
  }
  try {
    const res = await fetchImpl('/parts/manufacturer-step.json');
    if (!res || !res.ok) {
      return empty;
    }
    const json = (await res.json()) as unknown;
    if (
      !json ||
      typeof json !== 'object' ||
      !Array.isArray((json as { entries?: unknown }).entries)
    ) {
      return empty;
    }
    const entries = (json as { entries: unknown[] }).entries.filter(
      (e): e is ManufacturerStepEntry =>
        !!e && typeof e === 'object' && typeof (e as { key?: unknown }).key === 'string',
    );
    return { entries };
  } catch {
    // Parse / network errors -> empty manifest (honest, fail-soft default).
    return empty;
  }
}
