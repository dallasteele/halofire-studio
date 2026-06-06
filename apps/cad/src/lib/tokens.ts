// HaloFire CAD — design tokens. EXTENDS the studio token system; it does NOT
// fork a new color system. The base palette, type scale, spacing, radii,
// elevation, motion, focus ring, and the WCAG `contrastRatio` gate all come
// from the studio source of truth and are re-exported unchanged.
//
// What is ADDED here: a small set of CAD-surface tokens (the drawing canvas
// background, the plan grid lines, a selection accent, the ribbon fill, and the
// working-panel fill) plus a 3D-viewport ground/grid pair. Every ADDED text-on-
// surface pairing is held to the same WCAG-AAA thresholds via
// CAD_TEXT_ON_SURFACE_PAIRINGS, which the test-suite checks with the SAME
// `contrastRatio` gate the studio uses.
//
// AAA RULE (enforced by test/tokens.test.ts): if an added color fails its
// threshold, the test is the gate — the color is tuned, never the assertion.

import {
  AAA_BODY,
  AAA_LARGE,
  colors as baseColors,
  type ColorPalette,
  type TextSurfacePairing,
} from '../../../studio/src/lib/tokens';

// Re-export the entire studio token surface so CAD components import everything
// from one place (`./lib/tokens`) without reaching across apps.
export {
  AAA_BODY,
  AAA_LARGE,
  contrastRatio,
  cssVariables,
  cssVariablesBlock,
  elevation,
  focusRing,
  fonts,
  motion,
  radii,
  relativeLuminance,
  spacing,
  SPACING_ORDER,
  TEXT_ON_SURFACE_PAIRINGS,
  typeScale,
  TYPE_SCALE_ORDER,
  type ColorPalette,
  type SpacingKey,
  type TextSurfacePairing,
  type TypeScaleKey,
  type TypeStep,
} from '../../../studio/src/lib/tokens';

/* ---------------------------------------------------- CAD surface palette */

export interface CadSurfacePalette {
  /** The drawing canvas backdrop — distinct, slightly cooler than the app bg so
   *  the plan area reads as "the paper". Darker than any panel. */
  canvasBg: string;
  /** Minor plan grid line (every 1 ft). Subtle. */
  gridMinor: string;
  /** Major plan grid line (every 5 ft) — a touch brighter for orientation. */
  gridMajor: string;
  /** Selection accent — the highlight ring/stroke for the active node/room. */
  selection: string;
  /** Ribbon (top tab bar) fill. */
  ribbon: string;
  /** Working side-panel fill (left tools / right inspector body). */
  panel: string;
  /** 3D viewport ground plane fill. */
  ground3d: string;
  /** 3D viewport grid line color. */
  grid3d: string;
}

/**
 * CAD-only surface colors. The canvas/ribbon/panel fills sit in the SAME tonal
 * family as the studio palette (deep charcoal/navy), so the two apps feel like
 * one product. `selection` reuses the studio interactive blue's brighter text
 * variant so a selection stroke clears AAA-large on the canvas. Grid lines are
 * intentionally low-contrast (they are decoration, not text — no AAA claim on
 * grid-vs-canvas; only text pairings are gated below).
 */
export const cadSurfaces: CadSurfacePalette = {
  canvasBg: '#0b1016',
  gridMinor: '#1a2230',
  gridMajor: '#283242',
  selection: '#7fb4ff',
  ribbon: '#161c25',
  panel: '#11161d',
  ground3d: '#10151c',
  grid3d: '#222c39',
};

/**
 * Combined palette consumed by CAD components: every studio color PLUS the CAD
 * surfaces. Components read `colors.canvasBg`, `colors.textPrimary`, etc. from
 * this one object.
 */
export const colors: ColorPalette & CadSurfacePalette = {
  ...baseColors,
  ...cadSurfaces,
};

/* ----------------------------------------------- CAD AAA pairing gate (tests) */

/**
 * Text-on-surface pairings introduced by the CAD surfaces. The test-suite
 * asserts each meets its AAA threshold with the studio `contrastRatio`. Grid
 * colors are NOT here — they are non-text decoration. Only real text-bearing
 * CAD surfaces (canvas, ribbon, panel, 3D ground) are gated.
 */
export const CAD_TEXT_ON_SURFACE_PAIRINGS: readonly TextSurfacePairing[] = [
  // Empty-state / overlay text drawn directly on the drawing canvas.
  { name: 'primary on canvasBg', fg: baseColors.textPrimary, bg: cadSurfaces.canvasBg, min: AAA_BODY },
  { name: 'secondary on canvasBg', fg: baseColors.textSecondary, bg: cadSurfaces.canvasBg, min: AAA_BODY },
  { name: 'muted on canvasBg', fg: baseColors.textMuted, bg: cadSurfaces.canvasBg, min: AAA_BODY },
  { name: 'accentText on canvasBg', fg: baseColors.accentText, bg: cadSurfaces.canvasBg, min: AAA_BODY },
  // Ribbon labels.
  { name: 'primary on ribbon', fg: baseColors.textPrimary, bg: cadSurfaces.ribbon, min: AAA_BODY },
  { name: 'secondary on ribbon', fg: baseColors.textSecondary, bg: cadSurfaces.ribbon, min: AAA_BODY },
  { name: 'muted on ribbon', fg: baseColors.textMuted, bg: cadSurfaces.ribbon, min: AAA_BODY },
  // Side-panel text (tools list, inspector).
  { name: 'primary on panel', fg: baseColors.textPrimary, bg: cadSurfaces.panel, min: AAA_BODY },
  { name: 'secondary on panel', fg: baseColors.textSecondary, bg: cadSurfaces.panel, min: AAA_BODY },
  { name: 'muted on panel', fg: baseColors.textMuted, bg: cadSurfaces.panel, min: AAA_BODY },
  // 3D viewport overlay text on the ground fill.
  { name: 'primary on ground3d', fg: baseColors.textPrimary, bg: cadSurfaces.ground3d, min: AAA_BODY },
  { name: 'muted on ground3d', fg: baseColors.textMuted, bg: cadSurfaces.ground3d, min: AAA_BODY },
  // Selection stroke needs to read against the canvas — large/secondary tier.
  { name: 'selection on canvasBg', fg: cadSurfaces.selection, bg: cadSurfaces.canvasBg, min: AAA_LARGE },
] as const;
