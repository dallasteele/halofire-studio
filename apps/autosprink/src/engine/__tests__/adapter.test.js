import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const ADAPTER_PATH = new URL('../adapter.ts', import.meta.url);

async function loadAdapterModule() {
  const source = await readFile(ADAPTER_PATH, 'utf8');
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

test('adapter exports all requested functions', async () => {
  const adapter = await loadAdapterModule();

  assert.deepEqual(
    Object.keys(adapter).sort(),
    [
      'getBidRisk',
      'getBidTotal',
      'getBom',
      'getCoverage',
      'getHazenWilliams',
      'getLabor',
      'getNfpaReport',
      'getSubmittalData',
    ],
  );
});

test('adapter functions return Promise<{ value:any, error?:string }>', async () => {
  const adapter = await loadAdapterModule();
  const expectedValues = new Map([
    ['getHazenWilliams', { cFactor: 120, frictionLossPsi: 7.4, source: 'mock' }],
    ['getCoverage', { protectedAreaSqFt: 12600, coveredPct: 0.97, headCount: 84, source: 'mock' }],
    ['getBom', [
      { item: 'Sprinkler head', qty: 84, unit: 'ea' },
      { item: '1 in. branch pipe', qty: 640, unit: 'ft' },
      { item: 'Grooved fittings', qty: 118, unit: 'ea' },
    ]],
    ['getLabor', { estimatedHours: 146, crewSize: 4, laborRateUsdPerHour: 98, source: 'mock' }],
    ['getNfpaReport', { edition: 'NFPA 13 2022', status: 'mock-pass', notes: ['Mock report for adapter integration'] }],
    ['getSubmittalData', { projectName: 'Mock Warehouse TI', contractor: 'HaloFire CAD Studio', generatedBy: 'engine-adapter-mock' }],
    ['getBidTotal', { amountUsd: 48250, currency: 'USD', source: 'mock' }],
    ['getBidRisk', { score: 0.22, level: 'moderate', drivers: ['Mock material volatility', 'Mock field access unknowns'] }],
  ]);

  for (const [name, value] of expectedValues) {
    const resultPromise = adapter[name]();
    assert.equal(typeof resultPromise?.then, 'function', `${name} should return a Promise`);

    const result = await resultPromise;
    assert.deepEqual(result, { value }, `${name} should resolve mock data`);
    assert.equal('error' in result, false, `${name} should omit error on mock success`);
  }
});
