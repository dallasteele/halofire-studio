import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// AB2 regression — changing the IMAP account (different host/username) MUST
// reset last_uid and clear the uid-keyed dedup log, or new mail silently
// vanishes: uids <= the stale last_uid are never listed, and colliding uids are
// skipped as already-processed. (UIDVALIDITY-epoch resets are handled the same
// way at poll time; that path is unit-tested against the transport contract.)
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3258;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir; let token; let dbPath;

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

function authed(extra = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra };
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-intake-mbox-'));
  dbPath = path.join(tempDir, 'h.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'intake-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'intake-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function saveIntake(body) {
  return fetch(`${BASE}/api/settings/intake-email`, {
    method: 'POST', headers: authed(), body: JSON.stringify(body),
  });
}

function openDb() {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

describe('intake mailbox identity — changing host/username re-baselines intake', () => {
  it('clears last_uid and the uid-keyed dedup log when the mailbox changes', async () => {
    // Configure mailbox A.
    expect((await saveIntake({
      host: 'imap-a.example.test', port: 993,
      username: 'bidsA@halofire.test', password: 'pw-a', enabled: true,
    })).status).toBe(200);

    // Simulate a prior poll having advanced the watermark + logged uids on A.
    {
      const db = openDb();
      db.prepare('UPDATE autobid_intake_config SET last_uid = 4242, uidvalidity = ? WHERE id = 1').run('111');
      db.prepare(`INSERT INTO autobid_intake_log (uid, message_id, classified_score, is_likely_bid)
                  VALUES ('4242', '<a@x>', 0.9, 1), ('4200', '<b@x>', 0.1, 0)`).run();
      db.close();
    }

    // Repoint to mailbox B (different host AND username).
    expect((await saveIntake({
      host: 'imap-b.example.test', username: 'bidsB@halofire.test',
    })).status).toBe(200);

    const db = openDb();
    const cfg = db.prepare('SELECT * FROM autobid_intake_config WHERE id = 1').get();
    const logCount = db.prepare('SELECT COUNT(*) n FROM autobid_intake_log').get().n;
    db.close();

    expect(cfg.host).toBe('imap-b.example.test');
    expect(cfg.username).toBe('bidsB@halofire.test');
    // Watermark + epoch reset, dedup log scoped away from mailbox A's uids.
    expect(cfg.last_uid).toBe(0);
    expect(cfg.uidvalidity).toBeNull();
    expect(logCount).toBe(0);
  });

  it('an enabled-only update (same mailbox) does NOT reset the watermark', async () => {
    // Establish a watermark on the current (B) mailbox.
    {
      const db = openDb();
      db.prepare('UPDATE autobid_intake_config SET last_uid = 99, uidvalidity = ? WHERE id = 1').run('222');
      db.prepare(`INSERT INTO autobid_intake_log (uid, is_likely_bid) VALUES ('99', 0)`).run();
      db.close();
    }

    expect((await saveIntake({ enabled: false })).status).toBe(200);

    const db = openDb();
    const cfg = db.prepare('SELECT * FROM autobid_intake_config WHERE id = 1').get();
    const logCount = db.prepare('SELECT COUNT(*) n FROM autobid_intake_log').get().n;
    db.close();

    // Same host+username -> identity unchanged -> watermark + log preserved.
    expect(cfg.last_uid).toBe(99);
    expect(cfg.uidvalidity).toBe('222');
    expect(logCount).toBe(1);
  });
});
