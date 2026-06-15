import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:3442';
const OUT = process.env.OUT || 'E:/ClaudeBot/out/phase4-intake/section-cut';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => (a && b) ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : null;

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.request.post(BASE + '/api/auth/login', { data: { username: 'qa@halofire.local', password: 'qa-local-verify-9animals', remember: true } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  const report = { pageErrors: [], steps: {} };

  await page.goto(BASE + '/autosprink.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hfReady && window.__hfReady(), { timeout: 40000 });

  // Phase 4 section hook exists pre-build.
  report.steps.hooksPreBuild = await page.evaluate(() => ({
    section: !!(window.__hfPhase4 && typeof window.__hfPhase4.section === 'function'),
    arm: !!(window.__hfPhase4 && window.__hfPhase4.section && typeof window.__hfPhase4.section.arm === 'function'),
    preBuild: window.__hfPhase4 && window.__hfPhase4.section ? window.__hfPhase4.section().available : null,
  }));

  // Generate a layout (Home Depot default) -> a real model with heads + pipes.
  await page.click('#genBtn');
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => { const m = window.__hfModel && window.__hfModel(); return !!(m && m.solids && m.solids.some((s) => s.kind === 'head')); });
    if (ok) break;
    await sleep(1500);
  }
  await sleep(1000);

  // Model bbox (from heads) -> pick a cut line straight across the heads.
  const modelInfo = await page.evaluate(() => {
    const m = window.__hfModel();
    const heads = m.solids.filter((s) => s.kind === 'head');
    const pipes = m.solids.filter((s) => s.kind === 'pipe');
    const xs = heads.map((h) => h.position[0]), ys = heads.map((h) => h.position[1]);
    return {
      headCount: heads.length, pipeCount: pipes.length,
      minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
      sampleHead: heads[0] ? heads[0].position : null,
    };
  });
  report.steps.model = modelInfo;

  // A cut line along X at the middle Y row, big band -> picks up a branch + heads + drops.
  const midY = (modelInfo.minY + modelInfo.maxY) / 2;
  const aPlan = [modelInfo.minX - 5, midY], bPlan = [modelInfo.maxX + 5, midY];

  // ── PROGRAMMATIC section: __hfPhase4.section([x,y],[x,y],{bandFt}) ──
  report.steps.programmaticSection = await page.evaluate(([a, bb]) => {
    const r = window.__hfPhase4.section(a, bb, { bandFt: 30 });
    return {
      ok: r.ok, kind: r.kind, label: r.label, bandFt: r.bandFt,
      counts: r.counts, bounds: r.bounds, plane: r.plane,
      entityTypes: r.entities.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {}),
      sampleHead: r.entities.find((e) => e.type === 'head') || null,
      samplePipe: r.entities.find((e) => e.type === 'line') || null,
      disclaimer: r.disclaimer,
    };
  }, [aPlan, bPlan]);

  // The published hook returns the last section.
  report.steps.hookReturnsLast = await page.evaluate(() => {
    const r = window.__hfPhase4.section();
    return { available: r.available !== false, ok: r.ok, label: r.label, entityCount: (r.entities || []).length };
  });

  // Panel is visible + selectable.
  report.steps.panelVisible = await page.evaluate(() => {
    const p = document.getElementById('hfSectionPanel');
    return { exists: !!p, display: p ? p.style.display : null, svgChildren: p ? p.querySelector('#hfSectionSvg').children.length : 0 };
  });
  // Select an entity via API.
  report.steps.selectEntity = await page.evaluate(() => {
    const r = window.__hfLastSection;
    const head = r.entities.find((e) => e.type === 'head');
    return head ? window.__hfPhase4.section.select(head.name) : { selected: null, note: 'no head in section' };
  });

  await page.screenshot({ path: OUT + '/section-panel.png' });

  // ── CAMERA-NEUTRAL guard (#1): arming + simulated canvas cut-line clicks must NOT move the camera. ──
  const tBefore = await page.evaluate(() => window.__dbgTarget());
  // arm interactive, set a deterministic distance-less flow: we click two canvas points.
  await page.evaluate(() => window.__hfPhase4.section.arm());
  const cv = await page.$('#canvas'); const box = await cv.boundingBox();
  // click two points on the canvas to lay a cut line (camera must not move)
  await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.55);
  await sleep(250);
  await page.mouse.click(box.x + box.width * 0.70, box.y + box.height * 0.55);
  await sleep(500);
  const tAfterCut = await page.evaluate(() => window.__dbgTarget());
  report.steps.cameraNeutralSectionPick = { before: tBefore, after: tAfterCut, drift: dist(tBefore, tAfterCut) };
  report.steps.interactiveSection = await page.evaluate(() => {
    const r = window.__hfLastSection;
    return r ? { ok: r.ok, label: r.label, counts: r.counts } : null;
  });

  // ── CAMERA-NEUTRAL guard for a PLAIN canvas click (no tool armed). ──
  const tPre = await page.evaluate(() => window.__dbgTarget());
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await sleep(400);
  const tPost = await page.evaluate(() => window.__dbgTarget());
  report.steps.cameraNeutralPlainClick = { before: tPre, after: tPost, drift: dist(tPre, tPost) };

  await page.screenshot({ path: OUT + '/section-after-interactive.png' });

  // Close the panel.
  report.steps.close = await page.evaluate(() => { window.__hfPhase4.section.close(); const p = document.getElementById('hfSectionPanel'); return { display: p.style.display }; });

  report.pageErrors = errs;
  fs.writeFileSync(OUT + '/section-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await b.close();
})().catch((e) => { console.error('HARNESS-ERR', e); process.exit(1); });
