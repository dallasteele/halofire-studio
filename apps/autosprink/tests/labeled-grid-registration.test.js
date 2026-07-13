import { describe, expect, it } from 'vitest';
import {
  extractLabeledGridFrame,
  registerPointViaLabeledGrid,
  verifyLabeledGridRegistration,
} from '../src/engine/labeled-grid-registration.js';

const labels = (values, makeItem) => Object.entries(values).map(([label, value]) => makeItem(label, value));

describe('labeled structural-grid registration', () => {
  const columns = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [String(index + 1), 100 + index * 50]));
  const rows = Object.fromEntries('ABCDEFGH'.split('').map((label, index) => [label, 900 - index * 60]));

  it('locates complete orthogonal rails and ignores same-label annotation noise', () => {
    const items = [
      ...labels(columns, (s, xPt) => ({ s, xPt, yPt: 1000 })),
      ...labels(rows, (s, yPt) => ({ s, xPt: 950, yPt })),
      { s: '1', xPt: 10, yPt: 10 }, { s: 'A', xPt: 20, yPt: 20 },
    ];
    const frame = extractLabeledGridFrame(items);
    expect(frame.columns).toMatchObject({ fixedAxis: 'y', variableAxis: 'x', uniqueLabels: 16 });
    expect(frame.rows).toMatchObject({ fixedAxis: 'x', variableAxis: 'y', uniqueLabels: 8 });
  });

  it('piecewise-registers a rotated source frame into a target frame', () => {
    const targetItems = [
      ...labels(columns, (s, xPt) => ({ s, xPt, yPt: 1000 })),
      ...labels(rows, (s, yPt) => ({ s, xPt: 950, yPt })),
    ];
    const sourceItems = [
      ...labels(columns, (s, value) => ({ s, xPt: 50, yPt: value + (Number(s) >= 8 && Number(s) <= 10 ? 20 : 0) })),
      ...labels(rows, (s, value) => ({ s, xPt: 1200 - value, yPt: 40 })),
    ];
    const source = extractLabeledGridFrame(sourceItems);
    const target = extractLabeledGridFrame(targetItems);
    const sourcePoint = [1200 - rows.D, columns['8'] + 20];
    expect(registerPointViaLabeledGrid(sourcePoint, source, target)).toEqual([columns['8'], rows.D]);
    expect(verifyLabeledGridRegistration(source, target)).toMatchObject({ status: 'passed', globalAffineRejected: true });
  });

  it('fails closed on incomplete or non-orthogonal rail evidence', () => {
    expect(() => extractLabeledGridFrame([
      ...labels(Object.fromEntries(Object.entries(columns).slice(0, 4)), (s, xPt) => ({ s, xPt, yPt: 1000 })),
      ...labels(rows, (s, yPt) => ({ s, xPt: 950, yPt })),
    ])).toThrow(/numbered/);
    expect(() => extractLabeledGridFrame([
      ...labels(columns, (s, xPt) => ({ s, xPt, yPt: 1000 })),
      ...labels(rows, (s, xPt) => ({ s, xPt, yPt: 1100 })),
    ])).toThrow(/orthogonal/);
    const swapped = { ...columns, 8: columns['9'], 9: columns['8'] };
    expect(() => extractLabeledGridFrame([
      ...labels(swapped, (s, xPt) => ({ s, xPt, yPt: 1000 })),
      ...labels(rows, (s, yPt) => ({ s, xPt: 950, yPt })),
    ])).toThrow(/non-monotonic/);
  });
});
