import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3196;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT = '/api/projects/Cooperative%201881%20-%20PDF%20Intake';
const PDF_PATH = path.join(ROOT, 'plans', 'cooperative-1881', '1881-architecturals.pdf');
let server;
let tempDir;
let token;

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  if (!fs.existsSync(PDF_PATH)) return;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pdf-intake-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'pdf-intake-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'pdf-intake-test-pw' }),
  })).json()).token;
}, 20000);

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((r) => server.once('exit', r));
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('PDF sprinkler-bid intake', () => {
  it.skipIf(!fs.existsSync(PDF_PATH))('returns a building-shaped model plus extraction intake stats for the real cooperative 1881 PDF', async () => {
    const pdf = fs.readFileSync(PDF_PATH).toString('base64');
    const res = await fetch(`${BASE}${PROJECT}/sprinkler-bid`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        pdf,
        pdfPageIndex: 7,
        pdfScale: 0.148148148,
        pdfExtract: 'vector',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isBuilding).toBe(true);
    expect(body.cadModel.counts.spaces).toBeGreaterThan(0);
    expect(body.cadModel.counts.walls).toBeGreaterThan(0);
    expect(body.pdfMeta).toEqual(expect.objectContaining({
      source: 'vector',
      extraction: 'plan-extract-building',
      needsVerification: true,
    }));
    expect(body.pdfMeta.intake.levels).toBe(1);
    expect(body.pdfMeta.intake.walls).toBeGreaterThan(0);
    expect(body.pdfMeta.intake.spaces).toBeGreaterThan(0);
    expect(body.pdfMeta.scaleFtPerUnit).toBeGreaterThan(0);
  }, 30000);
});
