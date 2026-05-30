import { describe, expect, it } from 'vitest';
import {
  HAZARD_RULES,
  getHazardRule,
  layoutRoom,
  routePiping,
  buildBillOfMaterials,
  buildEsfrSystemScope,
  ESFR_SCOPE_ASSUMPTIONS,
} from '../src/engine/sprinkler-layout.js';

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

  it('emits exactly the five ESFR scope lines', () => {
    expect(scope.map((l) => l.key).sort()).toEqual(
      ['bulk_main_pipe', 'cross_main_pipe', 'esfr_head', 'feed_main_pipe', 'underground_main'].sort(),
    );
    for (const line of scope) {
      expect(line.scope).toBe('esfr');
      expect(typeof line.description).toBe('string');
    }
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
