import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function markerAt(cx, cy, segs = 8) {
  const out = [];
  for (let i = 0; i < segs; i += 1) {
    out.push({
      x1: cx - 0.5,
      y1: cy + i * 0.1 - 0.4,
      x2: cx + 0.5,
      y2: cy + i * 0.1 - 0.4,
    });
  }
  return out;
}

async function loadDetectColumns() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sourcePath = path.resolve(here, '../apps/autosprink/src/engine/structure-from-plan.js');
  const source = await readFile(sourcePath, 'utf8');
  const sanitized = source.replace(
    /import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/pdf-floorplan\.js['"];\n\n/,
    '',
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(sanitized).toString('base64')}`;
  const loaded = await import(moduleUrl);
  return loaded.detectColumns;
}

test('detectColumns emits one column per detected marker cluster only', async () => {
  const detectColumns = await loadDetectColumns();
  const grid = {
    xs: [0, 20, 40],
    ys: [0, 20],
    labels: { cols: ['1', '2', '3'], rows: ['A', 'B'] },
  };
  const segments = [
    ...markerAt(0, 0),
    ...markerAt(40, 20),
    { x1: 19.8, y1: 0, x2: 20.2, y2: 0 },
    { x1: 20, y1: -0.2, x2: 20, y2: 0.2 },
    { x1: 39.8, y1: 0, x2: 40.2, y2: 0 },
  ];

  const result = detectColumns(grid, segments, [], {
    minMarkerSegs: 4,
    markerRadiusFt: 2.5,
    markerMaxLenFt: 3,
  });

  assert.equal(result.columns.length, 2);
  assert.deepEqual(
    result.columns.map((column) => ({ x: column.x, y: column.y, grid: column.grid })),
    [
      { x: 0, y: 0, grid: { col: '1', row: 'A' } },
      { x: 40, y: 20, grid: { col: '3', row: 'B' } },
    ],
  );
});

test('detectColumns does not synthesize columns from bare grid intersections', async () => {
  const detectColumns = await loadDetectColumns();
  const grid = {
    xs: [0, 20],
    ys: [0, 20],
    labels: { cols: ['1', '2'], rows: ['A', 'B'] },
  };

  const result = detectColumns(grid, [], [], {});

  assert.deepEqual(result.columns, []);
});
