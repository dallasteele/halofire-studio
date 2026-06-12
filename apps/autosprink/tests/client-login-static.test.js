import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('client secure login page', () => {
  it('uses the official Halo Fire logo as the animated hero image', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('/public/brand/halo-fire-logo-glass.png');
    expect(html).toContain('halo-three-canvas');
    expect(html).toContain('initHaloHeroScene');
    expect(html).toContain('alt="Halo Fire"');
    expect(html).not.toContain('/public/brand/halo-fire-hero-flame.png');
  });

  it('detects WebGPU while guaranteeing a Three.js WebGL render path', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain("from 'three'");
    expect(html).toContain("from 'three/webgpu'");
    expect(html).toContain('navigator.gpu.requestAdapter');
    expect(html).toContain("rendererMode = 'webgpu'");
    expect(html).toContain("rendererMode = 'webgpu-failed-webgl'");
    expect(html).toContain('new WebGLRenderer');
    expect(html).toContain('new WebGPURenderer');
    expect(html).toContain('data-renderer-mode');
  });

  it('renders an interactive 3D flame with an animated halo', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('ExtrudeGeometry');
    expect(html).toContain('createLogoFlameShape');
    expect(html).toContain('prepareDeformableMesh');
    expect(html).toContain('deformMeshVertices');
    expect(html).toContain('buildGlowTexture');
    expect(html).toContain('TorusGeometry');
    expect(html).toContain('flameRoot');
    expect(html).toContain('pointerdown');
    expect(html).toContain('pointerup');
    expect(html).toContain('dragState');
    expect(html).toContain('event.preventDefault()');
    expect(html).toContain('clickPulse');
    expect(html).toContain("canvas.dataset.interaction = 'dragging'");
    expect(html).toContain('draggable="false"');
    expect(html).not.toContain('new PlaneGeometry');
    expect(html).not.toContain('flameSprites');
    expect(html).not.toContain('haloGlow');
    expect(html).not.toContain('flameRoot.rotation.y');
    expect(html).not.toContain('flameRoot.rotation.x');
    expect(html).not.toContain('Three.js scene</div>');
  });

  it('ships the enhanced transparent logo derived from the official mark', () => {
    const enhancedLogo = path.join(ROOT, 'public', 'brand', 'halo-fire-logo-glass.png');

    expect(fs.existsSync(enhancedLogo)).toBe(true);
    expect(fs.statSync(enhancedLogo).size).toBeGreaterThan(50_000);
  });

  it('uses Apple-glass material treatment instead of flat controls', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('backdrop-filter:blur(36px) saturate(1.45)');
    expect(html).toContain('grid-template-columns:minmax(560px,1.618fr)');
    expect(html).toContain('.submit-btn:hover');
    expect(html).toContain('.submit-btn:focus-visible');
    expect(html).toContain('.field input:focus');
    expect(html).toContain('inset 0 1px 0 rgba(255,255,255,0.42)');
  });

  it('keeps the public access page clean and avoids fake dashboard data', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('Secure client access');
    expect(html).toContain('Secure Portal');
    expect(html).toContain('Sign in to continue.');
    expect(html).not.toContain('Bids Tracked');
    expect(html).not.toContain('Pricebook Items');
    expect(html).not.toContain('QWEN: STANDBY');
    expect(html).not.toContain('View Demo');
    expect(html).not.toContain('Add what only Halo Fire knows');
    expect(html).not.toContain('Animated glass treatment only');
    expect(html).not.toContain('internal alpha');
    expect(html).not.toContain('Invite-only');
    expect(html).not.toContain('invited reviewers');
    expect(html).not.toContain('No permit');
    expect(html).not.toContain('AHJ');
    expect(html).not.toContain('co-development');
    expect(html).not.toContain('web scraping');
  });

  it('does not expose development credentials or auto-login on the client page', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).not.toContain('halofire-dev-smoke');
    expect(html).not.toContain("u.value='admin'");
    expect(html).not.toContain('haloDemoLoginBootstrap');
    expect(html).not.toContain('XMLHttpRequest');
  });
});
