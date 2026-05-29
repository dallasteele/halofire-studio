import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  makeCatalogSourcer,
  makeImageReconstructSourcer,
  makeOpenScadSourcer,
  runAutoSource,
  buildCatalogSearchQuery,
} from '../src/components/auto-source.js';
import { COMPONENTS } from '../src/components/registry.js';
import { manufacturerParityComplete } from '../src/components/model-pipeline.js';

// S1 + S2 + S3 autonomous component-model sourcing. Every sourcer is fail-soft
// (injected bridge invokers; absent/throwing/empty -> null) and HONEST: nothing
// machine-found/created is ever manufacturer-exact, and the AUTOSPRINK_PARITY
// gate stays fail-closed BLOCKED.

// A non-empty fake mesh runner for the OpenSCAD sourcer.
const mockScadRunner = async (scad) => ({ stl: `solid mock\n// ${scad.length}\nendsolid mock\n` });

describe('S1 makeCatalogSourcer (web-found CAD)', () => {
  it('returns a catalog model object with provenance, manufacturerExact:false', async () => {
    const invoker = vi.fn(async () => ({
      url: 'https://www.traceparts.com/some-model.step',
      format: 'step',
      data: 'STEP-BYTES',
      license: 'CC-BY-4.0',
      manufacturer: 'Generic',
    }));
    const sourcer = makeCatalogSourcer({ invoker });
    const model = await sourcer({ key: 'valve_check', name: 'Check valve', category: 'valves', params: {} });

    expect(model).not.toBeNull();
    expect(model.source).toBe('catalog');
    expect(model.manufacturerExact).toBe(false);
    expect(model.data).toBe('STEP-BYTES');
    expect(model.format).toBe('step');
    expect(model.provenance.url).toBe('https://www.traceparts.com/some-model.step');
    expect(model.provenance.manufacturer).toBe('Generic');
    expect(model.license).toBe('CC-BY-4.0');
    expect(invoker).toHaveBeenCalledTimes(1);
  });

  it('uses the url as the model reference when no data bytes are returned', async () => {
    const invoker = vi.fn(async () => ({ url: 'https://grabcad.com/x.stl', format: 'stl' }));
    const model = await makeCatalogSourcer({ invoker })({ key: 'fdc', name: 'FDC', category: 'fdc' });
    expect(model).not.toBeNull();
    expect(model.source).toBe('catalog');
    expect(model.data).toBe('https://grabcad.com/x.stl');
    expect(model.license).toBeNull();
    expect(model.manufacturerExact).toBe(false);
  });

  it('returns null when invoker is absent (fail-soft, no fabrication)', async () => {
    const sourcer = makeCatalogSourcer({});
    expect(await sourcer({ key: 'fdc', name: 'FDC' })).toBeNull();
  });

  it('returns null when invoker throws (gateway unreachable)', async () => {
    const invoker = vi.fn(async () => { throw new Error('gateway down'); });
    expect(await makeCatalogSourcer({ invoker })({ key: 'fdc', name: 'FDC' })).toBeNull();
  });

  it('returns null when invoker yields an empty/unusable result', async () => {
    for (const empty of [null, undefined, {}, { url: '' }, { data: '' }]) {
      const invoker = vi.fn(async () => empty);
      expect(await makeCatalogSourcer({ invoker })({ key: 'fdc', name: 'FDC' })).toBeNull();
    }
  });

  it('builds a search query from name + spec params', () => {
    const q = buildCatalogSearchQuery({
      name: 'Butterfly valve (supervised)',
      category: 'valves',
      params: { nominalSizesIn: [2, 2.5], type: ['rigid'] },
    });
    expect(q).toContain('Butterfly valve (supervised)');
    expect(q).toContain('2 in');
    expect(q).toContain('fire sprinkler');
    expect(q).toContain('valves');
  });
});

describe('S2 makeImageReconstructSourcer (SAM 3.1 / gen3d)', () => {
  it('wraps a SAM mesh into source:generated, manufacturerExact:false', async () => {
    const invoker = vi.fn(async () => 'STL-MESH-BYTES'); // T18 SAM invoker -> raw mesh
    const sourcer = makeImageReconstructSourcer({ invoker });
    const model = await sourcer({ key: 'head_pendent', name: 'Pendent', imageRef: 'cutsheet://p.png' });

    expect(model).not.toBeNull();
    expect(model.source).toBe('generated');
    expect(model.subtype).toBe('sam');
    expect(model.format).toBe('stl');
    expect(model.data).toBe('STL-MESH-BYTES');
    expect(model.manufacturerExact).toBe(false);
  });

  it('falls back to gen3d invoker when SAM yields nothing', async () => {
    const samInvoker = vi.fn(async () => ''); // SAM empty -> not usable
    const gen3dInvoker = vi.fn(async () => ({ data: 'GEN3D-MESH' }));
    const sourcer = makeImageReconstructSourcer({ invoker: samInvoker, gen3dInvoker });
    const model = await sourcer({ key: 'head_pendent', name: 'Pendent', imageRef: 'cutsheet://p.png' });

    expect(model).not.toBeNull();
    expect(model.source).toBe('generated');
    expect(model.subtype).toBe('gen3d');
    expect(model.data).toBe('GEN3D-MESH');
    expect(model.manufacturerExact).toBe(false);
  });

  it('returns null when no invoker is provided (fail-soft)', async () => {
    expect(await makeImageReconstructSourcer({})({ key: 'head_pendent' })).toBeNull();
  });

  it('returns null when the SAM invoker throws', async () => {
    const invoker = vi.fn(async () => { throw new Error('SAM down'); });
    expect(await makeImageReconstructSourcer({ invoker })({ key: 'head_pendent', imageRef: 'x' })).toBeNull();
  });

  it('returns null when the gen3d invoker throws', async () => {
    const gen3dInvoker = vi.fn(async () => { throw new Error('gen3d down'); });
    expect(await makeImageReconstructSourcer({ gen3dInvoker })({ key: 'head_pendent', imageRef: 'x' })).toBeNull();
  });
});

describe('makeOpenScadSourcer (T17 parametric)', () => {
  it('renders generatable categories to an STL model object', async () => {
    const model = await makeOpenScadSourcer({ scadRunner: mockScadRunner })({
      key: 'head_pendent', category: 'heads', name: 'Pendent', params: { kFactors: [5.6] },
    });
    expect(model).not.toBeNull();
    expect(model.source).toBe('generated');
    expect(model.subtype).toBe('openscad');
    expect(model.format).toBe('stl');
    expect(typeof model.data).toBe('string');
    expect(model.data.length).toBeGreaterThan(0);
    expect(model.manufacturerExact).toBe(false);
  });

  it('returns null for non-generatable categories (e.g. signs)', async () => {
    const model = await makeOpenScadSourcer({ scadRunner: mockScadRunner })({
      key: 'identification_sign', category: 'identification_sign', name: 'Sign', params: {},
    });
    expect(model).toBeNull();
  });

  it('returns null with no runner / throwing runner (fail-soft)', async () => {
    expect(await makeOpenScadSourcer({})({ key: 'head_pendent', category: 'heads', name: 'P' })).toBeNull();
    const throwing = async () => { throw new Error('boom'); };
    expect(
      await makeOpenScadSourcer({ scadRunner: throwing })({ key: 'head_pendent', category: 'heads', name: 'P' }),
    ).toBeNull();
  });
});

describe('S3 runAutoSource', () => {
  it('mixes found/created/generated/missing; counts add up to COMPONENTS.length', async () => {
    // catalog (S1) finds only the FDC; sam (S2) reconstructs only fitting_cap (a
    // NON-generatable part, so it falls through openscad to the sam slot);
    // openscad generates the generatable parts; everything else missing.
    const catalog = vi.fn(async (component) =>
      component.key === 'fdc'
        ? { data: 'STEP', source: 'catalog', format: 'step', provenance: { url: 'https://t/x', manufacturer: null }, license: null, manufacturerExact: false }
        : null,
    );
    const sam = vi.fn(async (component) =>
      component.key === 'fitting_cap'
        ? { data: 'SAM-MESH', source: 'generated', subtype: 'sam', format: 'stl', manufacturerExact: false }
        : null,
    );
    const recorder = vi.fn();

    const report = await runAutoSource({
      sourcers: { catalog, sam },
      scadRunner: mockScadRunner,
      recorder,
    });

    const { foundCount, createdCount, generatedCount, missingCount } = report.report;
    expect(foundCount + createdCount + generatedCount + missingCount).toBe(COMPONENTS.length);
    expect(report.results.length).toBe(COMPONENTS.length);

    // FDC found via catalog (S1)
    expect(report.found).toContain('fdc');
    // fitting_cap created via SAM (S2): not catalog-found, not openscad-generatable
    expect(report.created).toContain('fitting_cap');
    // generatable parts came through openscad (S3 openscad slot)
    expect(report.generated).toContain('head_upright');
    expect(report.generated).toContain('head_pendent');
    // a non-generatable required part with no source stays missing
    expect(report.missing).toContain('identification_sign');

    // modelStatusByKey present for honestly-sourced present parts only. NOTE the
    // FDC was machine-FOUND -> registry 'generated', NEVER registry 'catalog'.
    expect(report.modelStatusByKey.fdc.source).toBe('generated');
    expect(report.modelStatusByKey.fitting_cap.source).toBe('generated');
    expect(report.modelStatusByKey.identification_sign).toBeUndefined();

    // HONESTY: nothing manufacturer-exact; gate fail-closed BLOCKED
    expect(report.manufacturerExactCount).toBe(0);
    expect(report.parityGateStatus).toBe('blocked');

    // recorder called once per component, each manufacturerExact:false
    expect(recorder).toHaveBeenCalledTimes(COMPONENTS.length);
    for (const call of recorder.mock.calls) {
      expect(call[0].manufacturerExact).toBe(false);
    }
  });

  it('is fully fail-soft: all sourcers absent -> everything missing, no throw', async () => {
    const report = await runAutoSource({ sourcers: {} });
    expect(report.report.missingCount).toBe(COMPONENTS.length);
    expect(report.report.foundCount).toBe(0);
    expect(report.report.createdCount).toBe(0);
    expect(report.report.generatedCount).toBe(0);
    expect(Object.keys(report.modelStatusByKey).length).toBe(0);
    expect(report.parityGateStatus).toBe('blocked');
    expect(report.manufacturerExactCount).toBe(0);
  });

  it('HONESTY: machine-found models are never manufacturer-exact and never clear the manufacturer gate', async () => {
    // Even with catalog finding EVERY component, manufacturerExact stays false, the
    // registry source is downgraded 'catalog' -> 'generated' (machine-found
    // provenance is unverified), and the STRICTER manufacturer parity gate stays
    // blocked regardless of how complete the functional coverage is.
    const catalog = vi.fn(async (component) => ({
      data: `MODEL-${component.key}`,
      source: 'catalog',
      format: 'stl',
      provenance: { url: `https://t/${component.key}`, manufacturer: null },
      license: 'CC-BY-4.0',
      manufacturerExact: false,
    }));
    const report = await runAutoSource({ sourcers: { catalog } });

    expect(report.found.length).toBe(COMPONENTS.length);
    expect(report.manufacturerExactCount).toBe(0);
    // No machine-found model is ever registry 'catalog' or 'manufacturer'.
    for (const entry of Object.values(report.modelStatusByKey)) {
      expect(entry.source).toBe('generated');
      expect(entry.source).not.toBe('catalog');
      expect(entry.source).not.toBe('manufacturer');
      expect(entry.model.manufacturerExact).toBe(false);
    }
    // The gate-grade manufacturer parity check stays FALSE on any machine-sourced
    // inventory — only user-attached catalog/manufacturer evidence can flip it.
    expect(manufacturerParityComplete(report.modelStatusByKey)).toBe(false);
    // CRITICAL honesty guard: functional coverage is 100% here, yet the RETURNED
    // parity gate stays 'blocked' — best-effort machine geometry NEVER clears parity.
    // (This would fail if parityGateStatus were derived from functional coverage.)
    expect(report.functionalCoverage.complete).toBe(true);
    expect(report.parityGateStatus).toBe('blocked');
  });

  it('defaults to the full registry and is idempotent across runs', async () => {
    const r1 = await runAutoSource({ scadRunner: mockScadRunner });
    const r2 = await runAutoSource({ scadRunner: mockScadRunner });
    expect(r1.report).toEqual(r2.report);
    expect(r1.results.length).toBe(COMPONENTS.length);
  });

  it('write:true + temp outDir writes STL for present parts carrying string mesh data', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-autosource-'));
    try {
      const report = await runAutoSource({ scadRunner: mockScadRunner, outDir: tempDir, write: true });
      const written = fs.readdirSync(tempDir).filter((f) => f.endsWith('.stl'));
      // openscad-generated parts carry string STL data and should be written
      expect(written.length).toBe(report.report.generatedCount);
      expect(written.length).toBeGreaterThan(0);
      for (const f of written) {
        expect(fs.readFileSync(path.join(tempDir, f), 'utf8').length).toBeGreaterThan(0);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('recorder is optional — absent recorder does not throw', async () => {
    const report = await runAutoSource({ scadRunner: mockScadRunner });
    expect(report.report.generatedCount).toBeGreaterThan(0);
  });
});
