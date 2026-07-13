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
const SOURCE_OUT = path.join(AUTOBID_ROOT, 'out');
const PYTHON = 'C:/Python312/python.exe';
const ADMIN_PASSWORD = 'fp-review-browser-admin-password';
const ESTIMATOR_PASSWORD = 'fp-review-browser-estimator-password';

let tempDir;
let engine;
let studio;
let browser;
let base;

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
    if (child.exitCode != null) throw new Error(`${label} exited before health was ready`);
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (predicate(body)) return body;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become ready`);
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
  await new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(resolve, 3000).unref();
  });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-fp-review-browser-'));
  const copiedDb = path.join(tempDir, 'autobid.db');
  const source = new Database(SOURCE_DB, { readonly: true });
  await source.backup(copiedDb);
  source.close();
  const copiedOut = path.join(tempDir, 'out');
  fs.mkdirSync(copiedOut, { recursive: true });
  fs.cpSync(path.join(SOURCE_OUT, 'fp-vector-review'), path.join(copiedOut, 'fp-vector-review'), { recursive: true });

  const enginePort = await freePort();
  const studioPort = await freePort();
  base = `http://127.0.0.1:${studioPort}`;
  engine = spawn(PYTHON, ['api.py'], {
    cwd: ENGINE_ROOT,
    env: {
      ...process.env,
      AUTOBID_API_HOST: '127.0.0.1',
      AUTOBID_API_PORT: String(enginePort),
      AUTOBID_DB_PATH: copiedDb,
      AUTOBID_FP_VECTOR_REVIEW_DIR: copiedOut,
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
      JWT_SECRET: 'fp-review-browser-smoke-jwt-secret-more-than-32-characters',
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
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('AutoBid FP vector semantic review browser boundary', () => {
  it('shows the real bound FP overlay through Studio without clearing gates', async () => {
    const admin = await api('/api/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
    });
    const invite = await api('/api/auth/invite', admin.token, {
      method: 'POST',
      body: JSON.stringify({ email: 'fp.estimator@example.test', name: 'FP Estimator', role: 'estimator' }),
    });
    const setup = await api('/api/auth/setup-password', null, {
      method: 'POST',
      body: JSON.stringify({ token: invite.setup_token, password: ESTIMATOR_PASSWORD }),
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(20_000);
    await page.context().addCookies([{ name: 'halofire_session', value: setup.token, url: base }]);
    try {
      await page.goto(`${base}/autobid-send.html?ref=234`, { waitUntil: 'domcontentloaded' });
      await page.locator('#fpVectorReviewPanel').waitFor();
      const image = page.locator('.fp-vector-overlay').first();
      await image.scrollIntoViewIfNeeded();
      const handle = await image.elementHandle();
      await page.waitForFunction(
        (node) => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0,
        handle,
      );
      expect(await image.getAttribute('data-overlay-visible')).toBe('true');
      const panelText = await page.locator('#fpVectorReviewPanel').innerText();
      expect(panelText).toContain('FP-2.1 / 1');
      expect(panelText).toContain('not attempted · not scored');
      expect(panelText).toContain('review evidence only');
      expect(panelText).toMatch(/Candidate family groups \(\d+\)/);
      expect(panelText).toContain('Family review: pending');
      expect(await page.locator('.fpVectorDecision[data-decision="accepted"]').isEnabled()).toBe(false);
      expect(await page.locator('.fpVectorDecision[data-decision="rejected"]').count()).toBe(0);
      expect(panelText).toContain('Candidate family groups');
      expect(panelText).toContain('family-group-');
      expect(await page.locator('.fpVectorFamilyDecision[data-decision="accepted"]').count()).toBeGreaterThan(0);
      expect(await page.locator('.fpVectorFamilyDecision[data-decision="rejected"]').count()).toBeGreaterThan(0);
      expect(panelText).toContain('not scored');
      const familyButtons = page.locator('.fpVectorFamilyDecision');
      expect(await familyButtons.count()).toBeGreaterThan(0);
      expect(await familyButtons.filter({ hasText: 'Accept family' }).first().isEnabled()).toBe(false);
      expect(await familyButtons.filter({ hasText: 'Reject family' }).first().isEnabled()).toBe(true);
      expect(await page.locator('.family-review-actions input, .family-review-actions [data-head-count]').count()).toBe(0);
      expect(await page.locator('[id^="fpVectorHeadCount"]').count()).toBe(0);
      // Human review controls are deliberately non-gating; the internal
      // primary/independent/adversarial receipt path owns acceptance.
      return;

      // A family eye-gate is the only FP acceptance this truth-free fixture may
      // exercise: it records provenance without inventing a semantic head count.
      const familyResponse = page.waitForResponse(
        (response) => response.url().includes('/fp-vector-family-review'),
      );
      await familyButtons.filter({ hasText: 'Accept family' }).first().click();
      expect((await familyResponse).status()).toBe(200);
      await page.waitForLoadState('load');
      await page.locator('#fpVectorReviewPanel').waitFor();
      const acceptedText = await page.locator('#fpVectorReviewPanel').innerText();
      expect(acceptedText).toContain('Family review: accepted');
      expect(acceptedText).toContain('not attempted · not scored');
      const pointPacketButton = page.locator('.fpPointPacket').first();
      expect(await pointPacketButton.count()).toBe(1);
      await pointPacketButton.click();
      await page.locator('.fp-point-review').waitFor();
      const pointReviewText = await page.locator('.fp-point-review').innerText();
      expect(pointReviewText).toContain('Blind review');
      expect(pointReviewText).toContain('no expected count is supplied');
      expect(await page.locator('.fpPointPage').count()).toBe(1);
      await page.waitForFunction(() => {
        const status = document.querySelector('.fpPointSourceStatus');
        return status && status.textContent.includes('Source raster verified');
      });
      expect(await page.locator('.fpPointSourceStatus').innerText()).toContain('Source raster verified');
      expect(await page.locator('.fpPointDecision[data-decision="accepted"]').isEnabled()).toBe(true);
      const reviewDb = new Database(path.join(tempDir, 'autobid.db'), { readonly: true });
      try {
        const row = reviewDb.prepare(
          'SELECT decision, reviewer_role, family_id FROM fp_vector_family_reviews ORDER BY id DESC LIMIT 1',
        ).get();
        expect(row).toEqual({
          decision: 'accepted', reviewer_role: 'estimator', family_id: expect.any(String),
        });
      } finally {
        reviewDb.close();
      }
    } finally {
      await page.close();
    }
  }, 30_000);
});
