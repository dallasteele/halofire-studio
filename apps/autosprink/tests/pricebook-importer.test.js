import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { readPricebooks } from '../src/data/pricebook-importer.js';

const ROOT = path.resolve(__dirname, '..');

describe('supplier pricebook ingestion', () => {
  test('imports ARGCO, Victaulic, and FFF rows with source metadata', () => {
    const items = readPricebooks(ROOT);
    const argcoItems = items.filter((item) => item.supplier === 'ARGCO');
    const victaulicItems = items.filter((item) => item.supplier === 'Victaulic');
    const fffItems = items.filter((item) => item.supplier === 'FFF');

    expect(argcoItems.length).toBeGreaterThan(2000);
    expect(victaulicItems.length).toBeGreaterThan(1000);
    expect(fffItems.length).toBeGreaterThan(1000);
    expect(items.some((item) => item.sku === '7010802' && item.supplier === 'ARGCO')).toBe(true);
    expect(items.some((item) => item.sku === 'L02009NPE0' && item.supplier === 'Victaulic')).toBe(true);
    expect(items.some((item) => item.sku === 'AGF111' && item.supplier === 'FFF')).toBe(true);
    expect(items.every((item) => item.source_file && item.source_sheet && item.source_row)).toBe(true);
  });

  test('normalizes supplier-specific descriptions and numeric prices', () => {
    const items = readPricebooks(ROOT);

    expect(items.find((item) => item.sku === '7010802' && item.supplier === 'ARGCO')).toMatchObject({
      description: 'Grooved Coupling PUSH-ON Rigid 1-1/4" (109)',
      price: 3.56,
      source_file: 'Halo FIre Pricebook ARGCO 2026.xlsx',
      source_sheet: 'ARGCOPricebookTravisResults',
      source_row: 7,
    });
    expect(items.find((item) => item.sku === 'L02009NPE0' && item.supplier === 'Victaulic')).toMatchObject({
      description: 'Coupling Rigid 009N 2 Painted',
      price: 137,
      source_file: 'Halo Fire Pricebook Victaulic 2026.xlsx',
      source_sheet: 'Data',
      source_row: 4,
    });
    expect(items.find((item) => item.sku === 'AGF111' && item.supplier === 'FFF')).toMatchObject({
      description: '1 TEST & DRN M1000 7/16 ORFC',
      price: 151.72,
      source_file: 'Halo Fire Pricebook FFF 2026.xlsx',
      source_sheet: 'AGF',
      source_row: 5,
    });
  });
});
