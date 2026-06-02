/**
 * Autonomous component-model sourcing loop (S1 + S2 + S3).
 *
 * Drives the existing model-resolution stack to AUTONOMOUSLY source a 3D model
 * for every fire-sprinkler component the registry knows about, in three honest,
 * fail-soft ways, in strict priority:
 *
 *   S1  catalog  — FOUND on the public web (TraceParts/GrabCAD/etc.) via the
 *                  OpenClaw bridge (makeCatalogSourcer).
 *   S2  image    — CREATED from a catalog/cut-sheet image via SAM 3.1 (T18) or a
 *                  generate_3d_model bridge call (makeImageReconstructSourcer).
 *   openscad     — CREATED parametrically via the T17 OpenSCAD generators rendered
 *                  through an injected scadRunner (makeOpenScadSourcer).
 *
 * Every one of these is BEST-EFFORT geometry. Nothing here is manufacturer-exact:
 *
 *   - FOUND models carry recorded provenance (where they came from) + license, but
 *     machine-found provenance is UNVERIFIED, so manufacturerExact is ALWAYS false
 *     and they map to the registry source 'generated' (NOT 'catalog'/'manufacturer').
 *   - CREATED models (SAM / gen3d / OpenSCAD) are 'generated', manufacturerExact:false.
 *   - Only a user-attached model with explicit manufacturer + license evidence via
 *     Settings (the stricter model-pipeline.isManufacturerExact path) can ever be
 *     manufacturer-exact, and even then parity needs PE/AHJ sign-off. NOTHING in
 *     this module flips AUTOSPRINK_PARITY / manufacturer / AHJ / PE gates — they
 *     stay BLOCKED.
 *
 * FAIL-SOFT (NON-NEGOTIABLE): the OpenClaw / SAM bridge is NEVER imported or called
 * directly — it is injected as `opts.invoker` (async). When a bridge invoker is
 * absent / not a function / unreachable / throws / returns an empty result, the
 * sourcer returns null and the resolver advances to the next sourcer (or the
 * 'missing' placeholder). We NEVER throw, NEVER fabricate a model, a URL, or a
 * license.
 *
 * Pure + offline-testable: all I/O lives behind injected functions.
 */

import { COMPONENTS, buildParityInventory } from './registry.js';
import { manufacturerParityComplete } from './model-pipeline.js';
import { resolveComponentModel } from './model-resolver.js';
import { reconstructComponentModel } from './sam-reconstruct.js';
import { generateScadFor, renderScadToStl } from './openscad/generators.js';

/** Honesty disclaimer stamped on the auto-source report. */
const AUTO_SOURCE_DISCLAIMER =
  'Autonomously found/created best-effort geometry with recorded provenance; ' +
  'NOT manufacturer-exact; no AutoSprink/AutoCAD/AHJ/PE/manufacturer parity.';

/** A bridge result counts as usable only if it carries a non-empty model payload. */
function hasUsablePayload(result) {
  if (!result || typeof result !== 'object') return false;
  // a 'data' field (mesh bytes / reference) OR a 'url' to a downloadable model.
  const data = result.data;
  if (data != null && data !== '') return true;
  return typeof result.url === 'string' && result.url !== '';
}

/**
 * Build a deterministic web-catalog search query from a registry component.
 * Uses the human `name` as the primary phrase plus a few rich `params` tokens.
 *
 * @param {{name?:string, category?:string, params?:object}} component
 * @returns {string}
 */
export function buildCatalogSearchQuery(component) {
  const c = component || {};
  const parts = [];
  if (c.name) parts.push(String(c.name));

  const p = c.params || {};
  // Selected spec tokens that sharpen a TraceParts/GrabCAD query.
  if (Array.isArray(p.nominalSizesIn) && p.nominalSizesIn.length) {
    parts.push(`${p.nominalSizesIn[0]} in`);
  } else if (p.nominalIn != null) {
    parts.push(`${p.nominalIn} in`);
  }
  if (Array.isArray(p.kFactors) && p.kFactors.length) parts.push(`K${p.kFactors[0]}`);
  if (p.schedule != null) parts.push(`schedule ${p.schedule}`);
  if (p.thread) parts.push(String(p.thread));
  if (Array.isArray(p.type) && p.type.length) parts.push(String(p.type[0]));
  else if (typeof p.type === 'string') parts.push(p.type);

  parts.push('fire sprinkler');
  if (c.category) parts.push(String(c.category));
  parts.push('downloadable STEP STL OBJ CAD model');

  return parts.filter(Boolean).join(' ');
}

/**
 * S1 — make a "catalog" (web-found) sourcer for the resolver's 'catalog' slot.
 *
 * The returned function is `async (component) => modelObject | null`. It builds a
 * search prompt and calls the injected OpenClaw bridge invoker to FIND a publicly
 * downloadable CAD model. Fail-soft: absent / non-function / throws / empty -> null.
 *
 * On a usable structured result `{ url, format, data?, license?, manufacturer? }`
 * it returns a resolver-usable model OBJECT (non-empty `.data`):
 *   { data, source:'catalog', format, provenance:{ url, manufacturer },
 *     license, manufacturerExact:false }
 *
 * manufacturerExact is ALWAYS false — machine-found provenance is unverified. The
 * url/license/manufacturer are passed THROUGH from the bridge result; we never
 * fabricate them (missing fields stay null).
 *
 * @param {{ invoker?: (toolName:string, payload:object) => Promise<unknown> }} [opts]
 * @returns {(component:object) => Promise<object|null>}
 */
export function makeCatalogSourcer(opts = {}) {
  const invoker = opts && opts.invoker;
  return async function catalogSourcer(component) {
    if (typeof invoker !== 'function') return null;

    const query = buildCatalogSearchQuery(component);
    const payload = {
      tool: 'web_cad_search',
      op: 'find_downloadable_model',
      componentKey: component && component.key ? String(component.key) : null,
      query,
    };

    let result;
    try {
      result = await invoker('web_cad_search', payload);
    } catch {
      // bridge unreachable / threw -> nothing found, advance to next sourcer.
      return null;
    }

    if (!hasUsablePayload(result)) return null;

    // The model payload: prefer real data bytes, else a reference to the URL.
    const data = result.data != null && result.data !== '' ? result.data : result.url;

    return {
      data,
      source: 'catalog',
      format: result.format != null ? String(result.format) : null,
      provenance: {
        url: typeof result.url === 'string' ? result.url : null,
        manufacturer: result.manufacturer != null ? String(result.manufacturer) : null,
      },
      license: result.license != null ? String(result.license) : null,
      rejectedCandidates: Array.isArray(result.rejectedCandidates) ? result.rejectedCandidates : [],
      // Machine-found provenance is UNVERIFIED — never manufacturer-exact.
      manufacturerExact: false,
    };
  };
}

/**
 * S2 — make an "image reconstruct" sourcer for the resolver's 'sam' slot.
 *
 * The returned function is `async (component) => modelObject | null`. It reuses the
 * T18 `reconstructComponentModel` (SAM 3.1) to CREATE a mesh from a catalog /
 * cut-sheet image reference (`component.imageRef`). When SAM yields nothing usable
 * AND a `gen3d` invoker was supplied, it falls back to a generate_3d_model bridge
 * call. Fail-soft: absent invokers / failures -> null.
 *
 * On success returns a resolver-usable model OBJECT (non-empty `.data`):
 *   { data, source:'generated', subtype:'sam'|'gen3d', format:'stl',
 *     label, manufacturerExact:false }
 *
 * @param {{
 *   invoker?: (payload:object) => Promise<unknown>,   // SAM 3.1 invoker (T18)
 *   gen3dInvoker?: (payload:object) => Promise<unknown> // optional generate_3d_model
 * }} [opts]
 * @returns {(component:object) => Promise<object|null>}
 */
export function makeImageReconstructSourcer(opts = {}) {
  const invoker = opts && opts.invoker;
  const gen3dInvoker = opts && opts.gen3dInvoker;

  return async function imageReconstructSourcer(component) {
    const imageRef = component && component.imageRef != null ? component.imageRef : null;

    // ---- Primary: SAM 3.1 reconstruction (T18, fail-soft, never throws) ----
    if (typeof invoker === 'function') {
      const sam = await reconstructComponentModel(component, imageRef, { invoker });
      if (sam && sam.ok) {
        // T18 returns the raw mesh under .model; the resolver needs an OBJECT with
        // non-empty .data, so wrap it.
        return {
          data: sam.model,
          source: 'generated',
          subtype: 'sam',
          format: 'stl',
          label: sam.label,
          manufacturerExact: false,
        };
      }
    }

    // ---- Fallback: generate_3d_model bridge call (fail-soft) ----
    if (typeof gen3dInvoker === 'function') {
      const payload = {
        tool: 'generate_3d_model',
        op: 'reconstruct_from_image',
        componentKey: component && component.key ? String(component.key) : null,
        imageRef: imageRef == null ? null : String(imageRef),
        outputFormat: 'stl',
      };
      let result;
      try {
        result = await gen3dInvoker(payload);
      } catch {
        return null;
      }
      const data = result && typeof result === 'object' ? result.data : result;
      if (data == null || data === '') return null;
      return {
        data,
        source: 'generated',
        subtype: 'gen3d',
        format: 'stl',
        label: 'best-effort generate_3d_model reconstruction — NOT manufacturer-exact',
        manufacturerExact: false,
      };
    }

    // No usable invoker / nothing produced -> advance to next sourcer.
    return null;
  };
}

/**
 * Make an OpenSCAD sourcer for the resolver's 'openscad' slot.
 *
 * The returned function is `async (component) => modelObject | null`. It generates
 * .scad via the T17 generateScadFor and renders to STL through the injected
 * scadRunner (renderScadToStl). Fail-soft: no generator / no runner / runner
 * throws / empty STL -> null.
 *
 * On success returns a resolver-usable model OBJECT (non-empty `.data`):
 *   { data:<stl>, source:'generated', subtype:'openscad', format:'stl',
 *     scad, manufacturerExact:false }
 *
 * @param {{ scadRunner?: (scad:string) => Promise<{stl:string}|string> }} [opts]
 * @returns {(component:object) => Promise<object|null>}
 */
export function makeOpenScadSourcer(opts = {}) {
  const scadRunner = opts && typeof opts.scadRunner === 'function' ? opts.scadRunner : null;

  return async function openScadSourcer(component) {
    if (!scadRunner) return null;
    const scad = generateScadFor(component);
    if (scad == null || scad === '') return null;

    const rendered = await renderScadToStl(scad, { runner: scadRunner });
    if (!rendered.ok) return null;

    return {
      data: rendered.stl,
      source: 'generated',
      subtype: 'openscad',
      format: 'stl',
      scad,
      manufacturerExact: false,
    };
  };
}

/**
 * Map a resolved source tag to the registry's accepted source vocabulary FOR THE
 * AUTO-SOURCE LOOP.
 *
 * HONESTY (critical): everything this loop produces is MACHINE-driven —
 * autonomously FOUND on the web (resolver source 'catalog' from makeCatalogSourcer)
 * or CREATED (SAM / gen3d / OpenSCAD). Machine-found provenance is UNVERIFIED, so a
 * web-found model is registry 'generated' at MOST — NEVER registry 'catalog'
 * (which is the licensed/user vocabulary the registry treats as parity-eligible).
 * Downgrading 'catalog' -> 'generated' here is what keeps functional auto-source
 * coverage from EVER flipping the manufacturer/AutoSprink/AHJ/PE gate clear: the
 * stricter model-pipeline.isManufacturerExact path (sources 'catalog'|'manufacturer')
 * is reachable only by a user-attached, evidence-backed model via Settings.
 */
function registrySourceFor(source) {
  // 'catalog' here is a machine-FOUND web model -> registry 'generated', never 'catalog'.
  if (source === 'catalog') return 'generated';
  if (source === 'generated_openscad' || source === 'generated_sam') return 'generated';
  return 'placeholder';
}

/** Classify a resolved component into the report bucket it belongs to. */
function bucketFor(resolved) {
  if (resolved.status !== 'present') return 'missing';
  if (resolved.source === 'catalog') return 'found';
  if (resolved.source === 'generated_sam') return 'created';
  if (resolved.source === 'generated_openscad') return 'generated';
  return 'missing';
}

/**
 * S3 — run the autonomous sourcing loop across the registry.
 *
 * For each component, resolves the best-available model via resolveComponentModel
 * with the sourcer priority chain catalog (S1) -> openscad -> sam (S2). Builds the
 * fail-closed modelStatusByKey for honestly-sourced PRESENT parts (mirrors R1
 * part-mesh). The returned `parityGateStatus` is the GATE-GRADE manufacturer gate
 * (manufacturerParityComplete) and is ALWAYS 'blocked' here — auto-sourced models
 * are best-effort, never manufacturer-exact, so they can NEVER clear parity even at
 * 100% functional coverage. Functional coverage is reported separately in
 * `functionalCoverage` and is explicitly NOT a parity/approval claim.
 *
 * Idempotent + fail-soft: when every sourcer is absent/null/throwing, every
 * component falls through to 'missing' and the loop never throws.
 *
 * @param {{
 *   components?: Array<object>,
 *   sourcers?: { catalog?:Function, openscad?:Function, sam?:Function },
 *   scadRunner?: (scad:string)=>Promise<{stl:string}|string>,
 *   outDir?: string,
 *   write?: boolean,
 *   recorder?: (entry:object) => void,   // optional Brain-logging hook (injected)
 * }} [opts]
 * @returns {Promise<{
 *   found:string[], created:string[], generated:string[], missing:string[],
 *   results:Array<object>,
 *   report:{foundCount:number, createdCount:number, generatedCount:number, missingCount:number},
 *   modelStatusByKey:Record<string,{source:string, model:object|null}>,
 *   manufacturerExactCount:0,
 *   parityGateStatus:'blocked',   // gate-grade (manufacturer); never 'clear' for auto-sourced
 *   functionalCoverage:{present:number, total:number, complete:boolean},  // NOT a parity claim
 *   disclaimer:string,
 * }>}
 */
export async function runAutoSource(opts = {}) {
  const o = opts || {};
  const components = Array.isArray(o.components) ? o.components : COMPONENTS;
  const recorder = typeof o.recorder === 'function' ? o.recorder : null;

  // Assemble the sourcer chain. Explicitly-injected sourcers win; otherwise build
  // the OpenSCAD sourcer from scadRunner so callers can pass either form.
  const injected = o.sourcers || {};
  const sourcers = {
    catalog: typeof injected.catalog === 'function' ? injected.catalog : undefined,
    sam: typeof injected.sam === 'function' ? injected.sam : undefined,
    openscad:
      typeof injected.openscad === 'function'
        ? injected.openscad
        : o.scadRunner
          ? makeOpenScadSourcer({ scadRunner: o.scadRunner })
          : undefined,
  };

  const found = [];
  const created = [];
  const generated = [];
  const missing = [];
  const results = [];
  const modelStatusByKey = {};

  let outDir = null;
  if (o.write && o.outDir) {
    const fs = await import('node:fs');
    outDir = String(o.outDir);
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const component of components) {
    const resolved = await resolveComponentModel(component, sourcers);
    results.push(resolved);

    const bucket = bucketFor(resolved);
    if (bucket === 'found') found.push(resolved.key);
    else if (bucket === 'created') created.push(resolved.key);
    else if (bucket === 'generated') generated.push(resolved.key);
    else missing.push(resolved.key);

    // Fail-closed handoff: only honestly-sourced PRESENT parts go into the
    // inventory map; missing parts are omitted so they read as MISSING.
    if (resolved.status === 'present') {
      modelStatusByKey[resolved.key] = {
        source: registrySourceFor(resolved.source),
        model: resolved.model,
      };

      // Optional mesh write for generated/created parts that carry STL data.
      if (outDir && resolved.model && resolved.model.data != null && resolved.model.data !== '') {
        const fmt = resolved.model.format || 'stl';
        if (fmt === 'stl' && typeof resolved.model.data === 'string') {
          const fs = await import('node:fs');
          const path = await import('node:path');
          fs.writeFileSync(path.join(outDir, `${resolved.key}.stl`), resolved.model.data);
        }
      }
    }

    // Per-component provenance entry for Brain logging (injected recorder).
    if (recorder) {
      const model = resolved.model;
      recorder({
        key: resolved.key,
        category: component && component.category ? component.category : null,
        bucket,
        status: resolved.status,
        source: resolved.source,
        registrySource: registrySourceFor(resolved.source),
        provenance: model && model.provenance ? model.provenance : null,
        license: model && model.license != null ? model.license : null,
        // Never manufacturer-exact from any auto-source path.
        manufacturerExact: false,
        label: resolved.label,
      });
    }
  }

  const inventory = buildParityInventory(modelStatusByKey);

  // FAIL-CLOSED gate. parityGateStatus is the GATE-GRADE manufacturer gate, NOT
  // functional coverage. registry.buildParityInventory counts 'generated' as a
  // present "real source", so its functional parityComplete can go true once every
  // component has ANY best-effort model — that must NOT read as parity. We derive
  // the returned gate from manufacturerParityComplete (true only when EVERY required
  // component is manufacturer-exact), which is ALWAYS false for auto-sourced models
  // (they are all manufacturerExact:false / registry 'generated'). So this stays
  // 'blocked' even when found/created coverage is 100%. Functional coverage is
  // reported separately and is explicitly NOT a parity claim.
  const parityGateStatus = manufacturerParityComplete(modelStatusByKey) ? 'clear' : 'blocked';

  return {
    found,
    created,
    generated,
    missing,
    results,
    report: {
      foundCount: found.length,
      createdCount: created.length,
      generatedCount: generated.length,
      missingCount: missing.length,
    },
    modelStatusByKey,
    // Auto-sourced models are NEVER manufacturer-exact.
    manufacturerExactCount: 0,
    // Gate-grade, fail-closed: auto-sourced (best-effort) coverage never clears parity.
    parityGateStatus,
    // Functional model coverage — NOT a parity/approval claim. complete=true just
    // means every component has SOME best-effort model; the parity gate stays blocked.
    functionalCoverage: {
      present: inventory.present,
      total: inventory.total,
      complete: inventory.parityComplete,
    },
    disclaimer: AUTO_SOURCE_DISCLAIMER,
  };
}

export { AUTO_SOURCE_DISCLAIMER };
