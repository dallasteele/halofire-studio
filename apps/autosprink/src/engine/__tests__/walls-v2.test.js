import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const AUTOSPRINK_DIR = path.resolve(THIS_DIR, '../../..');
const LOCAL_NODE_MODULES = path.join(AUTOSPRINK_DIR, 'node_modules');
const CANONICAL_NODE_MODULES = '/opt/hal9000/halofire-studio/apps/autosprink/node_modules';
const PDF_CANDIDATES = [
  path.join(AUTOSPRINK_DIR, 'plans/cooperative-1881/1881-architecturals.pdf'),
  '/opt/hal9000/halofire-studio/apps/autosprink/plans/cooperative-1881/1881-architecturals.pdf',
];

function ensureAutosprinkNodeModules() {
  if (fs.existsSync(LOCAL_NODE_MODULES)) return () => {};
  if (!fs.existsSync(CANONICAL_NODE_MODULES)) {
    throw new Error(`pdfjs-dist unavailable: missing ${LOCAL_NODE_MODULES} and ${CANONICAL_NODE_MODULES}`);
  }
  fs.symlinkSync(CANONICAL_NODE_MODULES, LOCAL_NODE_MODULES, 'dir');
  return () => {
    try {
      fs.rmSync(LOCAL_NODE_MODULES, { recursive: true, force: true });
    } catch {}
  };
}

function resolveArchitecturalPdf() {
  for (const candidate of PDF_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`1881 architecturals PDF not found in any expected location: ${PDF_CANDIDATES.join(', ')}`);
}

test('extractLevelPlanFromPdf returns real wallsFt for 1881 page 8', async (t) => {
  const cleanupNodeModules = ensureAutosprinkNodeModules();
  t.after(cleanupNodeModules);

  const pdfPath = resolveArchitecturalPdf();
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { extractLevelPlanFromPdf } = await import('../plan-extract.js');

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(8);
    const plan = await extractLevelPlanFromPdf(page);

    assert.ok(Array.isArray(plan.wallsFt), 'wallsFt should be present');
    assert.ok(Array.isArray(plan.wallRuns), 'wallRuns should be present');
    assert.deepStrictEqual(plan.wallsFt, plan.wallRuns);
    assert.ok(plan.wallsFt.length > 50, `expected > 50 extracted wall runs, got ${plan.wallsFt.length}`);
    assert.ok(
      plan.wallsFt.every((wall) =>
        Array.isArray(wall.a) &&
        Array.isArray(wall.b) &&
        wall.a.every(Number.isFinite) &&
        wall.b.every(Number.isFinite)),
      'wallsFt should carry finite extracted coordinates',
    );
  } finally {
    await loadingTask.destroy();
  }
});
