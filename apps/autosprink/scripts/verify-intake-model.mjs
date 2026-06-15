import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:3441';
const OUT = process.env.OUT || 'E:/ClaudeBot/out/phase4-intake/intake-model';
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

  // Phase 4 hooks must exist pre-build.
  report.steps.hooksPreBuild = await page.evaluate(() => ({
    intake: !!(window.__hfPhase4 && typeof window.__hfPhase4.intake === 'function'),
    calibrate: !!(window.__hfPhase4 && window.__hfPhase4.calibrate),
    preBuildIntake: window.__hfPhase4 && window.__hfPhase4.intake ? window.__hfPhase4.intake().available : null,
  }));

  // Switch to Cooperative 1881 -> builds the REAL plan from the extracted vector PDF.
  await page.selectOption('#projectTarget', 'The Cooperative 1881 - Salt Lake City UT');
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => !!(window.__hfPlanBuild && window.__hfPlanBuild()));
    if (ready) break;
    await sleep(1500);
  }
  await sleep(1500);

  // INTAKE — real reconstructed model output.
  report.steps.intake = await page.evaluate(() => {
    const it = window.__hfPhase4.intake();
    return {
      available: it.available, source: it.source,
      scaleFtPerPx: it.scaleFtPerPx, sheetFtPerPx: it.sheetFtPerPx,
      scaleSource: it.scaleSource, calibrated: it.calibrated,
      counts: it.counts, columnSource: it.columnSource,
      sampleWall: it.walls[0], sampleOpening: it.openings[0], sampleColumn: it.columns[0],
      provenance: it.provenance,
    };
  });

  // Per-level column counts from the build summary (proves columns now render).
  report.steps.summaryColumns = await page.evaluate(() => {
    const pb = window.__hfPlanBuild();
    return { perLevelColumns: pb.summary.perLevel.map((l) => ({ level: l.level, columns: l.columns, columnSource: l.columnSource })) };
  });

  // ── CAMERA-NEUTRAL guard (#1): arming + a calibration pick must NOT move the camera. ──
  const tBefore = await page.evaluate(() => window.__dbgTarget());
  // arm + simulate two picks via the programmatic plan-point path (camera-neutral).
  report.steps.calibPick = await page.evaluate(() => {
    window.__hfPhase4.calibrate.arm();
    // use two plan points that are a known model distance apart; assert the camera doesn't move
    const before = window.__dbgTarget();
    const r = window.__hfPhase4.calibrate.setByPlanPoints([0, 0], [100, 0], 100); // model says 100ft, real 100ft -> 1.0 correction
    const after = window.__dbgTarget();
    return { r, before, after };
  });
  const tAfterPick = await page.evaluate(() => window.__dbgTarget());
  report.steps.cameraNeutralCalib = { before: tBefore, after: tAfterPick, drift: dist(tBefore, tAfterPick) };

  // Known-scale calibration via the public API.
  report.steps.knownScale = await page.evaluate(() => window.__hfPhase4.calibrate.setByKnownScale("1/8\"=1'-0\""));
  // Two-point (screen px) calibration via the public API.
  report.steps.twoPointPx = await page.evaluate(() => window.__hfPhase4.calibrate.setByTwoPoints([100, 100], [200, 100], 25));
  // clear -> back to sheet scale.
  report.steps.afterClear = await page.evaluate(() => { window.__hfPhase4.calibrate.clear(); const it = window.__hfPhase4.intake(); return { calibrated: it.calibrated, scaleSource: it.scaleSource, scaleFtPerPx: it.scaleFtPerPx }; });

  // ── CAMERA-NEUTRAL guard for a PLAIN canvas click (no calibration armed). ──
  const tPre = await page.evaluate(() => window.__dbgTarget());
  const cv = await page.$('#canvas'); const box = await cv.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await sleep(400);
  const tPost = await page.evaluate(() => window.__dbgTarget());
  report.steps.cameraNeutralPlainClick = { before: tPre, after: tPost, drift: dist(tPre, tPost) };

  await page.screenshot({ path: OUT + '/intake-model-1881.png' });
  // Toggle the columns layer ON and screenshot to show synthesized columns.
  await page.evaluate(() => { const pb = window.__hfPlanBuild(); pb.setLayerVisible('columns', true); });
  await sleep(500);
  await page.screenshot({ path: OUT + '/intake-columns-on-1881.png' });

  report.pageErrors = errs;
  fs.writeFileSync(OUT + '/intake-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await b.close();
})().catch((e) => { console.error('HARNESS-ERR', e); process.exit(1); });
