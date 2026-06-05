// HaloFire Studio — PURE design tokens (no React / three / DOM imports).
//
// This module is the single source of truth for the design system: a typed
// palette, a modular type scale, a 4px spacing scale, radii, elevation, motion,
// and a focus-ring token. It also exports `contrastRatio` (WCAG 2.1 relative
// luminance) and a `TEXT_ON_SURFACE_PAIRINGS` list that the test-suite uses as
// the AAA gate.
//
// BRAND: fire-protection. Deep charcoal/navy base, a warm ember-amber accent
// (#f0a868 family), and a clear interactive blue. Calm, professional — an
// engineering CAD tool, not flashy.
//
// AAA RULE (enforced by test/tokens.test.ts): every body text-on-surface
// pairing >= 7:1; every large/secondary pairing >= 4.5:1. If a color fails,
// the test is the gate — the color is tuned, not the assertion.

/* ------------------------------------------------------------------ colors */

export interface ColorPalette {
  /** Page backdrop — the darkest layer. */
  bg: string;
  /** Subtle alternate backdrop for the canvas / large empty regions. */
  bgInset: string;
  /** Default panel / surface fill (header, sidebars). */
  surface: string;
  /** Raised surface (rows, inputs, chips on a surface). */
  surfaceRaised: string;
  /** Hover/active surface tint. */
  surfaceHover: string;
  /** Hairline borders / dividers. */
  border: string;
  /** Stronger border for focused / selected containers. */
  borderStrong: string;
  /** Primary body text. */
  textPrimary: string;
  /** Secondary text (labels, captions). */
  textSecondary: string;
  /** Muted text (hints, disabled-ish metadata). */
  textMuted: string;
  /** Ember-amber accent — brand warmth, provenance caution. */
  accent: string;
  /** Lighter ember tint for text-on-dark accent usage. */
  accentText: string;
  /** Interactive blue (links, selected, primary control). */
  interactive: string;
  /** Brighter interactive blue for text/icon on dark surfaces. */
  interactiveText: string;
  /** Darker interactive blue for a FILLED active/selected control (white label clears AAA 7:1). */
  interactiveActive: string;
  /** Semantic success. */
  success: string;
  /** Semantic warning. */
  warn: string;
  /** Semantic danger. */
  danger: string;
  /** Dark ink used as foreground on bright chips/badges. */
  onAccent: string;
}

/**
 * The palette. Dark-charcoal/navy base with the ember-amber accent family and a
 * clear interactive blue. Every text color here clears 7:1 against bg, surface,
 * and surfaceRaised (verified in tests).
 */
export const colors: ColorPalette = {
  bg: '#0e1318',
  bgInset: '#11161d',
  surface: '#161c25',
  surfaceRaised: '#1d2530',
  surfaceHover: '#232c39',
  border: '#2a323d',
  borderStrong: '#3a4654',
  textPrimary: '#f0f4f8',
  textSecondary: '#c4cdd8',
  textMuted: '#b8c1cb',
  accent: '#f0a868',
  accentText: '#f4b87f',
  interactive: '#3b82f6',
  interactiveText: '#7fb4ff',
  interactiveActive: '#1e40af',
  success: '#4ade80',
  warn: '#fbbf24',
  danger: '#fca5a5',
  onAccent: '#0e1318',
};

/* -------------------------------------------------------------- type scale */

export interface TypeStep {
  /** Font size in rem. */
  size: string;
  /** Unitless line-height. */
  lineHeight: number;
  /** Font weight. */
  weight: number;
}

/**
 * Modular type scale, ratio ~1.25 (major third), 1rem = 16px base.
 *   xs   12px   sm 14px   base 16px   lg 20px   xl 25px   2xl 31px   3xl 39px
 * Smaller sizes get tighter ratios via slightly higher weights for legibility.
 */
export const typeScale = {
  xs: { size: '0.75rem', lineHeight: 1.5, weight: 500 },
  sm: { size: '0.875rem', lineHeight: 1.5, weight: 400 },
  base: { size: '1rem', lineHeight: 1.6, weight: 400 },
  lg: { size: '1.25rem', lineHeight: 1.45, weight: 500 },
  xl: { size: '1.5625rem', lineHeight: 1.3, weight: 600 },
  '2xl': { size: '1.953125rem', lineHeight: 1.2, weight: 600 },
  '3xl': { size: '2.44140625rem', lineHeight: 1.15, weight: 700 },
} satisfies Record<string, TypeStep>;

export type TypeScaleKey = keyof typeof typeScale;

/** Ascending order of the type scale keys (used by tests for monotonicity). */
export const TYPE_SCALE_ORDER: readonly TypeScaleKey[] = [
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
] as const;

/** Font stacks. Inter for UI, JetBrains Mono for technical keys/SKUs/numbers. */
export const fonts = {
  ui: "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, 'Cascadia Code', monospace",
} as const;

/* ----------------------------------------------------------------- spacing */

/** 4px-based spacing scale (rem-valued). Positive and strictly ascending. */
export const spacing = {
  px: '1px',
  0.5: '0.125rem', // 2px
  1: '0.25rem', // 4px
  2: '0.5rem', // 8px
  3: '0.75rem', // 12px
  4: '1rem', // 16px
  5: '1.25rem', // 20px
  6: '1.5rem', // 24px
  8: '2rem', // 32px
  10: '2.5rem', // 40px
  12: '3rem', // 48px
} as const;

export type SpacingKey = keyof typeof spacing;

/** Ascending spacing keys (tests assert strictly ascending pixel values). */
export const SPACING_ORDER: readonly SpacingKey[] = [
  'px',
  0.5,
  1,
  2,
  3,
  4,
  5,
  6,
  8,
  10,
  12,
] as const;

/* ------------------------------------------------------------------ radii */

export const radii = {
  none: '0',
  sm: '4px',
  md: '6px',
  lg: '10px',
  xl: '14px',
  pill: '999px',
} as const;

/* -------------------------------------------------------------- elevation */

export const elevation = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.4)',
  md: '0 4px 12px rgba(0, 0, 0, 0.45)',
  lg: '0 12px 32px rgba(0, 0, 0, 0.55)',
} as const;

/* ----------------------------------------------------------------- motion */

export const motion = {
  duration: {
    instant: '80ms',
    fast: '140ms',
    base: '220ms',
    slow: '360ms',
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
    decelerate: 'cubic-bezier(0, 0, 0, 1)',
  },
} as const;

/* ------------------------------------------------------------- focus ring */

/**
 * Focus-ring token: a 2px interactive-blue outline with a 2px offset gap, so it
 * reads clearly against both dark surfaces and the accent. Used by the global
 * :focus-visible rule.
 */
export const focusRing = {
  width: '2px',
  offset: '2px',
  color: colors.interactiveText,
  /** Composed CSS box-shadow form (ring + dark inner gap), for non-outline use. */
  shadow: `0 0 0 2px ${colors.bg}, 0 0 0 4px ${colors.interactiveText}`,
} as const;

/* -------------------------------------------------------- WCAG contrast */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Parse a #rrggbb (or #rgb) hex string into [r, g, b] 0..255. */
function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`contrastRatio: invalid hex color "${hex}"`);
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG 2.1 relative luminance of a hex color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/**
 * WCAG 2.1 contrast ratio between two hex colors, in [1, 21].
 * Order-independent. white/black returns ~21.
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ----------------------------------------------- AAA pairing gate (tests) */

/** AAA threshold tiers. */
export const AAA_BODY = 7;
export const AAA_LARGE = 4.5;

export interface TextSurfacePairing {
  /** Human description for test output. */
  name: string;
  /** Foreground text color (hex). */
  fg: string;
  /** Background surface color (hex). */
  bg: string;
  /** Required minimum ratio: body (7) or large/secondary (4.5). */
  min: number;
}

/**
 * Every body/secondary text-on-surface pairing actually used in the UI. The
 * test-suite asserts each one meets its AAA threshold. If a color regresses
 * below threshold, the test fails — fix the color, never the test.
 */
export const TEXT_ON_SURFACE_PAIRINGS: readonly TextSurfacePairing[] = [
  // Primary body text on each surface layer — AAA body (>=7:1).
  { name: 'primary on bg', fg: colors.textPrimary, bg: colors.bg, min: AAA_BODY },
  { name: 'primary on surface', fg: colors.textPrimary, bg: colors.surface, min: AAA_BODY },
  { name: 'primary on surfaceRaised', fg: colors.textPrimary, bg: colors.surfaceRaised, min: AAA_BODY },
  { name: 'primary on surfaceHover', fg: colors.textPrimary, bg: colors.surfaceHover, min: AAA_BODY },
  // Secondary text — used at body size too, held to AAA body (>=7:1).
  { name: 'secondary on bg', fg: colors.textSecondary, bg: colors.bg, min: AAA_BODY },
  { name: 'secondary on surface', fg: colors.textSecondary, bg: colors.surface, min: AAA_BODY },
  { name: 'secondary on surfaceRaised', fg: colors.textSecondary, bg: colors.surfaceRaised, min: AAA_BODY },
  { name: 'secondary on surfaceHover', fg: colors.textSecondary, bg: colors.surfaceHover, min: AAA_BODY },
  // Muted metadata (incl. catalog row keys) — held to AAA body on EVERY layer it
  // renders on, including the selected/hover row background (surfaceHover).
  { name: 'muted on bg', fg: colors.textMuted, bg: colors.bg, min: AAA_BODY },
  { name: 'muted on surface', fg: colors.textMuted, bg: colors.surface, min: AAA_BODY },
  { name: 'muted on surfaceRaised', fg: colors.textMuted, bg: colors.surfaceRaised, min: AAA_BODY },
  { name: 'muted on surfaceHover', fg: colors.textMuted, bg: colors.surfaceHover, min: AAA_BODY },
  // Accent ember text (disclaimer, warnings) — held to AAA body.
  { name: 'accentText on bg', fg: colors.accentText, bg: colors.bg, min: AAA_BODY },
  { name: 'accentText on surface', fg: colors.accentText, bg: colors.surface, min: AAA_BODY },
  { name: 'accent on bg', fg: colors.accent, bg: colors.bg, min: AAA_BODY },
  { name: 'accent on surface', fg: colors.accent, bg: colors.surface, min: AAA_BODY },
  // Interactive blue text on surfaces — large/secondary tier (>=4.5:1).
  { name: 'interactiveText on bg', fg: colors.interactiveText, bg: colors.bg, min: AAA_LARGE },
  { name: 'interactiveText on surface', fg: colors.interactiveText, bg: colors.surface, min: AAA_LARGE },
  { name: 'interactiveText on surfaceRaised', fg: colors.interactiveText, bg: colors.surfaceRaised, min: AAA_LARGE },
  // Semantic text colors on surfaces — large/secondary tier (>=4.5:1).
  { name: 'success on surface', fg: colors.success, bg: colors.surface, min: AAA_LARGE },
  { name: 'success on surfaceRaised', fg: colors.success, bg: colors.surfaceRaised, min: AAA_LARGE },
  { name: 'warn on surface', fg: colors.warn, bg: colors.surface, min: AAA_LARGE },
  { name: 'danger on surface', fg: colors.danger, bg: colors.surface, min: AAA_LARGE },
  { name: 'danger on surfaceRaised', fg: colors.danger, bg: colors.surfaceRaised, min: AAA_LARGE },
  // Dark ink on the bright accent chip — large/secondary tier (>=4.5:1).
  { name: 'onAccent on accent', fg: colors.onAccent, bg: colors.accent, min: AAA_LARGE },
  { name: 'onAccent on success', fg: colors.onAccent, bg: colors.success, min: AAA_LARGE },
  // Active Plan/3D segmented-control label: white on the filled active blue.
  // It is body-size (14px), so held to AAA body (>=7:1).
  { name: 'white on interactiveActive', fg: '#ffffff', bg: colors.interactiveActive, min: AAA_BODY },
] as const;

/* --------------------------------------------- CSS custom property emit */

/**
 * Emit the full token set as a flat record of CSS custom properties
 * (`--hf-...`), suitable for writing into a :root block. PURE: returns a plain
 * object, performs no DOM mutation.
 */
export function cssVariables(): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [name, value] of Object.entries(colors)) {
    vars[`--hf-color-${kebab(name)}`] = value;
  }

  for (const key of TYPE_SCALE_ORDER) {
    const step = typeScale[key];
    vars[`--hf-font-size-${key}`] = step.size;
    vars[`--hf-line-height-${key}`] = String(step.lineHeight);
    vars[`--hf-font-weight-${key}`] = String(step.weight);
  }
  vars['--hf-font-ui'] = fonts.ui;
  vars['--hf-font-mono'] = fonts.mono;

  for (const [name, value] of Object.entries(spacing)) {
    vars[`--hf-space-${String(name).replace('.', '_')}`] = value;
  }
  for (const [name, value] of Object.entries(radii)) {
    vars[`--hf-radius-${name}`] = value;
  }
  for (const [name, value] of Object.entries(elevation)) {
    vars[`--hf-elevation-${name}`] = value;
  }
  for (const [name, value] of Object.entries(motion.duration)) {
    vars[`--hf-duration-${name}`] = value;
  }
  for (const [name, value] of Object.entries(motion.easing)) {
    vars[`--hf-easing-${name}`] = value;
  }

  vars['--hf-focus-width'] = focusRing.width;
  vars['--hf-focus-offset'] = focusRing.offset;
  vars['--hf-focus-color'] = focusRing.color;

  return vars;
}

/** Serialize cssVariables() into a `:root { ... }` CSS block. */
export function cssVariablesBlock(selector = ':root'): string {
  const vars = cssVariables();
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
