// PURE manifest logic — no React / three imports.
// Maps the raw public/parts/parts-manifest.json into typed PartRecords.
//
// HONESTY: these meshes are source="generated" parametric massing. They are
// NOT manufacturer-exact and NOT dimensionally accurate / AHJ / fabrication-ready.
// This module never fabricates parts and never silently flips manufacturerExact.

import { deriveModelStatus, type ModelStatus } from './provenance';
import {
  applyManufacturerStep,
  type ManufacturerStepManifest,
} from './manufacturer-step';

export interface RawComponent {
  key: string;
  category: string;
  name: string;
  required?: boolean;
  manufacturerExact?: boolean;
  source?: string;
  present?: boolean;
  file?: string | null;
  format?: string | null;
}

export interface RawManifest {
  generatedAt?: string;
  openscadInstalled?: boolean;
  manufacturerExact?: boolean;
  components?: RawComponent[];
  generatedCount?: number;
  missingCount?: number;
  manufacturerExactCount?: number;
  parityGateStatus?: string;
  disclaimer?: string;
}

export interface PartRecord {
  key: string;
  category: string;
  name: string;
  source: string;
  manufacturerExact: boolean;
  present: boolean;
  /** Original relative file path from the manifest, e.g. "parts/head_pendent.stl" or null. */
  file: string | null;
  /** Public URL derived from `file`, e.g. "/parts/head_pendent.stl". null when no file. */
  stlUrl: string | null;
  /**
   * Accuracy tier derived from `source` + `manufacturerExact` (fail-safe to the
   * lowest tier). Generated/OpenSCAD parts derive "visual_reference".
   */
  modelStatus: ModelStatus;
  /**
   * Operator-supplied manufacturer STEP file URL. ONLY set when the
   * manufacturer-step manifest has a verified entry for this part key. Used by
   * the part viewer to load real CAD geometry instead of the STL massing.
   */
  stepUrl?: string;
  /** Manufacturer product code / SKU. Set only with a verified upgrade. */
  productCode?: string;
  /** Manufacturer name. Set only with a verified upgrade. */
  manufacturer?: string;
}

/**
 * Derive a public-served URL from a manifest file path.
 * Strips a single leading "parts/" segment and prefixes "/parts/".
 *   "parts/head_pendent.stl" -> "/parts/head_pendent.stl"
 * Returns null when there is no file (missing parts).
 */
export function deriveStlUrl(file: string | null | undefined): string | null {
  if (!file) {
    return null;
  }
  const trimmed = file.replace(/^parts\//, '');
  return `/parts/${trimmed}`;
}

/**
 * Map the raw manifest into typed PartRecords.
 * Preserves source/manufacturerExact exactly as written — never fabricates a part,
 * never invents a stlUrl for a part with no file.
 *
 * When `manufacturerStep` is provided, applyManufacturerStep is invoked AFTER
 * normalization to upgrade records whose key matches an operator-verified entry.
 * Records without a verified entry are returned UNCHANGED. The default-arg path
 * (no `manufacturerStep`) preserves legacy behavior byte-for-byte.
 */
export function normalizeManifest(
  raw: RawManifest | null | undefined,
  manufacturerStep?: ManufacturerStepManifest | null,
): PartRecord[] {
  const components = raw?.components ?? [];
  const base = components.map((c) => {
    const file = c.file ?? null;
    return {
      key: c.key,
      category: c.category,
      name: c.name,
      source: c.source ?? 'unknown',
      // Honest pass-through: default false, never coerce to true.
      manufacturerExact: c.manufacturerExact === true,
      present: c.present === true,
      file,
      stlUrl: deriveStlUrl(file),
      // Derived honestly from source + manufacturerExact; never an upgrade.
      modelStatus: deriveModelStatus({
        source: c.source,
        manufacturerExact: c.manufacturerExact,
      }),
    } satisfies PartRecord;
  });
  if (manufacturerStep == null) {
    return base;
  }
  return applyManufacturerStep(base, manufacturerStep);
}

/** Only the parts that actually have a present mesh. */
export function presentParts(records: PartRecord[]): PartRecord[] {
  return records.filter((r) => r.present === true);
}

/** Group records by category, preserving insertion order within each bucket. */
export function partsByCategory(records: PartRecord[]): Map<string, PartRecord[]> {
  const map = new Map<string, PartRecord[]>();
  for (const r of records) {
    const bucket = map.get(r.category);
    if (bucket) {
      bucket.push(r);
    } else {
      map.set(r.category, [r]);
    }
  }
  return map;
}
