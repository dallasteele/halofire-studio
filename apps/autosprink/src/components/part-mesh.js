/**
 * Part-mesh build pipeline (R1).
 *
 * Walks the canonical component registry and, for every component we can
 * honestly model (generateScadFor returns .scad source), renders an STL through
 * an INJECTED scadRunner and emits a manifest entry. This module is the
 * deliverable-oriented sibling of model-pipeline.js: where that one tracks
 * source-level generated coverage, this one tracks whether a real STL MESH
 * exists for a part (the thing the studio render and parts API consume).
 *
 * HONESTY / fail-closed (NON-NEGOTIABLE):
 *   - Generated OpenSCAD meshes are real geometry but explicitly NOT
 *     manufacturer-exact. Every entry carries source ('catalog'|'generated'|
 *     'missing') and manufacturerExact (true ONLY for a licensed catalog/
 *     manufacturer model with evidence — NEVER for generated). This pipeline
 *     only ever produces 'generated' or 'missing', so manufacturerExactCount is
 *     ALWAYS 0 here.
 *   - The openscad binary is NEVER spawned in this module. It is reached only
 *     through the injected scadRunner (same contract as renderScadToStl). With
 *     no runner, or a runner that throws / yields empty bytes, the part is
 *     'missing' — no STL file is written and no file path is claimed.
 *   - Generated/missing parts NEVER flip AUTOSPRINK_PARITY or any AHJ/PE/
 *     manufacturer gate. parityGateStatus is derived from the same fail-closed
 *     registry logic and stays 'blocked' because required non-generatable
 *     components (signs, riser trim, FDC, etc.) have no generator.
 *
 * Pure except for the optional file write (write===true with an outDir).
 */

import fs from 'node:fs';
import path from 'node:path';

import { COMPONENTS } from './registry.js';
import { buildParityInventory, parityGateStatus } from './registry.js';
import { generateScadFor, renderScadToStl } from './openscad/generators.js';

const DISCLAIMER =
  'Best-effort parametric massing; NOT manufacturer-exact; ' +
  'no AutoSprink/AutoCAD/AHJ/PE approval.';

/**
 * Build the part-mesh manifest from the registry, rendering STL through an
 * injected scadRunner.
 *
 * @param {{
 *   scadRunner?:(scad:string)=>Promise<{stl:string}|string>,
 *   outDir?:string,
 *   write?:boolean,
 * }} [opts]
 * @returns {Promise<{
 *   components:Array<{
 *     key:string, category:string, name:string, required:boolean,
 *     source:'generated'|'missing', file:string|null, format:'stl'|null,
 *     manufacturerExact:false, present:boolean
 *   }>,
 *   generatedCount:number,
 *   missingCount:number,
 *   manufacturerExactCount:number,
 *   parityGateStatus:'clear'|'blocked',
 *   disclaimer:string,
 * }>}
 *
 * For each registry COMPONENT:
 *   - generateScadFor -> null  => source:'missing', present:false, file:null.
 *   - scad present but no runner / runner throws / empty STL
 *                              => source:'missing', present:false, file:null
 *                                 (NO file fabricated).
 *   - scad present AND a real STL rendered
 *                              => source:'generated', present:true,
 *                                 file:'parts/<key>.stl', format:'stl',
 *                                 manufacturerExact:false. When write===true and
 *                                 outDir is given, the STL is written to
 *                                 outDir/<key>.stl.
 *
 * manufacturerExactCount is ALWAYS 0 (generated is never manufacturer-exact).
 * parityGateStatus stays 'blocked' (required non-generatable parts are missing).
 */
export async function buildPartManifest(opts = {}) {
  const scadRunner =
    opts && typeof opts.scadRunner === 'function' ? opts.scadRunner : null;
  const write = Boolean(opts && opts.write);
  const outDir = opts && opts.outDir ? String(opts.outDir) : null;

  if (write && outDir) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const components = [];
  const modelStatusByKey = {};
  let generatedCount = 0;
  let missingCount = 0;

  for (const component of COMPONENTS) {
    const base = {
      key: component.key,
      category: component.category,
      name: component.name,
      required: Boolean(component.required),
      manufacturerExact: false, // never manufacturer-exact in this pipeline
    };

    const scad = generateScadFor(component);

    let present = false;
    let stl = null;
    if (scad != null && scad !== '' && scadRunner) {
      const rendered = await renderScadToStl(scad, { runner: scadRunner });
      if (rendered.ok) {
        present = true;
        stl = rendered.stl;
      }
    }

    if (present) {
      generatedCount += 1;
      const file = `parts/${component.key}.stl`;
      if (write && outDir) {
        fs.writeFileSync(path.join(outDir, `${component.key}.stl`), stl);
      }
      // Functional-coverage status feed (mirrors model-pipeline): a generated
      // source carrying a real model. Used ONLY for the functional parity
      // inventory — never to claim manufacturer-exact parity.
      modelStatusByKey[component.key] = {
        source: 'generated',
        model: { format: 'stl', source: scad, stl, manufacturerExact: false },
      };
      components.push({
        ...base,
        source: 'generated',
        present: true,
        file,
        format: 'stl',
      });
    } else {
      missingCount += 1;
      components.push({
        ...base,
        source: 'missing',
        present: false,
        file: null,
        format: null,
      });
    }
  }

  // Fail-closed gate: derived from the functional inventory of present
  // generated parts. Required non-generatable components (identification_sign,
  // riser_trim, fdc, gauge, ...) have no generator and stay missing, so this
  // stays 'blocked'. It NEVER reflects manufacturer-exact parity.
  const inventory = buildParityInventory(modelStatusByKey);
  const gate = parityGateStatus(inventory);

  return {
    components,
    generatedCount,
    missingCount,
    manufacturerExactCount: 0, // generated is NEVER manufacturer-exact
    parityGateStatus: gate,
    disclaimer: DISCLAIMER,
  };
}

export { DISCLAIMER as PART_MESH_DISCLAIMER };
