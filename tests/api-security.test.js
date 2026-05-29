import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3197;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;
let tempDir;
let dbPath;

function request(pathname, options = {}) {
  return fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    try {
      const res = await request('/api/health');
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HaloFire API did not become healthy for security tests');
}

async function login(username, password) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

async function tokenFor(username, password) {
  const res = await login(username, password);
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.token;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-api-security-'));
  dbPath = path.join(tempDir, 'halofire.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'security-admin',
      HALOFIRE_ADMIN_PASSWORD: 'actual-test-password',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('HaloFire API security gates', () => {
  it('rejects the baked-in development password unless explicitly enabled', async () => {
    const res = await login('admin', 'halofire2026');
    expect(res.status).toBe(401);
  });

  it('accepts only the configured bootstrap admin credentials', async () => {
    const res = await login('security-admin', 'actual-test-password');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.role).toBe('admin');
  });

  it('rejects unsupported bid update fields', async () => {
    const token = await tokenFor('security-admin', 'actual-test-password');
    const res = await request('/api/bids/1', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ made_up_column: 'owned' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects protected bid fields such as created_by', async () => {
    const token = await tokenFor('security-admin', 'actual-test-password');
    const res = await request('/api/bids/1', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ created_by: 999 }),
    });
    expect(res.status).toBe(400);
  });

  it('blocks non-admin users from deleting bids', async () => {
    const db = new Database(dbPath);
    const hash = bcrypt.hashSync('viewer-password', 12);
    db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run(
      'viewer',
      hash,
      'Viewer User',
      'user',
      'viewer@example.test',
    );
    db.close();

    const token = await tokenFor('viewer', 'viewer-password');
    const res = await request('/api/bids/1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('rejects CORS preflight from untrusted origins', async () => {
    const res = await request('/api/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.test',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(403);
  });
});
