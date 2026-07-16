import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

// R4: per-component catalog part overrides attached via Settings.
// Catalog metadata is never enough for manufacturerExact:true. Exactness requires
// server-hashed local source/audit artifacts and render bytes matching a trusted
// operator registry. HONESTY/fail-closed:
// attaching a part NEVER clears AUTOSPRINK_PARITY (parityGateStatus stays
// 'blocked'), and a non-mesh (STEP/DWG) format is recorded but NOT web-renderable
// (file stays null). Admin-only writes; non-admin gets 403.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
let server; let tempDir; let dbPath; let token; let meshRoot; let evidenceRoot; let registryPath;
let trustedEvidence; let trustedMeshBytes;

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

function seedViewer() {
  const db = new Database(dbPath);
  const hash = bcrypt.hashSync('viewer-pw', 12);
  db.prepare('INSERT INTO users (username, password_hash, name, role, email) VALUES (?, ?, ?, ?, ?)').run(
    'parts-viewer', hash, 'Viewer', 'user', 'viewer@example.test',
  );
  db.close();
}

async function login(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (await res.json()).token;
}

const postOverride = (key, body, tok = token) => fetch(`${BASE}/api/parts/${key}/override`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
  body: JSON.stringify(body),
});

const getParts = async () => {
  const res = await fetch(`${BASE}/api/parts`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-part-override-'));
  dbPath = path.join(tempDir, 'h.db');
  meshRoot = path.join(tempDir, 'parts');
  evidenceRoot = path.join(tempDir, 'exact-part-evidence');
  registryPath = path.join(tempDir, 'trusted-exact-part-receipts.json');
  fs.mkdirSync(meshRoot, { recursive: true });
  fs.mkdirSync(evidenceRoot, { recursive: true });
  trustedMeshBytes = Buffer.from('solid trusted-part\nendsolid trusted-part\n');
  fs.writeFileSync(path.join(meshRoot, 'trusted-threaded-coupling.stl'), trustedMeshBytes);
  const artifactContents = {
    sourceFileSha256: Buffer.from('licensed manufacturer source CAD'),
    geometrySha256: Buffer.from('kernel geometry digest packet'),
    dimensionAuditReceiptSha256: Buffer.from('dimension audit receipt'),
    threadStandardSourceSha256: Buffer.from('thread standard source packet'),
    threadGeometrySha256: Buffer.from('thread geometry audit receipt'),
    solidKernelReceiptSha256: Buffer.from('solid kernel audit receipt'),
    sceneCollisionReceiptSha256: Buffer.from('scene collision audit receipt'),
    connectionFitReceiptSha256: Buffer.from('connection mating fit receipt'),
  };
  const artifactFiles = {};
  const artifactHashes = {};
  for (const [field, bytes] of Object.entries(artifactContents)) {
    const filename = `${field}.bin`;
    fs.writeFileSync(path.join(evidenceRoot, filename), bytes);
    artifactFiles[field] = filename;
    artifactHashes[field] = createHash('sha256').update(bytes).digest('hex');
  }
  trustedEvidence = {
    manufacturerPartNumber: 'HF-TEST-COUPLING-001',
    ...artifactHashes,
    renderMeshSha256: createHash('sha256').update(trustedMeshBytes).digest('hex'),
  };
  fs.writeFileSync(registryPath, JSON.stringify({
    artifactType: 'halofire.trusted-exact-part-receipt-registry.v1',
    receipts: [{
      status: 'verified',
      key: 'fitting_coupling',
      manufacturer: 'Verified Test Manufacturer',
      license: 'TEST-CAD-LICENSE',
      manufacturerPartNumber: trustedEvidence.manufacturerPartNumber,
      format: 'stl',
      threadRequired: true,
      artifactFiles,
      ...trustedEvidence,
    }],
  }));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: dbPath,
      HALOFIRE_TRUSTED_PART_RECEIPTS_PATH: registryPath,
      HALOFIRE_EXACT_PART_MESH_ROOT: meshRoot,
      HALOFIRE_EXACT_PART_EVIDENCE_ROOT: evidenceRoot,
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'override-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  seedViewer();
  token = await login('admin', 'override-test-pw');
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('R4 POST /api/parts/:key/override — auth + validation', () => {
  it('blocks non-admin users (403)', async () => {
    const viewerToken = await login('parts-viewer', 'viewer-pw');
    const res = await postOverride('head_pendent', { mode: 'link', url: 'https://x/y.stl', format: 'stl' }, viewerToken);
    expect(res.status).toBe(403);
  });

  it('rejects an unknown component key (404)', async () => {
    const res = await postOverride('not_a_real_key', { mode: 'link', url: 'https://x/y.stl', format: 'stl' });
    expect(res.status).toBe(404);
  });

  it('rejects an unsupported field (400)', async () => {
    const res = await postOverride('head_pendent', { mode: 'link', url: 'https://x/y.stl', bogus: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid mode (400)', async () => {
    const res = await postOverride('head_pendent', { mode: 'teleport', url: 'https://x/y.stl' });
    expect(res.status).toBe(400);
  });

  it('rejects a link override missing its url (400)', async () => {
    const res = await postOverride('head_pendent', { mode: 'link', format: 'stl' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed exact evidence (400)', async () => {
    const res = await postOverride('head_pendent', {
      mode: 'upload', filename: 'head.stl', format: 'stl',
      exactEvidence: { manufacturerPartNumber: 'HEAD-1', sourceFileSha256: 'not-a-hash' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('SHA-256');
  });

  it('rejects upload path traversal (400)', async () => {
    const res = await postOverride('head_pendent', {
      mode: 'upload', filename: '../outside.stl', format: 'stl',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('safe basename');
  });
});

describe('R4 catalog override merges into GET /api/parts', () => {
  it('a web-mesh link remains pending even with manufacturer and license metadata', async () => {
    const res = await postOverride('head_pendent', {
      mode: 'link',
      url: 'https://catalog.example/head_pendent.stl',
      format: 'stl',
      manufacturer: 'Tyco',
      license: 'TFP-LICENSE-2026',
      notes: 'TY323 pendent',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('catalog');
    expect(body.manufacturerExact).toBe(false);
    expect(body.exactVerification.status).toBe('pending');
    expect(body.exactVerification.blockerCodes).toContain('PART_EXACT_REMOTE_BYTES_UNVERIFIED');

    const { status, body: parts } = await getParts();
    expect(status).toBe(200);
    const entry = parts.components.find((c) => c.key === 'head_pendent');
    expect(entry).toBeDefined();
    expect(entry.source).toBe('catalog');
    expect(entry.manufacturerExact).toBe(false);
    expect(entry.exactVerification.status).toBe('pending');
    expect(entry.file).toBe('https://catalog.example/head_pendent.stl');
    expect(entry.present).toBe(true);
    expect(parts.manufacturerExactCount).toBe(0);
  });

  it('a non-mesh (STEP/DWG) override -> source catalog but file null (not web-renderable)', async () => {
    const res = await postOverride('head_upright', {
      mode: 'upload',
      filename: 'head_upright.step',
      format: 'step',
      manufacturer: 'Viking',
      license: 'VK-LICENSE-2026',
    });
    expect(res.status).toBe(200);

    const { body: parts } = await getParts();
    const entry = parts.components.find((c) => c.key === 'head_upright');
    expect(entry.source).toBe('catalog');
    // Rule: STEP/DWG is recorded as catalog evidence but is NOT web-renderable.
    expect(entry.file).toBeNull();
    expect(entry.present).toBe(false);
    expect(entry.manufacturerExact).toBe(false);
    expect(entry.exactVerification.blockerCodes).toContain('PART_EXACT_RENDER_MESH_MISSING');
  });

  it('a catalog override WITHOUT a license -> manufacturerExact false (fail-closed)', async () => {
    const res = await postOverride('head_sidewall', {
      mode: 'link',
      url: 'https://catalog.example/head_sidewall.glb',
      format: 'glb',
      manufacturer: 'Reliable',
    });
    expect(res.status).toBe(200);
    const { body: parts } = await getParts();
    const entry = parts.components.find((c) => c.key === 'head_sidewall');
    expect(entry.source).toBe('catalog');
    expect(entry.manufacturerExact).toBe(false); // no license attested
    expect(entry.file).toBe('https://catalog.example/head_sidewall.glb');
  });

  it('client-supplied valid hashes remain pending without a matching trusted receipt', async () => {
    const res = await postOverride('head_concealed', {
      mode: 'upload', filename: 'untrusted.stl', format: 'stl',
      manufacturer: 'Unknown', license: 'CLAIMED', exactEvidence: trustedEvidence,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manufacturerExact).toBe(false);
    expect(body.exactVerification.blockerCodes).toContain('PART_EXACT_RECEIPT_UNTRUSTED');
  });

  it('keeps a threaded trusted part pending when its thread evidence is omitted', async () => {
    const evidenceWithoutThreads = {
      ...trustedEvidence,
      threadStandardSourceSha256: null,
      threadGeometrySha256: null,
    };
    const res = await postOverride('fitting_coupling', {
      mode: 'upload', filename: 'trusted-threaded-coupling.stl', format: 'stl',
      manufacturer: 'Verified Test Manufacturer', license: 'TEST-CAD-LICENSE',
      exactEvidence: evidenceWithoutThreads,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manufacturerExact).toBe(false);
    expect(body.exactVerification.exactSourceReady).toBe(false);
    expect(body.exactVerification.blockerCodes).toContain('PART_EXACT_THREAD_EVIDENCE_MISSING');
  });

  it('verifies a local mesh only when every trusted receipt field and byte hash match', async () => {
    const res = await postOverride('fitting_coupling', {
      mode: 'upload', filename: 'trusted-threaded-coupling.stl', format: 'stl',
      manufacturer: 'Verified Test Manufacturer', license: 'TEST-CAD-LICENSE',
      exactEvidence: trustedEvidence,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manufacturerExact).toBe(true);
    expect(body.exactVerification).toEqual({
      status: 'verified', exactSourceReady: true, renderMeshReady: true, blockerCodes: [],
    });

    let parts = (await getParts()).body;
    let entry = parts.components.find((c) => c.key === 'fitting_coupling');
    expect(entry.manufacturerExact).toBe(true);
    expect(entry.manufacturerPartNumber).toBe('HF-TEST-COUPLING-001');
    expect(entry.exactVerification.status).toBe('verified');

    fs.writeFileSync(path.join(meshRoot, 'trusted-threaded-coupling.stl'), 'tampered');
    parts = (await getParts()).body;
    entry = parts.components.find((c) => c.key === 'fitting_coupling');
    expect(entry.manufacturerExact).toBe(false);
    expect(entry.exactVerification.renderMeshReady).toBe(false);
    expect(entry.exactVerification.blockerCodes).toContain('PART_EXACT_RENDER_MESH_HASH_MISMATCH');
    fs.writeFileSync(path.join(meshRoot, 'trusted-threaded-coupling.stl'), trustedMeshBytes);

    const fitReceiptPath = path.join(evidenceRoot, 'connectionFitReceiptSha256.bin');
    fs.writeFileSync(fitReceiptPath, 'tampered fit audit');
    parts = (await getParts()).body;
    entry = parts.components.find((c) => c.key === 'fitting_coupling');
    expect(entry.manufacturerExact).toBe(false);
    expect(entry.exactVerification.exactSourceReady).toBe(false);
    expect(entry.exactVerification.blockerCodes).toContain('PART_EXACT_AUDIT_ARTIFACT_HASH_MISMATCH');
    fs.writeFileSync(fitReceiptPath, 'connection mating fit receipt');
  });

  it('CRITICAL: parityGateStatus stays blocked AFTER overrides (gate never clears)', async () => {
    const { body: parts } = await getParts();
    expect(parts.parityGateStatus).toBe('blocked');
    expect(typeof parts.disclaimer).toBe('string');
    expect(parts.disclaimer.length).toBeGreaterThan(0);
  });

  it('keeps the library honest: required components without overrides stay missing', async () => {
    const { body: parts } = await getParts();
    // Some required components remain un-overridden -> still missing/not present.
    const stillMissing = parts.components.filter((c) => c.present !== true);
    expect(stillMissing.length).toBeGreaterThan(0);
    expect(parts.missingCount).toBeGreaterThan(0);
    // Every entry still carries an honest source tag.
    expect(parts.components.every((c) => ['catalog', 'manufacturer', 'generated', 'missing'].includes(c.source))).toBe(true);
    // No entry is manufacturerExact:true unless its source is catalog/manufacturer.
    expect(parts.components.every((c) => c.manufacturerExact !== true || ['catalog', 'manufacturer'].includes(c.source))).toBe(true);
  });
});

describe('R4 DELETE /api/parts/:key/override', () => {
  it('removes an override and the key reverts in GET /api/parts', async () => {
    const res = await fetch(`${BASE}/api/parts/head_pendent/override`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const { body: parts } = await getParts();
    const entry = parts.components.find((c) => c.key === 'head_pendent');
    expect(entry.source).not.toBe('catalog');
    expect(entry.manufacturerExact).not.toBe(true);
  });

  it('returns 404 when deleting a non-existent override', async () => {
    const res = await fetch(`${BASE}/api/parts/head_dry_pendent/override`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
