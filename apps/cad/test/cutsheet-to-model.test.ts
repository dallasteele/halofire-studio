import { describe, it, expect } from 'vitest';
import { modelFromCutSheet, type CutSheetDims } from '../src/lib/cutsheet-to-model';

describe('modelFromCutSheet', () => {
  it('generates real scad + a needs-verification flag for a tee', () => {
    const dims: CutSheetDims = {
      partType: 'tee',
      nominalIn: 2,
      odIn: 2.375,
      centerToEndIn: 2,
      branchCenterToEndIn: 1.5,
    };

    const result = modelFromCutSheet(dims);

    // Real emitter output, not a mock pass-through.
    expect(result.scad).toContain('union()');
    expect(result.scad).toContain('cylinder(');
    expect(result.verification.status).toBe('needs-verification');
    expect(result.verification.note).toContain('tee');
    expect(result.verification.source).toBe('cut-sheet-derived');
  });

  it('throws RangeError for an unknown partType', () => {
    const dims = { partType: 'unknown', nominalIn: 1, odIn: 1 } as unknown as CutSheetDims;
    expect(() => modelFromCutSheet(dims)).toThrow(RangeError);
  });

  it('carries the sourceUrl into the verification flag when provided', () => {
    const dims: CutSheetDims = {
      partType: 'pipe',
      nominalIn: 1,
      odIn: 1.3125,
      lengthIn: 10,
      wallIn: 0.15,
      sourceUrl: 'https://example.com/sheet.pdf',
    };

    const result = modelFromCutSheet(dims);
    expect(result.verification.source).toBe('https://example.com/sheet.pdf');
    expect(result.verification.status).toBe('needs-verification');
  });

  it('propagates the emitter error when required dims are missing', () => {
    // pipe with no lengthIn/wallIn -> emitter sees NaN -> RangeError.
    const dims = { partType: 'pipe', nominalIn: 1, odIn: 1.3 } as unknown as CutSheetDims;
    expect(() => modelFromCutSheet(dims)).toThrow(RangeError);
  });
});
