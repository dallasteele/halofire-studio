import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const pagePath = fileURLToPath(new URL('../autobid-draw.html', import.meta.url));
const html = readFileSync(pagePath, 'utf8');
const APP_ROOT = path.resolve(path.dirname(pagePath));
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
let server;
let browser;
let base;
let packageMode = 'pending';
let requests;

function packagePayload() {
  const legacyPlate = {
    label: 'A-101',
    bounds_ft: { min_x: 0, min_y: 0, max_x: 20, max_y: 10, width_ft: 20, height_ft: 10 },
    rooms: [{ x0_ft: 0, y0_ft: 0, x1_ft: 20, y1_ft: 10 }],
    heads: [{ x: 5, y: 5 }],
    pipe: { segments: [], cohesion_ok: true },
    head_count: 1,
  };
  const acceptedPlate = {
    ...legacyPlate,
    accepted_geometry: true,
    rooms: [{
      polygon_ft: [[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]],
      room_count: 1,
      head_count: 1,
    }],
    wallRuns: [
      { a: [0, 0], b: [20, 0] },
      { a: [20, 0], b: [20, 10] },
      { a: [20, 10], b: [0, 10] },
      { a: [0, 10], b: [0, 0] },
    ],
  };
  const accepted = packageMode === 'accepted';
  return {
    ref: 279,
    meta: { document_id: 279 },
    accepted_geometry_drawing: accepted
      ? { available: true, accepted_geometry: true, plates: [acceptedPlate], plate_count: 1, head_count: 1 }
      : { available: false, accepted_geometry: false, reason: 'accepted_vector_plans_unavailable', plates: [] },
    studio_drawing: accepted
      ? { available: true, accepted_geometry: true, plates: [acceptedPlate], plate_count: 1, head_count: 1 }
      : { available: true, accepted_geometry: false, accepted_geometry_reason: 'accepted_vector_plans_unavailable', plates: [legacyPlate] },
  };
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const relative = pathname === '/' ? '/autobid-draw.html' : pathname;
  const target = path.resolve(APP_ROOT, `.${relative}`);
  if (!target.startsWith(APP_ROOT) || !statSafe(target)) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(target);
  const contentType = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.js' ? 'text/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': contentType });
  res.end(readFileSync(target));
}

function statSafe(target) {
  try { return statSync(target).isFile(); } catch { return false; }
}

async function startServer() {
  server = createServer(serveStatic);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
}

async function newDrawPage() {
  const page = await browser.newPage();
  requests = [];
  await page.route('**/api/autobid/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith('/sheets')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        exists: true, filename: 'accepted-fixture.pdf', count: 1, fp_review_count: 1,
        sheets: [{ page_index: 0, sheet_label: 'A-101', discipline: 'architectural', sheet_type: 'floor_plan' }],
      }) });
    }
    if (url.pathname.endsWith('/pdf/page')) {
      return route.fulfill({ contentType: 'image/png', body: PNG_1X1 });
    }
    if (url.pathname.endsWith('/dialed-in-plans')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ count: 0, plans: [] }) });
    }
    if (url.pathname.endsWith('/package/279')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(packagePayload()) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) });
  });
  await page.goto(`${base}/autobid-draw.html?doc=279`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  await page.locator('#layBtn').waitFor();
  await page.locator('.sheet').first().click();
  await page.waitForFunction(() => document.querySelector('#layBtn')?.disabled === false, null, { timeout: 5_000 });
  return page;
}

beforeAll(startServer);
afterAll(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe('AutoBid drawing accepted-geometry boundary', () => {
  it('loads package acceptance state instead of the legacy layout candidate', () => {
    expect(html).toContain("api('/package/' + S.doc + '?by=doc')");
    expect(html).toContain('accepted.available !== true || accepted.accepted_geometry !== true');
    expect(html).toContain('sd.accepted_geometry !== true');
    expect(html).toContain('geometry review pending');
    expect(html).toContain('provisional raster/rectangle drawing is withheld');
    expect(html).not.toContain("api('/layout/' + S.doc + '?by=doc')");
  });

  it('draws accepted polygon rooms and vector wall runs', () => {
    expect(html).toContain('const poly = r.polygon_ft || r.poly;');
    expect(html).toContain('p.wallRuns || []');
    expect(html).toContain("return '<path d=\"' + d + '\"");
    expect(html).toContain('walls + rooms + segs + heads + riser');
    expect(html).toContain('Accepted vector walls + polygon rooms');
  });

  it('shows pending review and never calls the legacy layout route', async () => {
    packageMode = 'pending';
    const page = await newDrawPage();
    await page.locator('#layBtn').click();
    await page.waitForFunction(() => document.querySelector('#layNote')?.textContent.includes('geometry review pending'), null, { timeout: 5_000 });
    expect(await page.locator('#laySvg svg').count()).toBe(0);
    expect(requests.some((request) => request.includes('/layout/'))).toBe(false);
    const screenshot = path.resolve('../../_tmp-draw-pending.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.close();
  }, 30_000);

  it('renders accepted polygon and wall-run geometry in the browser', async () => {
    packageMode = 'accepted';
    const page = await newDrawPage();
    await page.locator('#layBtn').click();
    await page.waitForFunction(() => document.querySelector('#layNote')?.textContent.includes('Accepted vector walls + polygon rooms'), null, { timeout: 5_000 });
    expect(await page.locator('#laySvg path').count()).toBeGreaterThan(0);
    expect(await page.locator('#laySvg line').count()).toBe(4);
    expect(await page.locator('#laySvg svg').getAttribute('aria-label')).toContain('A-101');
    expect(requests.some((request) => request.includes('/layout/'))).toBe(false);
    const screenshot = path.resolve('../../_tmp-draw-accepted.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.close();
  }, 30_000);
});
