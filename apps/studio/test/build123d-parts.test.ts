import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applyBuild123dParts,
  isParametricVerified,
  loadBuild123dManifest,
  type Build123dManifest,
  type Build123dPartEntry,
} from '../src/lib/build123d-parts';
import {
  normalizeManifest,
  type RawManifest,
} from '../src/lib/parts-manifest';
import { deriveModelStatus } from '../src/lib/provenance';

function fixtureManifest(): RawManifest {
  return {
    components: [
      {
        key: 'head_pendent',
        category: 'heads',
        name: 'Pendent Head',
        source: 'generated',
        present: true,
        file: 'parts/head_pendent.stl',
        manufacturerExact: false,
      },
      {
        key: 'fitting_tee',
        category: 'fittings',
        name: 'Tee',
        source: 'generated',
        present: true,
        file: 'parts/fitting_tee.stl',
        manufacturerExact: false,
      },
    ],
  };
}

function verifiedEntry(over: Partial<Build123dPartEntry> = {}): Build123dPartEntry {
  return {
    key: 'head_pendent',
    source: 'build123d',
    productCode: 'B123D-HEAD-PEND-050',
    name: 'Pendent Head (parametric)',
    stepUrl: '/parts/build123d/head_pendent.step',
    sha256: 'deadbeef',
    dimensions: { nptSize: '1/2"', bodyLengthMm: 18, kFactorLabel: 'K5.6', units: 'mm' },
    ...over,
  };
}

describe('isParametricVerified (T45 honesty gate)', () => {
  it('requires BOTH a real stepUrl AND a real sha256', () => {
    expect(isParametricVerified(verifiedEntry())).toBe(true);
  });

  it('rejects entry missing stepUrl', () => {
    expect(isParametricVerified(verifiedEntry({ stepUrl: '' }))).toBe(false);
  });

  it('rejects entry missing sha256', () => {
    expect(isParametricVerified(verifiedEntry({ sha256: undefined }))).toBe(false);
    expect(isParametricVerified(verifiedEntry({ sha256: '   ' }))).toBe(false);
  });

  it('rejects null / undefined', () => {
    expect(isParametricVerified(null)).toBe(false);
    expect(isParametricVerified(undefined)).toBe(false);
  });

  it('rejects bare nonsense in stepUrl (no scheme, no path, no extension)', () => {
    expect(isParametricVerified(verifiedEntry({ stepUrl: 'not a url' }))).toBe(false);
  });

  it('accepts relative path with .step extension', () => {
    expect(isParametricVerified(verifiedEntry({ stepUrl: 'parts/x.step' }))).toBe(true);
  });
});

describe('applyBuild123dParts', () => {
  it('empty manifest -> records unchanged (no upgrades)', () => {
    const records = normalizeManifest(fixtureManifest());
    const out = applyBuild123dParts(records, { entries: [] });
    expect(out).toHaveLength(records.length);
    for (let i = 0; i < records.length; i++) {
      expect(out[i].key).toBe(records[i].key);
      expect(out[i].source).toBe('generated');
      expect(out[i].modelStatus).toBe('visual_reference');
      expect(out[i].stepUrl).toBeUndefined();
    }
  });

  it('null / undefined manifest -> records unchanged', () => {
    const records = normalizeManifest(fixtureManifest());
    expect(applyBuild123dParts(records, null).every((r) => r.modelStatus === 'visual_reference')).toBe(true);
    expect(applyBuild123dParts(records, undefined).every((r) => r.modelStatus === 'visual_reference')).toBe(true);
  });

  it('verified entry upgrades matched record -> source build123d -> dimensioned_parametric', () => {
    const records = normalizeManifest(fixtureManifest());
    const manifest: Build123dManifest = { entries: [verifiedEntry()] };
    const out = applyBuild123dParts(records, manifest);
    const head = out.find((r) => r.key === 'head_pendent')!;
    expect(head.source).toBe('build123d');
    expect(head.stepUrl).toBe('/parts/build123d/head_pendent.step');
    expect(head.productCode).toBe('B123D-HEAD-PEND-050');
    expect(head.modelStatus).toBe('dimensioned_parametric');
    expect(head.dimensions?.nptSize).toBe('1/2"');
    // Cross-check via the provenance derivation:
    expect(deriveModelStatus({ source: head.source, manufacturerExact: head.manufacturerExact })).toBe(
      'dimensioned_parametric',
    );
    // The OTHER record stays visual_reference (no upgrade).
    const tee = out.find((r) => r.key === 'fitting_tee')!;
    expect(tee.modelStatus).toBe('visual_reference');
    expect(tee.source).toBe('generated');
  });

  it('entry without sha256 -> record stays visual_reference (HARD honest invariant)', () => {
    const records = normalizeManifest(fixtureManifest());
    const out = applyBuild123dParts(records, { entries: [verifiedEntry({ sha256: undefined })] });
    const head = out.find((r) => r.key === 'head_pendent')!;
    expect(head.source).toBe('generated');
    expect(head.modelStatus).toBe('visual_reference');
    expect(head.stepUrl).toBeUndefined();
  });

  it('entry without stepUrl -> record stays visual_reference (HARD honest invariant)', () => {
    const records = normalizeManifest(fixtureManifest());
    const out = applyBuild123dParts(records, { entries: [verifiedEntry({ stepUrl: '' })] });
    const head = out.find((r) => r.key === 'head_pendent')!;
    expect(head.source).toBe('generated');
    expect(head.modelStatus).toBe('visual_reference');
  });

  it('unmatched key -> no-op (does not fabricate a part)', () => {
    const records = normalizeManifest(fixtureManifest());
    const out = applyBuild123dParts(records, {
      entries: [verifiedEntry({ key: 'nonexistent_part' })],
    });
    expect(out).toHaveLength(records.length);
    expect(out.find((r) => r.key === 'nonexistent_part')).toBeUndefined();
    expect(out.every((r) => r.modelStatus === 'visual_reference')).toBe(true);
  });

  it('manufacturer_verified is NOT downgraded by a build123d entry on the same key', () => {
    // Pre-upgrade head_pendent to manufacturer_verified, then apply build123d.
    const records = normalizeManifest(fixtureManifest()).map((r) =>
      r.key === 'head_pendent'
        ? {
            ...r,
            source: 'manufacturer-step',
            manufacturerExact: true,
            stepUrl: '/parts/mfg/head.step',
            modelStatus: 'manufacturer_verified' as const,
          }
        : r,
    );
    const out = applyBuild123dParts(records, { entries: [verifiedEntry()] });
    const head = out.find((r) => r.key === 'head_pendent')!;
    // Higher tier MUST win — no downgrade.
    expect(head.source).toBe('manufacturer-step');
    expect(head.modelStatus).toBe('manufacturer_verified');
    expect(head.stepUrl).toBe('/parts/mfg/head.step');
  });
});

describe('normalizeManifest with build123d (T45 integration + ordering)', () => {
  it('build123d arg flows through normalize -> record carries dimensioned upgrade', () => {
    const out = normalizeManifest(fixtureManifest(), null, { entries: [verifiedEntry()] });
    const head = out.find((r) => r.key === 'head_pendent')!;
    expect(head.source).toBe('build123d');
    expect(head.modelStatus).toBe('dimensioned_parametric');
    expect(head.stepUrl).toBe('/parts/build123d/head_pendent.step');
  });

  it('manufacturer_verified WINS over build123d on a key collision', () => {
    const mfg = {
      entries: [
        {
          key: 'head_pendent',
          manufacturer: 'Viking',
          productCode: 'VK-100',
          modelName: 'Viking Pendent',
          stepUrl: '/parts/mfg/vk100.step',
          sha256: 'mfgsha',
        },
      ],
    };
    const out = normalizeManifest(fixtureManifest(), mfg, { entries: [verifiedEntry()] });
    const head = out.find((r) => r.key === 'head_pendent')!;
    expect(head.source).toBe('manufacturer-step');
    expect(head.manufacturerExact).toBe(true);
    expect(head.modelStatus).toBe('manufacturer_verified');
    expect(head.stepUrl).toBe('/parts/mfg/vk100.step');
  });

  it('empty build123d + empty manufacturer-step -> no upgrades (honest default)', () => {
    const out = normalizeManifest(fixtureManifest(), { entries: [] }, { entries: [] });
    expect(out.every((r) => r.modelStatus === 'visual_reference')).toBe(true);
    expect(out.filter((r) => r.modelStatus === 'dimensioned_parametric')).toHaveLength(0);
  });

  it('omitted build123d arg -> preserves legacy behavior', () => {
    const legacy = normalizeManifest(fixtureManifest());
    const withMfgOnly = normalizeManifest(fixtureManifest(), { entries: [] });
    expect(withMfgOnly).toHaveLength(legacy.length);
    expect(withMfgOnly.every((r) => r.modelStatus === 'visual_reference')).toBe(true);
  });
});

describe('loadBuild123dManifest (fail-soft loader)', () => {
  it('no fetchImpl -> empty manifest', async () => {
    expect(await loadBuild123dManifest()).toEqual({ entries: [] });
  });

  it('non-2xx response -> empty manifest', async () => {
    const notFound = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      async json() {
        return {};
      },
    })) as unknown as typeof fetch;
    expect(await loadBuild123dManifest(notFound)).toEqual({ entries: [] });
  });

  it('invalid JSON -> empty manifest (fail-soft)', async () => {
    const badFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        throw new Error('not json');
      },
    })) as unknown as typeof fetch;
    expect(await loadBuild123dManifest(badFetch)).toEqual({ entries: [] });
  });

  it('json with no entries array -> empty manifest', async () => {
    const noEntries = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { something: 'else' };
      },
    })) as unknown as typeof fetch;
    expect(await loadBuild123dManifest(noEntries)).toEqual({ entries: [] });
  });

  it('valid JSON with entries -> parsed manifest', async () => {
    const good = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { entries: [verifiedEntry()] };
      },
    })) as unknown as typeof fetch;
    const out = await loadBuild123dManifest(good);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].key).toBe('head_pendent');
  });
});

// --- Real generated artifact assertions (realStepGenerated === true) ---------
// These run against the SHIPPED build123d-parts.json. Because build123d was
// installed and the generator produced real STEP files, the manifest is
// non-empty and every entry must carry a sha256 + a stepUrl under
// /parts/build123d/.
describe('shipped build123d-parts.json (real generated artifacts)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, '../public/parts/build123d-parts.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Build123dManifest;

  it('has at least one real generated entry', () => {
    expect(Array.isArray(manifest.entries)).toBe(true);
    expect(manifest.entries.length).toBeGreaterThan(0);
  });

  it('every entry has a sha256 + a stepUrl under /parts/build123d/ and is parametric-verified', () => {
    for (const e of manifest.entries) {
      expect(typeof e.sha256).toBe('string');
      expect((e.sha256 as string).length).toBeGreaterThan(0);
      expect(e.stepUrl.startsWith('/parts/build123d/')).toBe(true);
      expect(e.stepUrl.endsWith('.step')).toBe(true);
      expect(e.source).toBe('build123d');
      expect(isParametricVerified(e)).toBe(true);
    }
  });

  it('every entry sha256 matches the on-disk STEP file', async () => {
    const { createHash } = await import('node:crypto');
    for (const e of manifest.entries) {
      const stepPath = resolve(here, '../public', e.stepUrl.replace(/^\//, ''));
      const bytes = readFileSync(stepPath);
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(sha).toBe(e.sha256);
    }
  });
});
