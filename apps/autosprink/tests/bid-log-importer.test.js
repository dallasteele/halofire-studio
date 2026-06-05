import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { readBidLogRows } from '../src/data/bid-log-importer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

describe('bid log importer', () => {
  test('reads sourced rows from the actual bid log workbook', () => {
    const rows = readBidLogRows(ROOT);
    const homeDepot = rows.find((row) => row.project === 'Home Depot - Rexburg ID');

    expect(homeDepot).toBeDefined();
    expect(homeDepot.worksheetRow).toBe(238);
    expect(homeDepot.value).toBe(792543.84);
    expect(homeDepot.sourceRefs).toContain('01-Bid Log.xlsx#Bid Log row 238');
    expect(rows.every((row) => row.source === 'actual_bid_log')).toBe(true);
  });

  test('preserves bid log source metadata and review status', () => {
    const rows = readBidLogRows(ROOT);
    const homeDepot = rows.find((row) => row.project === 'Home Depot - Rexburg ID');
    const rowsMissingAmounts = rows.filter((row) => row.value === null);

    expect(homeDepot).toMatchObject({
      source_file: '01-Bid Log.xlsx',
      sheet: 'Bid Log',
      due_date: '2026-03-05',
      submitted_date: '2026-03-04',
      status: 'Bidding',
      prospect_rank: 0.9,
      estimator: 'Max',
      job_type: 'New',
      sqft: 135000,
      contractor: 'ESI',
    });
    expect(homeDepot.sourceRefs).toEqual(['01-Bid Log.xlsx#Bid Log row 238']);
    expect(rowsMissingAmounts.length).toBeGreaterThan(0);
    expect(rowsMissingAmounts.every((row) => row.status === 'needs_amount_review')).toBe(true);
  });
});
