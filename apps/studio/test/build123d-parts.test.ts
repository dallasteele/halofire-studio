import { readFileSync, existsSync } from 'node:fs';
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
  type PartRecord,
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
// installed and the generator produced real STEP files for the FULL part
// library, the manifest is non-empty (>=18 entries) and every entry must carry
// a real sha256 + a stepUrl under /parts/build123d/ that exists on disk, and
// every key must match a real catalog key.
describe('shipped build123d-parts.json (real generated artifacts)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, '../public/parts/build123d-parts.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Build123dManifest;

  // The canonical catalog manifest — its keys are the source of truth.
  const catalogPath = resolve(here, '../public/parts/parts-manifest.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as {
    components: { key: string; category: string; name: string }[];
  };
  const catalogKeys = new Set(catalog.components.map((c) => c.key));

  it('has at least one real generated entry', () => {
    expect(Array.isArray(manifest.entries)).toBe(true);
    expect(manifest.entries.length).toBeGreaterThan(0);
  });

  it('has the FULL real set (>=18 entries)', () => {
    expect(manifest.entries.length).toBeGreaterThanOrEqual(18);
  });

  it('every entry key is unique', () => {
    const keys = manifest.entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry key matches a real catalog key', () => {
    expect(catalogKeys.size).toBeGreaterThan(0);
    for (const e of manifest.entries) {
      expect(catalogKeys.has(e.key)).toBe(true);
    }
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

  it('every entry stepUrl points at a real on-disk STEP file', () => {
    for (const e of manifest.entries) {
      const stepPath = resolve(here, '../public', e.stepUrl.replace(/^\//, ''));
      expect(existsSync(stepPath)).toBe(true);
      // A real STEP file is a non-trivial ISO-10303-21 text file.
      const head = readFileSync(stepPath, 'utf-8').slice(0, 40);
      expect(head.startsWith('ISO-10303-21')).toBe(true);
    }
  });

  it('every entry sha256 matches the on-disk STEP file (no fake entries)', async () => {
    const { createHash } = await import('node:crypto');
    for (const e of manifest.entries) {
      const stepPath = resolve(here, '../public', e.stepUrl.replace(/^\//, ''));
      const bytes = readFileSync(stepPath);
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(sha).toBe(e.sha256);
    }
  });

  it('a re-hashed sample of on-disk STEP files matches the manifest sha256', async () => {
    const { createHash } = await import('node:crypto');
    // Deterministically sample up to 6 entries (sorted -> stable selection).
    const sorted = [...manifest.entries].sort((a, b) => a.key.localeCompare(b.key));
    const step = Math.max(1, Math.floor(sorted.length / 6));
    const sample = sorted.filter((_, i) => i % step === 0).slice(0, 6);
    expect(sample.length).toBeGreaterThanOrEqual(3);
    for (const e of sample) {
      const stepPath = resolve(here, '../public', e.stepUrl.replace(/^\//, ''));
      const sha = createHash('sha256').update(readFileSync(stepPath)).digest('hex');
      expect(sha).toBe(e.sha256);
    }
  });

  it('grew to the FULL head-size-covered set (>=28 entries, was 24)', () => {
    expect(manifest.entries.length).toBeGreaterThanOrEqual(28);
  });

  it('covers EVERY (head category, NPT size) combination the manufacturer catalog uses', () => {
    // Read the REAL ingested manufacturer catalog and collect the head
    // (category, nominalSizeIn) combinations that actually appear with a known
    // size. The shipped build123d manifest MUST carry a parametric body for each.
    const mfrCatalogPath = resolve(here, '../public/catalog/manufacturer-catalog.json');
    const mfr = JSON.parse(readFileSync(mfrCatalogPath, 'utf-8')) as {
      entries: { category: string; port: { nominalSizeIn: number | null } | null }[];
    };
    const HEAD_CATS = new Set(['head_pendent', 'head_upright', 'head_sidewall']);
    const needed = new Set<string>();
    for (const e of mfr.entries) {
      const size = e.port?.nominalSizeIn;
      if (!HEAD_CATS.has(e.category)) continue;
      if (typeof size !== 'number' || !Number.isFinite(size)) continue;
      needed.add(`${e.category}@${size}`);
    }
    expect(needed.size).toBeGreaterThan(0);

    // What the build123d manifest covers (entries carrying category + size).
    const covered = new Set<string>();
    for (const e of manifest.entries) {
      const cat = (e as { category?: string }).category;
      const size = (e as { nominalSizeIn?: number }).nominalSizeIn;
      if (typeof cat === 'string' && typeof size === 'number') {
        covered.add(`${cat}@${size}`);
      }
    }

    const missing = [...needed].filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });

  it('every head-size entry carries category + nominalSizeIn and a real sha256', () => {
    const headSized = manifest.entries.filter(
      (e) => typeof (e as { nominalSizeIn?: number }).nominalSizeIn === 'number',
    );
    expect(headSized.length).toBeGreaterThanOrEqual(7);
    for (const e of headSized) {
      expect(typeof (e as { category?: string }).category).toBe('string');
      expect(typeof e.sha256).toBe('string');
      expect((e.sha256 as string).length).toBe(64);
      expect(isParametricVerified(e)).toBe(true);
    }
  });

  it('applyBuild123dParts upgrades MANY catalog records to dimensioned_parametric', () => {
    const records: PartRecord[] = catalog.components.map((c) => ({
      key: c.key,
      category: c.category,
      name: c.name,
      source: 'generated',
      manufacturerExact: false,
      present: true,
      file: `parts/${c.key}.stl`,
      stlUrl: `/parts/${c.key}.stl`,
      modelStatus: 'visual_reference' as const,
    }));
    const upgraded = applyBuild123dParts(records, manifest);
    const dimensioned = upgraded.filter((r) => r.modelStatus === 'dimensioned_parametric');
    // Every manifest entry has a matching catalog key, so the upgrade count
    // equals the manifest size (>=18) — "many" records upgraded honestly.
    expect(dimensioned.length).toBe(manifest.entries.length);
    expect(dimensioned.length).toBeGreaterThanOrEqual(18);
    for (const r of dimensioned) {
      expect(r.source).toBe('build123d');
      expect(r.stepUrl?.startsWith('/parts/build123d/')).toBe(true);
    }
  });
});
