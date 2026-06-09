// openclaw-invoker tests — the REAL production wiring for the GX10 codex bridge.
// All network is mocked; we assert the request SHAPE the bridge expects
// ({kind:'openclaw_tool', tool, args} + bearer auth) and the fail-soft contract.

import { describe, expect, it } from 'vitest';
import { buildBridgeInvoker, resolveBridgeBase } from '../src/cad/openclaw-invoker.js';
import { invokeOpenClawCad } from '../src/cad/openclaw-cad.js';

describe('resolveBridgeBase', () => {
  it('is null when no env is set (bridge unconfigured)', () => {
    expect(resolveBridgeBase({})).toBeNull();
  });

  it('prefers OPENCLAW_CAD_BRIDGE_URL over HAL_API_URL and strips trailing slash', () => {
    expect(
      resolveBridgeBase({
        OPENCLAW_CAD_BRIDGE_URL: 'http://192.168.1.76:9000/',
        HAL_API_URL: 'http://other:9000',
      }),
    ).toBe('http://192.168.1.76:9000');
    expect(resolveBridgeBase({ HAL_API_URL: 'http://gx10:9000' })).toBe('http://gx10:9000');
  });
});

describe('buildBridgeInvoker', () => {
  it('returns null when unconfigured — invokeOpenClawCad then degrades honestly', async () => {
    const invoker = buildBridgeInvoker({});
    expect(invoker).toBeNull();
    const out = await invokeOpenClawCad('generate_dxf', { tool: 'generate_dxf' }, {});
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
  });

  it('POSTs the openclaw_tool envelope with bearer auth and returns parsed JSON', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, json: async () => ({ ok: true, artifact: 'model.glb' }) };
    };
    const invoker = buildBridgeInvoker(
      { OPENCLAW_CAD_BRIDGE_URL: 'http://gx10:9000', OPENCLAW_CAD_BRIDGE_TOKEN: 'tok123' },
      fetchImpl,
    );
    const result = await invoker('generate_3d_model', { project: 'P', solids: {} });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://gx10:9000/codex-bridge/invoke');
    expect(calls[0].opts.method).toBe('POST');
    expect(calls[0].opts.headers.Authorization).toBe('Bearer tok123');
    const body = JSON.parse(calls[0].opts.body);
    expect(body.kind).toBe('openclaw_tool');
    expect(body.tool).toBe('generate_3d_model');
    expect(body.args.project).toBe('P');
    expect(result.artifact).toBe('model.glb');
  });

  it('throws on a non-ok HTTP status — invokeOpenClawCad catches and skips', async () => {
    const fetchImpl = async () => ({ ok: false, status: 502, text: async () => 'bad gateway' });
    const invoker = buildBridgeInvoker({ HAL_API_URL: 'http://gx10:9000' }, fetchImpl);
    await expect(invoker('generate_dxf', {})).rejects.toThrow(/502/);

    const out = await invokeOpenClawCad('generate_dxf', { tool: 'generate_dxf' }, { invoker });
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
    expect(out.reason).toMatch(/502/);
  });
});
