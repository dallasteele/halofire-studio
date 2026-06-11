import { describe, expect, it } from 'vitest';
import { rollupTakeoff } from '../src/lib/takeoff-rollup';
import type { BidPayloadItem } from '../src/lib/bid-payload';

describe('rollupTakeoff', () => {
  it('handles an empty payload correctly', () => {
    const result = rollupTakeoff([]);
    expect(result.totalHeads).toBe(0);
    expect(result.totalPipeLengthFt).toBe(0);
    expect(result.pipeByDiameter).toEqual([]);
    expect(result.fittingCounts).toEqual([]);
  });

  it('handles a non-empty payload correctly', () => {
    const payload: BidPayloadItem[] = [
      { sku: 'head:na:chrome', description: 'Sprinkler Head', quantity: 10, unit: 'ea' },
      { sku: 'pipe:0.5:cpvc', description: 'Pipe 1/2\"', quantity: 50.555, unit: 'ft' },
      { sku: 'pipe:0.75:cpvc', description: 'Pipe 3/4\"', quantity: 20, unit: 'ft' },
      { sku: 'pipe:0.5:cpvc', description: 'Pipe 1/2\" extra', quantity: 10.444, unit: 'ft' },
      { sku: 'elbow:na:chrome', description: '90 Elbow', quantity: 5, unit: 'ea' },
      { sku: 'tee:na:chrome', description: 'Tee', quantity: 2, unit: 'ea' },
    ];

    const result = rollupTakeoff(payload);

    // totalHeads: 10
    expect(result.totalHeads).toBe(10);

    // totalPipeLengthFt: 50.555 + 20 + 10.444 = 80.999 -> rounded to 81.0
    // Wait, let's check math: 50.555 + 20 + 10.444 = 80.999. 
    // Math.round(80.999 * 100) / 100 = 81
    expect(result.totalPipeLengthFt).toBe(81);

    // pipeByDiameter: 
    // 0.5: length (50.555 + 10.444) = 60.999 -> 61, count 2
    // 0.75: length 20, count 1
    expect(result.pipeByDiameter).toEqual([
      { diameterIn: 0.5, lengthFt: 61, count: 2 },
      { diameterIn: 0.75, lengthFt: 20, count: 1 }
    ]);

    // fittingCounts (sorted by kind): elbow, tee
    expect(result.fittingCounts).toEqual([
      { kind: 'elbow', count: 5 },
      { kind: 'tee', count: 2 }
    ]);
  });

  it('throws error on non-finite quantity', () => {
    const payload = [{ sku: 'pipe:1:na', description: 'bad', quantity: NaN, unit: 'ft' }];
    expect(() => rollupTakeoff(payload)).toThrow('Quantity must be a finite number');
  });
});