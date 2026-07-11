/* Live screenshot probe (COLUMNS) — loads Cooperative 1881, builds, screenshots the 3D model +
 * the W2 plan-extraction panel column line. Confirms columns render and the panel reads honestly. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3483;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve(process.cwd(), '../../out/raster-intake/raster-columns');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'qa@halofire.local', password: 'qa-local-verify-9animals' } });
  if (login.status() !== 200) throw new Error('login failed ' + login.status());
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${BASE}/autosprink.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#projectTarget', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const sel = document.querySelector('#projectTarget');
    const opt = [...sel.options].find((o) => /Cooperative 1881/.test(o.textContent || o.value));
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  // wait for intake
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(() => { try { const r = window.__hfPhase4 && window.__hfPhase4.intake && window.__hfPhase4.intake(); return r && r.available; } catch (e) { return false; } });
    if (ok) break; await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2500);
  // capture camera target before/after
  const t0 = await page.evaluate(() => window.__dbgTarget ? { ...window.__dbgTarget } : null);
  await page.screenshot({ path: path.join(OUT, 'live-building-columns.png') });
  const t1 = await page.evaluate(() => window.__dbgTarget ? { ...window.__dbgTarget } : null);
  let drift = null; if (t0 && t1) drift = Math.hypot((t1.x||0)-(t0.x||0),(t1.y||0)-(t0.y||0),(t1.z||0)-(t0.z||0));

  // extract the W2 column line text
  const panelText = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.disc-row')].map((d) => d.textContent).join(' | ');
    return el;
  });
  const colLine = (panelText.match(/columns[^|]*/i) || [''])[0].trim();
  console.log(JSON.stringify({ colLine, pageErrors, cameraDrift: drift, shot: path.join(OUT, 'live-building-columns.png') }, null, 2));
  await browser.close();
})().catch((e) => { console.error('SHOT PROBE FAILED', e); process.exit(1); });
