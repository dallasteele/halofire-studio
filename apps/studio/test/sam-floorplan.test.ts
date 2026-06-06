// T48 — BUILDING raster-FALLBACK lane tests (SAM segmentation, 2D MASK ONLY).
//
// Exercises the PURE injectable SAM pattern with a MOCK invoker (NO real network, NO
// SAM, NO GPU). Asserts:
//  - segmentFloorPlanViaSam with a mock invoker returning a known square
//    building_outline mask -> ok:true with the outline (top-level AND nested forms).
//  - FAIL-SOFT for invoker undefined / non-function / throws / empty / no-outline /
//    degenerate — every skip path returns skipped:true and NO outline.
//  - reconstructFootprintFromSam scales px->ft + computes areaSqft for the mock
//    square; THROWS when scale missing / 0 / negative / NaN.
//  - a skipped samResult -> honest empty footprint (no polygon).
//  - buildSamInvoker returns undefined without a bridgeUrl, a function with one, and
//    POSTs the SAM tool envelope to /codex-bridge/invoke via an injected fetch.

import { describe, expect, test } from 'vitest';

import {
  buildSamPayload,
  segmentFloorPlanViaSam,
  reconstructFootprintFromSam,
  type SamInvoker,
  type SamResult,
  type SamSegmentationResult,
} from '../src/lib/sam-floorplan';
import { buildSamInvoker, SAM_BRIDGE_TOOL } from '../src/lib/sam-invoker';

/** A known square building_outline mask in image pixels (200x300 px). */
function squareMaskPx(w = 200, h = 300): Array<[number, number]> {
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
}

/** A mock invoker that resolves to a top-level building_outline mask. */
function mockInvokerTopLevel(outlinePx: Array<[number, number]>): SamInvoker {
  return async () => ({ ok: true, building_outline: outlinePx } as SamResult);
}

/** A mock invoker that resolves to a nested layers.building_outline mask. */
function mockInvokerNested(outlinePx: Array<[number, number]>): SamInvoker {
  return async () => ({ ok: true, layers: { building_outline: outlinePx } } as SamResult);
}

/* ------------------------------------------------------ buildSamPayload */

describe('buildSamPayload — deterministic', () => {
  test('builds the SAM tool envelope with carried scale + default target', () => {
    const p = buildSamPayload({ imageRef: 'plan.png', scaleFtPerPx: 0.1 });
    expect(p).toEqual({
      tool: 'sam_segment_floorplan',
      op: 'segment_floorplan',
      imageRef: 'plan.png',
      scaleFtPerPx: 0.1,
      targets: ['building_outline'],
    });
  });

  test('null imageRef + absent scale -> null fields (no fabrication)', () => {
    const p = buildSamPayload({});
    expect(p.imageRef).toBeNull();
    expect(p.scaleFtPerPx).toBeNull();
  });

  test('identical inputs -> identical output (deterministic)', () => {
    const a = buildSamPayload({ imageRef: 'x', scaleFtPerPx: 0.25, targets: ['building_outline'] });
    const b = buildSamPayload({ imageRef: 'x', scaleFtPerPx: 0.25, targets: ['building_outline'] });
    expect(a).toEqual(b);
  });
});

/* ---------------------------------------------- segmentFloorPlanViaSam (ok) */

describe('segmentFloorPlanViaSam — usable SAM mask (mock invoker)', () => {
  test('top-level building_outline -> ok:true with the outline + sam-3 source', async () => {
    const mask = squareMaskPx();
    const res = await segmentFloorPlanViaSam({
      invoker: mockInvokerTopLevel(mask),
      imageRef: 'plan.png',
      scaleFtPerPx: 0.1,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe('sam-3');
      expect(res.outlinePx).toEqual(mask);
      expect(res.label).toMatch(/2D MASK ONLY/i);
      expect(res.label).toMatch(/NOT vector-exact/i);
    }
  });

  test('nested layers.building_outline is also accepted', async () => {
    const mask = squareMaskPx(120, 120);
    const res = await segmentFloorPlanViaSam({ invoker: mockInvokerNested(mask), scaleFtPerPx: 0.1 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.outlinePx).toEqual(mask);
  });
});

/* ----------------------------------- segmentFloorPlanViaSam (FAIL-SOFT) */

/** Assert a result is skipped AND carries NO outline on every skip path. */
function expectSkippedNoOutline(res: SamSegmentationResult): void {
  expect(res.ok).toBe(false);
  expect((res as { skipped?: boolean }).skipped).toBe(true);
  expect((res as { reason?: string }).reason).toBeTruthy();
  // NO outline is present on ANY skip path.
  expect('outlinePx' in res).toBe(false);
}

describe('segmentFloorPlanViaSam — fail-soft (never fabricates a mask)', () => {
  test('invoker undefined -> skipped, no outline', async () => {
    const res = await segmentFloorPlanViaSam({ scaleFtPerPx: 0.1 });
    expectSkippedNoOutline(res);
    expect((res as { reason: string }).reason).toBe('sam_invoker_unavailable');
  });

  test('invoker not a function -> skipped, no outline', async () => {
    const res = await segmentFloorPlanViaSam({
      // @ts-expect-error intentionally passing a non-function to assert the guard
      invoker: 'not-a-function',
      scaleFtPerPx: 0.1,
    });
    expectSkippedNoOutline(res);
    expect((res as { reason: string }).reason).toBe('sam_invoker_unavailable');
  });

  test('invoker throws -> skipped, no outline (reason carries the cause)', async () => {
    const invoker: SamInvoker = async () => {
      throw new Error('bridge down');
    };
    const res = await segmentFloorPlanViaSam({ invoker, scaleFtPerPx: 0.1 });
    expectSkippedNoOutline(res);
    expect((res as { reason: string }).reason).toMatch(/sam_invoke_failed/);
    expect((res as { reason: string }).reason).toMatch(/bridge down/);
  });

  test('invoker resolves empty / null -> skipped, no outline', async () => {
    const empty: SamInvoker = async () => null as unknown as SamResult;
    const res = await segmentFloorPlanViaSam({ invoker: empty, scaleFtPerPx: 0.1 });
    expectSkippedNoOutline(res);
  });

  test('invoker result has no building_outline -> skipped, no outline', async () => {
    const noOutline: SamInvoker = async () => ({ ok: true, layers: { walls: [] } } as SamResult);
    const res = await segmentFloorPlanViaSam({ invoker: noOutline, scaleFtPerPx: 0.1 });
    expectSkippedNoOutline(res);
    expect((res as { reason: string }).reason).toBe('sam_no_building_outline');
  });

  test('degenerate (<3 point) building_outline -> skipped, no outline', async () => {
    const degenerate: SamInvoker = async () =>
      ({ ok: true, building_outline: [[0, 0], [1, 1]] } as unknown as SamResult);
    const res = await segmentFloorPlanViaSam({ invoker: degenerate, scaleFtPerPx: 0.1 });
    expectSkippedNoOutline(res);
    expect((res as { reason: string }).reason).toBe('sam_no_building_outline');
  });
});

/* ------------------------------------------ reconstructFootprintFromSam */

describe('reconstructFootprintFromSam — px->ft scale + shoelace area', () => {
  test('200x300 px square at 0.1 ft/px -> 20x30 ft footprint, 600 sqft', async () => {
    const seg = await segmentFloorPlanViaSam({
      invoker: mockInvokerTopLevel(squareMaskPx(200, 300)),
      scaleFtPerPx: 0.1,
    });
    const fp = reconstructFootprintFromSam(seg, { scaleFtPerPx: 0.1 });
    expect(fp.empty).toBe(false);
    expect(fp.method).toBe('sam-raster');
    expect(fp.bboxFt.w).toBeCloseTo(20, 6);
    expect(fp.bboxFt.l).toBeCloseTo(30, 6);
    expect(fp.areaSqft).toBeCloseTo(600, 6);
    // outline is the scaled ring in feet.
    expect(fp.outline).toEqual([
      [0, 0],
      [20, 0],
      [20, 30],
      [0, 30],
    ]);
    expect(fp.note).toMatch(/RASTER/i);
    expect(fp.note).toMatch(/NOT vector-exact/i);
  });

  test('determinism: identical SAM result + scale -> identical footprint', async () => {
    const seg = await segmentFloorPlanViaSam({
      invoker: mockInvokerTopLevel(squareMaskPx()),
      scaleFtPerPx: 0.1,
    });
    const a = reconstructFootprintFromSam(seg, { scaleFtPerPx: 0.1 });
    const b = reconstructFootprintFromSam(seg, { scaleFtPerPx: 0.1 });
    expect(a).toEqual(b);
  });
});

describe('reconstructFootprintFromSam — scale discipline (fail-closed)', () => {
  const okSeg: SamSegmentationResult = {
    ok: true,
    source: 'sam-3',
    outlinePx: squareMaskPx(),
    label: 'x',
  };

  test('THROWS when scaleFtPerPx is missing', () => {
    expect(() => reconstructFootprintFromSam(okSeg, {} as never)).toThrow(/scaleFtPerPx/);
  });
  test('THROWS when scaleFtPerPx is 0', () => {
    expect(() => reconstructFootprintFromSam(okSeg, { scaleFtPerPx: 0 })).toThrow(/scaleFtPerPx/);
  });
  test('THROWS when scaleFtPerPx is negative', () => {
    expect(() => reconstructFootprintFromSam(okSeg, { scaleFtPerPx: -1 })).toThrow(/scaleFtPerPx/);
  });
  test('THROWS when scaleFtPerPx is NaN', () => {
    expect(() => reconstructFootprintFromSam(okSeg, { scaleFtPerPx: NaN })).toThrow(/scaleFtPerPx/);
  });
});

describe('reconstructFootprintFromSam — skipped -> honest empty footprint', () => {
  test('skipped samResult -> empty:true, NO polygon', () => {
    const skipped: SamSegmentationResult = {
      ok: false,
      skipped: true,
      reason: 'sam_invoker_unavailable',
    };
    const fp = reconstructFootprintFromSam(skipped, { scaleFtPerPx: 0.1 });
    expect(fp.empty).toBe(true);
    expect(fp.outline).toEqual([]);
    expect(fp.areaSqft).toBe(0);
    expect(fp.method).toBe('sam-raster-skipped');
  });

  test('null samResult -> empty:true, NO polygon (still validates scale first)', () => {
    const fp = reconstructFootprintFromSam(null, { scaleFtPerPx: 0.1 });
    expect(fp.empty).toBe(true);
    expect(fp.outline).toEqual([]);
  });

  test('skipped result with a BAD scale still THROWS (scale validated first)', () => {
    const skipped: SamSegmentationResult = { ok: false, skipped: true, reason: 'x' };
    expect(() => reconstructFootprintFromSam(skipped, { scaleFtPerPx: 0 })).toThrow(/scaleFtPerPx/);
  });
});

/* ----------------------------------------------------- buildSamInvoker */

describe('buildSamInvoker — disabled by default, wired when a bridgeUrl is given', () => {
  test('no bridgeUrl -> undefined (SAM DISABLED)', () => {
    expect(buildSamInvoker()).toBeUndefined();
    expect(buildSamInvoker({})).toBeUndefined();
    expect(buildSamInvoker({ bridgeUrl: '' })).toBeUndefined();
    expect(buildSamInvoker({ bridgeUrl: '   ' })).toBeUndefined();
  });

  test('with a bridgeUrl -> a function', () => {
    const inv = buildSamInvoker({ bridgeUrl: 'http://localhost:19002', fetchImpl: (async () => ({})) as unknown as typeof fetch });
    expect(typeof inv).toBe('function');
  });

  test('the invoker POSTs the SAM tool envelope to /codex-bridge/invoke via injected fetch', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, building_outline: squareMaskPx() }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const inv = buildSamInvoker({ bridgeUrl: 'http://localhost:19002/', fetchImpl });
    expect(inv).toBeTruthy();
    const payload = buildSamPayload({ imageRef: 'plan.png', scaleFtPerPx: 0.1 });
    const out = await (inv as SamInvoker)(payload);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:19002/codex-bridge/invoke');
    expect(calls[0].body).toEqual({ tool: SAM_BRIDGE_TOOL, args: payload });
    expect((out as SamResult).building_outline).toEqual(squareMaskPx());
  });

  test('a non-2xx bridge response THROWS (caller fail-softs it to skipped)', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch;
    const inv = buildSamInvoker({ bridgeUrl: 'http://localhost:19002', fetchImpl }) as SamInvoker;
    await expect(inv(buildSamPayload({}))).rejects.toThrow(/503/);

    // End-to-end: the throwing invoker is swallowed by segmentFloorPlanViaSam.
    const res = await segmentFloorPlanViaSam({ invoker: inv, scaleFtPerPx: 0.1 });
    expect(res.ok).toBe(false);
    expect((res as { skipped: boolean }).skipped).toBe(true);
  });
});
