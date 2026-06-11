import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// AB1 CRM API: clients + bid_requests CRUD and status-machine-gated transitions.
// Spawns the real server (codebase convention) on a dedicated port.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3251;
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-crm-api-'));
  dbPath = path.join(tempDir, 'h.db');
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'crm-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'crm-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('AB1 CRM API — auth', () => {
  it('requires auth on clients', async () => {
    expect((await fetch(`${BASE}/api/clients`)).status).toBe(401);
  });
  it('requires auth on bid-requests', async () => {
    expect((await fetch(`${BASE}/api/bid-requests`)).status).toBe(401);
  });
});

describe('AB1 CRM API — create client + bid request', () => {
  let clientId; let bidId;

  it('creates a client', async () => {
    const res = await fetch(`${BASE}/api/clients`, {
      method: 'POST', headers: authed(),
      body: JSON.stringify({ name: 'Acme GC', company: 'Acme General Contractors', email: 'bids@acme.test' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    clientId = body.id;
  });

  it('rejects a client with no name', async () => {
    const res = await fetch(`${BASE}/api/clients`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ company: 'No Name Co' }),
    });
    expect(res.status).toBe(400);
  });

  it('creates a bid request starting at received with seeded history', async () => {
    const res = await fetch(`${BASE}/api/bid-requests`, {
      method: 'POST', headers: authed(),
      body: JSON.stringify({ client_id: clientId, title: 'Warehouse sprinkler ITB', source: 'manual' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('received');
    bidId = body.id;

    const got = await (await fetch(`${BASE}/api/bid-requests/${bidId}`, { headers: authed() })).json();
    expect(got.status).toBe('received');
    expect(got.client_id).toBe(clientId);
    expect(Array.isArray(got.status_history)).toBe(true);
    expect(got.status_history).toHaveLength(1);
    expect(got.status_history[0].status).toBe('received');
    expect(got.estimate_total_cents).toBeNull();
  });

  it('rejects a bid request with no title', async () => {
    const res = await fetch(`${BASE}/api/bid-requests`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ client_id: clientId }),
    });
    expect(res.status).toBe(400);
  });

  it('advances status via a valid transition and grows history', async () => {
    const res = await fetch(`${BASE}/api/bid-requests/${bidId}/transition`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ to: 'reviewing' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('reviewing');
    expect(body.status_history).toHaveLength(2);
    expect(body.status_history[1].status).toBe('reviewing');
    expect(typeof body.status_history[1].atIso).toBe('string');
  });

  it('rejects an invalid transition with 409 and the machine error message', async () => {
    // current status is 'reviewing'; reviewing -> won is not allowed.
    const res = await fetch(`${BASE}/api/bid-requests/${bidId}/transition`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ to: 'won' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('invalid transition reviewing -> won');

    // status unchanged after the rejected transition
    const got = await (await fetch(`${BASE}/api/bid-requests/${bidId}`, { headers: authed() })).json();
    expect(got.status).toBe('reviewing');
    expect(got.status_history).toHaveLength(2);
  });

  it('rejects an unknown target status with 400', async () => {
    const res = await fetch(`${BASE}/api/bid-requests/${bidId}/transition`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ to: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });

  it('never allows a direct status write through update', async () => {
    const res = await fetch(`${BASE}/api/bid-requests/${bidId}`, {
      method: 'PUT', headers: authed(), body: JSON.stringify({ status: 'won' }),
    });
    expect(res.status).toBe(400);
    const got = await (await fetch(`${BASE}/api/bid-requests/${bidId}`, { headers: authed() })).json();
    expect(got.status).toBe('reviewing');
  });

  it('updates allowed fields without touching status', async () => {
    const res = await fetch(`${BASE}/api/bid-requests/${bidId}`, {
      method: 'PUT', headers: authed(), body: JSON.stringify({ notes: 'hot lead', estimate_total_cents: 1234500 }),
    });
    expect(res.status).toBe(200);
    const got = await (await fetch(`${BASE}/api/bid-requests/${bidId}`, { headers: authed() })).json();
    expect(got.notes).toBe('hot lead');
    expect(got.estimate_total_cents).toBe(1234500);
    expect(got.status).toBe('reviewing');
  });

  it('lists bid requests filtered by status', async () => {
    // create a second bid request that stays at 'received'
    await fetch(`${BASE}/api/bid-requests`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ client_id: clientId, title: 'Office RFP' }),
    });

    const reviewing = await (await fetch(`${BASE}/api/bid-requests?status=reviewing`, { headers: authed() })).json();
    expect(reviewing.every((r) => r.status === 'reviewing')).toBe(true);
    expect(reviewing.some((r) => r.id === bidId)).toBe(true);

    const received = await (await fetch(`${BASE}/api/bid-requests?status=received`, { headers: authed() })).json();
    expect(received.every((r) => r.status === 'received')).toBe(true);
    expect(received.some((r) => r.id === bidId)).toBe(false);
  });

  it('lists bid requests filtered by client_id', async () => {
    const rows = await (await fetch(`${BASE}/api/bid-requests?client_id=${clientId}`, { headers: authed() })).json();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.client_id === clientId)).toBe(true);
  });

  it('walks a full happy-path lifecycle to won', async () => {
    const c = await (await fetch(`${BASE}/api/clients`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ name: 'Lifecycle Co' }),
    })).json();
    const b = await (await fetch(`${BASE}/api/bid-requests`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ client_id: c.id, title: 'Full path' }),
    })).json();
    for (const to of ['reviewing', 'estimating', 'bid_sent', 'won']) {
      const r = await fetch(`${BASE}/api/bid-requests/${b.id}/transition`, {
        method: 'POST', headers: authed(), body: JSON.stringify({ to }),
      });
      expect(r.status).toBe(200);
      expect((await r.json()).status).toBe(to);
    }
    const final = await (await fetch(`${BASE}/api/bid-requests/${b.id}`, { headers: authed() })).json();
    expect(final.status).toBe('won');
    expect(final.status_history).toHaveLength(5);
  });
});

describe('AB1 CRM API — client delete fails closed when bids are attached', () => {
  it('returns 409 (not a 500) for a client that has bid requests, and deletes nothing', async () => {
    const client = await (await fetch(`${BASE}/api/clients`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ name: 'Has Bids Co' }),
    })).json();
    await fetch(`${BASE}/api/bid-requests`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ client_id: client.id, title: 'Attached bid' }),
    });

    const del = await fetch(`${BASE}/api/clients/${client.id}`, { method: 'DELETE', headers: authed() });
    expect(del.status).toBe(409);
    const body = await del.json();
    expect(body.error).toMatch(/bid requests/i);

    // Fail-closed: the client must still exist.
    const got = await fetch(`${BASE}/api/clients/${client.id}`, { headers: authed() });
    expect(got.status).toBe(200);
  });

  it('deletes a client with no bid requests', async () => {
    const client = await (await fetch(`${BASE}/api/clients`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ name: 'No Bids Co' }),
    })).json();
    const del = await fetch(`${BASE}/api/clients/${client.id}`, { method: 'DELETE', headers: authed() });
    expect(del.status).toBe(200);
    const got = await fetch(`${BASE}/api/clients/${client.id}`, { headers: authed() });
    expect(got.status).toBe(404);
  });
});

describe('AB1 CRM API — corrupt status_history fails closed (audit honesty)', () => {
  // Helper: write a raw blob straight into the DB over a second connection
  // (server runs in WAL mode, so concurrent writes are allowed).
  function corruptHistory(bidId, blob) {
    const conn = new Database(dbPath);
    try {
      conn.prepare('UPDATE bid_requests SET status_history = ? WHERE id = ?').run(blob, bidId);
    } finally {
      conn.close();
    }
  }

  async function makeBid() {
    const c = await (await fetch(`${BASE}/api/clients`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ name: 'Corrupt Co' }),
    })).json();
    return (await (await fetch(`${BASE}/api/bid-requests`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ client_id: c.id, title: 'Corrupt history bid' }),
    })).json()).id;
  }

  it('GET /:id returns 500 (not an empty history) when status_history is unparseable JSON', async () => {
    const id = await makeBid();
    corruptHistory(id, '{not json');
    const res = await fetch(`${BASE}/api/bid-requests/${id}`, { headers: authed() });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/corrupt/i);
  });

  it('GET /:id returns 500 when status_history parses to a non-array', async () => {
    const id = await makeBid();
    corruptHistory(id, '{"status":"received"}');
    const res = await fetch(`${BASE}/api/bid-requests/${id}`, { headers: authed() });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/corrupt/i);
  });

  it('GET list returns 500 when any row has corrupt history (does not mask it as empty)', async () => {
    const id = await makeBid();
    corruptHistory(id, 'null');
    const res = await fetch(`${BASE}/api/bid-requests`, { headers: authed() });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/corrupt/i);
  });

  it('POST /:id/transition refuses to run on corrupt history and does NOT overwrite it', async () => {
    const id = await makeBid();
    corruptHistory(id, 'definitely not json');
    const res = await fetch(`${BASE}/api/bid-requests/${id}/transition`, {
      method: 'POST', headers: authed(), body: JSON.stringify({ to: 'reviewing' }),
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/corrupt/i);

    // The corrupt blob must be untouched (forensic evidence preserved).
    const conn = new Database(dbPath);
    try {
      const row = conn.prepare('SELECT status, status_history FROM bid_requests WHERE id = ?').get(id);
      expect(row.status_history).toBe('definitely not json');
      expect(row.status).toBe('received');
    } finally {
      conn.close();
    }
  });

  it('an empty/NULL status_history is still treated as a legitimate empty history', async () => {
    const id = await makeBid();
    corruptHistory(id, '');
    const res = await fetch(`${BASE}/api/bid-requests/${id}`, { headers: authed() });
    expect(res.status).toBe(200);
    expect(await (await fetch(`${BASE}/api/bid-requests/${id}`, { headers: authed() })).json()
      .then((b) => b.status_history)).toEqual([]);
  });
});
