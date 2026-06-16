const MOCK_VALUES = Object.freeze({
  hazenWilliams: {
    cFactor: 120,
    frictionLossPsi: 7.4,
    source: 'mock',
  },
  coverage: {
    protectedAreaSqFt: 12600,
    coveredPct: 0.97,
    headCount: 84,
    source: 'mock',
  },
  bom: [
    { item: 'Sprinkler head', qty: 84, unit: 'ea' },
    { item: '1 in. branch pipe', qty: 640, unit: 'ft' },
    { item: 'Grooved fittings', qty: 118, unit: 'ea' },
  ],
  labor: {
    estimatedHours: 146,
    crewSize: 4,
    laborRateUsdPerHour: 98,
    source: 'mock',
  },
  nfpaReport: {
    edition: 'NFPA 13 2022',
    status: 'mock-pass',
    notes: ['Mock report for adapter integration'],
  },
  submittalData: {
    projectName: 'Mock Warehouse TI',
    contractor: 'HaloFire CAD Studio',
    generatedBy: 'engine-adapter-mock',
  },
  bidTotal: {
    amountUsd: 48250,
    currency: 'USD',
    source: 'mock',
  },
  bidRisk: {
    score: 0.22,
    level: 'moderate',
    drivers: ['Mock material volatility', 'Mock field access unknowns'],
  },
});

function resolveMock(value) {
  return Promise.resolve({ value });
}

export function getHazenWilliams() {
  return resolveMock(MOCK_VALUES.hazenWilliams);
}

export function getCoverage() {
  return resolveMock(MOCK_VALUES.coverage);
}

export function getBom() {
  return resolveMock(MOCK_VALUES.bom);
}

export function getLabor() {
  return resolveMock(MOCK_VALUES.labor);
}

export function getNfpaReport() {
  return resolveMock(MOCK_VALUES.nfpaReport);
}

export function getSubmittalData() {
  return resolveMock(MOCK_VALUES.submittalData);
}

export function getBidTotal() {
  return resolveMock(MOCK_VALUES.bidTotal);
}

export function getBidRisk() {
  return resolveMock(MOCK_VALUES.bidRisk);
}

