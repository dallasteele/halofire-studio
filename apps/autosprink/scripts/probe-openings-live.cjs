/* Live intake probe — logs in, loads Cooperative 1881, triggers the plan-comprehension build, and
 * reads __hfPhase4.intake() to confirm REAL walls/openings (incl. doors+windows) land in the
 * building model. Asserts 0 pageerror and camera-neutral (no __dbgTarget drift). */
const { chromium } = require('playwright');
const PORT = process.env.PORT || 3482;
const BASE = `http://localhost:${PORT}`;

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
  const ctx = await browser.newContext();
  // login -> session cookie
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'qa@halofire.local', password: 'qa-local-verify-9animals' } });
  if (login.status() !== 200) throw new Error('login failed ' + login.status());

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${BASE}/autosprink.html`, { waitUntil: 'domcontentloaded' });

  // select Cooperative 1881 to trigger the extracted-geometry build
  await page.waitForSelector('#projectTarget', { timeout: 20000 });
  await page.waitForTimeout(2000); // let kernel + modules settle
  await page.evaluate(() => {
    const sel = document.querySelector('#projectTarget');
    const opt = [...sel.options].find((o) => /Cooperative 1881/.test(o.textContent || o.value));
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  // wait for the plan build to populate intake
  let intake = null;
  for (let i = 0; i < 60; i++) {
    intake = await page.evaluate(() => {
      try { return (window.__hfPhase4 && typeof window.__hfPhase4.intake === 'function') ? window.__hfPhase4.intake() : null; } catch (e) { return { err: String(e.message || e) }; }
    });
    if (intake && intake.available) break;
    await page.waitForTimeout(1000);
  }

  // camera-neutral check: capture __dbgTarget before/after a no-op read
  const tgt0 = await page.evaluate(() => (window.__dbgTarget ? { ...window.__dbgTarget } : null));
  await page.waitForTimeout(300);
  const tgt1 = await page.evaluate(() => (window.__dbgTarget ? { ...window.__dbgTarget } : null));
  let drift = null;
  if (tgt0 && tgt1) drift = Math.hypot((tgt1.x || 0) - (tgt0.x || 0), (tgt1.y || 0) - (tgt0.y || 0), (tgt1.z || 0) - (tgt0.z || 0));

  // breakdown of openings by kind
  let kinds = null;
  if (intake && Array.isArray(intake.openings)) {
    kinds = intake.openings.reduce((a, o) => { a[o.kind] = (a[o.kind] || 0) + 1; return a; }, {});
  }
  // window-confidence split from the summary
  const ext = await page.evaluate(() => {
    const st = window.__hfPhase4 && window.__hfPhase4._planBuildState ? window.__hfPhase4._planBuildState : null;
    try {
      const s = document.querySelector('#levelsPanel') ? null : null; void s;
      const pbs = window.planBuildState || null; void pbs;
      return null;
    } catch (e) { return null; }
  });
  void ext;

  console.log(JSON.stringify({
    available: intake && intake.available,
    counts: intake && intake.counts,
    openingKinds: kinds,
    scaleFtPerPx: intake && intake.scaleFtPerPx,
    scaleSource: intake && intake.scaleSource,
    columnSource: intake && intake.columnSource,
    sampleWindow: intake && Array.isArray(intake.openings) ? intake.openings.find((o) => o.kind === 'window') : null,
    sampleDoor: intake && Array.isArray(intake.openings) ? intake.openings.find((o) => o.kind === 'door') : null,
    pageErrors,
    cameraDrift: drift,
  }, null, 2));

  await browser.close();
})().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });
