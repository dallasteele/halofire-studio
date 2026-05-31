import { describe, expect, test } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  extractSegmentsFromOpList,
  segmentsToFloorPlan,
  floorPlanFromPdf,
  isolateContentRegion,
  isolatePlanExtent,
  buildingOutlinePolygon,
  selectWallLayer,
} from '../src/engine/pdf-floorplan.js';
import { polygonArea } from '../src/engine/sprinkler-layout.js';

// T28 — PDF plan ingestion. These tests exercise the PURE, portable core of the
// vector-PDF floor-plan extractor with SYNTHETIC pdfjs operator lists, so they
// run everywhere (no real file, no worker, no canvas). The geometry that comes
// out of a real plan is REAL (it is the plan's own vector path ops); here we feed
// known synthetic ops and assert the segments + bbox + the points->feet scale.
//
// HONESTY: the PDF-point -> feet `scale` is OPERATOR-SUPPLIED, never guessed; the
// bbox footprint is an honest first-pass approximation of the extracted extents,
// explicitly NOT an AHJ/PE/accurate drawing. No claim gate is touched here.

// Helper: build a legacy-style op list from primitive path operators.
function opList(entries) {
  const fnArray = [];
  const argsArray = [];
  for (const [fn, args] of entries) {
    fnArray.push(fn);
    argsArray.push(args);
  }
  return { fnArray, argsArray };
}

describe('extractSegmentsFromOpList — legacy moveTo/lineTo path ops', () => {
  test('walks a closed triangle into 3 segments (closePath connects back to start)', () => {
    const ops = opList([
      [OPS.moveTo, [0, 0]],
      [OPS.lineTo, [10, 0]],
      [OPS.lineTo, [10, 10]],
      [OPS.closePath, []],
    ]);
    const { segments, count, bbox } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(3);
    expect(segments).toEqual([
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 10, y1: 0, x2: 10, y2: 10 },
      { x1: 10, y1: 10, x2: 0, y2: 0 },
    ]);
    expect(bbox.minX).toBe(0);
    expect(bbox.minY).toBe(0);
    expect(bbox.maxX).toBe(10);
    expect(bbox.maxY).toBe(10);
    expect(bbox.widthFt).toBe(10);
    expect(bbox.heightFt).toBe(10);
  });

  test('an open polyline emits N-1 segments and does NOT close', () => {
    const ops = opList([
      [OPS.moveTo, [0, 0]],
      [OPS.lineTo, [5, 0]],
      [OPS.lineTo, [5, 5]],
    ]);
    const { segments, count } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(2);
    expect(segments).toEqual([
      { x1: 0, y1: 0, x2: 5, y2: 0 },
      { x1: 5, y1: 0, x2: 5, y2: 5 },
    ]);
  });

  test('a rectangle op emits 4 closed segments', () => {
    // OPS.rectangle args: [x, y, width, height]
    const ops = opList([[OPS.rectangle, [2, 3, 8, 6]]]);
    const { segments, count, bbox } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(4);
    expect(segments).toEqual([
      { x1: 2, y1: 3, x2: 10, y2: 3 },
      { x1: 10, y1: 3, x2: 10, y2: 9 },
      { x1: 10, y1: 9, x2: 2, y2: 9 },
      { x1: 2, y1: 9, x2: 2, y2: 3 },
    ]);
    expect(bbox.minX).toBe(2);
    expect(bbox.maxX).toBe(10);
    expect(bbox.minY).toBe(3);
    expect(bbox.maxY).toBe(9);
  });

  test('scale maps PDF points -> feet (0.125 ft/pt on an 800x600pt rect -> 100x75 ft)', () => {
    const ops = opList([[OPS.rectangle, [0, 0, 800, 600]]]);
    const { bbox } = extractSegmentsFromOpList(ops, { scale: 0.125 });
    expect(bbox.minX).toBe(0);
    expect(bbox.minY).toBe(0);
    expect(bbox.maxX).toBeCloseTo(100, 6);
    expect(bbox.maxY).toBeCloseTo(75, 6);
    expect(bbox.widthFt).toBeCloseTo(100, 6);
    expect(bbox.heightFt).toBeCloseTo(75, 6);
  });

  test('curveTo is approximated by its endpoint (a single segment to the curve end)', () => {
    // OPS.curveTo args: [x1, y1, x2, y2, x, y] (two control points + endpoint).
    const ops = opList([
      [OPS.moveTo, [0, 0]],
      [OPS.curveTo, [1, 5, 9, 5, 10, 0]],
    ]);
    const { segments, count } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(1);
    expect(segments).toEqual([{ x1: 0, y1: 0, x2: 10, y2: 0 }]);
  });

  test('text/image ops are ignored', () => {
    const ops = opList([
      [OPS.beginText, []],
      [OPS.showText, [[{ unicode: 'x' }]]],
      [OPS.endText, []],
      [OPS.moveTo, [0, 0]],
      [OPS.lineTo, [4, 0]],
      [OPS.paintImageXObject, ['img1']],
    ]);
    const { segments, count } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(1);
    expect(segments).toEqual([{ x1: 0, y1: 0, x2: 4, y2: 0 }]);
  });
});

describe('extractSegmentsFromOpList — batched OPS.constructPath', () => {
  // Modern pdfjs (v6) batches a whole path into ONE constructPath op. The args
  // are [opType, [pathBuffer], minMax] where pathBuffer is a flat DrawOPS-coded
  // typed array: code 0=moveTo (2 coords), 1=lineTo (2), 2=curveTo (6),
  // 3=quadraticCurveTo (4), 4=closePath (0). The extractor MUST handle this.
  test('v6 DrawOPS buffer form: a rectangle path -> 4 closed segments', () => {
    // moveTo(0,0) lineTo(20,0) lineTo(20,10) lineTo(0,10) closePath
    const buffer = new Float32Array([
      0, 0, 0,
      1, 20, 0,
      1, 20, 10,
      1, 0, 10,
      4,
    ]);
    const ops = opList([[OPS.constructPath, [/* opType */ OPS.fill, [buffer], new Float32Array([0, 0, 20, 10])]]]);
    const { segments, count, bbox } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(4);
    expect(segments).toEqual([
      { x1: 0, y1: 0, x2: 20, y2: 0 },
      { x1: 20, y1: 0, x2: 20, y2: 10 },
      { x1: 20, y1: 10, x2: 0, y2: 10 },
      { x1: 0, y1: 10, x2: 0, y2: 0 },
    ]);
    expect(bbox.widthFt).toBe(20);
    expect(bbox.heightFt).toBe(10);
  });

  test('v6 DrawOPS buffer form: curveTo (code 2, 6 coords) approximated by endpoint', () => {
    const buffer = new Float32Array([
      0, 0, 0,
      2, 1, 5, 9, 5, 10, 0,
    ]);
    const ops = opList([[OPS.constructPath, [OPS.stroke, [buffer], new Float32Array([0, 0, 10, 5])]]]);
    const { segments, count } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(1);
    expect(segments).toEqual([{ x1: 0, y1: 0, x2: 10, y2: 0 }]);
  });

  test('legacy constructPath form: [opsArray, coordsArray]', () => {
    // Older pdfjs batched constructPath as [ [OPS.moveTo, OPS.lineTo, ...], [c0,c1,...] ]
    // moveTo/lineTo consume 2 coords each.
    const opsSub = [OPS.moveTo, OPS.lineTo, OPS.lineTo];
    const coords = [0, 0, 30, 0, 30, 15];
    const ops = opList([[OPS.constructPath, [opsSub, coords]]]);
    const { segments, count, bbox } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(2);
    expect(segments).toEqual([
      { x1: 0, y1: 0, x2: 30, y2: 0 },
      { x1: 30, y1: 0, x2: 30, y2: 15 },
    ]);
    expect(bbox.maxX).toBe(30);
    expect(bbox.maxY).toBe(15);
  });

  test('legacy constructPath rectangle sub-op emits 4 segments', () => {
    const opsSub = [OPS.rectangle];
    const coords = [0, 0, 40, 20];
    const ops = opList([[OPS.constructPath, [opsSub, coords]]]);
    const { segments, count } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(4);
    expect(segments).toEqual([
      { x1: 0, y1: 0, x2: 40, y2: 0 },
      { x1: 40, y1: 0, x2: 40, y2: 20 },
      { x1: 40, y1: 20, x2: 0, y2: 20 },
      { x1: 0, y1: 20, x2: 0, y2: 0 },
    ]);
  });
});

describe('segmentsToFloorPlan', () => {
  test('reduces segments to a bbox-footprint room polygon + wall candidates', () => {
    const segments = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 75 },
      { x1: 100, y1: 75, x2: 0, y2: 75 },
      { x1: 0, y1: 75, x2: 0, y2: 0 },
    ];
    const fp = segmentsToFloorPlan(segments, { hazard: 'ordinary' });
    expect(fp.rooms).toHaveLength(1);
    expect(fp.rooms[0].polygon).toEqual([
      [0, 0],
      [100, 0],
      [100, 75],
      [0, 75],
    ]);
    expect(fp.rooms[0].hazard).toBe('ordinary');
    expect(fp.bbox.widthFt).toBe(100);
    expect(fp.bbox.heightFt).toBe(75);
    // Raw segments exposed as wall candidates.
    expect(fp.wallCandidates).toEqual(segments);
    // Honestly labelled as an approximation.
    expect(String(fp.note)).toMatch(/bbox|approxim/i);
  });

  test('passes a non-default hazard through to the room', () => {
    const segments = [
      { x1: 0, y1: 0, x2: 50, y2: 0 },
      { x1: 50, y1: 0, x2: 50, y2: 50 },
      { x1: 50, y1: 50, x2: 0, y2: 0 },
    ];
    const fp = segmentsToFloorPlan(segments, { hazard: 'extra' });
    expect(fp.rooms[0].hazard).toBe('extra');
  });

  test('throws when there are no segments to bound', () => {
    expect(() => segmentsToFloorPlan([], {})).toThrow();
  });
});

describe('isolateContentRegion — heuristic content-region tightener (T29)', () => {
  // HONESTY: this is a HEURISTIC content-region tightener, NOT a precise building
  // outline and NOT a room segmentation. It strips the sheet frame and isolates the
  // densest geometry cluster; the result is a tighter bbox than the whole sheet but
  // is still an APPROXIMATION. No scale guessing here — coords are already in feet
  // (operator-supplied scale applied upstream). Nothing tuned to a real total.

  // Build a synthetic SHEET segment set:
  //  - an outer drawing-border rectangle 0,0 .. 1000,800 (the sheet frame)
  //  - a dense BUILDING cluster of many small segments in 150,150 .. 650,550
  //  - a small detached TITLE-BLOCK cluster in 820,40 .. 980,200
  function buildSyntheticSheet(scale = 1) {
    const s = (v) => v * scale;
    const segs = [];
    // Sheet frame: the 4 perimeter edges, each spanning a full edge.
    segs.push({ x1: s(0), y1: s(0), x2: s(1000), y2: s(0) }); // bottom
    segs.push({ x1: s(1000), y1: s(0), x2: s(1000), y2: s(800) }); // right
    segs.push({ x1: s(1000), y1: s(800), x2: s(0), y2: s(800) }); // top
    segs.push({ x1: s(0), y1: s(800), x2: s(0), y2: s(0) }); // left
    // Building cluster: a DENSE grid of many small wall segments inside
    // 150..650 x 150..550. Spacing (20) is fine enough that the cluster occupies
    // contiguous coarse-grid cells — mirroring how a real plan body is densely
    // packed (the 1881 plan extracts ~64k segments).
    for (let gx = 0; gx <= 25; gx++) {
      for (let gy = 0; gy <= 20; gy++) {
        const x = 150 + gx * 20;
        const y = 150 + gy * 20;
        segs.push({ x1: s(x), y1: s(y), x2: s(x + 15), y2: s(y) });
        segs.push({ x1: s(x), y1: s(y), x2: s(x), y2: s(y + 15) });
      }
    }
    // Detached title-block cluster: a few small segments way over at the right edge.
    for (let i = 0; i < 6; i++) {
      const x = 820 + i * 20;
      segs.push({ x1: s(x), y1: s(40), x2: s(x + 15), y2: s(40) });
      segs.push({ x1: s(x), y1: s(60), x2: s(x + 15), y2: s(60) });
    }
    return segs;
  }

  test('drops the sheet frame (droppedBorderCount >= 4) and tightens below the full sheet', () => {
    const segs = buildSyntheticSheet(1);
    const res = isolateContentRegion(segs);
    // (i) The 4 frame edges were identified and removed.
    expect(res.droppedBorderCount).toBeGreaterThanOrEqual(4);
    expect(res.keptCount).toBeGreaterThan(0);
    // (ii) Returned bbox is strictly SMALLER than the full sheet bbox.
    expect(res.bbox.minX).toBeGreaterThanOrEqual(0);
    expect(res.bbox.maxX).toBeLessThan(1000);
    expect(res.bbox.maxY).toBeLessThan(800);
    expect(res.bbox.widthFt).toBeLessThan(1000);
    expect(res.bbox.heightFt).toBeLessThan(800);
  });

  test('isolates the building cluster and EXCLUDES the detached title block', () => {
    const segs = buildSyntheticSheet(1);
    const res = isolateContentRegion(segs);
    // The building cluster lives in x:150..650; the title block sits at x>=820.
    // The dominant cluster must exclude the title block (maxX well below 820).
    expect(res.bbox.maxX).toBeLessThan(820);
    // And it should hug the building region.
    expect(res.bbox.minX).toBeGreaterThanOrEqual(140);
    expect(res.bbox.maxX).toBeGreaterThan(600);
    expect(res.bbox.minY).toBeGreaterThanOrEqual(140);
    expect(res.bbox.maxY).toBeGreaterThan(500);
    expect(res.bbox.maxY).toBeLessThan(620);
  });

  test('widthFt/heightFt scale with the input coordinates', () => {
    const r1 = isolateContentRegion(buildSyntheticSheet(1));
    const r2 = isolateContentRegion(buildSyntheticSheet(2));
    expect(r2.bbox.widthFt).toBeCloseTo(r1.bbox.widthFt * 2, 4);
    expect(r2.bbox.heightFt).toBeCloseTo(r1.bbox.heightFt * 2, 4);
  });

  test('returned bbox is always clamped within the full bbox', () => {
    const segs = buildSyntheticSheet(1);
    const full = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
    const res = isolateContentRegion(segs);
    expect(res.bbox.minX).toBeGreaterThanOrEqual(full.minX);
    expect(res.bbox.minY).toBeGreaterThanOrEqual(full.minY);
    expect(res.bbox.maxX).toBeLessThanOrEqual(full.maxX);
    expect(res.bbox.maxY).toBeLessThanOrEqual(full.maxY);
  });

  test('degenerate inputs fall back without throwing', () => {
    // Empty -> a zeroed-but-defined region, never throws.
    expect(() => isolateContentRegion([])).not.toThrow();
    const empty = isolateContentRegion([]);
    expect(empty.bbox).toBeDefined();
    expect(Number.isFinite(empty.bbox.widthFt)).toBe(true);

    // Single segment -> falls back to its own bbox, never throws.
    const single = isolateContentRegion([{ x1: 5, y1: 5, x2: 25, y2: 5 }]);
    expect(single.bbox.minX).toBe(5);
    expect(single.bbox.maxX).toBe(25);

    // All-border (just a frame, nothing inside) -> falls back, no throw, finite.
    const frameOnly = [
      { x1: 0, y1: 0, x2: 1000, y2: 0 },
      { x1: 1000, y1: 0, x2: 1000, y2: 800 },
      { x1: 1000, y1: 800, x2: 0, y2: 800 },
      { x1: 0, y1: 800, x2: 0, y2: 0 },
    ];
    expect(() => isolateContentRegion(frameOnly)).not.toThrow();
    const fr = isolateContentRegion(frameOnly);
    expect(Number.isFinite(fr.bbox.widthFt)).toBe(true);
    expect(fr.bbox.widthFt).toBeGreaterThanOrEqual(0);
  });

  test('overridable opts do not throw and stay within full bbox', () => {
    const segs = buildSyntheticSheet(1);
    const res = isolateContentRegion(segs, { borderMarginFrac: 0.05, borderSpanFrac: 0.5, gridN: 12 });
    expect(res.bbox.maxX).toBeLessThanOrEqual(1000);
    expect(res.bbox.maxY).toBeLessThanOrEqual(800);
    expect(res.keptCount).toBeGreaterThan(0);
  });

  test('carries a heuristic/approximation note (NOT a building outline claim)', () => {
    const res = isolateContentRegion(buildSyntheticSheet(1));
    const note = String(res.note);
    // Positively labelled as heuristic/approximate.
    expect(note).toMatch(/heurist|approxim/i);
    // Explicitly DENIES being a building outline / room segmentation / AHJ/PE.
    expect(note).toMatch(/NOT a (precise )?building outline/i);
    expect(note).toMatch(/NOT a room segmentation/i);
    expect(note).toMatch(/NOT an AHJ\/PE/i);
    // Makes no POSITIVE accuracy/parity claim.
    expect(note).not.toMatch(/\bis accurate\b|\bparity\b|\bexact\b/i);
  });

  describe('segmentsToFloorPlan({ isolate: true })', () => {
    function syntheticSheet() {
      const segs = [];
      segs.push({ x1: 0, y1: 0, x2: 1000, y2: 0 });
      segs.push({ x1: 1000, y1: 0, x2: 1000, y2: 800 });
      segs.push({ x1: 1000, y1: 800, x2: 0, y2: 800 });
      segs.push({ x1: 0, y1: 800, x2: 0, y2: 0 });
      for (let gx = 0; gx <= 25; gx++) {
        for (let gy = 0; gy <= 20; gy++) {
          const x = 150 + gx * 20;
          const y = 150 + gy * 20;
          segs.push({ x1: x, y1: y, x2: x + 15, y2: y });
          segs.push({ x1: x, y1: y, x2: x, y2: y + 15 });
        }
      }
      for (let i = 0; i < 6; i++) {
        const x = 820 + i * 20;
        segs.push({ x1: x, y1: 40, x2: x + 15, y2: 40 });
      }
      return segs;
    }

    test('uses the ISOLATED bbox for the room polygon + carries the heuristic note', () => {
      const segs = syntheticSheet();
      const def = segmentsToFloorPlan(segs); // isolate defaults false
      const iso = segmentsToFloorPlan(segs, { isolate: true });
      // Default polygon = full sheet bbox.
      expect(def.bbox.minX).toBe(0);
      expect(def.bbox.maxX).toBe(1000);
      // Isolated polygon is strictly tighter than the full sheet.
      expect(iso.bbox.widthFt).toBeLessThan(def.bbox.widthFt);
      expect(iso.bbox.heightFt).toBeLessThan(def.bbox.heightFt);
      // Room polygon matches the isolated bbox corners.
      const b = iso.bbox;
      expect(iso.rooms[0].polygon).toEqual([
        [b.minX, b.minY],
        [b.maxX, b.minY],
        [b.maxX, b.maxY],
        [b.minX, b.maxY],
      ]);
      // Isolation metadata + a heuristic note attached.
      expect(iso.keptCount).toBeGreaterThan(0);
      expect(iso.droppedBorderCount).toBeGreaterThanOrEqual(4);
      expect(String(iso.note)).toMatch(/heurist|content-region|approxim/i);
    });

    test('default (isolate: false) is UNCHANGED — full bbox + original note', () => {
      const segs = syntheticSheet();
      const def = segmentsToFloorPlan(segs);
      expect(def.rooms[0].polygon).toEqual([
        [0, 0],
        [1000, 0],
        [1000, 800],
        [0, 800],
      ]);
      expect(def.bbox.widthFt).toBe(1000);
      expect(def.bbox.heightFt).toBe(800);
      expect(def.keptCount).toBeUndefined();
      expect(def.droppedBorderCount).toBeUndefined();
      expect(String(def.note)).toMatch(/bbox/i);
    });
  });
});

describe('floorPlanFromPdf — async path with an injected FAKE pdfjs', () => {
  // A stub pdfjs whose page.getOperatorList resolves a known op list — lets us
  // test the async wiring WITHOUT a real PDF, worker, or canvas.
  function fakePdfjs(opListFor) {
    return {
      getDocument(params) {
        return {
          promise: Promise.resolve({
            numPages: 3,
            getPage(pageNumber) {
              return Promise.resolve({
                pageNumber,
                getOperatorList: () => Promise.resolve(opListFor(pageNumber)),
              });
            },
          }),
        };
      },
    };
  }

  test('extracts a floor plan from page 0 (1-based page 1) via the injected pdfjs', async () => {
    const buffer = new Float32Array([
      0, 0, 0,
      1, 800, 0,
      1, 800, 600,
      1, 0, 600,
      4,
    ]);
    const pdfjs = fakePdfjs(() => opList([[OPS.constructPath, [OPS.fill, [buffer], new Float32Array([0, 0, 800, 600])]]]));
    const result = await floorPlanFromPdf(new Uint8Array([1, 2, 3]), {
      pageIndex: 0,
      scale: 0.125,
      hazard: 'ordinary',
      pdfjs,
    });
    expect(result.segmentCount).toBe(4);
    expect(result.pageIndex).toBe(0);
    expect(result.scale).toBe(0.125);
    expect(result.bbox.widthFt).toBeCloseTo(100, 6);
    expect(result.bbox.heightFt).toBeCloseTo(75, 6);
    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].polygon).toEqual([
      [0, 0],
      [100, 0],
      [100, 75],
      [0, 75],
    ]);
    expect(result.rooms[0].hazard).toBe('ordinary');
    expect(String(result.note)).toMatch(/bbox|approxim/i);
  });

  test('requests the page at pageIndex + 1 (1-based)', async () => {
    let requestedPage = null;
    const buffer = new Float32Array([0, 0, 0, 1, 10, 0, 1, 10, 10, 4]);
    const pdfjs = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 5,
          getPage(pageNumber) {
            requestedPage = pageNumber;
            return Promise.resolve({
              getOperatorList: () => Promise.resolve(opList([[OPS.constructPath, [OPS.fill, [buffer], new Float32Array([0, 0, 10, 10])]]])),
            });
          },
        }),
      }),
    };
    await floorPlanFromPdf(new Uint8Array([1]), { pageIndex: 2, scale: 1, pdfjs });
    expect(requestedPage).toBe(3);
  });

  test('THROWS when scale is missing', async () => {
    const pdfjs = fakePdfjs(() => opList([[OPS.moveTo, [0, 0]], [OPS.lineTo, [1, 0]]]));
    await expect(floorPlanFromPdf(new Uint8Array([1]), { pageIndex: 0, pdfjs }))
      .rejects.toThrow(/scale/i);
  });

  test('THROWS when scale is <= 0', async () => {
    const pdfjs = fakePdfjs(() => opList([[OPS.moveTo, [0, 0]], [OPS.lineTo, [1, 0]]]));
    await expect(floorPlanFromPdf(new Uint8Array([1]), { pageIndex: 0, scale: 0, pdfjs }))
      .rejects.toThrow(/scale/i);
    await expect(floorPlanFromPdf(new Uint8Array([1]), { pageIndex: 0, scale: -0.1, pdfjs }))
      .rejects.toThrow(/scale/i);
  });

  test('THROWS a descriptive error when the pdf parse fails', async () => {
    const pdfjs = {
      getDocument: () => ({ promise: Promise.reject(new Error('corrupt xref')) }),
    };
    await expect(floorPlanFromPdf(new Uint8Array([1]), { pageIndex: 0, scale: 1, pdfjs }))
      .rejects.toThrow(/pdf/i);
  });
});

describe('isolatePlanExtent — full-extent content-region isolator (T32)', () => {
  // HONESTY: this is a HEURISTIC full-extent isolator, NOT a precise building outline
  // and NOT a room segmentation. It strips the sheet frame, then takes the UNION bbox
  // of all non-trivial clusters, dropping only tiny detached annotation islands. The
  // result captures the WHOLE building extent (multi-wing / courtyard) but is still an
  // APPROXIMATION. No scale guessing — coords are already in feet. Nothing tuned to a
  // dollar total: the outlier threshold is a principled segment-share, not a percentile
  // fit to a number.

  // Build a synthetic MULTI-WING sheet:
  //  - an outer drawing-border rectangle 0,0 .. 1000,700 (the sheet frame)
  //  - a LEFT wing: dense small segments in 100,100 .. 300,500
  //  - a RIGHT wing: dense small segments in 350,100 .. 600,500 (separated by a gap
  //    from the left wing — they form TWO flood-fill clusters, like a building drawn
  //    as two dense regions or split by an interior courtyard)
  //  - a small DETACHED title-block cluster in 820,40 .. 980,160 (a handful of segs)
  // The left+right wings together make the building; the title block is the outlier.
  function buildMultiWingSheet(scale = 1) {
    const s = (v) => v * scale;
    const segs = [];
    // Sheet frame (4 perimeter edges spanning full edges).
    segs.push({ x1: s(0), y1: s(0), x2: s(1000), y2: s(0) }); // bottom
    segs.push({ x1: s(1000), y1: s(0), x2: s(1000), y2: s(700) }); // right
    segs.push({ x1: s(1000), y1: s(700), x2: s(0), y2: s(700) }); // top
    segs.push({ x1: s(0), y1: s(700), x2: s(0), y2: s(0) }); // left
    // LEFT wing — dense grid 100..300 x 100..500.
    for (let gx = 0; gx <= 10; gx++) {
      for (let gy = 0; gy <= 20; gy++) {
        const x = 100 + gx * 20;
        const y = 100 + gy * 20;
        segs.push({ x1: s(x), y1: s(y), x2: s(x + 12), y2: s(y) });
        segs.push({ x1: s(x), y1: s(y), x2: s(x), y2: s(y + 12) });
      }
    }
    // RIGHT wing — dense grid 460..680 x 100..500. The 312->460 gap (well over one
    // coarse cell at gridN=24 over the post-border bbox => leaves an empty cell column
    // between wings) detaches it into its own flood-fill cluster, mirroring a connected
    // building drawn as two dense regions (or split by an interior courtyard).
    for (let gx = 0; gx <= 11; gx++) {
      for (let gy = 0; gy <= 20; gy++) {
        const x = 460 + gx * 20;
        const y = 100 + gy * 20;
        segs.push({ x1: s(x), y1: s(y), x2: s(x + 12), y2: s(y) });
        segs.push({ x1: s(x), y1: s(y), x2: s(x), y2: s(y + 12) });
      }
    }
    // DETACHED title block — a tiny handful of segments far to the right.
    for (let i = 0; i < 5; i++) {
      const x = 820 + i * 20;
      segs.push({ x1: s(x), y1: s(40), x2: s(x + 12), y2: s(40) });
      segs.push({ x1: s(x), y1: s(120), x2: s(x + 12), y2: s(120) });
    }
    return segs;
  }

  test('dominant-cluster mode returns only ONE wing (the old under-capture)', () => {
    const segs = buildMultiWingSheet(1);
    const dom = isolateContentRegion(segs);
    // The dominant cluster is a single wing. Whichever wing wins, its width is far
    // short of spanning BOTH wings (100..692 ≈ 592 wide). One wing is ~210-240 wide.
    expect(dom.bbox.widthFt).toBeLessThan(350);
    // And it cannot reach across the gap to cover the full 100..692 span.
    const spansBothWings = dom.bbox.minX <= 130 && dom.bbox.maxX >= 660;
    expect(spansBothWings).toBe(false);
    // Title block excluded either way.
    expect(dom.bbox.maxX).toBeLessThan(820);
  });

  test('full-extent mode spans BOTH wings and EXCLUDES the title block', () => {
    const segs = buildMultiWingSheet(1);
    const ext = isolatePlanExtent(segs);
    // Frame stripped.
    expect(ext.droppedBorderCount).toBeGreaterThanOrEqual(4);
    // Spans the union of both wings: left wing starts ~100, right wing ends ~692.
    expect(ext.bbox.minX).toBeLessThanOrEqual(130);
    expect(ext.bbox.maxX).toBeGreaterThan(660);
    // Title block (x >= 820) is dropped as a tiny detached outlier island.
    expect(ext.bbox.maxX).toBeLessThan(820);
    // Vertically hugs the wings (100..512), not the full 0..700 sheet.
    expect(ext.bbox.minY).toBeGreaterThanOrEqual(90);
    expect(ext.bbox.maxY).toBeLessThan(620);
    // It found multiple groups and retained at least the two wings; the tiny title
    // block was dropped as an outlier.
    expect(ext.groupCount).toBeGreaterThanOrEqual(3);
    expect(ext.retainedGroupCount).toBeGreaterThanOrEqual(2);
    expect(ext.droppedOutlierCount).toBeGreaterThan(0);
  });

  test('full-extent bbox is strictly WIDER than the dominant-cluster bbox here', () => {
    const segs = buildMultiWingSheet(1);
    const dom = isolateContentRegion(segs);
    const ext = isolatePlanExtent(segs);
    expect(ext.bbox.widthFt).toBeGreaterThan(dom.bbox.widthFt);
  });

  test('widthFt/heightFt scale with the input coordinates', () => {
    const r1 = isolatePlanExtent(buildMultiWingSheet(1));
    const r2 = isolatePlanExtent(buildMultiWingSheet(2));
    expect(r2.bbox.widthFt).toBeCloseTo(r1.bbox.widthFt * 2, 4);
    expect(r2.bbox.heightFt).toBeCloseTo(r1.bbox.heightFt * 2, 4);
  });

  test('returned bbox is always clamped within the full bbox', () => {
    const ext = isolatePlanExtent(buildMultiWingSheet(1));
    expect(ext.bbox.minX).toBeGreaterThanOrEqual(0);
    expect(ext.bbox.minY).toBeGreaterThanOrEqual(0);
    expect(ext.bbox.maxX).toBeLessThanOrEqual(1000);
    expect(ext.bbox.maxY).toBeLessThanOrEqual(700);
  });

  test('degenerate inputs fall back without throwing', () => {
    expect(() => isolatePlanExtent([])).not.toThrow();
    const empty = isolatePlanExtent([]);
    expect(empty.bbox).toBeDefined();
    expect(Number.isFinite(empty.bbox.widthFt)).toBe(true);

    const single = isolatePlanExtent([{ x1: 5, y1: 5, x2: 25, y2: 5 }]);
    expect(single.bbox.minX).toBe(5);
    expect(single.bbox.maxX).toBe(25);

    const frameOnly = [
      { x1: 0, y1: 0, x2: 1000, y2: 0 },
      { x1: 1000, y1: 0, x2: 1000, y2: 800 },
      { x1: 1000, y1: 800, x2: 0, y2: 800 },
      { x1: 0, y1: 800, x2: 0, y2: 0 },
    ];
    expect(() => isolatePlanExtent(frameOnly)).not.toThrow();
    const fr = isolatePlanExtent(frameOnly);
    expect(Number.isFinite(fr.bbox.widthFt)).toBe(true);
    expect(fr.bbox.widthFt).toBeGreaterThanOrEqual(0);
  });

  test('carries a heuristic/approximation note (NOT a building outline claim)', () => {
    const note = String(isolatePlanExtent(buildMultiWingSheet(1)).note);
    expect(note).toMatch(/heurist|approxim/i);
    expect(note).toMatch(/NOT a (precise )?building outline/i);
    expect(note).toMatch(/NOT a room segmentation/i);
    expect(note).toMatch(/NOT an AHJ\/PE/i);
    expect(note).not.toMatch(/\bis accurate\b|\bparity\b|\bexact\b/i);
  });

  describe('segmentsToFloorPlan({ isolate: "fullExtent" })', () => {
    test('uses the full-extent bbox and carries outlier metadata + heuristic note', () => {
      const segs = buildMultiWingSheet(1);
      const dom = segmentsToFloorPlan(segs, { isolate: true });
      const ext = segmentsToFloorPlan(segs, { isolate: 'fullExtent' });
      // Full-extent polygon is wider than the dominant-cluster polygon.
      expect(ext.bbox.widthFt).toBeGreaterThan(dom.bbox.widthFt);
      const b = ext.bbox;
      expect(ext.rooms[0].polygon).toEqual([
        [b.minX, b.minY],
        [b.maxX, b.minY],
        [b.maxX, b.maxY],
        [b.minX, b.maxY],
      ]);
      expect(ext.keptCount).toBeGreaterThan(0);
      expect(ext.droppedBorderCount).toBeGreaterThanOrEqual(4);
      expect(ext.droppedOutlierCount).toBeGreaterThan(0);
      expect(String(ext.note)).toMatch(/full-extent|heurist|approxim/i);
    });

    test('default (isolate: false) stays UNCHANGED — full sheet bbox', () => {
      const segs = buildMultiWingSheet(1);
      const def = segmentsToFloorPlan(segs);
      expect(def.bbox.widthFt).toBe(1000);
      expect(def.bbox.heightFt).toBe(700);
      expect(def.droppedOutlierCount).toBeUndefined();
    });
  });
});

describe('buildingOutlinePolygon — enclosed wall-network footprint (T33)', () => {
  // HONESTY: this returns the building FOOTPRINT (enclosed area of the dominant wall
  // network), NOT the over-capturing bbox of the whole annotated sheet, and NOT a
  // precise/AHJ outline. The wall filter (minWallFt + axis tolerance) and network /
  // grid thresholds are GEOMETRIC defaults — they are NOT fitted to any target area or
  // dollar. Coords are already in feet (operator-supplied scale applied upstream).
  //
  // SYNTHETIC ANNOTATED SHEET (all coords in feet):
  //  - BUILDING: an L-shaped outline made of LONG axis-aligned wall segments. The L
  //    outline is (0,0)->(200,0)->(200,40)->(100,40)->(100,80)->(0,80)->close. Its TRUE
  //    enclosed area (shoelace, computed by hand below) is 12,000 sqft; the BBOX OF THE L
  //    is 200x80 = 16,000 sqft, so the enclosed area is genuinely less than the L's own
  //    bbox — and far less than the all-segments bbox.
  //  - ANNOTATIONS around/outside it: short dimension WITNESS-LINES (len 1.5 ft) and tiny
  //    TEXT-STROKE segments (len 0.5 ft), all below minWallFt -> must be dropped.
  //  - A DETACHED small DETAIL-DRAWING cluster (a 40x30 ft rectangle of wall-like edges)
  //    far away at x:400..440, y:400..430 -> a SEPARATE connected component with less
  //    total wall length -> must be dropped by the dominant-network step.
  //
  // HAND-COMPUTED TRUE BUILDING AREA (shoelace of the L):
  //   verts (0,0),(200,0),(200,40),(100,40),(100,80),(0,80)
  //   2A = (0*0-200*0)+(200*40-200*0)+(200*40-100*40)+(100*80-100*40)+(100*80-0*80)+(0*0-0*80)
  //      = 0 + 8000 + 4000 + 4000 + 8000 + 0 = 24000  ->  A = 12,000 sqft.
  const TRUE_BUILDING_AREA = 12000;

  function lShapeWalls() {
    // L-shape perimeter as 6 connected long axis-aligned wall segments.
    return [
      { x1: 0, y1: 0, x2: 200, y2: 0 }, // 200
      { x1: 200, y1: 0, x2: 200, y2: 40 }, // 40
      { x1: 200, y1: 40, x2: 100, y2: 40 }, // 100
      { x1: 100, y1: 40, x2: 100, y2: 80 }, // 40
      { x1: 100, y1: 80, x2: 0, y2: 80 }, // 100
      { x1: 0, y1: 80, x2: 0, y2: 0 }, // 80
    ];
  }

  function annotationSegments() {
    const segs = [];
    // Short dimension witness-lines (len 1.5 ft) strung below the building.
    for (let i = 0; i < 12; i++) {
      const x = 10 + i * 15;
      segs.push({ x1: x, y1: -10, x2: x, y2: -8.5 }); // vertical witness tick, len 1.5
    }
    // Tiny text-stroke segments (len 0.5 ft) scattered around.
    for (let i = 0; i < 20; i++) {
      const x = 5 + i * 9;
      segs.push({ x1: x, y1: 90, x2: x + 0.5, y2: 90 }); // len 0.5
      segs.push({ x1: x, y1: 92, x2: x + 0.3, y2: 92.4 }); // tiny skew stroke
    }
    return segs;
  }

  function detachedDetailCluster() {
    // A small 40x30 detail rectangle far from the building (its own component).
    return [
      { x1: 400, y1: 400, x2: 440, y2: 400 }, // 40
      { x1: 440, y1: 400, x2: 440, y2: 430 }, // 30
      { x1: 440, y1: 430, x2: 400, y2: 430 }, // 40
      { x1: 400, y1: 430, x2: 400, y2: 400 }, // 30
    ];
  }

  function syntheticAnnotatedSheet() {
    return [...lShapeWalls(), ...annotationSegments(), ...detachedDetailCluster()];
  }

  test('(i) drops short witness/text segments — keeps only wall-like segments', () => {
    const segs = syntheticAnnotatedSheet();
    const res = buildingOutlinePolygon(segs);
    // 6 L walls + 4 detail-rect walls = 10 wall-like segments survive the filter; the
    // 12 witness ticks (1.5 ft) + 40 text strokes (<=0.5 ft) are all dropped.
    expect(res.wallSegmentCount).toBe(10);
    // The dominant network is the L (6 connected long walls), not the 4-edge detail rect.
    expect(res.networkSegmentCount).toBe(6);
    expect(res.method).toBe('wall-network-occupancy-grid');
  });

  test('(ii) returns the TRUE building enclosed area (~12,000 sqft), NOT the bbox-of-everything', () => {
    const segs = syntheticAnnotatedSheet();
    const res = buildingOutlinePolygon(segs);

    // The all-segments bbox swallows the detail cluster + witness lines:
    //   x:0..440, y:-10..430  => 440 x 440 = 193,600 sqft.
    const allSegBboxArea = 440 * 440;

    // Enclosed footprint area is within ±20% of the hand-computed L area (12,000) — the
    // small excess is occupancy-grid wall-cell thickness, a discretization effect, NOT a
    // tuned fit. (Recomputed by hand above: 12,000 sqft.)
    expect(res.areaSqft).toBeGreaterThan(TRUE_BUILDING_AREA * 0.85);
    expect(res.areaSqft).toBeLessThan(TRUE_BUILDING_AREA * 1.2);

    // PROOF it is much smaller than the all-segments bbox (the over-capture this fixes):
    expect(res.areaSqft).toBeLessThan(allSegBboxArea * 0.15);

    // And it is below the L's OWN bbox (16,000) — i.e. the concave notch is captured,
    // not filled in as a rectangle.
    expect(res.areaSqft).toBeLessThan(200 * 80);

    // The returned polygon is a usable rectilinear outline whose shoelace area is in the
    // same ballpark as the reported occupancy area.
    const polyArea = polygonArea(res.polygon);
    expect(polyArea).toBeGreaterThan(TRUE_BUILDING_AREA * 0.7);
    expect(polyArea).toBeLessThan(TRUE_BUILDING_AREA * 1.3);
  });

  test('(iii) EXCLUDES the detached detail cluster (network bbox hugs the building only)', () => {
    const segs = syntheticAnnotatedSheet();
    const res = buildingOutlinePolygon(segs);
    // Network bbox is the L (0..200 x 0..80); the detail rect lives at x>=400, y>=400.
    expect(res.bbox.maxX).toBeLessThan(400);
    expect(res.bbox.maxY).toBeLessThan(400);
    expect(res.bbox.minX).toBeGreaterThanOrEqual(0);
    expect(res.bbox.minY).toBeGreaterThanOrEqual(0);
    expect(res.bbox.maxX).toBeCloseTo(200, 0);
    expect(res.bbox.maxY).toBeCloseTo(80, 0);
    // No polygon vertex reaches the detail cluster.
    for (const [x, y] of res.polygon) {
      expect(x).toBeLessThan(400);
      expect(y).toBeLessThan(400);
    }
  });

  test('carries a heuristic/approximation note (NOT a building-outline/parity claim)', () => {
    const note = String(buildingOutlinePolygon(syntheticAnnotatedSheet()).note);
    expect(note).toMatch(/heurist|approxim/i);
    expect(note).toMatch(/NOT a (precise )?building outline/i);
    expect(note).toMatch(/NOT a room segmentation/i);
    expect(note).toMatch(/NOT an AHJ\/PE/i);
    expect(note).not.toMatch(/\bis accurate\b|\bparity\b|\bexact\b/i);
  });

  test('a simple rectangle building recovers ~its enclosed area', () => {
    // A 100x60 rectangle (closed loop of 4 long walls) -> ~6,000 sqft enclosed.
    const rect = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 60 },
      { x1: 100, y1: 60, x2: 0, y2: 60 },
      { x1: 0, y1: 60, x2: 0, y2: 0 },
    ];
    const res = buildingOutlinePolygon(rect);
    expect(res.areaSqft).toBeGreaterThan(6000 * 0.9);
    expect(res.areaSqft).toBeLessThan(6000 * 1.15);
    expect(res.bbox.widthFt).toBeCloseTo(100, 4);
    expect(res.bbox.heightFt).toBeCloseTo(60, 4);
  });

  test('areaSqft scales with coordinate scale (geometry, not a fitted constant)', () => {
    const rect1 = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 60 },
      { x1: 100, y1: 60, x2: 0, y2: 60 },
      { x1: 0, y1: 60, x2: 0, y2: 0 },
    ];
    const rect2 = rect1.map((s) => ({ x1: s.x1 * 2, y1: s.y1 * 2, x2: s.x2 * 2, y2: s.y2 * 2 }));
    const a1 = buildingOutlinePolygon(rect1).areaSqft;
    const a2 = buildingOutlinePolygon(rect2).areaSqft;
    // Doubling all coords quadruples the area (+/- discretization).
    expect(a2 / a1).toBeGreaterThan(3.6);
    expect(a2 / a1).toBeLessThan(4.4);
  });

  test('degenerate inputs (no long segments / empty) fall back WITHOUT throwing', () => {
    // Empty.
    expect(() => buildingOutlinePolygon([])).not.toThrow();
    const empty = buildingOutlinePolygon([]);
    expect(empty.polygon.length).toBeGreaterThanOrEqual(4);
    expect(Number.isFinite(empty.areaSqft)).toBe(true);
    expect(empty.method).toBe('degenerate-bbox');

    // Only short segments (all < minWallFt) -> no walls -> bbox fallback, no throw.
    const shortOnly = [
      { x1: 0, y1: 0, x2: 1, y2: 0 },
      { x1: 0, y1: 0, x2: 0, y2: 1 },
      { x1: 5, y1: 5, x2: 6, y2: 5 },
    ];
    expect(() => buildingOutlinePolygon(shortOnly)).not.toThrow();
    const so = buildingOutlinePolygon(shortOnly);
    expect(so.method).toBe('fallback-no-walls-bbox');
    expect(so.wallSegmentCount).toBe(0);
    expect(Number.isFinite(so.areaSqft)).toBe(true);

    // Single long segment (no enclosed network) -> network bbox fallback, no throw.
    const single = [{ x1: 0, y1: 0, x2: 50, y2: 0 }];
    expect(() => buildingOutlinePolygon(single)).not.toThrow();
    const sg = buildingOutlinePolygon(single);
    expect(Number.isFinite(sg.areaSqft)).toBe(true);
  });

  describe('segmentsToFloorPlan / floorPlanFromPdf with extract:"outline"', () => {
    test('segmentsToFloorPlan({ extract: "outline" }) uses the OUTLINE polygon (not a bbox)', () => {
      const segs = syntheticAnnotatedSheet();
      const fp = segmentsToFloorPlan(segs, { extract: 'outline', hazard: 'ordinary' });
      expect(fp.rooms).toHaveLength(1);
      expect(fp.rooms[0].name).toMatch(/outline/i);
      expect(fp.rooms[0].hazard).toBe('ordinary');
      // The room polygon is the rectilinear outline, NOT a 4-corner bbox of everything.
      expect(fp.rooms[0].polygon.length).toBeGreaterThanOrEqual(4);
      expect(fp.areaSqft).toBeGreaterThan(TRUE_BUILDING_AREA * 0.85);
      expect(fp.areaSqft).toBeLessThan(TRUE_BUILDING_AREA * 1.2);
      expect(fp.method).toBe('wall-network-occupancy-grid');
      expect(String(fp.note)).toMatch(/building-OUTLINE|NOT a (precise )?building outline/i);
    });

    test('default (no extract) stays UNCHANGED — full bbox footprint', () => {
      const segs = syntheticAnnotatedSheet();
      const def = segmentsToFloorPlan(segs);
      // Whole-sheet bbox of everything.
      expect(def.bbox.minX).toBe(0);
      expect(def.areaSqft).toBeUndefined();
      expect(def.method).toBeUndefined();
      expect(String(def.note)).toMatch(/bbox/i);
    });

    test('floorPlanFromPdf({ extract: "outline" }) via injected fake pdfjs', async () => {
      // A fake pdfjs whose op list is the L-shape (identity CTM -> coords unchanged).
      const ls = lShapeWalls();
      const fnArray = [];
      const argsArray = [];
      for (const s of ls) {
        fnArray.push(OPS.moveTo); argsArray.push([s.x1, s.y1]);
        fnArray.push(OPS.lineTo); argsArray.push([s.x2, s.y2]);
      }
      const ol = { fnArray, argsArray };
      const pdfjs = {
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 1,
            getPage: () => Promise.resolve({ getOperatorList: () => Promise.resolve(ol) }),
          }),
        }),
      };
      const result = await floorPlanFromPdf(new Uint8Array([1]), {
        pageIndex: 0,
        scale: 1, // coords already in feet
        hazard: 'ordinary',
        pdfjs,
        extract: 'outline',
      });
      expect(result.areaSqft).toBeGreaterThan(TRUE_BUILDING_AREA * 0.8);
      expect(result.areaSqft).toBeLessThan(TRUE_BUILDING_AREA * 1.25);
      expect(result.method).toBe('wall-network-occupancy-grid');
      expect(result.rooms[0].polygon.length).toBeGreaterThanOrEqual(4);
      expect(String(result.note)).toMatch(/building-OUTLINE|NOT a (precise )?building outline/i);
    });
  });
});

describe('T34 — PDF graphics-state layer extraction (lineWidth + strokeColor tags)', () => {
  // The crux of T34: a real architectural sheet differs walls from annotation by
  // GRAPHICS STATE — cut walls are drawn at a HEAVIER lineweight than the dimension /
  // grid / text annotation linework (a genuine drafting convention). The extractor
  // must TRACK the current lineWidth + stroke color through the save/restore/transform
  // stack and TAG every emitted segment with { lineWidth, strokeColor }. selectWallLayer
  // then groups by (strokeColor,lineWidth) and picks the wall layer by the PRINCIPLED
  // heavier-lineweight-structural convention — NEVER by matching a target area/dollar.
  //
  // HONESTY: the new fields are ADDITIVE (x1,y1,x2,y2 unchanged); the selection rule is
  // a documented CAD convention with labelled geometric defaults; nothing is tuned to
  // 21,332 sqft or 538,792 dollars.

  // pdfjs v6 emits OPS.setStrokeRGBColor with a single HEX STRING arg (the worker
  // converts every stroke-color op via getRgbHex -> makeHexColor). We build the op
  // list with that REAL arg form. The extractor must also tolerate a packed-int or
  // [r,g,b] array form (older / raw), exercised in a dedicated normalization test.
  const HEAVY = 1.0; // wall lineweight (heavy)
  const THIN = 0.09; // annotation lineweight (thin)
  const WALL_COLOR = '#000000'; // walls drawn black
  const ANNO_COLOR = '#808080'; // annotation drawn gray

  // A synthetic TWO-LAYER sheet op list (identity CTM -> coords already in feet):
  //  - HEAVY layer: a 200x120 building RECTANGLE (4 long walls), one heavy width+color.
  //  - THIN layer: full-WIDTH dimension/grid lines spanning the whole sheet (x:-40..300)
  //    plus a column of grid lines — all at the thin width + a different color. These are
  //    the ~full-sheet-spanning annotation lines that geometry-alone cannot separate.
  function twoLayerOpList() {
    const fnArray = [];
    const argsArray = [];
    const push = (fn, args) => { fnArray.push(fn); argsArray.push(args); };

    // ---- HEAVY WALL LAYER ----
    push(OPS.setLineWidth, [HEAVY]);
    push(OPS.setStrokeRGBColor, [WALL_COLOR]); // v6 hex-string arg form
    // building rectangle 0,0 .. 200,120 as 4 connected long wall segments
    push(OPS.moveTo, [0, 0]);
    push(OPS.lineTo, [200, 0]);
    push(OPS.lineTo, [200, 120]);
    push(OPS.lineTo, [0, 120]);
    push(OPS.lineTo, [0, 0]);

    // ---- THIN ANNOTATION LAYER ----
    push(OPS.setLineWidth, [THIN]);
    push(OPS.setStrokeRGBColor, [ANNO_COLOR]);
    // Full-sheet-spanning horizontal dimension/grid lines (x:-40..300) at several Ys —
    // these reach FAR outside the building extent, exactly like the 1881 grid/dim lines.
    for (let i = 0; i < 8; i++) {
      const y = -20 + i * 25;
      push(OPS.moveTo, [-40, y]);
      push(OPS.lineTo, [300, y]);
    }
    // Full-height vertical grid lines (y:-40..200) at several Xs.
    for (let i = 0; i < 8; i++) {
      const x = -30 + i * 45;
      push(OPS.moveTo, [x, -40]);
      push(OPS.lineTo, [x, 200]);
    }
    return { fnArray, argsArray };
  }

  test('(i) tags each segment with the current lineWidth + parsed strokeColor', () => {
    const ol = twoLayerOpList();
    const { segments, count } = extractSegmentsFromOpList(ol, { scale: 1 });
    // 4 wall segments + 8 horizontal + 8 vertical annotation lines = 20 segments.
    expect(count).toBe(20);
    // Backward compat: geometry fields still present and correct on the first wall edge.
    expect(segments[0]).toMatchObject({ x1: 0, y1: 0, x2: 200, y2: 0 });

    const wallSegs = segments.filter((s) => Math.abs(s.lineWidth - HEAVY) < 1e-9);
    const annoSegs = segments.filter((s) => Math.abs(s.lineWidth - THIN) < 1e-9);
    expect(wallSegs).toHaveLength(4);
    expect(annoSegs).toHaveLength(16);
    // The heavy walls carry the wall color; the thin annotation carries the anno color.
    for (const s of wallSegs) {
      expect(s.lineWidth).toBeCloseTo(HEAVY, 9);
      expect(s.strokeColor).toBe(WALL_COLOR);
    }
    for (const s of annoSegs) {
      expect(s.lineWidth).toBeCloseTo(THIN, 9);
      expect(s.strokeColor).toBe(ANNO_COLOR);
    }
  });

  test('parses stroke-color arg forms: hex string, packed int 0xRRGGBB, and [r,g,b] array', () => {
    const mk = (colorArg) => {
      const fnArray = [];
      const argsArray = [];
      fnArray.push(OPS.setStrokeRGBColor); argsArray.push(colorArg);
      fnArray.push(OPS.moveTo); argsArray.push([0, 0]);
      fnArray.push(OPS.lineTo); argsArray.push([10, 0]);
      return { fnArray, argsArray };
    };
    // (a) v6 hex string passes through verbatim (lowercased).
    expect(extractSegmentsFromOpList(mk(['#1A2B3C']), { scale: 1 }).segments[0].strokeColor)
      .toBe('#1a2b3c');
    // (b) packed integer 0xRRGGBB -> "#rrggbb" (the recon NaN bug was decoding this wrong).
    expect(extractSegmentsFromOpList(mk([0x1a2b3c]), { scale: 1 }).segments[0].strokeColor)
      .toBe('#1a2b3c');
    // (c) [r,g,b] array of 0..1 floats -> "#rrggbb".
    expect(extractSegmentsFromOpList(mk([[1, 0, 0]]), { scale: 1 }).segments[0].strokeColor)
      .toBe('#ff0000');
    // (d) [r,g,b] array of 0..255 ints -> "#rrggbb".
    expect(extractSegmentsFromOpList(mk([[0, 128, 255]]), { scale: 1 }).segments[0].strokeColor)
      .toBe('#0080ff');
    // None of these ever produce NaN in the key.
    for (const c of [['#1A2B3C'], [0x1a2b3c], [[1, 0, 0]], [[0, 128, 255]]]) {
      const sc = extractSegmentsFromOpList(mk(c), { scale: 1 }).segments[0].strokeColor;
      expect(String(sc)).not.toMatch(/nan/i);
    }
  });

  test('save/restore push & pop the graphics state (lineWidth + color) alongside the CTM', () => {
    const fnArray = [];
    const argsArray = [];
    const push = (fn, args) => { fnArray.push(fn); argsArray.push(args); };
    push(OPS.setLineWidth, [HEAVY]);
    push(OPS.setStrokeRGBColor, [WALL_COLOR]);
    push(OPS.moveTo, [0, 0]);
    push(OPS.lineTo, [50, 0]); // heavy/black
    push(OPS.save, []);
    push(OPS.setLineWidth, [THIN]);
    push(OPS.setStrokeRGBColor, [ANNO_COLOR]);
    push(OPS.moveTo, [0, 10]);
    push(OPS.lineTo, [50, 10]); // thin/gray inside the save
    push(OPS.restore, []);
    push(OPS.moveTo, [0, 20]);
    push(OPS.lineTo, [50, 20]); // MUST be heavy/black again (state restored)

    const { segments } = extractSegmentsFromOpList({ fnArray, argsArray }, { scale: 1 });
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ lineWidth: HEAVY, strokeColor: WALL_COLOR });
    expect(segments[1]).toMatchObject({ lineWidth: THIN, strokeColor: ANNO_COLOR });
    // after restore, lineWidth+color are back to the heavy/black wall state
    expect(segments[2].lineWidth).toBeCloseTo(HEAVY, 9);
    expect(segments[2].strokeColor).toBe(WALL_COLOR);
  });

  test('(ii) selectWallLayer picks the heavier-lineweight wall layer & EXCLUDES thin full-width annotation', () => {
    const ol = twoLayerOpList();
    const { segments } = extractSegmentsFromOpList(ol, { scale: 1 });
    const sel = selectWallLayer(segments);

    // The chosen group is the heavy/black wall layer, not the thin/gray annotation.
    expect(sel.chosen.lineWidth).toBeCloseTo(HEAVY, 9);
    expect(sel.chosen.strokeColor).toBe(WALL_COLOR);
    // The selected wall segments are exactly the 4 building walls.
    expect(sel.wallSegments).toHaveLength(4);
    for (const s of sel.wallSegments) {
      expect(s.lineWidth).toBeCloseTo(HEAVY, 9);
      expect(s.strokeColor).toBe(WALL_COLOR);
    }
    // The full group histogram is returned (both layers visible).
    expect(sel.groups.length).toBeGreaterThanOrEqual(2);
    // The method documents the principled convention (heavier lineweight), not a fit.
    expect(String(sel.method)).toMatch(/lineweight|linewidth|heav/i);
    expect(String(sel.note)).not.toMatch(/21,?332|538,?792|target/i);
  });

  test('(iii) the selected wall footprint EXCLUDES the sheet-spanning annotation', () => {
    const ol = twoLayerOpList();
    const { segments, bbox: allBbox } = extractSegmentsFromOpList(ol, { scale: 1 });
    const sel = selectWallLayer(segments);

    // bbox of the SELECTED wall layer.
    const xs = sel.wallSegments.flatMap((s) => [s.x1, s.x2]);
    const ys = sel.wallSegments.flatMap((s) => [s.y1, s.y2]);
    const wallW = Math.max(...xs) - Math.min(...xs);
    const wallH = Math.max(...ys) - Math.min(...ys);

    // The wall footprint is the 200x120 building, NOT the -40..300 x -40..200 sheet span.
    expect(wallW).toBeCloseTo(200, 6);
    expect(wallH).toBeCloseTo(120, 6);
    // It is much smaller than the all-segments bbox (which the annotation blows up).
    const allW = allBbox.widthFt;
    const allH = allBbox.heightFt;
    expect(wallW * wallH).toBeLessThan(allW * allH * 0.6);
  });

  test('selectWallLayer reports the chosen group geometry (count, totalLenFt, bbox)', () => {
    const ol = twoLayerOpList();
    const { segments } = extractSegmentsFromOpList(ol, { scale: 1 });
    const sel = selectWallLayer(segments);
    const chosenGroup = sel.groups.find(
      (g) => Math.abs(g.lineWidth - HEAVY) < 1e-9 && g.strokeColor === WALL_COLOR,
    );
    expect(chosenGroup).toBeTruthy();
    expect(chosenGroup.count).toBe(4);
    // perimeter of a 200x120 rectangle = 640 ft.
    expect(chosenGroup.totalLenFt).toBeCloseTo(640, 3);
    expect(chosenGroup.bbox.widthFt).toBeCloseTo(200, 6);
    expect(chosenGroup.bbox.heightFt).toBeCloseTo(120, 6);
  });

  test('segmentsToFloorPlan({ extract: "wallLayer" }) bounds JUST the wall segments', () => {
    const ol = twoLayerOpList();
    const { segments } = extractSegmentsFromOpList(ol, { scale: 1 });
    const fp = segmentsToFloorPlan(segments, { extract: 'wallLayer', hazard: 'ordinary' });
    expect(fp.rooms).toHaveLength(1);
    expect(fp.rooms[0].hazard).toBe('ordinary');
    // The room footprint is the wall layer's 200x120 extent, not the full sheet.
    expect(fp.bbox.widthFt).toBeCloseTo(200, 6);
    expect(fp.bbox.heightFt).toBeCloseTo(120, 6);
    expect(fp.chosen.strokeColor).toBe(WALL_COLOR);
    expect(fp.chosen.lineWidth).toBeCloseTo(HEAVY, 9);
    expect(fp.wallSegmentCount).toBe(4);
    expect(String(fp.note)).toMatch(/graphics.state|lineweight|wall layer/i);
  });

  test('default behavior is UNCHANGED — op lists without color/width ops emit the bare {x1,y1,x2,y2} shape', () => {
    // BACKWARD COMPAT: the tags are additive and only ATTACHED when a graphics-state op
    // set them. An op list with no setLineWidth/setStrokeRGBColor emits exactly the bare
    // 4-field shape, so every existing toEqual assertion keeps passing unchanged.
    const ops = opList([
      [OPS.moveTo, [0, 0]],
      [OPS.lineTo, [10, 0]],
      [OPS.lineTo, [10, 10]],
      [OPS.closePath, []],
    ]);
    const { segments, count } = extractSegmentsFromOpList(ops, { scale: 1 });
    expect(count).toBe(3);
    // EXACT shape — no extra keys when untagged (proves backward compat under toEqual).
    expect(segments).toEqual([
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 10, y1: 0, x2: 10, y2: 10 },
      { x1: 10, y1: 10, x2: 0, y2: 0 },
    ]);
    // selectWallLayer treats a missing tag as a null/null group.
    for (const s of segments) {
      expect(s.lineWidth).toBeUndefined();
      expect(s.strokeColor).toBeUndefined();
    }
  });

  test('selectWallLayer degenerate inputs fall back without throwing', () => {
    expect(() => selectWallLayer([])).not.toThrow();
    const empty = selectWallLayer([]);
    expect(empty.wallSegments).toEqual([]);
    expect(Array.isArray(empty.groups)).toBe(true);

    // All-untagged segments -> a single null/null group, selected as the only layer.
    const untagged = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 60 },
    ];
    expect(() => selectWallLayer(untagged)).not.toThrow();
    const u = selectWallLayer(untagged);
    expect(u.wallSegments.length).toBeGreaterThan(0);
    expect(u.groups.length).toBe(1);
  });
});
