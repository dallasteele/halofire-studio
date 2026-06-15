/**
 * Phase-4 chunk 5 — CUT-SHEET BUNDLE unit tests.
 *
 * Verifies the PURE engine src/engine/cut-sheets.js:
 *  - derives the distinct USED SKUs (heads by orientation/K, pipe by size/sched,
 *    fittings/hangers) with real counts from the live model + BOM + hydraulics;
 *  - matches each SKU to a PUBLIC datasheet reference from the canonical catalog
 *    (verified | probable | not-found), honestly flagging unmatched SKUs;
 *  - never fabricates a datasheet (only links/records);
 *  - honest degrade on an empty model.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  deriveUsedSkus,
  matchDatasheet,
  buildCutsheetBundle,
  FALLBACK_CATALOG,
  CUTSHEETS_DISCLAIMER,
} from '../src/engine/cut-sheets.js';

const CATALOG = JSON.parse(readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'cutsheet-urls-fittings.json'),
  'utf8',
));

// A small but representative model: pendent heads, two pipe sizes, some fittings.
function model() {
  return {
    solids: [
      { kind: 'head', name: 'h1', position: [5, 5, 9], orientation: 'pendent' },
      { kind: 'head', name: 'h2', position: [15, 5, 9], orientation: 'pendent' },
      { kind: 'head', name: 'h3', position: [25, 5, 9], orientation: 'upright' },
      { kind: 'pipe', name: 'b1', from: [0, 0, 9], to: [10, 0, 9], diameterIn: 1.0, role: 'branch' },
      { kind: 'pipe', name: 'b2', from: [10, 0, 9], to: [20, 0, 9], diameterIn: 1.25, role: 'branch' },
      { kind: 'pipe', name: 'm1', from: [0, 0, 9], to: [0, 30, 9], diameterIn: 6.0, role: 'cross-main' },
      { kind: 'component', name: 'f1', componentType: 'tee' },
      { kind: 'component', name: 'f2', componentType: 'elbow' },
      { kind: 'wall', name: 'w1', a: [0, 0], b: [30, 0] },
    ],
  };
}

describe('deriveUsedSkus', () => {
  it('groups heads by orientation + K-factor with real counts', () => {
    const skus = deriveUsedSkus({ cadModel: model() });
    const heads = skus.filter((s) => s.klass === 'head');
    // pendent (2) and upright (1) are distinct SKUs
    expect(heads.length).toBe(2);
    const pendent = heads.find((s) => s.attrs.orientation === 'pendent');
    const upright = heads.find((s) => s.attrs.orientation === 'upright');
    expect(pendent.count).toBe(2);
    expect(upright.count).toBe(1);
    // default K when no hydraulic report is 5.6
    expect(pendent.attrs.kFactor).toBe(5.6);
  });

  it('groups pipe by diameter + schedule and totals real footage', () => {
    const skus = deriveUsedSkus({ cadModel: model() });
    const pipes = skus.filter((s) => s.klass === 'pipe');
    expect(pipes.length).toBe(3); // 1.0", 1.25", 6.0"
    const main = pipes.find((s) => s.attrs.diameterIn === 6);
    expect(main.attrs.schedule).toBe('SCH10'); // >=4" -> SCH10
    expect(main.lengthFt).toBe(30);            // real geometric length
    const branch = pipes.find((s) => s.attrs.diameterIn === 1);
    expect(branch.attrs.schedule).toBe('SCH40');
    expect(branch.lengthFt).toBe(10);
  });

  it('emits a fitting SKU from model components', () => {
    const skus = deriveUsedSkus({ cadModel: model() });
    const fittings = skus.filter((s) => s.klass === 'fitting');
    expect(fittings.length).toBe(1);
    expect(fittings[0].count).toBe(2);
  });

  it('derives hangers/couplings from the BOM when present', () => {
    const skus = deriveUsedSkus({ cadModel: { solids: [] }, bom: { hangers: 12, couplings: 8 } });
    const hanger = skus.find((s) => s.klass === 'hanger');
    const fitting = skus.find((s) => s.klass === 'fitting');
    expect(hanger.count).toBe(12);
    expect(fitting.count).toBe(8); // couplings -> fitting class when no model components
  });

  it('uses the hydraulic-report K-factor and detects ESFR/storage', () => {
    const skus = deriveUsedSkus({
      cadModel: model(),
      hydraulicReport: { summary: { kFactor: 14.0, hazardLabel: 'ESFR storage' } },
    });
    const head = skus.find((s) => s.klass === 'head' && s.attrs.orientation === 'pendent');
    expect(head.attrs.kFactor).toBe(14.0);
    expect(head.attrs.esfr).toBe(true);
  });

  it('returns no SKUs for an empty model', () => {
    expect(deriveUsedSkus({ cadModel: { solids: [] } })).toEqual([]);
  });
});

describe('matchDatasheet (against the canonical catalog)', () => {
  it('matches a pendent head to head_pendent (real public TFP reference)', () => {
    const sku = { klass: 'head', attrs: { orientation: 'pendent', kFactor: 5.6, esfr: false } };
    const ref = matchDatasheet(sku, CATALOG);
    expect(ref).toBeTruthy();
    expect(ref.key).toBe('head_pendent');
    expect(ref.url).toMatch(/^https:\/\//);
  });

  it('matches a 6" main to pipe_sch10 (verified Wheatland submittal)', () => {
    const sku = { klass: 'pipe', attrs: { diameterIn: 6, schedule: 'SCH10' } };
    const ref = matchDatasheet(sku, CATALOG);
    expect(ref.key).toBe('pipe_sch10');
    expect(ref.confidence).toBe('verified');
  });

  it('matches an ESFR head to head_esfr', () => {
    const sku = { klass: 'head', attrs: { orientation: 'pendent', kFactor: 14.0, esfr: true } };
    const ref = matchDatasheet(sku, CATALOG);
    expect(ref.key).toBe('head_esfr');
  });

  it('returns null for a SKU class with no public reference (hanger not in catalog)', () => {
    const sku = { klass: 'hanger', attrs: {} };
    expect(matchDatasheet(sku, CATALOG)).toBeNull();
  });
});

describe('buildCutsheetBundle', () => {
  it('returns the {skus, entries} contract with real per-SKU references', () => {
    const b = buildCutsheetBundle({ cadModel: model(), catalog: CATALOG });
    expect(Array.isArray(b.skus)).toBe(true);
    expect(Array.isArray(b.entries)).toBe(true);
    expect(b.skuCount).toBe(b.skus.length);
    expect(b.exportReady).toBe(true);
    // every entry is either matched with a real https url, or honestly unmatched
    for (const e of b.entries) {
      if (e.matched) {
        expect(e.ref.url).toMatch(/^https:\/\//);
        expect(['verified', 'probable']).toContain(e.ref.confidence);
        expect(e.reason).toBeNull();
      } else {
        expect(e.ref).toBeNull();
        expect(e.reason).toMatch(/engineer must supply/i);
      }
    }
    // at least the pendent head + the pipe sizes + the fitting should match
    expect(b.matchedCount).toBeGreaterThanOrEqual(4);
  });

  it('never fabricates a datasheet — refs only carry catalog links/records', () => {
    const b = buildCutsheetBundle({ cadModel: model(), catalog: CATALOG });
    for (const e of b.entries.filter((x) => x.matched)) {
      // ref must be a catalog entry (has a key that exists in the catalog) — not invented content
      const inCatalog = CATALOG.some((c) => c.key === e.ref.key && c.url === e.ref.url);
      expect(inCatalog).toBe(true);
    }
  });

  it('honestly flags hangers as unmatched (no public catalog entry)', () => {
    const b = buildCutsheetBundle({ cadModel: { solids: [] }, bom: { hangers: 5 }, catalog: CATALOG });
    const hanger = b.entries.find((e) => e.klass === 'hanger');
    expect(hanger.matched).toBe(false);
    expect(b.unmatched).toContain(hanger.key);
  });

  it('falls back to the built-in catalog when none injected', () => {
    const b = buildCutsheetBundle({ cadModel: model() });
    expect(b.exportReady).toBe(true);
    expect(b.matchedCount).toBeGreaterThan(0);
    expect(FALLBACK_CATALOG.length).toBeGreaterThan(0);
  });

  it('degrades honestly on an empty model', () => {
    const b = buildCutsheetBundle({ cadModel: { solids: [] }, catalog: CATALOG });
    expect(b.skus).toEqual([]);
    expect(b.entries).toEqual([]);
    expect(b.exportReady).toBe(false);
    expect(b.disclaimer).toBe(CUTSHEETS_DISCLAIMER);
  });

  it('every entry and the bundle carry the NOT-AHJ/PE disclaimer', () => {
    const b = buildCutsheetBundle({ cadModel: model(), catalog: CATALOG });
    expect(b.disclaimer).toMatch(/NOT AHJ-approved, NOT PE-stamped/);
    expect(b.disclaimer).toMatch(/NOT a project-specified product schedule/);
  });
});
