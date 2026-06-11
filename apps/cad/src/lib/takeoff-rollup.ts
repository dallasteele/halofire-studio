import { BidPayloadItem } from './bid-payload';

export interface PipeGroup {
  diameterIn: number;
  lengthFt: number;
  count: number;
}

export interface FittingCount {
  kind: string;
  count: number;
}

export interface RollupSummary {
  totalHeads: number;
  totalPipeLengthFt: number;
  pipeByDiameter: PipeGroup[];
  fittingCounts: FittingCount[];
}

/**
 * Aggregates a BidPayload into a summary for BOM reporting.
 * 
 * Rules:
 * - totalHeads is the sum of quantities where sku contains ':head:'.
 * - totalPipeLengthFt is the sum of quantities where sku contains ':pipe:' (rounded to 2 decimals).
 * - pipeByDiameter groups pipes by diameter, summing lengths and counting occurrences.
 * - fittingCounts counts items by their 'kind' prefix extracted from SKU.
 * - All numeric results are rounded to 2 decimal places.
 * 
 * @param payload The BidPayload to process.
 * @returns A RollupSummary object containing aggregated totals.
 */
export function rollupTakeoff(payload: BidPayloadItem[]): RollupSummary {
  let totalHeads = 0;
  let totalPipeLengthFt = 0;

  const pipeMap = new Map<number, { length: number; count: number }>();
  const fittingCountsMap = new Map<string, number>();

  for (const item of payload) {
    if (!Number.isFinite(item.quantity)) {
      throw new Error('Quantity must be a finite number');
    }

    const [kind, sizeStr] = item.sku.split(':');
    // SKU format: kind:sizeIn:material (or na)
    
    if (kind === 'pipe') {
      const diameter = parseFloat(sizeStr);
      const length = item.quantity;
      totalPipeLengthFt += length;

      const existing = pipeMap.get(diameter) || { length: 0, count: 0 };
      pipeMap.set(diameter, {
        length: existing.length + length,
        count: existing.count + 1,
      });
    } else if (kind === 'head') {
      totalHeads += item.quantity;
    }

    // Fittings are anything that isn't a pipe or head, but the spec implies 
    // we extract kind from SKU for fittingCounts.
    // Based on common CAD patterns: if it's not 'pipe' or 'head', treat as fitting.
    if (kind !== 'pipe' && kind !== 'head') {
      const current = fittingCountsMap.get(kind) || 0;
      fittingCountsMap.set(kind, current + item.quantity);
    }
  }

  const pipeByDiameter: PipeGroup[] = Array.from(pipeMap.entries())
    .map(([diameterIn, data]) => ({
      diameterIn,
      lengthFt: Math.round(data.length * 100) / 100,
      count: data.count,
    }))
    .sort((a, b) => a.diameterIn - b.diameterIn);

  const fittingCounts: FittingCount[] = Array.from(fittingCountsMap.entries())
    .map(([kind, count]) => ({
      kind,
      count: Math.round(count * 100) / 100,
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));

  return {
    totalHeads: Math.round(totalHeads * 100) / 100,
    totalPipeLengthFt: Math.round(totalPipeLengthFt * 100) / 100,
    pipeByDiameter,
    fittingCounts,
  };
}