import { describe, expect, test } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  extractSegmentsFromOpList,
  segmentsToFloorPlan,
  floorPlanFromPdf,
} from '../src/engine/pdf-floorplan.js';

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
