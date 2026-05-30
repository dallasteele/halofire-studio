import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { readHomeDepotRealTakeoff } from '../src/data/home-depot-bid-package.js';

// T24 — Real-takeoff bid calibration. Parses the REAL ESI takeoff (the actual
// bid-line rows) from the Home Depot proposal workbook "Building 1" sheet
// (Knowify SOV block) into a structured scope breakdown, surfaced as an itemized
// calibration reference (a real evidence trail). This is real PARSED source data
// — it is NOT a model achievement and clears NO regulated gate.
//
// SKIP-IF-ABSENT: the proposal workbook is present locally but untracked, so a
// fresh clone / CI without the file must not fail here (an improvement over the
// existing hard dependency in bid-package.test.js).
const ROOT = path.resolve(__dirname, '..');
const WORKBOOK = path.join(ROOT, 'Proposal- Home Depot - Rexburg ID.xlsx');
const HAVE_WORKBOOK = fs.existsSync(WORKBOOK);

describe.skipIf(!HAVE_WORKBOOK)('Home Depot Rexburg REAL ESI takeoff ingestion (T24)', () => {
  test('parses the Building 1 SOV cost + with-markup breakdown from real cells', () => {
    const t = readHomeDepotRealTakeoff(ROOT);

    // Cost breakdown (un-marked-up) — the real ESI takeoff categories.
    expect(t.cost.material).toBeCloseTo(396097.57, 2);
    expect(t.cost.labor).toBeCloseTo(143473.33, 2);
    expect(t.cost.equipment).toBeCloseTo(36431.44, 2);
    expect(t.cost.subcontractor).toBe(5000);
    expect(t.cost.miscellaneous).toBe(2500);
    // cost.total = sum of the five cost categories.
    expect(t.cost.total).toBeCloseTo(
      396097.57 + 143473.33 + 36431.44 + 5000 + 2500,
      2,
    );

    // With-markup (the submitted SOV line items).
    expect(t.withMarkup.materials).toBeCloseTo(514926.85, 2);
    expect(t.withMarkup.labor).toBeCloseTo(233876.19, 2);
    expect(t.withMarkup.design).toBe(9750);
    expect(t.withMarkup.sovTotal).toBeCloseTo(758553.04, 2);

    // Totals + derived markup.
    expect(t.totalPrice).toBeCloseTo(767543.84, 2);
    expect(t.bidLogTotal).toBe(792543.84);
    expect(t.markupPct).toBeCloseTo(0.30, 2);
  });

  test('cites each Building 1 source cell so the evidence trail is explicit', () => {
    const t = readHomeDepotRealTakeoff(ROOT);
    expect(Array.isArray(t.sourceRefs)).toBe(true);
    expect(t.sourceRefs).toContain('Proposal- Home Depot - Rexburg ID.xlsx#Building 1!N31');
    expect(t.sourceRefs).toContain('Proposal- Home Depot - Rexburg ID.xlsx#Building 1!U34');
    // Every cited cell is a Building 1 reference.
    for (const ref of t.sourceRefs) {
      expect(ref).toContain('#Building 1!');
    }
  });

  test('disclaimer makes no parity / approval / accuracy claim', () => {
    const t = readHomeDepotRealTakeoff(ROOT);
    expect(typeof t.disclaimer).toBe('string');
    const lower = t.disclaimer.toLowerCase();
    // It is REAL submitted data, not a model parity/accuracy/approval claim.
    expect(lower).not.toContain('parity');
    expect(lower).not.toContain('approved');
    expect(lower).not.toMatch(/\baccurate\b/);
    // And it must be explicit that this is the real submitted breakdown.
    expect(lower).toContain('real');
  });
});
