// AAA design-token gate. These tests are the contract: if a chosen color fails
// its WCAG threshold, the test fails and the COLOR must be tuned — never the
// assertion. They also lock the modular type scale and spacing scale shapes.

import { describe, expect, it } from 'vitest';
import {
  AAA_BODY,
  AAA_LARGE,
  SPACING_ORDER,
  TEXT_ON_SURFACE_PAIRINGS,
  TYPE_SCALE_ORDER,
  contrastRatio,
  cssVariables,
  relativeLuminance,
  spacing,
  typeScale,
} from '../src/lib/tokens';

describe('contrastRatio (WCAG 2.1)', () => {
  it('returns ~21 for white on black (max contrast)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });

  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#3b82f6', '#3b82f6')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#0e1318', '#f0f4f8')).toBeCloseTo(
      contrastRatio('#f0f4f8', '#0e1318'),
      6,
    );
  });

  it('matches known reference pairs', () => {
    // #777777 on white is a well-known ~4.48:1 boundary pair.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    // Pure mid-grey on black.
    expect(contrastRatio('#808080', '#000000')).toBeGreaterThan(5);
  });

  it('accepts 3-digit hex shorthand', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
  });

  it('throws on malformed hex', () => {
    expect(() => contrastRatio('not-a-color', '#000000')).toThrow();
  });

  it('relativeLuminance is 0 for black and ~1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('AAA text-on-surface pairings (the gate)', () => {
  it('declares at least one body and one large pairing', () => {
    expect(TEXT_ON_SURFACE_PAIRINGS.some((p) => p.min === AAA_BODY)).toBe(true);
    expect(TEXT_ON_SURFACE_PAIRINGS.some((p) => p.min === AAA_LARGE)).toBe(true);
  });

  it.each(TEXT_ON_SURFACE_PAIRINGS.map((p) => [p.name, p] as const))(
    'pairing "%s" meets its AAA threshold',
    (_name, pairing) => {
      const ratio = contrastRatio(pairing.fg, pairing.bg);
      // Surface-level diagnostic so a regression prints the actual ratio.
      expect(
        ratio,
        `${pairing.name}: ${ratio.toFixed(2)}:1 < required ${pairing.min}:1`,
      ).toBeGreaterThanOrEqual(pairing.min);
    },
  );

  it('every body pairing clears 7:1 and every large pairing clears 4.5:1', () => {
    for (const p of TEXT_ON_SURFACE_PAIRINGS) {
      const ratio = contrastRatio(p.fg, p.bg);
      if (p.min === AAA_BODY) {
        expect(ratio).toBeGreaterThanOrEqual(7);
      } else {
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('modular type scale', () => {
  it('is strictly increasing in pixel size', () => {
    const sizesPx = TYPE_SCALE_ORDER.map((k) => remToPx(typeScale[k].size));
    for (let i = 1; i < sizesPx.length; i++) {
      expect(sizesPx[i]).toBeGreaterThan(sizesPx[i - 1]);
    }
  });

  it('uses a ~1.25 ratio between adjacent steps (within tolerance)', () => {
    const sizesPx = TYPE_SCALE_ORDER.map((k) => remToPx(typeScale[k].size));
    // Check the upper steps where the pure modular ratio applies.
    for (let i = TYPE_SCALE_ORDER.indexOf('lg'); i < sizesPx.length; i++) {
      const ratio = sizesPx[i] / sizesPx[i - 1];
      expect(ratio).toBeGreaterThan(1.15);
      expect(ratio).toBeLessThan(1.35);
    }
  });

  it('every step has a positive line-height and a sane weight', () => {
    for (const k of TYPE_SCALE_ORDER) {
      expect(typeScale[k].lineHeight).toBeGreaterThan(1);
      expect(typeScale[k].weight).toBeGreaterThanOrEqual(400);
      expect(typeScale[k].weight).toBeLessThanOrEqual(900);
    }
  });
});

describe('spacing scale', () => {
  it('is positive and strictly ascending', () => {
    const px = SPACING_ORDER.map((k) => cssLenToPx(spacing[k]));
    for (const v of px) {
      expect(v).toBeGreaterThan(0);
    }
    for (let i = 1; i < px.length; i++) {
      expect(px[i]).toBeGreaterThan(px[i - 1]);
    }
  });

  it('the 4px scale lands on multiples of 4 (above the sub-pixel steps)', () => {
    for (const k of SPACING_ORDER) {
      const v = cssLenToPx(spacing[k]);
      if (v >= 4) {
        expect(v % 4).toBe(0);
      }
    }
  });
});

describe('cssVariables emit', () => {
  it('emits prefixed --hf- custom properties for colors, type, spacing', () => {
    const vars = cssVariables();
    expect(vars['--hf-color-bg']).toBe('#0e1318');
    expect(vars['--hf-color-accent']).toBe('#f0a868');
    expect(vars['--hf-font-size-base']).toBe('1rem');
    expect(vars['--hf-space-4']).toBe('1rem');
    expect(vars['--hf-focus-color']).toBeDefined();
    // Every key is a valid CSS custom-property name.
    for (const key of Object.keys(vars)) {
      expect(key.startsWith('--hf-')).toBe(true);
    }
  });
});

/* ----------------------------------------------------------- helpers */

function remToPx(rem: string): number {
  return parseFloat(rem) * 16;
}

function cssLenToPx(len: string): number {
  if (len.endsWith('rem')) return parseFloat(len) * 16;
  if (len.endsWith('px')) return parseFloat(len);
  return parseFloat(len);
}
