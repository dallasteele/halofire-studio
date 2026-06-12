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

  it('uses a Three.js WebGL shader render path for the fire hero', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain("from 'three'");
    expect(html).toContain('<script type="importmap">');
    expect(html).toContain('"three": "/vendor/three/build/three.module.js"');
    expect(html).toContain('new WebGLRenderer');
    expect(html).toContain("rendererMode = 'webgl-shader-fire'");
    expect(html).toContain('ShaderMaterial');
    expect(html).toContain('fireFragmentShader');
    expect(html).toContain('mattatz/THREE.Fire');
    expect(html).not.toContain("from 'three/webgpu'");
    expect(html).not.toContain('new WebGPURenderer');
    expect(html).toContain('data-renderer-mode');
  });

  it('renders an interactive 3D flame with an animated halo', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('SphereGeometry');
    expect(html).toContain('createThreeFireMesh');
    expect(html).toContain('buildFireTexture');
    expect(html).toContain('invModelMatrix');
    expect(html).toContain('noiseScale');
    expect(html).toContain('fireTex');
    expect(html).toContain('buildGlowTexture');
    expect(html).toContain('buildSteamTexture');
    expect(html).toContain('TorusGeometry');
    expect(html).toContain('flameRoot');
    expect(html).toContain('pointerdown');
    expect(html).toContain('pointerup');
    expect(html).toContain('dragState');
    expect(html).toContain('event.preventDefault()');
    expect(html).toContain('clickPulse');
    expect(html).toContain('fabricGrabPoint');
    expect(html).toContain('fabricDrag');
    expect(html).toContain('fabricGrip');
    expect(html).toContain('waterDamp');
    expect(html).toContain('showerState');
    expect(html).toContain('waterDrops');
    expect(html).toContain('steamPuffs');
    expect(html).toContain('resetWaterDrop');
    expect(html).toContain('resetSteamPuff');
    expect(html).toContain('updateWaterAndSteam');
    expect(html).toContain('waterDropGeometry');
    expect(html).toContain('waterDropMaterial');
    expect(html).toContain('for(let i = 0; i < 144; i += 1)');
    expect(html).toContain('depthTest:false');
    expect(html).toContain('drop.scale.setScalar(scale)');
    expect(html).not.toContain('drop.scale.set(scale * 0.62, scale * 1.28, scale * 0.62)');
    expect(html).toContain('sprinklerNozzleCount');
    expect(html).toContain('drop.userData.delay');
    expect(html).toContain('drop.userData.nozzleIndex');
    expect(html).toContain("drop.name = '3D halo sprinkler water droplet'");
    expect(html).toContain('haloNozzlePosition');
    expect(html).toContain('drop.userData.nozzleAngle');
    expect(html).toContain('ringRadius');
    expect(html).toContain('sprayForce');
    expect(html).toContain('pointerNearHalo');
    expect(html).toContain("canvas.dataset.interaction = grabbedHalo ? 'halo-shower' : 'dragging'");
    expect(html).toContain('canvas.dataset.showerAmount');
    expect(html).toContain('gripField');
    expect(html).toContain('clothField');
    expect(html).toContain('canvas.dataset.fabricGrip');
    expect(html).toContain('canvas.dataset.fabricDrag');
    expect(html).toContain('flameGroup.position.x = 0');
    expect(html).toContain('draggable="false"');
    expect(html).not.toContain('tugTarget');
    expect(html).not.toContain('tugCurrent');
    expect(html).not.toContain('tugStrength');
    expect(html).not.toContain('createLogoFlameCutoutShape');
    expect(html).not.toContain('cutoutFlame');
    expect(html).not.toContain('ExtrudeGeometry');
    expect(html).not.toContain('createExtrudedFlameMesh');
    expect(html).not.toContain('createOuterFlameShape');
    expect(html).not.toContain('createFireRibbonMesh');
    expect(html).not.toContain('flamePlume');
    expect(html).not.toContain('new PlaneGeometry');
    expect(html).not.toContain('BoxGeometry');
    expect(html).not.toContain('flameSprites');
    expect(html).not.toContain('haloGlow');
    expect(html).not.toContain('flameRoot.rotation.y');
    expect(html).not.toContain('flameRoot.rotation.x');
    expect(html).not.toContain('Three.js scene</div>');
  });

  it('keeps visual tuning controls out of the client-facing login page', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).not.toContain('class="tuning-panel"');
    expect(html).not.toContain('Visual tuning');
    expect(html).not.toContain('data-tune=');
    expect(html).not.toContain('copyTuning');
    expect(html).not.toContain('resetTuning');
    expect(html).not.toContain('tuningReadout');
    expect(html).not.toContain('haloFireVisualTuningThreeFireV5');
    expect(html).toContain('canvas.dataset.fireTime');
    expect(html).toContain('canvas.dataset.speed');
    expect(html).toContain('const flameGroup = new Group()');
    expect(html).toContain('const haloGroup = new Group()');
    expect(html).toContain('flameGroup.scale.set');
    expect(html).toContain('flameBaseY + (flameMeshHeight * flameGroup.scale.y) / 2');
    expect(html).toContain('haloGroup.scale.setScalar');
  });

  it('supports employee invite setup and password recovery modes', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain("params.get('username')");
    expect(html).toContain("params.get('setup')");
    expect(html).toContain('applyInviteSetupMode');
    expect(html).toContain('applyRecoveryMode');
    expect(html).toContain('/api/auth/setup/verify');
    expect(html).toContain('/api/auth/setup-password');
    expect(html).toContain('/api/auth/password-recovery/request');
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="new-password"');
    expect(html).toContain('id="confirmPass"');
    expect(html).toContain('confirmPassField.hidden = true');
    expect(html).toContain('confirmPassInput.required = false');
    expect(html).toContain('confirmPassField.hidden = false');
    expect(html).toContain('confirmPassInput.required = true');
    expect(html).toContain('id="forgotPassword"');
    expect(html).toContain('id="formMode"');
    expect(html).toContain('Passwords must match');
    expect(html).toContain('Apple can generate and save this password');
    expect(html).toContain('remember:selectedRemember()');
    expect(html).toContain('clearBrowserAuthStorage');
    expect(html).toContain('acceptCookieSession');
    expect(html).not.toContain("localStorage.setItem('halofire_token'");
    expect(html).not.toContain("sessionStorage.setItem('halofire_token'");
  });

  it('models the flame as a teardrop thermal volume instead of cartoon color bands', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('thermalColor');
    expect(html).toContain('centerHeat');
    expect(html).toContain('baseFuel');
    expect(html).toContain('buoyantNoise');
    expect(html).toContain('density');
    expect(html).toContain('interactionEnergy');
    expect(html).toContain('uniform float waterDamp');
    expect(html).toContain('edgeFlutter');
    expect(html).toContain('lp.y = lp.y * 0.96 + 0.48');
    expect(html).toContain('uniform float baseRound');
    expect(html).toContain('uniform float redLayerWidth');
    expect(html).toContain('uniform float yellowLayerWidth');
    expect(html).toContain('uniform float coreLayerWidth');
    expect(html).toContain('baseArc');
    expect(html).toContain('baseBowl');
    expect(html).toContain('tipFlicker');
    expect(html).toContain('bodyFlicker');
    expect(html).toContain('upperHalfBand');
    expect(html).toContain('bodyFlicker * upperHalfBand');
    expect(html).not.toContain('splitCrown');
    expect(html).not.toContain('twoPointCrown');
    expect(html).not.toContain('onePointCrown');
    expect(html).toContain('outerWidth');
    expect(html).toContain('outerCore');
    expect(html).not.toContain('middleMask');
    expect(html).not.toContain('innerMask');
  });

  it('uses the latest client-tuned flame defaults as the reset baseline', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('flameScale:0.93');
    expect(html).toContain('flameWidth:1.12');
    expect(html).toContain('flameHeight:1.0');
    expect(html).toContain('baseRound:0.56');
    expect(html).toContain('topTaper:0');
    expect(html).toContain('redLayerWidth:1.0');
    expect(html).toContain('yellowLayerWidth:1.22');
    expect(html).toContain('coreLayerWidth:0.58');
    expect(html).toContain('speed:0.05');
    expect(html).toContain('smoke:0.33');
    expect(html).toContain('haloScale:1.46');
    expect(html).toContain('haloY:0.54');
    expect(html).toContain('haloOpacity:0.95');
  });

  it('keeps embers in the page background instead of attached to the flame object', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('id="emberField"');
    expect(html).toContain('initEmberField');
    expect(html).not.toContain('flameGroup.add(sprite)');
    expect(html).not.toContain('buildWaterTexture');
    expect(html).not.toContain('new Sprite(new SpriteMaterial({\n      map:waterTexture');
  });

  it('keeps the login card clean without a repeated logo', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('<div class="login-head">');
    expect(html).toContain('<p class="login-brand-title">Halo <span>Fire</span></p>');
    expect(html).toContain('.login-brand-title');
    expect(html).toContain('border-radius:28px');
    expect(html).toContain('body.hf-shell .submit-btn{\n  border-radius:12px;');
    expect(html).toContain('body.hf-shell .field input{\n  border-radius:12px;');
    expect(html).not.toContain('<div class="login-head">\n        <img');
    expect(html).not.toContain('.login-head img');
  });

  it('keeps the top banner reduced to secure access only', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('<header class="topbar">\n    <div class="top-actions">Secure access</div>\n  </header>');
    expect(html).not.toContain('class="brand-lockup"');
    expect(html).not.toContain('class="brand-mark-small"');
    expect(html).not.toContain('class="brand-copy"');
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
    expect(html).toContain('rgba(13,12,10,0.82)');
  });

  it('matches the HaloFire CAD Studio black glass palette on the login card', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(html).toContain('--fire:#e8432d');
    expect(html).toContain('--gold:#c89a3c');
    expect(html).toContain('--paper:#f2ece0');
    expect(html).toContain('--font:"IBM Plex Mono"');
    expect(html).toContain('--display:"Fraunces"');
    expect(html).toContain('linear-gradient(180deg,#ffd54f,#c89a3c)');
    expect(html).toContain('color:var(--fire)');
    expect(html).toContain('client-portal-cad-overrides');
    expect(html).toContain('body.hf-shell .login-brand-title');
    expect(html).toContain('border-radius:12px');
    expect(html).not.toContain('linear-gradient(135deg,#ffc37d,#f59a50');
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
    const workbench = fs.readFileSync(path.join(ROOT, 'workbench.html'), 'utf8');

    expect(html).not.toContain('halofire-dev-smoke');
    expect(html).not.toContain("u.value='admin'");
    expect(html).not.toContain('haloDemoLoginBootstrap');
    expect(html).not.toContain('XMLHttpRequest');
    expect(workbench).not.toContain('halofire-dev-smoke');
    expect(workbench).not.toContain('ensureHaloDemoSession');
    expect(workbench).not.toContain('XMLHttpRequest');
    expect(workbench).toContain('credentials: \'include\'');
  });
});
