import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  buildHomeDepotSeedRows,
  readHomeDepotBidPackage,
} from '../src/data/home-depot-bid-package.js';

const ROOT = path.resolve(__dirname, '..');

describe('Home Depot Rexburg bid package ingestion', () => {
  test('reads the actual proposal workbook and bid log values', () => {
    const pkg = readHomeDepotBidPackage(ROOT);

    expect(pkg.project).toBe('Home Depot - Rexburg ID');
    expect(pkg.contractor).toBe('ESI');
    expect(pkg.recipient).toBe('Paden Moore');
    expect(pkg.address).toBe('329 Teton River Temple st, Rexburg ID 83440');
    expect(pkg.sqft).toBe(121500);
    expect(pkg.headCount).toBe(858);
    expect(pkg.bidLogAmount).toBeCloseTo(792543.84, 2);
    expect(pkg.proposalBaseTotal).toBeCloseTo(767543.8391569464, 6);
    expect(pkg.totalWithOptions).toBeCloseTo(792543.8391569464, 6);
    expect(pkg.status).toBe('Bidding');
    expect(pkg.dueDate).toBe('2026-03-05');
    expect(pkg.submittedDate).toBe('2026-03-04');
    expect(pkg.water.staticPsi).toBe(76);
    expect(pkg.water.residualPsi).toBe(69);
    expect(pkg.water.flowingGpm).toBe(1226);
    expect(pkg.sourceRefs).toContain('Proposal- Home Depot - Rexburg ID.xlsx#Building 1!G11');
    expect(pkg.sourceRefs).toContain('01-Bid Log.xlsx#Bid Log row 238');
  });

  test('builds database seed rows from source-linked package facts', () => {
    const rows = buildHomeDepotSeedRows(ROOT);

    expect(rows.bid).toMatchObject({
      project: 'Home Depot - Rexburg ID',
      contractor: 'ESI',
      value: 792543.84,
      status: 'Bidding',
      due_date: '2026-03-05',
      sqft: 121500,
      system_type: 'Wet',
      contact: 'Paden Moore',
    });
    expect(rows.project).toMatchObject({
      name: 'Home Depot - Rexburg ID',
      phase: 'Bid Review',
      budget: 792543.84,
      manager: 'Max Steele',
      status: 'Bidding',
    });
    expect(rows.project.notes).toContain('"proposalBaseTotal":767543.8391569464');
    expect(rows.bid.notes).toContain('Proposal- Home Depot - Rexburg ID.xlsx#Building 1!G11');
  });
});
