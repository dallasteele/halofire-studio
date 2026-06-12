import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('client secure login page', () => {
  it('uses the official Halo Fire logo as the animated hero image', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('/public/brand/halo-fire-logo-glass.png');
    expect(html).toContain('halo-logo-hero');
    expect(html).toContain('@keyframes logoFloat');
    expect(html).toContain('alt="Halo Fire"');
  });

  it('ships the enhanced transparent logo derived from the official mark', () => {
    const enhancedLogo = path.join(ROOT, 'public', 'brand', 'halo-fire-logo-glass.png');

    expect(fs.existsSync(enhancedLogo)).toBe(true);
    expect(fs.statSync(enhancedLogo).size).toBeGreaterThan(50_000);
  });

  it('keeps the public access page clean and avoids fake dashboard data', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('Secure client access');
    expect(html).toContain('Project materials shown after sign-in only');
    expect(html).not.toContain('Bids Tracked');
    expect(html).not.toContain('Pricebook Items');
    expect(html).not.toContain('QWEN: STANDBY');
    expect(html).not.toContain('View Demo');
  });

  it('does not expose development credentials or auto-login on the client page', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).not.toContain('halofire-dev-smoke');
    expect(html).not.toContain("u.value='admin'");
    expect(html).not.toContain('haloDemoLoginBootstrap');
    expect(html).not.toContain('XMLHttpRequest');
  });
});
