import { describe, expect, it } from 'vitest';

import { consensusForPairs, extractRoofDatumPairs, parseElevationInches } from '../scripts/extract-cooperative-1881-issued-roof-datum-consensus.mjs';

const source = { sha256: 'A'.repeat(64), fileName: 'S-201.dwg', parser: 'test', unknownEntityCount: 0 };
const entities = [
  { type: 'MTEXT', handle: 'eave-label', layer: 'A-FLOR-LEVL', text: '9. ROOF EAVE', insertionPoint: { x: 10, y: 100 } },
  { type: 'MTEXT', handle: 'eave-value', layer: 'A-FLOR-LEVL', text: '84\'-1 1/8"', insertionPoint: { x: 43, y: 82 } },
  { type: 'MTEXT', handle: 'ridge-label', layer: 'A-FLOR-LEVL', text: '10. T.O. ROOF RIDGE', insertionPoint: { x: 10, y: 120 } },
  { type: 'MTEXT', handle: 'ridge-value', layer: 'A-FLOR-LEVL', text: '85\'-10"', insertionPoint: { x: 43, y: 102 } },
];

describe('Cooperative 1881 issued roof datum consensus', () => {
  it('parses source feet/inches exactly and rejects malformed values', () => {
    expect(parseElevationInches('84\'-1 1/8"')).toBe(1009.125);
    expect(parseElevationInches('85\'-10"')).toBe(1030);
    expect(parseElevationInches('85\'-12"')).toBeNull();
  });

  it('binds datum labels only to nearby source values with handles and source identity', () => {
    const result = extractRoofDatumPairs({ sheetId: 'S-201', source, entities });
    expect(result.issues).toEqual([]);
    expect(result.pairs.map((pair) => [pair.kind, pair.label.handle, pair.value.handle, pair.value.elevationInches])).toEqual([
      ['roof-eave', 'eave-label', 'eave-value', 1009.125],
      ['roof-ridge', 'ridge-label', 'ridge-value', 1030],
    ]);
  });

  it('rejects omitted, above-label, or conflicting consensus observations', () => {
    const missing = extractRoofDatumPairs({ sheetId: 'S-201', source, entities: entities.filter((entity) => entity.handle !== 'ridge-value') });
    expect(missing.issues.map((entry) => entry.code)).toContain('ROOF_DATUM_VALUE_PAIR_UNRESOLVED');
    const above = extractRoofDatumPairs({ sheetId: 'S-201', source, entities: entities.map((entity) => entity.handle === 'eave-value' ? { ...entity, insertionPoint: { x: 43, y: 118 } } : entity) });
    expect(above.issues.map((entry) => entry.code)).toContain('ROOF_DATUM_VALUE_PAIR_UNRESOLVED');
    const pairs = extractRoofDatumPairs({ sheetId: 'S-201', source, entities }).pairs;
    expect(consensusForPairs([pairs[0], { ...pairs[0], value: { ...pairs[0].value, elevationInches: 999 } }])).toBeNull();
  });
});
