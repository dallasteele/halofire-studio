import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:3443';
const OUT = process.env.OUT || 'E:/ClaudeBot/out/phase4-intake/submittal-sheets';
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

  // Hook exists pre-build (returns honest "no model" while empty).
  report.steps.hooksPreBuild = await page.evaluate(() => ({
    submittal: !!(window.__hfPhase4 && typeof window.__hfPhase4.submittal === 'function'),
    build: !!(window.__hfPhase4 && window.__hfPhase4.submittal && typeof window.__hfPhase4.submittal.build === 'function'),
    preBuild: window.__hfPhase4 && window.__hfPhase4.submittal ? window.__hfPhase4.submittal.build().available : null,
  }));

  // Generate a layout -> a real model with heads + pipes.
  await page.click('#genBtn');
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => { const m = window.__hfModel && window.__hfModel(); return !!(m && m.solids && m.solids.some((s) => s.kind === 'head')); });
    if (ok) break;
    await sleep(1500);
  }
  await sleep(1000);

  // Run Phase-3 hydraulics so FP-H placard has real numbers, and BOM takeoff so FP-B is real.
  report.steps.preReqs = await page.evaluate(() => {
    const out = {};
    try { if (window.__hf3 && typeof window.__hf3.solve === 'function') { window.__hf3.solve({ upsize: true }); } } catch (e) { out.solveErr = String(e); }
    try { if (typeof window.__hfBomTakeoff === 'undefined' || window.__hfBomTakeoff === null) { /* trigger via panel function if present */ } } catch (e) {}
    return out;
  });
  // Trigger BOM takeoff (the round-trip hook publishes window.__hfBomTakeoff).
  await page.evaluate(() => { try { if (typeof window.regenerateBom === 'function') window.regenerateBom(); } catch (e) {} });
  await sleep(500);
  // Place a section so FP-D embeds a real detail.
  const modelInfo = await page.evaluate(() => {
    const m = window.__hfModel();
    const heads = m.solids.filter((s) => s.kind === 'head');
    const xs = heads.map((h) => h.position[0]), ys = heads.map((h) => h.position[1]);
    return { headCount: heads.length, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
  const midY = (modelInfo.minY + modelInfo.maxY) / 2;
  await page.evaluate(([a, bb]) => window.__hfPhase4.section(a, bb, { bandFt: 30 }), [[modelInfo.minX - 5, midY], [modelInfo.maxX + 5, midY]]);
  report.steps.preState = await page.evaluate(() => ({
    hasModel: !!window.__hfModel(),
    hasReport: !!((window.__hf3 && window.__hf3.report) || (window.__hfPhase3 && window.__hfPhase3.report)),
    hasBom: !!window.__hfBomTakeoff,
    hasSection: !!(window.__hfLastSection && window.__hfLastSection.ok),
  }));

  // ── BUILD + SHOW the submittal sheet set. Observable contract + real output. ──
  report.steps.submittal = await page.evaluate(() => {
    const r = window.__hfPhase4.submittal({});
    const set = window.__hfLastSubmittal;
    return {
      contract: { sheets: r.sheets, hasTitleblock: r.hasTitleblock, exportReady: r.exportReady },
      sheetCount: r.sheetCount, hasHydraulics: r.hasHydraulics, hasBom: r.hasBom, hasSection: r.hasSection,
      titles: r.titles,
      // real-output probes pulled from the rendered SVG of each sheet
      svgProbes: set ? set.sheets.map((s) => ({
        code: s.code,
        svgLen: s.svg.length,
        hasTitleblock: s.svg.includes('HALO FIRE PROTECTION'),
        hasDisclaimer: s.svg.includes('ENGINEERING AID'),
        hasSheetCode: s.svg.includes('>' + s.code + '<'),
      })) : null,
      // pull a few specific real numbers through to prove it's the live model, not a stub
      fphHasDemand: set ? (set.sheets.find((s) => s.code === 'FP-H')?.svg.includes('gpm') || false) : false,
      fpbHasHeads: set ? (set.sheets.find((s) => s.code === 'FP-B')?.svg.includes('Sprinkler heads') || false) : false,
      fpdHasSection: set ? (set.sheets.find((s) => s.code === 'FP-D')?.svg.includes('Section') || false) : false,
      disclaimer: r.disclaimer,
    };
  });

  // Viewer panel is visible with the sheets.
  report.steps.panelVisible = await page.evaluate(() => {
    const p = document.getElementById('hfSubmittalPanel');
    return { exists: !!p, display: p ? p.style.display : null, tabs: p ? p.querySelectorAll('.hfSubTab').length : 0, hasSvg: p ? p.querySelector('#hfSubView svg') != null : false };
  });
  await page.screenshot({ path: OUT + '/submittal-cover.png' });

  // Page through to FP-H, FP-N, FP-R, FP-B, FP-D and screenshot a couple.
  await page.evaluate(() => { const set = window.__hfLastSubmittal; const i = set.sheets.findIndex((s) => s.code === 'FP-H'); if (typeof window.showSubmittalSheet === 'function') {} });
  // Use the tab buttons (real UI) to navigate.
  const tabCodes = await page.evaluate(() => Array.from(document.querySelectorAll('#hfSubmittalPanel .hfSubTab')).map((b) => b.textContent));
  report.steps.tabCodes = tabCodes;
  // click FP-H
  const idxH = tabCodes.indexOf('FP-H');
  if (idxH >= 0) { await page.click(`#hfSubmittalPanel .hfSubTab:nth-child(${idxH + 1})`); await sleep(300); await page.screenshot({ path: OUT + '/submittal-hydraulic.png' }); }
  // click last (FP-D)
  await page.click(`#hfSubmittalPanel .hfSubTab:last-child`); await sleep(300);
  await page.screenshot({ path: OUT + '/submittal-details.png' });
  // click a plan sheet
  const idxN = tabCodes.findIndex((c) => c.startsWith('FP-N'));
  if (idxN >= 0) { await page.click(`#hfSubmittalPanel .hfSubTab:nth-child(${idxN + 1})`); await sleep(300); await page.screenshot({ path: OUT + '/submittal-plan.png' }); }
  // click FP-B and FP-R
  const idxB = tabCodes.indexOf('FP-B');
  if (idxB >= 0) { await page.click(`#hfSubmittalPanel .hfSubTab:nth-child(${idxB + 1})`); await sleep(300); await page.screenshot({ path: OUT + '/submittal-bom.png' }); }
  const idxR = tabCodes.indexOf('FP-R');
  if (idxR >= 0) { await page.click(`#hfSubmittalPanel .hfSubTab:nth-child(${idxR + 1})`); await sleep(300); await page.screenshot({ path: OUT + '/submittal-riser.png' }); }

  // Export HTML produced + non-trivial.
  report.steps.exportHtml = await page.evaluate(() => {
    const html = window.__hfPhase4.submittal.html();
    return { len: html.length, isHtml: html.startsWith('<!doctype html>'), pages: (html.match(/class="sheet"/g) || []).length };
  });

  // ── CAMERA-NEUTRAL guard (#1): building the submittal + a plain canvas click must NOT move the camera. ──
  const tBefore = await page.evaluate(() => window.__dbgTarget());
  await page.evaluate(() => window.__hfPhase4.submittal({}));   // rebuild
  await sleep(200);
  const tAfterBuild = await page.evaluate(() => window.__dbgTarget());
  report.steps.cameraNeutralBuild = { before: tBefore, after: tAfterBuild, drift: dist(tBefore, tAfterBuild) };

  // A plain canvas click (panel is an overlay; clicking the 3D canvas must not reframe).
  const cv = await page.$('#canvas'); const box = await cv.boundingBox();
  // move the panel out of the way first by closing it, then plain click.
  await page.evaluate(() => window.__hfPhase4.submittal.close());
  const tPre = await page.evaluate(() => window.__dbgTarget());
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await sleep(400);
  const tPost = await page.evaluate(() => window.__dbgTarget());
  report.steps.cameraNeutralPlainClick = { before: tPre, after: tPost, drift: dist(tPre, tPost) };

  report.pageErrors = errs;
  fs.writeFileSync(OUT + '/submittal-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await b.close();
})().catch((e) => { console.error('HARNESS-ERR', e); process.exit(1); });
