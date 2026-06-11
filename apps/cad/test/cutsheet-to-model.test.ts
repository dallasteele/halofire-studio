import { describe, it, expect } from 'vitest';
import { modelFromCutSheet, CutSheetDims } from '../src/lib/cutsheet-to-model';
import * as emitters from '../src/lib/scad-emitters';

// Mocking emitters to isolate the logic of cutsheet-to-model
vi.mock('../src/lib/scad-emitters', () => ({
  emitPipe: vi.fn(() => 'pipe_scad'),
  emitElbow90: vi.fn(() => 'elbow_scad'),
  emitTee: vi.fn(() => 'tee_scad'),
  emitCoupling: vi.fn(() => 'coupling_scad'),
}));

describe('modelFromCutSheet', () => {
  it('should generate scad and verification for a tee', () => {
    const dims: CutSheetDims = {
      partType: 'tee',
      nominalIn: 2,
      odIn: 2.375,
      branchCenterToEndIn: 1.5,
      wallIn: 0.167,
    };

    const result = modelFromCutSheet(dims);

    expect(result.scad).toBe('tee_scad');
    expect(result.verification.note).toContain('tee');
    expect(result.verification.source).toBe('cut-sheet-derived');
  });

  it('should throw RangeError for unknown partType', () => {
    const dims = { partType: 'unknown' as any, nominalIn: 1, odIn: 1 } as CutSheetDims;
    expect(() => modelFromCutSheet(dims)).toThrow(RangeError);
  });

  it('should use sourceUrl in verification if provided', () => {
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
  });

  it('should propagate errors from emitters if required dims are missing', () => {
    // @ts-expect-error - testing runtime error for invalid input
    const dims: CutSheetDims = { partType: 'pipe', nominalIn: 1, odIn: 1.3 }; // Missing lengthIn/wallIn
    
    emitters.emitPipe.mockImplementationOnce(() => {
      throw new Error('Missing required dimensions');
    });

    expect(() => modelFromCutSheet(dims)).toThrow('Missing required dimensions');
  });
});