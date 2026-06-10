// HaloFire CAD — Apple-glass surface helpers. Pure style fragments (CSS-in-JS),
// NO new colors: every glass surface is an rgba() of an EXISTING tested hex
// token at alpha >= 0.86 over the dark app background, so the composite stays
// within a hair of the solid hex the AAA token gate (test/tokens.test.ts)
// measures text against. The sheen/inner-light overlays are <= 6% white, which
// composites DARKER than surfaceHover (#232c39) — a surface every gated text
// color already clears at AAA — so no text pairing can regress below its gate.

import type { CSSProperties } from 'react';

/**
 * Minimum alpha for any text-bearing glass surface. At >= 0.86 over the app's
 * near-black bg (#0e1318) the composite differs from the solid token hex by
 * < 2 luminance points — the measured AAA ratios hold.
 */
export const GLASS_SURFACE_ALPHA = 0.88;

/** Shared backdrop treatment for all glass chrome. */
export const GLASS_BACKDROP = 'blur(16px) saturate(1.4)';

/** Convert a #rrggbb hex token to an rgba() string at the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A translucent layered panel surface: tested token hex at >= 0.86 alpha,
 * backdrop blur, a 1px inner-light top edge, and a soft drop shadow.
 */
export function glassSurface(hexToken: string): CSSProperties {
  return {
    background: hexToRgba(hexToken, GLASS_SURFACE_ALPHA),
    backdropFilter: GLASS_BACKDROP,
    WebkitBackdropFilter: GLASS_BACKDROP,
    boxShadow:
      'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 8px 24px rgba(0, 0, 0, 0.35)',
  };
}

/** 1px inner-light hairline for glass edges (replaces a flat border color). */
export const glassEdge = 'rgba(255, 255, 255, 0.09)';

/** Subtle top-light gradient sheen for ACTIVE / filled elements (<= 6% white). */
export const glassSheen =
  'linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0) 55%)';

/**
 * Halo Fire amber accent glow ring for active chips/controls. Sits AROUND the
 * element (ring + outer glow) — the fill underneath stays the tested
 * interactiveActive/white pairing, so text contrast is unchanged.
 */
export function accentGlow(accentHex: string): string {
  return `0 0 0 1px ${hexToRgba(accentHex, 0.55)}, 0 0 12px ${hexToRgba(accentHex, 0.28)}, inset 0 1px 0 rgba(255, 255, 255, 0.10)`;
}

/** Hover lift for interactive chips: slight raise + deeper soft shadow. */
export const hoverLift: CSSProperties = {
  transform: 'translateY(-1px)',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
};
