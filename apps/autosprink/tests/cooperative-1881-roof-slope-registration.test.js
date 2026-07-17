import { describe, expect, it } from 'vitest';

import { extractSlopeCallouts, fitAxisTransform, plainText } from '../scripts/extract-cooperative-1881-roof-slope-registration.mjs';

describe('Cooperative 1881 A-121 to S-190 roof slope registration', () => {
  it('fits an explicit grid-axis registration and preserves residuals', () => {
    const fit = fitAxisTransform([{ label: 'A', source: 1, target: 7 }, { label: 'B', source: 2, target: 9 }, { label: 'C', source: 3, target: 11 }]);
    expect(fit).toMatchObject({ scale: 2, offset: 5, maxResidual: 0, pairCount: 3 });
  });

  it('refuses an underdetermined grid axis instead of inventing a transform', () => {
    expect(fitAxisTransform([{ label: 'A', source: 1, target: 7 }, { label: 'B', source: 2, target: 9 }])).toBeNull();
  });

  it('pairs a source slope annotation to one leader target without treating its leader as a slope direction', () => {
    const entities = [
      { type: 'MTEXT', handle: 'T1', text: '\\A1;{\\pql;SLOPE 1/2" PER FOOT}', insertionPoint: { x: 10, y: 20 } },
      { type: 'LEADER', handle: 'L1', vertices: [{ x: 80, y: 100 }, { x: 10, y: 20 }] },
    ];
    const result = extractSlopeCallouts(entities, { x: { scale: 1, offset: 0 }, y: { scale: -1, offset: 100 } }, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    expect(plainText(entities[0])).toBe('SLOPE 1/2" PER FOOT');
    expect(result.issues).toEqual([]);
    expect(result.callouts[0]).toMatchObject({ inchesPerFoot: 0.5, structuralPoint: { x: 100, y: 20 } });
  });

  it('rejects an unmatched slope callout', () => {
    const result = extractSlopeCallouts([{ type: 'MTEXT', handle: 'T1', text: 'SLOPE 2" PER FOOT', insertionPoint: { x: 10, y: 20 } }], { x: { scale: 1, offset: 0 }, y: { scale: 1, offset: 0 } }, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    expect(result.issues[0].code).toBe('A121_SLOPE_LEADER_MISSING');
  });

  it('rejects an ambiguously attached slope callout', () => {
    const entities = [
      { type: 'MTEXT', handle: 'T1', text: 'SLOPE 2" PER FOOT', insertionPoint: { x: 10, y: 20 } },
      { type: 'LEADER', handle: 'L1', vertices: [{ x: 80, y: 100 }, { x: 10, y: 20 }] },
      { type: 'LEADER', handle: 'L2', vertices: [{ x: 90, y: 100 }, { x: 10, y: 20 }] },
    ];
    const result = extractSlopeCallouts(entities, { x: { scale: 1, offset: 0 }, y: { scale: 1, offset: 0 } }, { minX: 0, minY: 0, maxX: 200, maxY: 200 });
    expect(result.issues[0].code).toBe('A121_SLOPE_LEADER_AMBIGUOUS');
  });
});
