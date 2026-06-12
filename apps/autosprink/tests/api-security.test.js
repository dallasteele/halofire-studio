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
      HALOFIRE_SMTP_MOCK: '1',
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

  it('sets a hardened session cookie and accepts it for mounted workbench auth', async () => {
    const res = await login('security-admin', 'actual-test-password');
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') || '';
    expect(cookie).toContain('halofire_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const me = await request('/api/auth/me', {
      headers: { Cookie: cookie.split(';')[0] },
    });
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.username).toBe('security-admin');
  });

  it('keeps remember-me duration server-side and marks secure cookies behind HTTPS proxy', async () => {
    const shortSession = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ username: ' SECURITY-ADMIN ', password: 'actual-test-password', remember: false }),
    });
    expect(shortSession.status).toBe(200);
    const shortCookie = shortSession.headers.get('set-cookie') || '';
    expect(shortCookie).toContain('halofire_session=');
    expect(shortCookie).toContain('Secure');
    expect(shortCookie).not.toContain('Max-Age=');

    const remembered = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ username: 'security-admin', password: 'actual-test-password', remember: true }),
    });
    expect(remembered.status).toBe(200);
    const rememberedCookie = remembered.headers.get('set-cookie') || '';
    expect(rememberedCookie).toContain('Secure');
    expect(rememberedCookie).toContain('Max-Age=2592000');
  });

  it('clears the mounted session cookie on logout', async () => {
    const res = await login('security-admin', 'actual-test-password');
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') || '';
    expect(cookie).toContain('halofire_session=');

    const logout = await request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie.split(';')[0] },
    });
    expect(logout.status).toBe(204);
    const clearedCookie = logout.headers.get('set-cookie') || '';
    expect(clearedCookie).toContain('halofire_session=');
    expect(clearedCookie).toMatch(/Max-Age=0|Expires=/);

    const me = await request('/api/auth/me', {
      headers: { Cookie: clearedCookie.split(';')[0] },
    });
    expect(me.status).toBe(401);
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

  it('lets an admin invite an employee by email and the employee create a password once', async () => {
    const adminToken = await tokenFor('security-admin', 'actual-test-password');
    const invite = await request('/api/auth/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        email: 'Wade@HaloFireUS.com',
        name: 'Wade',
        role: 'user',
      }),
    });
    expect(invite.status).toBe(201);
    const inviteBody = await invite.json();
    expect(inviteBody.user).toEqual(expect.objectContaining({
      username: 'wade@halofireus.com',
      email: 'wade@halofireus.com',
      role: 'user',
    }));
    expect(inviteBody.setup_token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(inviteBody.invite_url).toContain('username=wade%40halofireus.com');
    expect(inviteBody.invite_url).toContain('setup=');

    const verify = await request(`/api/auth/setup/verify?token=${encodeURIComponent(inviteBody.setup_token)}`);
    expect(verify.status).toBe(200);
    expect(await verify.json()).toEqual(expect.objectContaining({
      username: 'wade@halofireus.com',
      email: 'wade@halofireus.com',
      name: 'Wade',
    }));

    const setup = await request('/api/auth/setup-password', {
      method: 'POST',
      body: JSON.stringify({
        token: inviteBody.setup_token,
        password: 'Wade-secure-passphrase-2026!',
      }),
    });
    expect(setup.status).toBe(200);
    expect(setup.headers.get('set-cookie') || '').toContain('halofire_session=');
    const setupBody = await setup.json();
    expect(setupBody.user.username).toBe('wade@halofireus.com');

    const loginAfterSetup = await login('wade@halofireus.com', 'Wade-secure-passphrase-2026!');
    expect(loginAfterSetup.status).toBe(200);

    const canonicalizedLogin = await login(' Wade@HaloFireUS.com ', 'Wade-secure-passphrase-2026!');
    expect(canonicalizedLogin.status).toBe(200);

    const reuse = await request('/api/auth/setup-password', {
      method: 'POST',
      body: JSON.stringify({
        token: inviteBody.setup_token,
        password: 'Different-secure-passphrase-2026!',
      }),
    });
    expect(reuse.status).toBe(400);
  });

  it('blocks non-admin users from inviting employees', async () => {
    const db = new Database(dbPath);
    const hash = bcrypt.hashSync('invite-viewer-password', 12);
    db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run(
      'invite-viewer',
      hash,
      'Invite Viewer',
      'user',
      'invite-viewer@example.test',
    );
    db.close();

    const viewerToken = await tokenFor('invite-viewer', 'invite-viewer-password');
    const res = await request('/api/auth/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${viewerToken}` },
      body: JSON.stringify({ email: 'new@halofireus.com', name: 'New User' }),
    });
    expect(res.status).toBe(403);
  });

  it('invalidates an older unused invite when a fresh employee invite is issued', async () => {
    const adminToken = await tokenFor('security-admin', 'actual-test-password');
    const first = await request('/api/auth/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: 'replacement@halofireus.com', name: 'Replacement User' }),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await request('/api/auth/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ email: 'replacement@halofireus.com', name: 'Replacement User' }),
    });
    expect(second.status).toBe(201);
    const secondBody = await second.json();

    const oldVerify = await request(`/api/auth/setup/verify?token=${encodeURIComponent(firstBody.setup_token)}`);
    expect(oldVerify.status).toBe(400);

    const freshVerify = await request(`/api/auth/setup/verify?token=${encodeURIComponent(secondBody.setup_token)}`);
    expect(freshVerify.status).toBe(200);
  });

  it('accepts password recovery requests without leaking whether an email exists', async () => {
    const dbBefore = new Database(dbPath);
    const beforeCount = dbBefore.prepare("SELECT COUNT(*) AS count FROM auth_tokens WHERE purpose = 'password_reset'").get().count;
    dbBefore.close();

    const existing = await request('/api/auth/password-recovery/request', {
      method: 'POST',
      body: JSON.stringify({ email: 'security-admin' }),
    });
    expect(existing.status).toBe(202);
    expect(await existing.json()).toEqual({ ok: true });

    const dbAfterExisting = new Database(dbPath);
    const afterExistingCount = dbAfterExisting.prepare("SELECT COUNT(*) AS count FROM auth_tokens WHERE purpose = 'password_reset'").get().count;
    dbAfterExisting.close();
    expect(afterExistingCount).toBe(beforeCount + 1);

    const missing = await request('/api/auth/password-recovery/request', {
      method: 'POST',
      body: JSON.stringify({ email: 'missing@halofireus.com' }),
    });
    expect(missing.status).toBe(202);
    expect(await missing.json()).toEqual({ ok: true });

    const dbAfterMissing = new Database(dbPath);
    const afterMissingCount = dbAfterMissing.prepare("SELECT COUNT(*) AS count FROM auth_tokens WHERE purpose = 'password_reset'").get().count;
    dbAfterMissing.close();
    expect(afterMissingCount).toBe(afterExistingCount);
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
