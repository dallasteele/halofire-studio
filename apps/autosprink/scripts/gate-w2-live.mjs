// HF-W2 GATE — verify EXTRACTION COMPLETENESS is rendered in the Studio:
//   • the extracted Cooperative-1881 building exposes the W2 overlay layers
//     (doors + swing arcs, recovered partition-inclusive walls, fixtures/cores);
//   • the building-from-plan summary surfaces the HONEST wall-recall % + counts;
//   • the LAYERS panel gains Doors / Recovered-walls / Fixtures toggles;
//   • a door / recovered-wall / fixture is selectable + inspectable (needs-verification);
//   • the recall heatmap is served and linked in the Levels panel;
//   • zero page errors.
//
// Works against a LOCAL dev server or the LIVE site. Pass BASE as argv[2]. For an
// auth-gated host set HF_PASS (admin) — login is skipped when the page loads anonymously
// (dev). Emits STRICT JSON { pass, failures, evidence }.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3502';
const OUT = process.argv[3] || 'out/halofire-W2';
const USER = process.env.HF_USER || 'admin';
const PASS = process.env.HF_PASS || null;
const COOP = 'The Cooperative 1881 - Salt Lake City UT';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = []; const evidence = [];
const fail = (m) => { failures.push(m); console.log('FAIL:', m); };
const ev = (m) => { evidence.push(m); console.log('  •', m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
if (PASS) {
  const login = await ctx.request.post(BASE + '/api/auth/login', { data: { username: USER, password: PASS } });
  ev(`login ${login.status()}`);
  if (login.ok()) { const token = (await login.json()).token; await ctx.addCookies([{ name: 'halofire_session', value: token, url: BASE }]); }
  else fail(`admin login failed ${login.status()}`);
}
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console]' + m.text()); });

await page.goto(BASE + '/autosprink.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!document.getElementById('projectTarget'), null, { timeout: 60000 }).catch(() => fail('projectTarget select never appeared'));
await page.waitForFunction(() => typeof window.__hfReady === 'function' && window.__hfReady(), null, { timeout: 120000 }).catch(() => ev('ogReady timed out (continuing)'));
await sleep(800);

// Switch to Cooperative 1881 — this triggers renderRealOrFixtureUnderlay -> the extracted
// plan-comprehension building (planBuildState). No Generate needed (W2 is the building, not the network).
await page.evaluate((val) => {
  const t = document.getElementById('projectTarget');
  const i = [...t.options].findIndex((o) => o.value === val);
  if (i >= 0) { t.selectedIndex = i; t.dispatchEvent(new Event('change', { bubbles: true })); }
}, COOP);
// wait for the extracted building to be up (planBuildState + the L1 group built).
await page.waitForFunction(() => {
  const w = window;
  return w.__underlayMode && w.__underlayMode.mode === 'plan-comprehension-build' && w.__underlayMode.summary;
}, null, { timeout: 180000 }).catch(() => fail('plan-comprehension build did not come up for Cooperative 1881'));
await sleep(1500);

// ── GATE A — extraction-completeness summary present + HONEST recall ──
const summary = await page.evaluate(() => (window.__underlayMode && window.__underlayMode.summary) || null);
ev(`summary.extractionCompleteness=${JSON.stringify(summary && summary.extractionCompleteness)}`);
const ext = summary && summary.extractionCompleteness;
if (!ext) fail('summary.extractionCompleteness missing (recall/doors/fixtures not surfaced)');
else {
  if (!(ext.wallRecallPct > 0 && ext.wallRecallPct <= 100)) fail(`wallRecallPct not a real 0-100 figure (${ext.wallRecallPct})`);
  if (ext.wallRecallPct >= 99) fail(`wallRecallPct ${ext.wallRecallPct}% is the optimistic re-derivation, not the honest rendered recall — must be the measured ~71%`);
  if (!(ext.doors >= 100)) fail(`doors not surfaced as ~124 (${ext.doors})`);
  if (!(ext.recoveredWalls >= 10000)) fail(`recoveredWalls not surfaced as the ~41.7k partition set (${ext.recoveredWalls})`);
  if (!(ext.fixtures >= 1)) fail(`fixtures not surfaced (${ext.fixtures})`);
  if (ext.needsVerification !== true) fail('extractionCompleteness not flagged needs-verification');
}

// ── GATE B — overlay layers actually built into the scene ──
const layerCounts = await page.evaluate(() => {
  const st = window.__planBuildStateProbe || null;
  // planBuildState is module-scoped; probe via the api on the underlay summary path.
  // Walk the active scene's plan groups for the named overlay groups.
  const out = { doors: 0, openings: 0, recoveredWalls: 0, fixtures: 0, doorHasLeafAndArc: false };
  const scene = window.__scene || null;
  function walk(o) {
    if (!o) return;
    if (o.name === 'doors') { out.doors += o.children.length; const d0 = o.children[0]; if (d0 && d0.children) { out.doorHasLeafAndArc = d0.children.some((c) => c.name === 'plan-door-leaf') && d0.children.some((c) => c.name === 'plan-door-swing'); } }
    if (o.name === 'openings') out.openings += o.children.length;
    if (o.name === 'recovered-walls') out.recoveredWalls += 1;
    if (o.name === 'fixtures') out.fixtures += o.children.length;
    (o.children || []).forEach(walk);
  }
  if (scene) scene.children.forEach(walk);
  return out;
});
ev(`scene overlay groups: ${JSON.stringify(layerCounts)}`);
if (layerCounts.doors < 100) fail(`door objects not in scene (${layerCounts.doors})`);
if (!layerCounts.doorHasLeafAndArc) fail('door group missing leaf mesh + swing-arc line');
if (layerCounts.recoveredWalls < 1) fail('recovered-walls layer not in scene');
if (layerCounts.fixtures < 1) fail('fixtures layer not in scene');

// ── GATE C — LAYERS panel gained the W2 toggles ──
const toggles = await page.evaluate(() => {
  const ids = ['LW2_DOORS', 'LW2_WALLSFULL', 'LW2_FIXTURES'];
  return ids.map((id) => ({ id, present: !!document.getElementById(id) }));
});
ev(`W2 layer toggles: ${JSON.stringify(toggles)}`);
for (const t of toggles) if (!t.present) fail(`LAYERS toggle ${t.id} missing`);

// ── GATE D1 — a DOOR is selectable + inspectable via the real product path ──
// __hfSelectDoor runs the SAME describeBuildPart + applyHighlight + openInspector the
// click handler uses, on a door of the active level (deterministic; not raycast-fragile).
const dsel = await page.evaluate(() => (window.__hfSelectDoor ? window.__hfSelectDoor(3) : { err: 'no __hfSelectDoor hook' }));
ev(`door select -> open=${dsel.open} title="${dsel.title}" width=${dsel.userData && dsel.userData.widthFt} onWall=${dsel.userData && dsel.userData.onWall}`);
if (dsel.err) fail(`door selection probe error: ${dsel.err}`);
else {
  if (!dsel.open) fail('inspector did not open on door select');
  if (!/door/i.test(dsel.title || '')) fail(`inspector title not a door (${dsel.title})`);
  if (!/needs-verification/i.test(dsel.bodyText || '')) fail('door inspector missing needs-verification flag');
  if (!/width/i.test(dsel.bodyText || '') || !/swing/i.test(dsel.bodyText || '') || !/host wall/i.test(dsel.bodyText || '')) fail(`door inspector missing width/swing/host-wall rows (${dsel.bodyText})`);
}

// ── GATE D2 — the real raycast click path selects SOME extracted building part
// (proves planGroup is wired into handleCanvasClick) with a needs-verification flag. ──
const rsel = await page.evaluate(() => {
  const scene = window.__scene; if (!scene) return { err: 'no __scene' };
  if (window.__hfSetSelectMode) window.__hfSetSelectMode(true);
  const THREE = window.__THREE; const cam = window.__camera; const renderer = window.__renderer;
  if (!THREE || !cam || !renderer) return { err: 'no THREE/camera/renderer hook' };
  // pick the largest visible plan layer (the shell) and click its projected center.
  let target = null; scene.traverse((o) => { if (o.visible && o.parent && o.parent.visible && o.name === 'plan-walls-merged' && !target) target = o; });
  if (!target) scene.traverse((o) => { if (o.visible && o.name === 'doors' && o.children.length && !target) target = o.children[0]; });
  if (!target) return { err: 'no visible plan layer to click' };
  const box = new THREE.Box3().setFromObject(target); const c = box.getCenter(new THREE.Vector3());
  const v = c.clone().project(cam);
  const rect = renderer.domElement.getBoundingClientRect();
  const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
  const el = renderer.domElement;
  const pe = (t) => new PointerEvent(t, { clientX: sx, clientY: sy, bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse' });
  el.dispatchEvent(pe('pointerdown')); el.dispatchEvent(pe('pointerup'));
  const insp = document.getElementById('inspector'), title = document.getElementById('inspTitle'), body = document.getElementById('inspBody');
  return { open: insp && insp.classList.contains('open'), title: title ? title.textContent : '', bodyText: body ? body.textContent : '' };
});
ev(`raycast building-part select -> open=${rsel.open} title="${rsel.title}"`);
if (rsel.err) fail(`raycast selection probe error: ${rsel.err}`);
else {
  if (!rsel.open) fail('inspector did not open on raycast building-part click (planGroup not wired into handleCanvasClick)');
  if (!/extracted|wall|door|fixture|recovered|space|stair/i.test(rsel.title || '')) fail(`raycast hit not an extracted building part (${rsel.title})`);
  if (!/needs-verification/i.test(rsel.bodyText || '')) fail('raycast-selected building part missing needs-verification flag');
}

// ── GATE E — recall heatmap is served + linked ──
const heat = await page.evaluate(async () => {
  const r = await fetch('/public/halofire-W2/recall-heatmap.png');
  const link = !!document.getElementById('w2HeatLink');
  return { status: r.status, ct: r.headers.get('content-type'), link };
});
ev(`heatmap fetch ${heat.status} ${heat.ct} link=${heat.link}`);
if (heat.status !== 200) fail(`recall heatmap not served (${heat.status})`);
if (!/image\/png/.test(heat.ct || '')) fail(`recall heatmap not a PNG (${heat.ct})`);
if (!heat.link) fail('Levels panel missing the recall-heatmap link');

// snapshot of the studio with W2 overlays
try {
  const dataUrl = await page.evaluate(() => (window.__snapshot ? window.__snapshot(1100, 700, 0.72) : null));
  if (dataUrl) { fs.writeFileSync(OUT + '/w2-gate-coop-building.jpg', Buffer.from(dataUrl.split(',')[1], 'base64')); ev(`snapshot -> ${OUT}/w2-gate-coop-building.jpg`); }
} catch (_) { /* snapshot best-effort */ }

ev(`pageerrors(${errs.length}) ${JSON.stringify(errs.slice(0, 8))}`);
if (errs.length) fail(`page/console errors during gate: ${errs.length}`);

await browser.close();
const out = { pass: failures.length === 0, base: BASE, failures, evidence };
console.log('\nGATE_JSON_BEGIN');
console.log(JSON.stringify(out, null, 2));
console.log('GATE_JSON_END');
process.exit(out.pass ? 0 : 1);
