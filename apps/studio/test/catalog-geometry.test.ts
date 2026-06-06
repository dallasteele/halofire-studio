import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveCatalogGeometry,
  resolveCatalogGeometryAll,
  loadAiPlaceholderManifest,
  type AiPlaceholderManifest,
} from '../src/lib/catalog-geometry';
import type { CatalogPart } from '../src/lib/manufacturer-catalog';
import type { Build123dManifest } from '../src/lib/build123d-parts';
import type { ManufacturerStepManifest } from '../src/lib/manufacturer-step';

function sku(over: Partial<CatalogPart> = {}): CatalogPart {
  return {
    id: 'reliable-ra1314',
    mfr: 'Reliable',
    model: 'Model F1-56',
    sin: 'RA1314',
    category: 'head_pendent',
    kFactor: 5.6,
    port: { method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' },
    tempRatingsF: [155],
    responseType: 'standard',
    finishes: null,
    datasheetUrl: 'https://example.com/sheet.pdf',
    sourceUrl: 'https://example.com/sheet.pdf',
    ...over,
  };
}

function b123(entries: Build123dManifest['entries']): Build123dManifest {
  return { entries };
}

const PENDENT_050 = {
  key: 'head_pendent',
  source: 'build123d' as const,
  productCode: 'B123D-HEAD-PEND-050',
  name: 'Pendent Head 1/2 in (parametric)',
  stepUrl: '/parts/build123d/head_pendent.step',
  sha256: 'realsha',
  category: 'head_pendent',
  nominalSizeIn: 0.5,
};
const PENDENT_075 = {
  ...PENDENT_050,
  key: 'head_pendent_075',
  stepUrl: '/parts/build123d/head_pendent_075.step',
  nominalSizeIn: 0.75,
};
const UPRIGHT_050 = {
  ...PENDENT_050,
  key: 'head_upright',
  stepUrl: '/parts/build123d/head_upright.step',
  category: 'head_upright',
  nominalSizeIn: 0.5,
};

describe('resolveCatalogGeometry — build123d match by (category, nominalSizeIn)', () => {
  it('matches a pendent 1/2" SKU to the 1/2" pendent build123d body -> dimensioned_parametric', () => {
    const geo = resolveCatalogGeometry(sku(), {
      build123dParts: b123([PENDENT_050, PENDENT_075, UPRIGHT_050]),
    });
    expect(geo.source).toBe('build123d');
    expect(geo.modelStatus).toBe('dimensioned_parametric');
    expect(geo.assetUrl).toBe('/parts/build123d/head_pendent.step');
    expect(geo.build123dKey).toBe('head_pendent');
    expect(geo.engineeringAccurate).toBe(false);
  });

  it('matches a pendent 3/4" SKU to the 3/4" body (size discrimination)', () => {
    const geo = resolveCatalogGeometry(
      sku({ id: 'x', port: { method: 'THREADED_NPT', nominalSizeIn: 0.75, role: 'INLET' } }),
      { build123dParts: b123([PENDENT_050, PENDENT_075]) },
    );
    expect(geo.source).toBe('build123d');
    expect(geo.build123dKey).toBe('head_pendent_075');
    expect(geo.assetUrl).toBe('/parts/build123d/head_pendent_075.step');
  });

  it('discriminates by category: an upright SKU never matches a pendent body', () => {
    const geo = resolveCatalogGeometry(
      sku({ id: 'u', category: 'head_upright' }),
      { build123dParts: b123([PENDENT_050]) },
    );
    // No upright body present -> falls through to none (NOT the pendent body).
    expect(geo.source).toBe('none');
    expect(geo.modelStatus).toBeNull();
  });

  it('fail-safe: a SKU with a size that has no build123d body -> none', () => {
    const geo = resolveCatalogGeometry(
      sku({ id: 'big', port: { method: 'THREADED_NPT', nominalSizeIn: 1.0, role: 'INLET' } }),
      { build123dParts: b123([PENDENT_050, PENDENT_075]) },
    );
    expect(geo.source).toBe('none');
    expect(geo.assetUrl).toBeNull();
  });

  it('fail-safe: a SKU with a null port size cannot be size-matched -> none', () => {
    const geo = resolveCatalogGeometry(sku({ id: 'np', port: null }), {
      build123dParts: b123([PENDENT_050]),
    });
    expect(geo.source).toBe('none');
  });

  it('ignores a build123d entry without a real sha256 (not parametric-verified)', () => {
    const noSha = { ...PENDENT_050, sha256: undefined };
    const geo = resolveCatalogGeometry(sku(), { build123dParts: b123([noSha]) });
    expect(geo.source).toBe('none');
  });
});

describe('resolveCatalogGeometry — PRIORITY ladder', () => {
  const mfg: ManufacturerStepManifest = {
    entries: [
      {
        key: 'reliable-ra1314',
        manufacturer: 'Reliable',
        productCode: 'RA1314',
        modelName: 'Model F1-56',
        stepUrl: '/parts/mfg/ra1314.step',
        sha256: 'mfgsha',
      },
    ],
  };

  it('manufacturer-step WINS over build123d (and is the ONLY engineeringAccurate tier)', () => {
    const geo = resolveCatalogGeometry(sku(), {
      manufacturerStep: mfg,
      build123dParts: b123([PENDENT_050]),
    });
    expect(geo.source).toBe('manufacturer-step');
    expect(geo.modelStatus).toBe('manufacturer_verified');
    expect(geo.assetUrl).toBe('/parts/mfg/ra1314.step');
    expect(geo.engineeringAccurate).toBe(true);
  });

  it('build123d WINS over ai-placeholder', () => {
    const ai: AiPlaceholderManifest = {
      entries: [{ skuId: 'reliable-ra1314', assetUrl: '/parts/ai/x.glb' }],
    };
    const geo = resolveCatalogGeometry(sku(), {
      build123dParts: b123([PENDENT_050]),
      aiPlaceholder: ai,
    });
    expect(geo.source).toBe('build123d');
  });

  it('ai-placeholder is used only when nothing better, and is visual_reference / not accurate', () => {
    const ai: AiPlaceholderManifest = {
      entries: [{ skuId: 'reliable-ra1314', assetUrl: '/parts/ai/x.glb' }],
    };
    const geo = resolveCatalogGeometry(sku(), { aiPlaceholder: ai });
    expect(geo.source).toBe('ai-placeholder');
    expect(geo.modelStatus).toBe('visual_reference');
    expect(geo.engineeringAccurate).toBe(false);
  });

  it('engineeringAccurate is true ONLY for manufacturer_verified', () => {
    expect(
      resolveCatalogGeometry(sku(), { build123dParts: b123([PENDENT_050]) })
        .engineeringAccurate,
    ).toBe(false);
    expect(
      resolveCatalogGeometry(sku(), {
        aiPlaceholder: { entries: [{ skuId: 'reliable-ra1314', assetUrl: '/a.glb' }] },
      }).engineeringAccurate,
    ).toBe(false);
    expect(resolveCatalogGeometry(sku(), {}).engineeringAccurate).toBe(false);
  });

  it('no sources -> none (no guessed tier, no fabricated url)', () => {
    const geo = resolveCatalogGeometry(sku(), {});
    expect(geo.source).toBe('none');
    expect(geo.modelStatus).toBeNull();
    expect(geo.assetUrl).toBeNull();
    expect(geo.engineeringAccurate).toBe(false);
  });
});

describe('resolveCatalogGeometryAll', () => {
  it('counts only SKUs that resolve to real geometry', () => {
    const skus = [
      sku({ id: 'a', category: 'head_pendent', port: { method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' } }),
      sku({ id: 'b', category: 'head_upright', port: { method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' } }),
      sku({ id: 'c', category: 'head_sidewall', port: { method: 'THREADED_NPT', nominalSizeIn: 1.0, role: 'INLET' } }),
      sku({ id: 'd', category: 'head', port: null }),
    ];
    const out = resolveCatalogGeometryAll(skus, {
      build123dParts: b123([PENDENT_050, UPRIGHT_050]),
    });
    // a (pendent 0.5) + b (upright 0.5) match; c (sidewall 1.0) + d (null) do not.
    expect(out.withGeometry).toBe(2);
    expect(out.byId.get('a')?.source).toBe('build123d');
    expect(out.byId.get('c')?.source).toBe('none');
    expect(out.byId.get('d')?.source).toBe('none');
  });

  it('empty sources -> zero geometry, all none', () => {
    const out = resolveCatalogGeometryAll([sku()], {});
    expect(out.withGeometry).toBe(0);
    expect(out.byId.get('reliable-ra1314')?.source).toBe('none');
  });
});

describe('loadAiPlaceholderManifest (fail-soft loader)', () => {
  it('no fetchImpl -> empty', async () => {
    expect(await loadAiPlaceholderManifest()).toEqual({ entries: [] });
  });

  it('non-2xx -> empty', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 404, async json() { return {}; } })) as unknown as typeof fetch;
    expect(await loadAiPlaceholderManifest(f)).toEqual({ entries: [] });
  });

  it('shipped ai-placeholder.json parses to an EMPTY entries list (backend down)', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const json = JSON.parse(
      readFileSync(resolve(here, '../public/parts/ai-placeholder.json'), 'utf-8'),
    );
    const f = vi.fn(async () => ({ ok: true, status: 200, async json() { return json; } })) as unknown as typeof fetch;
    const out = await loadAiPlaceholderManifest(f);
    expect(out.entries).toEqual([]);
  });
});
