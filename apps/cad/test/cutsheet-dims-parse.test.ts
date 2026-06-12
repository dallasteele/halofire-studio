import { describe, expect, it } from 'vitest';
import { parseCutSheetDims } from '../src/lib/cutsheet-dims-parse';

const TEE_SHEET = [
  'Series 200 Grooved Tee — 2 inch',
  'Outside Diameter: 2.375',
  'Center to End: 2.25',
  'Branch: 2.25',
  'Working pressure 300 psi',
].join('\n');

describe('parseCutSheetDims', () => {
  it('parses tee dimensions correctly with empty missing', () => {
    const r = parseCutSheetDims(TEE_SHEET, 'tee', 2);
    expect(r.dims.partType).toBe('tee');
    expect(r.dims.nominalIn).toBe(2);
    expect(r.dims.odIn).toBe(2.375);
    expect(r.dims.centerToEndIn).toBe(2.25);
    expect(r.dims.branchCenterToEndIn).toBe(2.25);
    expect(r.missing).toEqual([]);
  });

  it('parses pipe wall + laying length', () => {
    const r = parseCutSheetDims(
      'Schedule 40 pipe. O.D. 2.375 Wall thickness 0.154 Laying length 252',
      'pipe',
      2,
    );
    expect(r.dims.odIn).toBe(2.375);
    expect(r.dims.wallIn).toBe(0.154);
    expect(r.dims.lengthIn).toBe(252);
    expect(r.missing).toEqual([]);
  });

  it('omits unfound fields and lists them in missing (no invented dims)', () => {
    const r = parseCutSheetDims('Outside Diameter: 1.315', 'pipe', 1);
    expect(r.dims.odIn).toBe(1.315);
    expect(r.dims).not.toHaveProperty('wallIn');
    expect(r.missing.sort()).toEqual(['lengthIn', 'wallIn']);
  });

  it('throws TypeError on non-string text only', () => {
    expect(() => parseCutSheetDims(123 as unknown as string, 'pipe', 1)).toThrow(TypeError);
    expect(() => parseCutSheetDims('', 'pipe', 1)).not.toThrow();
  });
});
