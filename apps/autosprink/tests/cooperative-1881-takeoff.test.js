import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  readCooperative1881RealTakeoff,
  readCooperative1881BidPackage,
} from '../src/data/cooperative-1881-bid-package.js';

// The Cooperative 1881 Apartments (1881 West North Temple, Salt Lake City UT;
// GC Kier Construction) is a RESIDENTIAL apartment fire-sprinkler bid — the
// standard-spray (light/ordinary hazard) path, NOT ESFR. Its real ESI/Knowify
// proposal workbook lives in the repo root. We parse the REAL submitted takeoff
// (the Knowify SOV cost block on the "Building (1)" sheet) into a structured
// breakdown by summing each cost COLUMN (N/O/P/Q/R) over the block rows and
// validating against the "Knowify Check" total — robust to the per-phase row
// labels (Bidding/Precon/RoughIn/Trim) which differ from the Home Depot job.
//
// This is real PARSED source data (an evidence trail), NOT a model achievement
// and NOT an accuracy/parity/AHJ/PE claim. SKIP-IF-ABSENT: the workbook is
// present locally but untracked, so a fresh clone / CI without it must not fail.
const ROOT = path.resolve(__dirname, '..');
const WORKBOOK = path.join(ROOT, 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx');
const HAVE_WORKBOOK = fs.existsSync(WORKBOOK);

describe.skipIf(!HAVE_WORKBOOK)('Cooperative 1881 REAL ESI takeoff ingestion', () => {
  test('parses the Knowify SOV cost block by column sums (Building (1))', () => {
    const t = readCooperative1881RealTakeoff(ROOT);

    // Cost breakdown (un-marked-up) — column sums over the Knowify SOV block.
    expect(t.cost.material).toBeCloseTo(188777.67, 2);
    expect(t.cost.labor).toBeCloseTo(152694.67, 2);
    expect(t.cost.equipment).toBeCloseTo(25525.50, 2);
    expect(t.cost.subcontractor).toBe(19432);
    expect(t.cost.miscellaneous).toBeCloseTo(18677.19, 2);
    // cost.total = sum of the five cost categories, validated against the
    // "Knowify Check" total (R38) on the sheet.
    expect(t.cost.total).toBeCloseTo(405107.03, 2);
    expect(t.knowifyCheck).toBeCloseTo(405107.03, 2);
    // The summed columns must agree with the sheet's own check total.
    expect(t.cost.total).toBeCloseTo(t.knowifyCheck, 2);
  });

  test('reads the proposal total, head count, sqft, and markup', () => {
    const t = readCooperative1881RealTakeoff(ROOT);
    // Single-building proposal total (G11); the Proposal Template K10/K39 match it.
    expect(t.totalPrice).toBeCloseTo(538792.35, 2);
    expect(t.bidLogTotal).toBeCloseTo(538792.35, 2);
    expect(t.total).toBeCloseTo(538792.35, 2);
    expect(t.headCount).toBe(1420);
    expect(t.sqft).toBe(170654);
    expect(t.markupPct).toBeCloseTo(0.33, 2);
  });

  test('cites the Knowify block + Knowify Check + G11 + B9 + G6 source cells', () => {
    const t = readCooperative1881RealTakeoff(ROOT);
    expect(Array.isArray(t.sourceRefs)).toBe(true);
    const joined = t.sourceRefs.join(' ');
    // The Knowify SOV cost block range.
    expect(joined).toMatch(/Building \(1\)!N\d+:R\d+/);
    // The "Knowify Check" cost total, the proposal total, head count, and sqft.
    expect(t.sourceRefs).toContain('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!R38');
    expect(t.sourceRefs).toContain('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G11');
    expect(t.sourceRefs).toContain('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!B9');
    expect(t.sourceRefs).toContain('Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx#Building (1)!G6');
    // Every cited cell is a Building (1) reference.
    for (const ref of t.sourceRefs) {
      expect(ref).toContain('#Building (1)!');
    }
  });

  test('disclaimer makes no parity / approval / accuracy claim', () => {
    const t = readCooperative1881RealTakeoff(ROOT);
    expect(typeof t.disclaimer).toBe('string');
    const lower = t.disclaimer.toLowerCase();
    // REAL submitted data, not a model parity/accuracy/approval claim.
    expect(lower).not.toContain('parity');
    expect(lower).not.toContain('approved');
    expect(lower).not.toMatch(/\baccurate\b/);
    // It may DISCLAIM AutoSprink ("NOT an AutoSprink claim") but must never
    // assert AutoSprink parity/equivalence.
    expect(lower).not.toMatch(/autosprink (parity|equivalent|approved)/);
    // Explicit that this is the real submitted breakdown.
    expect(lower).toContain('real');
  });

  test('readCooperative1881BidPackage returns the project header facts', () => {
    const pkg = readCooperative1881BidPackage(ROOT);
    expect(pkg.project).toBe('The Cooperative 1881 - Salt Lake City UT');
    expect(pkg.contractor).toMatch(/Kier/i);
    expect(pkg.address).toMatch(/1881/);
    expect(pkg.sqft).toBe(170654);
    expect(pkg.headCount).toBe(1420);
    expect(pkg.total).toBeCloseTo(538792.35, 2);
    expect(Array.isArray(pkg.sourceRefs)).toBe(true);
    expect(pkg.sourceRefs.length).toBeGreaterThan(0);
  });

  test('throws a clear Error when the workbook is absent', () => {
    expect(() => readCooperative1881RealTakeoff(path.join(ROOT, 'no-such-dir')))
      .toThrow(/workbook not found/i);
  });
});
