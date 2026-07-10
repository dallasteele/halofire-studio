import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STUDIO_PORT = 3278;
const ENGINE_PORT = 3277;

async function waitFor(url) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function login(base, username, password) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).token;
}

describe('AutoBid authenticated proxy boundary', () => {
  let engine;
  let studio;
  let tempDir;
  let base;
  let adminToken;
  let estimatorToken;
  let userToken;
  const received = [];

  beforeAll(async () => {
    engine = http.createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        // The real engine owns the FP semantic-review role boundary. Keep the
        // fake upstream honest so this test proves the Studio proxy forwards
        // the verified JWT identity and cannot turn a viewer into a reviewer.
        response.writeHead(200, {
          'content-type': 'application/json',
          etag: '"spatial-v2"',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'content-disposition': 'attachment; filename="review.json"',
        });
        response.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise((resolve) => engine.listen(ENGINE_PORT, '127.0.0.1', resolve));

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-autobid-proxy-'));
    base = `http://127.0.0.1:${STUDIO_PORT}`;
    studio = spawn(process.execPath, ['src/api/server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(STUDIO_PORT),
        NODE_ENV: 'test',
        HALOFIRE_DB_PATH: path.join(tempDir, 'proxy.db'),
        JWT_SECRET: 'autobid-proxy-test-secret-with-32-characters',
        HALOFIRE_ADMIN_USER: 'admin',
        HALOFIRE_ADMIN_PASSWORD: 'proxy-admin-password',
        HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
        HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
        AUTOBID_ENGINE_URL: `http://127.0.0.1:${ENGINE_PORT}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitFor(`${base}/api/health`);
    adminToken = await login(base, 'admin', 'proxy-admin-password');

    const invite = await fetch(`${base}/api/auth/invite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'estimator@example.test', name: 'Real Estimator', role: 'estimator' }),
    });
    expect(invite.status).toBe(201);
    const setupToken = (await invite.json()).setup_token;
    const setup = await fetch(`${base}/api/auth/setup-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: setupToken, password: 'reviewer-password-2026' }),
    });
    expect(setup.status).toBe(200);
    estimatorToken = await login(base, 'estimator@example.test', 'reviewer-password-2026');

    const userInvite = await fetch(`${base}/api/auth/invite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'viewer@example.test', name: 'Read Only User', role: 'user' }),
    });
    expect(userInvite.status).toBe(201);
    const userSetupToken = (await userInvite.json()).setup_token;
    const userSetup = await fetch(`${base}/api/auth/setup-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: userSetupToken, password: 'viewer-password-2026' }),
    });
    expect(userSetup.status).toBe(200);
    userToken = await login(base, 'viewer@example.test', 'viewer-password-2026');
  }, 15000);

  afterAll(async () => {
    if (studio && !studio.killed) {
      studio.kill();
      await new Promise((resolve) => studio.once('exit', resolve));
    }
    if (engine) await new Promise((resolve) => engine.close(resolve));
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('rejects unauthenticated requests without contacting the engine', async () => {
    const count = received.length;
    const response = await fetch(`${base}/api/autobid/health`);
    expect(response.status).toBe(401);
    expect(received).toHaveLength(count);
  });

  it('preserves query and replaces forged reviewer identity with the verified JWT identity', async () => {
    const response = await fetch(`${base}/api/autobid/package/4?view=overlay`, {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-halofire-reviewer-id': 'forged-id',
        'x-halofire-reviewer-name': 'Forged Name',
        'x-halofire-reviewer-role': 'user',
      },
    });
    expect(response.status).toBe(200);
    const forwarded = received.at(-1);
    expect(forwarded.url).toBe('/package/4?view=overlay');
    expect(forwarded.headers['x-halofire-reviewer-id']).not.toBe('forged-id');
    expect(forwarded.headers['x-halofire-reviewer-name']).toBe('HaloFire Admin');
    expect(forwarded.headers['x-halofire-reviewer-role']).toBe('admin');
    expect(response.headers.get('etag')).toBe('"spatial-v2"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="review.json"');
  });

  it('allows estimator review writes and denies ordinary users before upstream', async () => {
    const payload = { decision: 'accepted', overlay_artifact_id: 'sha256:abc' };
    const accepted = await fetch(`${base}/api/autobid/package/4/spatial-review`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${estimatorToken}`,
        'content-type': 'application/json',
        'x-halofire-reviewer-name': 'Forged Name',
      },
      body: JSON.stringify(payload),
    });
    expect(accepted.status).toBe(200);
    const forwarded = received.at(-1);
    expect(JSON.parse(forwarded.body)).toEqual(payload);
    expect(forwarded.headers['x-halofire-reviewer-name']).toBe('Real Estimator');
    expect(forwarded.headers['x-halofire-reviewer-role']).toBe('estimator');

    const count = received.length;
    const denied = await fetch(`${base}/api/autobid/package/4/spatial-review`, {
      method: 'POST',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'Estimator or admin role required for spatial review' });
    expect(received).toHaveLength(count);
  });

  it('forwards FP semantic-review identity from JWT and keeps viewer reviews fail-closed', async () => {
    const payload = {
      artifact_id: 'a'.repeat(64),
      decision: 'accepted',
      head_count: 123,
      expected_bundle_sha256: 'b'.repeat(64),
      expected_overlay_sha256: 'c'.repeat(64),
    };
    const accepted = await fetch(`${base}/api/autobid/package/4/fp-vector-review`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${estimatorToken}`,
        'content-type': 'application/json',
        'x-halofire-reviewer-id': 'forged-id',
        'x-halofire-reviewer-name': 'Forged Name',
        'x-halofire-reviewer-role': 'admin',
      },
      body: JSON.stringify(payload),
    });
    expect(accepted.status).toBe(200);
    const forwardedEstimator = received.at(-1);
    expect(forwardedEstimator.url).toBe('/package/4/fp-vector-review');
    expect(forwardedEstimator.headers['x-halofire-reviewer-id']).not.toBe('forged-id');
    expect(forwardedEstimator.headers['x-halofire-reviewer-name']).toBe('Real Estimator');
    expect(forwardedEstimator.headers['x-halofire-reviewer-role']).toBe('estimator');
    expect(JSON.parse(forwardedEstimator.body)).toEqual(payload);

    const count = received.length;
    const denied = await fetch(`${base}/api/autobid/package/4/fp-vector-review`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
        'x-halofire-reviewer-id': 'forged-admin-id',
        'x-halofire-reviewer-name': 'Forged Admin',
        'x-halofire-reviewer-role': 'admin',
      },
      body: JSON.stringify(payload),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'Estimator or admin role required for FP review' });
    expect(received).toHaveLength(count);
  });

  it('applies the same fail-closed proxy role boundary to FP family reviews', async () => {
    const payload = {
      artifact_id: 'a'.repeat(64),
      page_index: 0,
      physical_page_number: 1,
      family_id: 'family-group-01',
      decision: 'accepted',
      bundle_sha256: 'b'.repeat(64),
      overlay_sha256: 'c'.repeat(64),
    };
    const count = received.length;
    const denied = await fetch(`${base}/api/autobid/package/4/fp-vector-family-review`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json',
        'x-halofire-reviewer-role': 'admin',
      },
      body: JSON.stringify(payload),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'Estimator or admin role required for FP review' });
    expect(received).toHaveLength(count);
  });
});
