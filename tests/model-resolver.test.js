import { describe, it, expect } from 'vitest';
import {
  resolveComponentModel,
  resolveLibrary,
} from '../src/components/model-resolver.js';
import { buildParityInventory } from '../src/components/registry.js';

const COMPONENT = Object.freeze({
  key: 'head_pendent',
  category: 'heads',
  name: 'Pendent sprinkler head',
  params: { kFactors: [5.6] },
  required: true,
});

// --- mock sourcers --------------------------------------------------------
const catalogModel = { format: 'glb', data: 'CATALOG_BYTES' };
const openscadModel = { format: 'scad', data: 'cube();' };
const samModel = { format: 'obj', data: 'v 0 0 0' };

const catalogOk = async () => catalogModel;
const openscadOk = async () => openscadModel;
const samOk = async () => samModel;
const returnsNull = async () => null;
const throws = async () => {
  throw new Error('sourcer blew up');
};

describe('resolveComponentModel — priority order', () => {
  it('catalog wins over openscad and sam', async () => {
    const r = await resolveComponentModel(COMPONENT, {
      catalog: catalogOk,
      openscad: openscadOk,
      sam: samOk,
    });
    expect(r.key).toBe('head_pendent');
    expect(r.source).toBe('catalog');
    expect(r.status).toBe('present');
    expect(r.model).toEqual(catalogModel);
    expect(r.label).toContain('Pendent sprinkler head');
  });

  it('falls through to openscad when catalog is null', async () => {
    const r = await resolveComponentModel(COMPONENT, {
      catalog: returnsNull,
      openscad: openscadOk,
      sam: samOk,
    });
    expect(r.source).toBe('generated_openscad');
    expect(r.status).toBe('present');
    expect(r.model).toEqual(openscadModel);
  });

  it('falls through to sam when catalog and openscad are null', async () => {
    const r = await resolveComponentModel(COMPONENT, {
      catalog: returnsNull,
      openscad: returnsNull,
      sam: samOk,
    });
    expect(r.source).toBe('generated_sam');
    expect(r.status).toBe('present');
    expect(r.model).toEqual(samModel);
  });

  it('all-null sourcers -> placeholder/missing (gated, not faked)', async () => {
    const r = await resolveComponentModel(COMPONENT, {
      catalog: returnsNull,
      openscad: returnsNull,
      sam: returnsNull,
    });
    expect(r.source).toBe('placeholder');
    expect(r.status).toBe('missing');
    expect(r.model).toBeNull();
  });

  it('no sourcers at all -> placeholder/missing', async () => {
    const r = await resolveComponentModel(COMPONENT, {});
    expect(r.source).toBe('placeholder');
    expect(r.status).toBe('missing');
    expect(r.model).toBeNull();
  });

  it('a throwing sourcer is skipped and the next is tried', async () => {
    const r = await resolveComponentModel(COMPONENT, {
      catalog: throws,
      openscad: openscadOk,
      sam: samOk,
    });
    expect(r.source).toBe('generated_openscad');
    expect(r.status).toBe('present');
    expect(r.model).toEqual(openscadModel);
  });

  it('all sourcers throwing -> placeholder/missing', async () => {
    const r = await resolveComponentModel(COMPONENT, {
      catalog: throws,
      openscad: throws,
      sam: throws,
    });
    expect(r.source).toBe('placeholder');
    expect(r.status).toBe('missing');
    expect(r.model).toBeNull();
  });

  it('a sourcer returning a model with empty/missing data is treated as null', async () => {
    const r = await resolveComponentModel(COMPONENT, {
      catalog: async () => ({ format: 'glb' }), // no data
      openscad: openscadOk,
      sam: samOk,
    });
    expect(r.source).toBe('generated_openscad');
    expect(r.model).toEqual(openscadModel);
  });
});

describe('resolveLibrary — aggregation', () => {
  const headUpright = Object.freeze({
    key: 'head_upright',
    category: 'heads',
    name: 'Upright sprinkler head',
    params: {},
    required: true,
  });

  it('aggregates results and a registry-compatible modelStatusByKey', async () => {
    const lib = await resolveLibrary([COMPONENT, headUpright], {
      catalog: async (c) => (c.key === 'head_pendent' ? catalogModel : null),
      openscad: async (c) => (c.key === 'head_upright' ? openscadModel : null),
      sam: returnsNull,
    });

    expect(lib.results).toHaveLength(2);
    expect(lib.results[0].source).toBe('catalog');
    expect(lib.results[1].source).toBe('generated_openscad');

    // modelStatusByKey must feed buildParityInventory: catalog -> 'catalog',
    // generated_* -> 'generated', placeholder -> 'placeholder'.
    expect(lib.modelStatusByKey.head_pendent.source).toBe('catalog');
    expect(lib.modelStatusByKey.head_pendent.model).toEqual(catalogModel);
    expect(lib.modelStatusByKey.head_upright.source).toBe('generated');
    expect(lib.modelStatusByKey.head_upright.model).toEqual(openscadModel);
  });

  it('placeholder entries map to a registry MISSING status', async () => {
    const lib = await resolveLibrary([COMPONENT], { catalog: returnsNull });
    expect(lib.modelStatusByKey.head_pendent.source).toBe('placeholder');
    expect(lib.modelStatusByKey.head_pendent.model).toBeNull();

    // Feeding it to the real registry counts it as missing (fail-closed).
    const inv = buildParityInventory(lib.modelStatusByKey);
    expect(inv.missing).toContain('head_pendent');
    expect(inv.present).toBe(0);
  });

  it('present entries are counted present by buildParityInventory', async () => {
    const lib = await resolveLibrary([COMPONENT, headUpright], {
      catalog: async () => catalogModel,
    });
    const inv = buildParityInventory(lib.modelStatusByKey);
    expect(inv.present).toBe(2);
    expect(inv.missing).not.toContain('head_pendent');
    expect(inv.missing).not.toContain('head_upright');
  });
});
