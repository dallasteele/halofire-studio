import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildSamInvoker } from '../src/api/sam-invoker.js';

// T36 — END-TO-END coverage of the SERVER "pdf" plan source with the SAM extraction
// branch wired in (resolvePdfFloorPlan -> floorPlanFromPdf extract:"sam" -> the
// production OpenClaw SAM invoker built from OPENCLAW_BRIDGE_URL).
//
// T35 built the engine + adapter (sam-floorplan.js + floorPlanFromPdf extract:"sam"),
// but the SERVER resolvePdfFloorPlan did NOT import sam-floorplan or pass a SAM
// invoker, so an API caller could not trigger SAM segmentation. T36 closes that
// wiring gap, FAIL-SOFT.
//
// HONESTY (fail-closed): the OpenClaw/SAM bridge on GX10 is CURRENTLY HTTP_UNREACHABLE.
// These tests do NOT run a real SAM segmentation. They prove the WIRING + the fail-soft
// FALLBACK to the existing VECTOR path (so a SAM request still 200s with a real bid and
// a samSkipped marker), and that the invoker is only constructed when SAM is requested
// AND OPENCLAW_BRIDGE_URL is set. NO SAM polygon is fabricated. The scale stays
// operator-supplied (400 on missing/<=0). No parity/accuracy/AHJ/PE claim.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3207;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJ = '/api/projects/PDF%20SAM%20Server%20Test';

let server; let tempDir; let token;

/**
 * Build a PORTABLE, deterministic MINIMAL VECTOR PDF in-test (identical fixture to
 * tests/pdf-to-bid-api.test.js): a single page drawing an outer rect 0,0..800,600 and
 * an inner rect 100,100..700,500 with explicit PDF path ops. pdfjs emits these as
 * constructPath ops that extractSegmentsFromOpList walks into line segments (used by
 * the VECTOR FALLBACK path when SAM is skipped).
 */
function makeTinyVectorPdf() {
  const content =
    '0 0 m 800 0 l 800 600 l 0 600 l 0 0 l S\n' +
    '100 100 m 700 100 l 700 500 l 100 500 l 100 100 l S\n';
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 600] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  const n = objects.length;
  let xref = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function waitForHealth() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not healthy');
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pdfsam-'));
  // CRITICAL: the spawned server env MUST NOT carry OPENCLAW_BRIDGE_URL, so the SAM
  // request exercises the fail-soft fallback (no bridge wired -> samSkipped -> vector).
  const env = { ...process.env };
  delete env.OPENCLAW_BRIDGE_URL;
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'pdfsam-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'pdfsam-test-pw' }),
  })).json()).token;
});

afterAll(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const post = (body) => fetch(`${BASE}${PROJ}/sprinkler-bid`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

describe('T36 SAM extraction wired into the server pdf path (fail-soft)', () => {
  it('(a) pdfExtract:"sam" with NO OPENCLAW_BRIDGE_URL -> 200 + REAL bid via the vector fallback + samSkipped meta', async () => {
    const pdf = makeTinyVectorPdf().toString('base64');
    const res = await post({ pdf, pdfPageIndex: 0, pdfScale: 0.05, pdfExtract: 'sam', hazard: 'ordinary' });
    expect(res.status).toBe(200);
    const body = await res.json();

    // FAIL-SOFT FALLBACK: a real bid came out the VECTOR path even though SAM was requested.
    expect(body.bid).toBeTruthy();
    expect(body.bid.totalHeadCount).toBeGreaterThan(0);
    expect(body.cadModel).toBeTruthy();
    expect(body.cadModel.counts.heads).toBeGreaterThan(0);

    // The SAM request was honestly recorded as SKIPPED (no bridge wired); NOT fabricated.
    expect(body.pdfMeta).toBeTruthy();
    expect(body.pdfMeta.samSkipped).toBe(true);
    expect(typeof body.pdfMeta.samReason).toBe('string');
    expect(body.pdfMeta.samReason.length).toBeGreaterThan(0);

    // The fallback bid is the VECTOR footprint: real geometry, NOT a SAM polygon.
    expect(body.pdfMeta.segmentCount).toBeGreaterThan(0);
    expect(body.pdfMeta.bbox).toBeTruthy();
    expect(body.pdfMeta.bbox.widthFt).toBeGreaterThan(0);
    expect(body.pdfMeta.scale).toBe(0.05);
  }, 30000);

  it('(b) missing/<=0 pdfScale with pdfExtract:"sam" -> 400 (scale guard still applies, never 500)', async () => {
    const pdf = makeTinyVectorPdf().toString('base64');

    const missing = await post({ pdf, pdfPageIndex: 0, pdfExtract: 'sam' });
    expect(missing.status).toBe(400);
    expect(missing.status).not.toBe(500);

    const zero = await post({ pdf, pdfPageIndex: 0, pdfScale: 0, pdfExtract: 'sam' });
    expect(zero.status).toBe(400);

    const negative = await post({ pdf, pdfPageIndex: 0, pdfScale: -0.05, pdfExtract: 'sam' });
    expect(negative.status).toBe(400);
  }, 30000);

  it('(c) default path (no pdfExtract) returns the vector footprint unchanged (no samSkipped meta)', async () => {
    const pdf = makeTinyVectorPdf().toString('base64');
    const res = await post({ pdf, pdfPageIndex: 0, pdfScale: 0.05, hazard: 'ordinary' });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.bid).toBeTruthy();
    expect(body.bid.totalHeadCount).toBeGreaterThan(0);
    expect(body.pdfMeta).toBeTruthy();
    expect(body.pdfMeta.segmentCount).toBeGreaterThan(0);
    expect(body.pdfMeta.scale).toBe(0.05);
    // The default (non-sam) path must NOT carry any SAM markers.
    expect(body.pdfMeta.samSkipped).toBeUndefined();
    expect(body.pdfMeta.samReason).toBeUndefined();
  }, 30000);
});

describe('T36 buildSamInvoker — constructed only when SAM requested AND bridge URL set', () => {
  it('returns null when no bridge URL is provided (no invoker, no bridge call possible)', () => {
    expect(buildSamInvoker({ bridgeUrl: undefined, fetchImpl: () => {} })).toBe(null);
    expect(buildSamInvoker({ bridgeUrl: '', fetchImpl: () => {} })).toBe(null);
    expect(buildSamInvoker({})).toBe(null);
  });

  it('returns a single-arg payload invoker when a bridge URL is set, calling the bridge with {tool,args}', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ result: { layers: { walls: [[0, 0]] } } }) };
    };
    const invoker = buildSamInvoker({ bridgeUrl: 'http://127.0.0.1:15000', fetchImpl });
    expect(typeof invoker).toBe('function');

    // segmentFloorPlanViaSam calls invoker(payload) with ONE argument.
    const payload = { service: 'sam-3.1', op: 'segment_floorplan', pdfRef: 'x', pageIndex: 0, scale: 0.05, targets: ['building_outline'] };
    await invoker(payload);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/codex-bridge/invoke');
    // The bridge receives a sensible {tool, args} envelope carrying the SAM payload.
    expect(calls[0].body.tool).toBe('sam_segment_floorplan');
    expect(calls[0].body.args).toEqual(payload);
  });
});
