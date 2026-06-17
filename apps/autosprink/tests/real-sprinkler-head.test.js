import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getComponent } from '../src/components/registry.js';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const PARTS_DIR = path.join(APP_ROOT, 'parts');
const STL_PATH = path.join(PARTS_DIR, 'pendent-head-k56.stl');
const MANIFEST_PATH = path.join(PARTS_DIR, 'parts-manifest.json');
const VIKING_VK302_URL = 'https://www.vikinggroupinc.com/databook/current_tds/033314.pdf';
const MM_PER_IN = 25.4;

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function bboxFromAsciiStl(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const matches = [...text.matchAll(/vertex\s+([\-0-9.eE]+)\s+([\-0-9.eE]+)\s+([\-0-9.eE]+)/g)];
  assert(matches.length > 0, 'STL should contain vertex rows');
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (const match of matches) {
    for (let i = 0; i < 3; i += 1) {
      const value = Number(match[i + 1]);
      mins[i] = Math.min(mins[i], value);
      maxs[i] = Math.max(maxs[i], value);
    }
  }
  return maxs.map((value, i) => (value - mins[i]) / MM_PER_IN);
}

test('checked-in real pendent sprinkler head asset exists', () => {
  assert.equal(fs.existsSync(STL_PATH), true, `${STL_PATH} should exist`);
  const size = fs.statSync(STL_PATH).size;
  assert(size > 0, 'STL should not be empty');
});

test('manifest registers head_pendent with a real checked-in mesh source', () => {
  assert.equal(fs.existsSync(MANIFEST_PATH), true, `${MANIFEST_PATH} should exist`);
  assert.ok(getComponent('head_pendent'), 'registry should contain head_pendent');

  const manifest = readManifest();
  const entry = manifest.components.find((component) => component.key === 'head_pendent');
  assert.ok(entry, 'manifest should contain head_pendent');
  assert.equal(entry.source !== 'missing' && entry.source !== 'primitive-fallback', true);
  assert.equal(entry.source, 'generated');
  assert.equal(entry.present, true);
  assert.equal(entry.file, 'parts/pendent-head-k56.stl');
  assert.equal(entry.format, 'stl');
  assert.equal(entry.manufacturerExact, false);
  assert.equal(entry.dimProvenance, 'cutsheet');
  assert.equal(entry.sourceUrl, VIKING_VK302_URL);
});

test('pendent-head-k56 envelope is approximately real pendent-head size', () => {
  const [widthXIn, widthYIn, heightIn] = bboxFromAsciiStl(STL_PATH);
  assert(widthXIn >= 4.0 && widthXIn <= 5.0, `x width ${widthXIn.toFixed(3)}in should be within 4-5in`);
  assert(widthYIn >= 4.0 && widthYIn <= 5.0, `y width ${widthYIn.toFixed(3)}in should be within 4-5in`);
  assert(heightIn >= 2.0 && heightIn <= 2.5, `height ${heightIn.toFixed(3)}in should be within 2-2.5in`);
});
