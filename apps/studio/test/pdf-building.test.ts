// T47 — BUILDING vector-PDF-first lane tests (DETERMINISTIC core).
//
// Exercises the PURE port of the proven autosprink algorithm with SYNTHETIC pdfjs
// operator lists (no real PDF, no worker, no canvas) plus an INJECTED pdfjs MOCK
// for loadPdfVectorPage. Asserts:
//  - extractVectorSegments walks legacy/v6 ops, applies CTM + operator scale, tags
//    graphics state.
//  - segmentsToFootprint yields the expected outline + areaSqft for a rectangle of
//    segments at a known scale; THROWS when scale is missing or <= 0; returns a
//    clear EMPTY result (never fabricates) when no usable wall geometry exists.
//  - parseArchitecturalScale parses the common architectural forms.
//  - wall-segment filtering is deterministic.
//  - loadPdfVectorPage uses the injected pdfjs mock end-to-end.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  extractVectorSegments,
  parseArchitecturalScale,
  segmentsToFootprint,
  loadPdfVectorPage,
  normalizeStrokeColorArg,
  type VectorSegment,
  type PdfjsLike,
} from '../src/lib/pdf-building';

// Build a legacy-style op list from primitive [fn, args] entries.
function opList(entries: Array<[number, unknown[]]>): {
  fnArray: number[];
  argsArray: unknown[];
} {
  const fnArray: number[] = [];
  const argsArray: unknown[] = [];
  for (const [fn, args] of entries) {
    fnArray.push(fn);
    argsArray.push(args);
  }
  return { fnArray, argsArray };
}

// A closed axis-aligned rectangle WxH (feet) as 4 lineTo segments via moveTo path.
function rectSegments(w: number, h: number): VectorSegment[] {
  return [
    { x1: 0, y1: 0, x2: w, y2: 0 },
    { x1: w, y1: 0, x2: w, y2: h },
    { x1: w, y1: h, x2: 0, y2: h },
    { x1: 0, y1: h, x2: 0, y2: 0 },
  ];
}

describe('extractVectorSegments — legacy path ops', () => {
  test('walks a closed triangle into 3 segments (closePath connects back)', () => {
    const ops = opList([
      [OPS.moveTo, [0, 0]],
      [OPS.lineTo, [10, 0]],
      [OPS.lineTo, [10, 10]],
      [OPS.closePath, []],
    ]);
    const { segments, count, bbox } = extractVectorSegments(ops, { scale: 1 });
    expect(count).toBe(3);
    expect(segments).toEqual([
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 10, y1: 0, x2: 10, y2: 10 },
      { x1: 10, y1: 10, x2: 0, y2: 0 },
    ]);
    expect(bbox.widthFt).toBe(10);
    expect(bbox.heightFt).toBe(10);
  });

  test('a rectangle op emits 4 closed segments', () => {
    const ops = opList([[OPS.rectangle, [2, 3, 8, 6]]]);
    const { segments, count } = extractVectorSegments(ops, { scale: 1 });
    expect(count).toBe(4);
    expect(segments).toEqual([
      { x1: 2, y1: 3, x2: 10, y2: 3 },
      { x1: 10, y1: 3, x2: 10, y2: 9 },
      { x1: 10, y1: 9, x2: 2, y2: 9 },
      { x1: 2, y1: 9, x2: 2, y2: 3 },
    ]);
  });

  test('operator scale maps PDF points -> feet (0.125 ft/pt on 800x600pt -> 100x75 ft)', () => {
    const ops = opList([[OPS.rectangle, [0, 0, 800, 600]]]);
    const { bbox } = extractVectorSegments(ops, { scale: 0.125 });
    expect(bbox.maxX).toBeCloseTo(100, 6);
    expect(bbox.maxY).toBeCloseTo(75, 6);
  });

  test('curveTo is approximated by its endpoint', () => {
    const ops = opList([
      [OPS.moveTo, [0, 0]],
      [OPS.curveTo, [1, 5, 9, 5, 10, 0]],
    ]);
    const { segments } = extractVectorSegments(ops, { scale: 1 });
    expect(segments).toEqual([{ x1: 0, y1: 0, x2: 10, y2: 0 }]);
  });

  test('CTM transform scales coordinates to page space before the operator scale', () => {
    // A 2x model-space transform then a 1x1 rect -> a 2x2 page-space rect.
    const ops = opList([
      [OPS.transform, [2, 0, 0, 2, 0, 0]],
      [OPS.rectangle, [0, 0, 1, 1]],
    ]);
    const { bbox } = extractVectorSegments(ops, { scale: 1 });
    expect(bbox.widthFt).toBe(2);
    expect(bbox.heightFt).toBe(2);
  });

  test('save/restore balances the CTM stack', () => {
    const ops = opList([
      [OPS.save, []],
      [OPS.transform, [3, 0, 0, 3, 0, 0]],
      [OPS.rectangle, [0, 0, 1, 1]], // 3x3 inside the save
      [OPS.restore, []],
      [OPS.rectangle, [0, 0, 1, 1]], // 1x1 after restore
    ]);
    const { bbox } = extractVectorSegments(ops, { scale: 1 });
    // Union spans 0..3 on both axes (the 3x3 dominates).
    expect(bbox.widthFt).toBe(3);
  });

  test('graphics-state lineWidth + strokeColor tags are attached when set', () => {
    const ops = opList([
      [OPS.setLineWidth, [2.5]],
      [OPS.setStrokeRGBColor, ['#112233']],
      [OPS.moveTo, [0, 0]],
      [OPS.lineTo, [10, 0]],
    ]);
    const { segments } = extractVectorSegments(ops, { scale: 1 });
    expect(segments).toEqual([
      { x1: 0, y1: 0, x2: 10, y2: 0, lineWidth: 2.5, strokeColor: '#112233' },
    ]);
  });

  test('text/image ops are ignored', () => {
    const ops = opList([
      [OPS.beginText, []],
      [OPS.endText, []],
      [OPS.moveTo, [0, 0]],
      [OPS.lineTo, [4, 0]],
      [OPS.paintImageXObject, ['img1']],
    ]);
    const { count } = extractVectorSegments(ops, { scale: 1 });
    expect(count).toBe(1);
  });

  test('empty / missing op list yields zero segments (no throw)', () => {
    expect(extractVectorSegments(null, { scale: 1 }).count).toBe(0);
    expect(extractVectorSegments({ fnArray: [], argsArray: [] }, { scale: 1 }).count).toBe(0);
  });

  test('accepts (opList, viewport, opts) signature for API parity', () => {
    const ops = opList([[OPS.rectangle, [0, 0, 4, 4]]]);
    const { bbox } = extractVectorSegments(ops, { width: 800, height: 600, scale: 1 }, { scale: 2 });
    // opts.scale wins (4*2 = 8).
    expect(bbox.widthFt).toBe(8);
  });
});

describe('normalizeStrokeColorArg', () => {
  test('hex string passthrough (lowercased)', () => {
    expect(normalizeStrokeColorArg(['#AABBCC'])).toBe('#aabbcc');
  });
  test('packed integer -> hex', () => {
    expect(normalizeStrokeColorArg([0x112233])).toBe('#112233');
  });
  test('[r,g,b] floats 0..1 -> hex', () => {
    expect(normalizeStrokeColorArg([1, 0, 0])).toBe('#ff0000');
  });
  test('pattern / undecodable -> null', () => {
    expect(normalizeStrokeColorArg([{}])).toBeNull();
  });
});

describe('parseArchitecturalScale — common architectural forms', () => {
  test('3/32" = 1\'-0" -> (32/3)/72', () => {
    const v = parseArchitecturalScale('SCALE: 3/32" = 1\'-0"');
    expect(v).not.toBeNull();
    expect(v as number).toBeCloseTo(32 / 3 / 72, 9);
  });

  test('1/8" = 1\'-0" -> 8/72', () => {
    expect(parseArchitecturalScale('1/8" = 1\'-0"') as number).toBeCloseTo(8 / 72, 9);
  });

  test('1/16" = 1\'-0" -> 16/72', () => {
    expect(parseArchitecturalScale('1/16" = 1\'-0"') as number).toBeCloseTo(16 / 72, 9);
  });

  test('1" = 20\' -> 20/72 (no -0" suffix)', () => {
    expect(parseArchitecturalScale('1" = 20\'') as number).toBeCloseTo(20 / 72, 9);
  });

  test('curly quote glyphs are normalized', () => {
    const v = parseArchitecturalScale('1/4” = 1’-0”');
    expect(v as number).toBeCloseTo(4 / 72, 9);
  });

  test('no recognizable scale -> null', () => {
    expect(parseArchitecturalScale('General Notes')).toBeNull();
    expect(parseArchitecturalScale('')).toBeNull();
  });
});

describe('segmentsToFootprint — scale discipline (fail-closed)', () => {
  test('THROWS when scaleFtPerUnit is missing', () => {
    expect(() => segmentsToFootprint(rectSegments(40, 60), {} as never)).toThrow(/scaleFtPerUnit/);
  });
  test('THROWS when scaleFtPerUnit is 0', () => {
    expect(() => segmentsToFootprint(rectSegments(40, 60), { scaleFtPerUnit: 0 })).toThrow(
      /scaleFtPerUnit/,
    );
  });
  test('THROWS when scaleFtPerUnit is negative', () => {
    expect(() => segmentsToFootprint(rectSegments(40, 60), { scaleFtPerUnit: -2 })).toThrow(
      /scaleFtPerUnit/,
    );
  });
  test('THROWS when scaleFtPerUnit is NaN', () => {
    expect(() =>
      segmentsToFootprint(rectSegments(40, 60), { scaleFtPerUnit: NaN }),
    ).toThrow(/scaleFtPerUnit/);
  });
});

describe('segmentsToFootprint — rectangle of segments', () => {
  test('40x60 rectangle at scale 1 yields ~2400 sqft and a 40x60 bbox', () => {
    const fp = segmentsToFootprint(rectSegments(40, 60), { scaleFtPerUnit: 1 });
    expect(fp.empty).toBe(false);
    expect(fp.method).toBe('wall-network-occupancy-grid');
    expect(fp.bboxFt.w).toBeCloseTo(40, 6);
    expect(fp.bboxFt.l).toBeCloseTo(60, 6);
    // Occupancy-grid area is close to the true 2400 sqft (within grid discretization).
    expect(fp.areaSqft).toBeGreaterThan(2300);
    expect(fp.areaSqft).toBeLessThanOrEqual(2400 * 1.02);
    expect(fp.wallSegmentCount).toBe(4);
    expect(fp.networkSegmentCount).toBe(4);
    expect(fp.outline.length).toBeGreaterThanOrEqual(4);
  });

  test('scaleFtPerUnit converts raw units -> feet (20x30 raw at 2 ft/unit -> 40x60 ft)', () => {
    const fp = segmentsToFootprint(rectSegments(20, 30), { scaleFtPerUnit: 2 });
    expect(fp.bboxFt.w).toBeCloseTo(40, 6);
    expect(fp.bboxFt.l).toBeCloseTo(60, 6);
    expect(fp.areaSqft).toBeGreaterThan(2300);
  });

  test('determinism: identical input -> identical output', () => {
    const a = segmentsToFootprint(rectSegments(40, 60), { scaleFtPerUnit: 1 });
    const b = segmentsToFootprint(rectSegments(40, 60), { scaleFtPerUnit: 1 });
    expect(a).toEqual(b);
  });
});

describe('segmentsToFootprint — never fabricates (honest empty)', () => {
  test('no segments -> empty result, no polygon', () => {
    const fp = segmentsToFootprint([], { scaleFtPerUnit: 1 });
    expect(fp.empty).toBe(true);
    expect(fp.outline).toEqual([]);
    expect(fp.areaSqft).toBe(0);
    expect(fp.method).toBe('empty-no-geometry');
  });

  test('only short witness ticks (below minWallFt) -> empty (no fabricated footprint)', () => {
    // A 2D scatter of tiny 0.5ft ticks (non-degenerate bbox) — no real wall runs.
    const ticks: VectorSegment[] = [];
    for (let i = 0; i < 10; i++) {
      ticks.push({ x1: i * 5, y1: i * 4, x2: i * 5 + 0.5, y2: i * 4 });
    }
    const fp = segmentsToFootprint(ticks, { scaleFtPerUnit: 1, minWallFt: 3 });
    expect(fp.empty).toBe(true);
    expect(fp.outline).toEqual([]);
    expect(fp.method).toBe('empty-no-walls');
  });
});

describe('segmentsToFootprint — deterministic wall filtering', () => {
  test('keeps long axis-aligned walls, drops short + skew segments', () => {
    const segs: VectorSegment[] = [
      ...rectSegments(40, 60), // 4 long walls
      { x1: 0, y1: 0, x2: 0.4, y2: 0 }, // short tick -> dropped
      { x1: 5, y1: 5, x2: 25, y2: 30 }, // long but diagonal (skew) -> dropped
    ];
    const fp = segmentsToFootprint(segs, { scaleFtPerUnit: 1, minWallFt: 3, axisTolDeg: 5 });
    expect(fp.wallSegmentCount).toBe(4); // only the 4 rectangle walls survive
  });
});

describe('bundled sample fixture (public/samples/room-segments.json)', () => {
  test('the committed L-room sample renders a deterministic footprint (~1020 sqft)', () => {
    const url = new URL('../public/samples/room-segments.json', import.meta.url);
    const sample = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as {
      scaleFtPerUnit: number;
      segments: VectorSegment[];
    };
    const fp = segmentsToFootprint(sample.segments, {
      scaleFtPerUnit: sample.scaleFtPerUnit,
    });
    expect(fp.empty).toBe(false);
    // L-room: 40x30 outer minus 15x12 notch = 1020 sqft (within grid discretization).
    expect(fp.areaSqft).toBeGreaterThan(1000);
    expect(fp.areaSqft).toBeLessThan(1040);
    expect(fp.bboxFt.w).toBeCloseTo(40, 4);
    expect(fp.bboxFt.l).toBeCloseTo(30, 4);
  });
});

describe('loadPdfVectorPage — injected pdfjs mock (no real PDF)', () => {
  function mockPdfjs(ops: { fnArray: number[]; argsArray: unknown[] }, capture?: {
    pages: number[];
  }): PdfjsLike {
    return {
      getDocument(params) {
        // Echo back a doc whose page yields the synthetic op list.
        void params.data; // bytes accepted but unused by the mock
        return {
          promise: Promise.resolve({
            numPages: 3,
            getPage(pageNumber: number) {
              capture?.pages.push(pageNumber);
              return Promise.resolve({
                getOperatorList: () => Promise.resolve(ops),
                getViewport: () => ({ width: 800, height: 600, scale: 1 }),
              });
            },
          }),
        };
      },
    };
  }

  test('extracts segments from the mocked page op list at the operator scale', async () => {
    const ops = opList([[OPS.rectangle, [0, 0, 800, 600]]]);
    const pdfjs = mockPdfjs(ops);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const res = await loadPdfVectorPage(bytes, 0, pdfjs, { scale: 0.125 });
    expect(res.count).toBe(4);
    expect(res.bbox.widthFt).toBeCloseTo(100, 6);
    expect(res.bbox.heightFt).toBeCloseTo(75, 6);
    expect(res.pageIndex).toBe(0);
    expect(res.scale).toBe(0.125);
  });

  test('requests page pageIndex+1 (pdfjs is 1-based)', async () => {
    const ops = opList([[OPS.rectangle, [0, 0, 10, 10]]]);
    const capture = { pages: [] as number[] };
    const pdfjs = mockPdfjs(ops, capture);
    await loadPdfVectorPage(new Uint8Array([1, 2]), 2, pdfjs, { scale: 1 });
    expect(capture.pages).toEqual([3]);
  });

  test('throws when no pdfjs module is provided', async () => {
    await expect(
      // @ts-expect-error intentionally passing a bad pdfjs to assert the guard
      loadPdfVectorPage(new Uint8Array([1]), 0, null, { scale: 1 }),
    ).rejects.toThrow(/getDocument/);
  });

  test('end-to-end: mocked page -> extract -> footprint at operator scale', async () => {
    // A 320x480 pt rectangle outline (4 separate stroked walls so they survive the
    // wall filter), at 0.125 ft/pt -> 40x60 ft footprint.
    const ops = opList([
      [OPS.moveTo, [0, 0]],
      [OPS.lineTo, [320, 0]],
      [OPS.lineTo, [320, 480]],
      [OPS.lineTo, [0, 480]],
      [OPS.closePath, []],
    ]);
    const pdfjs = mockPdfjs(ops);
    const res = await loadPdfVectorPage(new Uint8Array([1]), 0, pdfjs, { scale: 0.125 });
    // Segments already in feet (scale applied) -> footprint at scaleFtPerUnit 1.
    const fp = segmentsToFootprint(res.segments, { scaleFtPerUnit: 1 });
    expect(fp.empty).toBe(false);
    expect(fp.bboxFt.w).toBeCloseTo(40, 4);
    expect(fp.bboxFt.l).toBeCloseTo(60, 4);
    expect(fp.areaSqft).toBeGreaterThan(2300);
  });
});
