import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COOPERATIVE_1881_PROJECT_NAME } from '../src/data/floorplans.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3202;
const BASE = `http://127.0.0.1:${PORT}`;
const COOPERATIVE_1881_PATH = `/api/projects/${encodeURIComponent(COOPERATIVE_1881_PROJECT_NAME)}`;

let server;
let tempDir;
let token;

function makeMultiPagePdf() {
  const streams = [
    '0 0 m 300 0 l 300 200 l 0 200 l 0 0 l S\n',
    '0 0 m 612 0 l 612 792 l 0 792 l 0 0 l S\n',
    '0 0 m 840 0 l 840 594 l 0 594 l 0 0 l S\n',
  ];
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << >> >>',
    `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 840 594] /Contents 8 0 R /Resources << >> >>',
    `<< /Length ${streams[2].length} >>\nstream\n${streams[2]}endstream`,
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function request(pathname, options = {}) {
  return fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try {
      const r = await request('/api/health');
      if (r.ok) return;
    } catch {
      // server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pdf-inspect-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin',
      HALOFIRE_ADMIN_PASSWORD: 'pdf-inspect-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'pdf-inspect-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('PDF page inspection API', () => {
  it('requires authentication', async () => {
    const res = await request('/api/pdf/inspect', {
      method: 'POST',
      body: JSON.stringify({ pdf: makeMultiPagePdf().toString('base64') }),
    });
    expect(res.status).toBe(401);
  });

  it('returns page count and per-page dimensions for employee page selection', async () => {
    const res = await request('/api/pdf/inspect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pdf: makeMultiPagePdf().toString('base64') }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageCount).toBe(3);
    expect(body.pages).toEqual([
      { index: 0, widthPt: 300, heightPt: 200, rotation: 0 },
      { index: 1, widthPt: 612, heightPt: 792, rotation: 0 },
      { index: 2, widthPt: 840, heightPt: 594, rotation: 0 },
    ]);
    expect(body.note).toContain('page selection');
    expect(body.blockedClaims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AHJ_approval']));
  }, 30000);

  it('rejects an invalid PDF with 400', async () => {
    const res = await request('/api/pdf/inspect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pdf: Buffer.from('not a pdf').toString('base64') }),
    });
    expect(res.status).toBe(400);
  }, 30000);

  it('returns selected-page boundary candidates without clearing regulated claims', async () => {
    const res = await request('/api/pdf/boundary-candidates', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdf: makeMultiPagePdf().toString('base64'),
        pdfPageIndex: 0,
        pdfScale: 0.1,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageIndex).toBe(0);
    expect(body.scale).toBe(0.1);
    expect(body.candidates.map((c) => c.mode)).toEqual([
      'vector',
      'dominant',
      'fullExtent',
      'outline',
      'wallLayer',
    ]);
    for (const candidate of body.candidates) {
      expect(candidate.status).toBe('candidate');
      expect(candidate.bbox.widthFt).toBeGreaterThan(0);
      expect(candidate.bbox.heightFt).toBeGreaterThan(0);
      expect(candidate.segmentCount).toBeGreaterThan(0);
      expect(candidate.blockedClaims).toEqual(expect.arrayContaining(['geometry_accuracy', 'AHJ_approval']));
    }
    const outline = body.candidates.find((c) => c.mode === 'outline');
    expect(outline.method).toBeTruthy();
    expect(outline.areaSqft).toBeGreaterThan(0);
    const wallLayer = body.candidates.find((c) => c.mode === 'wallLayer');
    expect(wallLayer.method).toBeTruthy();
    expect(wallLayer.wallSegmentCount).toBeGreaterThan(0);
    expect(body.note).toContain('candidate');
  }, 30000);

  it('rejects boundary candidates when operator scale is missing', async () => {
    const res = await request('/api/pdf/boundary-candidates', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdf: makeMultiPagePdf().toString('base64'),
        pdfPageIndex: 0,
      }),
    });
    expect(res.status).toBe(400);
  }, 30000);

  it('persists an employee-selected boundary decision as best-effort evidence for 1881 without clearing gates', async () => {
    const candidate = {
      mode: 'outline',
      label: 'Wall-network outline',
      status: 'candidate',
      bbox: { minX: 0, minY: 0, maxX: 120, maxY: 80, widthFt: 120, heightFt: 80 },
      segmentCount: 12,
      areaSqft: 9600,
      method: 'wall-network-outline',
      blockedClaims: [
        'geometry_accuracy',
        'drawing_scale',
        'AHJ_approval',
        'PE_review',
        'AutoSprink_parity',
        'permit_ready',
        'fabrication_ready',
        'manufacturer_exact',
      ],
    };
    const res = await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 7,
        pdfScale: 0.0833,
        pdfExtract: 'outline',
        candidate,
        source_file: 'Proposal-Cooperative 1881-Salt Lake City UT-9-18-25.xlsx',
        source_ref: '1881 plan PDF sheet 7 / outline candidate',
        notes: 'Employee chose sheet 7 and outline extraction pending professional review.',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.evidence.evidence_type).toBe('pdf_boundary_decision');
    expect(body.evidence.status).toBe('best_effort');
    expect(body.decision.projectName).toBe(COOPERATIVE_1881_PROJECT_NAME);
    expect(body.decision.pageIndex).toBe(7);
    expect(body.decision.scale).toBe(0.0833);
    expect(body.decision.extractMode).toBe('outline');
    expect(body.decision.candidate.bbox.widthFt).toBe(120);
    expect(body.decision.blockedClaims).toEqual(expect.arrayContaining(['AutoSprink_parity', 'permit_ready']));

    const latest = await (await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(latest.decision.pageIndex).toBe(7);
    expect(latest.evidence.status).toBe('best_effort');

    const evidence = await (await request(`${COOPERATIVE_1881_PATH}/evidence`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    const row = evidence.find((e) => e.id === body.evidence.id);
    expect(row).toBeTruthy();
    expect(row.status).toBe('best_effort');
    expect(row.notes).toContain('claims still blocked');
  }, 30000);

  it('rejects a persisted boundary decision without a positive operator scale', async () => {
    const res = await request(`${COOPERATIVE_1881_PATH}/pdf-boundary-decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pdfPageIndex: 0,
        pdfScale: 0,
        pdfExtract: 'outline',
        candidate: { mode: 'outline', bbox: { widthFt: 10, heightFt: 10 }, segmentCount: 4 },
      }),
    });
    expect(res.status).toBe(400);
  });
});
