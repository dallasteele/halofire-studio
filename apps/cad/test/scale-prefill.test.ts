import { describe, expect, it } from 'vitest';
import { prefillScaleFromText } from '../src/lib/scale-prefill';

describe('prefillScaleFromText', () => {
  it('should return the first hit found in pages (first-page wins)', () => {
    const texts = [
      'Some noise',
      'Scale: 1/4" = 1\'-0"',
      'Another scale: 1/8" = 1\'-0"'
    ];
    // 1/4" = 1'-0" => ftPerInch = 1 / 0.25 = 4. 
    // ftPerUnit = 4 / 72 = 0.0555...
    const result = prefillScaleFromText(texts);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.pageIndex).toBe(1);
      expect(result.sourceText).toBe('1/4" = 1\'-0"');
      expect(result.ftPerUnit).toBeCloseTo(4 / 72);
    }
  });

  it('should fallback to later pages if first page has no match', () => {
    const texts = ['No scale here', '1:96'];
    // 1:96 -> world=96, paper=1. ftPerInch = (96/1)/12 = 8.
    // ftPerUnit = 8 / 72 = 0.111...
    const result = prefillScaleFromText(texts);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.pageIndex).toBe(1);
      expect(result.sourceText).toBe('1:96');
      expect(result.ftPerUnit).toBeCloseTo(8 / 72);
    }
  });

  it('should return null if no match is found', () => {
    const texts = ['Just text', 'No scale here'];
    const result = prefillScaleFromText(texts);
    expect(result).toBeNull();
  });

  it('should correctly map the eighth-inch example to 8 ftPerInch over 72', () => {
    // 1/8" = 1'-0" 
    // numerator=1, denominator=8 -> paperInches = 0.125
    // feet=1 -> worldFeet = 1
    // ftPerInch = 1 / 0.125 = 8
    const texts = ['Scale: 1/8" = 1\'-0"'];
    const result = prefillScaleFromText(texts);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.ftPerUnit).toBeCloseTo(8 / 72);
    }
  });
});