import { describe, expect, it } from 'vitest';
import {
  MODEL_STATUS_ORDER,
  badgeFor,
  deriveModelStatus,
  type ModelStatus,
} from '../src/lib/provenance';

describe('MODEL_STATUS_ORDER', () => {
  it('matches the canonical catalog 5-tier spine, low -> high', () => {
    expect(MODEL_STATUS_ORDER).toEqual([
      'visual_reference',
      'proxy',
      'dimensioned_parametric',
      'manufacturer_verified',
      'sealed_approved',
    ]);
  });

  it('is monotonic: each tier strictly more accurate than the previous', () => {
    // engineeringAccurate / dimensionVerified must be non-decreasing along the
    // order — accuracy never regresses as the index increases.
    let prevEng = 0;
    let prevDim = 0;
    for (const status of MODEL_STATUS_ORDER) {
      const b = badgeFor(status);
      const eng = b.engineeringAccurate ? 1 : 0;
      const dim = b.dimensionVerified ? 1 : 0;
      expect(eng).toBeGreaterThanOrEqual(prevEng);
      expect(dim).toBeGreaterThanOrEqual(prevDim);
      // dimension-verified is a prerequisite for engineering-accurate.
      expect(dim).toBeGreaterThanOrEqual(eng);
      prevEng = eng;
      prevDim = dim;
    }
  });

  it('has no duplicate tiers', () => {
    expect(new Set(MODEL_STATUS_ORDER).size).toBe(MODEL_STATUS_ORDER.length);
  });
});

describe('deriveModelStatus mapping', () => {
  it('maps OpenSCAD "generated" to visual_reference', () => {
    expect(deriveModelStatus({ source: 'generated' })).toBe('visual_reference');
    expect(deriveModelStatus({ source: 'generated', manufacturerExact: false })).toBe(
      'visual_reference',
    );
  });

  it('maps "ai-placeholder" to visual_reference', () => {
    expect(deriveModelStatus({ source: 'ai-placeholder' })).toBe('visual_reference');
  });

  it('maps "step.parts" to proxy', () => {
    expect(deriveModelStatus({ source: 'step.parts' })).toBe('proxy');
  });

  it('maps "build123d" to dimensioned_parametric', () => {
    expect(deriveModelStatus({ source: 'build123d' })).toBe('dimensioned_parametric');
  });

  it('maps "manufacturer-step" + manufacturerExact===true to manufacturer_verified', () => {
    expect(
      deriveModelStatus({ source: 'manufacturer-step', manufacturerExact: true }),
    ).toBe('manufacturer_verified');
  });

  it('does NOT upgrade manufacturer-step without manufacturerExact===true (fail-safe)', () => {
    expect(deriveModelStatus({ source: 'manufacturer-step' })).toBe('visual_reference');
    expect(
      deriveModelStatus({ source: 'manufacturer-step', manufacturerExact: false }),
    ).toBe('visual_reference');
    // A non-boolean truthy must not coerce an upgrade.
    expect(
      // @ts-expect-error intentionally malformed to prove no truthy coercion
      deriveModelStatus({ source: 'manufacturer-step', manufacturerExact: 'yes' }),
    ).toBe('visual_reference');
  });

  it('fails SAFE to visual_reference on unknown / missing / undefined source', () => {
    expect(deriveModelStatus({})).toBe('visual_reference');
    expect(deriveModelStatus({ source: 'unknown' })).toBe('visual_reference');
    expect(deriveModelStatus({ source: 'missing' })).toBe('visual_reference');
    expect(deriveModelStatus({ source: 'some-future-source' })).toBe('visual_reference');
    // Even with manufacturerExact:true, an unrecognized source is NOT upgraded.
    expect(
      deriveModelStatus({ source: 'totally-bogus', manufacturerExact: true }),
    ).toBe('visual_reference');
  });
});

describe('badgeFor covers all 5 tiers', () => {
  it('returns a distinct badge for every tier with self-consistent fields', () => {
    const colors = new Set<string>();
    const labels = new Set<string>();
    for (const status of MODEL_STATUS_ORDER) {
      const b = badgeFor(status);
      expect(b.modelStatus).toBe(status);
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      colors.add(b.color);
      labels.add(b.label);
    }
    // Distinct colors and labels per tier.
    expect(colors.size).toBe(MODEL_STATUS_ORDER.length);
    expect(labels.size).toBe(MODEL_STATUS_ORDER.length);
  });

  it('engineeringAccurate true ONLY for manufacturer_verified | sealed_approved', () => {
    expect(badgeFor('manufacturer_verified').engineeringAccurate).toBe(true);
    expect(badgeFor('sealed_approved').engineeringAccurate).toBe(true);
    expect(badgeFor('visual_reference').engineeringAccurate).toBe(false);
    expect(badgeFor('proxy').engineeringAccurate).toBe(false);
    expect(badgeFor('dimensioned_parametric').engineeringAccurate).toBe(false);
  });

  it('dimensionVerified true ONLY for dimensioned_parametric | manufacturer_verified | sealed_approved', () => {
    expect(badgeFor('dimensioned_parametric').dimensionVerified).toBe(true);
    expect(badgeFor('manufacturer_verified').dimensionVerified).toBe(true);
    expect(badgeFor('sealed_approved').dimensionVerified).toBe(true);
    expect(badgeFor('visual_reference').dimensionVerified).toBe(false);
    expect(badgeFor('proxy').dimensionVerified).toBe(false);
  });

  it('visual_reference badge label states plainly it is not dimensional', () => {
    const b = badgeFor('visual_reference');
    expect(b.label.toLowerCase()).toContain('visual reference');
    expect(b.label.toLowerCase()).toContain('not dimensional');
  });
});

describe('HARD INVARIANT — placeholder/generated/proxy are NEVER engineering-accurate', () => {
  it('no source that derives visual_reference or proxy can be engineeringAccurate', () => {
    const dishonestSources = [
      'generated',
      'ai-placeholder',
      'step.parts',
      'unknown',
      'missing',
      undefined,
    ];
    for (const source of dishonestSources) {
      // Even if manufacturerExact were (wrongly) set true, these never upgrade.
      const status = deriveModelStatus({ source, manufacturerExact: true });
      expect(status === 'visual_reference' || status === 'proxy').toBe(true);
      const badge = badgeFor(status);
      expect(badge.engineeringAccurate).toBe(false);
    }
  });

  it('visual_reference and proxy badges are always non-engineering-accurate and non-dimensional', () => {
    const notAccurate: ModelStatus[] = ['visual_reference', 'proxy'];
    for (const status of notAccurate) {
      const b = badgeFor(status);
      expect(b.engineeringAccurate).toBe(false);
      expect(b.dimensionVerified).toBe(false);
    }
  });
});
