import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const panelPath = path.join(repoRoot, 'apps/cad/src/components/HydraulicsPanel.tsx');
const adapterPath = path.join(repoRoot, 'apps/cad/src/lib/hydraulics-panel-adapter.ts');

test('stale handoff gate validates the real CAD hydraulics panel wiring', () => {
  const panel = readFileSync(panelPath, 'utf8');
  const adapter = readFileSync(adapterPath, 'utf8');

  assert.match(panel, /import\s*\{\s*getCoverage,\s*getHazenWilliams\s*\}\s*from\s*'\.\.\/lib\/hydraulics-panel-adapter'/);
  assert.match(panel, /const\s*\[\s*hazenWilliams,\s*setHazenWilliams\s*\]\s*=\s*useState<string>\('loading\.\.\.'\)/);
  assert.match(panel, /const\s*\[\s*coverage,\s*setCoverage\s*\]\s*=\s*useState<string>\('loading\.\.\.'\)/);
  assert.match(panel, /useEffect\(\(\)\s*=>\s*\{/);
  assert.match(panel, /Promise\.all\(\[getHazenWilliams\(material\), getCoverage\(hazard\)\]\)/);
  assert.match(panel, /setHazenWilliams\(`\$\{nextHazenWilliams\.value\} \(\$\{nextHazenWilliams\.material\}\)`\)/);
  assert.match(panel, /setCoverage\(nextCoverage\.value\)/);
  assert.match(panel, /ResultRow label="Hazen-Williams" value=\{hazenWilliams\}/);
  assert.match(panel, /ResultRow label="Coverage" value=\{coverage\}/);

  assert.match(adapter, /export async function getHazenWilliams/);
  assert.match(adapter, /export async function getCoverage/);
});
