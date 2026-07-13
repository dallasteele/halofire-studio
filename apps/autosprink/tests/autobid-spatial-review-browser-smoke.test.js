import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';

const STUDIO_ROOT = path.resolve(import.meta.dirname, '..');
const WORKSPACE_ROOT = path.resolve(STUDIO_ROOT, '../../..');
const LOCAL_AUTOBID_ROOT = path.join(WORKSPACE_ROOT, 'halofire-autobid');
const SIBLING_AUTOBID_ROOT = path.resolve(WORKSPACE_ROOT, '..', 'halofire-autobid');
const AUTOBID_ROOT = process.env.HALOFIRE_AUTOBID_ROOT || (fs.existsSync(LOCAL_AUTOBID_ROOT) ? LOCAL_AUTOBID_ROOT : SIBLING_AUTOBID_ROOT);
const ENGINE_ROOT = path.join(AUTOBID_ROOT, 'engine');
const SOURCE_DB = path.join(AUTOBID_ROOT, 'db', 'halofire_bids.db');
const SOURCE_ARTIFACTS = path.join(AUTOBID_ROOT, 'out', 'spatial-overlays');
const PYTHON = 'C:/Python312/python.exe';
const ADMIN_PASSWORD = 'review-browser-admin-password';
const ESTIMATOR_PASSWORD = 'review-browser-estimator-password';
const VIEWER_PASSWORD = 'review-browser-viewer-password';

let tempDir;
let copiedDb;
let engine;
let studio;
let browser;
let enginePort;
let studioPort;
let base;
let initialReviewCount;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForJson(url, predicate, child, label) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (child.exitCode != null) throw new Error(`${label} exited before its health route was ready`);
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (predicate(body)) return body;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} health identity did not become ready`);
}

async function api(pathname, token, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${pathname} failed ${response.status}: ${text}`);
  return body;
}

async function stop(child) {
  if (!child || child.exitCode != null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode == null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

beforeAll(async () => {
  expect(fs.existsSync(SOURCE_DB)).toBe(true);
  expect(fs.existsSync(SOURCE_ARTIFACTS)).toBe(true);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-spatial-review-browser-'));
  copiedDb = path.join(tempDir, 'autobid-review-smoke.db');
  const source = new Database(SOURCE_DB, { readonly: true });
  initialReviewCount = source.prepare('SELECT COUNT(*) AS n FROM spatial_overlay_reviews').get().n;
  await source.backup(copiedDb);
  source.close();
  const copiedArtifacts = path.join(tempDir, 'spatial-overlays');
  fs.cpSync(SOURCE_ARTIFACTS, copiedArtifacts, { recursive: true });

  enginePort = await freePort();
  studioPort = await freePort();
  base = `http://127.0.0.1:${studioPort}`;
  engine = spawn(PYTHON, ['api.py'], {
    cwd: ENGINE_ROOT,
    env: {
      ...process.env,
      AUTOBID_API_HOST: '127.0.0.1',
      AUTOBID_API_PORT: String(enginePort),
      AUTOBID_DB_PATH: copiedDb,
      AUTOBID_SPATIAL_ARTIFACT_DIR: copiedArtifacts,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForJson(
    `http://127.0.0.1:${enginePort}/health`,
    (body) => body.service === 'halofire-autobid-api' && body.db_exists === true,
    engine,
    'AutoBid engine',
  );

  studio = spawn(process.execPath, ['src/api/server.js'], {
    cwd: STUDIO_ROOT,
    env: {
      ...process.env,
      PORT: String(studioPort),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'studio.db'),
      JWT_SECRET: 'review-browser-smoke-jwt-secret-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: ADMIN_PASSWORD,
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      AUTOBID_ENGINE_URL: `http://127.0.0.1:${enginePort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForJson(`${base}/api/health`, (body) => body.status === 'ok', studio, 'HaloFire Studio');
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  if (browser) await browser.close();
  await stop(studio);
  await stop(engine);
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

describe('AutoBid spatial review live browser boundary', () => {
  it('shows eight decoded Cooperative overlays and records a hash-bound estimator decision', async () => {
    const admin = await api('/api/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
    });
    const invite = await api('/api/auth/invite', admin.token, {
      method: 'POST',
      body: JSON.stringify({
        email: 'spatial.estimator@example.test',
        name: 'Spatial Smoke Estimator',
        role: 'estimator',
      }),
    });
    const setup = await api('/api/auth/setup-password', null, {
      method: 'POST',
      body: JSON.stringify({ token: invite.setup_token, password: ESTIMATOR_PASSWORD }),
    });
    expect(setup.user.role).toBe('estimator');
    expect((await api('/api/autobid/health', setup.token)).service).toBe('halofire-autobid-api');

    // Exercise the actual Studio -> AutoBid boundary with a read-only identity.
    // The proxy must reject the write before the engine sees it; this keeps the
    // copied review database untouched and proves the browser-visible role gate
    // is not only covered by the fake-engine unit test.
    const viewerInvite = await api('/api/auth/invite', admin.token, {
      method: 'POST',
      body: JSON.stringify({
        email: 'spatial.viewer@example.test',
        name: 'Spatial Read Only Viewer',
        role: 'user',
      }),
    });
    const viewer = await api('/api/auth/setup-password', null, {
      method: 'POST',
      body: JSON.stringify({ token: viewerInvite.setup_token, password: VIEWER_PASSWORD }),
    });
    expect(viewer.user.role).toBe('user');

    const page = await browser.newPage();
    page.setDefaultTimeout(20_000);
    await page.context().addCookies([{ name: 'halofire_session', value: setup.token, url: base }]);
    try {
      await page.goto(`${base}/autobid-send.html?ref=9`, { waitUntil: 'domcontentloaded' });
      await page.locator('#spatialVerificationPanel').waitFor();
      const images = page.locator('.spatial-overlay');
      expect(await images.count()).toBe(8);
      expect(await page.locator('.spatial-review-frame').count()).toBe(8);
      expect(await page.locator('[data-spatial-zoom]').count()).toBe(8);
      // The product uses lazy loading. Visit every plate just as an estimator
      // must, then require a real browser decode before any acceptance assertion.
      for (let index = 0; index < 8; index += 1) {
        const image = images.nth(index);
        await image.scrollIntoViewIfNeeded();
        const handle = await image.elementHandle();
        await page.waitForFunction(
          (node) => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0,
          handle,
        );
      }
      const decoded = await images.evaluateAll((nodes) => nodes.map((image) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })));
      expect(decoded.every(({ width, height }) => width > 0 && height > 0)).toBe(true);
      if (process.env.AUTOBID_REVIEW_SCREENSHOT_PATH) {
        const screenshotPath = path.resolve(process.env.AUTOBID_REVIEW_SCREENSHOT_PATH);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }
      if (process.env.AUTOBID_REVIEW_A101_SCREENSHOT_PATH) {
        const screenshotPath = path.resolve(process.env.AUTOBID_REVIEW_A101_SCREENSHOT_PATH);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await page.locator('.spatial-review-frame').first().screenshot({ path: screenshotPath });
      }
      const panelText = await page.locator('#spatialVerificationPanel').innerText();
      expect(panelText).toContain('Indexed source page (zero-based)');
      expect(panelText).toContain('upper (network-0)');
      expect(panelText).toContain('lower (network-1)');
      for (const physicalPage of [44, 47, 50, 53, 56, 59, 62, 65]) {
        expect(panelText).toContain(`/ ${physicalPage}`);
      }

      const beforeReview = await api('/api/autobid/package/9', setup.token);
      const firstPlate = beforeReview.spatial_verification.plates[0];
      const denied = await fetch(`${base}/api/autobid/package/9/spatial-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewer.token}`,
        },
        body: JSON.stringify({
          artifact_id: firstPlate.artifact_id,
          decision: 'accepted',
          reviewed_structural_wall_recall: 0.95,
          phantom_room_count: 0,
          expected_png_sha256: firstPlate.integrity.png_sha256,
          expected_manifest_sha256: firstPlate.integrity.manifest_sha256,
        }),
      });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({
        error: 'Estimator or admin role required for spatial review',
      });
      const copiedBeforeEstimatorReview = new Database(copiedDb, { readonly: true });
      expect(copiedBeforeEstimatorReview
        .prepare('SELECT COUNT(*) AS n FROM spatial_overlay_reviews').get().n).toBe(initialReviewCount);
      copiedBeforeEstimatorReview.close();

      const accepts = page.locator('.spatialDecision[data-decision="accepted"]');
      expect(await accepts.count()).toBe(8);
      const viewportAttestations = page.locator('.viewport-attestation');
      for (let index = 0; index < await viewportAttestations.count(); index += 1) {
        await viewportAttestations.nth(index).check();
      }
      for (let index = 0; index < 8; index += 1) expect(await accepts.nth(index).isEnabled()).toBe(true);
      await page.locator('#spatialRecall0').fill('0.95');
      await page.locator('#spatialPhantoms0').fill('0');
      await page.locator('#spatialNote0').fill('Synthetic copied-DB browser smoke after all eight overlays decoded.');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        accepts.first().click(),
      ]);

      const manifest = (await api('/api/autobid/package/9', setup.token)).spatial_verification;
      expect(manifest.plates).toHaveLength(8);
      const estimatorRows = manifest.plates.filter((plate) => plate.review?.reviewer_name === 'Spatial Smoke Estimator');
      expect(estimatorRows).toHaveLength(1);
      expect(estimatorRows[0].review.decision).toBe('accepted');
      expect(estimatorRows[0].review.reviewer_role).toBe('estimator');
      expect(estimatorRows[0].review.reviewed_structural_wall_recall).toBe(0.95);
      expect(estimatorRows[0].review.phantom_room_count).toBe(0);
      // The copied DB intentionally excludes the content-addressed machine ledger;
      // a human row is recorded but cannot substitute for that missing receipt.
      expect(manifest.passed).toBe(false);

      const copied = new Database(copiedDb, { readonly: true });
      expect(copied.prepare('SELECT COUNT(*) AS n FROM spatial_overlay_reviews').get().n).toBe(initialReviewCount + 1);
      copied.close();
      const canonical = new Database(SOURCE_DB, { readonly: true });
      expect(canonical.prepare('SELECT COUNT(*) AS n FROM spatial_overlay_reviews').get().n).toBe(initialReviewCount);
      canonical.close();
    } finally {
      await page.close();
    }
  }, 60_000);
});
