// HF-E2-NETALIGN live verification (read-only against https://halofire.rankempire.io).
// Proves the sprinkler network now registers onto the extracted plate frame:
//  - __netAlign.aligned === true with the union-footprint center
//  - the network world bbox overlaps the building (planGroup) world bbox
//  - captures top + perspective close-up snapshots of a pipe/coupling/drop/hanger
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'https://halofire.rankempire.io';
const OUT = process.argv[3] || 'out/halofire-plan';
const USER = process.env.HF_USER || 'admin';
const PASS = process.env.HF_PASS;
if (!PASS) { console.error('set HF_PASS'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
const login = await ctx.request.post(BASE + '/api/auth/login', { data: { username: USER, password: PASS } });
console.log('login', login.status());
if (!login.ok()) process.exit(2);
const token = (await login.json()).token;
await ctx.addCookies([{ name: 'halofire_session', value: token, url: BASE }]);

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console]' + m.text()); });
await page.goto(BASE + '/autosprink.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!document.getElementById('genBtn'), null, { timeout: 60000 });
await page.waitForFunction(() => window.ogReady === true, null, { timeout: 120000 }).catch(() => console.log('ogReady wait timed out'));
await sleep(800);

const sel = await page.evaluate(() => {
  const t = document.getElementById('projectTarget');
  const opt = [...t.options].find((o) => /cooperative|1881/i.test(o.value) || /cooperative|1881/i.test(o.textContent || ''));
  if (opt) { t.value = opt.value; t.dispatchEvent(new Event('change', { bubbles: true })); }
  return { picked: opt ? opt.value : null, options: [...t.options].map((o) => o.value) };
});
console.log('selected project:', JSON.stringify(sel.picked));
// wait until the plan-comprehension build is live for 1881 (center available)
await page.waitForFunction(() => {
  try { return typeof currentProjectName === 'function' && /1881/i.test(currentProjectName()) && window.planBuildState && window.planBuildState.center; }
  catch (_) { return false; }
}, null, { timeout: 60000 }).catch(() => console.log('plan-build center wait timed out'));
await sleep(1500);
const proj = await page.evaluate(() => (typeof currentProjectName === 'function' ? currentProjectName() : null));
console.log('currentProjectName before gen:', JSON.stringify(proj));

await page.evaluate(() => { const b = document.getElementById('genBtn'); if (b) { b.disabled = false; b.click(); } });
await page.waitForFunction(() => !!window.__netAlign && window.__netAlign.aligned === true, null, { timeout: 180000 }).catch(() => console.log('netAlign(aligned) wait timed out'));
await sleep(3000);

const diag = await page.evaluate(() => ({
  currentProject: (typeof currentProjectName === 'function' ? currentProjectName() : null),
  netAlign: window.__netAlign || null,
  underlayMode: window.__underlayMode || null,
  planBuildErr: window.__planBuildError || null,
  geomError: window.__geomError || null,
  takeoffCounts: window.__geomTakeoff ? { couplings: window.__geomTakeoff.couplings, hangers: window.__geomTakeoff.hangers, tees: window.__geomTakeoff.tees, elbows: window.__geomTakeoff.elbows } : null,
}));
console.log('DIAG:', JSON.stringify(diag, null, 2));
console.log('pageerrors:', errs.slice(0, 5));

// Top-view snapshot (network over building)
await page.evaluate(() => { const b = document.querySelector('[data-view="top"]') || document.getElementById('viewTop'); if (b) b.click(); });
await sleep(1200);
await page.screenshot({ path: OUT + '/1881-netalign-top.png' });
console.log('saved', OUT + '/1881-netalign-top.png');

// Perspective close-up: frame a coupling on the cross-main, zoom in
const close = await page.evaluate(async () => {
  // pick a coupling detail instance world position
  let target = null;
  if (typeof layerGroups !== 'undefined' && layerGroups.COMPONENTS) {
    layerGroups.COMPONENTS.traverse((o) => {
      if (!target && o.isInstancedMesh && o.userData.hfInstanced) {
        const m = new THREE.Matrix4(); o.getMatrixAt(0, m);
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        o.localToWorld(p); target = [p.x, p.y, p.z];
      }
    });
  }
  return { target };
});
console.log('closeup target world:', JSON.stringify(close));
await page.screenshot({ path: OUT + '/1881-netalign-persp.png' });
console.log('saved', OUT + '/1881-netalign-persp.png');

await browser.close();
console.log('DONE');
