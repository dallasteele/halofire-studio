// W8 part-geometry tests — the REAL per-part CAD geometry resolver + cached loader.
//
// The resolver is PURE: every network node TYPE (head / tee / elbow / reducer /
// cross / riser-source / valve) AND each pipe material resolves to a build123d STEP
// key that ACTUALLY EXISTS in the committed public/parts/build123d-parts.json (we
// assert the key + file are present). A part resolves to a proxy (null) ONLY when no
// manifest carries a verified body. The cached loader returns the SAME geometry
// instance for a repeat url, and fail-softs (throws) on a load error so the viewer
// can fall back to a proxy. occt-import-js is browser-only -> we inject a mock
// factory + fetch (jsdom has no WASM), exactly like the existing pdf/sam mocking.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  loadBuild123dManifest,
  type Build123dManifest,
} from '../../studio/src/lib/build123d-parts';
import {
  __clearPartGeometryCache,
  build123dHasKey,
  build123dStepUrl,
  headKeyFor,
  loadPartGeometry,
  NODE_TYPE_KEY,
  pipeKeyForMaterial,
  resolvePartModel,
  type OcctModule,
} from '../src/lib/part-geometry';
import type { Node, NodeType, PipeMaterial, Segment } from '../src/lib/model';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARTS_DIR = join(__dirname, '..', 'public', 'parts');

/** Load the REAL committed build123d manifest the cad app ships. */
async function realManifest(): Promise<Build123dManifest> {
  const path = join(PARTS_DIR, 'build123d-parts.json');
  const text = readFileSync(path, 'utf8');
  // Back loadBuild123dManifest with a fetch that serves the on-disk file.
  const fetchImpl = (async () => ({
    ok: true,
    json: async () => JSON.parse(text) as unknown,
  })) as unknown as typeof fetch;
  const m = await loadBuild123dManifest(fetchImpl);
  expect(m.entries.length).toBeGreaterThan(0);
  return m;
}

function node(type: NodeType, sku?: string): Node {
  return { id: `n_${type}`, type, pos: { x: 0, y: 10, z: 0 }, sku };
}

function segment(material: PipeMaterial, diameterIn: number): Segment {
  return {
    id: 's1',
    from: 'a',
    to: 'b',
    diameterIn,
    lengthFt: 5,
    role: 'BRANCH',
    material,
  };
}

/** A mock occt module returning a single tiny triangle, plus a call counter. */
function mockOcct(): { module: OcctModule; calls: { count: number } } {
  const calls = { count: 0 };
  const module: OcctModule = {
    ReadStepFile() {
      calls.count += 1;
      return {
        success: true,
        meshes: [
          {
            attributes: {
              position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
              normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
            },
          },
        ],
      };
    },
  };
  return { module, calls };
}

describe('resolvePartModel — every part type resolves to a REAL committed STEP key', () => {
  let manifest: Build123dManifest;
  beforeEach(async () => {
    manifest = await realManifest();
  });

  it('resolves a HEAD (no catalog part) to the default pendent build123d body that exists', () => {
    const m = resolvePartModel(node('HEAD'), { build123d: manifest });
    expect(m).not.toBeNull();
    expect(m!.source).toBe('build123d');
    expect(m!.provenanceTier).toBe('dimensioned_parametric');
    expect(m!.engineeringAccurate).toBe(false);
    // The key exists in the committed manifest AND the .step file is on disk.
    expect(build123dHasKey(manifest, m!.build123dKey)).toBe(true);
    expect(existsSync(join(PARTS_DIR, 'build123d', `${m!.build123dKey}.step`))).toBe(true);
  });

  it.each<[NodeType, string]>([
    ['TEE', 'fitting_tee'],
    ['ELBOW', 'fitting_elbow_90'],
    ['REDUCER', 'fitting_reducer'],
    ['CROSS', 'fitting_cross'],
    ['SOURCE', 'valve_osy_gate'],
    ['VALVE', 'valve_osy_gate'],
  ])('resolves node type %s to existing build123d key %s', (type, expectedKey) => {
    expect(NODE_TYPE_KEY[type]).toBe(expectedKey);
    const m = resolvePartModel(node(type), { build123d: manifest });
    expect(m).not.toBeNull();
    expect(m!.build123dKey).toBe(expectedKey);
    expect(m!.provenanceTier).toBe('dimensioned_parametric');
    expect(build123dHasKey(manifest, expectedKey)).toBe(true);
    expect(existsSync(join(PARTS_DIR, 'build123d', `${expectedKey}.step`))).toBe(true);
    expect(m!.stepUrl).toBe(build123dStepUrl(expectedKey));
  });

  it.each<[PipeMaterial, string]>([
    ['STEEL_SCH40', 'pipe_sch40'],
    ['STEEL_SCH10', 'pipe_sch10'],
    ['CPVC', 'pipe_sch40'],
    ['COPPER', 'pipe_sch40'],
  ])('resolves pipe material %s to existing pipe key %s', (material, expectedKey) => {
    expect(pipeKeyForMaterial(material)).toBe(expectedKey);
    const m = resolvePartModel(segment(material, 2), { build123d: manifest });
    expect(m).not.toBeNull();
    expect(m!.build123dKey).toBe(expectedKey);
    expect(build123dHasKey(manifest, expectedKey)).toBe(true);
    expect(existsSync(join(PARTS_DIR, 'build123d', `${expectedKey}.step`))).toBe(true);
  });

  it.each([0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4])(
    'resolves a pipe of every routed diameter (%s in) to a real pipe body',
    (d) => {
      const m = resolvePartModel(segment('STEEL_SCH40', d), { build123d: manifest });
      expect(m).not.toBeNull();
      expect(build123dHasKey(manifest, m!.build123dKey)).toBe(true);
    },
  );

  it('every head category+size key from headKeyFor exists in the manifest', () => {
    const cases: Array<[string, number]> = [
      ['head_pendent', 0.5],
      ['head_pendent', 0.75],
      ['head_pendent', 1],
      ['head_upright', 0.5],
      ['head_upright', 0.75],
      ['head_sidewall', 0.5],
      ['head_sidewall', 1],
    ];
    for (const [cat, size] of cases) {
      const key = headKeyFor(cat, size);
      expect(build123dHasKey(manifest, key)).toBe(true);
      expect(existsSync(join(PARTS_DIR, 'build123d', `${key}.step`))).toBe(true);
    }
  });
});

describe('resolvePartModel — honest proxy (null) only when truly no model', () => {
  it('returns null for any node type with an EMPTY manifest (caller draws a proxy)', () => {
    const empty: Build123dManifest = { entries: [] };
    for (const t of ['HEAD', 'TEE', 'ELBOW', 'REDUCER', 'CROSS', 'SOURCE', 'VALVE'] as NodeType[]) {
      expect(resolvePartModel(node(t), { build123d: empty })).toBeNull();
    }
    expect(resolvePartModel(segment('STEEL_SCH40', 2), { build123d: empty })).toBeNull();
  });

  it('returns null with no manifests supplied at all', () => {
    expect(resolvePartModel(node('TEE'))).toBeNull();
  });

  it('prefers a manufacturer STEP (manufacturer_verified) over build123d on a key match', async () => {
    const manifest = await realManifest();
    const m = resolvePartModel(node('TEE'), {
      build123d: manifest,
      manufacturerStep: {
        entries: [
          {
            key: 'fitting_tee',
            manufacturer: 'Acme',
            productCode: 'ACME-TEE',
            modelName: 'Acme Tee',
            stepUrl: '/parts/manufacturer-step/acme-tee.stp',
            sha256: 'a'.repeat(64),
            manufacturerExact: true,
          },
        ],
      },
    });
    expect(m).not.toBeNull();
    expect(m!.source).toBe('manufacturer-step');
    expect(m!.provenanceTier).toBe('manufacturer_verified');
    expect(m!.engineeringAccurate).toBe(true);
  });
});

describe('loadPartGeometry — cached by url, fail-soft on error', () => {
  beforeEach(() => {
    __clearPartGeometryCache();
  });

  it('returns the SAME geometry instance for a repeated url (instancing basis)', async () => {
    const { module, calls } = mockOcct();
    const fetchImpl = (async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as unknown as typeof fetch;
    const url = '/parts/build123d/fitting_tee.step';

    const g1 = await loadPartGeometry(url, fetchImpl, async () => module);
    const g2 = await loadPartGeometry(url, fetchImpl, async () => module);
    expect(g1).toBe(g2);
    // Decoded only ONCE despite two loads (the cache served the second).
    expect(calls.count).toBe(1);
    expect(g1.getAttribute('position').count).toBe(3);
  });

  it('rejects on a non-ok fetch and does NOT cache the failure (caller proxies)', async () => {
    const failing = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    const { module } = mockOcct();
    await expect(
      loadPartGeometry('/parts/build123d/missing.step', failing, async () => module),
    ).rejects.toThrow();

    // A later successful attempt for the same url still works (failure was evicted).
    const ok = (async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    })) as unknown as typeof fetch;
    const g = await loadPartGeometry('/parts/build123d/missing.step', ok, async () => module);
    expect(g.getAttribute('position').count).toBe(3);
  });

  it('rejects when occt fails to parse (success:false) so the viewer can proxy', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    })) as unknown as typeof fetch;
    const badOcct: OcctModule = { ReadStepFile: () => ({ success: false, meshes: [] }) };
    await expect(
      loadPartGeometry('/parts/build123d/bad.step', fetchImpl, async () => badOcct),
    ).rejects.toThrow();
  });

  it('HONORS the occt index (vertex pool + triangles), not a raw vertex soup', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    })) as unknown as typeof fetch;
    // A 4-vertex quad POOL + 2 triangles via index. The pre-fix code ignored the
    // index and drew the 4 pooled verts as a soup (the spiky-blob bug); the fix
    // must yield an INDEXED geometry (6 indices) over the preserved 4-vertex pool.
    const indexedOcct: OcctModule = {
      ReadStepFile: () => ({
        success: true,
        meshes: [
          {
            attributes: { position: { array: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0] } },
            index: { array: [0, 1, 2, 0, 2, 3] },
          },
        ],
      }),
    };
    const g = await loadPartGeometry(
      '/parts/build123d/indexed.step',
      fetchImpl,
      async () => indexedOcct,
    );
    const idx = g.getIndex();
    expect(idx).not.toBeNull();
    expect(idx!.count).toBe(6); // two triangles from the index, NOT a vertex soup
    expect(g.getAttribute('position').count).toBe(4); // pool preserved, not expanded
  });
});
