import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import createNfpaReport, { createNfpaReport as createNamedNfpaReport } from './nfpaReport.mjs';

test('nfpaReport builds a deterministic design summary', () => {
  const report = createNfpaReport({
    projectName: 'Tower A',
    hazardClass: 'ordinary_ii',
    designAreaSqFt: 1500,
    densityGpmPerSqFt: 0.2,
    hoseAllowanceGpm: 250,
    sprinklerCount: 18,
    notes: ['remote area calc', '', 'city supply pending'],
  });

  assert.deepEqual(report, {
    title: 'NFPA 13 Design Summary',
    projectName: 'Tower A',
    hazardClass: 'ordinary_ii',
    designAreaSqFt: 1500,
    densityGpmPerSqFt: 0.2,
    sprinklerCount: 18,
    calculatedFlowGpm: 300,
    hoseAllowanceGpm: 250,
    demandGpm: 550,
    pressureUnits: 'psi',
    notes: ['remote area calc', 'city supply pending'],
  });

  assert.equal(createNamedNfpaReport, createNfpaReport);
});

test('nfpaReport source is dependency-free and ES module safe', () => {
  const source = readFileSync(new URL('./nfpaReport.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\bmodule\.exports\b/);
});
