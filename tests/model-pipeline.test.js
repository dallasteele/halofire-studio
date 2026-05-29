import { describe, it, expect } from 'vitest';
import {
  generateLibrary,
  isManufacturerExact,
  manufacturerParityComplete,
} from '../src/components/model-pipeline.js';
import { COMPONENTS, buildParityInventory } from '../src/components/registry.js';
import { generateScadFor } from '../src/components/openscad/generators.js';

// Which registry components actually have an honest T17 parametric generator.
const MODELABLE = COMPONENTS.filter((c) => generateScadFor(c) != null);

describe('generateLibrary — source-only (no runner)', () => {
  it('produces a generated .scad per modelable component', async () => {
    const lib = await generateLibrary();
    // Every result we keep is marked generated, has scad, and no stl (no runner).
    const withScad = lib.results.filter((r) => r.hasScad);
    expect(withScad.length).toBe(MODELABLE.length);
    expect(withScad.length).toBeGreaterThan(0);
    for (const r of withScad) {
      expect(r.source).toBe('generated');
      expect(r.hasScad).toBe(true);
      expect(r.hasStl).toBe(false);
      expect(typeof r.scad).toBe('string');
      expect(r.scad.length).toBeGreaterThan(0);
      // Honesty disclaimer must ride along in the generated source.
      expect(r.scad).toContain('BEST-EFFORT');
      expect(r.scad).toContain('NOT manufacturer-exact');
    }
  });

  it('marks each generated component "generated" in modelStatusByKey', async () => {
    const lib = await generateLibrary();
    for (const c of MODELABLE) {
      const entry = lib.modelStatusByKey[c.key];
      expect(entry).toBeDefined();
      expect(entry.source).toBe('generated');
      expect(entry.model).toBeTruthy();
    }
    // Components T17 cannot model honestly are absent (no fake geometry).
    const notModelable = COMPONENTS.filter((c) => generateScadFor(c) == null);
    for (const c of notModelable) {
      expect(lib.modelStatusByKey[c.key]).toBeUndefined();
    }
  });

  it('present-count rises once generated models are fed to buildParityInventory', async () => {
    const empty = buildParityInventory({});
    expect(empty.present).toBe(0);

    const lib = await generateLibrary();
    const inv = buildParityInventory(lib.modelStatusByKey);
    expect(inv.present).toBeGreaterThan(empty.present);
    expect(inv.present).toBe(MODELABLE.length);
  });
});

describe('generated models do NOT complete AutoSprink/manufacturer parity (fail-closed)', () => {
  it('buildParityInventory.parityComplete stays false on generated-only models', async () => {
    const lib = await generateLibrary();
    const inv = buildParityInventory(lib.modelStatusByKey);
    // T17 cannot honestly model signs/trim/fdc/etc, so required ones are missing.
    expect(inv.parityComplete).toBe(false);
    expect(inv.missing.length).toBeGreaterThan(0);
  });

  it('isManufacturerExact distinguishes generated from manufacturer/catalog', () => {
    expect(isManufacturerExact({ source: 'generated', model: 'x' })).toBe(false);
    expect(isManufacturerExact({ source: 'placeholder', model: null })).toBe(false);
    expect(isManufacturerExact({ source: 'catalog', model: 'x' })).toBe(true);
    expect(isManufacturerExact({ source: 'manufacturer', model: 'x' })).toBe(true);
    // A catalog flag with no real model is NOT manufacturer-exact.
    expect(isManufacturerExact({ source: 'catalog', model: '' })).toBe(false);
    expect(isManufacturerExact(undefined)).toBe(false);
  });

  it('manufacturerParityComplete is false even if generated covers EVERY required component', () => {
    // Construct an (impossible-in-practice) map where every component has a
    // generated model — buildParityInventory might call that complete, but the
    // manufacturer/PE parity claim must STAY gated because generated != exact.
    const allGenerated = {};
    for (const c of COMPONENTS) {
      allGenerated[c.key] = { source: 'generated', model: 'scad-source' };
    }
    const inv = buildParityInventory(allGenerated);
    // Functional coverage is "complete" by the inventory's lenient rule...
    expect(inv.parityComplete).toBe(true);
    // ...but the manufacturer-exact parity claim is NOT satisfied: no row has
    // catalog/manufacturer evidence, so the parity gate stays blocked.
    expect(manufacturerParityComplete(allGenerated)).toBe(false);
  });

  it('manufacturerParityComplete becomes true only with catalog/manufacturer evidence on every required component', () => {
    const map = {};
    for (const c of COMPONENTS) {
      if (c.required) {
        map[c.key] = { source: 'catalog', model: 'CATALOG_BYTES' };
      } else {
        map[c.key] = { source: 'generated', model: 'scad-source' };
      }
    }
    expect(manufacturerParityComplete(map)).toBe(true);
    // Knock one required component down to generated -> parity gate re-blocks.
    const required = COMPONENTS.find((c) => c.required);
    map[required.key] = { source: 'generated', model: 'scad-source' };
    expect(manufacturerParityComplete(map)).toBe(false);
  });
});

describe('generateLibrary — injected runner renders STL', () => {
  it('renders STL via injected scadRunner without touching a real binary', async () => {
    const calls = [];
    const scadRunner = async (scad) => {
      calls.push(scad);
      return { stl: 'solid generated\nendsolid generated\n' };
    };
    const lib = await generateLibrary(MODELABLE, { scadRunner });
    expect(calls.length).toBe(MODELABLE.length);
    for (const r of lib.results) {
      expect(r.hasScad).toBe(true);
      expect(r.hasStl).toBe(true);
      expect(r.source).toBe('generated');
    }
  });

  it('a throwing runner fails closed to source-only (hasStl:false), still generated', async () => {
    const scadRunner = async () => {
      throw new Error('openscad blew up');
    };
    const lib = await generateLibrary(MODELABLE, { scadRunner });
    for (const r of lib.results) {
      expect(r.hasScad).toBe(true);
      expect(r.hasStl).toBe(false);
      expect(r.source).toBe('generated');
    }
    // Even with a broken render, parity stays gated.
    const inv = buildParityInventory(lib.modelStatusByKey);
    expect(inv.parityComplete).toBe(false);
  });

  it('accepts an explicit component subset', async () => {
    const subset = MODELABLE.slice(0, 2);
    const lib = await generateLibrary(subset);
    expect(lib.results).toHaveLength(2);
    expect(Object.keys(lib.modelStatusByKey)).toHaveLength(2);
  });
});
