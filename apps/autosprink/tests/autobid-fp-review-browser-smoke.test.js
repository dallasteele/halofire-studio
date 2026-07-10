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
const ENGINE_ROOT = path.join(WORKSPACE_ROOT, 'halofire-autobid', 'engine');
const SOURCE_DB = path.join(WORKSPACE_ROOT, 'halofire-autobid', 'db', 'halofire_bids.db');
const SOURCE_OUT = path.join(WORKSPACE_ROOT, 'halofire-autobid', 'out');
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
      expect(await page.locator('.fpVectorDecision[data-decision="accepted"]').isEnabled()).toBe(true);
      expect(await page.locator('.fpVectorDecision[data-decision="rejected"]').isEnabled()).toBe(true);
    } finally {
      await page.close();
    }
  });
});
