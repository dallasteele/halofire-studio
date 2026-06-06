// CAD token gate: the CAD-surface additions must clear WCAG-AAA with the SAME
// contrastRatio gate the studio uses, and the combined palette must still expose
// the base studio colors (extension, not fork).

import { describe, expect, it } from 'vitest';
import {
  CAD_TEXT_ON_SURFACE_PAIRINGS,
  cadSurfaces,
  colors,
  contrastRatio,
} from '../src/lib/tokens';

describe('CAD AAA pairing gate', () => {
  for (const pair of CAD_TEXT_ON_SURFACE_PAIRINGS) {
    it(`${pair.name} clears ${pair.min}:1`, () => {
      const ratio = contrastRatio(pair.fg, pair.bg);
      expect(ratio).toBeGreaterThanOrEqual(pair.min);
    });
  }
});

describe('combined palette extends (not forks) the studio system', () => {
  it('still exposes base studio text colors', () => {
    expect(colors.textPrimary).toBeTruthy();
    expect(colors.textSecondary).toBeTruthy();
    expect(colors.accent).toBeTruthy();
    expect(colors.interactive).toBeTruthy();
  });

  it('adds the CAD-surface tokens', () => {
    expect(colors.canvasBg).toBe(cadSurfaces.canvasBg);
    expect(colors.gridMinor).toBeTruthy();
    expect(colors.gridMajor).toBeTruthy();
    expect(colors.selection).toBeTruthy();
    expect(colors.ribbon).toBeTruthy();
    expect(colors.panel).toBeTruthy();
    expect(colors.ground3d).toBeTruthy();
    expect(colors.grid3d).toBeTruthy();
  });
});
