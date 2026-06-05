/**
 * Component model generation pipeline (P4).
 *
 * Runs the T17 OpenSCAD parametric generators across the registry to produce a
 * BEST-EFFORT .scad source for every component we can honestly model, optionally
 * rendering each to STL through an INJECTED `scadRunner` (the real `openscad`
 * binary is external and lives behind that runner — this module NEVER spawns a
 * process). The result feeds registry.buildParityInventory so FUNCTIONAL
 * coverage rises as generated models land.
 *
 * HONESTY / fail-closed — the whole point of this epic:
 *   - Generated (OpenSCAD/SAM) geometry is approximate massing, explicitly NOT
 *     manufacturer-exact. It raises functional coverage but confers NO AutoSprink
 *     / AutoCAD / manufacturer parity and NO AHJ/PE approval.
 *   - generateScadFor returns null for categories we cannot model honestly; those
 *     components are simply absent from the library (no fake geometry invented).
 *   - manufacturerParityComplete() is the gate-grade check: it is satisfied ONLY
 *     when every required component carries catalog/manufacturer-exact evidence.
 *     A generated-only inventory NEVER completes manufacturer/PE parity, even if
 *     buildParityInventory's lenient functional-coverage rule reports complete.
 *
 * Pure, deterministic, browser-free. No real binary call here.
 */

import { COMPONENTS } from './registry.js';
import { generateScadFor, renderScadToStl } from './openscad/generators.js';

/**
 * Sources that represent genuine manufacturer-exact (catalog) models. Generated
 * massing is deliberately excluded — it is best-effort, not manufacturer-exact.
 */
const MANUFACTURER_SOURCES = Object.freeze(['catalog', 'manufacturer']);

/**
 * Does a model-status entry carry genuine manufacturer-exact evidence? This is
 * stricter than registry.hasRealModel (which accepts 'generated' for functional
 * coverage): only 'catalog'/'manufacturer' sources WITH a real model qualify.
 *
 * @param {{source?:string, model?:unknown}} [entry]
 * @returns {boolean}
 */
export function isManufacturerExact(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!MANUFACTURER_SOURCES.includes(entry.source)) return false;
  return entry.model != null && entry.model !== '';
}

/**
 * Gate-grade parity check: true ONLY when EVERY required registry component has
 * manufacturer-exact (catalog) evidence. Generated-only inventories always fail
 * this — that keeps the AUTOSPRINK_PARITY gate blocked on real catalog/PE
 * evidence regardless of how much functional coverage generated models provide.
 *
 * @param {Record<string, {source?:string, model?:unknown}>} [modelStatusByKey]
 * @returns {boolean}
 */
export function manufacturerParityComplete(modelStatusByKey = {}) {
  const status = modelStatusByKey || {};
  for (const c of COMPONENTS) {
    if (c.required && !isManufacturerExact(status[c.key])) return false;
  }
  return true;
}

/**
 * Generate .scad source (and optionally STL) for every component we can honestly
 * model, and build a registry-compatible modelStatusByKey marking them
 * 'generated'.
 *
 * @param {Array<{key:string,category?:string,name?:string,params?:object}>} [components]
 *   Defaults to the full registry COMPONENTS list.
 * @param {{scadRunner?:(scad:string)=>Promise<{stl:string}|string>}} [opts]
 *   Optional injected OpenSCAD runner. Absent -> source-only (no STL).
 * @returns {Promise<{
 *   results:Array<{key:string, source:'generated', hasScad:boolean, hasStl:boolean, scad:string}>,
 *   modelStatusByKey:Record<string,{source:'generated', model:object}>
 * }>}
 *
 * Components with no honest T17 generator are skipped entirely (no fake model).
 */
export async function generateLibrary(components = COMPONENTS, opts = {}) {
  const list = Array.isArray(components) ? components : [];
  const scadRunner = opts && typeof opts.scadRunner === 'function' ? opts.scadRunner : null;

  const results = [];
  const modelStatusByKey = {};

  for (const component of list) {
    const scad = generateScadFor(component);
    if (scad == null || scad === '') {
      // No honest parametric model for this category — skip (fail-closed, no fake).
      continue;
    }

    let hasStl = false;
    let stl = null;
    if (scadRunner) {
      const rendered = await renderScadToStl(scad, { runner: scadRunner });
      if (rendered.ok) {
        hasStl = true;
        stl = rendered.stl;
      }
    }

    const result = {
      key: component.key,
      source: 'generated',
      hasScad: true,
      hasStl,
      scad,
    };
    results.push(result);

    // Registry-facing status: a generated source with a real model object. This
    // counts toward FUNCTIONAL coverage but is NOT manufacturer-exact (see
    // isManufacturerExact / manufacturerParityComplete).
    modelStatusByKey[component.key] = {
      source: 'generated',
      model: { format: 'scad', source: scad, stl: hasStl ? stl : null, manufacturerExact: false },
    };
  }

  return { results, modelStatusByKey };
}
