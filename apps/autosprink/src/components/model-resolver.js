/**
 * Component 3D-model resolver pipeline (T16).
 *
 * Resolves the best-available 3D model for a fire-sprinkler component by trying
 * INJECTED async sourcers in strict priority order:
 *
 *     catalog -> openscad -> sam -> placeholder
 *
 * The sourcers are passed in (never imported) so the whole pipeline is pure,
 * deterministic, and unit-testable offline — the real OpenSCAD / SAM3.1 / catalog
 * binaries are external and live behind those injected functions. Each sourcer is
 * `async (component) => { format, data, ... } | null`; returning null (or a model
 * with no real data, or throwing) means "I have nothing — try the next one".
 *
 * HONESTY / fail-closed: when no sourcer yields a real model the component
 * resolves to a GATED placeholder (source 'placeholder', status 'missing',
 * model null). A placeholder is NEVER reported as present. Generated
 * (OpenSCAD/SAM) models are clearly labelled best-effort, not manufacturer-exact.
 * No AutoSprink / AutoCAD / manufacturer parity and no AHJ/PE approval is claimed.
 */

/**
 * Priority chain: each step names its injected sourcer and the resolved
 * `source` tag plus the registry-facing source it maps to.
 *   - registrySource is what buildParityInventory understands ('catalog'|'generated').
 */
const RESOLUTION_CHAIN = Object.freeze([
  { sourcer: 'catalog', source: 'catalog', registrySource: 'catalog', best: false },
  { sourcer: 'openscad', source: 'generated_openscad', registrySource: 'generated', best: true },
  { sourcer: 'sam', source: 'generated_sam', registrySource: 'generated', best: true },
]);

/** A returned model is usable only if it is an object carrying non-empty `data`. */
function isUsableModel(model) {
  if (!model || typeof model !== 'object') return false;
  return model.data != null && model.data !== '';
}

/** Human-readable provenance label for a resolved component. */
function makeLabel(component, step) {
  const name = component && component.name ? component.name : component && component.key;
  if (!step) {
    return `${name} — placeholder (no model, gated)`;
  }
  if (step.source === 'catalog') {
    return `${name} — catalog model`;
  }
  // generated (OpenSCAD / SAM): best-effort, explicitly not manufacturer-exact.
  const kind = step.source === 'generated_openscad' ? 'OpenSCAD' : 'SAM 3.1';
  return `${name} — generated (${kind}, best-effort, not manufacturer-exact)`;
}

/**
 * Resolve a single component's 3D model.
 *
 * @param {{key:string,name?:string}} component  Registry component entry.
 * @param {{catalog?:Function, openscad?:Function, sam?:Function}} [sourcers]
 *   Injected async sourcers; each `(component) => {format,data,...}|null`.
 * @returns {Promise<{key:string, source:'catalog'|'generated_openscad'|'generated_sam'|'placeholder',
 *   status:'present'|'missing', model:object|null, label:string}>}
 */
export async function resolveComponentModel(component, sourcers = {}) {
  const src = sourcers || {};
  const key = component && component.key;

  for (const step of RESOLUTION_CHAIN) {
    const fn = src[step.sourcer];
    if (typeof fn !== 'function') continue;
    let model;
    try {
      model = await fn(component);
    } catch {
      // A throwing sourcer is treated as "no model" — fall through to the next.
      continue;
    }
    if (isUsableModel(model)) {
      return {
        key,
        source: step.source,
        status: 'present',
        model,
        label: makeLabel(component, step),
      };
    }
  }

  // Nothing real resolved — fail closed to a gated placeholder.
  return {
    key,
    source: 'placeholder',
    status: 'missing',
    model: null,
    label: makeLabel(component, null),
  };
}

/** Map a resolved source tag to the registry's accepted source vocabulary. */
function registrySourceFor(source) {
  if (source === 'catalog') return 'catalog';
  if (source === 'generated_openscad' || source === 'generated_sam') return 'generated';
  return 'placeholder';
}

/**
 * Resolve a whole library of components.
 *
 * @param {Array<{key:string,name?:string}>} components
 * @param {{catalog?:Function, openscad?:Function, sam?:Function}} [sourcers]
 * @returns {Promise<{ results:Array<object>,
 *   modelStatusByKey:Record<string,{source:string, model:object|null}> }>}
 *
 * `modelStatusByKey` is shaped for registry.buildParityInventory: each entry is
 * `{ source:'catalog'|'generated'|'placeholder', model }` so placeholders fail
 * closed to MISSING and only genuine catalog/generated models count as present.
 */
export async function resolveLibrary(components = [], sourcers = {}) {
  const list = Array.isArray(components) ? components : [];
  const results = [];
  const modelStatusByKey = {};

  for (const component of list) {
    const resolved = await resolveComponentModel(component, sourcers);
    results.push(resolved);
    modelStatusByKey[resolved.key] = {
      source: registrySourceFor(resolved.source),
      model: resolved.model,
    };
  }

  return { results, modelStatusByKey };
}
