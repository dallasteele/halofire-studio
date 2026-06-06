import { describe, expect, it } from 'vitest';
import {
  CITED_NFPA_SECTIONS,
  HAZEN_WILLIAMS_C,
  HAZEN_WILLIAMS_COEFFICIENT,
  MAX_DISTANCE_TO_WALL_FT,
  MAX_PROTECTION_AREA_SQFT,
  MAX_SPACING_FT,
  MIN_HEAD_TO_HEAD_FT,
  NFPA13_DESIGN_AID_DISCLAIMER,
  RULES,
  RULE_CONSTANT_COUNT,
  UNCERTAIN_VALUES,
  flowFromKP,
  hazenWilliamsLossPsi,
  hazenWilliamsLossPsiPerFt,
  pressureFromKQ,
} from '../src/lib/nfpa13-rules';

describe('Q = K * sqrt(P) — discharge relation', () => {
  it('K8.0 at 25 psi -> 40 gpm exactly', () => {
    expect(flowFromKP(8.0, 25)).toBeCloseTo(40, 10);
  });

  it('K5.6 at 7 psi -> ~14.816 gpm', () => {
    expect(flowFromKP(5.6, 7)).toBeCloseTo(14.816207341961707, 9);
  });

  it('zero pressure -> zero flow', () => {
    expect(flowFromKP(5.6, 0)).toBe(0);
  });

  it('inverse: K8.0 needs 25 psi for 40 gpm', () => {
    expect(pressureFromKQ(8.0, 40)).toBeCloseTo(25, 10);
  });

  it('rejects negative pressure', () => {
    expect(() => flowFromKP(5.6, -1)).toThrow();
  });

  it('rejects non-positive K in inverse', () => {
    expect(() => pressureFromKQ(0, 40)).toThrow();
  });
});

describe('Hazen-Williams friction loss — matches hand-worked value', () => {
  // Q=100 gpm, C=120 (wet steel), d=1.049 in (1" sch40 actual ID), 1 ft:
  // Pm = 4.52 * 100^1.85 / (120^1.85 * 1.049^4.87) = 2.5555036... psi/ft
  it('1 ft of 1" sch40 wet steel at 100 gpm', () => {
    expect(hazenWilliamsLossPsiPerFt(100, 120, 1.049)).toBeCloseTo(
      2.5555036295847655,
      9,
    );
  });

  it('scales linearly with length', () => {
    const perFt = hazenWilliamsLossPsiPerFt(100, 120, 1.049);
    expect(hazenWilliamsLossPsi(100, 120, 1.049, 10)).toBeCloseTo(perFt * 10, 9);
  });

  it('higher C (smoother) -> lower loss', () => {
    const steel = hazenWilliamsLossPsiPerFt(100, 100, 1.049);
    const copper = hazenWilliamsLossPsiPerFt(100, 150, 1.049);
    expect(copper).toBeLessThan(steel);
  });

  it('rejects non-positive C and diameter', () => {
    expect(() => hazenWilliamsLossPsiPerFt(100, 0, 1.049)).toThrow();
    expect(() => hazenWilliamsLossPsiPerFt(100, 120, 0)).toThrow();
  });

  it('uses the published 4.52 coefficient', () => {
    expect(HAZEN_WILLIAMS_COEFFICIENT.value).toBe(4.52);
  });
});

describe('RULES table — every encoded constant is cited', () => {
  it('every rule carries a non-empty citation string', () => {
    expect(RULES.length).toBeGreaterThan(0);
    for (const r of RULES) {
      expect(typeof r.citation).toBe('string');
      expect(r.citation.trim().length).toBeGreaterThan(0);
      expect(r.id.trim().length).toBeGreaterThan(0);
      expect(r.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('every NON-NULL value is a finite positive number', () => {
    for (const r of RULES) {
      if (r.value !== null) {
        expect(Number.isFinite(r.value)).toBe(true);
        expect(r.value).toBeGreaterThan(0);
      }
    }
  });

  it('uncertain values are null with a TODO-cite (never fabricated)', () => {
    expect(UNCERTAIN_VALUES.length).toBeGreaterThan(0);
    for (const u of UNCERTAIN_VALUES) {
      expect(u.value).toBeNull();
      expect(u.citation.toLowerCase()).toContain('todo');
    }
  });

  it('RULE_CONSTANT_COUNT counts only the non-null encoded constants', () => {
    const nonNull = RULES.filter((r) => r.value !== null).length;
    expect(RULE_CONSTANT_COUNT).toBe(nonNull);
    expect(RULE_CONSTANT_COUNT).toBeGreaterThan(0);
  });
});

describe('hazard design values — known published numbers', () => {
  it('max protection area: light 225, ordinary 130, extra 100 ft^2', () => {
    expect(MAX_PROTECTION_AREA_SQFT.light.value).toBe(225);
    expect(MAX_PROTECTION_AREA_SQFT.ordinary_1.value).toBe(130);
    expect(MAX_PROTECTION_AREA_SQFT.ordinary_2.value).toBe(130);
    expect(MAX_PROTECTION_AREA_SQFT.extra_1.value).toBe(100);
    expect(MAX_PROTECTION_AREA_SQFT.extra_2.value).toBe(100);
  });

  it('max spacing: light/ordinary 15 ft, extra 12 ft', () => {
    expect(MAX_SPACING_FT.light.value).toBe(15);
    expect(MAX_SPACING_FT.ordinary_1.value).toBe(15);
    expect(MAX_SPACING_FT.extra_1.value).toBe(12);
  });

  it('distance to wall is one-half max spacing', () => {
    expect(MAX_DISTANCE_TO_WALL_FT.light.value).toBe(7.5);
    expect(MAX_DISTANCE_TO_WALL_FT.extra_1.value).toBe(6);
  });

  it('minimum head-to-head spacing is 6 ft', () => {
    expect(MIN_HEAD_TO_HEAD_FT.value).toBe(6);
  });

  it('Hazen-Williams C: steel-wet 120, copper 150, cpvc 150', () => {
    expect(HAZEN_WILLIAMS_C.steel_wet.value).toBe(120);
    expect(HAZEN_WILLIAMS_C.copper.value).toBe(150);
    expect(HAZEN_WILLIAMS_C.cpvc.value).toBe(150);
  });
});

describe('honesty surface', () => {
  it('disclaimer disclaims certification / AHJ / PE / construction', () => {
    const d = NFPA13_DESIGN_AID_DISCLAIMER.toLowerCase();
    expect(d).toContain('not a certified');
    expect(d).toContain('ahj');
    expect(d).toContain('pe-sealed');
    expect(d).toContain('not for construction');
  });

  it('cited sections list is non-empty and truthful (all strings)', () => {
    expect(CITED_NFPA_SECTIONS.length).toBeGreaterThan(0);
    for (const s of CITED_NFPA_SECTIONS) {
      expect(typeof s).toBe('string');
      expect(s.trim().length).toBeGreaterThan(0);
    }
  });
});
