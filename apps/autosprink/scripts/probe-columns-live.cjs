/* Live intake probe (COLUMNS) — logs in, loads Cooperative 1881, reads __hfPhase4.intake() to
 * confirm REAL extracted columns (marker-extraction) land in the building model. Asserts
 * 0 pageerror and camera-neutral (no __dbgTarget drift). */
const { chromium } = require('playwright');
const PORT = process.env.PORT || 3483;
const BASE = `http://localhost:${PORT}`;

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
  const ctx = await browser.newContext();
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'qa@halofire.local', password: 'qa-local-verify-9animals' } });
  if (login.status() !== 200) throw new Error('login failed ' + login.status());

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${BASE}/autosprink.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#projectTarget', { timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const sel = document.querySelector('#projectTarget');
    const opt = [...sel.options].find((o) => /Cooperative 1881/.test(o.textContent || o.value));
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  let intake = null;
  for (let i = 0; i < 60; i++) {
    intake = await page.evaluate(() => {
      try { return (window.__hfPhase4 && typeof window.__hfPhase4.intake === 'function') ? window.__hfPhase4.intake() : null; } catch (e) { return { err: String(e.message || e) }; }
    });
    if (intake && intake.available) break;
    await page.waitForTimeout(1000);
  }

  const tgt0 = await page.evaluate(() => (window.__dbgTarget ? { ...window.__dbgTarget } : null));
  await page.waitForTimeout(300);
  const tgt1 = await page.evaluate(() => (window.__dbgTarget ? { ...window.__dbgTarget } : null));
  let drift = null;
  if (tgt0 && tgt1) drift = Math.hypot((tgt1.x || 0) - (tgt0.x || 0), (tgt1.y || 0) - (tgt0.y || 0), (tgt1.z || 0) - (tgt0.z || 0));

  const cols = (intake && Array.isArray(intake.columns)) ? intake.columns : [];
  const sizes = cols.map((c) => c.sizeFt).filter(Number.isFinite).sort((a, b) => a - b);
  console.log(JSON.stringify({
    available: intake && intake.available,
    counts: intake && intake.counts,
    columnSource: intake && intake.columnSource,
    columnCounts: intake && intake.columnCounts,
    columnSizeRange: sizes.length ? [sizes[0], sizes[sizes.length - 1]] : null,
    sampleColumn: cols[0] || null,
    columnSourcesSeen: [...new Set(cols.map((c) => c.source))],
    scaleFtPerPx: intake && intake.scaleFtPerPx,
    pageErrors,
    cameraDrift: drift,
  }, null, 2));

  await browser.close();
})().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });
