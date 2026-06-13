// Clean fitting close-up: hide the building shell + sheet, show ONLY the
// re-aligned sprinkler network (pipes/couplings/drops/heads/hangers) so the
// part centering + true-scale dimensions read clearly. Read-only.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.argv[2] || 'https://halofire.rankempire.io';
const OUT = process.argv[3] || 'out/halofire-plan';
const PASS = process.env.HF_PASS;
if (!PASS) { console.error('set HF_PASS'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
const login = await ctx.request.post(BASE + '/api/auth/login', { data: { username: 'admin', password: PASS } });
if (!login.ok()) process.exit(2);
const token = (await login.json()).token;
await ctx.addCookies([{ name: 'halofire_session', value: token, url: BASE }]);
const page = await ctx.newPage();
await page.goto(BASE + '/autosprink.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!document.getElementById('genBtn'), null, { timeout: 60000 });
await sleep(2500);
await page.evaluate(() => { const t = document.getElementById('projectTarget'); const o = [...t.options].find((x) => /1881|cooperative/i.test(x.value)); if (o) { t.value = o.value; t.dispatchEvent(new Event('change', { bubbles: true })); } });
await page.waitForFunction(() => window.planBuildState && window.planBuildState.center, null, { timeout: 60000 }).catch(() => {});
await sleep(1500);
await page.evaluate(() => { const b = document.getElementById('genBtn'); if (b) { b.disabled = false; b.click(); } });
await page.waitForFunction(() => window.__netAlign && window.__netAlign.aligned === true, null, { timeout: 180000 }).catch(() => {});
await sleep(3000);

// Hide building plan-build group + the WALLS/COLUMN/FLOOR network layers + sheet,
// keep MAIN/BRANCH/DROPS/HEADS/COMPONENTS/HANGERS.
const hid = await page.evaluate(() => {
  let hidden = [];
  try { if (window.planGroup) { window.planGroup.visible = false; hidden.push('planGroup'); } } catch (_) {}
  // toggle off shell layers via the layer checkboxes
  document.querySelectorAll('input[type=checkbox]').forEach((c) => {
    const lbl = (c.closest('label') || {}).textContent || '';
    if (/wall|column|floor|plan|ceiling|sheet/i.test(lbl) && c.checked) { c.click(); hidden.push(lbl.trim()); }
  });
  return hidden;
});
console.log('hidden:', JSON.stringify(hid));
await sleep(800);

// Frame on the cross-main / a branch run: dolly in.
const canvas = await page.$('#canvas');
const box = await canvas.boundingBox();
for (let i = 0; i < 9; i++) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -250); await sleep(60); }
// slight orbit for a 3/4 view of fittings
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down({ button: 'left' });
await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 - 60, { steps: 10 });
await page.mouse.up({ button: 'left' });
await sleep(800);
const shot = await page.evaluate(() => (window.__snapshot ? window.__snapshot(1400, 900, 0.9) : null));
if (shot) { fs.writeFileSync(OUT + '/1881-fittings-clean.jpg', Buffer.from(shot.split(',')[1], 'base64')); console.log('saved', OUT + '/1881-fittings-clean.jpg'); }
await page.screenshot({ path: OUT + '/1881-fittings-clean-full.png' });
console.log('saved', OUT + '/1881-fittings-clean-full.png');
await browser.close();
console.log('DONE');
