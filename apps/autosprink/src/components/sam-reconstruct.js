/**
 * SAM 3.1 reconstruction adapter (T18).
 *
 * Turns a catalog image of a fire-sprinkler component into a best-effort 3D
 * mesh via the GX10 SAM 3.1 service. The flow is: catalog image -> SAM 3.1
 * segment + reconstruct -> mesh. SAM 3.1 itself is an EXTERNAL service (it runs
 * on GX10, reached through the OpenClaw bridge / hal_sam_status), so this module
 * never calls it directly. Instead it builds a deterministic request payload and
 * hands it to an INJECTED async `invoker(payload)` that production wires to the
 * bridge. That keeps the adapter fully unit-testable offline.
 *
 * HONESTY / fail-closed:
 *   - A SAM-reconstructed model is a BEST-EFFORT representation, NOT
 *     manufacturer-exact, and confers NO AutoSprink / AutoCAD / manufacturer
 *     parity and NO AHJ/PE approval. The returned `label` says so plainly.
 *   - If the invoker is absent / not a function (no bridge wired) OR throws
 *     (GX10 / gateway down) OR yields an empty mesh, we fail closed to
 *     { ok:false, skipped:true, reason } WITHOUT throwing. Success is never
 *     fabricated — a missing model stays missing for the parity inventory.
 *
 * Pure request-building + injected async I/O; browser-free; no external binary
 * or process is spawned here.
 */

/** Desired output mesh format requested from the SAM 3.1 service. */
const OUTPUT_FORMAT = 'stl';

/** Honesty label stamped on every successful reconstruction. */
const BEST_EFFORT_LABEL = 'best-effort SAM 3.1 reconstruction — NOT manufacturer-exact';

/** Extract a component key from either a component object or a bare string. */
function componentKeyOf(component) {
  if (typeof component === 'string') return component;
  if (component && typeof component === 'object' && component.key != null) {
    return String(component.key);
  }
  return null;
}

/**
 * Build the deterministic request payload for the GX10 SAM 3.1 service.
 *
 * @param {{key?:string}|string} component  Component entry (or bare key).
 * @param {string} imageRef  Reference (path/URL/id) to the catalog image.
 * @returns {{service:string, op:string, componentKey:(string|null),
 *   imageRef:(string|null), outputFormat:string}}
 *
 * Deterministic: same inputs always yield the same object.
 */
export function buildSamReconstructPayload(component, imageRef) {
  return {
    service: 'sam-3.1',
    op: 'reconstruct',
    componentKey: componentKeyOf(component),
    imageRef: imageRef == null ? null : String(imageRef),
    outputFormat: OUTPUT_FORMAT,
  };
}

/** A reconstructed model counts only if it is a non-empty mesh. */
function isUsableModel(model) {
  if (model == null || model === '') return false;
  return true;
}

/**
 * Reconstruct a component model from a catalog image via SAM 3.1.
 *
 * Calls the INJECTED async `invoker(payload)` (production wires the OpenClaw
 * bridge / hal_sam_status). On success returns the generated mesh with a
 * best-effort honesty label; on any failure mode it skips gracefully WITHOUT
 * throwing.
 *
 * @param {{key?:string}|string} component  Component entry (or bare key).
 * @param {string} imageRef  Reference to the catalog image to reconstruct from.
 * @param {{invoker?:(payload:object)=>Promise<unknown>}} [opts]
 * @returns {Promise<
 *   {ok:true, source:'generated_sam', model:unknown, label:string} |
 *   {ok:false, skipped:true, reason:string}
 * >}
 */
export async function reconstructComponentModel(component, imageRef, opts = {}) {
  const invoker = opts && opts.invoker;
  if (typeof invoker !== 'function') {
    return { ok: false, skipped: true, reason: 'sam_invoker_unavailable' };
  }

  const payload = buildSamReconstructPayload(component, imageRef);

  let model;
  try {
    model = await invoker(payload);
  } catch (err) {
    const reason = err && err.message ? `sam_invoke_failed: ${err.message}` : 'sam_invoke_failed';
    return { ok: false, skipped: true, reason };
  }

  if (!isUsableModel(model)) {
    return { ok: false, skipped: true, reason: 'sam_empty_model' };
  }

  return {
    ok: true,
    source: 'generated_sam',
    model,
    label: BEST_EFFORT_LABEL,
  };
}
