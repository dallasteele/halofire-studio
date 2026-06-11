import { describe, expect, it } from 'vitest';
import { toBidPayload, type TakeoffLine } from '../src/lib/bid-payload';

describe('toBidPayload', () => {
  const projectName = 'Test Project';
  const timestamp = '2023-10-27T10:00:00Z';

  it('maps two lines with correct skus and rounding', () => {
    const lines: TakeoffLine[] = [
      {
        kind: 'HEAD',
        label: 'Sprinkler Head A',
        qty: 12,
        unit: 'EA',
        sizeIn: 0.5,
        material: 'Chrome',
      },
      {
        kind: 'PIPE',
        label: 'Pipe Segment B',
        qty: 10.555,
        unit: 'FT',
        sizeIn: 2,
      },
    ];

    const result = toBidPayload(projectName, lines, timestamp);

    expect(result.items).toHaveLength(2);
    // SKU check: head:0.5:chrome (lowercase)
    expect(result.items[0]).toEqual({
      sku: 'head:0.5:chrome',
      description: 'Sprinkler Head A',
      quantity: 12,
      unit: 'EA',
    });
    // SKU check: pipe:2:na (lowercase)
    expect(result.items[1]).toEqual({
      sku: 'pipe:2:na',
      description: 'Pipe Segment B',
      quantity: 10.56,
      unit: 'FT',
    });
  });

  it('skips lines with qty <= 0', () => {
    const lines: TakeoffLine[] = [
      { kind: 'HEAD', label: 'Valid', qty: 1, unit: 'EA' },
      { kind: 'PIPE', label: 'Zero', qty: 0, unit: 'FT' },
      { kind: 'FITTING', label: 'Negative', qty: -5, unit: 'EA' },
    ];

    const result = toBidPayload(projectName, lines, timestamp);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].description).toBe('Valid');
  });

  it('throws on empty projectName', () => {
    const lines: TakeoffLine[] = [{ kind: 'HEAD', label: 'X', qty: 1, unit: 'EA' }];
    expect(() => toBidPayload('', lines, timestamp)).toThrow();
    expect(() => toBidPayload('   ', lines, timestamp)).toThrow();
  });

  it('throws on non-finite qty in a kept line', () => {
    const lines: TakeoffLine[] = [
      { kind: 'HEAD', label: 'Valid', qty: 1, unit: 'EA' },
      { kind: 'PIPE', label: 'NaN', qty: NaN, unit: 'FT' },
    ];
    expect(() => toBidPayload(projectName, lines, timestamp)).toThrow();
  });

  it('contains required disclaimer phrases', () => {
    const result = toBidPayload(projectName, [], timestamp);
    expect(result.disclaimer).toContain('design aid');
    expect(result.disclaimer).toContain('not a committed bid');
  });

  it('is pure and does not mutate input array', () => {
    const lines: TakeoffLine[] = [
      { kind: 'HEAD', label: 'X', qty: 1, unit: 'EA' },
    ];
    const originalLinesJson = JSON.stringify(lines);
    toBidPayload(projectName, lines, timestamp);
    expect(JSON.stringify(lines)).toBe(originalLinesJson);
  });
});