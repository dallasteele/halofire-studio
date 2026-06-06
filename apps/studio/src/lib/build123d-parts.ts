// PURE build123d parametric-STEP ingestion logic — no React / three / network.
//
// SCOPE (T45): Tier-2 DIMENSIONED parts. The scripts/build123d/generate_parts.py
// generator emits REAL parametric STEP solids (driven by explicit dimension
// specs) into /parts/build123d/<key>.step and records each in
// /parts/build123d-parts.json. This module ingests that manifest and upgrades
// matched catalog records from "generated" (visual_reference) to source
// "build123d" -> deriveModelStatus "dimensioned_parametric".
//
// HONESTY (hard, fail-closed):
//   - An entry counts as parametric-verified ONLY when BOTH a real stepUrl AND
//     a real sha256 are present (isParametricVerified). Anything weaker is
//     ignored and the record stays visual_reference.
//   - A key matching NO record never fabricates a part.
//   - "dimensioned_parametric" means "real parametric CAD dimensions" — it is
//     explicitly NOT manufacturer-exact, NOT AHJ / PE / permit / code-compliant.
//   - When build123d was unavailable at generation time the shipped manifest is
//     {entries:[]} (honest empty) and NOTHING is upgraded.
//   - manufacturer_verified MUST WIN over build123d on a key collision: this
//     module never downgrades an already manufacturer_verified record (guarded
//     in applyBuild123dParts).

import { deriveModelStatus } from './provenance';
import type { PartRecord } from './parts-manifest';

/** Dimension block carried alongside a build123d entry (mm-based, honest intent). */
export interface Build123dDimensions {
  nptSize?: string;
  bodyLengthMm?: number;
  deflectorDiaMm?: number;
  kFactorLabel?: string;
  units?: string;
}

/**
 * One generator-produced build123d entry. `key` matches the catalog part key
 * (e.g. "head_pendent"). stepUrl + sha256 are MANDATORY for the entry to count
 * as parametric-verified (see isParametricVerified).
 */
export interface Build123dPartEntry {
  /** Catalog part key this entry upgrades (e.g. "head_pendent"). */
  key: string;
  /** Always "build123d" for this manifest. */
  source: 'build123d';
  /** Parametric product code, e.g. "B123D-HEAD-PEND-050". */
  productCode: string;
  /** Optional human-readable name. */
  name?: string;
  /**
   * URL / relative path to the generated STEP file under /parts/build123d/.
   * Empty / missing disqualifies the entry (fail-safe).
   */
  stepUrl: string;
  /** SHA-256 of the generated STEP file. REQUIRED for parametric-verified. */
  sha256?: string;
  /** Explicit dimension spec the part was generated from. */
  dimensions?: Build123dDimensions;
}

export interface Build123dManifest {
  entries: Build123dPartEntry[];
}

/**
 * Parametric-verified = BOTH a real stepUrl (https/file/relative path with a
 * .step/.stp extension or a leading path) AND a non-empty sha256. Anything
 * weaker fails CLOSED to visual_reference upstream.
 *
 * This is the only place that grants the build123d upgrade — never bypass it.
 */
export function isParametricVerified(
  entry: Build123dPartEntry | null | undefined,
): boolean {
  if (!entry) {
    return false;
  }
  const url = entry.stepUrl;
  if (typeof url !== 'string') {
    return false;
  }
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
 * Apply a build123d manifest to a list of PartRecords.
 *
 * For every record whose key matches a parametric-verified entry AND that is
 * NOT already a higher tier (manufacturer_verified / sealed_approved):
 *   - source becomes "build123d"
 *   - stepUrl, productCode are written
 *   - modelStatus is recomputed via deriveModelStatus (-> "dimensioned_parametric")
 *
 * Records with NO matching entry, with a non-verified entry, or that are
 * already manufacturer_verified / sealed_approved are returned UNCHANGED.
 * This preserves the honesty spine: build123d never downgrades a higher tier
 * and never fabricates a part for an unmatched key.
 */
export function applyBuild123dParts(
  records: PartRecord[],
  manifest: Build123dManifest | null | undefined,
): PartRecord[] {
  const entries = manifest?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return records.map((r) => ({ ...r }));
  }

  // key -> verified-entry index. Non-verified entries are skipped so they
  // cannot win on a key collision.
  const byKey = new Map<string, Build123dPartEntry>();
  for (const e of entries) {
    if (isParametricVerified(e)) {
      byKey.set(e.key, e);
    }
  }

  return records.map((rec) => {
    const entry = byKey.get(rec.key);
    if (!entry) {
      return { ...rec };
    }
    // Guard: never downgrade a record that already earned a higher tier.
    // manufacturer_verified MUST WIN over build123d.
    if (
      rec.modelStatus === 'manufacturer_verified' ||
      rec.modelStatus === 'sealed_approved'
    ) {
      return { ...rec };
    }
    const source = 'build123d';
    return {
      ...rec,
      source,
      stepUrl: entry.stepUrl,
      productCode: entry.productCode,
      dimensions: entry.dimensions,
      // Derived honestly: build123d -> dimensioned_parametric.
      modelStatus: deriveModelStatus({ source, manufacturerExact: rec.manufacturerExact }),
    };
  });
}

/**
 * Fail-soft loader. With NO fetch implementation supplied, or a fetch that
 * fails / returns non-2xx / yields invalid JSON / has no entries array, this
 * returns an EMPTY manifest. This is the honest default — if build123d was
 * unavailable at generation time the shipped file is also {entries:[]}.
 */
export async function loadBuild123dManifest(
  fetchImpl?: typeof fetch,
): Promise<Build123dManifest> {
  const empty: Build123dManifest = { entries: [] };
  if (typeof fetchImpl !== 'function') {
    return empty;
  }
  try {
    const res = await fetchImpl('/parts/build123d-parts.json');
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
      (e): e is Build123dPartEntry =>
        !!e && typeof e === 'object' && typeof (e as { key?: unknown }).key === 'string',
    );
    return { entries };
  } catch {
    return empty;
  }
}
