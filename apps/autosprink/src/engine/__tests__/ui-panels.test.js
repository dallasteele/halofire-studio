import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const panelPath = path.join(repoRoot, 'apps/autosprink/autosprink.html');
const adapterPath = path.join(repoRoot, 'apps/autosprink/src/engine/ui-panels.js');

test('autosprink compliance panel is wired to NFPA report and BOM adapter data', () => {
  const panel = readFileSync(panelPath, 'utf8');
  const adapter = readFileSync(adapterPath, 'utf8');

  assert.match(panel, /import\s*\{\s*getBom,\s*getNfpaReport\s*\}\s*from\s*'\/src\/engine\/ui-panels\.js'/);
  assert.match(panel, /function refreshCompliancePanel\(\)/);
  assert.match(panel, /const nfpaReport = getNfpaReport\(\);/);
  assert.match(panel, /const bom = getBom\(\);/);
  assert.match(panel, /NFPA report status/);
  assert.match(panel, /BOM summary/);
  assert.match(panel, /try \{ refreshCompliancePanel\(\); \} catch \(_\) \{ \/\* panel optional \*\/ \}/);

  assert.match(adapter, /export function getNfpaReport/);
  assert.match(adapter, /export function getBom/);
  assert.match(adapter, /Awaiting hydraulic solve/);
  assert.match(adapter, /Awaiting live takeoff/);
});
