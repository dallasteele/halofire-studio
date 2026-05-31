import { describe, it, expect } from 'vitest';
import {
  buildPlanSegmentationPayload,
  segmentFloorPlanViaSam,
  reconstructFloorPlanFromSam,
} from '../src/components/sam-floorplan.js';
import { layoutRoom, polygonArea } from '../src/engine/sprinkler-layout.js';

// T35 — SAM 3.1 plan segmentation via OpenClaw.
//
// These tests exercise the PURE, portable core of the SAM-3.1 floor-plan
// segmentation adapter with a MOCK invoker, so they run everywhere with NO real
// network / OpenClaw / GX10 / pdfjs / canvas. The real SAM run is DEFERRED until
// the OpenClaw governed bridge is reachable (it is currently HTTP_UNREACHABLE);
// this module BUILDS the capability fail-soft and is verified against a synthetic
// segmentation result, exactly like T18 sam-reconstruct was built with a mock.
//
// HONESTY: a SAM mask/polygon is REAL segmentation when the bridge runs — never
// fabricated. When the invoker is absent/non-function/throws/empty/no-polygon the
// adapter degrades to { ok:false, skipped:true, reason } WITHOUT throwing and
// WITHOUT inventing a polygon. The px->feet `scale` is operator/drawing-derived
// and reconstructFloorPlanFromSam THROWS when it is missing/<=0, exactly like
// floorPlanFromPdf. No parity / AHJ / PE / accuracy claim is made.

const BEST_EFFORT = /best-effort SAM 3\.1 plan segmentation — NOT AHJ\/PE\/AutoSprink\/manufacturer parity/;

describe('buildPlanSegmentationPayload — deterministic request shape', () => {
  it('builds the sam-3.1 segment_floorplan payload with defaults', () => {
    const payload = buildPlanSegmentationPayload({ pdfRef: 'plans/1881.pdf', scale: 0.1 });
    expect(payload).toBeTypeOf('object');
    expect(payload.service).toBe('sam-3.1');
    expect(payload.op).toBe('segment_floorplan');
    expect(payload.pdfRef).toBe('plans/1881.pdf');
    expect(payload.pageIndex).toBe(0);
    expect(payload.scale).toBe(0.1);
    // targets default to the four building layers.
    expect(payload.targets).toEqual(['building_outline', 'walls', 'rooms', 'layers']);
  });

  it('honors explicit pageIndex + targets', () => {
    const payload = buildPlanSegmentationPayload({
      pdfRef: 'plans/1881.pdf',
      pageIndex: 7,
      scale: 0.25,
      targets: ['building_outline', 'mep'],
    });
    expect(payload.pageIndex).toBe(7);
    expect(payload.targets).toEqual(['building_outline', 'mep']);
  });

  it('is deterministic for the same inputs', () => {
    const a = buildPlanSegmentationPayload({ pdfRef: 'p.pdf', pageIndex: 1, scale: 0.2 });
    const b = buildPlanSegmentationPayload({ pdfRef: 'p.pdf', pageIndex: 1, scale: 0.2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('segmentFloorPlanViaSam — injected async invoker (MOCK)', () => {
  const pdfRef = 'plans/cooperative-1881.pdf';

  it('returns ok + layers + best-effort label on a usable mock segmentation', async () => {
    const segmentation = {
      building_outline: [[100, 100], [700, 100], [700, 500], [100, 500]],
      walls: [{ x1: 100, y1: 100, x2: 700, y2: 100 }],
      rooms: [{ name: 'Unit A', polygon: [[100, 100], [400, 100], [400, 300], [100, 300]] }],
      imageSize: { w: 800, h: 600 },
    };
    const invoker = async (payload) => {
      expect(payload.service).toBe('sam-3.1');
      expect(payload.op).toBe('segment_floorplan');
      expect(payload.pdfRef).toBe(pdfRef);
      return segmentation;
    };
    const result = await segmentFloorPlanViaSam({ invoker, pdfRef, scale: 0.1 });
    expect(result.ok).toBe(true);
    expect(result.source).toBe('sam-3.1');
    expect(result.layers.building_outline).toEqual(segmentation.building_outline);
    expect(result.layers.walls).toEqual(segmentation.walls);
    expect(result.layers.rooms).toEqual(segmentation.rooms);
    expect(result.imageSize).toEqual({ w: 800, h: 600 });
    expect(result.label).toMatch(BEST_EFFORT);
  });

  it('accepts a result with only a non-empty layers map (no top-level building_outline)', async () => {
    const invoker = async () => ({
      layers: { building_outline: [[0, 0], [10, 0], [10, 10], [0, 10]] },
    });
    const result = await segmentFloorPlanViaSam({ invoker, pdfRef, scale: 0.1 });
    expect(result.ok).toBe(true);
    expect(result.layers.building_outline).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });

  it('FAIL-SOFT: no invoker -> skipped, no fabricated polygon', async () => {
    const result = await segmentFloorPlanViaSam({ pdfRef, scale: 0.1 });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(typeof result.reason).toBe('string');
    expect(result.layers).toBeUndefined();
  });

  it('FAIL-SOFT: opts omitted entirely -> skipped (no throw)', async () => {
    const result = await segmentFloorPlanViaSam();
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.layers).toBeUndefined();
  });

  it('FAIL-SOFT: invoker not a function -> skipped, no fabricated polygon', async () => {
    const result = await segmentFloorPlanViaSam({ invoker: 'nope', pdfRef, scale: 0.1 });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.layers).toBeUndefined();
  });

  it('FAIL-SOFT: invoker throws (OpenClaw/GX10 down) -> skipped, no fabricated polygon', async () => {
    const invoker = async () => {
      throw new Error('ECONNREFUSED openclaw bridge');
    };
    const result = await segmentFloorPlanViaSam({ invoker, pdfRef, scale: 0.1 });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(typeof result.reason).toBe('string');
    expect(result.layers).toBeUndefined();
  });

  it('FAIL-SOFT: invoker returns {} (empty) -> skipped, no fabricated polygon', async () => {
    const invoker = async () => ({});
    const result = await segmentFloorPlanViaSam({ invoker, pdfRef, scale: 0.1 });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.layers).toBeUndefined();
  });

  it('FAIL-SOFT: invoker returns no building_outline / empty layers -> skipped', async () => {
    const invoker = async () => ({ walls: [], layers: {} });
    const result = await segmentFloorPlanViaSam({ invoker, pdfRef, scale: 0.1 });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.layers).toBeUndefined();
  });

  it('FAIL-SOFT: building_outline present but degenerate (< 3 points) -> skipped', async () => {
    const invoker = async () => ({ building_outline: [[0, 0], [10, 0]] });
    const result = await segmentFloorPlanViaSam({ invoker, pdfRef, scale: 0.1 });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.layers).toBeUndefined();
  });
});

describe('reconstructFloorPlanFromSam — px -> feet scaling', () => {
  const samResult = {
    ok: true,
    source: 'sam-3.1',
    layers: {
      // 600 px wide (100..700) x 400 px tall (100..500).
      building_outline: [[100, 100], [700, 100], [700, 500], [100, 500]],
      walls: [{ x1: 100, y1: 100, x2: 700, y2: 100 }],
      rooms: [{ name: 'Unit A' }],
    },
    imageSize: { w: 800, h: 600 },
    label: 'best-effort',
  };

  it('scales the building_outline px->ft by scale (0.1 ft/px -> 60x40 ft room)', () => {
    const recon = reconstructFloorPlanFromSam(samResult, { scale: 0.1, hazard: 'ordinary' });
    expect(recon.rooms).toHaveLength(1);
    const poly = recon.rooms[0].polygon;
    // (100,100)->(10,10), (700,100)->(70,10), (700,500)->(70,50), (100,500)->(10,50)
    expect(poly).toEqual([[10, 10], [70, 10], [70, 50], [10, 50]]);
    expect(recon.rooms[0].hazard).toBe('ordinary');
    // 60 ft x 40 ft = 2400 sqft via shoelace.
    expect(recon.areaSqft).toBeCloseTo(2400, 6);
    expect(polygonArea(poly)).toBeCloseTo(2400, 6);
    // bbox in feet.
    expect(recon.bbox).toMatchObject({ minX: 10, minY: 10, maxX: 70, maxY: 50 });
    // other SAM layers carried for future per-layer use.
    expect(recon.layerMap.walls).toEqual(samResult.layers.walls);
    expect(recon.layerMap.rooms).toEqual(samResult.layers.rooms);
    // honest note, no AHJ/PE claim.
    expect(typeof recon.note).toBe('string');
    expect(recon.note).toMatch(/best-effort|approxim/i);
  });

  it('THROWS on missing scale (operator/drawing-derived, never guessed)', () => {
    expect(() => reconstructFloorPlanFromSam(samResult, {})).toThrow(/scale/i);
  });

  it('THROWS on non-positive scale', () => {
    expect(() => reconstructFloorPlanFromSam(samResult, { scale: 0 })).toThrow(/scale/i);
    expect(() => reconstructFloorPlanFromSam(samResult, { scale: -0.1 })).toThrow(/scale/i);
  });

  it('reconstructed rooms feed layoutRoom and produce heads > 0 (real layout engine)', () => {
    const recon = reconstructFloorPlanFromSam(samResult, { scale: 0.1, hazard: 'ordinary' });
    const layout = layoutRoom(recon.rooms[0]);
    expect(layout.heads.length).toBeGreaterThan(0);
  });
});
