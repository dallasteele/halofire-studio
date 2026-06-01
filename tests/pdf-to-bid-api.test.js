import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// T30 — END-TO-END integration coverage of the server "pdf" plan source.
//
// T28 wired POST /api/projects/:name/sprinkler-bid to accept a base64 vector PDF
// (req.body.pdf + pdfPageIndex + pdfScale) -> resolvePdfFloorPlan ->
// floorPlanFromPdf -> normalizeFloorPlan -> runSprinklerPipeline -> a full bid.
// The existing PDF tests (tests/pdf-floorplan*.test.js) are ENGINE-ONLY; nothing
// exercised the server pdf->bid chain end to end. This closes that gap.
//
// HONESTY: this is INTEGRATION COVERAGE of the plumbing, NOT a DoD d4 / accuracy
// claim. The PDF + scale are SYNTHETIC TEST inputs; the test asserts the chain
// produces a bid, NOT that the bid matches any real-world total. d4 stays OPEN
// (still needs a real building page + true scale from the user). No tuning; the
// AUTOSPRINK_PARITY gate stays blocked.
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3201;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJ = '/api/projects/PDF%20To%20Bid%20Test';

let server; let tempDir; let token;

/**
 * Build a PORTABLE, deterministic MINIMAL VECTOR PDF in-test. The single page's
 * Contents stream draws two building rectangles with explicit PDF path operators
 * ("X Y m" moveTo, "X Y l" lineTo, "S" stroke): an outer rect 0,0..800,600 and an
 * inner rect 100,100..700,500. The xref byte offsets are COMPUTED so the file is
 * a structurally valid PDF (latin1 byte-accurate). pdfjs emits these as
 * constructPath ops, which extractSegmentsFromOpList walks into line segments.
 */
function makeTinyVectorPdf() {
  const content =
    '0 0 m 800 0 l 800 600 l 0 600 l 0 0 l S\n' +
    '100 100 m 700 100 l 700 500 l 100 500 l 100 100 l S\n';
  const objects = [
    null, // PDF objects are 1-based; index 0 is the free entry.
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 600] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1'); // byte offset of "i 0 obj"
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  const n = objects.length; // total entries incl. the free entry 0
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-pdf2bid-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'h.db'),
      JWT_SECRET: 'test-jwt-secret-with-more-than-32-characters',
      HALOFIRE_ADMIN_USER: 'admin', HALOFIRE_ADMIN_PASSWORD: 'pdf2bid-test-pw',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0', HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'pdf2bid-test-pw' }),
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

describe('T30 PDF plan source wired end-to-end into sprinkler-bid', () => {
  // SANITY: the in-test fixture must parse via the SAME pdfjs the server uses.
  // If this fails, the API cases below would fail for fixture reasons, not wiring.
  it('the tiny-PDF fixture parses via the real pdfjs (operator list -> segments)', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const require = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    const data = new Uint8Array(makeTinyVectorPdf());
    const doc = await pdfjs.getDocument({
      data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true,
    }).promise;
    const page = await doc.getPage(1); // page 0 -> 1-based
    const opList = await page.getOperatorList();
    expect(opList.fnArray.length).toBeGreaterThan(0);
  }, 30000);

  it('(a) accepts a base64 vector PDF + operator scale and returns a REAL bid', async () => {
    const pdf = makeTinyVectorPdf().toString('base64');
    // scale 0.05 ft/pt on the 800x600pt page -> a 40x30 ft plan footprint.
    const res = await post({ pdf, pdfPageIndex: 0, pdfScale: 0.05, hazard: 'ordinary' });
    expect(res.status).toBe(200);
    const body = await res.json();

    // A real bid came out the far end of the pdf->floorplan->layout->bid chain.
    expect(body.bid).toBeTruthy();
    expect(body.bid.totalHeadCount).toBeGreaterThan(0);
    expect(body.cadModel).toBeTruthy();
    expect(body.cadModel.counts.heads).toBeGreaterThan(0);
    expect(body.cadModel.counts.pipes).toBeGreaterThan(0);
    expect(body.scene).toBeTruthy();
    // A single-room footprint plan, not a multi-space building.
    expect(body.isBuilding).toBe(false);

    // pdfMeta is surfaced honestly: real geometry extracted at the operator scale.
    expect(body.pdfMeta).toBeTruthy();
    expect(body.pdfMeta.segmentCount).toBeGreaterThan(0);
    expect(body.pdfMeta.scale).toBe(0.05);
    expect(body.pdfMeta.pageIndex).toBe(0);
    expect(typeof body.pdfMeta.note).toBe('string');
    // The note is the honest first-pass-footprint disclaimer (NOT an accuracy claim).
    expect(body.pdfMeta.note.toLowerCase()).toContain('best-effort');
    expect(body.pdfMeta.bbox).toBeTruthy();
    expect(body.pdfMeta.bbox.widthFt).toBeGreaterThan(0);
    expect(body.pdfMeta.bbox.heightFt).toBeGreaterThan(0);

    // NOTE: deliberately NO real-dollar / total assertion here. This is coverage
    // of the wiring; the synthetic plan + arbitrary scale do not produce a
    // real-world total and we make no such claim.
  }, 30000);

  it('(b) rejects a missing/<=0 pdfScale with 400 (never 500)', async () => {
    const pdf = makeTinyVectorPdf().toString('base64');

    const missing = await post({ pdf, pdfPageIndex: 0 });
    expect(missing.status).toBe(400);

    const zero = await post({ pdf, pdfPageIndex: 0, pdfScale: 0 });
    expect(zero.status).toBe(400);

    const negative = await post({ pdf, pdfPageIndex: 0, pdfScale: -0.05 });
    expect(negative.status).toBe(400);
  }, 30000);

  it('(c) rejects an invalid/garbage base64 PDF with 400 (never 500)', async () => {
    // A non-PDF base64 payload: decodes to bytes but is not a parseable PDF.
    const notPdf = Buffer.from('this is not a pdf at all', 'utf8').toString('base64');
    const res = await post({ pdf: notPdf, pdfPageIndex: 0, pdfScale: 0.05 });
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  }, 30000);

  it('(d) gates unchanged: full-scope bid is estimate:true and AUTOSPRINK_PARITY stays blocked', async () => {
    const pdf = makeTinyVectorPdf().toString('base64');
    const res = await post({ pdf, pdfPageIndex: 0, pdfScale: 0.05, hazard: 'ordinary' });
    expect(res.status).toBe(200);
    const body = await res.json();

    // The full-scope bid stays a flagged ESTIMATE; nothing flips a gate.
    const fsb = body.fullScopeBid;
    expect(fsb).toBeTruthy();
    expect(fsb.error).toBeUndefined();
    expect(fsb.estimate).toBe(true);
    expect(fsb.parity).toBeUndefined();
    expect(fsb.approved).not.toBe(true);
    expect(fsb.submittalReady).not.toBe(true);

    // The regulated parity gate is untouched by the pdf path.
    const parityRes = await fetch(`${BASE}/api/parity`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` },
    });
    expect(parityRes.status).toBe(200);
    const parityBody = await parityRes.json();
    expect(parityBody.gate.status).toBe('blocked');
    expect(parityBody.parityAchieved).not.toBe(true);
  }, 30000);

  it('(e) honors pdfExtract:"outline" and surfaces the extraction method in pdfMeta', async () => {
    const pdf = makeTinyVectorPdf().toString('base64');
    const res = await post({
      pdf,
      pdfPageIndex: 0,
      pdfScale: 0.05,
      pdfExtract: 'outline',
      hazard: 'ordinary',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bid.totalHeadCount).toBeGreaterThan(0);
    expect(body.pdfMeta).toBeTruthy();
    expect(body.pdfMeta.method).toBe('wall-network-occupancy-grid');
    expect(body.pdfMeta.wallSegmentCount).toBeGreaterThan(0);
    expect(body.pdfMeta.areaSqft).toBeGreaterThan(0);
    expect(body.pdfMeta.samSkipped).toBeUndefined();
  }, 30000);
});
