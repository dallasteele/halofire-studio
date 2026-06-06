// PURE Add-Catalog state machine — no React / three / network imports.
//
// SCOPE (T54): the honest logic behind the studio "Add Catalog" UX, which offers
// the two paths the user asked for:
//   (a) "Convert drawing to CAD (SAM)" — wires the T48 SAM lane; DISABLED-BY-DEFAULT
//       / fail-closed when no SAM endpoint is configured.
//   (b) "Import / download available models" — a client-side STEP file input that
//       renders the chosen STEP via occt-import-js, plus the DURABLE path (drop a
//       folder into manufacturer-incoming/ then run import-manufacturer-step.mjs).
//
// HONESTY (hard, fail-closed):
//   - SAM is unavailable unless an invoker/endpoint is configured. The honest state
//     is "not-configured" — NEVER fabricated geometry, never a fake "ready".
//   - The import path only ACCEPTS a real .stp/.step file; anything else is rejected
//     with an honest reason. Client-side import is a PREVIEW; the durable
//     manufacturer_verified registration happens through the import script (which
//     stages the file + records its real sha256).

/** The two Add-Catalog paths. */
export type AddCatalogPath = 'sam-drawing' | 'import-model';

/** SAM lane availability for the Add-Catalog UX. */
export type SamLaneState =
  | { available: false; reason: 'sam_endpoint_not_configured' }
  | { available: true };

/**
 * Compute the SAM-lane state for the Add-Catalog UX. Available ONLY when a
 * configured invoker (function) is supplied — the SAME gate the building lane
 * uses (buildSamInvoker returns undefined with no bridgeUrl). With no invoker the
 * honest state is not-configured. NEVER fabricates availability.
 */
export function samLaneState(invoker: unknown): SamLaneState {
  if (typeof invoker === 'function') {
    return { available: true };
  }
  return { available: false, reason: 'sam_endpoint_not_configured' };
}

/** Result of validating a chosen file for the import path. */
export type ImportFileValidation =
  | { ok: true; ext: 'stp' | 'step' }
  | { ok: false; reason: 'no_file' | 'not_a_step_file' };

/**
 * Validate a chosen filename for the client-side STEP import path. Accepts ONLY a
 * real .stp / .step (case-insensitive) name; everything else is rejected with an
 * honest reason. Pure: filename in, decision out — never touches the file bytes.
 */
export function validateImportFileName(
  name: string | null | undefined,
): ImportFileValidation {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, reason: 'no_file' };
  }
  const lower = name.trim().toLowerCase();
  if (lower.endsWith('.step')) return { ok: true, ext: 'step' };
  if (lower.endsWith('.stp')) return { ok: true, ext: 'stp' };
  return { ok: false, reason: 'not_a_step_file' };
}

/** Honest copy for the durable import path (drop folder + run the script). */
export const DURABLE_IMPORT_INSTRUCTIONS =
  'To register a downloaded model permanently at the manufacturer-verified tier: ' +
  'drop its folder (containing the .stp/.step + license) into ' +
  'public/parts/manufacturer-incoming/<slug>/, then run ' +
  '`node scripts/import-manufacturer-step.mjs`. The script stages the file, ' +
  'computes its real sha256, and upserts the committed manifest. Licensed CAD ' +
  'binaries are gitignored (NOT redistributed); the manifest references them by ' +
  'url + sha256.';

/** Honest copy for the fail-closed SAM not-configured state. */
export const SAM_NOT_CONFIGURED_MESSAGE =
  'SAM endpoint not configured. The drawing-to-CAD lane is disabled by default — ' +
  'the studio never fabricates geometry. Configure a SAM bridge endpoint to enable ' +
  'best-effort raster segmentation (2D mask only, NOT a 3D model, NOT AHJ / PE / ' +
  'for-construction).';
