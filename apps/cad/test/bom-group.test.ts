import { BomItem, groupBom } from '../src/lib/bom-group';

describe('groupBom', () => {
  it('groups items with same category/size/material', () => {
    const items: BomItem[] = [
      { category: 'Pipe', sizeIn: 1, material: 'Steel', qty: 2, unitCost: 10 },
      { category: 'Pipe', sizeIn: 1, material: 'Steel', qty: 3, unitCost: 10 }
    ];
    const result = groupBom(items);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].qty).toBe(5);
    expect(result.rows[0].extendedCost).toBe(50);
    expect(result.totalQty).toBe(5);
    expect(result.totalCost).toBe(50);
  });

  it('keeps different sizes separate', () => {
    const items: BomItem[] = [
      { category: 'Pipe', sizeIn: 1, material: 'Steel', qty: 2, unitCost: 10 },
      { category: 'Pipe', sizeIn: 2, material: 'Steel', qty: 3, unitCost: 10 }
    ];
    const result = groupBom(items);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].sizeIn).toBe(1);
    expect(result.rows[1].sizeIn).toBe(2);
  });

  it('sorts rows by key ascending', () => {
    const items: BomItem[] = [
      { category: 'Pipe', sizeIn: 2, material: 'Steel', qty: 1, unitCost: 10 },
      { category: 'Pipe', sizeIn: 1, material: 'Steel', qty: 1, unitCost: 10 }
    ];
    const result = groupBom(items);
    expect(result.rows[0].key).toBe('Pipe|1|Steel');
    expect(result.rows[1].key).toBe('Pipe|2|Steel');
  });

  it('handles empty input', () => {
    const result = groupBom([]);
    expect(result.rows).toHaveLength(0);
    expect(result.totalQty).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  it('throws on negative qty', () => {
    const items: BomItem[] = [{ category: 'Pipe', sizeIn: 1, material: 'Steel', qty: -1, unitCost: 10 }];
    expect(() => groupBom(items)).toThrow('Invalid item: negative or non-finite quantity or unit cost');
  });

  it('throws on negative unitCost', () => {
    const items: BomItem[] = [{ category: 'Pipe', sizeIn: 1, material: 'Steel', qty: 1, unitCost: -10 }];
    expect(() => groupBom(items)).toThrow('Invalid item: negative or non-finite quantity or unit cost');
  });

  it('throws on non-finite qty', () => {
    const items: BomItem[] = [{ category: 'Pipe', sizeIn: 1, material: 'Steel', qty: Infinity, unitCost: 10 }];
    expect(() => groupBom(items)).toThrow('Invalid item: negative or non-finite quantity or unit cost');
  });

  it('throws on non-finite unitCost', () => {
    const items: BomItem[] = [{ category: 'Pipe', sizeIn: 1, material: 'Steel', qty: 1, unitCost: Infinity }];
    expect(() => groupBom(items)).toThrow('Invalid item: negative or non-finite quantity or unit cost');
  });
});
