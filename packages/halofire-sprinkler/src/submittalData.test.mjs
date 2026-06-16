import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import createSubmittalData, {
  createSubmittalData as createNamedSubmittalData,
} from './submittalData.mjs';

test('submittalData summarizes included documents', () => {
  const submittal = createSubmittalData({
    projectName: 'Tower A',
    contractorName: 'Halo Fire Protection',
    preparedFor: 'Owner Rep',
    revision: '2',
    documents: [
      { name: 'Cover Sheet', included: true, pages: 1 },
      { name: 'Hydraulic Calculations', included: true, pages: 12 },
      { name: 'Material List', included: true, pages: 4 },
      { name: 'Legacy Draft', included: false, pages: 7 },
    ],
  });

  assert.deepEqual(submittal, {
    projectName: 'Tower A',
    contractorName: 'Halo Fire Protection',
    preparedFor: 'Owner Rep',
    revision: '2',
    documents: [
      { name: 'Cover Sheet', included: true, pages: 1 },
      { name: 'Hydraulic Calculations', included: true, pages: 12 },
      { name: 'Material List', included: true, pages: 4 },
      { name: 'Legacy Draft', included: false, pages: 7 },
    ],
    includedDocumentCount: 3,
    totalPages: 17,
    includesHydraulicCalculations: true,
    includesMaterialList: true,
  });

  assert.equal(createNamedSubmittalData, createSubmittalData);
});

test('submittalData source is dependency-free and ES module safe', () => {
  const source = readFileSync(new URL('./submittalData.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\bmodule\.exports\b/);
});
