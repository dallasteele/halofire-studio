/**
 * Represents a single line item from the CAD takeoff.
 */
export interface TakeoffLine {
  kind: string;
  label: string;
  qty: number;
  unit: string;
  sizeIn?: number;
  material?: string;
}

/**
 * Represents a single item in the Autosprink bid payload.
 */
export interface BidPayloadItem {
  sku: string;
  description: string;
  quantity: number;
  unit: string;
}

/**
 * The complete payload structure for importing into Autosprink.
 */
export interface BidPayload {
  projectName: string;
  source: 'halofire-cad';
  generatedAt: string;
  items: BidPayloadItem[];
  disclaimer: string;
}

/**
 * Maps a CAD takeoff to an Autosprink bid payload.
 * 
 * Rules:
 * - sku is built as `${kind}:${sizeIn ?? 'na'}:${material ?? 'na'}` lowercased.
 * - description = label.
 * - quantity = qty rounded to 2 decimals via Math.round(q*100)/100.
 * - unit passes through.
 * - lines with qty <= 0 are skipped.
 * - throws on empty projectName or non-finite qty in any kept line.
 * - disclaimer is a fixed string containing 'design aid' and 'not a committed bid'.
 * 
 * @param projectName The name of the project.
 * @param lines Array of takeoff lines to map.
 * @param generatedAt Timestamp string provided by caller.
 * @returns A formatted BidPayload object.
 */
export function toBidPayload(projectName: string, lines: TakeoffLine[], generatedAt: string): BidPayload {
  if (projectName.trim().length === 0) {
    throw new Error('Project name cannot be empty');
  }

  const items: BidPayloadItem[] = [];

  for (const line of lines) {
    if (line.qty <= 0) {
      continue;
    }

    if (!Number.isFinite(line.qty)) {
      throw new Error('Quantity must be a finite number');
    }

    const skuPart = `${line.kind}:${line.sizeIn ?? 'na'}:${line.material ?? 'na'}`.toLowerCase();
    const roundedQty = Math.round(line.qty * 100) / 100;

    items.push({
      sku: skuPart,
      description: line.label,
      quantity: roundedQty,
      unit: line.unit,
    });
  }

  return {
    projectName,
    source: 'halofire-cad',
    generatedAt,
    items,
    disclaimer: 'This is a design aid only and not a committed bid.',
  };
}
