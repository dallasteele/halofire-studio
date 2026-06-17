import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { extractLevelPlanFromPdf } from '../src/engine/plan-extract.js';

const REAL_PDF = '/opt/hal9000/worktrees/codex-halofire-opengeometry/data/halofire/golden/1881/input/GC - Bid Plans/1881 - Architecturals.pdf';
const PDFJS_CANDIDATES = [
  path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
  '/opt/hal9000/apps/halofire-studio/apps/autosprink/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  '/opt/hal9000/apps/openclaw/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
];

async function loadRealPdfJs() {
  const failures = [];
  for (const candidate of PDFJS_CANDIDATES) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const mod = await import(pathToFileURL(candidate).href);
      if (typeof mod.getDocument === 'function') {
        return { pdfjs: mod, modulePath: candidate };
      }
      failures.push(`${candidate} missing getDocument()`);
    } catch (error) {
      failures.push(`${candidate} import failed: ${error.message}`);
    }
  }
  throw new Error(
    'Unable to load a real pdfjs-dist runtime for the step1 wall gate. ' +
    failures.join(' | '),
  );
}

test('1881 page 8 returns real wall segments from the real PDF', { timeout: 180000 }, async () => {
  assert.ok(fs.existsSync(REAL_PDF), `Real PDF fixture missing: ${REAL_PDF}`);

  const { pdfjs, modulePath } = await loadRealPdfJs();
  const data = new Uint8Array(fs.readFileSync(REAL_PDF));
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    worker: null,
  });
  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(8);
    const plan = await extractLevelPlanFromPdf(page);

    assert.ok(Array.isArray(plan.wallsFt), 'plan.wallsFt must be an array');
    assert.ok(plan.wallsFt.length > 100, `expected >100 walls, got ${plan.wallsFt.length}`);
    assert.ok(plan.wallsFt.length < 8000, `expected <8000 walls, got ${plan.wallsFt.length}`);
    assert.ok(Array.isArray(plan.footprintFt), 'plan.footprintFt must be an array');
    assert.ok(plan.footprintFt.length > 50, `expected >50 footprint points, got ${plan.footprintFt.length}`);

    // eslint-disable-next-line no-console
    console.log(
      `[step1-real-walls] pdfjs=${modulePath} wallsFt=${plan.wallsFt.length} ` +
      `footprintFt=${plan.footprintFt.length} wallRuns=${Array.isArray(plan.wallRuns) ? plan.wallRuns.length : 0}`,
    );
  } finally {
    await loadingTask.destroy();
  }
});
