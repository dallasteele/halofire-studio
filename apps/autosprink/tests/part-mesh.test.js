import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildPartManifest, PART_VARIANT_COUNT } from '../src/components/part-mesh.js';
import { COMPONENTS } from '../src/components/registry.js';

// Total manifest rows = one per registry component + the extra DIMENSIONED
// variant renders (rigid/flexible grooved couplings, escutcheon, drop nipple).
const TOTAL_ROWS = COMPONENTS.length + PART_VARIANT_COUNT;

// R1 part-mesh pipeline: generated-modelable parts render to real STL (via an
// injected mock runner), non-generatable parts stay 'missing', and the
// AUTOSPRINK_PARITY gate stays fail-closed BLOCKED. Generated meshes are NEVER
// manufacturer-exact.

// Modelable categories per the registry/generator coverage.
const MODELABLE = new Set(['heads', 'pipe', 'grooved', 'valves', 'hanger']);
// Fittings are modelable only for these specific keys.
const MODELABLE_FITTINGS = new Set([
  'fitting_tee',
  'fitting_elbow_90',
  'fitting_elbow_45',
  'fitting_coupling',
  'fitting_reducer',
]);

function isGeneratable(c) {
  if (c.category === 'fittings') return MODELABLE_FITTINGS.has(c.key);
  return MODELABLE.has(c.category);
}

// Mock runner: returns fake but non-empty STL bytes (an object with .stl).
const mockRunner = async (scad) => ({ stl: `solid mock\n// ${scad.length} chars\nendsolid mock\n` });

describe('R1 buildPartManifest', () => {
  it('marks generated-modelable components present/generated, never manufacturer-exact', async () => {
    const manifest = await buildPartManifest({ scadRunner: mockRunner });

    const byKey = new Map(manifest.components.map((e) => [e.key, e]));
    // every registry component is represented, plus the variant renders
    expect(manifest.components.length).toBe(TOTAL_ROWS);

    for (const head of ['head_pendent', 'head_upright', 'head_esfr']) {
      const e = byKey.get(head);
      expect(e.source).toBe('generated');
      expect(e.present).toBe(true);
      expect(e.manufacturerExact).toBe(false);
      expect(e.file).toBe(`parts/${head}.stl`);
      expect(e.format).toBe('stl');
    }
    const tee = byKey.get('fitting_tee');
    expect(tee.source).toBe('generated');
    expect(tee.present).toBe(true);
  });

  it('marks non-generatable required components missing (no file claimed)', async () => {
    const manifest = await buildPartManifest({ scadRunner: mockRunner });
    const byKey = new Map(manifest.components.map((e) => [e.key, e]));

    for (const key of ['identification_sign', 'riser_trim', 'fdc', 'fitting_cap', 'gauge']) {
      const e = byKey.get(key);
      expect(e.source).toBe('missing');
      expect(e.present).toBe(false);
      expect(e.file).toBeNull();
      expect(e.format).toBeNull();
      expect(e.manufacturerExact).toBe(false);
    }
  });

  it('manufacturerExactCount is 0 and parity gate stays blocked with all generatable parts present', async () => {
    const manifest = await buildPartManifest({ scadRunner: mockRunner });

    expect(manifest.manufacturerExactCount).toBe(0);
    expect(manifest.components.every((e) => e.manufacturerExact === false)).toBe(true);
    // gate stays blocked because required non-generatable parts remain missing
    expect(manifest.parityGateStatus).toBe('blocked');

    // generated = generatable registry components + all variant renders (they
    // all render under the mock runner).
    const expectedGenerated = COMPONENTS.filter(isGeneratable).length + PART_VARIANT_COUNT;
    expect(manifest.generatedCount).toBe(expectedGenerated);
    expect(manifest.missingCount).toBe(TOTAL_ROWS - expectedGenerated);
    expect(manifest.generatedCount + manifest.missingCount).toBe(TOTAL_ROWS);
  });

  it('with NO runner, everything is missing and no entry claims a file/present', async () => {
    const manifest = await buildPartManifest({});

    expect(manifest.generatedCount).toBe(0);
    expect(manifest.missingCount).toBe(TOTAL_ROWS);
    expect(manifest.parityGateStatus).toBe('blocked');
    expect(manifest.manufacturerExactCount).toBe(0);
    for (const e of manifest.components) {
      expect(e.source).toBe('missing');
      expect(e.present).toBe(false);
      expect(e.file).toBeNull();
    }
  });

  it('with a throwing runner, parts are missing and no STL is fabricated', async () => {
    const throwingRunner = async () => { throw new Error('boom'); };
    const manifest = await buildPartManifest({ scadRunner: throwingRunner });
    expect(manifest.generatedCount).toBe(0);
    expect(manifest.missingCount).toBe(TOTAL_ROWS);
    expect(manifest.components.every((e) => e.present === false && e.file === null)).toBe(true);
  });

  it('with an empty-output runner, parts are missing (fail-closed)', async () => {
    const emptyRunner = async () => ({ stl: '' });
    const manifest = await buildPartManifest({ scadRunner: emptyRunner });
    expect(manifest.generatedCount).toBe(0);
    expect(manifest.missingCount).toBe(TOTAL_ROWS);
  });

  it('write:true + temp outDir writes <key>.stl for generated entries only', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-parts-'));
    try {
      const manifest = await buildPartManifest({ scadRunner: mockRunner, outDir: tempDir, write: true });

      const generated = manifest.components.filter((e) => e.present);
      expect(generated.length).toBeGreaterThan(0);
      for (const e of generated) {
        const stlPath = path.join(tempDir, `${e.key}.stl`);
        expect(fs.existsSync(stlPath)).toBe(true);
        expect(fs.readFileSync(stlPath, 'utf8').length).toBeGreaterThan(0);
      }
      // missing entries must NOT have a written file
      for (const e of manifest.components.filter((x) => !x.present)) {
        expect(fs.existsSync(path.join(tempDir, `${e.key}.stl`))).toBe(false);
      }
      // and the count of written files matches generatedCount
      const written = fs.readdirSync(tempDir).filter((f) => f.endsWith('.stl'));
      expect(written.length).toBe(manifest.generatedCount);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
