import { describe, expect, it } from 'vitest';
import {
  makeBridgeInvoker,
  probeBridge,
  buildAutoSourceStatus,
} from '../src/components/auto-source-runner.js';
import { makeCatalogSourcer, runAutoSource } from '../src/components/auto-source.js';

// S5: VPS <-> OpenClaw bridge wiring for the autonomous part-sourcing run.
// HONESTY/fail-closed: nothing here is manufacturer-exact. The status object and
// endpoint FORCE parityGateStatus 'blocked' + manufacturerExactCount 0 regardless
// of inputs. On bridge failure the invoker THROWS (the sourcer catches -> null),
// it NEVER fabricates a found model.

describe('S5 buildAutoSourceStatus — fail-closed honesty', () => {
  it('FORCES parityGateStatus blocked + manufacturerExactCount 0 even when runResult lies', () => {
    const startedAtMs = 1_700_000_000_000;
    const finishedAtMs = 1_700_000_002_500;
    const status = buildAutoSourceStatus({
      // maliciously crafted runResult claiming a cleared gate
      runResult: {
        report: { foundCount: 1, createdCount: 2, generatedCount: 3, missingCount: 4 },
        functionalCoverage: { present: 6, total: 10, complete: false },
        manufacturerExactCount: 5,
        parityGateStatus: 'clear',
        disclaimer: 'best-effort',
      },
      bridge: { bridgeUrl: 'http://127.0.0.1:15000', reachable: true, openclaw: 'online' },
      startedAtMs,
      finishedAtMs,
    });

    // Forced honesty — never trust runResult's parity claims.
    expect(status.parityGateStatus).toBe('blocked');
    expect(status.manufacturerExactCount).toBe(0);

    // report counts map through
    expect(status.report).toEqual({
      foundCount: 1, createdCount: 2, generatedCount: 3, missingCount: 4,
    });
    expect(status.functionalCoverage).toEqual({ present: 6, total: 10, complete: false });

    // timing
    expect(status.durationMs).toBe(2500);
    expect(typeof status.lastRunAt).toBe('string');
    expect(status.lastRunAt).toBe(new Date(finishedAtMs).toISOString());
    expect(new Date(status.lastRunAt).toISOString()).toBe(status.lastRunAt); // valid ISO-8601

    // bridge reachability maps through
    expect(status.openclawReachable).toBe(true);
    expect(status.openclawStatus).toBe('online');
    expect(status.bridgeUrl).toBe('http://127.0.0.1:15000');
    expect(typeof status.note).toBe('string');
    expect(status.disclaimer).toBe('best-effort');
  });

  it('maps openclawReachable from bridge.reachable=false', () => {
    const status = buildAutoSourceStatus({
      runResult: {
        report: { foundCount: 0, createdCount: 0, generatedCount: 0, missingCount: 7 },
        functionalCoverage: { present: 0, total: 7, complete: false },
        disclaimer: 'd',
      },
      bridge: { bridgeUrl: null, reachable: false, openclaw: null },
      startedAtMs: 100,
      finishedAtMs: 150,
    });
    expect(status.openclawReachable).toBe(false);
    expect(status.openclawStatus).toBeNull();
    expect(status.bridgeUrl).toBeNull();
    expect(status.parityGateStatus).toBe('blocked');
    expect(status.manufacturerExactCount).toBe(0);
    expect(status.durationMs).toBe(50);
  });
});

describe('S5 makeBridgeInvoker — fail-soft is a THROW, never a fabricated model', () => {
  it('THROWS on a non-2xx response (does not resolve a model)', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const invoke = makeBridgeInvoker({ bridgeUrl: 'http://x', fetchImpl });
    await expect(invoke('web_cad_search', { q: 1 })).rejects.toThrow();
  });

  it('THROWS when the fetchImpl itself throws (network/connection-refused)', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    const invoke = makeBridgeInvoker({ bridgeUrl: 'http://x', fetchImpl });
    await expect(invoke('web_cad_search', { q: 1 })).rejects.toThrow();
  });

  it('returns the parsed payload on a 2xx response', async () => {
    const payload = { url: 'http://x/p.step', format: 'step' };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => payload });
    const invoke = makeBridgeInvoker({ bridgeUrl: 'http://x/', fetchImpl });
    const result = await invoke('web_cad_search', { q: 1 });
    expect(result).toEqual(payload);
  });

  it('unwraps a bridge-wrapped { result } envelope', async () => {
    const inner = { url: 'http://x/p.stl', format: 'stl' };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ result: inner }) });
    const invoke = makeBridgeInvoker({ bridgeUrl: 'http://x', fetchImpl });
    const result = await invoke('web_cad_search', { q: 1 });
    expect(result).toEqual(inner);
  });

  it('POSTs { tool, args } to <base>/codex-bridge/invoke with a trimmed base', async () => {
    let seenUrl = null; let seenInit = null;
    const fetchImpl = async (url, init) => {
      seenUrl = url; seenInit = init;
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    };
    const invoke = makeBridgeInvoker({ bridgeUrl: 'http://127.0.0.1:15000/', fetchImpl });
    await invoke('web_cad_search', { a: 2 });
    expect(seenUrl).toBe('http://127.0.0.1:15000/codex-bridge/invoke');
    expect(seenInit.method).toBe('POST');
    expect(JSON.parse(seenInit.body)).toEqual({ tool: 'web_cad_search', args: { a: 2 } });
  });
});

describe('S5 probeBridge — reachability observability, fail-soft', () => {
  it('200 with services.openclaw.status online => reachable true', async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => ({ services: { openclaw: { status: 'online' } } }),
    });
    const probe = probeBridge({ bridgeUrl: 'http://x', fetchImpl });
    const out = await probe();
    expect(out.reachable).toBe(true);
    expect(out.openclaw).toBe('online');
  });

  it('a throwing fetch => { reachable:false, openclaw:null } (never throws)', async () => {
    const fetchImpl = async () => { throw new Error('down'); };
    const probe = probeBridge({ bridgeUrl: 'http://x', fetchImpl });
    const out = await probe();
    expect(out.reachable).toBe(false);
    expect(out.openclaw).toBeNull();
  });

  it('non-2xx status => reachable false', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const probe = probeBridge({ bridgeUrl: 'http://x', fetchImpl });
    const out = await probe();
    expect(out.reachable).toBe(false);
  });
});

describe('S5 integration — end-to-end fail-soft degrade when the bridge is down', () => {
  it('a catalog sourcer whose fetch always 500s + NO scadRunner => every component missing, gate blocked, no throw', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const invoker = makeBridgeInvoker({ bridgeUrl: 'http://127.0.0.1:15000', fetchImpl });
    const catalog = makeCatalogSourcer({ invoker });

    const result = await runAutoSource({ sourcers: { catalog }, write: false });

    expect(result.parityGateStatus).toBe('blocked');
    expect(result.manufacturerExactCount).toBe(0);
    expect(result.found.length).toBe(0);
    expect(result.report.missingCount).toBe(result.report.missingCount); // sanity
    expect(result.report.missingCount).toBeGreaterThan(0);
    // Everything fell through to missing — nothing found/created/generated.
    expect(result.report.foundCount).toBe(0);
    expect(result.report.createdCount).toBe(0);
    expect(result.report.generatedCount).toBe(0);
  });
});
