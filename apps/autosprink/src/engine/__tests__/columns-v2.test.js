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

function uniqueCount(values) {
  return new Set(values.map((v) => Number(v).toFixed(3))).size;
}

test('extractStructureLayerFromPdf returns real columns for 1881 page 8 proxy', async (t) => {
  const cleanupNodeModules = ensureAutosprinkNodeModules();
  t.after(cleanupNodeModules);

  const pdfPath = resolveArchitecturalPdf();
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { extractStructureLayerFromPdf } = await import('../structure-from-plan.js');

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
    const layer = await extractStructureLayerFromPdf(page);

    assert.ok(Array.isArray(layer.columns), 'columns should be present');
    assert.ok(layer.columns.length > 0, `expected > 0 extracted columns, got ${layer.columns.length}`);
    assert.ok(
      layer.columns.every((col) =>
        Number.isFinite(col.x) &&
        Number.isFinite(col.y) &&
        Number.isFinite(col.markerSegs) &&
        col.markerSegs >= 12 &&
        col.bbox &&
        Number.isFinite(col.bbox.widthFt) &&
        Number.isFinite(col.bbox.heightFt)),
      'columns should carry finite extracted coordinates and marker metadata',
    );

    const uniqueXs = uniqueCount(layer.columns.map((col) => col.x));
    const uniqueYs = uniqueCount(layer.columns.map((col) => col.y));
    assert.ok(
      layer.columns.length < (uniqueXs * uniqueYs),
      `expected real column markers, not a full ${uniqueXs}x${uniqueYs} grid product`,
    );
  } finally {
    await loadingTask.destroy();
  }
});
