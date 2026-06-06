import { describe, expect, it, vi } from 'vitest';
import {
  AI_3D_BRIDGE_TOOL,
  buildAi3dInvoker,
  generateAiPlaceholder,
  type Ai3dInvoker,
  type Ai3dPayload,
} from '../src/lib/ai-3d-invoker';
import { resolveCatalogGeometry } from '../src/lib/catalog-geometry';
import type { CatalogPart } from '../src/lib/manufacturer-catalog';

const payload: Ai3dPayload = {
  skuId: 'reliable-ra1314',
  imageUrl: 'https://example.com/part.png',
  prompt: 'Reliable F1-56 pendent head, 1/2 in NPT',
};

function sku(): CatalogPart {
  return {
    id: 'reliable-ra1314',
    mfr: 'Reliable',
    model: 'Model F1-56',
    sin: 'RA1314',
    category: 'head_pendent',
    kFactor: 5.6,
    port: { method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' },
    tempRatingsF: null,
    responseType: null,
    finishes: null,
    datasheetUrl: 'https://example.com/s.pdf',
    sourceUrl: 'https://example.com/s.pdf',
  };
}

describe('buildAi3dInvoker (mirror of buildSamInvoker)', () => {
  it('returns undefined with NO bridgeUrl (DISABLED by default)', () => {
    expect(buildAi3dInvoker()).toBeUndefined();
    expect(buildAi3dInvoker({})).toBeUndefined();
    expect(buildAi3dInvoker({ bridgeUrl: '   ' })).toBeUndefined();
  });

  it('returns an invoker when a bridgeUrl is supplied; POSTs the generate_3d_model tool', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { assetUrl: '/parts/ai/x.glb' };
      },
    })) as unknown as typeof fetch;
    const invoker = buildAi3dInvoker({ bridgeUrl: 'http://bridge', fetchImpl });
    expect(typeof invoker).toBe('function');
    const res = await invoker!(payload);
    expect(res.assetUrl).toBe('/parts/ai/x.glb');
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('http://bridge/codex-bridge/invoke');
    const body = JSON.parse(call[1].body);
    expect(body.tool).toBe(AI_3D_BRIDGE_TOOL);
    expect(body.args.skuId).toBe('reliable-ra1314');
  });

  it('THROWS on non-2xx so the caller can fail-soft', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, async json() { return {}; } })) as unknown as typeof fetch;
    const invoker = buildAi3dInvoker({ bridgeUrl: 'http://bridge', fetchImpl })!;
    await expect(invoker(payload)).rejects.toThrow(/ai-3d bridge HTTP 500/);
  });
});

describe('generateAiPlaceholder — fail-closed, capped at visual_reference', () => {
  it('DISABLED by default: no invoker -> returns null, generates nothing', async () => {
    expect(await generateAiPlaceholder(payload)).toBeNull();
    expect(await generateAiPlaceholder(payload, undefined)).toBeNull();
  });

  it('fail-soft: an invoker that THROWS -> returns null (nothing fabricated)', async () => {
    const invoker: Ai3dInvoker = async () => {
      throw new Error('[Errno 21] Is a directory: .');
    };
    expect(await generateAiPlaceholder(payload, invoker)).toBeNull();
  });

  it('fail-soft: a result with no usable assetUrl -> returns null', async () => {
    const empty: Ai3dInvoker = async () => ({});
    const blank: Ai3dInvoker = async () => ({ assetUrl: '   ' });
    expect(await generateAiPlaceholder(payload, empty)).toBeNull();
    expect(await generateAiPlaceholder(payload, blank)).toBeNull();
  });

  it('a successful result yields an ai-placeholder entry, NEVER above visual_reference', async () => {
    const invoker: Ai3dInvoker = async () => ({ assetUrl: '/parts/ai/x.glb', sourceUrl: 'http://src' });
    const entry = await generateAiPlaceholder(payload, invoker);
    expect(entry).not.toBeNull();
    expect(entry!.skuId).toBe('reliable-ra1314');
    expect(entry!.assetUrl).toBe('/parts/ai/x.glb');
    // The resolver pins ANY ai-placeholder to visual_reference / not accurate.
    const geo = resolveCatalogGeometry(sku(), {
      aiPlaceholder: { entries: [entry!] },
    });
    expect(geo.source).toBe('ai-placeholder');
    expect(geo.modelStatus).toBe('visual_reference');
    expect(geo.engineeringAccurate).toBe(false);
  });
});
