import { describe, expect, it, vi } from 'vitest';
import {
  applyManufacturerStep,
  isOperatorVerified,
  loadManufacturerStepManifest,
  type ManufacturerStepEntry,
  type ManufacturerStepManifest,
} from '../src/lib/manufacturer-step';
import {
  normalizeManifest,
  type PartRecord,
  type RawManifest,
} from '../src/lib/parts-manifest';
import { deriveModelStatus } from '../src/lib/provenance';
import {
  loadStepGeometry,
  type OcctModule,
  type StepGeometry,
} from '../src/lib/step-loader';

// Minimal raw manifest fixture so tests don't depend on the 22-part real one
// for every case.
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
        key: 'valve_check',
        category: 'valves',
        name: 'Check Valve',
        source: 'generated',
        present: true,
        file: 'parts/valve_check.stl',
        manufacturerExact: false,
      },
    ],
  };
}

describe('isOperatorVerified (T44 honesty gate)', () => {
  it('requires BOTH a real stepUrl AND a real sha256', () => {
    const ok: ManufacturerStepEntry = {
      key: 'head_pendent',
      manufacturer: 'Viking',
      productCode: 'VK-100',
      modelName: 'Viking Pendent VK100',
      stepUrl: 'https://example.com/vk100.step',
      sha256: 'abc123',
    };
    expect(isOperatorVerified(ok)).toBe(true);
  });

  it('rejects entry missing stepUrl', () => {
    expect(
      isOperatorVerified({
        key: 'x',
        manufacturer: 'Viking',
        productCode: 'VK-100',
        modelName: 'X',
        stepUrl: '',
        sha256: 'abc',
      }),
    ).toBe(false);
  });

  it('rejects entry missing sha256', () => {
    expect(
      isOperatorVerified({
        key: 'x',
        manufacturer: 'Viking',
        productCode: 'VK-100',
        modelName: 'X',
        stepUrl: 'https://example.com/x.step',
      }),
    ).toBe(false);
  });

  it('rejects null / undefined', () => {
    expect(isOperatorVerified(null)).toBe(false);
    expect(isOperatorVerified(undefined)).toBe(false);
  });

  it('rejects bare nonsense in stepUrl (no scheme, no path, no extension)', () => {
    expect(
      isOperatorVerified({
        key: 'x',
        manufacturer: 'Viking',
        productCode: 'VK-100',
        modelName: 'X',
        stepUrl: 'not a url',
        sha256: 'abc',
      }),
    ).toBe(false);
  });

  it('accepts relative path with .step extension', () => {
    expect(
      isOperatorVerified({
        key: 'x',
        manufacturer: 'Viking',
        productCode: 'VK-100',
        modelName: 'X',
        stepUrl: 'parts/vk100.step',
        sha256: 'abc',
      }),
    ).toBe(true);
  });
});

describe('applyManufacturerStep', () => {
  it('empty manifest -> records unchanged (no upgrades)', () => {
    const records = normalizeManifest(fixtureManifest());
    const out = applyManufacturerStep(records, { entries: [] });
    expect(out).toHaveLength(records.length);
    for (let i = 0; i < records.length; i++) {
      expect(out[i].key).toBe(records[i].key);
      expect(out[i].source).toBe('generated');
      expect(out[i].manufacturerExact).toBe(false);
      expect(out[i].modelStatus).toBe('visual_reference');
      expect(out[i].stepUrl).toBeUndefined();
    }
  });

  it('manufacturerVerifiedCount derivation with empty manifest = 0 (honest default)', () => {
    const records = normalizeManifest(fixtureManifest());
    const out = applyManufacturerStep(records, { entries: [] });
    const count = out.filter((r) => r.modelStatus === 'manufacturer_verified').length;
    expect(count).toBe(0);
  });

  it('operator-verified entry upgrades matched record to manufacturer_verified', () => {
    const records = normalizeManifest(fixtureManifest());
    const manifest: ManufacturerStepManifest = {
      entries: [
        {
          key: 'head_pendent',
          manufacturer: 'Viking',
          productCode: 'VK-100',
          modelName: 'Viking Pendent VK100',
          stepUrl: 'https://example.com/vk100.step',
          sha256: 'sha-of-the-file',
        },
      ],
    };
    const out = applyManufacturerStep(records, manifest);
    const head = out.find((r) => r.key === 'head_pendent');
    expect(head).toBeDefined();
    expect(head!.source).toBe('manufacturer-step');
    expect(head!.manufacturerExact).toBe(true);
    expect(head!.stepUrl).toBe('https://example.com/vk100.step');
    expect(head!.productCode).toBe('VK-100');
    expect(head!.manufacturer).toBe('Viking');
    expect(head!.modelStatus).toBe('manufacturer_verified');
    // Cross-check via the provenance derivation:
    expect(
      deriveModelStatus({ source: head!.source, manufacturerExact: head!.manufacturerExact }),
    ).toBe('manufacturer_verified');
    // The OTHER record stays visual_reference (no upgrade).
    const valve = out.find((r) => r.key === 'valve_check');
    expect(valve!.modelStatus).toBe('visual_reference');
    expect(valve!.source).toBe('generated');
  });

  it('entry WITHOUT stepUrl -> record stays visual_reference (HARD honest invariant)', () => {
    const records = normalizeManifest(fixtureManifest());
    const manifest: ManufacturerStepManifest = {
      entries: [
        {
          key: 'head_pendent',
          manufacturer: 'Viking',
          productCode: 'VK-100',
          modelName: 'Viking Pendent VK100',
          stepUrl: '',
          sha256: 'sha-of-the-file',
        },
      ],
    };
    const out = applyManufacturerStep(records, manifest);
    const head = out.find((r) => r.key === 'head_pendent')!;
    expect(head.source).toBe('generated');
    expect(head.manufacturerExact).toBe(false);
    expect(head.modelStatus).toBe('visual_reference');
    expect(head.stepUrl).toBeUndefined();
  });

  it('entry WITHOUT sha256 -> record stays visual_reference (HARD honest invariant)', () => {
    const records = normalizeManifest(fixtureManifest());
    const manifest: ManufacturerStepManifest = {
      entries: [
        {
          key: 'head_pendent',
          manufacturer: 'Viking',
          productCode: 'VK-100',
          modelName: 'Viking Pendent VK100',
          stepUrl: 'https://example.com/vk100.step',
        },
      ],
    };
    const out = applyManufacturerStep(records, manifest);
    const head = out.find((r) => r.key === 'head_pendent')!;
    expect(head.source).toBe('generated');
    expect(head.manufacturerExact).toBe(false);
    expect(head.modelStatus).toBe('visual_reference');
    expect(head.stepUrl).toBeUndefined();
  });

  it('entry whose key matches NO record -> no-op (does not fabricate parts)', () => {
    const records = normalizeManifest(fixtureManifest());
    const manifest: ManufacturerStepManifest = {
      entries: [
        {
          key: 'nonexistent_part',
          manufacturer: 'Tyco',
          productCode: 'T-999',
          modelName: 'Phantom',
          stepUrl: 'https://example.com/t999.step',
          sha256: 'shashasha',
        },
      ],
    };
    const out = applyManufacturerStep(records, manifest);
    expect(out).toHaveLength(records.length);
    expect(out.find((r) => r.key === 'nonexistent_part')).toBeUndefined();
    // No record was upgraded.
    expect(out.every((r) => r.modelStatus === 'visual_reference')).toBe(true);
  });

  it('null / undefined manifest -> records unchanged', () => {
    const records: PartRecord[] = normalizeManifest(fixtureManifest());
    const a = applyManufacturerStep(records, null);
    const b = applyManufacturerStep(records, undefined);
    expect(a).toHaveLength(records.length);
    expect(b).toHaveLength(records.length);
    expect(a.every((r) => r.modelStatus === 'visual_reference')).toBe(true);
    expect(b.every((r) => r.modelStatus === 'visual_reference')).toBe(true);
  });
});

describe('normalizeManifest with manufacturer-step (T44 integration)', () => {
  it('empty manifest passed -> identical to legacy (no regression)', () => {
    const raw = fixtureManifest();
    const legacy = normalizeManifest(raw);
    const withEmpty = normalizeManifest(raw, { entries: [] });
    expect(withEmpty).toHaveLength(legacy.length);
    for (let i = 0; i < legacy.length; i++) {
      expect(withEmpty[i].key).toBe(legacy[i].key);
      expect(withEmpty[i].source).toBe(legacy[i].source);
      expect(withEmpty[i].manufacturerExact).toBe(legacy[i].manufacturerExact);
      expect(withEmpty[i].modelStatus).toBe(legacy[i].modelStatus);
      expect(withEmpty[i].stlUrl).toBe(legacy[i].stlUrl);
    }
  });

  it('omitted manufacturer-step arg -> preserves legacy default-arg behavior', () => {
    const raw = fixtureManifest();
    const legacy = normalizeManifest(raw);
    // Every record stays at the honest visual_reference tier.
    expect(legacy.every((r) => r.modelStatus === 'visual_reference')).toBe(true);
    expect(legacy.every((r) => r.stepUrl === undefined)).toBe(true);
  });

  it('verified entry flows through normalize -> record carries upgrade', () => {
    const raw = fixtureManifest();
    const out = normalizeManifest(raw, {
      entries: [
        {
          key: 'valve_check',
          manufacturer: 'Victaulic',
          productCode: 'V-779',
          modelName: 'Victaulic Series 779 Check',
          stepUrl: 'parts/v779.step',
          sha256: 'aabbcc',
        },
      ],
    });
    const valve = out.find((r) => r.key === 'valve_check')!;
    expect(valve.source).toBe('manufacturer-step');
    expect(valve.manufacturerExact).toBe(true);
    expect(valve.modelStatus).toBe('manufacturer_verified');
    expect(valve.stepUrl).toBe('parts/v779.step');
    expect(valve.manufacturer).toBe('Victaulic');
    expect(valve.productCode).toBe('V-779');
  });
});

describe('loadManufacturerStepManifest (fail-soft loader)', () => {
  it('no fetchImpl -> empty manifest', async () => {
    const out = await loadManufacturerStepManifest();
    expect(out).toEqual({ entries: [] });
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
    const out = await loadManufacturerStepManifest(badFetch);
    expect(out).toEqual({ entries: [] });
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
    const out = await loadManufacturerStepManifest(notFound);
    expect(out).toEqual({ entries: [] });
  });

  it('valid JSON with entries -> parsed manifest', async () => {
    const good = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return {
          entries: [
            {
              key: 'head_pendent',
              manufacturer: 'Viking',
              productCode: 'VK-100',
              modelName: 'Viking Pendent',
              stepUrl: 'https://example.com/vk100.step',
              sha256: 'aa',
            },
          ],
        };
      },
    })) as unknown as typeof fetch;
    const out = await loadManufacturerStepManifest(good);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].key).toBe('head_pendent');
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
    const out = await loadManufacturerStepManifest(noEntries);
    expect(out).toEqual({ entries: [] });
  });

  it('shipped /parts/manufacturer-step.json is empty (honest default)', async () => {
    // The shipped file IS empty: verify that an honest fetch of it lands on
    // an empty manifest. (We simulate the real file payload here.)
    const shipped = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { entries: [] };
      },
    })) as unknown as typeof fetch;
    const out = await loadManufacturerStepManifest(shipped);
    expect(out).toEqual({ entries: [] });
  });
});

describe('loadStepGeometry (T44 STEP viewer, mock factory only)', () => {
  it('uses injected occtFactory to decode canned positions/normals', async () => {
    // Canned mesh: one triangle (3 vertices * 3 components = 9 floats).
    const cannedPositions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]);
    const cannedNormals = new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);

    const occtMock: OcctModule = {
      ReadStepFile() {
        return {
          success: true,
          meshes: [
            {
              attributes: {
                position: { array: cannedPositions },
                normal: { array: cannedNormals },
              },
            },
          ],
        };
      },
    };
    const factory = vi.fn(async () => occtMock);

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3]).buffer;
      },
    })) as unknown as typeof fetch;

    const geo: StepGeometry = await loadStepGeometry(
      'https://example.com/vk100.step',
      fakeFetch,
      factory,
    );
    expect(geo.positions).toBeInstanceOf(Float32Array);
    expect(Array.from(geo.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(geo.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(geo.triangleCount).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fakeFetch).toHaveBeenCalledWith('https://example.com/vk100.step');
  });

  it('throws on non-2xx fetch', async () => {
    const factory = vi.fn(async () => ({ ReadStepFile: () => ({ success: false, meshes: [] }) }));
    const fakeFetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      async arrayBuffer() {
        return new ArrayBuffer(0);
      },
    })) as unknown as typeof fetch;
    await expect(
      loadStepGeometry('https://example.com/missing.step', fakeFetch, factory),
    ).rejects.toThrow(/404/);
    // occt should never have been called when fetch failed.
    expect(factory).not.toHaveBeenCalled();
  });

  it('throws when occt-import-js reports failure', async () => {
    const occtMock: OcctModule = {
      ReadStepFile() {
        return { success: false, meshes: [] };
      },
    };
    const factory = vi.fn(async () => occtMock);
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async arrayBuffer() {
        return new Uint8Array([1]).buffer;
      },
    })) as unknown as typeof fetch;
    await expect(
      loadStepGeometry('https://example.com/bad.step', fakeFetch, factory),
    ).rejects.toThrow(/occt/);
  });

  it('synthesizes zero-filled normals when occt has none', async () => {
    const cannedPositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const occtMock: OcctModule = {
      ReadStepFile() {
        return {
          success: true,
          meshes: [
            {
              attributes: {
                position: { array: cannedPositions },
              },
            },
          ],
        };
      },
    };
    const factory = vi.fn(async () => occtMock);
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      async arrayBuffer() {
        return new Uint8Array([1]).buffer;
      },
    })) as unknown as typeof fetch;
    const geo = await loadStepGeometry(
      'https://example.com/no-normals.step',
      fakeFetch,
      factory,
    );
    expect(geo.normals.length).toBe(geo.positions.length);
    expect(geo.triangleCount).toBe(1);
  });
});
