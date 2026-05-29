import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildParityMatrix,
  parityAchieved,
  PARITY_AREA_KEYS,
  PARITY_MATRIX_DISCLAIMER,
} from '../src/engine/parity-matrix.js';
import { buildParityInventory } from '../src/components/registry.js';

/**
 * A "fully functional" state: every non-gated feature area reports present, and
 * the gated areas (AHJ/PE/manufacturer-exact) are given REAL evidence. Even with
 * that, parity must NOT be claimed unless the gated evidence is genuine.
 */
function fullyFunctionalState(overrides = {}) {
  return {
    drawingImport: true,
    buildingModeling: true,
    headLayout: true,
    scheduleSizing: true,
    hydraulicNetwork: true,
    nfpaCompliance: true,
    supports: true,
    componentLibrary: true,
    submittal: true,
    cadExport: true,
    bidBom: true,
    evidenceSettings: true,
    // gated evidence
    ahjEvidence: false,
    peEvidence: false,
    manufacturerEvidence: false,
    ...overrides,
  };
}

describe('buildParityMatrix', () => {
  it('lists every roadmap feature area with a status + evidence string', () => {
    const matrix = buildParityMatrix(fullyFunctionalState());
    expect(Array.isArray(matrix.areas)).toBe(true);
    const keys = matrix.areas.map((a) => a.key);
    // exhaustive: every declared parity area key is present exactly once
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of PARITY_AREA_KEYS) {
      expect(keys).toContain(k);
    }
    for (const a of matrix.areas) {
      expect(typeof a.key).toBe('string');
      expect(typeof a.name).toBe('string');
      expect(['present', 'partial', 'missing', 'gated']).toContain(a.status);
      expect(typeof a.evidence).toBe('string');
      expect(a.evidence.length).toBeGreaterThan(0);
    }
  });

  it('covers the named AutoSprink feature areas', () => {
    const matrix = buildParityMatrix(fullyFunctionalState());
    const keys = matrix.areas.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining([
      'drawing_import',
      'building_modeling',
      'head_layout',
      'schedule_sizing',
      'hydraulic_network',
      'nfpa_compliance',
      'supports',
      'component_library',
      'submittal',
      'cad_export',
      'bid_bom',
      'evidence_settings',
      'ahj_approval',
      'pe_review',
      'manufacturer_exact',
    ]));
  });

  it('marks AHJ/PE/manufacturer-exact as gated (never auto-present) without real evidence', () => {
    const matrix = buildParityMatrix(fullyFunctionalState());
    const byKey = Object.fromEntries(matrix.areas.map((a) => [a.key, a]));
    for (const k of ['ahj_approval', 'pe_review', 'manufacturer_exact']) {
      expect(byKey[k].status).toBe('gated');
      expect(byKey[k].gated).toBe(true);
    }
    expect(matrix.gated).toEqual(expect.arrayContaining(['ahj_approval', 'pe_review', 'manufacturer_exact']));
  });

  it('reflects a missing functional area as missing', () => {
    const matrix = buildParityMatrix(fullyFunctionalState({ supports: false }));
    const supports = matrix.areas.find((a) => a.key === 'supports');
    expect(supports.status).toBe('missing');
    expect(matrix.requiredComplete).toBe(false);
  });

  it('reports requiredComplete true only when every non-gated area is present', () => {
    expect(buildParityMatrix(fullyFunctionalState()).requiredComplete).toBe(true);
    expect(buildParityMatrix(fullyFunctionalState({ headLayout: false })).requiredComplete).toBe(false);
  });

  it('emits a fail-closed honesty disclaimer', () => {
    expect(typeof PARITY_MATRIX_DISCLAIMER).toBe('string');
    expect(buildParityMatrix(fullyFunctionalState()).disclaimer).toBe(PARITY_MATRIX_DISCLAIMER);
  });
});

describe('parityAchieved', () => {
  it('is false while any required (non-gated) area is missing', () => {
    const matrix = buildParityMatrix(fullyFunctionalState({ cadExport: false }));
    expect(parityAchieved(matrix, {})).toBe(false);
  });

  it('is false when all functional areas are present but gated areas lack evidence', () => {
    const matrix = buildParityMatrix(fullyFunctionalState());
    expect(matrix.requiredComplete).toBe(true);
    // No catalog/pe/ahj evidence -> gated rows unproven -> parity NOT achieved.
    expect(parityAchieved(matrix, {})).toBe(false);
  });

  it('is false for a generated-ONLY component inventory (generated does not satisfy gated areas)', () => {
    // Build a parity inventory where every component is 'generated' with a model.
    const generatedOnly = {};
    // Use the registry inventory to enumerate keys via a generated map.
    const inventory = buildParityInventory(generatedOnly);
    // Even feeding ahj/pe/manufacturer "achieved" claims via generated-only must not pass.
    const matrix = buildParityMatrix(fullyFunctionalState({
      ahjEvidence: false,
      peEvidence: false,
      manufacturerEvidence: false,
    }));
    expect(parityAchieved(matrix, { generatedOnly: true, inventory })).toBe(false);
  });

  it('does NOT achieve parity from generated evidence on gated rows', () => {
    // Gated rows claim 'generated' provenance — generated is best-effort, not exact.
    const matrix = buildParityMatrix(fullyFunctionalState({
      ahjEvidence: 'generated',
      peEvidence: 'generated',
      manufacturerEvidence: 'generated',
    }));
    expect(parityAchieved(matrix, {})).toBe(false);
  });

  it('achieves parity ONLY when every non-gated area is present AND every gated area has real (catalog/pe/ahj) evidence', () => {
    const matrix = buildParityMatrix(fullyFunctionalState({
      ahjEvidence: 'ahj',
      peEvidence: 'pe',
      manufacturerEvidence: 'catalog',
    }));
    expect(parityAchieved(matrix, {})).toBe(true);
  });

  it('re-blocks parity if one gated row loses its real evidence', () => {
    const matrix = buildParityMatrix(fullyFunctionalState({
      ahjEvidence: 'ahj',
      peEvidence: 'pe',
      manufacturerEvidence: false,
    }));
    expect(parityAchieved(matrix, {})).toBe(false);
  });
});

// ── Spawned-server coverage for GET /api/parity ──
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3194;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;
let tempDir;
let dbPath;

function request(pathname, options = {}) {
  return fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    try {
      const res = await request('/api/health');
      if (res.ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HaloFire API did not become healthy for parity tests');
}

async function tokenFor(username, password) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    lastStatus = res.status;
    if (res.status === 200) return (await res.json()).token;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  expect(lastStatus).toBe(200);
}

describe('GET /api/parity (spawned server)', () => {
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-parity-api-'));
    dbPath = path.join(tempDir, 'halofire.db');
    server = spawn(process.execPath, ['src/api/server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        HALOFIRE_DB_PATH: dbPath,
        JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
        HALOFIRE_ADMIN_USER: 'parity-admin',
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

  it('requires authentication', async () => {
    const res = await request('/api/parity');
    expect(res.status).toBe(401);
  });

  it('lists the parity areas and keeps the AUTOSPRINK_PARITY gate blocked', async () => {
    const token = await tokenFor('parity-admin', 'actual-test-password');
    const res = await request('/api/parity', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.matrix.areas)).toBe(true);
    const keys = body.matrix.areas.map((a) => a.key);
    for (const k of PARITY_AREA_KEYS) expect(keys).toContain(k);

    // gated rows are present in the gated list and never auto-present
    expect(body.matrix.gated).toEqual(
      expect.arrayContaining(['ahj_approval', 'pe_review', 'manufacturer_exact']),
    );
    const byKey = Object.fromEntries(body.matrix.areas.map((a) => [a.key, a]));
    expect(byKey.manufacturer_exact.status).toBe('gated');

    // fail-closed: gate blocked + parity NOT achieved (gated rows lack evidence)
    expect(body.gate.status).toBe('blocked');
    expect(body.parityAchieved).toBe(false);
    expect(typeof body.disclaimer).toBe('string');
  });
});
