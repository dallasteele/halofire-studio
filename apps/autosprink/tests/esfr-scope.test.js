import { describe, expect, it } from 'vitest';
import {
  HAZARD_RULES,
  getHazardRule,
  layoutRoom,
  routePiping,
  buildBillOfMaterials,
  buildEsfrSystemScope,
  ESFR_SCOPE_ASSUMPTIONS,
  ESFR_SEISMIC_BRACE_INTERVAL_FT,
} from '../src/engine/sprinkler-layout.js';
import { SEISMIC_BRACE_INTERVAL_FT } from '../src/engine/supports.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

describe('ESFR storage system class (T25)', () => {
  it('exposes public NFPA-13 ESFR storage protection limits', () => {
    const rule = getHazardRule('esfr');
    expect(rule.key).toBe('esfr');
    expect(rule.maxAreaSqFt).toBe(100);
    expect(rule.minSpacingFt).toBe(8);
    expect(rule.maxSpacingFt).toBe(12);
    expect(rule.storage).toBe(true);
    expect(rule.label).toBe('ESFR Storage');
  });

  it('keeps the existing hazard rules unchanged + still throws on unknown', () => {
    expect(HAZARD_RULES.light.maxAreaSqFt).toBe(225);
    expect(HAZARD_RULES.ordinary.maxAreaSqFt).toBe(130);
    expect(HAZARD_RULES.extra.maxSpacingFt).toBe(12);
    // ESFR is NOT mixed into the base standard-spray HAZARD_RULES map.
    expect(HAZARD_RULES.esfr).toBeUndefined();
    expect(() => getHazardRule('nonsense')).toThrow(/Unknown hazard/);
  });

  it('lays out an ESFR room with coverage <= 100 sqft/head', () => {
    const layout = layoutRoom({ name: 'WH', polygon: rect(60, 40), hazard: 'esfr' });
    // nx: ceil(60/12)=5 -> coverage 12*10=120 > 100 -> tighten to nx=6 (cov 100).
    expect(layout.gridCols).toBe(6);
    expect(layout.gridRows).toBe(4);
    expect(layout.heads).toHaveLength(24);
    expect(layout.spacingX).toBe(10);
    expect(layout.spacingY).toBe(10);
    expect(layout.coveragePerHeadSqFt).toBe(100);
    expect(layout.coveragePerHeadSqFt).toBeLessThanOrEqual(100);
  });
});

describe('buildEsfrSystemScope (T25)', () => {
  // A known ESFR layout to assert derivations (NOT magic numbers).
  const layout = layoutRoom({ name: 'WH', polygon: rect(60, 40), hazard: 'esfr' });
  const piping = routePiping(layout);
  const scope = buildEsfrSystemScope(layout, piping);
  const byKey = Object.fromEntries(scope.map((l) => [l.key, l]));

  it('documents the assumption defaults (frozen)', () => {
    expect(ESFR_SCOPE_ASSUMPTIONS.bulkMainFt).toBe(40);
    expect(ESFR_SCOPE_ASSUMPTIONS.undergroundFt).toBe(100);
    expect(Object.isFrozen(ESFR_SCOPE_ASSUMPTIONS)).toBe(true);
  });

  it('emits exactly the seven ESFR scope lines (T26 adds drop_armover + seismic_brace)', () => {
    expect(scope.map((l) => l.key).sort()).toEqual(
      [
        'bulk_main_pipe', 'cross_main_pipe', 'drop_armover', 'esfr_head',
        'feed_main_pipe', 'seismic_brace', 'underground_main',
      ].sort(),
    );
    for (const line of scope) {
      expect(line.scope).toBe('esfr');
      expect(typeof line.description).toBe('string');
    }
  });

  it('does NOT add an in-rack sprinkler line (real ESFR is ceiling-only)', () => {
    // In-rack would over-scope dishonestly — assert it is never emitted under any key.
    const keys = scope.map((l) => l.key);
    for (const k of keys) {
      expect(k).not.toMatch(/in.?rack/i);
    }
    expect(scope.some((l) => /in.?rack/i.test(l.description))).toBe(false);
  });

  it('esfr_head qty = head count, replaces the spray head line', () => {
    expect(byKey.esfr_head.unit).toBe('EA');
    expect(byKey.esfr_head.quantity).toBe(layout.heads.length); // 24
    expect(byKey.esfr_head.assumption).not.toBe(true);
  });

  it('cross_main qty = piping.crossMainFt, nominal 3"', () => {
    // ys at 5,15,25,35 -> (35-5)+10 = 40
    expect(piping.crossMainFt).toBe(40);
    expect(byKey.cross_main_pipe.unit).toBe('FT');
    expect(byKey.cross_main_pipe.quantity).toBe(40);
    expect(byKey.cross_main_pipe.nominalIn).toBe(3);
    expect(byKey.cross_main_pipe.assumption).not.toBe(true);
  });

  it('feed_main qty = long building dimension (derived from bbox), nominal 6"', () => {
    // round(max(width=60, height=40)) = 60
    expect(byKey.feed_main_pipe.quantity).toBe(60);
    expect(byKey.feed_main_pipe.nominalIn).toBe(6);
    expect(byKey.feed_main_pipe.assumption).not.toBe(true);
  });

  it('bulk_main is a documented riser-run assumption, nominal 6"', () => {
    expect(byKey.bulk_main_pipe.quantity).toBe(ESFR_SCOPE_ASSUMPTIONS.bulkMainFt); // 40
    expect(byKey.bulk_main_pipe.nominalIn).toBe(6);
    expect(byKey.bulk_main_pipe.assumption).toBe(true);
  });

  it('underground_main is a documented lead-in assumption, nominal 8"', () => {
    expect(byKey.underground_main.quantity).toBe(ESFR_SCOPE_ASSUMPTIONS.undergroundFt); // 100
    expect(byKey.underground_main.nominalIn).toBe(8);
    expect(byKey.underground_main.assumption).toBe(true);
  });

  it('drop_armover qty = head count (one drop/armover per ESFR ceiling head)', () => {
    expect(byKey.drop_armover.unit).toBe('EA');
    expect(byKey.drop_armover.quantity).toBe(layout.heads.length); // 24, 1:1 with heads
    expect(byKey.drop_armover.quantity).toBe(byKey.esfr_head.quantity);
    // A real omitted material, NOT a documented assumption — it is geometry-derived.
    expect(byKey.drop_armover.assumption).not.toBe(true);
  });

  it('seismic_brace qty = floor(totalMainFt / interval), flagged as an estimate', () => {
    // Geometry-derived from the routed mains: cross(40) + feed(60) + bulk(40) = 140.
    const crossMainFt = piping.crossMainFt; // 40
    const feedMainFt = 60; // round(max(width=60, height=40))
    const bulkMainFt = ESFR_SCOPE_ASSUMPTIONS.bulkMainFt; // 40
    const totalMainFt = crossMainFt + feedMainFt + bulkMainFt; // 140
    const expectedBraces = Math.floor(totalMainFt / ESFR_SEISMIC_BRACE_INTERVAL_FT); // floor(140/40)=3
    expect(crossMainFt).toBe(40);
    expect(ESFR_SEISMIC_BRACE_INTERVAL_FT).toBe(40);
    expect(byKey.seismic_brace.unit).toBe('EA');
    expect(byKey.seismic_brace.quantity).toBe(expectedBraces); // 3
    // Best-effort interval estimate -> assumption:true (mirrors supports.js note).
    expect(byKey.seismic_brace.assumption).toBe(true);
  });

  it('the seismic interval is the SAME public NFPA-13 interval supports.js uses', () => {
    expect(ESFR_SEISMIC_BRACE_INTERVAL_FT).toBe(SEISMIC_BRACE_INTERVAL_FT);
  });

  it('brace count tracks the routed main footage (more main -> >= braces)', () => {
    // Longer bulk main run -> longer total main -> at least as many braces.
    const more = buildEsfrSystemScope(layout, piping, { bulkMainFt: 400 });
    const moreByKey = Object.fromEntries(more.map((l) => [l.key, l]));
    expect(moreByKey.seismic_brace.quantity)
      .toBeGreaterThanOrEqual(byKey.seismic_brace.quantity);
    // cross(40)+feed(60)+bulk(400)=500 -> floor(500/40)=12.
    expect(moreByKey.seismic_brace.quantity).toBe(12);
  });

  it('honors overrides for the documented assumptions', () => {
    const s = buildEsfrSystemScope(layout, piping, { bulkMainFt: 55, undergroundFt: 130 });
    const m = Object.fromEntries(s.map((l) => [l.key, l]));
    expect(m.bulk_main_pipe.quantity).toBe(55);
    expect(m.underground_main.quantity).toBe(130);
  });
});

describe('non-ESFR path is unaffected (T25)', () => {
  it('ordinary-hazard layout + BOM keep the standard spray head line', () => {
    const layout = layoutRoom({ name: 'B', polygon: rect(30, 30), hazard: 'ordinary' });
    const piping = routePiping(layout);
    const bom = buildBillOfMaterials(layout, piping);
    const keys = bom.map((b) => b.key);
    expect(keys).toContain('sprinkler_head');
    expect(keys).not.toContain('esfr_head');
    expect(keys).not.toContain('cross_main_pipe');
    expect(keys).not.toContain('feed_main_pipe');
  });
});
