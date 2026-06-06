// HaloFire CAD — priced bid built on the routed-network takeoff (W6). PURE
// (no React / three / DOM). Deterministic: same takeoff + price table -> same bid.
//
// This is the GLUE between computeTakeoff (takeoff.ts) and the studio's REAL,
// PROVEN bid math (bid.ts re-export of apps/studio/src/lib/bid.ts). It does TWO
// honest things, both driven by the SAME resolved PriceTable (real pricebook
// medians preferred), so the displayed BOM and the bottom-line total never use
// different prices:
//
//   1. priceBomLines(takeoff, priceTable) — price EACH grouped BOM line for the
//      table the operator sees: per-line unitPrice + priceSource + extended. Each
//      BOM category maps to a studio BidMaterialKey whose price the pricebook
//      backs; a line with no backing price is honestly 0 + flagged 'no-price'.
//
//   2. buildPricedBid(takeoff, priceTable) — derive the studio BidDrivers from the
//      takeoff and run buildBidEstimate VERBATIM for the authoritative materials
//      subtotal, labor (0.8/0.05/0.3 hr @ $90/hr), OH&P (10%+10% compounded), and
//      total. The priced BOM lines are attached for display; the dollar totals are
//      the studio estimate's, NOT a re-derivation.
//
// HONESTY: no pricing math is invented here. Materials use ONLY the real pricebook
// medians via the existing bid logic; unpriced lines are honestly 0 and flagged.
// This is a BEST-EFFORT design-aid ESTIMATE, NOT a committed quote / AHJ / PE /
// final bid.

import {
  buildBidEstimate,
  resolvePriceTable,
  REPRESENTATIVE_UNIT_PRICES,
  type BidDrivers,
  type BidEstimate,
  type BidMaterialKey,
  type PriceSource,
  type PriceTable,
} from './bid';
import type { BomLine, Takeoff } from './takeoff';

/* --------------------------------------------------------------- mapping */

/**
 * Map a BOM line to the studio BidMaterialKey whose pricebook band prices it.
 *
 *   head      -> sprinkler_head
 *   pipe      -> branch_pipe   (<= 1.5") | cross_main_pipe (> 1.5")
 *   fitting   -> fitting
 *   riser     -> riser_valve_assy (representative-only; no pricebook band)
 *
 * The pipe split mirrors the autosprink/studio convention: small branch-line pipe
 * vs. the larger cross-main/feed sizes. Returns null when no key prices the line
 * (then the line is honestly 0 + 'no-price' flagged).
 */
export function bidKeyForLine(line: BomLine): BidMaterialKey | null {
  switch (line.category) {
    case 'head':
      return 'sprinkler_head';
    case 'pipe':
      // Branch-size pipe (<= 1-1/2") vs. cross-main/feed (> 1-1/2"). Both are real
      // pricebook-backed keys; the median differs by size band — honest.
      return (line.diameterIn ?? 0) <= 1.5 ? 'branch_pipe' : 'cross_main_pipe';
    case 'fitting':
      return 'fitting';
    case 'riser':
      return 'riser_valve_assy';
    default:
      return null;
  }
}

/* --------------------------------------------------------------- priced lines */

/** A BOM line with its resolved price + provenance. */
export interface PricedBomLine extends BomLine {
  /** The studio bid key that priced this line (null = no price found). */
  bidKey: BidMaterialKey | null;
  /** Unit price (USD). 0 when no price found. */
  unitPrice: number;
  /** qty * unitPrice (USD, rounded to cents). 0 when no price found. */
  extended: number;
  /** Where the unit price came from (honest). 'no-price' = unpriced line at 0. */
  priceSource: PriceSource | 'no-price';
  /** Real pricebook rows backing this price (pricebook-median lines only). */
  matchedRows?: number;
}

/** Round to cents, mirroring the studio bid rounding. */
function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * PURE. Price each grouped BOM line against the resolved PriceTable, producing the
 * per-line table the operator sees. Uses the SAME prices + priceSource rules as
 * buildBidEstimate: a pricebook-backed key with a real matched median is
 * 'pricebook-median'; the riser is 'representative-only'; a key the table lacks is
 * 'representative-fallback'; a line no key prices is 0 + 'no-price'.
 */
export function priceBomLines(takeoff: Takeoff, table: PriceTable): PricedBomLine[] {
  return takeoff.lines.map((line) => {
    const bidKey = bidKeyForLine(line);
    if (bidKey === null) {
      return {
        ...line,
        bidKey: null,
        unitPrice: 0,
        extended: 0,
        priceSource: 'no-price',
      };
    }
    const unitPrice = table.prices[bidKey];
    // priceSource per the studio rules: riser_valve_assy is representative-only
    // (no pricebook band); other keys are pricebook-median when the table is
    // pricebook-backed AND this key matched real rows, else representative-fallback.
    let priceSource: PriceSource;
    const matched = table.matchedRows[bidKey] ?? 0;
    if (bidKey === 'riser_valve_assy') {
      priceSource = 'representative-only';
    } else if (table.kind === 'pricebook' && matched > 0) {
      priceSource = 'pricebook-median';
    } else {
      priceSource = 'representative-fallback';
    }
    const priced: PricedBomLine = {
      ...line,
      bidKey,
      unitPrice: round(unitPrice),
      extended: round(line.qty * unitPrice),
      priceSource,
    };
    if (priceSource === 'pricebook-median') priced.matchedRows = matched;
    return priced;
  });
}

/* --------------------------------------------------------------- drivers */

/**
 * PURE. Derive the studio BidDrivers from a takeoff so buildBidEstimate runs on
 * REAL takeoff quantities. The split mirrors bidKeyForLine:
 *   headCount    = takeoff head total
 *   branchPipeFt = total ft of pipe at <= 1-1/2"
 *   crossMainFt  = total ft of pipe at  > 1-1/2"
 *   fittingCount = takeoff fitting total
 *   dropCount    = head count (one arm-over/drop per head)
 *   hangerCount  = ceil(totalPipeFt / 10)   (a hanger ~every 10 ft, studio rule)
 *   escutcheon   = head count
 *   riserValve   = riser count
 * Every figure comes from the network takeoff — nothing fabricated.
 */
export function driversFromTakeoff(takeoff: Takeoff): BidDrivers {
  let branchPipeFt = 0;
  let crossMainFt = 0;
  for (const line of takeoff.lines) {
    if (line.category !== 'pipe') continue;
    if ((line.diameterIn ?? 0) <= 1.5) branchPipeFt += line.qty;
    else crossMainFt += line.qty;
  }
  const totalPipeFt = branchPipeFt + crossMainFt;
  return {
    headCount: takeoff.headCount,
    branchPipeFt: round(branchPipeFt),
    crossMainFt: round(crossMainFt),
    fittingCount: takeoff.fittingCount,
    dropCount: takeoff.headCount,
    hangerCount: totalPipeFt > 0 ? Math.ceil(totalPipeFt / 10) : 0,
    escutcheonCount: takeoff.headCount,
    riserValveCount: takeoff.riserCount,
  };
}

/* --------------------------------------------------------------- the bid */

/** A fully priced bid for a routed-network takeoff. */
export interface PricedBid {
  /** The grouped, priced BOM lines (what the table renders). */
  bomLines: PricedBomLine[];
  /**
   * The studio's authoritative estimate (materials subtotal, labor, OH&P, total)
   * — buildBidEstimate run VERBATIM on driversFromTakeoff. The dollar totals come
   * from here, NOT a re-derivation, so the math matches the studio exactly.
   */
  estimate: BidEstimate;
  /** Count of priced BOM lines (a price > 0 was found). */
  pricedLineCount: number;
  /** Count of BOM lines with NO price found (honestly 0). */
  unpricedLineCount: number;
}

/**
 * PURE. Build the priced bid from a takeoff + a resolved PriceTable. The displayed
 * BOM lines (priceBomLines) and the bottom-line estimate (buildBidEstimate over
 * driversFromTakeoff) share the SAME table, so they are consistent. When no table
 * is supplied, the representative fallback is resolved (every pricebook-backed line
 * labelled representative).
 */
export function buildPricedBid(takeoff: Takeoff, table?: PriceTable): PricedBid {
  const priceTable = table ?? resolvePriceTable(null);
  const bomLines = priceBomLines(takeoff, priceTable);
  const drivers = driversFromTakeoff(takeoff);
  const estimate = buildBidEstimate(drivers, { priceTable });
  const pricedLineCount = bomLines.filter((l) => l.priceSource !== 'no-price' && l.qty > 0).length;
  const unpricedLineCount = bomLines.filter((l) => l.priceSource === 'no-price').length;
  return { bomLines, estimate, pricedLineCount, unpricedLineCount };
}

/**
 * Convenience: the representative unit price for a bid key (for tests / UI hints).
 * Re-exported here so callers don't reach across into the studio module directly.
 */
export function representativeUnitPrice(key: BidMaterialKey): number {
  return REPRESENTATIVE_UNIT_PRICES[key];
}

/* --------------------------------------------------------------- export */

/**
 * PURE. Serialize a priced bid to a JSON string for export. Includes the priced
 * BOM lines, the studio estimate totals, the line counts, and the honest
 * disclaimer — everything the UI shows, nothing fabricated.
 */
export function bidToJson(bid: PricedBid): string {
  return JSON.stringify(
    {
      kind: 'halofire-cad-design-aid-estimate',
      estimate: true,
      disclaimer: bid.estimate.disclaimer,
      priceSource: bid.estimate.priceSource,
      pricebookRowCount: bid.estimate.pricebookRowCount,
      bom: bid.bomLines,
      totals: {
        materialTotal: bid.estimate.materialTotal,
        laborHours: bid.estimate.laborHours,
        laborCost: bid.estimate.laborCost,
        subtotal: bid.estimate.subtotal,
        overhead: bid.estimate.overhead,
        profit: bid.estimate.profit,
        total: bid.estimate.total,
      },
      pricedLineCount: bid.pricedLineCount,
      unpricedLineCount: bid.unpricedLineCount,
    },
    null,
    2,
  );
}

/** Escape one CSV field (quote when it contains a comma, quote, or newline). */
function csvField(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * PURE. Serialize the priced BOM to a CSV string (one row per BOM line, then the
 * totals block). Deterministic column order. Honest: a header note marks it a
 * design-aid estimate.
 */
export function bidToCsv(bid: PricedBid): string {
  const rows: string[] = [];
  rows.push('# HaloFire CAD design-aid ESTIMATE — NOT a committed quote / AHJ / PE / final bid');
  rows.push(['category', 'description', 'qty', 'unit', 'unitPrice', 'extended', 'priceSource'].join(','));
  for (const l of bid.bomLines) {
    rows.push(
      [
        csvField(l.category),
        csvField(l.description),
        csvField(l.qty),
        csvField(l.unit),
        csvField(l.unitPrice),
        csvField(l.extended),
        csvField(l.priceSource),
      ].join(','),
    );
  }
  const e = bid.estimate;
  rows.push('');
  rows.push(['', 'Materials subtotal', '', '', '', csvField(e.materialTotal), e.priceSource].join(','));
  rows.push(['', `Labor (${e.laborHours} hr)`, '', '', '', csvField(e.laborCost), ''].join(','));
  rows.push(['', 'Subtotal', '', '', '', csvField(e.subtotal), ''].join(','));
  rows.push(['', 'Overhead', '', '', '', csvField(e.overhead), ''].join(','));
  rows.push(['', 'Profit', '', '', '', csvField(e.profit), ''].join(','));
  rows.push(['', 'TOTAL (estimate)', '', '', '', csvField(e.total), ''].join(','));
  return rows.join('\n');
}
