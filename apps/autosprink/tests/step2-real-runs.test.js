import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import { extractLevelPlanFromPdf } from '../src/engine/plan-extract.js';

const PDF_PATH = '/opt/hal9000/worktrees/codex-halofire-opengeometry/data/halofire/golden/1881/input/GC - Bid Plans/1881 - Architecturals.pdf';
const PDF_PAGE = 8;
const PDFJS_CANDIDATES = [
  {
    moduleSpecifier: 'pdfjs-dist/legacy/build/pdf.mjs',
  },
  {
    modulePath: '/opt/hal9000/apps/halofire-studio/apps/autosprink/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  },
  {
    modulePath: '/opt/hal9000/apps/openclaw/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  },
];

async function loadPdfJsLegacy() {
  const failures = [];
  for (const candidate of PDFJS_CANDIDATES) {
    try {
      const specifier = candidate.moduleSpecifier || pathToFileURL(candidate.modulePath).href;
      const pdfjs = await import(specifier);
      if (typeof pdfjs.getDocument !== 'function') {
        failures.push(`${candidate.moduleSpecifier || candidate.modulePath}: getDocument unavailable`);
        continue;
      }
      return pdfjs;
    } catch (error) {
      failures.push(`${candidate.moduleSpecifier || candidate.modulePath}: ${error.message}`);
    }
  }
  throw new Error(
    'Unable to load a real pdfjs-dist legacy build for the step-2 real-PDF gate. ' +
    `Tried: ${failures.join(' | ')}`,
  );
}

test('step 2 real PDF wall runs merge real page-8 wall fragments into sane standing walls', { timeout: 180000 }, async () => {
  assert.ok(fs.existsSync(PDF_PATH), `expected real PDF fixture at ${PDF_PATH}`);

  const pdfjs = await loadPdfJsLegacy();
  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  try {
    const page = await doc.getPage(PDF_PAGE);
    const plan = await extractLevelPlanFromPdf(page, { wallRunsOnly: true });
    const rawWalls = plan.wallsFt;
    const wallRuns = plan.wallRuns;

    assert.ok(Array.isArray(rawWalls), 'expected extractLevelPlanFromPdf to expose raw wall segments');
    assert.ok(rawWalls.length > 1000, `expected step-1 raw walls > 1000, got ${rawWalls.length}`);

    assert.ok(Array.isArray(wallRuns), 'expected extractLevelPlanFromPdf to expose merged wallRuns');
    assert.ok(wallRuns.length >= 20, `expected at least 20 merged runs, got ${wallRuns.length}`);
    assert.ok(wallRuns.length <= 900, `expected at most 900 merged runs, got ${wallRuns.length}`);
    assert.ok(wallRuns.length < rawWalls.length / 3, `expected merged runs < raw/3, got raw=${rawWalls.length} merged=${wallRuns.length}`);

    for (const [index, run] of wallRuns.entries()) {
      assert.ok(Array.isArray(run.a) && Array.isArray(run.b), `run ${index} missing endpoints`);
      assert.notDeepEqual(run.a, run.b, `run ${index} has degenerate identical endpoints`);
    }

    console.log(
      `[step2-real-runs] page=${PDF_PAGE} rawWalls=${rawWalls.length} mergedRuns=${wallRuns.length} ` +
      `orphansDropped=${plan.wallRunsMeta?.orphanRunsDropped ?? 'n/a'}`,
    );
  } finally {
    await loadingTask.destroy();
  }
});
