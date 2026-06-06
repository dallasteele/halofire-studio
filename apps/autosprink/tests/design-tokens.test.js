import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Contrast gate for the PLATFORM SHELL design system. The deployed autosprink
// pages (index/app/settings) are restyled onto the shared HaloFire token set in
// public/styles/halofire-tokens.css. This test keeps that token set honest the
// same way the studio's test/tokens.test.ts does: every primary text-on-surface
// pairing the shell actually renders must clear its WCAG-AAA threshold. If a
// color regresses below threshold, fix the COLOR in the CSS — never the
// assertion.

const ROOT = path.resolve(import.meta.dirname, '..');
const TOKENS_CSS = path.join(ROOT, 'public', 'styles', 'halofire-tokens.css');

/* --------------------------------------------------------- WCAG contrast */
// Ported verbatim from apps/studio/src/lib/tokens.ts (relativeLuminance /
// contrastRatio). Kept independent so this gate has no cross-app import.

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function parseHex(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
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

function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ------------------------------------------- extract token hex values */

function readTokenColors() {
  const css = fs.readFileSync(TOKENS_CSS, 'utf8');
  const colors = {};
  const re = /--hf-color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    colors[m[1]] = m[2];
  }
  return colors;
}

const AAA_BODY = 7;
const AAA_LARGE = 4.5;

describe('platform-shell design tokens — WCAG-AAA contrast gate', () => {
  const colors = readTokenColors();

  it('parses the shared token palette from public/styles/halofire-tokens.css', () => {
    // Sanity: the bridge depends on these tokens existing.
    for (const key of [
      'bg', 'surface', 'surface-raised', 'surface-hover',
      'text-primary', 'text-secondary', 'text-muted',
      'accent', 'accent-text', 'interactive-text',
      'success', 'warn', 'danger', 'on-accent', 'interactive-active',
    ]) {
      expect(colors[key], `token --hf-color-${key} missing`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('verifies contrastRatio against WCAG reference values', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  // Every body/secondary text-on-surface pairing the shell renders. Mirrors the
  // studio TEXT_ON_SURFACE_PAIRINGS for the colors this shell actually uses.
  const pairings = [
    // Primary body text on each surface layer — AAA body (>=7:1).
    ['primary on bg', 'text-primary', 'bg', AAA_BODY],
    ['primary on surface', 'text-primary', 'surface', AAA_BODY],
    ['primary on surfaceRaised', 'text-primary', 'surface-raised', AAA_BODY],
    ['primary on surfaceHover', 'text-primary', 'surface-hover', AAA_BODY],
    // Secondary (legacy --text) — used at body size, AAA body.
    ['secondary on bg', 'text-secondary', 'bg', AAA_BODY],
    ['secondary on surface', 'text-secondary', 'surface', AAA_BODY],
    ['secondary on surfaceRaised', 'text-secondary', 'surface-raised', AAA_BODY],
    // Muted metadata (legacy --muted/--text-muted) — AAA body on every layer.
    ['muted on bg', 'text-muted', 'bg', AAA_BODY],
    ['muted on surface', 'text-muted', 'surface', AAA_BODY],
    ['muted on surfaceRaised', 'text-muted', 'surface-raised', AAA_BODY],
    // Ember accent text (hero eyebrow, gate banner, code) — AAA body.
    ['accentText on bg', 'accent-text', 'bg', AAA_BODY],
    ['accentText on surface', 'accent-text', 'surface', AAA_BODY],
    ['accent on bg', 'accent', 'bg', AAA_BODY],
    ['accent on surface', 'accent', 'surface', AAA_BODY],
    // Interactive blue links — large/secondary tier (>=4.5:1).
    ['interactiveText on bg', 'interactive-text', 'bg', AAA_LARGE],
    ['interactiveText on surface', 'interactive-text', 'surface', AAA_LARGE],
    ['interactiveText on surfaceRaised', 'interactive-text', 'surface-raised', AAA_LARGE],
    // Semantic status-pill text — large/secondary tier (>=4.5:1).
    ['success on surface', 'success', 'surface', AAA_LARGE],
    ['success on surfaceRaised', 'success', 'surface-raised', AAA_LARGE],
    ['warn on surface', 'warn', 'surface', AAA_LARGE],
    ['danger on surface', 'danger', 'surface', AAA_LARGE],
    ['danger on surfaceRaised', 'danger', 'surface-raised', AAA_LARGE],
    // Dark ink on the filled ember CTA (sign-in/submit/hero) — large tier.
    ['onAccent on accent', 'on-accent', 'accent', AAA_LARGE],
    // White on the filled active interactive blue — body tier.
    ['white on interactiveActive', null, 'interactive-active', AAA_BODY, '#ffffff'],
  ];

  for (const [name, fgKey, bgKey, min, literalFg] of pairings) {
    it(`${name} clears AAA (>=${min}:1)`, () => {
      const fg = literalFg ?? colors[fgKey];
      const bg = colors[bgKey];
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `${name}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
    });
  }
});
