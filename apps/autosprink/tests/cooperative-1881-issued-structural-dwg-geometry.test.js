import { describe, expect, it } from 'vitest';

import { renderRoofPlanSourceSvg, summarizeIssuedStructuralEntities } from '../scripts/extract-cooperative-1881-issued-structural-dwg-geometry.mjs';

const sheet = { id: 'S-190', title: 'OVERALL ROOF FRAMING PLAN', sha256: 'A'.repeat(64) };
const entities = [
  { type: 'LINE', handle: '10', layer: 'S-BEAM', startPoint: { x: 0, y: 0, z: 0 }, endPoint: { x: 100, y: 0, z: 0 } },
  { type: 'LINE', handle: '11', layer: 'S-GRID', startPoint: { x: 0, y: 0, z: 0 }, endPoint: { x: 0, y: 80, z: 0 } },
  { type: 'MTEXT', handle: '12', layer: 'S-GRID-IDEN', text: 'A', insertionPoint: { x: 0, y: 80, z: 0 }, textHeight: 6 },
];

describe('Cooperative 1881 issued structural DWG geometry receipt', () => {
  it('retains native S-190 plan controls without promoting physical framing or clearance', () => {
    const receipt = summarizeIssuedStructuralEntities({ expectedSheet: sheet, sourcePath: 'S-190.dwg', bytes: Buffer.from('source'), sha256: 'A'.repeat(64), parserStats: { unknownEntityCount: 0 }, entities });
    expect(receipt.issues).toEqual([]);
    expect(receipt.planControls.roofLinework).toHaveLength(2);
    expect(receipt.planControls.gridLabels).toHaveLength(1);
    expect(receipt.planControls.note).toContain('not member tags');
  });

  it('rejects source hash drift and parser unknown entities', () => {
    const receipt = summarizeIssuedStructuralEntities({ expectedSheet: sheet, sourcePath: 'substituted.dwg', bytes: Buffer.from('source'), sha256: 'B'.repeat(64), parserStats: { unknownEntityCount: 1 }, entities });
    expect(receipt.issues.map((entry) => entry.code)).toEqual([
      'ISSUED_STRUCTURAL_DWG_SOURCE_HASH_MISMATCH',
      'ISSUED_STRUCTURAL_DWG_UNKNOWN_ENTITIES',
    ]);
  });

  it('renders only native source linework and explicit no-claim boundaries', () => {
    const receipt = summarizeIssuedStructuralEntities({ expectedSheet: sheet, sourcePath: 'S-190.dwg', bytes: Buffer.from('source'), sha256: 'A'.repeat(64), parserStats: { unknownEntityCount: 0 }, entities });
    const svg = renderRoofPlanSourceSvg(receipt);
    expect(svg).toContain('S-190 NATIVE ISSUED STRUCTURAL DWG SOURCE LINEWORK');
    expect(svg).toContain('no sprinkler, no fabricated member, no clearance or code claim');
    expect(svg).toContain('no PDF overlay');
  });
});
